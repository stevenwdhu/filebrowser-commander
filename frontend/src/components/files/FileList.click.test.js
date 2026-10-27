import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: { fetchFiles: vi.fn(), fetchFilesPublic: vi.fn() },
}));
vi.mock("@/store", () => ({
  state: {
    req: { source: "tank", path: "/", items: [] },
    selected: [],
    prompts: [],
    sources: { info: { tank: {} } },
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
// A row that passes the list's click and dblclick listeners through to its element
vi.mock("@/components/files/ListingItem.vue", () => ({
  default: { props: ["name"], render() { return h("div", { class: "row", "data-name": this.name }); } },
}));
import FileList from "./FileList.vue";

const listing = (path, names) => ({
  type: "directory",
  source: "tank",
  path,
  items: names.map((name) => ({ name, type: "directory", path: `${path}${name}/`, source: "tank" })),
});

let app, root, emitted;
async function mount(props = {}, container = document.body) {
  root = document.createElement("div");
  container.append(root);
  emitted = [];
  app = createApp(FileList, { browsePath: "/media/", ...props, "onUpdate:selected": (payload) => emitted.push(payload) });
  app.config.globalProperties.$t = (key) => key;
  const vm = app.mount(root);
  await vi.waitFor(() => expect(vm.loading).toBe(false));
  await nextTick();
  emitted.length = 0;
  api.fetchFiles.mockClear();
  return vm;
}
const row = (name) => root.querySelector(`.row[data-name="${name}"]`);

describe("FileList clicks on folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchFiles.mockImplementation((_source, path) =>
      Promise.resolve(listing(path, path === "/media/" ? ["movies"] : [])),
    );
  });
  afterEach(() => {
    app?.unmount();
    root?.remove();
    document.querySelector(".floating-window")?.remove();
  });

  it("selects a folder on a single click and opens it on a double click", async () => {
    const vm = await mount();
    row("movies").click();
    expect(emitted).toEqual([expect.objectContaining({ path: "/media/movies/" })]);
    expect(vm.selected).toBe("/media/movies/");
    expect(api.fetchFiles).not.toHaveBeenCalled();

    row("movies").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(api.fetchFiles).toHaveBeenCalledWith("tank", "/media/movies/");
  });

  it("opens a folder on a single click with openOnClick, so the open folder is the destination", async () => {
    const vm = await mount({ openOnClick: true });
    row("movies").click();
    expect(api.fetchFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchFiles).toHaveBeenCalledWith("tank", "/media/movies/");
    expect(vm.selected).toBeNull();
    // Reported straight away, so Copy/Move during the load doesn't go to the folder it left
    expect(emitted).toEqual([expect.objectContaining({ path: "/media/movies/", source: "tank", type: "directory" })]);
    emitted.length = 0;
    // The double click that follows doesn't open the folder a second time
    vm.handleItemDblClick({ name: "movies", path: "/media/movies/", type: "directory" }, 1, new MouseEvent("dblclick"));
    expect(api.fetchFiles).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(vm.loading).toBe(false));
    expect(emitted).toEqual([expect.objectContaining({ path: "/media/movies/", type: "directory" })]);

    row("..").click();
    expect(api.fetchFiles).toHaveBeenLastCalledWith("tank", "/media/");
  });

  it("ignores the second click of a double click that lands on the opened folder's rows", async () => {
    const vm = await mount({ openOnClick: true });
    row("movies").click();
    await vi.waitFor(() => expect(vm.loading).toBe(false));
    await nextTick();
    row("..").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    expect(api.fetchFiles).toHaveBeenCalledTimes(1);
    expect(vm.path).toBe("/media/movies/");
  });

  it("reports a file as a folder it can't open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const vm = await mount();
    api.fetchFiles.mockResolvedValueOnce({ type: "text/markdown", source: "tank", path: "/media/notes.md" });
    vm.jumpTo("tank", "/media/notes.md");
    await vi.waitFor(() => expect(vm.loading).toBe(false));
    expect(emitted).toEqual([expect.objectContaining({ path: "/media/notes.md/", error: true })]);
    expect(vm.items.map((item) => item.name)).toEqual([".."]);
    console.error.mockRestore();
  });
});

describe("FileList scrolling in a prompt", () => {
  beforeEach(() => {
    api.fetchFiles.mockResolvedValue(listing("/media/", []));
  });
  afterEach(() => {
    app?.unmount();
    root?.remove();
    document.querySelector(".floating-window")?.remove();
  });
  function prompt(withPane) {
    const frame = document.createElement("div");
    frame.className = "floating-window";
    const content = document.createElement("div");
    content.className = "card-content";
    frame.append(content);
    document.body.append(frame);
    if (!withPane) return { content, container: content };
    const pane = document.createElement("div");
    pane.style.overflowY = "auto";
    content.append(pane);
    return { content, container: pane };
  }

  it("follows the prompt's scrolling, or a pane inside it that scrolls on its own", async () => {
    let target = prompt(false);
    let vm = await mount({}, target.container);
    expect(vm.scrollContainer).toBe(target.content);
    app.unmount();
    document.querySelector(".floating-window").remove();

    target = prompt(true);
    vm = await mount({}, target.container);
    expect(vm.scrollContainer).toBe(target.container);
  });
});
