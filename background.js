// ---- Autoplay playlist logic ----
let autoplayEnabled = false;
let isAdvancing = false;
const injectedTabs = new Set();
let customTabOrder = []; // user-defined playlist order (tab IDs)
// Load saved state and clean up stale tab IDs
chrome.storage.local.get(["autoplayEnabled", "tabOrder"], async (data) => {
  autoplayEnabled = !!data.autoplayEnabled;
  customTabOrder = data.tabOrder || [];

  // Remove tab IDs that no longer exist (stale from previous sessions)
  if (customTabOrder.length > 0) {
    const allTabs = await chrome.tabs.query({});
    const validIds = new Set(allTabs.map((t) => t.id));
    const cleaned = customTabOrder.filter((id) => validIds.has(id));
    if (cleaned.length !== customTabOrder.length) {
      customTabOrder = cleaned;
      chrome.storage.local.set({ tabOrder: customTabOrder });
    }
  }

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
  customTabOrder = customTabOrder.filter((id) => id !== tabId);
  chrome.storage.local.set({ tabOrder: customTabOrder });
});

// Get ordered list of tabs that have a video element, respecting custom order
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

  // Sort by custom order if set
  if (customTabOrder.length > 0) {
    videoTabs.sort((a, b) => {
      const ai = customTabOrder.indexOf(a.id);
      const bi = customTabOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
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
    // Play the first available media element (even if it hasn't played before)
    if (elements.length > 0) {
      elements[0].play().catch(() => {
        // Try clicking YouTube's play button as fallback
        const btn = document.querySelector(".ytp-play-button");
        if (btn) btn.click();
      });
      return "playing";
    }
  }
  return "unknown";
}

// Pause media and exit PiP in all tabs except the given one
async function pauseOtherTabs(exceptTabId) {
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.id === exceptTabId) continue;
    if (!tab.audible) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Exit PiP if active on this tab
          if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
          }
          document.querySelectorAll("video, audio").forEach((el) => {
            if (!el.paused) el.pause();
          });
        },
      });
    } catch (e) {}
  }
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

  // Create context menu for videos
  chrome.contextMenus.create({
    id: "add-to-tab-media-player",
    title: "Add to Tab Media Player",
    contexts: ["link", "video"],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "add-to-tab-media-player") {
    const url = info.linkUrl || (tab && tab.url) || "";
    if (!url) return;

    // Open in a new background tab (active: false so current video keeps playing)
    const newTab = await chrome.tabs.create({ url, active: false });

    // Add to the end of the custom tab order so autoplay reaches it last
    customTabOrder.push(newTab.id);
    chrome.storage.local.set({ tabOrder: customTabOrder });
  }
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
    (async () => {
      try {
        // Check actual media state in the tab
        let mediaState = "no-media";
        try {
          const r = await chrome.scripting.executeScript({
            target: { tabId: message.tabId },
            func: () => {
              const els = document.querySelectorAll("video, audio");
              for (const el of els) {
                if (!el.paused) return "playing";
                if (el.currentTime > 0) return "paused";
              }
              return els.length > 0 ? "has-media" : "no-media";
            },
          });
          mediaState = r[0]?.result || "no-media";
        } catch (e) {}

        if (mediaState === "playing" || mediaState === "paused") {
          // If we're about to play (currently paused), pause all others first
          if (mediaState === "paused") {
            await pauseOtherTabs(message.tabId);
          }
          // Tab has interactable media — toggle it directly
          const r = await chrome.scripting.executeScript({
            target: { tabId: message.tabId }, func: toggleMedia,
          });
          sendResponse(r[0]?.result || "unknown");
        } else {
          // Tab has never-played media or no media yet.
          // Pause all other tabs before playing this one.
          await pauseOtherTabs(message.tabId);
          // Respond immediately (popup may close when we activate the tab).
          sendResponse("playing");

          // Activate tab, then explicitly play the video after it's ready.
          const tab = await chrome.tabs.get(message.tabId);
          await chrome.tabs.update(message.tabId, { active: true });
          if (tab.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }

          // Retry playing with increasing delays (tab may need time to load)
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((r) => setTimeout(r, 500 + attempt * 500));
            try {
              const r = await chrome.scripting.executeScript({
                target: { tabId: message.tabId },
                world: "MAIN",
                func: () => {
                  const v = document.querySelector("video");
                  if (!v) return "no-video";
                  if (!v.paused) return "already-playing";
                  try {
                    v.play();
                    return "playing";
                  } catch (e) {
                    // Try YouTube play button as fallback
                    const btn = document.querySelector(".ytp-play-button");
                    if (btn) { btn.click(); return "clicked-yt"; }
                    return "failed";
                  }
                },
              });
              const result = r[0]?.result;
              if (result === "playing" || result === "already-playing" || result === "clicked-yt") break;
            } catch (e) {}
          }
        }
      } catch (e) {
        try { sendResponse("error"); } catch (_) {}
      }
    })();
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

  if (message.action === "setTabOrder") {
    customTabOrder = message.order || [];
    chrome.storage.local.set({ tabOrder: customTabOrder });
    sendResponse(true);
    return true;
  }

  if (message.action === "getTabOrder") {
    sendResponse(customTabOrder);
    return true;
  }

  if (message.action === "getMediaState") {
    (async () => {
      try {
        // Check if the tab is actually audible — the most reliable "playing" signal
        const tab = await chrome.tabs.get(message.tabId);
        const r = await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          func: () => {
            const mediaElements = document.querySelectorAll("video, audio");
            for (const el of mediaElements) {
              if (!el.paused) return "playing";
              if (el.currentTime > 0) return "paused";
            }
            return "unknown";
          },
        });
        let state = r[0]?.result || "unknown";
        // If script says "playing" but tab isn't audible, it's likely a background tab
        // where YouTube auto-started but audio isn't actually flowing
        if (state === "playing" && !tab.audible) {
          state = "paused";
        }
        sendResponse(state);
      } catch (e) {
        sendResponse("error");
      }
    })();
    return true;
  }
});
