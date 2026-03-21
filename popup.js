const content = document.getElementById("content");

const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

async function loadTabs() {
  // Get all tabs, then check which ones have media
  const allTabs = await chrome.tabs.query({});
  const mediaTabs = [];

  for (const tab of allTabs) {
    if (tab.audible || tab.mutedInfo?.muted) {
      mediaTabs.push(tab);
    }
  }

  // Also probe non-audible tabs for paused media
  const probeTabs = allTabs.filter(
    (t) => !t.audible && !t.mutedInfo?.muted && t.url && !t.url.startsWith("chrome://")
  );

  const probeResults = await Promise.allSettled(
    probeTabs.map((tab) =>
      chrome.runtime.sendMessage({ action: "getMediaState", tabId: tab.id }).then((state) => ({
        tab,
        state,
      }))
    )
  );

  for (const result of probeResults) {
    if (result.status === "fulfilled" && result.value.state === "paused") {
      mediaTabs.push(result.value.tab);
    }
  }

  if (mediaTabs.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔇</div>
        <p>No tabs are playing media right now.<br>Start a video or audio in any tab.</p>
      </div>
    `;
    return;
  }

  const list = document.createElement("ul");
  list.className = "tab-list";

  for (const tab of mediaTabs) {
    const item = await createTabItem(tab);
    list.appendChild(item);
  }

  content.innerHTML = "";
  content.appendChild(list);
}

async function createTabItem(tab) {
  const li = document.createElement("li");
  li.className = "tab-item";

  // Get actual media state by probing the tab
  let state = "unknown";
  try {
    state = await chrome.runtime.sendMessage({ action: "getMediaState", tabId: tab.id });
  } catch (e) {
    // ignore
  }
  // Only fall back to audible hint if probe returned unknown
  if (state === "unknown" && tab.audible) state = "playing";

  const favicon = tab.favIconUrl || "";
  const hostname = tab.url ? new URL(tab.url).hostname : "";

  li.innerHTML = `
    <div class="status-dot ${state}"></div>
    ${favicon ? `<img class="tab-favicon" src="${escapeHtml(favicon)}" alt="">` : `<div class="tab-favicon"></div>`}
    <div class="tab-info">
      <div class="tab-title">${escapeHtml(tab.title || "Untitled")}</div>
      <div class="tab-url">${escapeHtml(hostname)}</div>
    </div>
    <div class="tab-controls">
      <button class="btn btn-toggle ${state === "paused" ? "paused" : ""}" data-tab-id="${tab.id}" data-tooltip="${state === "playing" ? "Pause" : "Play"}">
        ${state === "playing" ? PAUSE_ICON : PLAY_ICON}
      </button>
      <button class="btn btn-close" data-tab-id="${tab.id}" data-tooltip="Close tab">
        ${CLOSE_ICON}
      </button>
    </div>
  `;

  // Click tab info to switch to that tab
  li.querySelector(".tab-info").addEventListener("click", () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });

  // Toggle play/pause
  li.querySelector(".btn-toggle").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;

    const newState = await chrome.runtime.sendMessage({
      action: "toggleTab",
      tabId: tab.id,
    });

    // Update this item's UI immediately based on the returned state
    if (newState === "paused" || newState === "playing") {
      const dot = li.querySelector(".status-dot");
      dot.className = `status-dot ${newState}`;
      btn.className = `btn btn-toggle ${newState === "paused" ? "paused" : ""}`;
      btn.dataset.tooltip = newState === "playing" ? "Pause" : "Play";
      btn.innerHTML = newState === "playing" ? PAUSE_ICON : PLAY_ICON;
    }

    btn.disabled = false;
  });

  // Close tab
  li.querySelector(".btn-close").addEventListener("click", async () => {
    await chrome.tabs.remove(tab.id);
    li.style.transition = "opacity 0.2s, max-height 0.2s";
    li.style.opacity = "0";
    li.style.maxHeight = "0";
    li.style.overflow = "hidden";
    li.style.padding = "0 16px";
    setTimeout(() => {
      li.remove();
      // Show empty state if no tabs left
      const remaining = document.querySelectorAll(".tab-item");
      if (remaining.length === 0) {
        content.innerHTML = `
          <div class="empty-state">
            <div class="icon">🔇</div>
            <p>No tabs are playing media right now.<br>Start a video or audio in any tab.</p>
          </div>
        `;
      }
    }, 200);
  });

  return li;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Initial load
loadTabs();
