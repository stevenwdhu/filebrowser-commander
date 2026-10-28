// Elapsed time, speed and time left for the copy/move prompt, worked out from its progress
// updates (runInBatches and the server's moveCopyProgress reports). Pure: callers pass the time.

/** How much recent history the speed and the time left are averaged over. */
export const RATE_WINDOW_MS = 5000;
/** How long bytes must have been reported before there's an estimate, as Finder waits. */
export const SETTLE_MS = 2000;
// How far the server's sizes may rescale the listing's: enough for disk usage versus bytes (ZFS
// compression), but not as far as a folder the index last saw nearly empty
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;

/**
 * Follow one operation. items are its items in order, { size }, with the listing's size or null
 * when it isn't known. Sizes are only estimates: the listing can show disk usage rather than
 * bytes, and a folder's can be out of date. An item's own size takes over once the server reports it.
 *
 * - copied(requestId, bytes) takes the server's running count of bytes one request has written.
 *   Every report counts, even a late one, because the speed comes from these counts.
 * - update(progress, now) takes each progress update, { done, total, copied?, size? } with copied
 *   and size the current item's bytes as the server reports them, or the last update again to
 *   move the clock on. It returns { startedAt, now, fraction, bytesPerSecond, remainingMs,
 *   estimating, finishing }: fraction is how far the whole operation is (0 to 1, never going
 *   back); bytesPerSecond and remainingMs stay null until there's an estimate; estimating is true
 *   while bytes are being reported but there's no estimate yet; finishing is true once the last
 *   item is fully written but not yet through (e.g. a moved folder's source being deleted).
 */
