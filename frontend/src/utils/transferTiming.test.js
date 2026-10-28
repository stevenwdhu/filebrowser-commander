import { describe, expect, it } from "vitest";
import {
  createTransferTiming,
  formatElapsed,
  formatTimeLeft,
  RATE_WINDOW_MS,
  roundTimeLeft,
  SETTLE_MS,
} from "./transferTiming.js";

const GB = 1024 ** 3;
const files = (...sizes) => sizes.map((size) => ({ size, folder: false }));

// One request for the whole operation, as the server reports it
function reporter(timing) {
  return (now, done, total, copied, size, bytes) => {
    timing.copied("op-0", bytes);
    return timing.update({ done, total, copied, size }, now);
  };
}

describe("createTransferTiming", () => {
  it("weights the bar by bytes and works out time left in bytes once the speed settles", () => {
    // A 1 GB file, then a 3 GB one
    const timing = createTransferTiming(files(GB, 3 * GB), 0);
    const report = reporter(timing);
    expect(timing.update({ done: 0, total: 2 }, 0)).toEqual({
      startedAt: 0, now: 0, fraction: 0, bytesPerSecond: null, remainingMs: null, estimating: false, finishing: false,
    });

    let state = report(1000, 0, 2, GB / 2, GB, GB / 2);
    expect(state.fraction).toBeCloseTo(0.125);
    expect([state.estimating, state.remainingMs, state.bytesPerSecond]).toEqual([true, null, null]);

    state = report(1000 + SETTLE_MS, 0, 2, GB, GB, GB);
    expect(state.fraction).toBeCloseTo(0.25);
    // Half a GB in 2 s, and 3 GB to go
    expect(state.bytesPerSecond).toBeCloseTo(GB / 4);
    expect(state.remainingMs).toBeCloseTo(12000);
    expect(state.estimating).toBe(false);
  });

  it("takes the server's size once it reports one, scaling the listing's sizes, without moving the bar back", () => {
    // The listing says 1 GB each, but its sizes are disk usage: the server copies twice that
    const timing = createTransferTiming(files(GB, GB), 0);
    const report = reporter(timing);
    report(0, 0, 2, 0, 2 * GB, 0);
    let state = report(SETTLE_MS, 0, 2, GB, 2 * GB, GB);
    // Half of the first item, which now weighs 2 GB like the second (scaled from its listing):
    // 3 GB to go at half a GB a second
    expect(state.fraction).toBeCloseTo(0.25);
    expect(state.remainingMs).toBeCloseTo(6000);

    // Items' bytes can still differ: a size bigger than expected doesn't take the bar back
    timing.update({ done: 1, total: 2 }, 2500);
    state = report(2600, 1, 2, 0, 6 * GB, 2 * GB);
    expect(state.fraction).toBeCloseTo(0.5);
  });

  it("counts each request's bytes once, late reports included, and nothing for a rename", () => {
    const timing = createTransferTiming(files(10, 10, 10), 0);
    timing.update({ done: 0, total: 3 }, 0);
    timing.update({ done: 1, total: 3 }, 100); // a rename: no reports
    timing.copied("op-1", 400);
    timing.update({ done: 1, total: 3, copied: 400, size: 1000 }, 200);
    timing.copied("op-1", 300); // an older report arriving late
    timing.copied("op-0", 0);
    timing.copied("op-1", 1000);
    const state = timing.update({ done: 2, total: 3 }, 200 + SETTLE_MS);
    expect(state.bytesPerSecond).toBeCloseTo(600 / (SETTLE_MS / 1000));
  });

  it("starts the averages at the first bytes, not at the wait before them", () => {
    const timing = createTransferTiming(files(GB), 0);
    const report = reporter(timing);
    timing.update({ done: 0, total: 1 }, 0);
    report(30000, 0, 1, 0, GB, 0);
    const state = report(30000 + SETTLE_MS, 0, 1, GB / 5, GB, GB / 5);
    expect(state.bytesPerSecond).toBeCloseTo(GB / 10);
  });

  it("slows the speed through a stall until it's estimating again", () => {
    const timing = createTransferTiming(files(GB), 0);
    const report = reporter(timing);
    report(0, 0, 1, 0, GB, 0);
    const moving = report(SETTLE_MS, 0, 1, GB / 2, GB, GB / 2);
    // No reports, only the prompt's clock re-running the last update
    const latest = { done: 0, total: 1, copied: GB / 2, size: GB };
    const stalled = timing.update(latest, SETTLE_MS + RATE_WINDOW_MS / 2);
    expect(stalled.bytesPerSecond).toBeLessThan(moving.bytesPerSecond);
    expect(stalled.remainingMs).toBeGreaterThan(moving.remainingMs);
    const still = timing.update(latest, SETTLE_MS + RATE_WINDOW_MS);
    expect([still.bytesPerSecond, still.remainingMs, still.estimating]).toEqual([null, null, true]);
  });

  it("estimates an item ahead with no listed size from those measured so far", () => {
    let timing = createTransferTiming(files(GB, null), 0);
    const report = reporter(timing);
    report(0, 0, 2, 0, GB, 0);
    let state = report(SETTLE_MS, 0, 2, GB / 2, GB, GB / 2);
    // The second is taken as 1 GB like the first: 1.5 GB to go at a quarter GB a second
    expect(state.remainingMs).toBeCloseTo(6000);

    // Before anything is measured there's nothing to go on
    timing = createTransferTiming(files(null, null), 0);
    timing.update({ done: 0, total: 2 }, 0);
    timing.copied("op-0", GB);
    state = timing.update({ done: 1, total: 2 }, 100);
    timing.copied("op-1", GB / 4);
    state = timing.update({ done: 1, total: 2 }, 100 + SETTLE_MS);
    expect([state.remainingMs, state.estimating]).toEqual([null, true]);
    expect(state.bytesPerSecond).toBeGreaterThan(0);
  });

  it("starts from the request's byte counts when no item is sized in time", () => {
    // Small files copy faster than the server reports, so only the counts come through
    const timing = createTransferTiming(files(GB / 4, GB / 4, GB / 4, GB / 4), 0);
    timing.update({ done: 0, total: 4 }, 0);
    timing.copied("op-0", GB / 4);
    timing.update({ done: 1, total: 4 }, 500);
    timing.copied("op-1", GB / 4);
    const state = timing.update({ done: 2, total: 4 }, 500 + SETTLE_MS);
    expect(state.bytesPerSecond).toBeCloseTo(GB / 8);
    // Half a GB to go at an eighth of a GB a second
    expect(state.remainingMs).toBeCloseTo(4000);
  });

  it("doesn't let a finished item that was never sized block the estimate", () => {
    // A small folder the listing hadn't measured, copied too fast to be sized
    const timing = createTransferTiming([{ size: null, folder: true }, ...files(GB)], 0);
    const report = reporter(timing);
    timing.update({ done: 0, total: 2 }, 0);
    timing.update({ done: 1, total: 2 }, 100);
    report(200, 1, 2, 0, GB, 0);
    const state = report(200 + SETTLE_MS, 1, 2, GB / 2, GB, GB / 2);
    // Half a GB to go at a quarter of a GB a second
    expect(state.remainingMs).toBeCloseTo(2000);
  });

  it("learns how far listing sizes are off from the items measured, within bounds", () => {
    // Folders the listing measured on a compressed pool: 3 GB listed, 9 GB of bytes
    let timing = createTransferTiming(files(3 * GB, 3 * GB), 0);
    let report = reporter(timing);
    report(0, 0, 2, 0, 9 * GB, 0);
    let state = report(SETTLE_MS, 0, 2, 3 * GB, 9 * GB, 3 * GB);
    // 6 GB of the first and 9 GB of the second to go, at 1.5 GB/s
    expect(state.remainingMs).toBeCloseTo(10000);

    // A folder listed at 8 KiB that is really 20 GB scales the next item by at most ten
    timing = createTransferTiming(files(8192, GB), 0);
    report = reporter(timing);
    report(0, 0, 2, 0, 20 * GB, 0);
    state = report(SETTLE_MS, 0, 2, 10 * GB, 20 * GB, 10 * GB);
    expect(state.remainingMs).toBeCloseTo(((10 + 10) / 5) * 1000);

    // One odd item among several doesn't set the scale: the lower median does
    timing = createTransferTiming(files(GB, GB, GB, GB), 0);
    report = reporter(timing);
    report(0, 0, 4, GB, GB, GB);
    timing.update({ done: 1, total: 4 }, 100);
    timing.copied("op-0", 2 * GB);
    timing.update({ done: 1, total: 4, copied: GB, size: GB }, 200);
    timing.update({ done: 2, total: 4 }, 300);
    timing.copied("op-0", 3 * GB);
    state = timing.update({ done: 2, total: 4, copied: 0, size: 500 * GB }, SETTLE_MS);
    // The last item is still taken as 1 GB, not 500: 501 GB to go at 1 GB/s
    expect(state.remainingMs).toBeCloseTo(501000);
  });

  it("says it's finishing only when the last item is fully written", () => {
    const timing = createTransferTiming(files(GB, GB), 0);
    const report = reporter(timing);
    report(0, 0, 2, 0, GB, 0);
    // The first item is written, but there's another to come
    let state = report(SETTLE_MS, 0, 2, GB, GB, GB);
    expect([state.finishing, state.remainingMs]).toEqual([false, 2000]);
    timing.update({ done: 1, total: 2 }, SETTLE_MS + 100);
    state = report(SETTLE_MS + 2000, 1, 2, GB, GB, 2 * GB);
    expect(state.finishing).toBe(true);
  });

  it("keeps the bar moving when an item turns out bigger than estimated", () => {
    // An 8 GB file, then a folder the listing didn't measure: taken as 8 GB until it's sized
    const timing = createTransferTiming(files(8 * GB, null), 0);
    const report = reporter(timing);
    report(0, 0, 2, 8 * GB, 8 * GB, 8 * GB);
    timing.update({ done: 1, total: 2 }, 100);
    expect(timing.update({ done: 1, total: 2 }, 100).fraction).toBeCloseTo(0.5);
    // It's 20 GB: from half way, the rest of the bar is the folder's 20 GB
    report(200, 1, 2, 0, 20 * GB, 8 * GB);
    const state = report(300, 1, 2, 10 * GB, 20 * GB, 18 * GB);
    expect(state.fraction).toBeCloseTo(0.75);
  });

  it("says it's finishing once every byte is written but the item isn't through", () => {
    // e.g. a moved folder's source being deleted
    const timing = createTransferTiming(files(GB), 0);
    const report = reporter(timing);
    report(0, 0, 1, 0, GB, 0);
    report(SETTLE_MS, 0, 1, GB, GB, GB);
    const state = timing.update({ done: 0, total: 1, copied: GB, size: GB }, SETTLE_MS + 30000);
    expect([state.finishing, state.estimating, state.remainingMs]).toEqual([true, false, null]);
    expect(state.fraction).toBe(1);
  });

  it("makes no estimate without byte reports, or once everything is done", () => {
    let timing = createTransferTiming(files(GB, GB), 0);
    timing.update({ done: 0, total: 2 }, 0);
    expect(timing.update({ done: 1, total: 2 }, 60000)).toEqual({
      startedAt: 0, now: 60000, fraction: 0.5, bytesPerSecond: null, remainingMs: null, estimating: false, finishing: false,
    });

    timing = createTransferTiming(files(GB), 0);
    const report = reporter(timing);
    report(0, 0, 1, 0, GB, 0);
    report(SETTLE_MS, 0, 1, GB, GB, GB);
    expect(timing.update({ done: 1, total: 1 }, SETTLE_MS + 100)).toMatchObject({
      fraction: 1, remainingMs: null, estimating: false, finishing: false,
    });
  });
});

describe("time formatting", () => {
  it("reads elapsed time like a clock", () => {
    expect([0, 7000, 754000, 3723000].map(formatElapsed)).toEqual(["0:00", "0:07", "12:34", "1:02:03"]);
  });

  it("rounds time left as Finder does", () => {
    expect(roundTimeLeft(1000)).toEqual({ value: 5, unit: "second" });
    expect(roundTimeLeft(41000)).toEqual({ value: 45, unit: "second" });
    expect(roundTimeLeft(58000)).toEqual({ value: 1, unit: "minute" });
    expect(roundTimeLeft(150000)).toEqual({ value: 3, unit: "minute" });
    expect(roundTimeLeft(2 * 3600000 + 20 * 60000)).toEqual({ value: 2.3, unit: "hour" });
    expect(formatTimeLeft(150000, "en")).toBe("3 minutes");
    expect(formatTimeLeft(150000, "de")).toBe("3 Minuten");
  });
});
