import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store, jumpTo, api } = vi.hoisted(() => ({
  store: { share: false, user: null, readOnlySources: [] },
  jumpTo: vi.fn(),
  api: { fetchFiles: vi.fn(), moveCopy: vi.fn(), post: vi.fn() },
}));
vi.mock("@/store", () => ({
  state: {
    get user() { return store.user; },
    sources: { info: { tank: {}, backup: {} } },
    req: { source: "tank", path: "/", items: [] },
    selected: [],
    isSearchActive: false,
    shareInfo: null,
  },
  getters: {
    isShare: () => store.share,
    canCreateInSource: (source) => !store.readOnlySources.includes(source),
    sourcePermissions: (source) => {
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
    props: { hidePathChrome: Boolean, sortable: Boolean, filterQuery: String },
    emits: ["update:selected", "update:filterQuery"],
    methods: { jumpTo },
    render() { return h("div", this.$slots.sticky?.()); },
  },
}));
import { loadRecentDestinations, recordRecentDestination } from "@/utils/moveCopyDestinations.js";
import MoveCopy from "./MoveCopy.vue";

let app, root;
function mount(props = {}) {
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(MoveCopy, { operation: "copy", items: [{ path: "/a.txt", source: "tank", name: "a.txt" }], ...props });
  app.config.globalProperties.$t = (key) => key;
  return app.mount(root);
}
const chips = (testId) => [...root.querySelectorAll(`[data-testid="${testId}"]`)];
const chipText = (testId) => chips(testId).map((chip) => chip.querySelector(".quick-destination-name").textContent);
const pressEnter = (element) => {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
};

describe("MoveCopy quick destinations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    store.share = false;
    store.readOnlySources = [];
    store.user = {
      username: "alice",
      sidebarLinks: [
        { category: "source", sourceName: "tank", target: "/", name: "Tank" },
        { category: "tool", target: "/tools", name: "Tools" },
        { category: "source-minimal", sourceName: "backup", target: "/archive", name: "Archive" },
      ],
    };
  });
  afterEach(() => {
    app?.unmount();
    root?.remove();
  });

  it("shows source-type sidebar links as favorites and stored recents that aren't favorites", () => {
    recordRecentDestination("alice", "backup", "/archive/");
    recordRecentDestination("alice", "tank", "/photos/2024/");
    mount();
    expect(chipText("move-copy-favorite")).toEqual(["Tank", "Archive"]);
    expect(chipText("move-copy-recent")).toEqual(["2024"]);
  });

  it("adds the parent folder when two recents in one source share a name", () => {
    recordRecentDestination("alice", "tank", "/photos/2024/");
    recordRecentDestination("alice", "tank", "/documents/2024/");
    recordRecentDestination("alice", "backup", "/2024/");
    mount();
    expect(chipText("move-copy-recent")).toEqual(["2024", "documents/2024", "photos/2024"]);
  });

  it("jumps the file list to a favorite when its chip is clicked", async () => {
    const vm = mount();
    chips("move-copy-favorite")[1].click();
    await vi.waitFor(() => expect(jumpTo).toHaveBeenCalledWith("backup", "/archive/"));
    expect([vm.destSource, vm.destPath]).toEqual(["backup", "/archive/"]);
    await nextTick();
    expect(chips("move-copy-favorite")[1].getAttribute("aria-current")).toBe("true");
    expect(chips("move-copy-favorite")[0].hasAttribute("aria-current")).toBe(false);
  });

  it("selects a chip on Enter, then lets Enter on the same chip confirm the prompt", async () => {
    recordRecentDestination("alice", "tank", "/photos/");
    const vm = mount();
    const [chip] = chips("move-copy-recent");
    expect(pressEnter(chip).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(jumpTo).toHaveBeenCalledWith("tank", "/photos/"));
    expect(vm.destPath).toBe("/photos/");
    await nextTick();
    // Prompts.vue clicks Copy/Move on any Enter that wasn't default-prevented
    expect(pressEnter(chip).defaultPrevented).toBe(false);
    expect(jumpTo).toHaveBeenCalledOnce();
  });

  it("hides destinations in sources the user can't write to", () => {
    store.readOnlySources = ["backup"];
    recordRecentDestination("alice", "backup", "/other/");
    mount();
    expect(chipText("move-copy-favorite")).toEqual(["Tank"]);
    expect(chips("move-copy-recent")).toHaveLength(0);
  });

  it("shows no quick destinations inside a share", () => {
    store.share = true;
    recordRecentDestination("alice", "tank", "/photos/");
    mount();
    expect(root.querySelector(".quick-destinations")).toBeNull();
  });

  it("records the destination after a successful copy", async () => {
    api.fetchFiles.mockResolvedValue({ items: [] });
    api.moveCopy.mockResolvedValue({ succeeded: [{}], failed: [] });
    const vm = mount();
    vm.destSource = "backup";
    vm.destPath = "/archive/2024/";
    await nextTick();
    root.querySelector('button[aria-label="general.copy"]').click();
    await vi.waitFor(() => expect(vm.isLoading).toBe(false));
    expect(api.moveCopy).toHaveBeenCalledOnce();
    expect(loadRecentDestinations("alice").map((d) => d.key)).toEqual(["backup::/archive/2024/"]);
  });

  it("does not record the destination when every item failed", async () => {
    api.fetchFiles.mockResolvedValue({ items: [] });
    api.moveCopy.mockResolvedValue({ succeeded: [], failed: [{ message: "nope" }] });
    const vm = mount();
    vm.destSource = "backup";
    vm.destPath = "/archive/";
    await nextTick();
    root.querySelector('button[aria-label="general.copy"]').click();
    await vi.waitFor(() => expect(api.moveCopy).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(vm.isLoading).toBe(false));
    expect(loadRecentDestinations("alice")).toEqual([]);
  });
});
