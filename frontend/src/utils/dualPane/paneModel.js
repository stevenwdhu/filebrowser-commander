// Listing, cursor and selection rules for the second (right) pane.
//
// Pure functions over plain objects, so they can be tested without the store. A pane model is
// { entries, cursor, selected, anchor }: entries come from buildEntries, cursor and anchor are entry
// paths, and selected is an ordered array of paths. The ".." row can hold the cursor but is never
// selected or operated on.
import { normalizeDirPath } from "@/utils/moveCopyDestinations.js";
import { sortedItems } from "@/utils/sort.ts";

export const PARENT_NAME = "..";

/** "/a/b/" -> "/a/", "/a/file.txt" -> "/a/", "/" -> "/" */
export function parentDir(path) {
  const trimmed = String(path || "/").replace(/\/+$/, "");
  return normalizeDirPath(trimmed.slice(0, trimmed.lastIndexOf("/")));
}

/** Last path segment: "/a/b/" -> "b", "/" -> "" */
export function childName(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "";
}

/** One { name, path } per folder below the root, as in the copy/move prompt's destination row */
export { pathSegments as breadcrumbSegments } from "@/utils/moveCopyDestinations.js";

export function isParentEntry(entry) {
  return Boolean(entry?.isParent);
}

/** Sorted rows for a listing: folders, then files, with ".." first below the root. */
export function buildEntries(listing, sort, path, source) {
  const by = sort?.by || "name";
  const asc = sort?.asc !== false;
  const items = (listing?.items || []).map((item) => ({
    name: item.name,
    path: item.path,
    source: item.source || listing.source || source,
    type: item.type,
    size: item.size,
    modified: item.modified,
    created: item.created,
    hasPreview: Boolean(item.hasPreview),
    metadata: item.metadata,
    pinned: Boolean(item.pinned),
    hidden: Boolean(item.hidden),
  }));
  const dirs = items.filter((item) => item.type === "directory");
  const files = items.filter((item) => item.type !== "directory");
  const entries = [...sortedItems(dirs, by, asc), ...sortedItems(files, by, asc)];
  const dir = normalizeDirPath(path);
  if (dir !== "/") {
    entries.unshift({ name: PARENT_NAME, path: parentDir(dir), source, type: "directory", isParent: true });
  }
  return entries;
}

function indexOfPath(entries, path) {
  return path === null || path === undefined ? -1 : entries.findIndex((entry) => entry.path === path);
}

function rangePaths(entries, fromPath, toPath) {
  let from = indexOfPath(entries, fromPath);
  const to = indexOfPath(entries, toPath);
  if (from === -1) from = to;
  const [start, end] = from <= to ? [from, to] : [to, from];
  return entries.slice(start, end + 1).filter((entry) => !isParentEntry(entry)).map((entry) => entry.path);
}

function selectOnly(entry) {
  return entry && !isParentEntry(entry) ? [entry.path] : [];
}

/**
 * Move the cursor by `step` rows, or to "home" / "end". Without `extend` the selection follows the
 * cursor like a plain listing; with it (Shift) the selection is the range from the anchor.
 */
export function moveCursor(model, step, { extend = false } = {}) {
  const { entries } = model;
  if (entries.length === 0) return {};
  const current = indexOfPath(entries, model.cursor);
  let next;
  if (step === "home") {
    next = 0;
  } else if (step === "end") {
    next = entries.length - 1;
  } else if (current === -1) {
    next = step > 0 ? 0 : entries.length - 1;
  } else {
    next = Math.min(entries.length - 1, Math.max(0, current + step));
  }
  const entry = entries[next];
  if (extend) {
    const anchor = model.anchor ?? model.cursor ?? entry.path;
    return { cursor: entry.path, anchor, selected: rangePaths(entries, anchor, entry.path) };
  }
  return { cursor: entry.path, anchor: entry.path, selected: selectOnly(entry) };
}

/** Click on a row: plain selects it (or clears it when it was the only selection), Ctrl/Cmd toggles, Shift selects a range. */
export function clickSelect(model, path, { ctrl = false, shift = false } = {}) {
  const entry = model.entries.find((candidate) => candidate.path === path);
  if (!entry) return {};
  if (shift) {
    const anchor = model.anchor ?? model.cursor ?? path;
    return { cursor: path, anchor, selected: rangePaths(model.entries, anchor, path) };
  }
  if (ctrl) {
    if (isParentEntry(entry)) return { cursor: path, anchor: path };
    const selected = model.selected.includes(path)
      ? model.selected.filter((candidate) => candidate !== path)
      : [...model.selected, path];
    return { cursor: path, anchor: path, selected };
  }
  const onlyThis = model.selected.length === 1 && model.selected[0] === path;
  return { cursor: path, anchor: path, selected: onlyThis ? [] : selectOnly(entry) };
}

/** Insert: mark or unmark the cursor row and move down. */
export function toggleMarkAndAdvance(model) {
  const index = indexOfPath(model.entries, model.cursor);
  if (index === -1) return moveCursor(model, 1);
  const entry = model.entries[index];
  let selected = model.selected;
  if (!isParentEntry(entry)) {
    selected = selected.includes(entry.path)
      ? selected.filter((candidate) => candidate !== entry.path)
      : [...selected, entry.path];
  }
  const next = model.entries[Math.min(model.entries.length - 1, index + 1)];
  return { cursor: next.path, anchor: next.path, selected };
}

export function selectAll(model) {
  return { selected: model.entries.filter((entry) => !isParentEntry(entry)).map((entry) => entry.path) };
}

export function clearSelection() {
  return { selected: [] };
}

/** Entries an operation acts on: the selection, else the cursor row; never "..". */
export function operationTargets(model) {
  const selected = new Set(model.selected);
  const targets = model.entries.filter((entry) => selected.has(entry.path));
  if (targets.length > 0) return targets;
  const cursorEntry = model.entries.find((entry) => entry.path === model.cursor);
  return cursorEntry && !isParentEntry(cursorEntry) ? [cursorEntry] : [];
}

/**
 * Keep the cursor and selection meaningful after a (re)load: the selection keeps paths that still
 * exist; the cursor goes to the named row, else the same path, else the same position.
 */
export function reconcileAfterLoad(previous, entries, { focusName = null } = {}) {
  const paths = new Set(entries.map((entry) => entry.path));
  const selected = (previous.selected || []).filter((path) => paths.has(path));
  let cursor = null;
  if (focusName) {
    cursor = entries.find((entry) => !isParentEntry(entry) && entry.name === focusName)?.path ?? null;
  }
  if (cursor === null && paths.has(previous.cursor)) {
    cursor = previous.cursor;
  }
  if (cursor === null && entries.length > 0) {
    const oldIndex = indexOfPath(previous.entries || [], previous.cursor);
    cursor = entries[Math.min(Math.max(oldIndex, 0), entries.length - 1)].path;
  }
  const anchor = paths.has(previous.anchor) ? previous.anchor : cursor;
  return { cursor, selected, anchor };
}

/** Totals for the pane footer. */
export function paneSummary(entries, selectedPaths) {
  const selected = new Set(selectedPaths);
  const summary = { dirs: 0, files: 0, bytes: 0, selectedCount: 0, selectedBytes: 0 };
  for (const entry of entries) {
    if (isParentEntry(entry)) continue;
    if (entry.type === "directory") {
      summary.dirs++;
    } else {
      summary.files++;
    }
    summary.bytes += entry.size || 0;
    if (selected.has(entry.path)) {
      summary.selectedCount++;
      summary.selectedBytes += entry.size || 0;
    }
  }
  return summary;
}
