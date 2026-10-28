import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, mutations, getters, router, rowContextMenu } = vi.hoisted(() => {
  const state = {
    user: { username: "alice", singleClick: false },
    req: { source: "tank", path: "/docs/pics/", type: "directory", items: [] },
    selected: [],
    pendingHighlight: null,
    sources: { info: { tank: {} } },
  };
  return {
    state,
    mutations: {
      showPrompt: vi.fn(),
      resetSelected: vi.fn(() => {
        state.selected = [];
      }),
      addSelected: vi.fn((index) => state.selected.push(index)),
    },
    getters: {
      isShare: vi.fn(() => false),
      isMobile: () => false,
      currentPromptName: vi.fn(() => null),
      viewMode: () => "list",
      pickerSorting: () => ({ by: "name", asc: true }),
    },
    router: { push: vi.fn() },
    rowContextMenu: vi.fn(),
  };
});
vi.mock("@/store", () => ({ state, getters, mutations }));
vi.mock("@/api", () => ({ resourcesApi: { fetchFiles: vi.fn() } }));
vi.mock("@/notify", () => ({ notify: { showError: vi.fn() } }));
vi.mock("@/router", () => ({ router }));
vi.mock("@/utils/url.js", () => ({
  goToItem: vi.fn(),
  buildItemUrl: (source, path, absolute) => `${absolute ? "http://host" : ""}/files/${source}${path}`,
}));
vi.mock("@/components/files/ListingItem.vue", () => ({
  default: {
    props: ["name", "path", "isSelectedProp", "updateGlobalState", "clickable", "isDir"],
    render() {
      // As the real row: its own data-name and right-click handler
      return h("div", { class: "listing-item", tabindex: "0", "data-name": this.name, onContextmenu: rowContextMenu }, [
        h("span", { class: "name" }, this.name),
      ]);
    },
  },
}));
import { dualPane, initDualPane, setActivePane } from "@/store/dualPane.js";
import { leftParentPosition, runDualPaneCommand } from "@/utils/dualPane/commands.js";
import LeftParentRow from "./LeftParentRow.vue";

let app, root, user = 0;
function unmount() {
  app?.unmount();
  root?.remove();
  app = null;
  root = null;
}
// The row in #main, as ListingView renders it, ahead of the listing's own rows
async function mount(props = {}, { withRows = true } = {}) {
  unmount();
  root = document.createElement("div");
  root.id = "main";
  root.scrollTo = vi.fn();
  document.body.append(root);
  const rows = document.createElement("div");
  rows.className = "rows";
  if (withRows) {
    rows.innerHTML = `
      <div class="listing-item" data-index="2" data-name="b" tabindex="0">b</div>
      <div class="listing-item" data-index="0" data-name="a" tabindex="0">a</div>`;
  }
  app = createApp({ render: () => h(LeftParentRow, props) });
  app.mount(root);
  root.append(rows);
  await nextTick();
}
const parentRow = () => root.querySelector(".listing-item[data-parent]");
function click(init = {}) {
  parentRow().querySelector(".name").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
}

