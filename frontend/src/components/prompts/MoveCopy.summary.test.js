import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store, state, api, fileListProps, jumpTo } = vi.hoisted(() => ({
  store: { readOnlySources: [], share: null },
  state: {
    user: { username: "alice", sidebarLinks: [] },
    sources: { info: { tank: {}, backup: {} } },
    req: { source: "tank", path: "/", type: "directory", items: [] },
    selected: [],
    isSearchActive: false,
    shareInfo: null,
  },
  api: { fetchFiles: vi.fn(), moveCopy: vi.fn() },
  fileListProps: {},
  jumpTo: vi.fn(),
}));
vi.mock("@/store", () => ({
  state,
  getters: {
    // store.share holds the share's permissions while browsing a share
    isShare: () => Boolean(store.share),
    canCreateInSource: (source) => !store.readOnlySources.includes(source),
    sourcePermissions: (source) => {
      if (store.share) return store.share;
      const writable = !store.readOnlySources.includes(source);
      return { create: writable, modify: writable };
    },
    isPreviewView: () => false,
  },
  mutations: { setReload: vi.fn(), closeTopPrompt: vi.fn(), setSearch: vi.fn(), showPrompt: vi.fn() },
}));
vi.mock("@/api", () => ({ resourcesApi: api }));
vi.mock("@/utils", () => ({ url: { removeLastDir: (p) => p.replace(/\/[^/]*\/?$/, "") } }));
vi.mock("@/utils/upload", () => ({ checkConflict: vi.fn(() => false) }));
vi.mock("@/notify", () => ({ notify: { showError: vi.fn(), showSuccess: vi.fn(), showSuccessToast: vi.fn() } }));
vi.mock("@/utils/appNotifications", () => ({
  notifyMoveCopyComplete: vi.fn(),
  notifyOperationError: vi.fn(),
  notifyMoveCopyFailure: vi.fn(),
  extractMoveCopyErrorMessage: vi.fn(() => "failed"),
}));
vi.mock("@/utils/notificationActions", () => ({ goToItemNotificationButton: vi.fn() }));
vi.mock("@/components/LoadingSpinner.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/files/ListingFilter.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/files/FileList.vue", () => ({
  default: {
    name: "FileList",
    props: { browsePath: String, openOnClick: Boolean },
    methods: { jumpTo },
    render() {
      fileListProps.browsePath = this.browsePath;
      fileListProps.openOnClick = this.openOnClick;
      return h("div", this.$slots.sticky?.());
    },
  },
}));
import MoveCopy from "./MoveCopy.vue";

let app, root;
function mount(operation, items, props = {}) {
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(MoveCopy, { operation, items, promptId: 7, ...props });
  app.config.globalProperties.$t = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);
  return app.mount(root);
}
// Text of each child element, space separated
const text = (testId) => {
  const element = root.querySelector(`[data-testid="${testId}"]`);
  return element && [...element.children].map((child) => child.textContent.trim()).filter(Boolean).join(" ");
};
// Source and path on the destination row
const destination = () => {
  const row = root.querySelector('[data-testid="move-copy-destination"]');
  if (!row) return null;
  const select = row.querySelector("select");
  const chip = row.querySelector(".move-copy-summary-source");
  return {
    source: select ? select.value : (chip?.textContent ?? null),
    path: row.querySelector(".move-copy-destination-crumbs, .move-copy-summary-text").textContent,
  };
};
const actionButton = (operation) => root.querySelector(`button[aria-label="general.${operation}"]`);
const folder = (path, source = "tank") => ({ path, source, type: "directory", name: path.split("/").filter(Boolean).pop() });

