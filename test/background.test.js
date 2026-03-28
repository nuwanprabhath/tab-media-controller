/**
 * @jest-environment jsdom
 */
const { createChromeMock, loadBackground, getHandler, sendMsg } = require("./chrome-mock");

let cm, handler;

beforeEach(() => {
  cm = createChromeMock();
  cm.tabs.query.mockResolvedValue([]);
  cm.storage.local.get.mockImplementation((keys, cb) => cb({ autoplayEnabled: false, tabOrder: [] }));
  loadBackground(cm);
  handler = getHandler(cm);
});

afterEach(() => { jest.restoreAllMocks(); delete global.chrome; });

describe("onInstalled", () => {
  test("creates context menu", () => {
    cm.runtime.onInstalled._fire();
    expect(cm.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "add-to-tab-media-player", contexts: ["link", "video"] })
    );
  });
});

describe("context menu click", () => {
  test("opens link in background tab", async () => {
    cm.tabs.create.mockResolvedValue({ id: 999 });
    cm.contextMenus.onClicked._fire(
      { menuItemId: "add-to-tab-media-player", linkUrl: "https://youtube.com/watch?v=abc" },
      { id: 1, url: "https://youtube.com", title: "YT" }
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(cm.tabs.create).toHaveBeenCalledWith({ url: "https://youtube.com/watch?v=abc", active: false });
  });

  test("ignores other menu items", async () => {
    cm.contextMenus.onClicked._fire({ menuItemId: "other" }, { id: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(cm.tabs.create).not.toHaveBeenCalled();
  });
});

describe("tab removal", () => {
  test("cleans tab from order", async () => {
    cm.tabs.create.mockResolvedValue({ id: 555 });
    cm.contextMenus.onClicked._fire(
      { menuItemId: "add-to-tab-media-player", linkUrl: "https://example.com" }, { id: 1 }
    );
    await new Promise((r) => setTimeout(r, 50));
    cm.tabs.onRemoved._fire(555);
    expect(cm.storage.local.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabOrder: expect.not.arrayContaining([555]) })
    );
  });
});

describe("autoplay messages", () => {
  test("get/set autoplay", async () => {
    expect(await sendMsg(handler, { action: "getAutoplay" })).toBe(false);
    expect(await sendMsg(handler, { action: "setAutoplay", enabled: true })).toBe(true);
    expect(cm.storage.local.set).toHaveBeenCalledWith({ autoplayEnabled: true });
    expect(await sendMsg(handler, { action: "setAutoplay", enabled: false })).toBe(false);
  });
});

describe("tab order messages", () => {
  test("get/set tab order", async () => {
    expect(await sendMsg(handler, { action: "getTabOrder" })).toEqual([]);
    await sendMsg(handler, { action: "setTabOrder", order: [3, 1, 2] });
    expect(await sendMsg(handler, { action: "getTabOrder" })).toEqual([3, 1, 2]);
  });
});

describe("getAudibleTabs", () => {
  test("filters to audible/muted tabs", async () => {
    cm.tabs.query.mockResolvedValue([
      { id: 1, audible: true, mutedInfo: { muted: false } },
      { id: 2, audible: false, mutedInfo: { muted: true } },
      { id: 3, audible: false, mutedInfo: { muted: false } },
    ]);
    const result = await sendMsg(handler, { action: "getAudibleTabs" });
    expect(result.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("toggleTab", () => {
  test("pauses playing media without activation", async () => {
    cm.scripting.executeScript
      .mockResolvedValueOnce([{ result: "playing" }])
      .mockResolvedValueOnce([{ result: "paused" }]);
    const r = await sendMsg(handler, { action: "toggleTab", tabId: 42 });
    expect(r).toBe("paused");
    expect(cm.tabs.update).not.toHaveBeenCalledWith(42, { active: true });
  });

  test("activates tab for never-played media", async () => {
    cm.tabs.query.mockResolvedValue([]);
    cm.tabs.get.mockResolvedValue({ id: 77, windowId: 1 });
    cm.scripting.executeScript.mockResolvedValueOnce([{ result: "has-media" }]);
    const r = await sendMsg(handler, { action: "toggleTab", tabId: 77 });
    expect(r).toBe("playing");
    await new Promise((r) => setTimeout(r, 100));
    expect(cm.tabs.update).toHaveBeenCalledWith(77, { active: true });
  });
});

describe("getMediaState", () => {
  test("returns playing when audible", async () => {
    cm.tabs.get.mockResolvedValue({ id: 1, audible: true });
    cm.scripting.executeScript.mockResolvedValue([{ result: "playing" }]);
    expect(await sendMsg(handler, { action: "getMediaState", tabId: 1 })).toBe("playing");
  });

  test("downgrades to paused when not audible", async () => {
    cm.tabs.get.mockResolvedValue({ id: 1, audible: false });
    cm.scripting.executeScript.mockResolvedValue([{ result: "playing" }]);
    expect(await sendMsg(handler, { action: "getMediaState", tabId: 1 })).toBe("paused");
  });

  test("returns error on failure", async () => {
    cm.tabs.get.mockRejectedValue(new Error("No tab"));
    expect(await sendMsg(handler, { action: "getMediaState", tabId: 999 })).toBe("error");
  });
});

describe("togglePip", () => {
  test("forwards result", async () => {
    cm.scripting.executeScript.mockResolvedValue([{ result: "entered-pip" }]);
    expect(await sendMsg(handler, { action: "togglePip", tabId: 1 })).toBe("entered-pip");
  });
  test("returns error on failure", async () => {
    cm.scripting.executeScript.mockRejectedValue(new Error("fail"));
    expect(await sendMsg(handler, { action: "togglePip", tabId: 1 })).toBe("error");
  });
});

describe("getPipState", () => {
  test("returns boolean", async () => {
    cm.scripting.executeScript.mockResolvedValue([{ result: true }]);
    expect(await sendMsg(handler, { action: "getPipState", tabId: 1 })).toBe(true);
  });
});

describe("getMediaTime", () => {
  test("returns time data", async () => {
    const t = { current: 30, duration: 120, remaining: 90, paused: false };
    cm.scripting.executeScript.mockResolvedValue([{ result: t }]);
    expect(await sendMsg(handler, { action: "getMediaTime", tabId: 1 })).toEqual(t);
  });
  test("returns null when no video", async () => {
    cm.scripting.executeScript.mockResolvedValue([{ result: null }]);
    expect(await sendMsg(handler, { action: "getMediaTime", tabId: 1 })).toBeNull();
  });
});

describe("toggleMedia function", () => {
  test("returns unknown with no media", () => {
    document.body.innerHTML = "<div></div>";
    expect(global.toggleMedia()).toBe("unknown");
  });
  test("pauses playing video", () => {
    document.body.innerHTML = "<video></video>";
    const v = document.querySelector("video");
    Object.defineProperty(v, "paused", { value: false, configurable: true });
    v.pause = jest.fn();
    expect(global.toggleMedia()).toBe("paused");
    expect(v.pause).toHaveBeenCalled();
  });
  test("plays paused video", () => {
    document.body.innerHTML = "<video></video>";
    const v = document.querySelector("video");
    Object.defineProperty(v, "paused", { value: true, configurable: true });
    v.play = jest.fn().mockResolvedValue(undefined);
    expect(global.toggleMedia()).toBe("playing");
    expect(v.play).toHaveBeenCalled();
  });
});

describe("togglePip function", () => {
  test("returns no-video when no video", () => {
    document.body.innerHTML = "<div></div>";
    expect(global.togglePip()).toBe("no-video");
  });
  test("enters PiP", () => {
    document.body.innerHTML = "<video></video>";
    const v = document.querySelector("video");
    v.requestPictureInPicture = jest.fn().mockResolvedValue({});
    Object.defineProperty(document, "pictureInPictureElement", { value: null, configurable: true });
    expect(global.togglePip()).toBe("entered-pip");
  });
  test("exits PiP", () => {
    document.body.innerHTML = "<video></video>";
    const v = document.querySelector("video");
    Object.defineProperty(document, "pictureInPictureElement", { value: v, configurable: true });
    document.exitPictureInPicture = jest.fn().mockResolvedValue(undefined);
    expect(global.togglePip()).toBe("exited-pip");
  });
});
