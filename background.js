// ---- Autoplay playlist logic ----
let autoplayEnabled = false;
let isAdvancing = false;
const injectedTabs = new Set();

// Load saved autoplay state
chrome.storage.local.get("autoplayEnabled", (data) => {
  autoplayEnabled = !!data.autoplayEnabled;
  if (autoplayEnabled) injectMonitorIntoAllTabs();
});

// Inject monitor into a tab using TWO scripts:
// 1. MAIN world script: listens for video "ended" event, dispatches a custom DOM event
// 2. ISOLATED world script: listens for the custom DOM event, sends chrome.runtime message
async function injectEndedMonitor(tabId) {
  if (injectedTabs.has(tabId)) return;
  try {
    // MAIN world: can access video elements and DOM, but no chrome.runtime
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (window.__mcMonitorInjected) return;
        window.__mcMonitorInjected = true;

        function attachListeners() {
          const videos = document.querySelectorAll("video");
          for (const v of videos) {
            if (v.__mcEnded) continue;
            v.__mcEnded = true;
            v.addEventListener("ended", () => {
              document.dispatchEvent(new CustomEvent("__mc_video_ended", {
                detail: { hasPip: !!document.pictureInPictureElement }
              }));
            });
          }
        }

        // Disable YouTube autoplay toggle
        function disableYTAutoplay() {
          const toggle = document.querySelector(".ytp-autonav-toggle-button");
          if (toggle && toggle.getAttribute("aria-checked") === "true") {
            toggle.click();
          }
        }

        attachListeners();
        disableYTAutoplay();

        // Re-check periodically (YouTube swaps video elements on SPA navigation)
        setInterval(() => {
          attachListeners();
          disableYTAutoplay();
        }, 2000);
      },
    });

    // ISOLATED world: has chrome.runtime, listens for the custom DOM event
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__mcBridgeInjected) return;
        window.__mcBridgeInjected = true;

        document.addEventListener("__mc_video_ended", (e) => {
          chrome.runtime.sendMessage({
            action: "videoEnded",
            hasPip: e.detail?.hasPip || false,
          }).catch(() => {});
        });
      },
    });

    injectedTabs.add(tabId);
  } catch (e) {
    // can't inject into this tab
  }
}

async function injectMonitorIntoAllTabs() {
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.url && !tab.url.startsWith("chrome://")) {
      injectEndedMonitor(tab.id);
    }
  }
}

// Re-inject on tab updates (page loads, YouTube SPA navigations)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible !== undefined) {
    updateExtensionIcon();
  }
  if (autoplayEnabled && (changeInfo.status === "complete" || changeInfo.url)) {
    // Tab navigated — clear injected flag so we re-inject
    injectedTabs.delete(tabId);
    injectEndedMonitor(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// Get ordered list of tabs that have a video element
async function getVideoTabs() {
  const allTabs = await chrome.tabs.query({});
  const videoTabs = [];
  for (const tab of allTabs) {
    if (tab.url && tab.url.startsWith("chrome://")) continue;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => !!document.querySelector("video"),
      });
      if (results[0]?.result) videoTabs.push(tab);
    } catch (e) {}
  }
  return videoTabs;
}

// Handle the videoEnded message
async function handleVideoEnded(senderTabId, hasPip) {
  if (!autoplayEnabled || isAdvancing) return;
  isAdvancing = true;

  try {
    const videoTabs = await getVideoTabs();
    if (videoTabs.length < 2) return;

    const currentIndex = videoTabs.findIndex((t) => t.id === senderTabId);
    if (currentIndex === -1) return;

    const nextIndex = (currentIndex + 1) % videoTabs.length;
    const nextTab = videoTabs[nextIndex];

    console.log("[Autoplay] Ended:", senderTabId, "-> Next:", nextTab.id, nextTab.title);

    // Step 1: Pause ended tab, cancel YouTube autoplay
    try {
      await chrome.scripting.executeScript({
        target: { tabId: senderTabId },
        world: "MAIN",
        func: () => {
          const v = document.querySelector("video");
          if (v) v.pause();
          const cancel = document.querySelector(".ytp-autonav-endscreen-upnext-cancel-button");
          if (cancel) cancel.click();
          const overlay = document.querySelector(".ytp-autonav-endscreen");
          if (overlay) overlay.style.display = "none";
        },
      });
    } catch (e) {}

    // Step 2: Activate next tab (forces Chrome to load the video)
    try {
      await chrome.tabs.update(nextTab.id, { active: true });
    } catch (e) {}

    // Step 3: Wait for video to be ready, then play
    let played = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 500));

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: nextTab.id },
          world: "MAIN",
          func: () => {
            const v = document.querySelector("video");
            if (!v) return "no-video";
            if (v.readyState < 2) return "not-ready";

            try {
              const p = v.play();
              if (p) {
                p.catch(() => {
                  const btn = document.querySelector(".ytp-play-button");
                  if (btn) btn.click();
                });
              }
              return "playing";
            } catch (e) {
              return "error: " + e.message;
            }
          },
        });

        const result = results[0]?.result;
        console.log("[Autoplay] Attempt", attempt, "result:", result);
        if (result === "playing") {
          played = true;
          break;
        }
      } catch (e) {
        console.error("[Autoplay] Attempt", attempt, "error:", e);
      }
    }

    if (!played) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: nextTab.id },
          world: "MAIN",
          func: () => {
            const btn = document.querySelector(".ytp-play-button");
            if (btn) btn.click();
          },
        });
      } catch (e) {}
    }

    updateExtensionIcon();
  } finally {
    setTimeout(() => { isAdvancing = false; }, 3000);
  }
}

