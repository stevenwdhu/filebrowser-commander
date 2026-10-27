import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, api, url, rowContextMenu } = vi.hoisted(() => ({
  state: {
    user: { username: "alice", singleClick: false },
    req: { source: "tank", path: "/left/", name: "left", type: "directory", items: [] },
    selected: [],
    sources: { info: { tank: {}, backup: {} }, current: "tank" },
    prompts: [],
  },
  api: { fetchFiles: vi.fn() },
  url: { goToItem: vi.fn(), buildItemUrl: (source, path) => `/files/${source}${path}` },
  rowContextMenu: vi.fn(),
}));
vi.mock("@/store", () => ({
  state,
  getters: {
    pickerSorting: () => ({ by: "name", asc: true }),
    sourcePermissions: () => ({ create: true, modify: true, delete: true, download: true }),
  },
  mutations: { showPrompt: vi.fn(), closeTopPrompt: vi.fn() },
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
    render() {
      return h(
        "div",
        { class: "listing-item", "data-name": this.name, "aria-selected": String(this.isSelectedProp), onContextmenu: rowContextMenu },
        this.name,
      );
    },
  },
}));
import { dualPane, initDualPane, openRight, setActivePane } from "@/store/dualPane.js";
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

  it("lists the folder and sums it up in the footer", async () => {
    await mount();
    expect([...root.querySelectorAll(".listing-item")].map((el) => el.dataset.name)).toEqual(["..", "pics", "a.txt", "b.txt"]);
    expect(root.querySelector(".dual-pane-footer").textContent).toBe("1 general.folder | 2 general.files (7.0 bytes)");
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
    expect(root.querySelector(".dual-pane-footer").textContent).toBe("2 general.selectionMultiple (3.0 bytes)");
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
  });

  it("shows when a folder can't be read", async () => {
    api.fetchFiles.mockRejectedValue(new Error("nope"));
    await openRight("backup", "/missing/");
    await mount();
    expect(root.querySelector(".dual-pane-message").textContent).toContain("files.cannotAccesDir");
    expect([...root.querySelectorAll(".listing-item")].map((el) => el.dataset.name)).toEqual([".."]);
  });
});
