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
    props: { browsePath: String, browseSource: String, openOnClick: Boolean },
    methods: { jumpTo },
    render() {
      fileListProps.browsePath = this.browsePath;
      fileListProps.browseSource = this.browseSource;
      fileListProps.openOnClick = this.openOnClick;
      return h("div", this.$slots.sticky?.());
    },
  },
}));
import { dualPane } from "@/store/dualPane.js";
import { MOVE_COPY_PROGRESS_EVENT } from "@/utils/moveCopyPlan.js";
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
const status = () => root.querySelector(".move-copy-progress-status")?.textContent;
const timing = () => text("move-copy-timing");
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
    state.realtimeActive = false;
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

  it("starts in a given destination, or in the other pane while both are shown", async () => {
    mount("copy", [folder("/photos/")], { destination: { source: "backup", path: "/archive" } });
    await nextTick();
    expect([fileListProps.browseSource, fileListProps.browsePath]).toEqual(["backup", "/archive/"]);
    expect(destination()).toEqual({ source: "backup", path: "/archive/" });
    app.unmount();

    Object.assign(dualPane, { shown: true });
    Object.assign(dualPane.right, { source: "backup", path: "/inbox/", error: false });
    mount("copy", [folder("/photos/")]);
    await nextTick();
    expect([fileListProps.browseSource, fileListProps.browsePath]).toEqual(["backup", "/inbox/"]);
    Object.assign(dualPane, { shown: false });
  });

  it("goes back to the other pane's folder, or the listing's, when the source is switched back", async () => {
    state.req = { source: "tank", path: "/photos/", type: "directory", items: [] };
    mount("copy", [folder("/photos/a/")], { destination: { source: "backup", path: "/inbox/" } });
    await nextTick();
    const select = root.querySelector('[data-testid="move-copy-destination-source"]');
    const switchTo = async (source) => {
      select.value = source;
      select.dispatchEvent(new Event("change"));
      await nextTick();
    };
    await switchTo("tank");
    expect(jumpTo).toHaveBeenLastCalledWith("tank", "/photos/");
    await switchTo("backup");
    expect(jumpTo).toHaveBeenLastCalledWith("backup", "/inbox/");
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
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(root.querySelector(".move-copy-progress-current").textContent).toBe("a");

    pending[0]({ succeeded: [{}], failed: [] });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await nextTick();
    expect(root.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("50");

    pending[1]({ succeeded: [{}], failed: [] });
    await vi.waitFor(() => expect(vm.isLoading).toBe(false));
    expect(api.moveCopy.mock.calls.map(([batch]) => batch.map((item) => item.to))).toEqual([["/archive/a"], ["/archive/b"]]);
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("with the event stream, shows the bytes of the item each batch is on", async () => {
    state.realtimeActive = true;
    const pending = [];
    api.moveCopy.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const vm = mount("copy", [folder("/a/"), folder("/b/")]);
    vm.destSource = "backup";
    vm.destPath = "/archive/";
    await nextTick();
    actionButton("copy").click();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const firstId = api.moveCopy.mock.calls[0][4];
    expect(firstId).toMatch(/-0$/);
    const report = (detail) => window.dispatchEvent(new CustomEvent(MOVE_COPY_PROGRESS_EVENT, { detail }));
    const bar = () => root.querySelector('[role="progressbar"]');
    const MB = 1024 * 1024;

    report({ id: "someone else's", items: 0, totalItems: 1, current: "x", copied: 1, size: 2 });
    report({ id: firstId, items: 0, totalItems: 1, current: "a", copied: 3 * MB, size: 4 * MB });
    await nextTick();
    // Half the items, three quarters into the first: 37%
    expect(bar().getAttribute("aria-valuenow")).toBe("37");
    expect(root.querySelector(".move-copy-progress-fill").style.width).toBe("37%");
    expect(root.querySelector(".move-copy-progress-current").textContent).toBe("a");
    const bytes = 'prompts.moveCopyBytesProgress {"done":"3.0 MB","total":"4.0 MB"}';
    expect(root.querySelector(".move-copy-progress-bytes").textContent).toBe(bytes);
    expect(bar().getAttribute("aria-label")).toBe(`prompts.moveCopyProgress {"done":0,"total":2}, a, ${bytes}`);

    pending[0]({ succeeded: [{}], failed: [] });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    const secondId = api.moveCopy.mock.calls[1][4];
    expect(secondId).toBe(firstId.replace(/-0$/, "-1"));
    // A late report from the first batch moves nothing on screen
    report({ id: firstId, items: 1, totalItems: 1, current: "", copied: 0, size: 0 });
    await nextTick();
    expect(bar().getAttribute("aria-valuenow")).toBe("50");
    expect(root.querySelector(".move-copy-progress-status").textContent).toContain('prompts.moveCopyProgress {"done":1,"total":2}');
    report({ id: secondId, items: 0, totalItems: 1, current: "b", copied: 4 * MB, size: 4 * MB });
    await nextTick();
    // Every byte of the last item is copied, but it isn't through yet
    expect(bar().getAttribute("aria-valuenow")).toBe("99");
    expect(root.querySelector(".move-copy-progress-current").textContent).toBe("b");

    pending[1]({ succeeded: [{}], failed: [] });
    await vi.waitFor(() => expect(vm.isLoading).toBe(false));
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("shows the bytes of a single item without counting items", async () => {
    state.realtimeActive = true;
    api.moveCopy.mockImplementation(() => new Promise(() => {}));
    const vm = mount("copy", [folder("/big/")]);
    vm.destSource = "backup";
    await nextTick();
    actionButton("copy").click();
    await vi.waitFor(() => expect(api.moveCopy).toHaveBeenCalledTimes(1));
    const id = api.moveCopy.mock.calls[0][4];
    window.dispatchEvent(new CustomEvent(MOVE_COPY_PROGRESS_EVENT, {
      detail: { id, items: 0, totalItems: 1, current: "big", copied: 1, size: 4 },
    }));
    await nextTick();
    expect(root.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("25");
    expect(status()).toBe('bigprompts.moveCopyBytesProgress {"done":"1.0 bytes","total":"4.0 bytes"}');
    expect(timing()).toMatch(/^prompts.moveCopyElapsed \{"time":"0:00"\}\s*prompts.moveCopyEstimating$/);
  });

  it("without the event stream, asks for no progress reports", async () => {
    api.moveCopy.mockResolvedValue({ succeeded: [{}], failed: [] });
    const vm = mount("copy", [folder("/a/")]);
    vm.destSource = "backup";
    await nextTick();
    actionButton("copy").click();
    await vi.waitFor(() => expect(api.moveCopy).toHaveBeenCalledTimes(1));
    expect(api.moveCopy.mock.calls[0][4]).toBeUndefined();
  });

  it("shows an indeterminate bar for a single item", async () => {
    api.moveCopy.mockImplementation(() => new Promise(() => {}));
    const vm = mount("copy", [folder("/a/")]);
    vm.destSource = "backup";
    await nextTick();
    actionButton("copy").click();
    await vi.waitFor(() => expect(root.querySelector('[role="progressbar"]')).not.toBeNull());
    expect(root.querySelector('[role="progressbar"]').hasAttribute("aria-valuenow")).toBe(false);
    expect(status()).toBe("prompts.operationInProgress");
    // Without byte reports there's nothing to estimate from: elapsed time only
    expect(timing()).toBe('prompts.moveCopyElapsed {"time":"0:00"}');
  });

  it("stops the clock once the operation is over", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      let finish;
      api.moveCopy.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const vm = mount("copy", [folder("/a/")]);
      vm.destSource = "backup";
      await nextTick();
      actionButton("copy").click();
      await vi.waitFor(() => expect(api.moveCopy).toHaveBeenCalledTimes(1));
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      finish({ succeeded: [{}], failed: [] });
      await vi.waitFor(() => expect(vm.isLoading).toBe(false));
      vi.advanceTimersByTime(3000);
      await nextTick();
      expect(vm.progress).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows elapsed time, speed and time left, with the bar weighted by size", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(0);
    try {
      state.realtimeActive = true;
      const pending = [];
      api.moveCopy.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
      const GB = 1024 ** 3;
      // 1 GB, then 3 GB: one request each
      const vm = mount("copy", [{ ...folder("/small/"), size: GB }, { ...folder("/big/"), size: 3 * GB }]);
      vm.destSource = "backup";
      await nextTick();
      actionButton("copy").click();
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      const startedAt = vm.progress.startedAt;
      const id = api.moveCopy.mock.calls[0][4];
      const reportAt = async (at, detail) => {
        vi.setSystemTime(startedAt + at);
        // One file in this request: everything it wrote is the file's
        window.dispatchEvent(new CustomEvent(MOVE_COPY_PROGRESS_EVENT, {
          detail: { id, totalItems: 1, items: 0, bytes: detail.copied, ...detail },
        }));
        await nextTick();
      };
      const bar = () => root.querySelector('[role="progressbar"]').getAttribute("aria-valuenow");
      const left = () => root.querySelector(".move-copy-progress-left")?.textContent;

      await reportAt(1000, { current: "small", copied: GB / 2, size: GB });
      // Half of the first GB is an eighth of the whole
      expect(bar()).toBe("12");
      expect(left()).toBe("prompts.moveCopyEstimating");
      expect(root.querySelector(".move-copy-progress-speed")).toBeNull();

      await reportAt(3000, { current: "small", copied: GB, size: GB });
      // Half a GB in the 2 s since the first report, and 3 GB to go at that pace: 12 s, shown as 15
      expect(bar()).toBe("25");
      expect(vm.progress.bytesPerSecond).toBeCloseTo(GB / 4, -6);
      expect(root.querySelector(".move-copy-progress-speed").textContent).toMatch(/^[\d.]+ MB\/s$/);
      expect(left()).toBe('prompts.moveCopyTimeLeft {"time":"15 seconds"}');
      // Another operation's bytes don't count
      window.dispatchEvent(new CustomEvent(MOVE_COPY_PROGRESS_EVENT, {
        detail: { id: "another-0", totalItems: 1, items: 0, copied: 0, size: 0, bytes: 100 * GB },
      }));
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(vm.progress.bytesPerSecond).toBeLessThan(GB);

      // The elapsed time ticks on its own between reports, and a stall turns into estimating again
      vi.advanceTimersByTime(62000);
      await nextTick();
      expect(timing()).toMatch(/^prompts.moveCopyElapsed \{"time":"1:0\d"\}/);
      expect(left()).toBe("prompts.moveCopyEstimating");
      expect(root.querySelector(".move-copy-progress-speed")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