// Handle keyboard shortcut (Alt+P)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-media") {
    const tabs = await chrome.tabs.query({ audible: true });
    if (tabs.length > 0) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: toggleMedia,
      });
      if (results && results[0]) {
        updateBadge(tabs[0].id, results[0].result);
      }
    }
  }
});

async function updateExtensionIcon() {
  const tabs = await chrome.tabs.query({ audible: true });
  const count = tabs.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
}

function updateBadge(tabId, state) {
  updateExtensionIcon();
}

function toggleMedia() {
  const elements = [...document.querySelectorAll("video, audio")];
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      elements.push(...iframe.contentDocument.querySelectorAll("video, audio"));
    } catch (e) {}
  }
  if (elements.length === 0) return "unknown";
  const anyPlaying = elements.some((el) => !el.paused);
  if (anyPlaying) {
    elements.forEach((el) => { if (!el.paused) el.pause(); });
    return "paused";
  } else {
    const resumable = elements.filter((el) => el.currentTime > 0);
    if (resumable.length > 0) {
      resumable.forEach((el) => el.play());
      return "playing";
    }
  }
  return "unknown";
}

function togglePip() {
  const video = document.querySelector("video");
  if (!video) return "no-video";
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture();
    return "exited-pip";
  } else {
    video.requestPictureInPicture();
    return "entered-pip";
  }
}

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  updateExtensionIcon();
  if (autoplayEnabled) injectMonitorIntoAllTabs();
});

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "videoEnded") {
    handleVideoEnded(sender.tab.id, message.hasPip);
    return false;
  }

  if (message.action === "getAudibleTabs") {
    chrome.tabs.query({}).then((allTabs) => {
      sendResponse(allTabs.filter((t) => t.audible || t.mutedInfo?.muted));
    });
    return true;
  }

  if (message.action === "toggleTab") {
    chrome.scripting
      .executeScript({ target: { tabId: message.tabId }, func: toggleMedia })
      .then((r) => sendResponse(r[0]?.result || "unknown"))
      .catch(() => sendResponse("error"));
    return true;
  }

  if (message.action === "togglePip") {
    chrome.scripting
      .executeScript({ target: { tabId: message.tabId }, func: togglePip })
      .then((r) => sendResponse(r[0]?.result || "error"))
      .catch(() => sendResponse("error"));
    return true;
  }

  if (message.action === "getPipState") {
    chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        func: () => !!document.pictureInPictureElement,
      })
      .then((r) => sendResponse(r[0]?.result || false))
      .catch(() => sendResponse(false));
    return true;
  }

  if (message.action === "getMediaTime") {
    chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        func: () => {
          const video = document.querySelector("video");
          if (!video || !video.duration || !isFinite(video.duration)) return null;
          return {
            current: video.currentTime,
            duration: video.duration,
            remaining: video.duration - video.currentTime,
            paused: video.paused,
          };
        },
      })
      .then((r) => sendResponse(r[0]?.result || null))
      .catch(() => sendResponse(null));
    return true;
  }

  if (message.action === "setAutoplay") {
    autoplayEnabled = message.enabled;
    chrome.storage.local.set({ autoplayEnabled });
    if (autoplayEnabled) {
      injectMonitorIntoAllTabs();
    }
    sendResponse(autoplayEnabled);
    return true;
  }

  if (message.action === "getAutoplay") {
    sendResponse(autoplayEnabled);
    return true;
  }

  if (message.action === "getMediaState") {
    chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        func: () => {
          const mediaElements = document.querySelectorAll("video, audio");
          for (const el of mediaElements) {
            if (!el.paused) return "playing";
            if (el.currentTime > 0) return "paused";
          }
          return "unknown";
        },
      })
      .then((r) => sendResponse(r[0]?.result || "unknown"))
      .catch(() => sendResponse("error"));
    return true;
  }
});