describe("LeftParentRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user += 1;
    initDualPane(`parent${user}`);
    dualPane.shown = true;
    setActivePane("right");
    Object.assign(state, { selected: [], pendingHighlight: null });
    state.user.singleClick = false;
    state.req = { source: "tank", path: "/docs/pics/", type: "directory", items: [] };
    getters.isShare.mockReturnValue(false);
  });
  afterEach(unmount);

  it("shows '..' for the parent folder only with both panes shown, below the root and outside shares", async () => {
    await mount();
    const row = parentRow();
    expect(row.dataset.path).toBe("/docs/");
    // No data-name, which the listing's scroll indicator would show as "."
    expect(row.hasAttribute("data-name")).toBe(false);
    expect(row.parentElement.className).toBe("folder-items dual-pane-parent-group firstGroup");

    await mount({ empty: true });
    expect(parentRow().parentElement.classList.contains("lastGroup")).toBe(true);
    dualPane.shown = false;
    await nextTick();
    expect(parentRow()).toBeNull();
    dualPane.shown = true;

    // The mocked store isn't reactive: mount again for each
    state.req = { ...state.req, path: "/" };
    await mount();
    expect(parentRow()).toBeNull();
    state.req = { ...state.req, path: "/docs/" };
    getters.isShare.mockReturnValue(true);
    await mount();
    expect(parentRow()).toBeNull();
  });

  it("puts the cursor on '..' with a click and goes up with a double click, selecting the folder it came from", async () => {
    state.selected = [0];
    await mount();
    click();
    expect(dualPane.active).toBe("left");
    expect(state.selected).toEqual([]);
    expect(dualPane.leftOnParent).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    await nextTick();
    expect(parentRow().classList.contains("dual-pane-cursor")).toBe(true);

    parentRow().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(router.push).toHaveBeenCalledWith({ path: "/files/tank/docs/" });
    expect(state.pendingHighlight).toEqual({ path: "/docs/pics", source: "tank" });
  });

  it("goes up on one click for single-click users, and on a tap once the cursor is there", async () => {
    state.user.singleClick = true;
    await mount();
    click();
    expect(router.push).toHaveBeenCalledOnce();
    state.user.singleClick = false;
    router.push.mockClear();

    parentRow().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    click();
    expect(router.push).not.toHaveBeenCalled();
    click();
    expect(router.push).toHaveBeenCalledWith({ path: "/files/tank/docs/" });
  });

  it("keeps the selection on Ctrl-click and opens the parent in a new tab on a middle click", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    state.selected = [0];
    await mount();
    click({ ctrlKey: true });
    expect(state.selected).toEqual([0]);
    expect(dualPane.leftOnParent).toBe(true);
    click({ shiftKey: true });
    expect(router.push).not.toHaveBeenCalled();

    parentRow().dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(open).toHaveBeenCalledWith("http://host/files/tank/docs/", "_blank");
    expect(state.pendingHighlight).toBeNull();
    open.mockRestore();
  });

  it("opens the folder's menu on right-click, never the item menu for '..' or the selection", async () => {
    state.selected = [0];
    await mount();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
    parentRow().querySelector(".name").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(rowContextMenu).not.toHaveBeenCalled();
    // The app's menu acts on any selection, so it's cleared first
    expect(state.selected).toEqual([]);
    expect(dualPane.leftOnParent).toBe(true);
    expect(mutations.showPrompt).toHaveBeenCalledWith({
      name: "ContextMenu",
      props: { showCentered: false, posX: 40, posY: 50, createOnly: true },
    });
  });

  it("moves the keyboard cursor onto '..' and off it to the top entry", async () => {
    await mount();
    setActivePane("left");
    // The top entry on screen is index 2
    state.selected = [2];
    expect(leftParentPosition()).toEqual({ onParent: false, first: true, topRow: true });
    state.selected = [0];
    expect(leftParentPosition()).toEqual({ onParent: false, first: false, topRow: false });

    runDualPaneCommand({ cmd: "leftParentFocus" });
    expect(state.selected).toEqual([]);
    expect(dualPane.leftOnParent).toBe(true);
    expect(document.activeElement).toBe(parentRow());
    expect(leftParentPosition()).toEqual({ onParent: true, first: false, topRow: false });
    // ".." is the top row; scrolled into view it would sit under the header and path bar
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    runDualPaneCommand({ cmd: "leftParentLeave", args: { selectFirst: true } });
    expect(dualPane.leftOnParent).toBe(false);
    expect(state.selected).toEqual([2]);

    runDualPaneCommand({ cmd: "leftParentFocus" });
    runDualPaneCommand({ cmd: "leftParentOpen" });
    expect(router.push).toHaveBeenCalledWith({ path: "/files/tank/docs/" });
  });

  it("keeps the cursor on '..' in an empty folder, where there's no entry to move down to", async () => {
    await mount({ empty: true }, { withRows: false });
    runDualPaneCommand({ cmd: "leftParentFocus" });
    runDualPaneCommand({ cmd: "leftParentLeave", args: { selectFirst: true } });
    expect(dualPane.leftOnParent).toBe(true);
    expect(mutations.resetSelected).toHaveBeenCalledOnce(); // only for the focus
    runDualPaneCommand({ cmd: "leftParentLeave" });
    expect(dualPane.leftOnParent).toBe(false);
  });

  it("opens the folder's menu on a long press, without going up when the finger lifts", async () => {
    vi.useFakeTimers();
    try {
      state.selected = [0];
      await mount();
      const touch = (type, x = 30, y = 40) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        event.touches = type === "touchend" ? [] : [{ clientX: x, clientY: y }];
        parentRow().dispatchEvent(event);
        return event;
      };
      // A swipe isn't a long press
      touch("touchstart");
      touch("touchmove", 30, 60);
      vi.advanceTimersByTime(600);
      expect(mutations.showPrompt).not.toHaveBeenCalled();
      touch("touchend");

      touch("touchstart");
      vi.advanceTimersByTime(500);
      expect(state.selected).toEqual([]);
      expect(dualPane.leftOnParent).toBe(true);
      expect(mutations.showPrompt).toHaveBeenCalledWith({
        name: "ContextMenu",
        props: { showCentered: false, posX: 30, posY: 40, createOnly: true },
      });
      // The click the lifted finger makes would be a tap on the cursor row, which goes up
      expect(touch("touchend").defaultPrevented).toBe(true);
      parentRow().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      click();
      expect(router.push).not.toHaveBeenCalled();
      // The next tap does
      touch("touchstart");
      touch("touchend");
      click();
      expect(router.push).toHaveBeenCalledWith({ path: "/files/tank/docs/" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the left pane's cursor on '..' when Tab comes back with nothing selected", async () => {
    await mount();
    setActivePane("right");
    runDualPaneCommand({ cmd: "switchPane" });
    expect(dualPane.active).toBe("left");
    expect(dualPane.leftOnParent).toBe(true);
    expect(document.activeElement).toBe(parentRow());

    // With a selection, focus goes to it and the cursor stays off ".."
    dualPane.leftOnParent = false;
    root.querySelector('[data-index="0"]').setAttribute("aria-selected", "true");
    state.selected = [0];
    setActivePane("right");
    runDualPaneCommand({ cmd: "switchPane" });
    expect(dualPane.leftOnParent).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('[data-index="0"]'));
  });

  it("has no position without a '..' row", async () => {
    state.req = { ...state.req, path: "/" };
    await mount();
    expect(leftParentPosition()).toBeNull();
  });
});
