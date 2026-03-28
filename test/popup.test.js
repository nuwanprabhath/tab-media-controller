/** @jest-environment happy-dom */
// ============================================================
// Pure function tests extracted from popup.js
// ============================================================

describe("formatTime", () => {
  // Re-implement to test (same logic as popup.js)
  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `-${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `-${m}:${String(sec).padStart(2, "0")}`;
  }

  test("formats seconds only", () => {
    expect(formatTime(45)).toBe("-0:45");
  });

  test("formats minutes and seconds", () => {
    expect(formatTime(125)).toBe("-2:05");
  });

  test("formats hours", () => {
    expect(formatTime(3661)).toBe("-1:01:01");
  });

  test("handles zero", () => {
    expect(formatTime(0)).toBe("-0:00");
  });

  test("handles exact minute boundary", () => {
    expect(formatTime(60)).toBe("-1:00");
  });

  test("handles exact hour boundary", () => {
    expect(formatTime(3600)).toBe("-1:00:00");
  });

  test("floors fractional seconds", () => {
    expect(formatTime(45.9)).toBe("-0:45");
  });
});

describe("escapeHtml", () => {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  test("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).not.toContain("<script>");
  });

  test("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("handles quotes safely", () => {
    const result = escapeHtml('"hello"');
    expect(typeof result).toBe("string");
    expect(result).toContain("hello");
  });

  test("returns empty for empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  test("passes through plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

// ============================================================
// Media state normalization
// ============================================================
describe("media state normalization", () => {
  function normalizeState(state) {
    if (state !== "playing" && state !== "paused") return "paused";
    return state;
  }

  test("keeps 'playing' as is", () => {
    expect(normalizeState("playing")).toBe("playing");
  });

  test("keeps 'paused' as is", () => {
    expect(normalizeState("paused")).toBe("paused");
  });

  test("normalizes 'unknown' to 'paused'", () => {
    expect(normalizeState("unknown")).toBe("paused");
  });

  test("normalizes 'error' to 'paused'", () => {
    expect(normalizeState("error")).toBe("paused");
  });

  test("normalizes undefined to 'paused'", () => {
    expect(normalizeState(undefined)).toBe("paused");
  });
});

// ============================================================
// Tab sorting logic (savedOrder tabs at bottom)
// ============================================================
describe("tab sorting with savedOrder", () => {
  function sortTabs(mediaTabs, savedOrder) {
    if (savedOrder && savedOrder.length > 0) {
      mediaTabs.sort((a, b) => {
        const ai = savedOrder.indexOf(a.id);
        const bi = savedOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return -1;
        if (bi === -1) return 1;
        return ai - bi;
      });
    }
    return mediaTabs;
  }

  test("tabs NOT in savedOrder come first", () => {
    const tabs = [{ id: 5 }, { id: 1 }, { id: 3 }];
    const order = [5]; // only tab 5 in saved order
    const sorted = sortTabs(tabs, order);

    // tabs 1 and 3 (not in order) should come before tab 5
    expect(sorted[sorted.length - 1].id).toBe(5);
  });

  test("saved order tabs maintain relative order at bottom", () => {
    const tabs = [{ id: 3 }, { id: 1 }, { id: 2 }, { id: 4 }];
    const order = [2, 3]; // tab 2 before tab 3 in saved order
    const sorted = sortTabs(tabs, order);

    const orderIndices = sorted.map((t) => t.id);
    const idx2 = orderIndices.indexOf(2);
    const idx3 = orderIndices.indexOf(3);
    expect(idx2).toBeLessThan(idx3);
    // Non-saved tabs come first
    expect(orderIndices.indexOf(1)).toBeLessThan(idx2);
    expect(orderIndices.indexOf(4)).toBeLessThan(idx2);
  });

  test("empty savedOrder preserves original order", () => {
    const tabs = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const sorted = sortTabs(tabs, []);
    expect(sorted.map((t) => t.id)).toEqual([3, 1, 2]);
  });

  test("null savedOrder preserves original order", () => {
    const tabs = [{ id: 3 }, { id: 1 }];
    const sorted = sortTabs(tabs, null);
    expect(sorted.map((t) => t.id)).toEqual([3, 1]);
  });

  test("all tabs in savedOrder sorts by that order", () => {
    const tabs = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const order = [2, 3, 1];
    const sorted = sortTabs(tabs, order);
    expect(sorted.map((t) => t.id)).toEqual([2, 3, 1]);
  });
});

// ============================================================
// Stale tab cleanup logic
// ============================================================
describe("stale tab ID cleanup", () => {
  function cleanupStaleIds(savedOrder, allTabIds) {
    const validIds = new Set(allTabIds);
    return savedOrder.filter((id) => validIds.has(id));
  }

  test("removes IDs not in allTabIds", () => {
    const result = cleanupStaleIds([1, 2, 3, 4], [1, 3]);
    expect(result).toEqual([1, 3]);
  });

  test("returns empty when all IDs are stale", () => {
    const result = cleanupStaleIds([10, 20], [1, 2]);
    expect(result).toEqual([]);
  });

  test("returns all when none are stale", () => {
    const result = cleanupStaleIds([1, 2, 3], [1, 2, 3, 4]);
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles empty savedOrder", () => {
    const result = cleanupStaleIds([], [1, 2]);
    expect(result).toEqual([]);
  });
});

// ============================================================
// Manifest validation
// ============================================================
describe("manifest.json", () => {
  const manifest = require("../manifest.json");

  test("is manifest v3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test("has required permissions", () => {
    expect(manifest.permissions).toContain("tabs");
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).toContain("contextMenus");
  });

  test("has background service worker", () => {
    expect(manifest.background.service_worker).toBe("background.js");
  });

  test("has popup defined", () => {
    expect(manifest.action.default_popup).toBe("popup.html");
  });

  test("has Alt+P keyboard shortcut", () => {
    expect(manifest.commands["toggle-media"].suggested_key.mac).toBe("Alt+P");
  });

  test("has host_permissions for all URLs", () => {
    expect(manifest.host_permissions).toContain("<all_urls>");
  });
});
