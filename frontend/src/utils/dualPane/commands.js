// Commands for the dual-pane layout, run from the keymap, the right pane's menu and its buttons.
// Right-pane actions always pass their own items and folder to prompts, which otherwise fall back
// to the left pane's state.req.
import { getters, mutations, state } from "@/store/index.ts";
import { resourcesApi } from "@/api/index.js";
import { notify } from "@/notify/index.ts";
import i18n from "@/i18n/index.ts";
import { router } from "@/router/index.ts";
import { buildItemUrl, goToItem } from "@/utils/url.js";
import { processTypeAheadKey, resetTypeAheadSession } from "@/utils/listingTypeAhead.js";
import { normalizeDirPath } from "@/utils/moveCopyDestinations.js";
import { closestInDirection, isCardMode } from "@/utils/dualPane/paneLayout.js";
import { childName, isParentEntry, operationTargets, parentDir } from "@/utils/dualPane/paneModel.js";
import {
  activePaneContext,
  dualPane,
  openRight,
  otherPaneContext,
  paneContext,
  refreshRight,
  rightSelection,
  rightViewMode,
  setActivePane,
  toggleDualPane,
} from "@/store/dualPane.js";

/** The previous-location entry set when a file is opened from the right pane, so it can be cleared on return. */
export const openedFromRight = { item: null };

/** A left-pane move the panes asked for, which shouldn't make the left pane active. */
export const leftNavigation = { expected: null };

export function locationKey(source, path) {
  return `${source}::${normalizeDirPath(path)}`;
}

function rightEntry(path = dualPane.right.cursor) {
  return dualPane.right.entries.find((entry) => entry.path === path) || null;
}

function rightPermissions() {
  return getters.sourcePermissions(dualPane.right.source) || {};
}

function rightListElement() {
  return document.querySelector(".dual-pane-right .dual-pane-list");
}

function pageSize() {
  const list = rightListElement();
  const row = list?.querySelector(".listing-item");
  if (!list || !row || row.offsetHeight === 0) return 10;
  return Math.max(1, Math.floor(list.clientHeight / row.offsetHeight) - 1);
}

// Where an entry sits on screen, without the zoom a hovered card gets: the centre from its box
// and the size from its layout
function entryRect(element) {
  const box = element.getBoundingClientRect();
  const x = (box.left + box.right) / 2;
  const y = (box.top + box.bottom) / 2;
  const halfWidth = element.offsetWidth / 2;
  const halfHeight = element.offsetHeight / 2;
  return { left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight };
}

/**
 * Move the cursor a row up (direction -1) or down on screen in a card layout, where a row holds
 * several entries, or with `page` as many rows as fit in the pane, staying in the starting column.
 * False in the list layouts, or with no cursor yet, which move by entries instead.
 */
function moveByRows(direction, extend, { page = false } = {}) {
  const right = dualPane.right;
  const list = rightListElement();
  const from = right.entries.findIndex((entry) => entry.path === right.cursor);
  if (!isCardMode(rightViewMode()) || !list || from === -1) return false;
  const rectByPath = new Map();
  for (const element of list.querySelectorAll(".listing-item[data-path]")) {
    rectByPath.set(element.dataset.path, entryRect(element));
  }
  const rects = right.entries.map((entry) => rectByPath.get(entry.path) || null);
  const start = rects[from];
  if (!start) return false;
  const column = (start.left + start.right) / 2;
  // A page keeps the starting row in view: it goes no further than the pane's height less a row
  const reach = list.clientHeight - (start.bottom - start.top);
  let to = from;
  for (;;) {
    const next = closestInDirection(rects, to, direction < 0 ? "up" : "down", column);
    if (next === -1 || (to !== from && Math.abs(rects[next].top - start.top) > reach)) break;
    to = next;
    if (!page) break;
  }
  rightSelection.move(to - from, { extend });
  return true;
}

function showLeftFolder(source, path) {
  leftNavigation.expected = locationKey(source, path);
  void router.push({ path: buildItemUrl(source, normalizeDirPath(path)) });
}

