import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, mutations, api, perms } = vi.hoisted(() => ({
  perms: { modify: true, download: true },
  state: {
    req: { source: "tank", path: "/left/", type: "directory", items: [{ name: "a.txt", path: "/left/a.txt", type: "text/plain", size: 1 }] },
    selected: [0],
    sources: { info: { tank: {}, backup: {} } },
  },
  mutations: { showPrompt: vi.fn() },
  api: { fetchFiles: vi.fn() },
}));
vi.mock("@/store/index.ts", () => ({
  state,
  getters: { pickerSorting: () => ({ by: "name", asc: true }), sourcePermissions: () => perms },
  mutations,
}));
vi.mock("@/store", () => ({
  state,
  getters: { pickerSorting: () => ({ by: "name", asc: true }), sourcePermissions: () => perms },
  mutations,
}));
vi.mock("@/api", () => ({ resourcesApi: api }));
vi.mock("@/notify", () => ({ notify: { showError: vi.fn(), showErrorToast: vi.fn() } }));
vi.mock("@/router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/utils/url.js", () => ({ goToItem: vi.fn(), buildItemUrl: vi.fn() }));
import { dualPane, initDualPane, openRight } from "@/store/dualPane.js";
import { notify } from "@/notify/index.ts";
import { transfer } from "./commands.js";
import { PANE_DRAG_TYPE, dropOperation, dropPlan, dropTarget, paneDragHandlers, startRightDrag } from "./dragDrop.js";

