import { describe, expect, it, vi } from "vitest";
import {
  batchItems,
  blockReasonMessage,
  moveCopyBlockReason,
  runInBatches,
  summarizeItems,
} from "./moveCopyPlan.js";

const dir = (from, source = "tank") => ({ from, fromSource: source, name: from.split("/").filter(Boolean).pop() });
const file = (from, source = "tank") => ({ ...dir(from, source), name: from.split("/").pop() });
const reason = (operation, items, destPath, extra = {}) =>
  moveCopyBlockReason({ operation, items, destSource: "tank", destPath, destError: false, canWrite: true, ...extra });

describe("summarizeItems", () => {
  it("counts folders by type or trailing slash and sums sizes", () => {
    expect(summarizeItems([
      { ...dir("/photos/"), size: 100 },
      { ...file("/notes"), type: "directory", size: 5 },
      { ...file("/a.txt"), size: 1 },
    ])).toEqual({ count: 3, folders: 2, files: 1, size: 106 });
  });

  it("leaves the size out when any item has none", () => {
    expect(summarizeItems([{ ...file("/a.txt"), size: 1 }, file("/b.txt")]).size).toBeNull();
  });
});

describe("moveCopyBlockReason", () => {
  it("blocks a folder going into itself or any folder below it", () => {
    for (const operation of ["copy", "move"]) {
      expect(reason(operation, [dir("/photos/")], "/photos/")).toBe("intoItself");
      expect(reason(operation, [dir("/photos/")], "/photos/2024/")).toBe("intoItself");
      expect(reason(operation, [dir("/photos/")], "/photos/2024")).toBe("intoItself");
    }
  });

  it("allows folders that only share a name prefix, and other sources", () => {
    expect(reason("move", [dir("/photos/")], "/photos2/")).toBeNull();
    expect(reason("move", [dir("/photos/")], "/photos/2024/", { destSource: "backup" })).toBeNull();
  });

  it("blocks moving into the current folder but allows copying there", () => {
    expect(reason("move", [file("/docs/a.txt")], "/docs/")).toBe("sameFolder");
    expect(reason("move", [dir("/docs/old/")], "/docs")).toBe("sameFolder");
    expect(reason("copy", [file("/docs/a.txt")], "/docs/")).toBeNull();
    expect(reason("move", [file("/a.txt")], "/")).toBe("sameFolder");
  });

  it("checks every item, not just the first", () => {
    expect(reason("copy", [file("/a.txt"), dir("/photos/")], "/photos/2024/")).toBe("intoItself");
  });

  it("reports an unreadable destination or missing permission first", () => {
    expect(reason("copy", [file("/a.txt")], "/x/", { destError: true, canWrite: false })).toBe("destinationUnavailable");
    expect(reason("copy", [file("/a.txt")], "/x/", { canWrite: false })).toBe("noPermission");
  });

  it("has a message for every reason", () => {
    const t = (key) => `t:${key}`;
    expect(blockReasonMessage("destinationUnavailable", t)).toBe("t:files.cannotAccesDir");
    expect(blockReasonMessage("noPermission", t)).toBe("t:prompts.moveCopyNoPermission");
    expect(blockReasonMessage("intoItself", t)).toBe("t:prompts.moveCopyIntoItself");
    expect(blockReasonMessage("sameFolder", t)).toBe("t:files.sameFolder");
    expect(blockReasonMessage(null, t)).toBe("");
  });
});

describe("batchItems", () => {
  it("uses one item per batch up to the step limit, then groups them", () => {
    expect(batchItems([1, 2, 3])).toEqual([[1], [2], [3]]);
    const batches = batchItems(Array.from({ length: 120 }, (_, i) => i));
    expect(batches).toHaveLength(40);
    expect(batches.flat()).toHaveLength(120);
  });
});

describe("runInBatches", () => {
  const items = ["a", "b", "c"].map((name) => file(`/${name}`));

  it("runs each batch in order, reports progress and merges the results", async () => {
    const progress = [];
    const runBatch = vi.fn(async ([item]) => ({ succeeded: [{ fromPath: item.from }], failed: [] }));
    const result = await runInBatches(items, runBatch, (p) => progress.push(p));
    expect(runBatch.mock.calls.map(([batch]) => batch.map((item) => item.name))).toEqual([["a"], ["b"], ["c"]]);
    expect(result.succeeded.map((item) => item.fromPath)).toEqual(["/a", "/b", "/c"]);
    expect(progress).toEqual([
      { done: 0, total: 3, current: "a" },
      { done: 1, total: 3, current: "b" },
      { done: 2, total: 3, current: "c" },
      { done: 3, total: 3, current: null },
    ]);
  });

  it("keeps going after a batch whose failure carries per-item results", async () => {
    const runBatch = vi.fn(async ([item]) => {
      if (item.name === "b") throw Object.assign(new Error("boom"), { failed: [{ message: "denied" }] });
      return { succeeded: [{}], failed: [] };
    });
    const result = await runInBatches(items, runBatch);
    expect(runBatch).toHaveBeenCalledTimes(3);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toEqual([{ message: "denied" }]);
  });

  it("stops at an unexpected error and marks the rest failed once something succeeded", async () => {
    const runBatch = vi.fn(async ([item]) => {
      if (item.name === "b") throw new Error("offline");
      return { succeeded: [{}], failed: [] };
    });
    const progress = [];
    const result = await runInBatches(items, runBatch, (p) => progress.push(p));
    expect(runBatch).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed.map((item) => [item.fromPath, item.message])).toEqual([["/b", "offline"], ["/c", "offline"]]);
    expect(progress.at(-1)).toEqual({ done: 3, total: 3, current: null });
  });

  it("rethrows an unexpected error when nothing has succeeded", async () => {
    const error = new Error("offline");
    await expect(runInBatches(items, async () => { throw error; })).rejects.toBe(error);
  });
});