/** Open a right-pane row: folders (and "..") browse the pane, files open in the main view. */
export function openEntry(entry, { newTab = false } = {}) {
  if (!entry) return;
  const right = dualPane.right;
  if (newTab) {
    // Not goToItem, which ignores the left pane's own folder even for a new tab
    window.open(buildItemUrl(entry.source || right.source, entry.path, true), "_blank");
    return;
  }
  if (entry.type === "directory") {
    const focusName = isParentEntry(entry) ? childName(right.path) : null;
    void openRight(entry.source || right.source, entry.path, { focusName });
    return;
  }
  // Closing the preview returns the left pane to its folder rather than the file's
  const previous = {
    name: state.req?.name || state.req?.source || "",
    source: state.req?.source,
    path: state.req?.path,
    isShare: false,
  };
  openedFromRight.item = previous;
  goToItem(entry.source, entry.path, previous, false, false);
}

// The server refuses a move without modify, or a copy without download, on the items' source
function mayTransfer(operation, source) {
  const perms = getters.sourcePermissions(source) || {};
  return operation === "move" ? Boolean(perms.modify) : Boolean(perms.download);
}

/** Open the copy or move prompt for items, starting in the given folder. */
export function transfer(operation, items, destination) {
  if (items.length === 0 || !destination?.source) return;
  if (!mayTransfer(operation, items[0].source)) {
    notify.showErrorToast(i18n.global.t("errors.forbidden"));
    return;
  }
  mutations.showPrompt({
    name: operation,
    props: { operation, items, destination: { source: destination.source, path: normalizeDirPath(destination.path) } },
  });
}

// F5 / F6: the active pane's selection (or the right pane's cursor row) into the other pane's folder
function transferToOther(operation) {
  dualPane.menu = null; // F5/F6 also work from the right pane's menu
  const from = activePaneContext();
  const to = otherPaneContext();
  transfer(operation, from.items, { source: to.source, path: to.path });
}

function deleteItems() {
  const targets = operationTargets(dualPane.right);
  if (targets.length === 0 || !rightPermissions().delete) return;
  mutations.showPrompt({
    name: "delete",
    props: {
      items: targets.map((entry) => ({
        source: entry.source,
        path: entry.path,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        modified: entry.modified,
        created: entry.created,
        hasPreview: entry.hasPreview,
      })),
    },
  });
}

function renameItem() {
  const targets = operationTargets(dualPane.right);
  if (targets.length !== 1 || !rightPermissions().modify) return;
  mutations.showPrompt({
    name: "rename",
    props: {
      item: targets[0],
      parentItems: dualPane.right.entries.filter((entry) => !isParentEntry(entry)),
    },
  });
}

async function startDownload(format, files) {
  // Chunked downloads report their own errors, as in utils/download.js
  const chunked = (state.user?.fileLoading?.downloadChunkSizeMb || 0) > 0;
  try {
    await resourcesApi.download(format, files);
  } catch (error) {
    if (error?.name !== "AbortError" && !chunked) notify.showError(error?.message || String(error));
  }
}

// Like utils/download.js, which reads the left pane's selection: a single file downloads as is,
// anything else asks for an archive format
function downloadItems() {
  const targets = operationTargets(dualPane.right);
  if (targets.length === 0 || !rightPermissions().download) return;
  const files = targets.map((entry) => ({ ...entry, isDir: entry.type === "directory" }));
  if (files.length === 1 && !files[0].isDir) {
    void startDownload(null, files);
    return;
  }
  mutations.showPrompt({
    name: "download",
    confirm: (format) => {
      mutations.closeTopPrompt();
      void startDownload(format, files);
    },
  });
}

function showInfo() {
  const targets = operationTargets(dualPane.right);
  if (targets.length !== 1) return;
  mutations.showPrompt({ name: "info", props: { item: { ...targets[0], isDir: targets[0].type === "directory" } } });
}

function newFolder() {
  if (!rightPermissions().create) return;
  mutations.showPrompt({
    name: "newDir",
    props: { base: { source: dualPane.right.source, path: dualPane.right.path }, redirect: false },
  });
}

// F7 / F8 in the left pane: the same prompts as its own toolbar and Delete key
function newFolderInLeft() {
  if (!getters.canCreateInSource(state.req?.source)) return;
  mutations.showPrompt({
    name: "newDir",
    props: { base: { source: state.req.source, path: state.req.path }, redirect: false },
  });
}