let root;
let user = 0;
function layout() {
  root = document.createElement("div");
  root.innerHTML = `
    <aside id="sidebar"><span class="tree">tree</span></aside>
    <div id="main">
      <div id="shelf"><a class="crumb">left</a></div>
      <div class="listing-item" data-parent="true" data-dir="true"><span class="name">..</span></div>
      <a class="listing-item" data-name="sub" data-dir="true"><span class="name">sub</span></a>
      <a class="listing-item" data-name="a.txt" data-dir="false"><span class="name">a.txt</span></a>
      <div class="empty">space</div>
    </div>
    <section class="dual-pane-right"><div class="dual-pane-list">
      <div class="listing-item" data-path="/" data-dir="true">..</div>
      <div class="listing-item" data-path="/r/pics/" data-dir="true">pics</div>
      <div class="listing-item" data-path="/r/b.txt" data-dir="false">b.txt</div>
    </div><div class="dual-pane-pathbar"><button class="dual-pane-pathbar-crumb" data-path="/r/">r</button></div></section>
    <div class="dual-pane-pathbar dual-pane-left-bar">
      <button class="dual-pane-pathbar-source">tank</button>
      <button class="dual-pane-pathbar-crumb" data-path="/"><i>home</i></button>
      <button class="dual-pane-pathbar-crumb" data-path="/left/">left</button>
    </div>`;
  document.body.append(root);
}
const $ = (selector) => root.querySelector(selector);
function drag(type, target, init = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types: [PANE_DRAG_TYPE], setData: vi.fn(), dropEffect: "", effectAllowed: "" };
  Object.assign(event, { dataTransfer, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("pane drag and drop", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(perms, { modify: true, download: true });
    user += 1;
    initDualPane(`drag${user}`);
    dualPane.shown = true;
    api.fetchFiles.mockResolvedValue({
      items: [
        { name: "pics", path: "/r/pics/", type: "directory" },
        { name: "b.txt", path: "/r/b.txt", type: "text/plain", size: 2 },
      ],
    });
    await openRight("backup", "/r/");
    layout();
  });
  afterEach(() => {
    root.remove();
    dualPane.drag = null;
  });

  it("copies across sources and moves within one, unless a modifier says otherwise", () => {
    const items = [{ source: "tank" }];
    expect(dropOperation({}, items, { source: "backup" })).toBe("copy");
    expect(dropOperation({}, items, { source: "tank" })).toBe("move");
    expect(dropOperation({ ctrlKey: true }, items, { source: "tank" })).toBe("copy");
    expect(dropOperation({ altKey: true }, items, { source: "tank" })).toBe("copy");
    expect(dropOperation({ shiftKey: true }, items, { source: "backup" })).toBe("move");
  });

  it("finds the folder a drag would land in", () => {
    // From the right: onto a left folder row, or the left pane's own folder
    expect(dropTarget($("#main [data-name='sub'] .name"), "right").folder).toEqual({ source: "tank", path: "/left/sub/" });
    expect(dropTarget($("#main .empty"), "right").folder).toEqual({ source: "tank", path: "/left/" });
    expect(dropTarget($("#main [data-name='a.txt']"), "right").folder).toEqual({ source: "tank", path: "/left/" });
    // From the left: onto a right folder row (".." too) or the right pane's folder
    expect(dropTarget($("[data-path='/r/pics/']"), "left").folder).toMatchObject({ source: "backup", path: "/r/pics/" });
    expect(dropTarget($("[data-path='/']"), "left").folder).toMatchObject({ source: "backup", path: "/" });
    expect(dropTarget($("[data-path='/r/b.txt']"), "left").folder).toEqual({ source: "backup", path: "/r/" });
  });

  it("takes drops on the path bars' folders and the left '..' from either pane", () => {
    // The left bar and "..": from the left too, which the listing has no drop handling for
    expect(dropTarget($(".dual-pane-left-bar [data-path='/'] i"), "left")).toMatchObject({ side: "left", folder: { source: "tank", path: "/" } });
    expect(dropTarget($(".dual-pane-left-bar [data-path='/left/']"), "right").folder).toEqual({ source: "tank", path: "/left/" });
    expect(dropTarget($("#main [data-parent] .name"), "left")).toMatchObject({ side: "left", folder: { source: "tank", path: "/" } });
    expect(dropTarget($("#main [data-parent]"), "right").element).toBe($("#main [data-parent]"));
    // The right bar's folders, from either pane
    expect(dropTarget($(".dual-pane-right [data-path='/r/']"), "right")).toMatchObject({ side: "right", folder: { source: "backup", path: "/r/" } });
    expect(dropTarget($(".dual-pane-right [data-path='/r/']"), "left").element).toBe($(".dual-pane-right [data-path='/r/']"));
    // The rest of the left bar is the left pane, like its empty space
    expect(dropTarget($(".dual-pane-left-bar .dual-pane-pathbar-source"), "right").folder).toEqual({ source: "tank", path: "/left/" });
    expect(dropTarget($(".dual-pane-left-bar .dual-pane-pathbar-source"), "left")).toBeNull();
  });

  it("moves the left selection up a folder when it's dropped on the left '..', through the prompt", () => {
    paneDragHandlers.dragstart(drag("dragstart", $("#main [data-name='a.txt'] .name")));
    const over = drag("dragover", $("#main [data-parent] .name"));
    paneDragHandlers.dragover(over);
    expect(over.defaultPrevented).toBe(true);
    expect($("#main [data-parent]").classList.contains("dual-pane-drop-target")).toBe(true);
    const drop = drag("drop", $("#main [data-parent] .name"));
    paneDragHandlers.drop(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(mutations.showPrompt).toHaveBeenCalledWith(expect.objectContaining({
      name: "move",
      props: expect.objectContaining({ items: [expect.objectContaining({ path: "/left/a.txt" })], destination: { source: "tank", path: "/" } }),
    }));
    // Not onto the folder it's already in
    paneDragHandlers.dragstart(drag("dragstart", $("#main [data-name='a.txt'] .name")));
    const inPlace = drag("dragover", $(".dual-pane-left-bar [data-path='/left/']"));
    paneDragHandlers.dragover(inPlace);
    expect(inPlace.defaultPrevented).toBe(false);
    expect(inPlace.dataTransfer.dropEffect).toBe("none");
  });

  it("leaves left-to-left drags to the app and blocks right-pane drags where they can't land", () => {
    expect(dropTarget($("#main [data-name='sub']"), "left")).toBeNull();
    expect(dropTarget($("#shelf .crumb"), "left")).toBeNull();
    expect(dropTarget($("#sidebar .tree"), "left")).toBeNull();
    expect(dropTarget($("#shelf .crumb"), "right")).toEqual({ blocked: true });
    expect(dropTarget($("#sidebar .tree"), "right")).toEqual({ blocked: true });
    expect(dropTarget($("[data-path='/r/b.txt']"), "right")).toEqual({ blocked: true });
  });

  it("drags the right pane's selection, or the dragged row, and opens the prompt on drop", () => {
    const row = $("[data-path='/r/b.txt']");
    const start = drag("dragstart", row);
    startRightDrag(dualPane.right.entries.find((entry) => entry.name === "b.txt"), start);
    expect(dualPane.right.selected).toEqual(["/r/b.txt"]);
    expect(start.dataTransfer.setData).toHaveBeenCalledWith("application/x-filebrowser-internal-drag", "true");

    const over = drag("dragover", $("#main [data-name='sub'] .name"));
    paneDragHandlers.dragover(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    expect($("#main [data-name='sub']").classList.contains("dual-pane-drop-target")).toBe(true);

    const drop = drag("drop", $("#main [data-name='sub'] .name"), { shiftKey: true });
    paneDragHandlers.drop(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect($("#main [data-name='sub']").classList.contains("dual-pane-drop-target")).toBe(false);
    expect(mutations.showPrompt).toHaveBeenCalledWith({
      name: "move",
      props: {
        operation: "move",
        items: [{ path: "/r/b.txt", source: "backup", name: "b.txt", type: "text/plain", size: 2 }],
        destination: { source: "tank", path: "/left/sub/" },
      },
    });
    expect(dualPane.drag).toBeNull();
  });

  it("swallows a right-pane drop on the sidebar without acting", () => {
    startRightDrag(dualPane.right.entries.find((entry) => entry.name === "b.txt"), drag("dragstart", $("[data-path='/r/b.txt']")));
    const over = drag("dragover", $("#sidebar .tree"));
    paneDragHandlers.dragover(over);
    expect(over.defaultPrevented).toBe(false);
    const drop = drag("drop", $("#sidebar .tree"));
    paneDragHandlers.drop(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(mutations.showPrompt).not.toHaveBeenCalled();
  });

  it("takes left-pane drags into the right pane with the left selection", () => {
    paneDragHandlers.dragstart(drag("dragstart", $("#main [data-name='a.txt'] .name")));
    expect(dualPane.drag).toEqual({ origin: "left" });
    const leftOver = drag("dragover", $("#main [data-name='sub']"));
    paneDragHandlers.dragover(leftOver);
    expect(leftOver.defaultPrevented).toBe(false); // the listing's own drop into a left folder
    paneDragHandlers.drop(drag("drop", $(".dual-pane-list")));
    expect(mutations.showPrompt).toHaveBeenCalledWith(expect.objectContaining({
      name: "copy",
      props: expect.objectContaining({ items: [expect.objectContaining({ path: "/left/a.txt" })], destination: { source: "backup", path: "/r/" } }),
    }));
  });

  it("refuses a folder dropped on itself and a move into the folder the items are in", () => {
    const pics = { path: "/r/pics/", source: "backup", name: "pics", type: "directory" };
    expect(dropPlan({}, [pics], { source: "backup", path: "/r/pics/" })).toBeNull();
    expect(dropPlan({}, [pics], { source: "backup", path: "/r/pics/2024/" })).toBeNull();
    expect(dropPlan({}, [pics], { source: "backup", path: "/r/" })).toBeNull();
    expect(dropPlan({ ctrlKey: true }, [pics], { source: "backup", path: "/r/" })).toBe("copy");
    expect(dropPlan({}, [pics], { source: "tank", path: "/r/pics/" })).toBe("copy");

    startRightDrag(dualPane.right.entries.find((entry) => entry.name === "pics"), drag("dragstart", $("[data-path='/r/pics/']")));
    const over = drag("dragover", $("[data-path='/r/pics/']"));
    paneDragHandlers.dragover(over);
    expect(over.defaultPrevented).toBe(false);
    expect($("[data-path='/r/pics/']").classList.contains("dual-pane-drop-target")).toBe(false);
  });

  it("ignores drags that aren't pane drags, even with stale state", () => {
    dualPane.drag = { origin: "right" }; // a drag whose dragend never arrived
    const external = drag("drop", $("#main .empty"));
    external.dataTransfer.types = ["Files"];
    paneDragHandlers.drop(external);
    expect(external.defaultPrevented).toBe(false);
    expect(mutations.showPrompt).not.toHaveBeenCalled();
    // The next drag starts clean
    paneDragHandlers.dragstart(drag("dragstart", $("#sidebar .tree")));
    expect(dualPane.drag).toBeNull();
  });

  it("refuses a transfer the source doesn't allow before opening the prompt", () => {
    const items = [{ path: "/r/b.txt", source: "backup", name: "b.txt" }];
    Object.assign(perms, { modify: false, download: true });
    transfer("move", items, { source: "tank", path: "/" });
    expect(mutations.showPrompt).not.toHaveBeenCalled();
    expect(notify.showErrorToast).toHaveBeenCalledOnce();
    transfer("copy", items, { source: "tank", path: "/" });
    expect(mutations.showPrompt).toHaveBeenCalledOnce();
  });

  it("ignores a drag of the '..' row", () => {
    const start = drag("dragstart", $("[data-path='/']"));
    startRightDrag(dualPane.right.entries[0], start);
    expect(start.defaultPrevented).toBe(true);
    expect(dualPane.drag).toBeNull();
  });
});
