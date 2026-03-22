const content = document.getElementById("content");

const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
const PIP_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>`;

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `-${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `-${m}:${String(sec).padStart(2, "0")}`;
}

// Track intervals so we can clean up
const timeIntervals = [];

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

  let pipActive = false;
  try {
    pipActive = await chrome.runtime.sendMessage({ action: "getPipState", tabId: tab.id });
  } catch (e) {
    // ignore
  }

  const favicon = tab.favIconUrl || "";
  const hostname = tab.url ? new URL(tab.url).hostname : "";

  li.innerHTML = `
    <div class="status-dot ${state}"></div>
    <span class="remaining-time" data-tab-id="${tab.id}"></span>
    ${favicon ? `<img class="tab-favicon" src="${escapeHtml(favicon)}" alt="">` : `<div class="tab-favicon"></div>`}
    <div class="tab-info">
      <div class="tab-title"><span class="scroll-inner">${escapeHtml(tab.title || "Untitled")}</span></div>
      <div class="tab-url">${escapeHtml(hostname)}</div>
    </div>
    <div class="tab-controls">
      <button class="btn btn-toggle ${state === "paused" ? "paused" : ""}" data-tab-id="${tab.id}" data-tooltip="${state === "playing" ? "Pause" : "Play"}">
        ${state === "playing" ? PAUSE_ICON : PLAY_ICON}
      </button>
      <button class="btn btn-pip ${pipActive ? "active" : ""}" data-tab-id="${tab.id}" data-tooltip="${pipActive ? "Exit PiP" : "Picture in Picture"}">
        ${PIP_ICON}
      </button>
      <button class="btn btn-close" data-tab-id="${tab.id}" data-tooltip="Close tab">
        ${CLOSE_ICON}
      </button>
    </div>
  `;

  // Mark overflowing title for scroll animation
  const titleEl = li.querySelector(".tab-title");
  requestAnimationFrame(() => {
    const inner = titleEl.querySelector(".scroll-inner");
    const overflow = inner.scrollWidth - titleEl.clientWidth;
    if (overflow > 0) {
      titleEl.classList.add("overflowing");
      titleEl.style.setProperty("--scroll-distance", `-${overflow}px`);
      const duration = Math.max(3, overflow / 30);
      titleEl.style.setProperty("--scroll-duration", `${duration}s`);
    }
  });

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

  // Picture in Picture
  li.querySelector(".btn-pip").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;

    const result = await chrome.runtime.sendMessage({
      action: "togglePip",
      tabId: tab.id,
    });

    if (result === "no-video") {
      btn.dataset.tooltip = "No video found";
      setTimeout(() => { btn.dataset.tooltip = "Picture in Picture"; }, 1500);
    } else if (result === "entered-pip") {
      // Chrome only allows one PiP at a time — deactivate all others
      document.querySelectorAll(".btn-pip.active").forEach((other) => {
        other.classList.remove("active");
        other.dataset.tooltip = "Picture in Picture";
      });
      btn.classList.add("active");
      btn.dataset.tooltip = "Exit PiP";
    } else if (result === "exited-pip") {
      btn.classList.remove("active");
      btn.dataset.tooltip = "Picture in Picture";
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

  // Periodic state refresh (time, play state, pip state)
  const timeEl = li.querySelector(".remaining-time");
  const dot = li.querySelector(".status-dot");
  const toggleBtn = li.querySelector(".btn-toggle");
  const pipBtn = li.querySelector(".btn-pip");

  async function refreshState() {
    try {
      // Update remaining time
      const time = await chrome.runtime.sendMessage({ action: "getMediaTime", tabId: tab.id });
      if (time && time.remaining >= 0) {
        timeEl.textContent = formatTime(time.remaining);
      } else {
        timeEl.textContent = "";
      }

      // Update play/pause state
      const mediaState = await chrome.runtime.sendMessage({ action: "getMediaState", tabId: tab.id });
      if (mediaState === "playing" || mediaState === "paused") {
        dot.className = `status-dot ${mediaState}`;
        toggleBtn.className = `btn btn-toggle ${mediaState === "paused" ? "paused" : ""}`;
        toggleBtn.dataset.tooltip = mediaState === "playing" ? "Pause" : "Play";
        toggleBtn.innerHTML = mediaState === "playing" ? PAUSE_ICON : PLAY_ICON;
      }

      // Update PiP state
      const pipState = await chrome.runtime.sendMessage({ action: "getPipState", tabId: tab.id });
      if (pipState) {
        pipBtn.classList.add("active");
        pipBtn.dataset.tooltip = "Exit PiP";
      } else {
        pipBtn.classList.remove("active");
        pipBtn.dataset.tooltip = "Picture in Picture";
      }
    } catch (e) {
      // tab may have been closed
    }
  }
  refreshState();
  const interval = setInterval(refreshState, 1500);
  timeIntervals.push(interval);

  return li;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Autoplay toggle
const autoplayBtn = document.getElementById("autoplay-toggle");

async function initAutoplay() {
  const enabled = await chrome.runtime.sendMessage({ action: "getAutoplay" });
  if (enabled) {
    autoplayBtn.classList.add("active");
    autoplayBtn.dataset.tooltip = "Autoplay is ON — click to disable";
  }
}

autoplayBtn.addEventListener("click", async () => {
  const isActive = autoplayBtn.classList.contains("active");
  const newState = await chrome.runtime.sendMessage({ action: "setAutoplay", enabled: !isActive });

  if (newState) {
    autoplayBtn.classList.add("active");
    autoplayBtn.dataset.tooltip = "Autoplay is ON — click to disable";
  } else {
    autoplayBtn.classList.remove("active");
    autoplayBtn.dataset.tooltip = "Auto-play next video when current ends";
  }
});

// Initial load
initAutoplay();
loadTabs();
