# Tab Media Controller

A Chrome extension that lets you pause, play, and manage media across browser tabs - without switching to them. Includes Picture-in-Picture support, autoplay playlist mode, and a right-click context menu to queue videos.

## Features

- **Play/Pause from popup** - Click the extension icon to see all tabs with active media and toggle playback per tab
- **Context menu queueing** - Right-click any video link or thumbnail and select "Add to Tab Media Player" to open it in a background tab and add it to your playlist
- **Exclusive playback** - Only one video plays at a time. Playing a new video automatically pauses the current one and closes its PiP window
- **Keyboard shortcut** - Press `Alt+P` to instantly pause/play the most recent audible tab
- **Picture-in-Picture (PiP)** - Float any video in a PiP window while you work in other tabs. The PiP button stays highlighted so you always know which tab's video is in PiP mode
- **Autoplay playlist** - Enable the Autoplay toggle in the popup header to automatically play the next tab's video when the current one ends, turning your media tabs into a playlist
- **Drag to reorder** - Drag tabs by their handle to set the playlist order
- **Remaining time** - Each tab shows a live countdown of how much time is left in the video
- **Scrolling titles** - Hover over a tab title to see it scroll and reveal the full name
- **Close tabs** - Close media tabs directly from the popup
- **Tab switching** - Click a tab's title to jump to it
- **Smart detection** - Finds `<video>` and `<audio>` elements, including inside same-origin iframes
- **Badge counter** - Extension icon shows how many tabs are currently playing audio
- **Styled tooltips** - Hover over buttons for instant labels (Play, Pause, Picture in Picture, Close tab)

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `tab-media-controller` folder
5. Pin the extension to your toolbar for quick access

## Usage

| Action | How |
|---|---|
| Queue a video | Right-click a video link → **Add to Tab Media Player** |
| View all media tabs | Click the extension icon |
| Pause/Play a tab | Click the ⏸/▶ button in the popup |
| Pause/Play (shortcut) | Press `Alt+P` |
| Float video in PiP | Click the ⧉ button in the popup |
| Enable autoplay playlist | Click **Autoplay** in the popup header |
| Reorder playlist | Drag tabs by the ⠿ handle |
| Close a tab | Click the ✕ button in the popup |
| Switch to a tab | Click the tab title in the popup |

## Context Menu Queueing

Right-click any video link or thumbnail on a page and select **"Add to Tab Media Player"** to open it in a background tab without interrupting your current video. The new tab appears at the bottom of your media list and will play when the autoplay playlist reaches it, or when you manually click play.

## Picture-in-Picture

Click the PiP button (⧉) next to any tab to float its video in a mini window that stays on top while you use other tabs. The button turns blue to indicate PiP is active. Since Chrome only supports one PiP window at a time, opening a second one automatically closes the first and updates the button states accordingly.

## Exclusive Playback

Only one video plays at a time. When you play a new video, the currently playing one is automatically paused and its PiP window is closed. This keeps your media experience focused on one video at a time.

## Autoplay Playlist

Enable the **Autoplay** button in the popup header to turn your media tabs into a playlist. When a video ends, the extension automatically starts playing the next tab in order. This is useful for queuing up multiple videos or talks across tabs. Autoplay state is saved between browser sessions.

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | Query tabs for audible/muted state |
| `scripting` | Inject play/pause/PiP commands into pages |
| `activeTab` | Access the currently active tab |
| `storage` | Save autoplay preference and tab order between sessions |
| `contextMenus` | Add "Add to Tab Media Player" to the right-click menu |
| `<all_urls>` | Required for script injection on any site |

## Project Structure

```
tab-media-controller/
├── manifest.json    # Extension config (Manifest V3)
├── background.js    # Service worker - shortcuts, messaging, autoplay, PiP, context menu, exclusive playback
├── popup.html       # Popup UI and styles
├── popup.js         # Popup logic - tab listing, controls, state refresh, autoplay toggle
├── bunfig.toml      # Bun configuration (test preload)
├── package.json     # Dependencies and scripts
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── test/
    ├── setup.js          # jsdom global setup for tests
    ├── chrome-mock.js    # Chrome API mock helpers
    ├── background.test.js
    └── popup.test.js
```

## How It Works

1. When the popup opens, it queries all browser tabs and probes each one for `<video>`/`<audio>` elements. Tabs in the saved playlist order are also included even if not yet playing
2. Tabs with playing or paused media are listed with live state (play/pause, remaining time, PiP status)
3. Clicking play/pause sends a message to the background service worker, which pauses any other playing tab (exclusive playback), then uses `chrome.scripting.executeScript` to inject a toggle function into the target tab
4. The context menu "Add to Tab Media Player" opens the video URL in a background tab and appends it to the playlist order
5. PiP is toggled via `video.requestPictureInPicture()` / `document.exitPictureInPicture()` injected into the target tab
6. When Autoplay is enabled, a monitor is injected into each media tab that listens for the video `ended` event and notifies the background worker, which then plays the next tab in sequence

## Development

### Prerequisites

This project uses [Bun](https://bun.sh) as its runtime and package manager. Install it with:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Setup

```bash
bun install
```

### Running Tests

```bash
bun test
```

Watch mode:

```bash
bun test --watch
```

Tests cover the background service worker logic (message handling, context menu, tab order, media state, PiP), popup utility functions (time formatting, HTML escaping, sort order, state normalization), and manifest validation.

## Limitations

- Cannot control media inside cross-origin iframes (e.g. embedded players from different domains)
- Some sites using DRM/encrypted media or heavy shadow DOM may not respond
- Chrome only allows one PiP window at a time
- Autoplay advances tabs in saved playlist order (drag to reorder), falling back to browser tab order
- Chrome does not support hover-triggered popups - the extension icon must be clicked
- Cannot add UI elements to the browser's native tab strip
