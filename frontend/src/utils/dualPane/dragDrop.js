// Drag and drop between the two panes. Every such drop opens the copy/move prompt on the folder it
// landed on, so it gets the same checks, conflict handling, progress and recent destinations as F5/F6.
//
// The handlers run on document in the capture phase. Drops they own are stopped there, before the
// listing's own handlers (which move whatever is selected on the left) can see them. Drags that start
// and end in the left pane, or end on its breadcrumbs or the sidebar tree, are left to the app.
import { normalizeDirPath } from "@/utils/moveCopyDestinations.js";
import { moveCopyBlockReason } from "@/utils/moveCopyPlan.js";
import { isParentEntry } from "@/utils/dualPane/paneModel.js";
import { dualPane, paneContext, paneSideOfElement, rightSelection, setActivePane } from "@/store/dualPane.js";
import { transfer } from "@/utils/dualPane/commands.js";

export const PANE_DRAG_TYPE = "application/x-filebrowser-dual-pane";
// Set too, so the left listing doesn't treat the drag as a file upload
const INTERNAL_DRAG_TYPE = "application/x-filebrowser-internal-drag";
const HIGHLIGHT = "dual-pane-drop-target";

let highlighted = null;

function highlight(element) {
  if (highlighted === element) return;
  highlighted?.classList.remove(HIGHLIGHT);
  highlighted = element;
  highlighted?.classList.add(HIGHLIGHT);
}

/** Copy with Ctrl/Alt, move with Shift/Cmd; otherwise move within a source and copy across sources. */
export function dropOperation(event, items, destination) {
  if (event.ctrlKey || event.altKey) return "copy";
  if (event.shiftKey || event.metaKey) return "move";
  return items[0]?.source === destination.source ? "move" : "copy";
}

function leftFolderOf(row) {
  const left = paneContext("left");
  return { source: left.source, path: normalizeDirPath(`${left.path}${row.dataset.name}`) };
}

function rightFolderOf(row) {
  const entry = dualPane.right.entries.find((candidate) => candidate.path === row.dataset.path);
  if (!entry) return null;
  return { source: entry.source || dualPane.right.source, path: normalizeDirPath(entry.path), isParent: isParentEntry(entry) };
}

/**
 * Where a drag over this element would drop: { side, folder, element } when the pane handles it,
 * { blocked: true } when it must not land there, or null to leave it to the app.
 */
export function dropTarget(element, origin) {
  const side = paneSideOfElement(element);
  const ownsDrop = origin === "right" || side === "right";
  if (!side || element.closest?.("#shelf")) {
    return ownsDrop ? { blocked: true } : null;
  }
  if (!ownsDrop) return null;
  const row = element.closest?.(".listing-item");
  if (row?.dataset.dir === "true") {
    const folder = side === "right" ? rightFolderOf(row) : leftFolderOf(row);
    if (folder) return { side, folder, element: row };
  }
  // Empty space or a file: the pane's own folder, unless the drag started there
  if (side === origin) return { blocked: true };
  const pane = paneContext(side);
  const zone = side === "right" ? document.querySelector(".dual-pane-right .dual-pane-list") : document.getElementById("main");
  return { side, folder: { source: pane.source, path: pane.path }, element: zone };
}

/** The operation a drop would start, or null where the prompt would refuse it (a folder into itself, a move in place). */
export function dropPlan(event, items, folder) {
  if (items.length === 0) return null;
  const operation = dropOperation(event, items, folder);
  const reason = moveCopyBlockReason({
    operation,
    items: items.map((item) => ({ from: item.path, fromSource: item.source, type: item.type, name: item.name })),
    destSource: folder.source,
    destPath: folder.path,
    destError: false,
    canWrite: true,
  });
  return reason ? null : operation;
}

function isPaneDrag(event) {
  return Boolean(dualPane.drag) && Array.from(event.dataTransfer?.types || []).includes(PANE_DRAG_TYPE);
}

/** dragstart on a right-pane row: drag the selection, or just this row when it isn't selected. */
export function startRightDrag(entry, event) {
  if (isParentEntry(entry)) {
    event.preventDefault();
    return;
  }
  setActivePane("right");
  if (!dualPane.right.selected.includes(entry.path)) rightSelection.selectOnly(entry.path);
  dualPane.drag = { origin: "right" };
  event.dataTransfer?.setData(PANE_DRAG_TYPE, "right");
  event.dataTransfer?.setData(INTERNAL_DRAG_TYPE, "true");
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
}

function resolve(event) {
  if (!isPaneDrag(event)) return null;
  const { origin } = dualPane.drag;
  const target = dropTarget(event.target, origin);
  if (!target || target.blocked) return target;
  const items = paneContext(origin).items;
  const operation = dropPlan(event, items, target.folder);
  return operation ? { ...target, items, operation } : { blocked: true };
}

export const paneDragHandlers = {
  dragstart(event) {
    // A new drag; right rows then mark theirs in startRightDrag, after this capture handler
    dualPane.drag = null;
    if (!event.target?.closest?.("#main .listing-item")) return;
    dualPane.drag = { origin: "left" };
    event.dataTransfer?.setData(PANE_DRAG_TYPE, "left");
  },
  // Keep the app's own drag highlights (breadcrumbs, folders) off targets the pane handles
  dragenter(event) {
    if (resolve(event)) event.stopPropagation();
  },
  dragover(event) {
    const target = resolve(event);
    if (!target) {
      highlight(null);
      return;
    }
    event.stopPropagation();
    if (target.blocked) {
      highlight(null);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = target.operation;
    highlight(target.element);
  },
  drop(event) {
    const target = resolve(event);
    highlight(null);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    dualPane.drag = null;
    if (!target.blocked) transfer(target.operation, target.items, target.folder);
  },
  dragend() {
    highlight(null);
    dualPane.drag = null;
  },
};
