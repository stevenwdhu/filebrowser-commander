// Per-user dual-pane preferences kept in localStorage: whether the second pane is on, how wide it
// is, and where it was. Nothing goes to the server; anonymous sessions keep them in memory only.
import { normalizeDirPath } from "@/utils/moveCopyDestinations.js";

const PREFS_PREFIX = "dualPane_";
export const MIN_RATIO = 0.25;
export const MAX_RATIO = 0.75;
export const DEFAULT_PREFS = Object.freeze({ enabled: false, ratio: 0.5, right: null });

export function clampRatio(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return DEFAULT_PREFS.ratio;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

function prefsKey(username) {
  if (!username || username === "anonymous") return null;
  return `${PREFS_PREFIX}${encodeURIComponent(username)}`;
}

function readLocation(value, isKnownSource) {
  if (!value || typeof value.source !== "string" || !value.source || typeof value.path !== "string") {
    return null;
  }
  if (isKnownSource && !isKnownSource(value.source)) return null;
  return { source: value.source, path: normalizeDirPath(value.path) };
}

/** Saved preferences, or the defaults when there are none or they can't be read. */
export function loadDualPanePrefs(username, isKnownSource = null) {
  const key = prefsKey(username);
  if (!key) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFS };
    return {
      enabled: parsed.enabled === true,
      ratio: clampRatio(parsed.ratio),
      right: readLocation(parsed.right, isKnownSource),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveDualPanePrefs(username, prefs) {
  const key = prefsKey(username);
  if (!key) return;
  const right = readLocation(prefs.right);
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ v: 1, enabled: Boolean(prefs.enabled), ratio: clampRatio(prefs.ratio), right }),
    );
  } catch {
    // Storage full or blocked: the preference just isn't remembered
  }
}