describe("MoveCopy summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.readOnlySources = [];
    store.share = null;
    state.req = { source: "tank", path: "/", type: "directory", items: [] };
    state.selected = [];
    state.sources.info = { tank: {}, backup: {} };
    state.user.singleClick = false;
    api.fetchFiles.mockResolvedValue({ items: [] });
  });
  afterEach(() => {
    app?.unmount();
    root?.remove();
  });

  it("names a single item and shows where it goes", async () => {
    const vm = mount("copy", [{ ...folder("/photos/"), size: 2048 }]);
    await nextTick();
    expect(text("move-copy-items")).toBe("folder photos 2.0 KB");
    vm.destSource = "backup";
    vm.destPath = "/archive/";
    await nextTick();
    expect(destination()).toEqual({ source: "backup", path: "/archive/" });
  });

  it("changes the destination from its own row rather than a second picker", async () => {
    const vm = mount("copy", [folder("/photos/")]);
    vm.updateDestination({ path: "/media/movies/", source: "tank" });
    await nextTick();
    expect(root.querySelector(".unified-path-picker")).toBeNull();
    const crumb = [...root.querySelectorAll('[data-testid="move-copy-destination-crumb"]')].find(
      (button) => button.textContent === "media",
    );
    crumb.click();
    await nextTick();
    expect(jumpTo).toHaveBeenLastCalledWith("tank", "/media/");
    expect(destination()).toEqual({ source: "tank", path: "/media/" });

    const select = root.querySelector('[data-testid="move-copy-destination-source"]');
    select.value = "backup";
    select.dispatchEvent(new Event("change"));
    await nextTick();
    expect(jumpTo).toHaveBeenLastCalledWith("backup", "/");
    expect(destination()).toEqual({ source: "backup", path: "/" });
  });

  it("goes back to the folder it started in when the source is switched back", async () => {
    state.req = { source: "tank", path: "/photos/2024/", type: "directory", items: [] };
    const vm = mount("copy", [folder("/photos/2024/a/")]);
    vm.updateDestination({ path: "/photos/2024/", source: "tank" });
    await nextTick();
    const select = root.querySelector('[data-testid="move-copy-destination-source"]');
    select.value = "backup";
    select.dispatchEvent(new Event("change"));
    await nextTick();
    expect(jumpTo).toHaveBeenLastCalledWith("backup", "/");
    select.value = "tank";
    select.dispatchEvent(new Event("change"));
    await nextTick();
    expect(jumpTo).toHaveBeenLastCalledWith("tank", "/photos/2024/");
    expect(destination()).toEqual({ source: "tank", path: "/photos/2024/" });
  });

  it("opens folders on a single click when the user has the single-click setting on", async () => {
    mount("copy", [folder("/a/")]);
    await nextTick();
    expect(fileListProps.openOnClick).toBe(false);
    app.unmount();
    state.user.singleClick = true;
    mount("copy", [folder("/a/")]);
    await nextTick();
    expect(fileListProps.openOnClick).toBe(true);
  });

  it("keeps the destination row as plain text inside a share and while the items are copied", async () => {
    store.share = { modify: true, create: true };
    mount("copy", [folder("/a/")]);
    await nextTick();
    expect(root.querySelector('[data-testid="move-copy-destination-crumb"]')).toBeNull();
    expect(root.querySelector('[data-testid="move-copy-destination-edit"]')).toBeNull();
    app.unmount();
    store.share = null;
    api.moveCopy.mockImplementation(() => new Promise(() => {}));
    const vm = mount("copy", [folder("/a/")]);
    vm.destSource = "backup";
    await nextTick();
    expect(root.querySelector('[data-testid="move-copy-destination-edit"]')).not.toBeNull();
    actionButton("copy").click();
    await vi.waitFor(() => expect(vm.isLoading).toBe(true));
    await nextTick();
    expect(root.querySelector('[data-testid="move-copy-destination-edit"]')).toBeNull();
    expect(root.querySelector('[data-testid="move-copy-destination-source"]')).toBeNull();
  });

  it("counts folders and files when there are several", async () => {
    mount("copy", [folder("/a/"), folder("/b/"), { path: "/c.txt", source: "tank", name: "c.txt" }]);
    await nextTick();
    expect(text("move-copy-items")).toBe("file_copy 2 general.folders, 1 general.file");
  });

  it("blocks the action and says why when a folder would go into itself", async () => {
    const vm = mount("move", [folder("/photos/")]);
    vm.destSource = "tank";
    vm.destPath = "/photos/2024/";
    await nextTick();
    const button = actionButton("move");
    // Still focusable, so the reason is read out
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(text("move-copy-blocked")).toBe("warning prompts.moveCopyIntoItself");
    expect(root.querySelector('[role="status"] #move-copy-blocked-7')).not.toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe("move-copy-blocked-7");
    expect(button.title).toBe("prompts.moveCopyIntoItself");
    button.click();
    await nextTick();
    expect(api.fetchFiles).not.toHaveBeenCalled();
    expect(api.moveCopy).not.toHaveBeenCalled();

    vm.destPath = "/other/";
    await nextTick();
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(text("move-copy-blocked")).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("allows copying inside a share that allows modify but not create", async () => {
    store.share = { modify: true, create: false };
    mount("copy", [folder("/a/")]);
    await nextTick();
    expect(actionButton("copy").hasAttribute("aria-disabled")).toBe(false);
    store.share = { modify: false, create: true };
    app.unmount();
    mount("copy", [folder("/a/")]);
    await nextTick();
    expect(text("move-copy-blocked")).toBe("warning prompts.moveCopyNoPermission");
  });

  it("shows only the spinner for a drag and drop move it does not run itself", async () => {
    state.req = { source: "tank", path: "/docs/", type: "directory", items: [{ path: "/docs/a.txt", name: "a.txt" }] };
    state.selected = [0];
    const vm = mount("move", null, { operationInProgress: true });
    vm.updateDestination({ path: "/docs/", source: "tank" });
    await nextTick();
    expect(text("move-copy-destination")).toBeNull();
    expect(text("move-copy-blocked")).toBeNull();
    expect(actionButton("move").hasAttribute("aria-describedby")).toBe(false);
  });

  it("starts in the folder of a previewed file and only names the source when there are several", async () => {
    state.req = { source: "tank", path: "/docs/report.pdf", type: "application/pdf", items: [] };
    mount("copy", [{ path: "/docs/report.pdf", source: "tank", name: "report.pdf" }]);
    await nextTick();
    expect(fileListProps.browsePath).toBe("/docs/");
    expect(destination().source).toBe("tank");
    app.unmount();
    state.sources.info = { tank: {} };
    mount("copy", [{ path: "/docs/report.pdf", source: "tank", name: "report.pdf" }]);
    await nextTick();
    expect(destination().source).toBeNull();
  });

  it("explains a read-only destination and one that failed to load", async () => {
    store.readOnlySources = ["backup"];
    const vm = mount("copy", [folder("/photos/")]);
    vm.updateDestination({ path: "/", source: "backup" });
    await nextTick();
    expect(text("move-copy-blocked")).toBe("warning prompts.moveCopyNoPermission");
    vm.updateDestination({ path: "/gone/", source: "tank", error: true });
    await nextTick();
    expect(text("move-copy-blocked")).toBe("warning files.cannotAccesDir");
    vm.updateDestination({ path: "/", source: "tank" });
    await nextTick();
    expect(text("move-copy-blocked")).toBeNull();
  });

  it("copies several items one request at a time and shows progress", async () => {
    const pending = [];
    api.moveCopy.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const vm = mount("copy", [folder("/a/"), folder("/b/")]);
    vm.destSource = "backup";
    vm.destPath = "/archive/";
    await nextTick();
    actionButton("copy").click();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await nextTick();
    const bar = root.querySelector('[role="progressbar"]');
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("2");
    expect(root.querySelector(".move-copy-progress-current").textContent).toBe("a");

    pending[0]({ succeeded: [{}], failed: [] });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await nextTick();
    expect(root.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("1");

    pending[1]({ succeeded: [{}], failed: [] });
    await vi.waitFor(() => expect(vm.isLoading).toBe(false));
    expect(api.moveCopy.mock.calls.map(([batch]) => batch.map((item) => item.to))).toEqual([["/archive/a"], ["/archive/b"]]);
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("shows an indeterminate bar for a single item", async () => {
    api.moveCopy.mockImplementation(() => new Promise(() => {}));
    const vm = mount("copy", [folder("/a/")]);
    vm.destSource = "backup";
    await nextTick();
    actionButton("copy").click();
    await vi.waitFor(() => expect(root.querySelector('[role="progressbar"]')).not.toBeNull());
    expect(root.querySelector('[role="progressbar"]').hasAttribute("aria-valuenow")).toBe(false);
    expect(text("move-copy-progress")).toBe("prompts.operationInProgress");
  });
});
