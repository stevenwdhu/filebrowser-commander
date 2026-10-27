import { afterEach, describe, expect, it } from "vitest";
import { resolveDualPaneKey } from "./keymap.js";

const base = { available: true, shown: true, active: "right", promptOpen: false, searchActive: false, menuOpen: false };
const elements = [];
function element(html, selector) {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  elements.push(host);
  return selector ? host.querySelector(selector) : host.firstElementChild;
}
function key(init, ctx = {}, target = document.body) {
  return resolveDualPaneKey({ repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: "", target, ...init }, { ...base, ...ctx });
}

describe("resolveDualPaneKey", () => {
  afterEach(() => {
    for (const host of elements.splice(0)) host.remove();
  });

  it("maps the right pane's navigation and file keys", () => {
    expect(key({ key: "ArrowDown" })).toEqual({ cmd: "cursor", args: { step: 1, extend: false, rows: true } });
    expect(key({ key: "ArrowUp", shiftKey: true })).toEqual({ cmd: "cursor", args: { step: -1, extend: true, rows: true } });
    // Left and right go through the entries in order, which is the same thing in a list
    expect(key({ key: "ArrowLeft" })).toEqual({ cmd: "cursor", args: { step: -1, extend: false } });
    expect(key({ key: "ArrowRight", shiftKey: true })).toEqual({ cmd: "cursor", args: { step: 1, extend: true } });
    expect(key({ key: "PageDown" })).toEqual({ cmd: "page", args: { direction: 1, extend: false } });
    expect(key({ key: "Enter" })).toEqual({ cmd: "open" });
    expect(key({ key: "Backspace" })).toEqual({ cmd: "parent" });
    expect(key({ key: "ArrowUp", altKey: true })).toEqual({ cmd: "parent" });
    expect(key({ key: "Insert" })).toEqual({ cmd: "toggleMark" });
    expect(key({ key: "F2" })).toEqual({ cmd: "rename" });
    expect(key({ key: "Delete" })).toEqual({ cmd: "delete" });
    expect(key({ key: "a", ctrlKey: true })).toEqual({ cmd: "selectAll" });
    expect(key({ key: "v", metaKey: true })).toEqual({ cmd: "noop" });
    expect(key({ key: "F10", shiftKey: true })).toEqual({ cmd: "openMenu" });
    expect(key({ key: "R", shiftKey: true })).toEqual({ cmd: "typeAhead", args: { key: "r" } });
  });

  it("leaves the left pane's keys alone and passes app shortcuts through", () => {
    for (const init of [{ key: "ArrowDown" }, { key: "Enter" }, { key: "F2" }, { key: "a" }]) {
      expect(key(init, { active: "left" })).toBeNull();
    }
    for (const init of [{ key: "F1" }, { key: "b", ctrlKey: true }, { key: "," , ctrlKey: true }, { key: " " }, { key: "/" }, { key: "F1", ctrlKey: true }]) {
      expect(key(init)).toBeNull();
    }
  });

  it("switches panes with Tab only from a listing, and leaves Shift+Tab to move focus out", () => {
    const list = element('<div class="dual-pane-list" tabindex="-1"></div>');
    const leftRow = element('<a class="listing-item" tabindex="0">row</a>');
    expect(key({ key: "Tab" }, {}, list)).toEqual({ cmd: "switchPane" });
    expect(key({ key: "Tab" }, { active: "left" }, leftRow)).toEqual({ cmd: "switchPane" });
    expect(key({ key: "Tab", shiftKey: true }, {}, list)).toBeNull();
    expect(key({ key: "Tab" })).toBeNull(); // from <body>
    expect(key({ key: "Tab" }, {}, element("<button>Header</button>"))).toBeNull();
    expect(key({ key: "Tab" }, { shown: false }, list)).toBeNull();
  });

  it("handles cross-pane shortcuts by physical key, from either pane", () => {
    expect(key({ key: "ø", code: "KeyO", altKey: true }, { active: "left" })).toEqual({ cmd: "openInOther" });
    expect(key({ key: "ˆ", code: "KeyI", altKey: true })).toEqual({ cmd: "showInOther" });
    expect(key({ key: "u", code: "KeyU", ctrlKey: true }, { active: "left" })).toEqual({ cmd: "swapPanes" });
    expect(key({ key: "\\", ctrlKey: true }, { shown: false })).toEqual({ cmd: "toggleDual" });
    // German layout: AltGr+ß gives the backslash, reported as Ctrl+Alt
    expect(key({ key: "\\", code: "Minus", ctrlKey: true, altKey: true, getModifierState: (k) => k === "AltGraph" }, { shown: false })).toEqual({ cmd: "toggleDual" });
    expect(key({ key: "\\", ctrlKey: true }, { shown: false, available: false })).toBeNull();
  });

  it("matches Ctrl shortcuts by physical key on any layout", () => {
    expect(key({ key: "в", code: "KeyD", ctrlKey: true })).toEqual({ cmd: "download" });
    expect(key({ key: "ф", code: "KeyA", ctrlKey: true })).toEqual({ cmd: "selectAll" });
  });

  it("never lets the left listing's keys through while the right pane is active", () => {
    for (const init of [{ key: "Delete", ctrlKey: true }, { key: "Backspace", metaKey: true }, { key: "Enter", ctrlKey: true }]) {
      expect(key(init)).toEqual({ cmd: "noop" });
    }
    expect(key({ key: "Enter", shiftKey: true })).toEqual({ cmd: "open" });
    // Alt+arrows are the browser's back and forward
    expect(key({ key: "ArrowLeft", altKey: true })).toBeNull();
    const button = element('<div class="dual-pane-pathbar"><button>Refresh</button></div>', "button");
    expect(key({ key: "Delete" }, {}, button)).toEqual({ cmd: "delete" });
    expect(key({ key: "Backspace" }, {}, button)).toEqual({ cmd: "parent" });
    expect(key({ key: "x" }, {}, button)).toEqual({ cmd: "typeAhead", args: { key: "x" } });
  });

  it("stands down for prompts, search, fields, buttons and held keys", () => {
    expect(key({ key: "ArrowDown" }, { promptOpen: true })).toBeNull();
    expect(key({ key: "ArrowDown" }, { searchActive: true })).toBeNull();
    expect(key({ key: "a" }, {}, element("<input>"))).toBeNull();
    expect(key({ key: "Enter" }, {}, element('<div class="dual-pane-pathbar"><button>Up</button></div>', "button"))).toBeNull();
    expect(key({ key: " " }, {}, element("<button>Up</button>"))).toBeNull();
    expect(key({ key: "Enter" }, {}, element('<p role="button" tabindex="0">Name</p>'))).toBeNull();
    expect(key({ key: "ArrowLeft" }, {}, element('<div role="separator" tabindex="0"></div>'))).toBeNull();
    expect(key({ key: "Enter" }, {}, element('<a class="listing-item"><span>row</span></a>', "span"))).toEqual({ cmd: "open" });
    expect(key({ key: "Enter", repeat: true })).toBeNull();
    expect(key({ key: "ArrowDown", repeat: true })).toEqual({ cmd: "cursor", args: { step: 1, extend: false, rows: true } });
  });

  it("copies and moves to the other pane with F5 and F6 from either pane", () => {
    expect(key({ key: "F5" }, { active: "left" })).toEqual({ cmd: "copyToOther" });
    expect(key({ key: "F6" })).toEqual({ cmd: "moveToOther" });
    expect(key({ key: "F5", ctrlKey: true })).toBeNull(); // hard reload stays
    expect(key({ key: "F5" }, { shown: false })).toBeNull();
    // Never a page reload behind the prompt that F5 opened
    expect(key({ key: "F5", repeat: true })).toEqual({ cmd: "noop" });
    expect(key({ key: "F5" }, { promptOpen: true })).toEqual({ cmd: "noop" });
    expect(key({ key: "F5" }, { promptOpen: true, shown: false })).toBeNull();
    expect(key({ key: "F6" }, {}, element("<input>"))).toEqual({ cmd: "noop" });
    const menuItem = element('<div class="dual-pane-menu"><button>Open</button></div>', "button");
    expect(key({ key: "F5" }, { menuOpen: true }, menuItem)).toEqual({ cmd: "copyToOther" });
  });

  it("keeps keys inside the pane menu", () => {
    expect(key({ key: "Escape" }, { menuOpen: true })).toEqual({ cmd: "closeMenu" });
    expect(key({ key: "Tab" }, { menuOpen: true })).toEqual({ cmd: "closeMenu" });
    expect(key({ key: "ArrowDown" }, { menuOpen: true })).toEqual({ cmd: "noop" });
    const item = element('<div class="dual-pane-menu"><button>Open</button></div>', "button");
    expect(key({ key: "Enter" }, { menuOpen: true }, item)).toBeNull();
  });
});
