// State for the dual-pane layout. The left pane is the app's normal listing (route, state.req,
// state.selected); this module owns the second, right-hand pane and which side is active.
// A module-level reactive so it survives Layout remounts between route records.
import { markRaw, reactive, toRaw } from "vue";
import { getters, mutations, state } from "@/store/index.ts";
import { resourcesApi } from "@/api/index.js";
import { normalizeDirPath } from "@/utils/moveCopyDestinations.js";
import {
  buildEntries,
  childName,
  clearSelection,
  clickSelect,
  moveCursor,
  operationTargets,
  parentDir,
  reconcileAfterLoad,
  selectAll,
  toggleMarkAndAdvance,
} from "@/utils/dualPane/paneModel.js";
import { modeForSize } from "@/utils/dualPane/paneLayout.js";
import { clampRatio, loadDualPanePrefs, saveDualPanePrefs } from "@/utils/dualPane/prefs.js";

/** Narrower windows keep the single-pane layout. */
export const WIDE_QUERY = "(min-width: 1024px)";

function emptyRight() {
  return {
    source: null,
    path: "/",
    listing: null, // Raw API listing, kept to re-sort without fetching
    entries: [],
    loaded: false,
    loading: false,
    error: false,
    stale: false, // Changed while hidden; reload when shown again
    requestId: 0,
    cursor: null,
    selected: [],
    anchor: null,
  };
}

export const dualPane = reactive({
  username: null,
  enabled: false,
  ratio: 0.5,
  active: "left", // "left" | "right"
  wideEnough: true,
  shown: false, // Set by DualPaneHost while the pane is on screen
  menu: null, // { x, y, onEntry } while the right pane's menu is open
  right: emptyRight(),
});

let mediaQuery = null;
let lastHighlight = null;

function isKnownSource(name) {
  const info = state.sources?.info;
  return !info || Object.keys(info).length === 0 || Object.hasOwn(info, name);
}

function persist() {
  const { source, path } = dualPane.right;
  saveDualPanePrefs(dualPane.username, {
    enabled: dualPane.enabled,
    ratio: dualPane.ratio,
    right: source ? { source, path } : null,
  });
}

/** Load this user's preferences and start tracking the window width. */
export function initDualPane(username) {
  if (!mediaQuery && typeof window !== "undefined" && window.matchMedia) {
    mediaQuery = window.matchMedia(WIDE_QUERY);
    dualPane.wideEnough = mediaQuery.matches;
    mediaQuery.addEventListener?.("change", (event) => {
      dualPane.wideEnough = event.matches;
    });
  }
  if (dualPane.username === username) return;
  const prefs = loadDualPanePrefs(username, isKnownSource);
  dualPane.username = username;
  dualPane.enabled = prefs.enabled;
  dualPane.ratio = prefs.ratio;
  dualPane.active = "left";
  dualPane.menu = null;
  dualPane.right = emptyRight();
  if (prefs.right) {
    dualPane.right.source = prefs.right.source;
    dualPane.right.path = prefs.right.path;
  }
}

function leftLocation() {
  return { source: state.req?.source, path: normalizeDirPath(state.req?.path) };
}

/** Turn the second pane on or off; the first time it opens on the left pane's folder. */
export function setDualPaneEnabled(on) {
  dualPane.enabled = Boolean(on);
  if (!on) {
    dualPane.active = "left";
    dualPane.menu = null;
  } else if (!dualPane.right.source && state.req?.type === "directory") {
    // Reuse the left listing so the pane appears without a fetch
    const { source, path } = leftLocation();
    showListing(source, path, state.req, {});
  }
  persist();
}

export function toggleDualPane() {
  setDualPaneEnabled(!dualPane.enabled);
}

export function setActivePane(side) {
  dualPane.active = side === "right" ? "right" : "left";
}

export function setPaneRatio(ratio, { save = true } = {}) {
  dualPane.ratio = clampRatio(ratio);
  if (save) persist();
}

function showListing(source, path, listing, { focusName = null, keepSelection = false }) {
  const right = dualPane.right;
  const entries = buildEntries(listing, getters.pickerSorting(), path, source);
  const sameFolder = right.loaded && right.source === source && right.path === path;
  const previous = sameFolder && keepSelection ? right : { entries: right.entries, selected: [], cursor: null, anchor: null };
  Object.assign(right, {
    source,
    path,
    // A copy: marking the caller's object raw would freeze it, and the left pane passes state.req
    listing: markRaw({ ...toRaw(listing) }),
    entries,
    loaded: true,
    error: false,
    stale: false,
  }, reconcileAfterLoad(previous, entries, { focusName }));
}

/**
 * Show a folder in the right pane. Only the latest request applies. A failed load keeps the
 * current listing; when the shown folder itself fails (deleted, renamed) or a saved location is
 * being restored, it walks up towards the left pane's folder.
 */
export async function openRight(source, path, { focusName = null, keepSelection = false, restoring = false } = {}) {
  const right = dualPane.right;
  const dir = normalizeDirPath(path);
  const requestId = ++right.requestId;
  right.loading = true;
  try {
    const listing = await resourcesApi.fetchFiles(source, dir);
    if (requestId !== right.requestId) return false;
    showListing(source, dir, listing, { focusName, keepSelection });
    persist();
    return true;
  } catch {
    if (requestId !== right.requestId) return false;
    const shownFolderGone = right.loaded && !right.error && right.source === source && right.path === dir;
    if (restoring || shownFolderGone) {
      const left = leftLocation();
      if (dir !== "/") return openRight(source, parentDir(dir), { restoring: true });
      if (left.source && left.source !== source) return openRight(left.source, left.path, {});
    }
    if (!right.loaded || right.source !== source) {
      // Nothing to fall back on: show the failed folder with a way up
      Object.assign(right, emptyRight(), { source, path: dir, requestId, loaded: true, error: true });
      right.entries = buildEntries({ items: [] }, getters.pickerSorting(), dir, source);
    }
    return false;
  } finally {
    if (requestId === right.requestId) right.loading = false;
  }
}

