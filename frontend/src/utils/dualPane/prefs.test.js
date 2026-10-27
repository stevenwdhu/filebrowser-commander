import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, clampRatio, loadDualPanePrefs, saveDualPanePrefs } from "./prefs.js";

describe("dual-pane prefs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips per user, normalising the path", () => {
    saveDualPanePrefs("al ice", { enabled: true, ratio: 0.4, right: { source: "tank", path: "docs" } });
    expect(localStorage.getItem("dualPane_al%20ice")).not.toBeNull();
    expect(loadDualPanePrefs("al ice")).toEqual({ enabled: true, ratio: 0.4, right: { source: "tank", path: "/docs/" } });
    expect(loadDualPanePrefs("bob")).toEqual(DEFAULT_PREFS);
  });

  it("clamps the ratio and falls back to defaults for bad data", () => {
    expect(clampRatio(0.9)).toBe(0.75);
    expect(clampRatio(0.1)).toBe(0.25);
    expect(clampRatio("x")).toBe(0.5);
    localStorage.setItem("dualPane_alice", "{not json");
    expect(loadDualPanePrefs("alice")).toEqual(DEFAULT_PREFS);
    localStorage.setItem("dualPane_alice", JSON.stringify({ enabled: "yes", ratio: 3, right: { source: 1 } }));
    expect(loadDualPanePrefs("alice")).toEqual({ enabled: false, ratio: 0.75, right: null });
  });

  it("drops a saved location in a source that no longer exists", () => {
    saveDualPanePrefs("alice", { enabled: true, ratio: 0.5, right: { source: "old", path: "/" } });
    expect(loadDualPanePrefs("alice", (source) => source === "tank").right).toBeNull();
  });

  it("keeps nothing for anonymous users and survives storage errors", () => {
    saveDualPanePrefs("anonymous", { enabled: true, ratio: 0.5, right: null });
    saveDualPanePrefs("", { enabled: true, ratio: 0.5, right: null });
    expect(localStorage.length).toBe(0);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => saveDualPanePrefs("alice", { enabled: true, ratio: 0.5, right: null })).not.toThrow();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadDualPanePrefs("alice")).toEqual(DEFAULT_PREFS);
  });
});
