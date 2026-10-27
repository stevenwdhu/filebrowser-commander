import { describe, expect, it } from "vitest";
import {
  breadcrumbSegments,
  buildEntries,
  childName,
  clickSelect,
  moveCursor,
  operationTargets,
  paneSummary,
  parentDir,
  reconcileAfterLoad,
  selectAll,
  toggleMarkAndAdvance,
} from "./paneModel.js";

const listing = {
  source: "tank",
  items: [
    { name: "b.txt", path: "/docs/b.txt", type: "text/plain", size: 2 },
    { name: "Zed", path: "/docs/Zed/", type: "directory", size: 10 },
    { name: "a.txt", path: "/docs/a.txt", type: "text/plain", size: 1 },
    { name: "alpha", path: "/docs/alpha/", type: "directory", size: 5 },
  ],
};
const entries = buildEntries(listing, { by: "name", asc: true }, "/docs", "tank");
const model = (extra = {}) => ({ entries, cursor: null, selected: [], anchor: null, ...extra });
const names = (paths) => paths.map((path) => entries.find((entry) => entry.path === path)?.name);

describe("paths", () => {
  it("finds parents, names and breadcrumb segments", () => {
    expect(parentDir("/a/b/")).toBe("/a/");
    expect(parentDir("/a/file.txt")).toBe("/a/");
    expect(parentDir("/a")).toBe("/");
    expect(parentDir("/")).toBe("/");
    expect(childName("/a/b c/")).toBe("b c");
    expect(breadcrumbSegments("/a/b #1/ü/")).toEqual([
      { name: "a", path: "/a/" },
      { name: "b #1", path: "/a/b #1/" },
      { name: "ü", path: "/a/b #1/ü/" },
    ]);
    expect(breadcrumbSegments("/")).toEqual([]);
  });
});

describe("buildEntries", () => {
  it("lists '..' first below the root, then folders, then files", () => {
    expect(entries.map((entry) => entry.name)).toEqual(["..", "alpha", "Zed", "a.txt", "b.txt"]);
    expect(entries[0]).toMatchObject({ path: "/", type: "directory", isParent: true, source: "tank" });
    expect(buildEntries(listing, { by: "name", asc: true }, "/", "tank")[0].name).toBe("alpha");
  });

  it("sorts within folders and files by the given field", () => {
    const bySize = buildEntries(listing, { by: "size", asc: false }, "/docs/", "tank");
    expect(bySize.map((entry) => entry.name)).toEqual(["..", "Zed", "alpha", "b.txt", "a.txt"]);
  });
});

describe("cursor and selection", () => {
  it("moves the cursor with the selection following it, clamped at the ends", () => {
    let state = model();
    state = { ...state, ...moveCursor(state, 1) };
    expect(state.cursor).toBe("/");
    expect(state.selected).toEqual([]); // ".." is never selected
    state = { ...state, ...moveCursor(state, 2) };
    expect(names([state.cursor])).toEqual(["Zed"]);
    expect(names(state.selected)).toEqual(["Zed"]);
    state = { ...state, ...moveCursor(state, 10) };
    expect(names([state.cursor])).toEqual(["b.txt"]);
    state = { ...state, ...moveCursor(state, "home") };
    expect(state.cursor).toBe("/");
    state = { ...state, ...moveCursor(state, "end") };
    expect(names([state.cursor])).toEqual(["b.txt"]);
  });

  it("extends a range from the anchor with Shift", () => {
    let state = model({ cursor: "/docs/alpha/", anchor: "/docs/alpha/", selected: ["/docs/alpha/"] });
    state = { ...state, ...moveCursor(state, 2, { extend: true }) };
    expect(names(state.selected)).toEqual(["alpha", "Zed", "a.txt"]);
    state = { ...state, ...moveCursor(state, -3, { extend: true }) };
    expect(names(state.selected)).toEqual(["alpha"]); // ".." is left out of ranges
  });

  it("clicks select one row, toggle with Ctrl, select ranges with Shift and deselect on re-click", () => {
    let state = model();
    state = { ...state, ...clickSelect(state, "/docs/Zed/") };
    expect(names(state.selected)).toEqual(["Zed"]);
    state = { ...state, ...clickSelect(state, "/docs/b.txt", { ctrl: true }) };
    expect(names(state.selected)).toEqual(["Zed", "b.txt"]);
    state = { ...state, ...clickSelect(state, "/docs/Zed/", { ctrl: true }) };
    expect(names(state.selected)).toEqual(["b.txt"]);
    // The last Ctrl-clicked row anchors the range
    state = { ...state, ...clickSelect(state, "/docs/b.txt", { shift: true }) };
    expect(names(state.selected)).toEqual(["Zed", "a.txt", "b.txt"]);
    state = { ...state, ...clickSelect(state, "/docs/a.txt") };
    state = { ...state, ...clickSelect(state, "/docs/a.txt") };
    expect(state.selected).toEqual([]);
    expect(clickSelect(state, "/missing")).toEqual({});
  });

  it("marks with Insert and moves down", () => {
    let state = model({ cursor: "/docs/alpha/" });
    state = { ...state, ...toggleMarkAndAdvance(state) };
    state = { ...state, ...toggleMarkAndAdvance(state) };
    expect(names(state.selected)).toEqual(["alpha", "Zed"]);
    expect(names([state.cursor])).toEqual(["a.txt"]);
    state = { ...state, ...toggleMarkAndAdvance({ ...state, cursor: "/docs/alpha/" }) };
    expect(names(state.selected)).toEqual(["Zed"]);
  });

  it("selects all rows but '..', and operates on the selection or else the cursor row", () => {
    expect(selectAll(model()).selected).toHaveLength(4);
    expect(operationTargets(model({ cursor: "/docs/a.txt" })).map((entry) => entry.name)).toEqual(["a.txt"]);
    expect(operationTargets(model({ cursor: "/" }))).toEqual([]);
    const targets = operationTargets(model({ cursor: "/docs/a.txt", selected: ["/docs/b.txt", "/docs/alpha/"] }));
    expect(targets.map((entry) => entry.name)).toEqual(["alpha", "b.txt"]);
  });
});

describe("reconcileAfterLoad", () => {
  it("keeps selected paths that still exist and the cursor where it was", () => {
    const previous = model({ cursor: "/docs/b.txt", selected: ["/docs/b.txt", "/docs/gone.txt"], anchor: "/docs/b.txt" });
    expect(reconcileAfterLoad(previous, entries)).toEqual({
      cursor: "/docs/b.txt",
      selected: ["/docs/b.txt"],
      anchor: "/docs/b.txt",
    });
  });

  it("moves the cursor to a named row, or keeps its position when its row is gone", () => {
    expect(reconcileAfterLoad(model(), entries, { focusName: "Zed" }).cursor).toBe("/docs/Zed/");
    const shorter = entries.slice(0, 3);
    expect(reconcileAfterLoad(model({ cursor: "/docs/b.txt" }), shorter).cursor).toBe("/docs/Zed/");
    expect(reconcileAfterLoad(model(), []).cursor).toBeNull();
  });
});

describe("paneSummary", () => {
  it("counts folders, files and sizes, without '..'", () => {
    expect(paneSummary(entries, ["/docs/a.txt", "/docs/Zed/"])).toEqual({
      dirs: 2,
      files: 2,
      bytes: 18,
      selectedCount: 2,
      selectedBytes: 11,
    });
  });
});
