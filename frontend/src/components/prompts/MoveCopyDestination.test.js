import { createApp, h, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MoveCopyDestination from "./MoveCopyDestination.vue";

let app, root, props, onNavigate;
function mount(initial = {}) {
  props = reactive({ source: "tank", path: "/media/movies/", showSource: true, sources: ["tank", "backup"], interactive: true, ...initial });
  onNavigate = vi.fn();
  root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render: () => h(MoveCopyDestination, { ...props, onNavigate }) });
  app.config.globalProperties.$t = (key) => key;
  app.mount(root);
}
const find = (testId) => root.querySelector(`[data-testid="${testId}"]`);
const crumbs = () => [...root.querySelectorAll('[data-testid="move-copy-destination-crumb"]')];
const press = (element, key, init = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
};
// Records keydowns that reach the window, where Prompts.vue confirms (Enter) or closes (Escape)
let reachedWindow;
const onWindowKeydown = (event) => reachedWindow.push(event.key);
async function edit(value) {
  find("move-copy-destination-edit").click();
  await nextTick();
  const input = find("move-copy-destination-input");
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return input;
}

describe("MoveCopyDestination", () => {
  beforeEach(() => {
    reachedWindow = [];
    window.addEventListener("keydown", onWindowKeydown);
  });
  afterEach(() => {
    window.removeEventListener("keydown", onWindowKeydown);
    app?.unmount();
    root?.remove();
  });

  it("shows each folder of the path as a button that opens it", () => {
    mount();
    expect(crumbs().map((crumb) => crumb.textContent)).toEqual(["/", "media", "movies"]);
    expect(crumbs()[0].getAttribute("aria-label")).toBe("general.home");
    expect(find("move-copy-destination").querySelector(".move-copy-destination-crumbs").textContent).toBe("/media/movies/");
    expect(crumbs().map((crumb) => crumb.getAttribute("aria-current"))).toEqual([null, null, "location"]);
    crumbs()[1].click();
    crumbs()[0].click();
    expect(onNavigate.mock.calls).toEqual([[{ source: "tank", path: "/media/" }], [{ source: "tank", path: "/" }]]);
  });

  it("handles Enter on its own controls so it never confirms the prompt", async () => {
    mount();
    // Prompts.vue clicks Copy/Move on an Enter that nothing prevented
    expect(press(crumbs()[1], "Enter").defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenLastCalledWith({ source: "tank", path: "/media/" });
    expect(press(find("move-copy-destination-source"), "Enter").defaultPrevented).toBe(true);
    expect(press(find("move-copy-destination-edit"), "Enter").defaultPrevented).toBe(true);
    await nextTick();
    expect(find("move-copy-destination-input")).not.toBeNull();
  });

  it("switches to another source", async () => {
    mount();
    const select = find("move-copy-destination-source");
    expect([...select.options].map((option) => option.value)).toEqual(["tank", "backup"]);
    expect(select.value).toBe("tank");
    select.value = "backup";
    select.dispatchEvent(new Event("change"));
    // The prompt picks the folder to show in that source
    expect(onNavigate).toHaveBeenCalledWith({ source: "backup", path: null });
    // Shows the old source until the prompt passes the new one back
    expect(select.value).toBe("tank");
    props.source = "backup";
    await nextTick();
    expect(select.value).toBe("backup");
  });

  it("names a fixed source, or none, when there is nothing to switch to", async () => {
    mount({ sources: ["tank"] });
    expect(find("move-copy-destination-source")).toBeNull();
    expect(root.querySelector(".move-copy-summary-source").textContent).toBe("tank");
    props.showSource = false;
    await nextTick();
    expect(root.querySelector(".move-copy-summary-source")).toBeNull();
  });

  it("keeps the current source in the list when it isn't a known one", () => {
    mount({ source: "old", sources: ["tank", "backup"] });
    const select = find("move-copy-destination-source");
    expect([...select.options].map((option) => option.value)).toEqual(["old", "tank", "backup"]);
    expect(select.value).toBe("old");
  });

  it("goes to a typed path on Enter without confirming the prompt", async () => {
    mount();
    const input = await edit(" /media/../photos/2024 ");
    expect(input.getAttribute("aria-label")).toBe("prompts.typeDestinationPath");
    const event = press(input, "Enter");
    expect(event.defaultPrevented).toBe(true);
    expect(reachedWindow).toEqual([]);
    expect(onNavigate).toHaveBeenCalledWith({ source: "tank", path: "/photos/2024/" });
    await nextTick();
    await nextTick();
    expect(find("move-copy-destination-input")).toBeNull();
    expect(document.activeElement).toBe(find("move-copy-destination-edit"));
  });

  it("starts editing with the current path, selected", async () => {
    mount();
    find("move-copy-destination-edit").click();
    await nextTick();
    await nextTick();
    const input = find("move-copy-destination-input");
    expect(input.value).toBe("/media/movies/");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 14]);
    expect(document.activeElement).toBe(input);
  });

  it("leaves Enter and Escape to an input method that is composing text", async () => {
    mount();
    const input = await edit("/写真");
    // Chrome marks the key that picks a candidate with isComposing; Safari only with keyCode 229
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ["Enter", "Escape"]) {
        expect(press(input, key, init).defaultPrevented).toBe(false);
      }
    }
    expect(reachedWindow).toEqual([]);
    expect(onNavigate).not.toHaveBeenCalled();
    await nextTick();
    expect(find("move-copy-destination-input")).toBe(input);
    press(input, "Enter");
    expect(onNavigate).toHaveBeenCalledWith({ source: "tank", path: "/写真/" });
  });

  it("drops the edit on Escape without closing the prompt", async () => {
    mount();
    const input = await edit("/elsewhere/");
    press(input, "Escape");
    expect(reachedWindow).toEqual([]);
    expect(onNavigate).not.toHaveBeenCalled();
    await nextTick();
    expect(find("move-copy-destination-input")).toBeNull();
    expect(crumbs().map((crumb) => crumb.textContent)).toEqual(["/", "media", "movies"]);
  });

  it("goes to the typed path when the field loses focus, and ignores blank or unchanged input", async () => {
    mount();
    let input = await edit("/photos");
    input.blur();
    expect(onNavigate).toHaveBeenCalledWith({ source: "tank", path: "/photos/" });
    onNavigate.mockClear();
    await nextTick();
    input = await edit("   ");
    press(input, "Enter");
    await nextTick();
    input = await edit("/media/movies");
    press(input, "Enter");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps editing when the window loses focus", async () => {
    mount();
    const input = await edit("/media/mov");
    await nextTick();
    // Switching windows blurs the field but leaves it the focused element
    input.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(find("move-copy-destination-input")).toBe(input);
  });

  it("starts each edit from the current path, not an earlier draft", async () => {
    mount();
    press(await edit("/photos/"), "Enter");
    props.path = "/media/";
    await nextTick();
    onNavigate.mockClear();
    find("move-copy-destination-edit").click();
    await nextTick();
    await nextTick();
    find("move-copy-destination-input").blur();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows the end of a long path whenever the folder buttons appear", async () => {
    const scrolled = new WeakMap();
    const scrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
    const scrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth");
    Object.defineProperty(Element.prototype, "scrollLeft", {
      configurable: true,
      get() { return scrolled.get(this) ?? 0; },
      set(value) { scrolled.set(this, value); },
    });
    Object.defineProperty(Element.prototype, "scrollWidth", { configurable: true, get: () => 500 });
    try {
      const group = () => root.querySelector(".move-copy-destination-crumbs");
      mount();
      await nextTick();
      expect(group().scrollLeft).toBe(500);
      press(await edit("/x/"), "Escape");
      await nextTick();
      expect(group().scrollLeft).toBe(500);
      props.interactive = false;
      await nextTick();
      props.interactive = true;
      await nextTick();
      expect(group().scrollLeft).toBe(500);
      group().scrollLeft = 0;
      props.path = "/media/movies/2024/";
      await nextTick();
      await nextTick();
      expect(group().scrollLeft).toBe(500);
    } finally {
      Object.defineProperty(Element.prototype, "scrollLeft", scrollLeft);
      Object.defineProperty(Element.prototype, "scrollWidth", scrollWidth);
    }
  });

  it("is plain text, with no controls, when it isn't interactive", async () => {
    mount();
    await edit("/photos/");
    props.interactive = false;
    await nextTick();
    expect(find("move-copy-destination-input")).toBeNull();
    expect(find("move-copy-destination-edit")).toBeNull();
    expect(find("move-copy-destination-source")).toBeNull();
    expect(crumbs()).toEqual([]);
    expect(root.querySelector(".move-copy-summary-text").textContent).toBe("/media/movies/");
    expect(root.querySelector(".move-copy-summary-source").textContent).toBe("tank");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
