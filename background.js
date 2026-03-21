// Handle keyboard shortcut (Alt+P) to toggle media in most recent audible tab
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-media") {
    const tabs = await chrome.tabs.query({ audible: true });
    if (tabs.length > 0) {
      // Toggle media in the most recently audible tab
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: toggleMedia,
      });
      // Update badge to reflect state
      if (results && results[0]) {
        updateBadge(tabs[0].id, results[0].result);
      }
    }
  }
});

// Listen for tab audio state changes to update badge
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible !== undefined) {
    updateExtensionIcon();
  }
});

// Update the extension badge to show count of audible tabs
async function updateExtensionIcon() {
  const tabs = await chrome.tabs.query({ audible: true });
  const count = tabs.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
}

function updateBadge(tabId, state) {
  // state: "paused" or "playing"
  updateExtensionIcon();
}

// Injected into target tab to toggle media playback
// IMPORTANT: This function must be fully self-contained because
// chrome.scripting.executeScript serializes only this function into the page context.
function toggleMedia() {
  // Collect all media elements including same-origin iframes
  const elements = [...document.querySelectorAll("video, audio")];
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      elements.push(...iframe.contentDocument.querySelectorAll("video, audio"));
    } catch (e) {
      // Cross-origin iframe, can't access
    }
  }

  if (elements.length === 0) return "unknown";

  const anyPlaying = elements.some((el) => !el.paused);

  if (anyPlaying) {
    elements.forEach((el) => { if (!el.paused) el.pause(); });
    return "paused";
  } else {
    // Resume elements that were previously playing (have progress)
    const resumable = elements.filter((el) => el.currentTime > 0);
    if (resumable.length > 0) {
      resumable.forEach((el) => el.play());
      return "playing";
    }
  }

  return "unknown";
}

// Initialize badge on install
chrome.runtime.onInstalled.addListener(() => {
  updateExtensionIcon();
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getAudibleTabs") {
    chrome.tabs.query({}).then((allTabs) => {
      // Return tabs that are audible or have been recently audible
      const mediaTabs = allTabs.filter(
        (tab) => tab.audible || tab.mutedInfo?.muted
      );
      sendResponse(mediaTabs);
    });
    return true; // async response
  }

  if (message.action === "toggleTab") {
    chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        func: toggleMedia,
      })
      .then((results) => {
        sendResponse(results[0]?.result || "unknown");
      })
      .catch((err) => {
        sendResponse("error");
      });
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
      .then((results) => {
        sendResponse(results[0]?.result || "unknown");
      })
      .catch(() => {
        sendResponse("error");
      });
    return true;
  }
});
