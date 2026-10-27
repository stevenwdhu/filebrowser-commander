// Layouts for the right pane: the main listing's view modes (list, compact, normal, icons, gallery),
// sized as ListingView sizes them but from the pane's own width. Pure functions; the folder's mode
// comes from store/dualPane.js. upstreamContract.test.js flags upstream changes to the values copied here.

const CARD_MODES = new Set(["normal", "icons", "gallery"]);
// Rows on screen line up exactly; this only absorbs subpixel rounding
const SAME_ROW_PX = 1;

/** Card layouts put several entries on a row, like getters.isCardView for the main listing. */
export function isCardMode(mode) {
  return CARD_MODES.has(mode);
}

/** Columns in the normal layout for a pane this wide, as ListingView.numColumns works them out for #main. */
export function paneColumns(mode, width, size) {
  if (mode !== "normal" || !(width > 0)) return 1;
  return Math.max(1, Math.floor(width / (250 + size * 50)));
}

/** CSS variables for the entries, as ListingView.itemStyles sets them on the main listing (desktop only). */
export function paneItemStyles(mode, size, columns) {
  if (mode === "icons") {
    const baseSize = 20 + size * 15;
    return {
      "--icon-size": `${baseSize}px`,
      "--icon-font-size": `${baseSize}px`,
      "--icons-view-cell-size": `${baseSize + 30}px`,
    };
  }
  if (mode === "gallery") {
    const baseSize = 80 + size * 25 + Math.max(0, size - 5) * 15;
    return {
      "--icon-font-size": `${(3 + size * 0.5).toFixed(2)}em`,
      "--item-width": `${baseSize}px`,
      "--item-height": `${Math.round(baseSize * 1.2)}px`,
    };
  }
  if (mode === "list" || mode === "compact") {
    const height = mode === "compact" ? 40 + size * 2 : 50 + size * 3;
    return {
      "--item-width": "calc(100.00% - 1em)",
      "--item-height": `${height}px`,
      "--icon-size": `${(2 + size * 0.12).toFixed(2)}em`,
      "--icon-font-size": `${(1.5 + size * 0.12).toFixed(2)}em`,
    };
  }
  return {
    "--item-width": `calc(${100 / columns}% - 1em)`,
    "--item-height": "auto",
    "--icon-size": `${(3.2 + size * 0.15).toFixed(2)}em`,
    "--icon-font-size": `${(2.2 + size * 0.12).toFixed(2)}em`,
  };
}

/** The mode the size slider picks within a family, as StatusBar.adjustViewMode does: compact or list, icons or gallery. */
export function modeForSize(mode, size) {
  if (mode === "list" || mode === "compact") return size <= 3 ? "compact" : "list";
  if (mode === "icons" || mode === "gallery") return size <= 4 ? "icons" : "gallery";
  return mode;
}

/**
 * In a card layout, the entry ↑ or ↓ goes to from entry `from`: the nearest one horizontally in the
 * next row that way, even when that row is short or starts a new group. Rects are
 * { left, right, top, bottom } per entry (null for one not on screen); `midX` is the column to stay
 * nearest to, by default the centre of `from`. Returns an index, or -1.
 */
export function closestInDirection(rects, from, direction, midX = null) {
  const current = rects[from];
  if (!current) return -1;
  const down = direction === "down";
  const candidates = [];
  rects.forEach((rect, index) => {
    if (!rect || index === from) return;
    const beyond = down ? rect.top >= current.bottom - SAME_ROW_PX : rect.bottom <= current.top + SAME_ROW_PX;
    if (beyond) candidates.push({ rect, index });
  });
  if (candidates.length === 0) return -1;
  const tops = candidates.map(({ rect }) => rect.top);
  const rowTop = down ? Math.min(...tops) : Math.max(...tops);
  const column = midX ?? (current.left + current.right) / 2;
  let best = -1;
  let bestOffset = Infinity;
  for (const { rect, index } of candidates) {
    if (Math.abs(rect.top - rowTop) > SAME_ROW_PX) continue;
    const offset = Math.abs((rect.left + rect.right) / 2 - column);
    if (offset < bestOffset) {
      bestOffset = offset;
      best = index;
    }
  }
  return best;
}
