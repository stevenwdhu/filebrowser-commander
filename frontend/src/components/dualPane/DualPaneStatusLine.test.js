import { createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, api } = vi.hoisted(() => ({
  state: {
    user: { username: "alice" },
    req: { source: "tank", path: "/left/", type: "directory", items: [] },
    selected: [],
    sources: { info: { tank: {}, backup: {} }, current: "tank" },
  },
  api: { fetchFiles: vi.fn() },
}));
vi.mock("@/store", () => ({ state, getters: { pickerSorting: () => ({ by: "name", asc: true }) }, mutations: {} }));
vi.mock("@/api", () => ({ resourcesApi: api }));
import { dualPane, initDualPane, openRight, rightSelection } from "@/store/dualPane.js";
import DualPaneStatusLine from "./DualPaneStatusLine.vue";

const mounted = [];
async function mount(pane) {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(DualPaneStatusLine, { pane }) });
  app.config.globalProperties.$t = (key) => key;
  app.mount(root);
  mounted.push({ app, root });
  await nextTick();
  return root;
}
const items = [
  { name: "pics", path: "/docs/pics/", type: "directory", size: 4 },
  { name: "a.txt", path: "/docs/a.txt", type: "text/plain", size: 1 },
  { name: "b.txt", path: "/docs/b.txt", type: "text/plain", size: 2 },
];
let user = 0;

describe("DualPaneStatusLine", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    user += 1;
    initDualPane(`status${user}`);
    dualPane.shown = true;
    state.req = { source: "tank", path: "/docs/", type: "directory", items };
    state.selected = [];
    api.fetchFiles.mockResolvedValue({ items });
    await openRight("backup", "/docs/");
  });
  afterEach(() => {
    for (const { app, root } of mounted.splice(0)) {
      app.unmount();
      root.remove();
    }
  });

  it("sums up the same folder the same way in either pane", async () => {
    const left = await mount("left");
    const right = await mount("right");
    expect(left.textContent).toBe("1 general.folder | 2 general.files (7.0 bytes)");
    expect(right.innerHTML).toBe(left.innerHTML);
  });

  it("sums up each pane's selection instead while there is one", async () => {
    state.selected = [1, 2];
    rightSelection.selectOnly("/docs/pics/");
    expect((await mount("left")).textContent).toBe("2 general.selectionMultiple (3.0 bytes)");
    expect((await mount("right")).textContent).toBe("1 general.selectionSingle (4.0 bytes)");
  });

  it("says nothing about an empty folder", async () => {
    state.req = { source: "tank", path: "/empty/", type: "directory", items: [] };
    api.fetchFiles.mockResolvedValue({ items: [] });
    await openRight("backup", "/empty/");
    expect((await mount("left")).textContent.trim()).toBe("");
    expect((await mount("right")).textContent.trim()).toBe("");
  });

  it("keeps clicks from the left listing and has no menu", async () => {
    const windowClick = vi.fn();
    window.addEventListener("click", windowClick);
    try {
      const line = (await mount("left")).querySelector(".dual-pane-status-text");
      line.click();
      expect(windowClick).not.toHaveBeenCalled();
      const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      line.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(true);
    } finally {
      window.removeEventListener("click", windowClick);
    }
  });
});
