import { computed, isReactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, api } = vi.hoisted(() => ({
  state: { value: null },
  api: { fetchFiles: vi.fn() },
}));
// The real store is reactive, which matters for what the pane may do with state.req
vi.mock("@/store", async () => {
  const { reactive } = await import("vue");
  state.value = reactive({
    req: { source: "tank", path: "/", type: "directory", items: [] },
    selected: [],
    sources: { info: { tank: {}, backup: {} } },
    pendingHighlight: null,
  });
  return { state: state.value, getters: { pickerSorting: () => ({ by: "name", asc: true }) } };
});
vi.mock("@/api", () => ({ resourcesApi: api }));
import {
  cursorHidden,
  dualPane,
  listingColumnsWidth,
  initDualPane,
  openRight,
  otherPaneContext,
  otherPaneDestination,
  paneContext,
  refreshRight,
  rightSelection,
  setActivePane,
  setDualPaneEnabled,
} from "./dualPane.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const folder = (path, names) => ({
  items: names.map((name) => ({ name, path: `${path}${name}${name.includes(".") ? "" : "/"}`, type: name.includes(".") ? "text/plain" : "directory", size: 1 })),
});
let user = 0;
const store = () => state.value;

describe("dual-pane store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    store().req = { source: "tank", path: "/", type: "directory", items: [] };
    store().selected = [];
    store().pendingHighlight = null;
    user += 1;
    initDualPane(`user${user}`);
    dualPane.shown = true;
  });

  it("applies only the latest of overlapping loads", async () => {
    const slow = deferred();
    const fast = deferred();
    api.fetchFiles.mockImplementation((source) => (source === "tank" ? slow.promise : fast.promise));
    const first = openRight("tank", "/photos");
    const second = openRight("backup", "/archive");
    fast.resolve(folder("/archive/", ["2024"]));
    await second;
    slow.resolve(folder("/photos/", ["holiday"]));
    await first;
    expect([dualPane.right.source, dualPane.right.path]).toEqual(["backup", "/archive/"]);
    expect(dualPane.right.entries.map((entry) => entry.name)).toEqual(["..", "2024"]);
    expect(dualPane.right.loading).toBe(false);
  });

  it("walks up from a saved location that no longer loads", async () => {
    api.fetchFiles.mockImplementation(async (_source, path) => {
      if (path !== "/a/") throw new Error("missing");
      return folder("/a/", ["kept"]);
    });
    await openRight("tank", "/a/b/c", { restoring: true });
    expect(api.fetchFiles.mock.calls.map(([, path]) => path)).toEqual(["/a/b/c/", "/a/b/", "/a/"]);
    expect(dualPane.right.path).toBe("/a/");
    expect(dualPane.right.error).toBe(false);
  });

  it("keeps the last listing when a later folder fails, and shows an error with nothing to fall back on", async () => {
    api.fetchFiles.mockResolvedValueOnce(folder("/docs/", ["a.txt"]));
    await openRight("tank", "/docs/");
    api.fetchFiles.mockRejectedValueOnce(new Error("gone"));
    await openRight("tank", "/gone/");
    expect(dualPane.right.path).toBe("/docs/");
    api.fetchFiles.mockRejectedValueOnce(new Error("gone"));
    await openRight("backup", "/x/");
    expect(dualPane.right).toMatchObject({ source: "backup", path: "/x/", error: true });
    expect(dualPane.right.entries.map((entry) => entry.name)).toEqual([".."]);
  });

  it("refreshes in place, keeping selection and cursor, and only marks a hidden pane stale", async () => {
    api.fetchFiles.mockResolvedValue(folder("/docs/", ["a.txt", "b.txt"]));
    await openRight("tank", "/docs/");
    rightSelection.click("/docs/b.txt", {});
    refreshRight();
    await vi.waitFor(() => expect(api.fetchFiles).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(dualPane.right.loading).toBe(false));
    expect(dualPane.right.selected).toEqual(["/docs/b.txt"]);
    expect(dualPane.right.cursor).toBe("/docs/b.txt");
    dualPane.shown = false;
    refreshRight();
    expect(api.fetchFiles).toHaveBeenCalledTimes(2);
    expect(dualPane.right.stale).toBe(true);
  });

  it("puts the cursor on a renamed item when it is in the pane's folder", async () => {
    api.fetchFiles.mockResolvedValueOnce(folder("/docs/", ["a.txt"]));
    await openRight("tank", "/docs/");
    store().pendingHighlight = { source: "tank", path: "/docs/new.txt" };
    api.fetchFiles.mockResolvedValueOnce(folder("/docs/", ["new.txt", "z.txt"]));
    refreshRight();
    await vi.waitFor(() => expect(dualPane.right.cursor).toBe("/docs/new.txt"));
    // Used once: later refreshes leave the cursor where the user put it
    rightSelection.move("end");
    api.fetchFiles.mockResolvedValueOnce(folder("/docs/", ["new.txt", "z.txt"]));
    refreshRight();
    await vi.waitFor(() => expect(api.fetchFiles).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(dualPane.right.loading).toBe(false));
    expect(dualPane.right.cursor).toBe("/docs/z.txt");
  });

  it("leaves the left listing reactive when it reuses it", () => {
    store().req = { source: "tank", path: "/docs/", type: "directory", items: folder("/docs/", ["b.txt", "a.txt"]).items };
    const order = computed(() => store().req.items.map((item) => item.name).join(","));
    expect(order.value).toBe("b.txt,a.txt");
    setDualPaneEnabled(true);
    expect(isReactive(store().req)).toBe(true);
    store().req.items = [...store().req.items].reverse();
    expect(order.value).toBe("a.txt,b.txt");
  });

  it("walks up when the folder it shows disappears", async () => {
    api.fetchFiles.mockResolvedValueOnce(folder("/a/b/", ["x.txt"]));
    await openRight("tank", "/a/b/");
    api.fetchFiles.mockRejectedValueOnce(new Error("gone"));
    api.fetchFiles.mockResolvedValueOnce(folder("/a/", ["c"]));
    refreshRight();
    await vi.waitFor(() => expect(dualPane.right.path).toBe("/a/"));
    expect(dualPane.right.entries.map((entry) => entry.name)).toEqual(["..", "c"]);
  });

  it("opens on the left pane's folder the first time, without fetching", () => {
    store().req = { source: "tank", path: "/docs", type: "directory", items: folder("/docs/", ["a.txt"]).items };
    setDualPaneEnabled(true);
    expect(api.fetchFiles).not.toHaveBeenCalled();
    expect(dualPane.right).toMatchObject({ source: "tank", path: "/docs/", loaded: true });
    expect(dualPane.right.entries.map((entry) => entry.name)).toEqual(["..", "a.txt"]);
    expect(JSON.parse(localStorage.getItem(`dualPane_user${user}`))).toMatchObject({ enabled: true, right: { source: "tank", path: "/docs/" } });
  });

  it("starts a copy or move in the pane the items are not in", async () => {
    store().req = { source: "tank", path: "/docs/", type: "directory", items: [] };
    api.fetchFiles.mockResolvedValue(folder("/x/", ["one.txt"]));
    await openRight("backup", "/x/");
    expect(otherPaneDestination([{ source: "tank", path: "/docs/a.txt" }])).toEqual({ source: "backup", path: "/x/" });
    expect(otherPaneDestination([{ source: "backup", path: "/x/one.txt" }])).toEqual({ source: "tank", path: "/docs/" });
    dualPane.shown = false;
    expect(otherPaneDestination([{ source: "tank", path: "/docs/a.txt" }])).toBeNull();
  });

  it("gives the left listing its own width to divide into columns while both panes are shown", () => {
    const sized = (element, { client = 0, offset = 0 } = {}) => {
      Object.defineProperty(element, "clientWidth", { value: client });
      Object.defineProperty(element, "offsetWidth", { value: offset });
      return element;
    };
    // #main takes in a sticky sidebar's 320px
    const main = sized(document.createElement("div"), { client: 846, offset: 846 });
    main.style.cssText = "padding-left: 320px; padding-right: 0; font-size: 16px";
    document.body.append(main);
    dualPane.shown = false;
    expect(listingColumnsWidth(main)).toBe(846);
    dualPane.shown = true;
    // Before the rows render: #main's content, less the listing's padding
    expect(listingColumnsWidth(main)).toBe(510);
    const list = sized(document.createElement("div"), { client: 517 });
    list.className = "listing-items";
    list.style.cssText = "padding-left: 8px; padding-right: 0";
    main.append(list);
    expect(listingColumnsWidth(main)).toBe(509);
    main.remove();
    dualPane.shown = false;
  });

  it("hides the cursor outline from single-click users until they use the keyboard", () => {
    state.value.user = { singleClick: false };
    dualPane.keyboardCursor = false;
    expect(cursorHidden()).toBe(false);
    state.value.user = { singleClick: true };
    expect(cursorHidden()).toBe(true);
    dualPane.keyboardCursor = true;
    expect(cursorHidden()).toBe(false);
    dualPane.keyboardCursor = false;
    delete state.value.user;
  });

  it("describes each pane's folder and the items an operation would use", async () => {
    store().req = {
      source: "tank",
      path: "/docs/",
      type: "directory",
      items: [{ name: "a.txt", path: "/docs/a.txt", type: "text/plain", size: 3 }],
    };
    store().selected = [0, { path: "/from-a-picker" }];
    api.fetchFiles.mockResolvedValue(folder("/x/", ["one.txt", "two.txt"]));
    await openRight("backup", "/x/");
    rightSelection.move("end");
    expect(paneContext("left")).toEqual({
      side: "left",
      source: "tank",
      path: "/docs/",
      items: [{ path: "/docs/a.txt", source: "tank", name: "a.txt", type: "text/plain", size: 3 }],
    });
    expect(paneContext("right").items.map((item) => item.name)).toEqual(["two.txt"]);
    setActivePane("right");
    expect(otherPaneContext().side).toBe("left");
  });
});
