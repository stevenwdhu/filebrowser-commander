// Checks and batching for the move/copy prompt: what is being moved, whether the chosen
// destination can take it, and running the request in steps so the prompt can show progress.
import { normalizeDirPath } from "@/utils/moveCopyDestinations.js";

/** Most requests an operation is split into; each one moves the progress bar. */
export const MAX_PROGRESS_STEPS = 50;

/** Window event that carries the server's progress for a copy or move (notify/events.js). */
export const MOVE_COPY_PROGRESS_EVENT = "moveCopyProgressEvent";

/** Items are prompt items: { from, fromSource, name, type?, size? }. Directory paths end in "/". */
export function isDirectoryItem(item) {
  return item.type === "directory" || item.from.endsWith("/");
}

function parentDir(path) {
  const trimmed = path.replace(/\/+$/, "");
  return normalizeDirPath(trimmed.slice(0, trimmed.lastIndexOf("/")));
}

/** Counts for the prompt's summary line; size is null unless every item has one. */
export function summarizeItems(items) {
  const summary = { count: items.length, folders: 0, files: 0, size: 0 };
  for (const item of items) {
    if (isDirectoryItem(item)) {
      summary.folders++;
    } else {
      summary.files++;
    }
    summary.size = typeof item.size === "number" && summary.size !== null ? summary.size + item.size : null;
  }
  return summary;
}

/**
 * Why the items can't go to the destination, or null when they can:
 * "destinationUnavailable", "noPermission", "intoItself" or "sameFolder".
 */
export function moveCopyBlockReason({ operation, items, destSource, destPath, destError, canWrite }) {
  if (destError) return "destinationUnavailable";
  if (!canWrite) return "noPermission";
  const dest = normalizeDirPath(destPath);
  for (const item of items) {
    if (item.fromSource !== destSource) continue;
    if (isDirectoryItem(item) && dest.startsWith(normalizeDirPath(item.from))) return "intoItself";
    if (operation === "move" && parentDir(item.from) === dest) return "sameFolder";
  }
  return null;
}

/** The message shown for a block reason. */
export function blockReasonMessage(reason, t) {
  switch (reason) {
    case "destinationUnavailable":
      return t("files.cannotAccesDir");
    case "noPermission":
      return t("prompts.moveCopyNoPermission");
    case "intoItself":
      return t("prompts.moveCopyIntoItself");
    case "sameFolder":
      return t("files.sameFolder");
    default:
      return "";
  }
}

/** Split items into at most `maxSteps` consecutive batches. */
export function batchItems(items, maxSteps = MAX_PROGRESS_STEPS) {
  const size = Math.max(1, Math.ceil(items.length / maxSteps));
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function mergeResult(into, result) {
  into.succeeded.push(...(result?.succeeded || []));
  into.failed.push(...(result?.failed || []));
}

/**
 * Run a move/copy one batch at a time and merge the results into one { succeeded, failed }, the
 * shape a single request returns. runBatch gets each batch and the index of its first item.
 * onProgress gets { done, total, current } before each batch (current is the batch's first item
 * name) and once more when everything has run.
 */
export async function runInBatches(items, runBatch, onProgress = () => {}) {
  const result = { succeeded: [], failed: [] };
  const total = items.length;
  let done = 0;
  for (const batch of batchItems(items)) {
    onProgress({ done, total, current: batch[0].name });
    try {
      mergeResult(result, await runBatch(batch, done));
    } catch (error) {
      if (error?.failed || error?.succeeded) {
        // The API attaches per-item results to a failed request
        mergeResult(result, error);
      } else if (result.succeeded.length === 0) {
        throw error;
      } else {
        // Stop at an unexpected error but still report what already went through
        result.failed.push(
          ...items.slice(done).map((item) => ({
            fromSource: item.fromSource,
            fromPath: item.from,
            message: error?.message || "",
          })),
        );
        done = total;
        break;
      }
    }
    done += batch.length;
  }
  onProgress({ done, total, current: null });
  return result;
}

/** An id for one operation's progress events, so another tab's operation is never taken for it. */
export function newProgressId() {
  // randomUUID needs a secure context (https or localhost)
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Follow the server's progress reports. onProgress gets { id, done, total, current, copied, size,
 * bytes } for each request that asked for them: done and total count that request's items, copied
 * and size are the bytes of the item it is on (size is 0 until known, and for a rename), and bytes
 * is everything the request has written so far. Returns a function that stops listening.
 */
export function watchProgress(onProgress) {
  const listener = (event) => {
    const progress = event.detail;
    if (!progress?.id) return;
    onProgress({
      id: progress.id,
      done: progress.items,
      total: progress.totalItems,
      current: progress.current || null,
      copied: progress.copied,
      size: progress.size,
      bytes: progress.bytes,
    });
  };
  window.addEventListener(MOVE_COPY_PROGRESS_EVENT, listener);
  return () => window.removeEventListener(MOVE_COPY_PROGRESS_EVENT, listener);
}
