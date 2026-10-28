import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, api, url, rowContextMenu, mutations, displayPreferences } = vi.hoisted(() => {
  // { [source]: { [route path]: { viewMode } } }, as state.displayPreferences
  const displayPreferences = {};
  return {
    mutations: {
      showPrompt: vi.fn(),
      closeTopPrompt: vi.fn(),
      updateDisplayPreferences: vi.fn((payload, location) => {
        const { source, path } = location || { source: "tank", path: "/files/tank/left/" };
        displayPreferences[source] = { ...displayPreferences[source], [path]: { ...displayPreferences[source]?.[path], ...payload } };
      }),
    },
    state: {
      user: { username: "alice", singleClick: false, viewMode: "list", gallerySize: 5 },
      req: { source: "tank", path: "/left/", name: "left", type: "directory", items: [] },
      selected: [],
      sources: { info: { tank: {}, backup: {} }, current: "tank" },
      prompts: [],
    },
    api: { fetchFiles: vi.fn() },
    url: { goToItem: vi.fn(), buildItemUrl: (source, path) => `/files/${source}${path}` },
    rowContextMenu: vi.fn(),
    displayPreferences,
  };
});
vi.mock("@/store", () => ({
  state,
  getters: {
    pickerSorting: () => ({ by: "name", asc: true }),
    sourcePermissions: () => ({ create: true, modify: true, delete: true, download: true }),
    canCreateInSource: () => true,
    currentPromptName: () => state.prompts.at(-1)?.name ?? null,
    displayPreferenceFor: (source, path) => displayPreferences[source]?.[path] || null,
    viewMode: () => "compact",
  },
  mutations,
}));
vi.mock("@/api", () => ({ resourcesApi: api }));
vi.mock("@/notify", () => ({ notify: { showError: vi.fn() } }));
vi.mock("@/router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/utils/url.js", () => url);
vi.mock("@/store/eventBus", () => ({ eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("@/components/LoadingSpinner.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/files/ListingHeader.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/files/ListingItem.vue", () => ({
  default: {
    props: ["name", "path", "isSelectedProp", "updateGlobalState", "clickable", "isDir"],
    inject: { listingViewMode: { default: null } },
    render() {
      return h(
        "div",
        {
          class: "listing-item",
          "data-name": this.name,
          "data-mode": this.listingViewMode,
          "aria-selected": String(this.isSelectedProp),
          onContextmenu: rowContextMenu,
        },
        this.name,
      );
    },
  },
}));
import {
  activePaneViewMode,
  dualPane,
  followGallerySize,
  initDualPane,
  openRight,
  rightSelection,
  saveActivePaneViewMode,
  setActivePane,
} from "@/store/dualPane.js";
import { runDualPaneCommand } from "@/utils/dualPane/commands.js";
import DualPanePanel from "./DualPanePanel.vue";

let app, root, user = 0;
async function mount() {
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(DualPanePanel);
  app.config.globalProperties.$t = (key) => key;
  app.mount(root);
  await nextTick();
}
const row = (name) => root.querySelector(`.listing-item[data-name="${name}"]`);
const selectedNames = () => [...root.querySelectorAll('.listing-item[aria-selected="true"]')].map((el) => el.dataset.name);
const cursorName = () => root.querySelector(".dual-pane-cursor")?.dataset.name;
const headings = () => [...root.querySelectorAll(".dual-pane-list > div > h2")].map((el) => el.textContent);
const docsKey = "/files/tank/docs/";
const listing = {
  items: [
    { name: "pics", path: "/docs/pics/", type: "directory", size: 4 },
    { name: "a.txt", path: "/docs/a.txt", type: "text/plain", size: 1 },
    { name: "b.txt", path: "/docs/b.txt", type: "text/plain", size: 2 },
  ],
};

describe("DualPanePanel", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const source of Object.keys(displayPreferences)) delete displayPreferences[source];
    user += 1;
    initDualPane(`panel${user}`);
    dualPane.shown = true;
    setActivePane("left");
    api.fetchFiles.mockResolvedValue(listing);
    await openRight("tank", "/docs/");
  });
  afterEach(() => {
    app?.unmount();
    root?.remove();
  });

  it("lists the folder and sums it up in its status line", async () => {
    await mount();
    expect([...root.querySelectorAll(".listing-item")].map((el) => el.dataset.name)).toEqual(["..", "pics", "a.txt", "b.txt"]);
    expect(root.querySelector(".dual-pane-status-text").textContent).toBe("1 general.folder | 2 general.files (7.0 bytes)");
  });

  it("selects with clicks, makes the pane active and keeps the click from the left listing", async () => {
    const windowClick = vi.fn();
    window.addEventListener("click", windowClick);
    await mount();
    row("a.txt").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    row("b.txt").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await nextTick();
    expect(selectedNames()).toEqual(["a.txt", "b.txt"]);
    expect(dualPane.active).toBe("right");
    expect(windowClick).not.toHaveBeenCalled();
    expect(root.querySelector(".dual-pane-status-text").textContent).toBe("2 general.selectionMultiple (3.0 bytes)");
    window.removeEventListener("click", windowClick);
  });

  it("browses folders in the pane and opens files in the main view, coming back to the left folder", async () => {
    await mount();
    row("a.txt").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(url.goToItem).toHaveBeenCalledWith("tank", "/docs/a.txt", expect.objectContaining({ source: "tank", path: "/left/" }), false, false);
    api.fetchFiles.mockResolvedValue({ items: [] });
    row("pics").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await vi.waitFor(() => expect(dualPane.right.path).toBe("/docs/pics/"));
    await nextTick();
    expect(root.querySelector(".dual-pane-message").textContent).toContain("files.lonely");
  });

  it("opens its own menu on right-click instead of the app's", async () => {
    await mount();
    row("b.txt").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await nextTick();
    expect(rowContextMenu).not.toHaveBeenCalled();
    expect(selectedNames()).toEqual(["b.txt"]);
    const labels = () => [...document.querySelectorAll(".dual-pane-menu-item")].map((el) => el.textContent.trim());
    expect(labels()).toEqual([
      "open_in_newdualPane.open",
      "content_copydualPane.copyToOtherPaneF5",
      "movedualPane.moveToOtherPaneF6",
      "editgeneral.rename",
      "deletegeneral.delete",
      "file_downloadgeneral.download",
      "infogeneral.info",
    ]);
    dualPane.menu = null;
    await nextTick();
    row("..").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await nextTick();
    expect(labels()[0]).toBe("create_new_folderfiles.newFolder");

    // None on its status line, as on the left pane's
    dualPane.menu = null;
    await nextTick();
    const onStatus = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    root.querySelector(".dual-pane-status-text").dispatchEvent(onStatus);
    await nextTick();
    expect(onStatus.defaultPrevented).toBe(true);
    expect(dualPane.menu).toBeNull();
  });

  it("opens its menu on a long press, except on its status line", async () => {
    dualPane.menu = null;
    vi.useFakeTimers();
    try {
      await mount();
      const press = (target) => {
        const event = new Event("touchstart", { bubbles: true });
        Object.defineProperty(event, "touches", { value: [{ clientX: 5, clientY: 6 }] });
        target.dispatchEvent(event);
        vi.advanceTimersByTime(600);
      };
      press(root.querySelector(".dual-pane-status-text"));
      expect(dualPane.menu).toBeNull();
      press(row("b.txt"));
      expect(dualPane.menu).toEqual({ x: 5, y: 6, onEntry: true });
    } finally {
      vi.useRealTimers();
      dualPane.menu = null;
    }
  });

  it("shows when a folder can't be read", async () => {
    api.fetchFiles.mockRejectedValue(new Error("nope"));
    await openRight("backup", "/missing/");
    await mount();
    expect(root.querySelector(".dual-pane-message").textContent).toContain("files.cannotAccesDir");
    expect([...root.querySelectorAll(".listing-item")].map((el) => el.dataset.name)).toEqual([".."]);
    // ".." on its own is not headed as a folder
    expect(headings()).toEqual([]);
  });

  it("shows the folder in its own saved layout, grouped like the main listing", async () => {
    await mount();
    const list = root.querySelector(".dual-pane-list");
    // No saved layout: the user's default, not the main listing's ("compact")
    expect(list.classList.contains("list")).toBe(true);
    expect(list.style.getPropertyValue("--item-height")).toBe("65px");
    expect(headings()).toEqual(["general.folders", "general.files"]);
    // ".." in a group of its own with no heading, ahead of the folders, as the left pane shows it
    const groups = [...list.querySelectorAll(".dual-pane-list > div:not(:has(> h2))")];
    expect(groups.map((group) => [...group.querySelectorAll(".listing-item")].map((el) => el.dataset.name))).toEqual([[".."], ["pics"], ["a.txt", "b.txt"]]);
    expect(groups.map((group) => group.className)).toEqual([
      "folder-items dual-pane-parent-group firstGroup",
      "folder-items",
      "file-items lastGroup",
    ]);
    expect(groups[0].hasAttribute("role")).toBe(false);
    expect(groups[1].getAttribute("aria-label")).toBe("general.folders");
    // Stripes as in the main listing, which has no ".."
    expect([...list.querySelectorAll(".zebra-row")].map((el) => el.dataset.name)).toEqual(["a.txt"]);
    app.unmount();

    displayPreferences.tank = { [docsKey]: { viewMode: "gallery" } };
    await mount();
    expect(root.querySelector(".dual-pane-list").className).toBe("listing-items dual-pane-list gallery");
    expect(root.querySelector(".dual-pane-list").style.getPropertyValue("--item-width")).toBe("205px");
    // Rows and icons are told the pane's layout
    expect(new Set([...root.querySelectorAll(".listing-item")].map((el) => el.dataset.mode))).toEqual(new Set(["gallery"]));
  });

  it("clears the selection on a click between the entries", async () => {
    await mount();
    row("a.txt").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    root.querySelector(".file-items").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(selectedNames()).toEqual([]);
  });

  it("switches the layout of the active pane's folder only, without changing the default", () => {
    setActivePane("right");
    expect(activePaneViewMode()).toBe("list");
    expect(saveActivePaneViewMode("icons")).toBe(true);
    expect(mutations.updateDisplayPreferences).toHaveBeenLastCalledWith({ viewMode: "icons" }, { source: "tank", path: docsKey });
    expect(activePaneViewMode()).toBe("icons");

    setActivePane("left");
    expect(activePaneViewMode()).toBe("compact");
    expect(saveActivePaneViewMode("normal")).toBe(true);
    expect(mutations.updateDisplayPreferences).toHaveBeenLastCalledWith({ viewMode: "normal" });

    // With one pane on screen the top bar's usual switch applies
    dualPane.shown = false;
    setActivePane("right");
    expect(activePaneViewMode()).toBe("compact");
    expect(saveActivePaneViewMode("gallery")).toBe(false);
    expect(mutations.updateDisplayPreferences).toHaveBeenCalledTimes(2);
  });

  it("keeps the pane's folder in step with the size slider", () => {
    dualPane.enabled = true;
    displayPreferences.tank = { [docsKey]: { viewMode: "list" } };
    followGallerySize(3);
    expect(displayPreferences.tank[docsKey].viewMode).toBe("compact");
    followGallerySize(4);
    expect(displayPreferences.tank[docsKey].viewMode).toBe("list");
    displayPreferences.tank[docsKey].viewMode = "normal";
    followGallerySize(1);
    expect(mutations.updateDisplayPreferences).toHaveBeenCalledTimes(2);
    // Out of sight, the folder is left as it is, as the main listing leaves folders it isn't showing
    displayPreferences.tank[docsKey].viewMode = "list";
    dualPane.shown = false;
    followGallerySize(2);
    expect(mutations.updateDisplayPreferences).toHaveBeenCalledTimes(2);
  });

  it("moves by rows on screen in a card layout and by entries in a list", async () => {
    // Two columns of 100x100 cards: folders on the first row, files from the next one down
    const files = ["f1", "f2", "f3", "f4", "f5"];
    api.fetchFiles.mockResolvedValue({
      items: [listing.items[0], ...files.map((name) => ({ name, path: `/docs/${name}`, type: "text/plain", size: 1 }))],
    });
    await openRight("tank", "/docs/");
    const at = (column, row) => ({ left: column * 110, right: column * 110 + 100, top: row * 150, bottom: row * 150 + 100 });
    const rects = { "..": at(0, 0), pics: at(1, 0) };
    files.forEach((name, index) => {
      rects[name] = at(index % 2, 1 + Math.floor(index / 2));
    });
    // The hovered card is zoomed by 2% about its centre, which mustn't change its row
    rects[".."] = { left: -1, right: 101, top: -1, bottom: 101 };
    const spies = [
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect() {
        return rects[this.dataset?.name] || { left: 0, right: 0, top: 0, bottom: 0 };
      }),
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100),
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100),
      // Room for the starting row and one more
      vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(260),
    ];
    const run = async (cmd, args) => {
      runDualPaneCommand({ cmd, args: { extend: false, ...args } });
      await nextTick();
      return cursorName();
    };
    try {
      await mount();
      rightSelection.setCursor("/docs/pics/");
      expect(await run("cursor", { step: 1, rows: true })).toBe("f1");
      app.unmount();

      displayPreferences.tank = { [docsKey]: { viewMode: "icons" } };
      await mount();
      rightSelection.setCursor("/docs/pics/");
      expect(await run("cursor", { step: 1, rows: true })).toBe("f2");
      expect(await run("cursor", { step: 1, rows: true })).toBe("f4");
      expect(await run("cursor", { step: -1, rows: true })).toBe("f2");
      expect(await run("cursor", { step: -1, rows: true })).toBe("pics");
      rightSelection.setCursor("/docs/f1");
      expect(await run("cursor", { step: -1, rows: true })).toBe("..");
      // A page goes as far as keeps the starting row in view, here one row
      expect(await run("page", { direction: 1 })).toBe("f1");
      expect(await run("page", { direction: 1 })).toBe("f3");
      // and stays in its column through the short last row
      rightSelection.setCursor("/docs/f4");
      expect(await run("page", { direction: 1 })).toBe("f5");
      expect(await run("cursor", { step: -1, rows: true, extend: true })).toBe("f3");
      expect(selectedNames()).toEqual(["f3", "f4", "f5"]);
      // Left and right still go through the entries in order
      expect(await run("cursor", { step: -1 })).toBe("f2");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
