const fs = require("fs");
const path = require("path");

function createChromeMock() {
  const listeners = {};
  const storage = {};

  function makeEvent(event) {
    listeners[event] = [];
    return {
      addListener: (fn) => listeners[event].push(fn),
      _fire: (...args) => listeners[event].forEach((fn) => fn(...args)),
      _get: () => listeners[event],
    };
  }

  return {
    _listeners: listeners,
    _storage: storage,
    tabs: {
      query: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ id: 1, url: "https://youtube.com", audible: false, windowId: 1 }),
      create: jest.fn().mockResolvedValue({ id: 9999 }),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
      onUpdated: makeEvent("tabs.onUpdated"),
      onRemoved: makeEvent("tabs.onRemoved"),
    },
    windows: { update: jest.fn().mockResolvedValue({}) },
    scripting: { executeScript: jest.fn().mockResolvedValue([{ result: "unknown" }]) },
    storage: {
      local: {
        get: jest.fn().mockImplementation((keys, cb) => {
          const r = {};
          for (const k of keys) r[k] = storage[k];
          if (cb) cb(r);
        }),
        set: jest.fn().mockImplementation((obj) => Object.assign(storage, obj)),
      },
    },
    runtime: {
      onInstalled: makeEvent("runtime.onInstalled"),
      onMessage: makeEvent("runtime.onMessage"),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    commands: { onCommand: makeEvent("commands.onCommand") },
    contextMenus: { create: jest.fn(), onClicked: makeEvent("contextMenus.onClicked") },
  };
}

function loadBackground(mock) {
  global.chrome = mock;
  const code = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  // Replace function declarations with global assignments so they're accessible in tests
  const patched = code
    .replace(/^function toggleMedia\(/m, "global.toggleMedia = function(")
    .replace(/^function togglePip\(/m, "global.togglePip = function(");
  eval(patched);
}

function getHandler(mock) {
  return mock._listeners["runtime.onMessage"]?.[0];
}

function sendMsg(handler, message, sender = {}) {
  return new Promise((resolve) => {
    const sr = jest.fn(resolve);
    const ret = handler(message, sender, sr);
    if (!ret) setTimeout(() => { if (!sr.mock.calls.length) resolve(undefined); }, 10);
  });
}

module.exports = { createChromeMock, loadBackground, getHandler, sendMsg };