/** Load the saved location the first time the pane is shown. */
export function ensureRightLoaded() {
  const right = dualPane.right;
  if (right.loaded || right.loading) return;
  if (right.source) {
    void openRight(right.source, right.path, { restoring: true });
  } else if (state.req?.type === "directory") {
    const { source, path } = leftLocation();
    showListing(source, path, state.req, {});
  }
}

/** Reload the right pane, keeping selection and cursor; while hidden it only marks it stale. */
export function refreshRight() {
  const right = dualPane.right;
  if (!right.source) return;
  if (!dualPane.shown) {
    right.stale = true;
    return;
  }
  // A rename or new folder asks for its new name to be highlighted; use each request once, as
  // the left pane only clears it when it shows that folder
  let focusName = null;
  const pending = toRaw(state.pendingHighlight);
  if (pending && pending !== lastHighlight && pending.source === right.source && parentDir(pending.path) === right.path) {
    focusName = childName(pending.path);
    lastHighlight = pending;
  }
  void openRight(right.source, right.path, { focusName, keepSelection: true });
}

/** Re-sort after the picker sort changes, without fetching. */
export function resortRight() {
  const right = dualPane.right;
  if (!right.listing) return;
  showListing(right.source, right.path, right.listing, { keepSelection: true });
}

// The main listing keeps a folder's display preferences under its route path, as buildItemUrl
// builds it outside shares. Built here so the store doesn't load the router, and so the key stays
// the folder's own while a share is open.
function preferenceLocation(source, path) {
  const encodedPath = normalizeDirPath(path).slice(1).split("/").map(encodeURIComponent).join("/");
  return { source, path: `/files/${encodeURIComponent(source)}/${encodedPath}` };
}

function saveRightViewMode(viewMode) {
  const { source, path } = dualPane.right;
  if (source) mutations.updateDisplayPreferences({ viewMode }, preferenceLocation(source, path));
}

/** The right pane's layout: its folder's saved view mode, else the user's default, as getters.viewMode for the left. */
export function rightViewMode() {
  const { source, path } = dualPane.right;
  const location = source ? preferenceLocation(source, path) : null;
  const saved = location ? getters.displayPreferenceFor(location.source, location.path)?.viewMode : null;
  return saved || state.user?.viewMode || "normal";
}

/** The layout the top bar's Switch view changes: the right pane's while it's the active one, else the main listing's. */
export function activePaneViewMode() {
  return dualPane.shown && dualPane.active === "right" ? rightViewMode() : getters.viewMode();
}

/**
 * Switch view with both panes shown: save the layout for the active pane's folder only, without
 * making it the default, which would also change the other pane. False with one pane shown.
 */
export function saveActivePaneViewMode(viewMode) {
  if (!dualPane.shown) return false;
  if (dualPane.active === "right") {
    saveRightViewMode(viewMode);
  } else {
    mutations.updateDisplayPreferences({ viewMode });
  }
  return true;
}

/**
 * The size slider moves the main listing's folder between compact and list, or icons and gallery;
 * keep the right pane's in step while it's on screen. Like the main listing, folders out of sight are left as they are.
 */
export function followGallerySize(size) {
  if (!dualPane.shown || !dualPane.right.source) return;
  const mode = rightViewMode();
  const sized = modeForSize(mode, size);
  if (sized !== mode) saveRightViewMode(sized);
}

function applyToRight(update) {
  Object.assign(dualPane.right, update);
}

export const rightSelection = {
  move: (step, options) => applyToRight(moveCursor(dualPane.right, step, options)),
  click: (path, modifiers) => applyToRight(clickSelect(dualPane.right, path, modifiers)),
  toggleMark: () => applyToRight(toggleMarkAndAdvance(dualPane.right)),
  selectAll: () => applyToRight(selectAll(dualPane.right)),
  clear: () => applyToRight(clearSelection()),
  setCursor: (path) => applyToRight({ cursor: path, anchor: path }),
  selectOnly: (path) => applyToRight({ cursor: path, anchor: path, selected: [path] }),
};

function toPromptItem(item, source) {
  return { path: item.path, source: item.source || source, name: item.name, type: item.type, size: item.size };
}

/**
 * What a pane shows and what an operation from it acts on, as { side, source, path, items } with
 * items in the move/copy prompt's shape. Left: the listing's selection; right: its selection or cursor row.
 */
export function paneContext(side) {
  if (side === "right") {
    const right = dualPane.right;
    return {
      side,
      source: right.source,
      path: right.path,
      items: operationTargets(right).map((item) => toPromptItem(item, right.source)),
    };
  }
  const { source, path } = leftLocation();
  const items = (state.selected || [])
    .filter((entry) => typeof entry === "number")
    .map((index) => state.req?.items?.at(index))
    .filter(Boolean)
    .map((item) => toPromptItem(item, source));
  return { side: "left", source, path, items };
}

export function activePaneContext() {
  return paneContext(dualPane.active);
}

export function otherPaneContext() {
  return paneContext(dualPane.active === "right" ? "left" : "right");
}

/** Which pane an element belongs to, or null for the header, sidebar and prompts. */
export function paneSideOfElement(element) {
  if (!element?.closest) return null;
  if (element.closest(".dual-pane-right")) return "right";
  if (element.closest("#main, #status-bar, #shelf")) return "left";
  return null;
}
