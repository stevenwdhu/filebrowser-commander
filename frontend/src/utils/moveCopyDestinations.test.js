import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_RECENT_DESTINATIONS,
  buildFavoriteDestinations,
  destinationKey,
  loadRecentDestinations,
  normalizeDirPath,
  parseTypedPath,
  pathSegments,
  recordRecentDestination,
} from "./moveCopyDestinations.js";

const sources = { tank: {}, backup: {} };

describe("normalizeDirPath", () => {
  it("matches FileList.jumpTo normalisation", () => {
    expect(normalizeDirPath("")).toBe("/");
    expect(normalizeDirPath(null)).toBe("/");
    expect(normalizeDirPath(undefined)).toBe("/");
    expect(normalizeDirPath("/")).toBe("/");
    expect(normalizeDirPath("photos")).toBe("/photos/");
    expect(normalizeDirPath("/photos")).toBe("/photos/");
    expect(normalizeDirPath("/photos/2024/")).toBe("/photos/2024/");
  });

  it("gives the same key with or without a trailing slash", () => {
    expect(destinationKey("tank", "/a/b")).toBe(destinationKey("tank", "/a/b/"));
    expect(destinationKey("tank", "/a/")).not.toBe(destinationKey("backup", "/a/"));
  });
});

describe("pathSegments", () => {
  it("gives one entry per folder below the root", () => {
    expect(pathSegments("/")).toEqual([]);
    expect(pathSegments("/photos/2024/")).toEqual([
      { name: "photos", path: "/photos/" },
      { name: "2024", path: "/photos/2024/" },
    ]);
    expect(pathSegments("photos/2024")).toEqual(pathSegments("/photos/2024/"));
  });
});

describe("parseTypedPath", () => {
  it("turns what the user typed into a folder path", () => {
    expect(parseTypedPath("/photos/2024")).toBe("/photos/2024/");
    expect(parseTypedPath("  photos//2024/  ")).toBe("/photos/2024/");
    expect(parseTypedPath("/")).toBe("/");
    expect(parseTypedPath("/my folder/")).toBe("/my folder/");
  });

  it("resolves . and .. without going above the root", () => {
    expect(parseTypedPath("/photos/./2024/../2025")).toBe("/photos/2025/");
    expect(parseTypedPath("/photos/../../..")).toBe("/");
  });

  it("ignores blank input", () => {
    expect(parseTypedPath("")).toBeNull();
    expect(parseTypedPath("   ")).toBeNull();
    expect(parseTypedPath(null)).toBeNull();
  });
});

describe("buildFavoriteDestinations", () => {
  it("keeps source-type links to accessible sources, in sidebar order", () => {
    const links = [
      { category: "tool", target: "/tools", name: "Tools" },
      { category: "source-hybrid-2-root", sourceName: "backup", target: "archive", name: "Archive", icon: "inventory_2" },
      { category: "divider", name: "divider" },
      { category: "source", sourceName: "gone", target: "/", name: "Removed source" },
      { category: "source", target: "/", name: "No source name" },
      { category: "source-minimal", sourceName: "tank", target: "/", name: "Tank" },
    ];
    expect(buildFavoriteDestinations(links, sources)).toEqual([
      { source: "backup", path: "/archive/", name: "Archive", icon: "inventory_2", key: "backup::/archive/" },
      { source: "tank", path: "/", name: "Tank", icon: "", key: "tank::/" },
    ]);
  });

  it("drops duplicate links to the same folder", () => {
    const links = [
      { category: "source", sourceName: "tank", target: "/photos", name: "Photos" },
      { category: "source-alt", sourceName: "tank", target: "/photos/", name: "Photos again" },
    ];
    expect(buildFavoriteDestinations(links, sources).map((d) => d.name)).toEqual(["Photos"]);
  });

  it("falls back to one root per source, like the sidebar's default links", () => {
    expect(buildFavoriteDestinations([], sources).map((d) => d.key)).toEqual(["tank::/", "backup::/"]);
    expect(buildFavoriteDestinations(undefined, sources, [{ name: "backup" }]).map((d) => d.key)).toEqual([
      "backup::/",
    ]);
  });

  it("returns nothing when no sources are known", () => {
    expect(buildFavoriteDestinations(undefined, undefined)).toEqual([]);
  });
});

describe("recent destinations", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records most recent first and moves repeats to the front", () => {
    recordRecentDestination("alice", "tank", "/photos");
    recordRecentDestination("alice", "backup", "/archive/");
    recordRecentDestination("alice", "tank", "/photos/");
    expect(loadRecentDestinations("alice").map((d) => d.key)).toEqual(["tank::/photos/", "backup::/archive/"]);
  });

  it(`keeps at most ${MAX_RECENT_DESTINATIONS} entries`, () => {
    for (let i = 0; i < MAX_RECENT_DESTINATIONS + 3; i++) {
      recordRecentDestination("alice", "tank", `/dir${i}`);
    }
    const recents = loadRecentDestinations("alice");
    expect(recents).toHaveLength(MAX_RECENT_DESTINATIONS);
    expect(recents[0].path).toBe(`/dir${MAX_RECENT_DESTINATIONS + 2}/`);
  });

  it("keeps each user's list separate and ignores anonymous users", () => {
    recordRecentDestination("alice", "tank", "/a");
    recordRecentDestination("bob", "tank", "/b");
    recordRecentDestination("anonymous", "tank", "/c");
    recordRecentDestination("", "tank", "/d");
    expect(loadRecentDestinations("alice").map((d) => d.path)).toEqual(["/a/"]);
    expect(loadRecentDestinations("bob").map((d) => d.path)).toEqual(["/b/"]);
    expect(loadRecentDestinations("anonymous")).toEqual([]);
    expect(Object.keys(localStorage)).toHaveLength(2);
  });

  it("hides sources that are no longer accessible without forgetting them", () => {
    recordRecentDestination("alice", "old", "/x");
    recordRecentDestination("alice", "tank", "/y");
    expect(loadRecentDestinations("alice", sources).map((d) => d.source)).toEqual(["tank"]);
    expect(loadRecentDestinations("alice").map((d) => d.source)).toEqual(["tank", "old"]);
  });

  it("ignores missing source names and survives corrupt storage", () => {
    recordRecentDestination("alice", "", "/x");
    expect(loadRecentDestinations("alice")).toEqual([]);

    recordRecentDestination("alice", "tank", "/ok");
    const [key] = Object.keys(localStorage);
    localStorage.setItem(key, JSON.stringify([{ source: "tank", path: "/ok/", ts: 1 }, { source: 5 }, null, "junk"]));
    expect(loadRecentDestinations("alice").map((d) => d.key)).toEqual(["tank::/ok/"]);

    localStorage.setItem(key, "{not json");
    expect(loadRecentDestinations("alice")).toEqual([]);
    recordRecentDestination("alice", "tank", "/after");
    expect(loadRecentDestinations("alice").map((d) => d.path)).toEqual(["/after/"]);
  });
});
