import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, mutations, router, api, bus, invalidate } = vi.hoisted(() => {
  const handlers = new Map();
  return {
    state: {
      user: { username: "alice" },
      req: { source: "tank", path: "/docs/pics/", type: "directory", items: [] },
      selected: [],
      sources: { info: { tank: {}, backup: {} }, current: "tank" },
    },
    mutations: { showPrompt: vi.fn(), setReload: vi.fn() },
    router: { push: vi.fn() },
    api: { fetchFiles: vi.fn() },
    invalidate: vi.fn(),
    bus: {
      on: vi.fn((name, handler) => handlers.set(name, handler)),
      off: vi.fn(),
      emit: (name, data) => handlers.get(name)?.(data),
    },
  };
});
vi.mock("@/store", () => ({
  state,
  getters: { pickerSorting: () => ({ by: "name", asc: true }), isShare: () => false },
  mutations,
}));
vi.mock("@/api", () => ({ resourcesApi: api }));
vi.mock("@/notify", () => ({ notify: { showError: vi.fn() } }));
vi.mock("@/router", () => ({ router }));
vi.mock("@/utils/url.js", () => ({
  goToItem: vi.fn(),
  buildItemUrl: (source, path, absolute) => `${absolute ? "http://host" : ""}/files/${source}${path}`,
}));
vi.mock("@/store/eventBus", () => ({ eventBus: bus }));
vi.mock("@/utils/metadataCache.js", () => ({ invalidateDirMetadataCache: invalidate }));
import { dualPane, initDualPane, openRight, setActivePane } from "@/store/dualPane.js";
import DualPanePathBar from "./DualPanePathBar.vue";

let app, root, user = 0;
async function mount(pane) {
  root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render: () => h(DualPanePathBar, { pane }) });
  app.config.globalProperties.$t = (key) => key;
  app.mount(root);
  await nextTick();
}
const crumbs = () => [...root.querySelectorAll(".dual-pane-pathbar-crumb")];
const crumb = (path) => root.querySelector(`.dual-pane-pathbar-crumb[data-path="${path}"]`);
const actionLabels = () => [...root.querySelectorAll(".dual-pane-pathbar-action")].map((button) => button.getAttribute("aria-label"));

describe("DualPanePathBar", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    user += 1;
    initDualPane(`bar${user}`);
    dualPane.shown = true;
    state.req = { source: "tank", path: "/docs/pics/", type: "directory", items: [] };
    api.fetchFiles.mockResolvedValue({ items: [] });
    await openRight("backup", "/r/");
  });
  afterEach(() => {
    app?.unmount();
    root?.remove();
  });

  it("shows the left pane's folder, without the button that closes the second pane", async () => {
    await mount("left");
    expect(root.querySelector(".dual-pane-pathbar-source span").textContent).toBe("tank");
    expect(crumbs().map((button) => button.dataset.path)).toEqual(["/", "/docs/", "/docs/pics/"]);
    expect(crumb("/docs/pics/").getAttribute("aria-current")).toBe("location");
    expect(actionLabels()).toEqual(["buttons.refresh", "dualPane.showInOtherPane (Alt+I)"]);
    expect(root.firstElementChild.classList.contains("is-active")).toBe(true);
    app.unmount();
    root.remove();

    await mount("right");
    expect(crumbs().map((button) => button.dataset.path)).toEqual(["/", "/r/"]);
    expect(actionLabels()).toEqual(["buttons.refresh", "dualPane.showInOtherPane (Alt+I)", "dualPane.hide (Ctrl+\\)"]);
    expect(root.firstElementChild.classList.contains("is-active")).toBe(false);
    setActivePane("right");
    await nextTick();
    expect(root.firstElementChild.classList.contains("is-active")).toBe(true);
  });

  it("browses the left pane from its crumbs and reloads it from its own folder's", async () => {
    await mount("left");
    crumb("/docs/").click();
    expect(router.push).toHaveBeenCalledWith({ path: "/files/tank/docs/" });
    expect(api.fetchFiles).toHaveBeenCalledTimes(1); // only the right pane's own load

    // The folder it's in doesn't reload by navigating to it: as F4
    crumb("/docs/pics/").click();
    expect(router.push).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(mutations.setReload).toHaveBeenCalledWith(true);
    root.querySelector(".dual-pane-pathbar-action").click();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("opens a crumb's folder in a new tab on a middle click", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await mount("left");
    crumb("/docs/").dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(open).toHaveBeenCalledWith("http://host/files/tank/docs/", "_blank");
    crumb("/docs/").dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }));
    expect(open).toHaveBeenCalledOnce();
    open.mockRestore();
  });

  it("shows the left folder in the other pane even while the right one is active", async () => {
    setActivePane("right");
    await mount("left");
    root.querySelectorAll(".dual-pane-pathbar-action")[1].click();
    expect(dualPane.active).toBe("left");
    expect(api.fetchFiles).toHaveBeenLastCalledWith("tank", "/docs/pics/");
  });

  it("chooses the left pane's source and folder with the picker", async () => {
    await mount("left");
    root.querySelector(".dual-pane-pathbar-source").click();
    const { props } = mutations.showPrompt.mock.calls[0][0];
    expect(props).toMatchObject({ currentSource: "tank", currentPath: "/docs/pics/", showFiles: false });
    bus.emit("pathSelected", { selectionContextId: "someone-else", source: "backup", path: "/x/" });
    expect(router.push).not.toHaveBeenCalled();
    bus.emit("pathSelected", { selectionContextId: props.selectionContextId, source: "backup", path: "/x/" });
    expect(router.push).toHaveBeenCalledWith({ path: "/files/backup/x/" });
  });

  it("marks the left folder changed on the server, as the listing's breadcrumbs did", async () => {
    state.req = { ...state.req, hasUpdate: true };
    await mount("left");
    expect(crumbs().filter((button) => button.classList.contains("has-update")).map((button) => button.dataset.path)).toEqual(["/docs/pics/"]);
  });

  it("keeps Enter and Space on its buttons from the left listing's keys", async () => {
    const listingKeys = vi.fn();
    window.addEventListener("keydown", listingKeys);
    await mount("left");
    crumb("/docs/").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    crumb("/docs/").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(listingKeys).not.toHaveBeenCalled();
    crumb("/docs/").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(listingKeys).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", listingKeys);
  });
});
