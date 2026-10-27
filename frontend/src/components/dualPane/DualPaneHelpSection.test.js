import { createApp } from "vue";
import { describe, expect, it, vi } from "vitest";

const { share } = vi.hoisted(() => ({ share: { value: false } }));
vi.mock("@/store", () => ({ getters: { isShare: () => share.value, isMobile: () => false } }));
import DualPaneHelpSection from "./DualPaneHelpSection.vue";

function render() {
  const root = document.createElement("div");
  const app = createApp(DualPaneHelpSection);
  app.config.globalProperties.$t = (key) => key;
  app.mount(root);
  return { root, app };
}

describe("DualPaneHelpSection", () => {
  it("lists the dual-pane keys with their labels", () => {
    const { root, app } = render();
    const rows = [...root.querySelectorAll(".shortcut-item")].map((row) => [row.querySelector("kbd").textContent, row.querySelector("span").textContent]);
    expect(rows[0]).toEqual(["CTRL + \\", "dualPane.toggle"]);
    expect(rows[6]).toEqual(["INSERT", "dualPane.markItem (dualPane.pane)"]);
    expect(rows.map(([keys]) => keys)).toEqual(["CTRL + \\", "TAB", "F5", "F6", "F7", "F8", "INSERT", "ALT + O", "ALT + I", "CTRL + U"]);
    app.unmount();
  });

  it("is left out inside shares, where there is no second pane", () => {
    share.value = true;
    const { root, app } = render();
    expect(root.querySelector(".shortcut-section")).toBeNull();
    app.unmount();
    share.value = false;
  });
});
