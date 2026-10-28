import { Teleport, createApp, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, api, mutations } = vi.hoisted(() => ({
  mutations: { showPrompt: vi.fn(), closeTopPrompt: vi.fn() },
  state: {
    user: { username: "alice", singleClick: false },
    req: { source: "tank", path: "/left/", name: "left", type: "directory", items: [] },
    selected: [],
    sources: { info: { tank: {}, backup: {} }, current: "tank" },
    prompts: [],
  },
  api: { fetchFiles: vi.fn() },
}));
vi.mock("@/store", () => ({
  state,
  getters: {
    pickerSorting: () => ({ by: "name", asc: true }),
    sourcePermissions: () => ({ create: true, modify: true, delete: true, download: true }),
    canCreateInSource: () => true,
    currentPromptName: () => state.prompts.at(-1)?.name ?? null,
  },
  mutations,
}));
vi.mock("@/api", () => ({ resourcesApi: api }));
vi.mock("@/notify", () => ({ notify: { showError: vi.fn() } }));
vi.mock("@/router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/utils/url.js", () => ({ goToItem: vi.fn(), buildItemUrl: (source, path) => `/files/${source}${path}` }));
vi.mock("@/store/eventBus", () => ({ eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
import { dualPane, initDualPane, openRight, setActivePane } from "@/store/dualPane.js";
import DualPaneKeyBar from "./DualPaneKeyBar.vue";

let app, host, root, statusBar, user = 0;
// As DualPaneHost puts the keys: into the app's status bar, beside its size slider
async function mount() {
  statusBar = document.createElement("div");
  statusBar.id = "status-bar";
  statusBar.innerHTML = '<div class="status-content"><div class="status-controls"><input id="gallery-size" type="range"></div></div>';
  host = document.createElement("div");
  document.body.append(statusBar, host);
  root = statusBar.querySelector(".status-content");
  app = createApp({ render: () => h(Teleport, { to: root }, [h(DualPaneKeyBar)]) });
  app.config.globalProperties.$t = (key) => key;
  app.mount(host);
  await nextTick();
  // Vue skips an event from the millisecond its listener was attached in, as one from before it
  await new Promise((resolve) => setTimeout(resolve, 2));
}
const keys = () => [...root.querySelectorAll(".dual-pane-keybar-button")];

describe("DualPaneKeyBar", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    user += 1;
    initDualPane(`keys${user}`);
    dualPane.shown = true;
    setActivePane("left");
    state.req = {
      source: "tank",
      path: "/left/",
      name: "left",
      type: "directory",
      items: [{ name: "x.txt", path: "/left/x.txt", type: "text/plain", size: 5 }],
    };
    state.selected = [0];
    state.prompts = [];
    api.fetchFiles.mockResolvedValue({ items: [] });
    await openRight("tank", "/docs/");
  });
  afterEach(() => {
    app?.unmount();
    statusBar?.remove();
    host?.remove();
    state.selected = [];
  });

  it("has the function keys, named, acting on the active pane", async () => {
    await mount();
    expect(keys().map((button) => button.querySelector("kbd").textContent)).toEqual(["F5", "F6", "F7", "F8"]);
    expect(keys().map((button) => button.title)).toEqual(["F5 general.copy", "F6 general.move", "F7 files.newFolder", "F8 general.delete"]);
    keys()[0].click(); // left is active: copy its selection into the right pane's folder
    expect(mutations.showPrompt).toHaveBeenLastCalledWith({
      name: "copy",
      props: {
        operation: "copy",
        items: [{ path: "/left/x.txt", source: "tank", name: "x.txt", type: "text/plain", size: 5 }],
        destination: { source: "tank", path: "/docs/" },
      },
    });
    keys()[2].click();
    expect(mutations.showPrompt).toHaveBeenLastCalledWith({ name: "newDir", props: { base: { source: "tank", path: "/left/" }, redirect: false } });
    setActivePane("right");
    keys()[2].click();
    expect(mutations.showPrompt).toHaveBeenLastCalledWith({ name: "newDir", props: { base: { source: "tank", path: "/docs/" }, redirect: false } });
  });

  it("keeps the bar's clicks and keys, on its keys and the size slider, from the left listing", async () => {
    const windowClick = vi.fn();
    const windowKeydown = vi.fn();
    window.addEventListener("click", windowClick);
    window.addEventListener("keydown", windowKeydown);
    try {
      await mount();
      const slider = statusBar.querySelector("#gallery-size");
      keys()[2].click();
      slider.click();
      expect(windowClick).not.toHaveBeenCalled();
      for (const target of [keys()[2], slider]) {
        for (const pressed of ["Enter", " ", "ArrowDown", "Backspace"]) {
          target.dispatchEvent(new KeyboardEvent("keydown", { key: pressed, bubbles: true }));
        }
      }
      expect(windowKeydown).not.toHaveBeenCalled();

      // With a prompt open, Enter on the focused key belongs to the prompt and the bar does nothing
      state.prompts.push({ name: "newDir" });
      keys()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(windowKeydown).toHaveBeenCalledOnce();
      const calls = mutations.showPrompt.mock.calls.length;
      keys()[3].click();
      expect(mutations.showPrompt.mock.calls.length).toBe(calls);
      state.prompts.pop();

      // Without both panes, it's the app's own status bar again
      dualPane.shown = false;
      slider.click();
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(windowClick).toHaveBeenCalledOnce();
      expect(windowKeydown).toHaveBeenCalledTimes(2);

      // Nor after the keys are gone
      dualPane.shown = true;
      app.unmount();
      app = null;
      slider.click();
      expect(windowClick).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("click", windowClick);
      window.removeEventListener("keydown", windowKeydown);
    }
  });
});
