// Quick destinations for the move/copy prompt.
//
// Favorites are derived from the user's source-type sidebar links (or one link
// per accessible source when the sidebar is not customised). Recents are a small
// most-recently-used list kept per user in localStorage; nothing is synced to the
// server.
import { isSourceSidebarCategory } from "@/utils/sidebarCategory.ts";

const RECENTS_PREFIX = "moveCopyRecents_";
export const MAX_RECENT_DESTINATIONS = 8;

/** Normalise a directory path the way FileList.jumpTo does: "/" for root, otherwise leading and trailing "/". */
export function normalizeDirPath(path) {
  let p = path === null || path === undefined || path === "" ? "/" : String(path);
  if (!p.startsWith("/")) {
    p = `/${p}`;
  }
  if (p !== "/" && !p.endsWith("/")) {
    p = `${p}/`;
  }
  return p;
}

/** Identity used to dedupe destinations and to match the active one. */
export function destinationKey(source, path) {
  return `${source}::${normalizeDirPath(path)}`;
}

/** One { name, path } per folder below the root, e.g. "/a/b/" -> [{ a, "/a/" }, { b, "/a/b/" }] */
export function pathSegments(path) {
  const segments = [];
  let current = "/";
  for (const name of normalizeDirPath(path).split("/").filter(Boolean)) {
    current = `${current}${name}/`;
    segments.push({ name, path: current });
  }
  return segments;
}

/**
 * A folder path the user typed, as a directory path: "." parts are dropped and ".." goes up one
 * level, never above the root. Blank input gives null.
 */
export function parseTypedPath(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const parts = [];
  for (const part of trimmed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return normalizeDirPath(parts.join("/"));
}

function isKnownSource(sourceInfo, name) {
  return Boolean(sourceInfo) && Object.hasOwn(sourceInfo, name);
}

/** Mirrors the sidebar's default links: one root link per source, limited to the user's scopes when set. */
function defaultSourceLinks(sourceInfo, scopes) {
  const scoped = new Set(
    (Array.isArray(scopes) ? scopes : [])
      .map((scope) => scope?.name)
      .filter((name) => typeof name === "string" && name.length > 0),
  );
  return Object.keys(sourceInfo || {})
    .filter((name) => scoped.size === 0 || scoped.has(name))
    .map((name) => ({ name, category: "source", target: "/", sourceName: name, icon: "" }));
}

/**
 * Folder favorites for the prompt, in sidebar order.
 * Links to sources the user can no longer access are skipped.
 * @returns {{ source: string, path: string, name: string, icon: string, key: string }[]}
 */
export function buildFavoriteDestinations(sidebarLinks, sourceInfo, scopes) {
  const links = Array.isArray(sidebarLinks) && sidebarLinks.length > 0
    ? sidebarLinks
    : defaultSourceLinks(sourceInfo, scopes);
  const seen = new Set();
  const favorites = [];
  for (const link of links) {
    if (!link || !isSourceSidebarCategory(link.category)) continue;
    const source = link.sourceName;
    if (typeof source !== "string" || !isKnownSource(sourceInfo, source)) continue;
    const path = normalizeDirPath(typeof link.target === "string" ? link.target : "/");
    const key = destinationKey(source, path);
    if (seen.has(key)) continue;
    seen.add(key);
    favorites.push({
      source,
      path,
      name: typeof link.name === "string" && link.name ? link.name : source,
      icon: typeof link.icon === "string" ? link.icon : "",
      key,
    });
  }
  return favorites;
}

function recentsStorageKey(username) {
  if (typeof username !== "string" || !username || username === "anonymous") {
    return null;
  }
  return `${RECENTS_PREFIX}${encodeURIComponent(username)}`;
}

function readRecents(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.source === "string" && entry.source
        && typeof entry.path === "string" && typeof entry.ts === "number")
      .map((entry) => ({ source: entry.source, path: normalizeDirPath(entry.path), ts: entry.ts }));
  } catch {
    return [];
  }
}

/**
 * Recent destinations for a user, most recent first.
 * When sourceInfo is given, entries for sources the user can no longer access are hidden (but kept in storage).
 * @returns {{ source: string, path: string, ts: number, key: string }[]}
 */
export function loadRecentDestinations(username, sourceInfo) {
  const storageKey = recentsStorageKey(username);
  if (!storageKey) return [];
  return readRecents(storageKey)
    .filter((entry) => !sourceInfo || isKnownSource(sourceInfo, entry.source))
    .map((entry) => ({ ...entry, key: destinationKey(entry.source, entry.path) }));
}

/** Move (or add) a destination to the front of the user's recents. No-op for anonymous users. */
export function recordRecentDestination(username, source, path) {
  const storageKey = recentsStorageKey(username);
  if (!storageKey || typeof source !== "string" || !source) return;
  const entry = { source, path: normalizeDirPath(path), ts: Date.now() };
  const key = destinationKey(entry.source, entry.path);
  const next = [
    entry,
    ...readRecents(storageKey).filter((e) => destinationKey(e.source, e.path) !== key),
  ].slice(0, MAX_RECENT_DESTINATIONS);
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // ignore — e.g. private browsing quota
  }
}
