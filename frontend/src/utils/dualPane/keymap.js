// Which dual-pane command, if any, a keydown maps to. Pure and table driven: anything not listed
// returns null and is left to the rest of the app (ListingView, Files.vue shortcuts, search).
//
// ctx: { available, shown, active: "left" | "right", promptOpen, searchActive, menuOpen }

const REPEATABLE = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);
// Keys the left listing acts on; while the right pane is active they must never reach it
const LISTING_KEYS = new Set([
  "Enter",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);
const NO_KEYS = new Set();
const BUTTON_KEYS = new Set(["Enter", " "]);
const SEPARATOR_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

function isEditable(target) {
  if (!target?.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(target.isContentEditable);
}

// Keys a focused control handles itself: Enter/Space on buttons, links and sort headers, arrows on
// the pane divider. Listing rows are links too, but the pane owns their keys.
function nativeKeys(target) {
  if (!target?.closest || target.closest(".listing-item")) return NO_KEYS;
  if (target.closest("[role='separator']")) return SEPARATOR_KEYS;
  const tag = target.tagName?.toLowerCase();
  if (tag === "button" || tag === "a" || target.getAttribute?.("role") === "button") return BUTTON_KEYS;
  return NO_KEYS;
}

// Tab only switches panes from a listing; from anywhere else focus moves on as usual
function isPaneFocus(target) {
  return Boolean(target?.closest?.(".listing-item, .dual-pane-list"));
}

const ctrlOrMeta = (event) => event.ctrlKey || event.metaKey;

// Letter of a Ctrl/Alt shortcut from the physical key, so it works on any keyboard layout
function shortcutLetter(event) {
  return event.code?.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
}

function isToggleShortcut(event) {
  const altGraph = event.getModifierState?.("AltGraph");
  return (event.key === "\\" || event.code === "Backslash") && ctrlOrMeta(event) && (!event.altKey || altGraph);
}

function resolveGlobal(event, ctx) {
  if (isToggleShortcut(event)) {
    return ctx.available ? { cmd: "toggleDual" } : null;
  }
  if (!ctx.shown) return null;
  if (event.key === "Tab" && !event.shiftKey && !ctrlOrMeta(event) && !event.altKey) {
    return isPaneFocus(event.target) ? { cmd: "switchPane" } : null;
  }
  if (event.altKey && !ctrlOrMeta(event)) {
    const letter = shortcutLetter(event);
    if (letter === "o") return { cmd: "openInOther" };
    if (letter === "i") return { cmd: "showInOther" };
  }
  if (ctrlOrMeta(event) && !event.altKey && !event.shiftKey && shortcutLetter(event) === "u") {
    return { cmd: "swapPanes" };
  }
  // Commander keys; F5 would otherwise reload the page
  if (!ctrlOrMeta(event) && !event.altKey && !event.shiftKey) {
    if (event.key === "F5") return { cmd: "copyToOther" };
    if (event.key === "F6") return { cmd: "moveToOther" };
  }
  return null;
}

function resolveRight(event) {
  const { key } = event;
  const shift = event.shiftKey;
  if (event.altKey && !ctrlOrMeta(event)) {
    if (key === "ArrowDown") return { cmd: "open" };
    if (key === "ArrowUp") return { cmd: "parent" };
    return null;
  }
  if (ctrlOrMeta(event)) {
    switch (shortcutLetter(event)) {
      case "a":
        return { cmd: "selectAll" };
      case "d":
        return { cmd: "download" };
      // The left pane's clipboard shortcuts would act on its hidden selection
      case "c":
      case "x":
      case "v":
        return { cmd: "noop" };
      default:
        return null;
    }
  }
  switch (key) {
    // Up and down go by rows, which differ from entries in the card layouts
    case "ArrowUp":
      return { cmd: "cursor", args: { step: -1, extend: shift, rows: true } };
    case "ArrowDown":
      return { cmd: "cursor", args: { step: 1, extend: shift, rows: true } };
    case "ArrowLeft":
      return { cmd: "cursor", args: { step: -1, extend: shift } };
    case "ArrowRight":
      return { cmd: "cursor", args: { step: 1, extend: shift } };
    case "Home":
      return { cmd: "cursor", args: { step: "home", extend: shift } };
    case "End":
      return { cmd: "cursor", args: { step: "end", extend: shift } };
    case "PageUp":
      return { cmd: "page", args: { direction: -1, extend: shift } };
    case "PageDown":
      return { cmd: "page", args: { direction: 1, extend: shift } };
    case "Enter":
      return { cmd: "open" };
    case "Backspace":
      return { cmd: "parent" };
    case "Insert":
      return { cmd: "toggleMark" };
    case "Escape":
      return { cmd: "clearSelection" };
    case "Delete":
      return { cmd: "delete" };
    case "F2":
      return { cmd: "rename" };
    case "F4":
      return { cmd: "refresh" };
    case "F10":
      return shift ? { cmd: "openMenu" } : null;
    case "ContextMenu":
      return { cmd: "openMenu" };
    default:
      // Also with Shift, which the left pane's type-ahead would otherwise pick up
      if (/^[a-z0-9]$/i.test(key)) return { cmd: "typeAhead", args: { key: key.toLowerCase() } };
      return null;
  }
}

/** The command for a keydown, or null to let the app handle it. */
export function resolveDualPaneKey(event, ctx) {
  // With both panes shown F5/F6 copy and move, so they never reload the page instead
  const commanderKey = (event.key === "F5" || event.key === "F6") && !ctrlOrMeta(event) && !event.altKey && !event.shiftKey;
  if (ctx.shown && commanderKey) {
    if (event.repeat || ctx.promptOpen || ctx.searchActive || isEditable(event.target)) return { cmd: "noop" };
    // The pane menu lists them as shortcuts for its items
    if (ctx.menuOpen) return { cmd: event.key === "F5" ? "copyToOther" : "moveToOther" };
  }
  if (ctx.promptOpen || ctx.searchActive || isEditable(event.target)) return null;
  // The pane menu keeps keyboard focus: its own buttons handle keys, nothing else reacts
  if (ctx.menuOpen) {
    if (event.key === "Escape" || event.key === "Tab") return { cmd: "closeMenu" };
    return event.target?.closest?.(".dual-pane-menu") ? null : { cmd: "noop" };
  }
  if (event.repeat && !REPEATABLE.has(event.key)) return null;
  const global = resolveGlobal(event, ctx);
  if (global || !ctx.shown || ctx.active !== "right") return global;
  if (nativeKeys(event.target).has(event.key)) return null;
  const command = resolveRight(event);
  if (command) return command;
  // Modified listing keys (Ctrl+Delete, Ctrl+Enter...) would still act on the left selection;
  // Alt+arrows stay with the browser (back/forward)
  return LISTING_KEYS.has(event.key) && !event.altKey ? { cmd: "noop" } : null;
}
