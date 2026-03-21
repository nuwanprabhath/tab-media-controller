# Tab Media Controller

A Chrome extension that lets you pause, play, and manage media across browser tabs - without switching to them.

## Features

- **Play/Pause from popup** - Click the extension icon to see all tabs with active media and toggle playback per tab
- **Keyboard shortcut** - Press `Alt+P` to instantly pause/play the most recent audible tab
- **Close tabs** - Close media tabs directly from the popup
- **Tab switching** - Click a tab's title to jump to it
- **Smart detection** - Finds `<video>` and `<audio>` elements, including inside same-origin iframes
- **Badge counter** - Extension icon shows how many tabs are currently playing audio
- **Styled tooltips** - Hover over buttons for instant labels (Play, Pause, Close tab)

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `tab-media-controller` folder
5. Pin the extension to your toolbar for quick access

## Usage

| Action | How |
|---|---|
| View all media tabs | Click the extension icon |
| Pause/Play a tab | Click the ⏸/▶ button in the popup |
| Pause/Play (shortcut) | Press `Alt+P` |
| Close a tab | Click the ✕ button in the popup |
| Switch to a tab | Click the tab title in the popup |

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | Query tabs for audible/muted state |
| `scripting` | Inject play/pause commands into pages |
| `activeTab` | Access the currently active tab |
| `<all_urls>` | Required for script injection on any site |

## Project Structure

```
tab-media-controller/
├── manifest.json    # Extension config (Manifest V3)
├── background.js    # Service worker - handles shortcuts, messaging, script injection
├── popup.html       # Popup UI and styles
├── popup.js         # Popup logic - tab listing, controls, state management
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## How It Works

1. When the popup opens, it queries all browser tabs and probes each one for `<video>`/`<audio>` elements
2. Tabs with playing or paused media are listed with their current state
3. Clicking play/pause sends a message to the background service worker, which uses `chrome.scripting.executeScript` to inject a toggle function into the target tab
4. The injected function finds all media elements and pauses them (if any are playing) or resumes them (if all are paused)

## Limitations

- Cannot control media inside cross-origin iframes (e.g., embedded players from different domains)
- Some sites using DRM/encrypted media or heavy shadow DOM may not respond
- Chrome does not support hover-triggered popups - the extension icon must be clicked
- Cannot add UI elements to the browser's native tab strip