function deleteInLeft() {
  if (paneContext("left").items.length === 0 || !getters.sourcePermissions(state.req?.source)?.delete) return;
  mutations.showPrompt({ name: "delete" });
}

function typeAhead(key) {
  const right = dualPane.right;
  const items = right.entries
    .map((entry, index) => ({ name: entry.name, index, path: entry.path }))
    .filter((item) => !isParentEntry(right.entries[item.index]));
  const cursorIndex = right.entries.findIndex((entry) => entry.path === right.cursor);
  const { matches, nextPos } = processTypeAheadKey(key, items, cursorIndex === -1 ? null : cursorIndex);
  const target = matches.at(nextPos);
  if (target) rightSelection.selectOnly(target.path);
}

function switchPane() {
  const next = dualPane.active === "right" ? "left" : "right";
  setActivePane(next);
  resetTypeAheadSession();
  if (next === "right") {
    rightListElement()?.focus({ preventScroll: true });
    return;
  }
  // Focus a left row so the next Tab comes back; Shift+Tab leaves the panes as usual
  const left = document.querySelector('#main .listing-item[aria-selected="true"]') || document.querySelector("#main .listing-item");
  if (left) {
    left.focus({ preventScroll: true });
  } else {
    document.activeElement?.blur?.();
  }
}

/** Open the folder under the active pane's cursor (or its own folder) in the other pane. */
function openInOther() {
  if (dualPane.active === "right") {
    const entry = rightEntry();
    const path = entry?.type === "directory" ? entry.path : dualPane.right.path;
    showLeftFolder(dualPane.right.source, path);
    return;
  }
  const left = paneContext("left");
  const folder = left.items.length === 1 && left.items[0].type === "directory" ? left.items[0].path : left.path;
  void openRight(left.source, folder);
}

function showInOther() {
  if (dualPane.active === "right") {
    showLeftFolder(dualPane.right.source, dualPane.right.path);
  } else {
    const left = paneContext("left");
    void openRight(left.source, left.path);
  }
}

function swapPanes() {
  const left = paneContext("left");
  const { source, path } = dualPane.right;
  if (!source || !left.source) return;
  void openRight(left.source, left.path);
  showLeftFolder(source, path);
}

export const dualPaneCommands = {
  noop: () => {},
  toggleDual: () => toggleDualPane(),
  switchPane,
  openInOther,
  showInOther,
  swapPanes,
  copyToOther: () => transferToOther("copy"),
  moveToOther: () => transferToOther("move"),
  newFolderInActive: () => (dualPane.active === "right" ? newFolder() : newFolderInLeft()),
  deleteInActive: () => (dualPane.active === "right" ? deleteItems() : deleteInLeft()),
  cursor: ({ step, extend, rows }) => (rows && moveByRows(step, extend)) || rightSelection.move(step, { extend }),
  page: ({ direction, extend }) => moveByRows(direction, extend, { page: true }) || rightSelection.move(direction * pageSize(), { extend }),
  open: () => openEntry(rightEntry()),
  parent: () => {
    const { source, path } = dualPane.right;
    if (path !== "/") openEntry({ source, path: parentDir(path), type: "directory", isParent: true });
  },
  toggleMark: () => rightSelection.toggleMark(),
  selectAll: () => rightSelection.selectAll(),
  clearSelection: () => rightSelection.clear(),
  typeAhead: ({ key }) => typeAhead(key),
  delete: deleteItems,
  rename: renameItem,
  download: downloadItems,
  info: showInfo,
  newFolder,
  refresh: () => refreshRight(),
  openMenu: () => {
    const row = document.querySelector(".dual-pane-right .dual-pane-cursor");
    const rect = (row || rightListElement())?.getBoundingClientRect();
    // With nothing to act on (the cursor on "..") it is the folder menu
    if (rect) dualPane.menu = { x: rect.left + 24, y: rect.top + rect.height / 2, onEntry: operationTargets(dualPane.right).length > 0 };
  },
  closeMenu: () => {
    dualPane.menu = null;
    rightListElement()?.focus({ preventScroll: true });
  },
};

export function runDualPaneCommand(command) {
  dualPaneCommands[command.cmd]?.(command.args || {});
}