export function createTransferTiming(items, startedAt) {
  const listed = items.map(({ size }) => (Number.isFinite(size) && size >= 0 ? size : null));
  const reported = []; // per item, the size the server gave once it started copying it
  const bytesByRequest = new Map();
  let firstReportAt = null;
  let shownFraction = 0;
  // The bar's footing: the work done and in all when the estimate last changed, and the bar then
  let anchor = { fraction: 0, done: 0, total: null };
  let samples = [];

  // How the server's sizes compare with the listing's: the lower median of the items it measured,
  // so one folder the index saw nearly empty can't skew the rest, and within bounds
  function scale() {
    const ratios = [];
    reported.forEach((size, index) => {
      if (size !== undefined && listed[index] > 0) ratios.push(size / listed[index]);
    });
    if (ratios.length === 0) return 1;
    ratios.sort((a, b) => a - b);
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, ratios[Math.floor((ratios.length - 1) / 2)]));
  }

  // Bytes each item's copy writes: the server's figure, or the scaled listing size. An item still
  // to come with no listed size is taken as the average of those measured so far (null before
  // any); a finished one that was never sized is done, so it counts for nothing.
  function work(done) {
    const ratio = scale();
    const measured = reported.filter((size) => size !== undefined);
    const average = measured.length ? measured.reduce((sum, size) => sum + size, 0) / measured.length : null;
    return listed.map((size, index) => {
      if (reported[index] !== undefined) return reported[index];
      if (size !== null) return size * ratio;
      return index < done ? 0 : average;
    });
  }

  function copiedTotal() {
    let total = 0;
    for (const bytes of bytesByRequest.values()) total += bytes;
    return total;
  }

  // Change per second over the last RATE_WINDOW_MS, reading the value at the window's start
  // between the samples either side of it, so a stall without updates still counts
  function rateOver(now, key) {
    const start = now - RATE_WINDOW_MS;
    const [first, second] = samples;
    let from = first.at;
    let value = first[key];
    if (second && first.at < start) {
      value += ((second[key] - first[key]) * (start - first.at)) / (second.at - first.at);
      from = start;
    }
    const last = samples[samples.length - 1];
    const seconds = (last.at - from) / 1000;
    return seconds > 0 ? (last[key] - value) / seconds : 0;
  }

  return {
    copied(requestId, bytes) {
      if (!(bytes >= 0)) return;
      bytesByRequest.set(requestId, Math.max(bytesByRequest.get(requestId) ?? 0, bytes));
    },

    update(progress, now) {
      const { done, total } = progress;
      const reporting = progress.size > 0 && done < total;
      if (reporting) reported[done] = progress.size;
      const bytes = copiedTotal();
      if (firstReportAt === null && (reporting || bytes > 0)) {
        // The averages start with the first bytes, not with the wait before them
        firstReportAt = now;
        samples = [];
      }
      const current = reporting ? Math.min(progress.copied / progress.size, 1) : 0;

      // Weighted by each item's bytes when they're all known, else by items
      const bytesOf = work(done);
      const known = bytesOf.length === total && bytesOf.every((bytes) => bytes !== null);
      const byteTotal = known ? bytesOf.reduce((sum, bytes) => sum + bytes, 0) : 0;
      const byBytes = byteTotal > 0;
      const workTotal = byBytes ? byteTotal : total;
      const workDone = byBytes
        ? bytesOf.slice(0, done).reduce((sum, bytes) => sum + bytes, 0) + (done < total ? current * bytesOf[done] : 0)
        : done + current;
      // When the estimate changes (an item turns out bigger than thought, or sizes become known)
      // and the new figure is behind the bar, the bar carries on from where it is over the work
      // left, rather than waiting for the figure to catch up
      if (workTotal !== anchor.total) {
        const behind = workTotal > 0 && workDone / workTotal < shownFraction;
        anchor = behind
          ? { fraction: shownFraction, done: workDone, total: workTotal }
          : { fraction: 0, done: 0, total: workTotal };
      }
      const left = anchor.total - anchor.done;
      const fraction = left > 0 ? anchor.fraction + ((1 - anchor.fraction) * (workDone - anchor.done)) / left : 1;
      shownFraction = total ? Math.min(1, Math.max(shownFraction, fraction)) : 0;

      samples.push({ at: now, fraction: shownFraction, bytes });
      // Keep one sample at or before the window's start
      while (samples.length > 2 && samples[1].at <= now - RATE_WINDOW_MS) samples.shift();

      const result = {
        startedAt,
        now,
        fraction: shownFraction,
        bytesPerSecond: null,
        remainingMs: null,
        estimating: false,
        finishing: false,
      };
      if (firstReportAt === null || done >= total) return result;
      if (now - firstReportAt < SETTLE_MS) {
        result.estimating = true;
        return result;
      }
      const byteRate = rateOver(now, "bytes");
      if (byteRate > 0) result.bytesPerSecond = byteRate;
      // Every byte of the last item is written, but it isn't through: the server may still be
      // working on it, e.g. deleting a moved folder's source
      const after = byBytes ? bytesOf.slice(done + 1).reduce((sum, bytes) => sum + bytes, 0) : total - done - 1;
      if (reporting && progress.copied >= progress.size && after === 0) {
        result.finishing = true;
      } else if (byBytes && byteRate > 0) {
        // In bytes: what's left of the current item and everything after it. Before any size is
        // known it's estimating, rather than guessing from item counts.
        const bytesLeft = after + (1 - current) * bytesOf[done];
        result.remainingMs = (bytesLeft / byteRate) * 1000;
      }
      result.estimating = result.remainingMs === null && !result.finishing;
      return result;
    },
  };
}

/** A clock reading: "0:07", "12:34", "1:02:03". */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * Time left, rounded as Finder rounds it: up to the next 5 seconds under a minute, then whole
 * minutes, then hours to a tenth. Returns { value, unit } for Intl.NumberFormat.
 */
export function roundTimeLeft(ms) {
  const seconds = ms / 1000;
  if (seconds <= 55) return { value: Math.max(5, Math.ceil(seconds / 5) * 5), unit: "second" };
  if (seconds < 90 * 60) return { value: Math.max(1, Math.round(seconds / 60)), unit: "minute" };
  return { value: Math.round(seconds / 360) / 10, unit: "hour" };
}

/** Time left in words for a BCP 47 locale, e.g. "2 minutes". */
export function formatTimeLeft(ms, locale) {
  const { value, unit } = roundTimeLeft(ms);
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long", maximumFractionDigits: 1 }).format(value);
}
