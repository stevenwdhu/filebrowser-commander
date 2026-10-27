import { createApp, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: { fetchFiles: vi.fn(), fetchFilesPublic: vi.fn() },
}));
vi.mock("@/store", () => ({
  state: {
    req: { source: "tank", path: "/", items: [] },
    selected: [],
    prompts: [],
    sources: { info: { tank: {}, backup: {} } },
  },
  getters: {
    isShare: () => false,
    shareHash: () => null,
    pickerSorting: () => ({ by: "name", asc: true }),
    sorting: () => ({ by: "name", asc: true }),
    navigationSorting: () => ({ by: "name", asc: true }),
    isMobile: () => false,
    currentPromptName: () => "move",
  },
  mutations: {},
}));
vi.mock("@/api", () => ({ resourcesApi: api }));
vi.mock("@/utils", () => ({ url: { removeLastDir: (p) => p.replace(/\/[^/]*\/?$/, "") } }));
vi.mock("@/utils/sort.js", () => ({ sortedItems: (items) => items }));
vi.mock("@/components/LoadingSpinner.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/files/ListingHeader.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/settings/ExpandDropdown.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/files/ListingItem.vue", () => ({ default: { render: () => h("div") } }));
import FileList from "./FileList.vue";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const listing = (source, path, names) => ({
  type: "directory",
  source,
  path,
  items: names.map((name) => ({ name, type: "directory", path: `${path}${name}/`, source })),
});

let app, root, emitted;
function mount() {
  root = document.createElement("div");
  document.body.append(root);
  emitted = [];
  app = createApp(FileList, { "onUpdate:selected": (payload) => emitted.push(payload) });
  app.config.globalProperties.$t = (key) => key;
  return app.mount(root);
}

describe("FileList overlapping navigations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    app?.unmount();
    root?.remove();
    vi.restoreAllMocks();
  });

  it("ignores a response that arrives after a newer jump", async () => {
    const slow = deferred();
    const fast = deferred();
    api.fetchFiles.mockImplementation((source) => (source === "tank" ? slow.promise : fast.promise));
    const vm = mount();
    emitted.length = 0;

    vm.jumpTo("tank", "/photos");
    vm.jumpTo("backup", "/archive");
    fast.resolve(listing("backup", "/archive/", ["2024"]));
    await vi.waitFor(() => expect(vm.loading).toBe(false));
    slow.resolve(listing("tank", "/photos/", ["holiday"]));
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(emitted).toEqual([expect.objectContaining({ source: "backup", path: "/archive/" })]);
    expect([vm.source, vm.path]).toEqual(["backup", "/archive/"]);
    expect(vm.items.map((item) => item.name)).toEqual(["..", "2024"]);
    expect(vm.loading).toBe(false);
  });

  it("keeps the spinner and listing of the newer jump when an older one fails late", async () => {
    const slow = deferred();
    const fast = deferred();
    api.fetchFiles.mockImplementation((source) => (source === "tank" ? slow.promise : fast.promise));
    const vm = mount();
    emitted.length = 0;

    vm.jumpTo("tank", "/gone");
    vm.jumpTo("backup", "/archive");
    slow.reject(new Error("not found"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(vm.loading).toBe(true);
    expect(emitted).toEqual([]);

    fast.resolve(listing("backup", "/archive/", ["2024"]));
    await vi.waitFor(() => expect(vm.loading).toBe(false));
    expect(emitted).toEqual([expect.objectContaining({ source: "backup", path: "/archive/" })]);
    expect(emitted[0].error).toBeUndefined();
  });

  it("still reports a failure of the latest jump", async () => {
    api.fetchFiles.mockRejectedValue(new Error("not found"));
    const vm = mount();
    emitted.length = 0;

    vm.jumpTo("tank", "/gone");
    await vi.waitFor(() => expect(vm.loading).toBe(false));
    expect(emitted).toEqual([expect.objectContaining({ source: "tank", path: "/gone/", error: true })]);
  });
});
