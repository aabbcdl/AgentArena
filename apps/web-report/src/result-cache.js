/**
 * Result caching module — localStorage + IndexedDB persistence for benchmark runs.
 */

import { resultStore } from "./utils/storage.js";

const RUN_CACHE_STORAGE_KEY = "agentarena.webReport.cachedRuns.v1";
const RUN_CACHE_MAX_BYTES = 1_500_000;

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function removeStorage(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Restore cached runs from localStorage.
 * @returns {{ runs: Array, markdownByRunId: Map, standaloneMarkdown: string|null } | null}
 */
export function restoreCachedRuns() {
  const raw = readStorage(RUN_CACHE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.runs)) return null;

    const markdownEntries = parsed.markdownEntries;
    return {
      runs: parsed.runs,
      markdownByRunId: new Map(
        Array.isArray(markdownEntries)
          ? markdownEntries.filter((entry) => Array.isArray(entry) && entry.length === 2)
          : []
      ),
      standaloneMarkdown: typeof parsed.standaloneMarkdown === "string" ? parsed.standaloneMarkdown : null
    };
  } catch {
    return null;
  }
}

/**
 * Persist current runs to localStorage and IndexedDB.
 */
export function persistCachedRuns(state) {
  if (state.runs.length === 0) {
    removeStorage(RUN_CACHE_STORAGE_KEY);
    return;
  }

  const payload = {
    version: 1,
    runs: state.runs,
    markdownEntries: Array.from(state.markdownByRunId.entries()),
    standaloneMarkdown: state.standaloneMarkdown
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > RUN_CACHE_MAX_BYTES) {
    removeStorage(RUN_CACHE_STORAGE_KEY);
    return;
  }
  writeStorage(RUN_CACHE_STORAGE_KEY, serialized);

  // Async save to IndexedDB (non-blocking)
  persistRunsToIndexedDB(state);
}

/**
 * Persist runs to IndexedDB asynchronously.
 */
async function persistRunsToIndexedDB(state) {
  if (!resultStore.isAvailable() || state.runs.length === 0) return;
  try {
    for (const run of state.runs) {
      await resultStore.saveRun(run);
    }
    for (const [runId, markdown] of state.markdownByRunId) {
      await resultStore.saveTrace(runId, { markdown });
    }
  } catch (err) {
    console.warn('IndexedDB save failed:', err);
  }
}

/**
 * Restore runs from IndexedDB.
 * @returns {Promise<{runs: Array, markdownByRunId: Map} | null>}
 */
export async function restoreRunsFromIndexedDB() {
  if (!resultStore.isAvailable()) return null;
  try {
    const runs = await resultStore.getAllRuns();
    if (!runs || runs.length === 0) return null;

    const markdownByRunId = new Map();
    for (const run of runs) {
      const trace = await resultStore.getTrace(run.runId);
      if (trace?.markdown) {
        markdownByRunId.set(run.runId, trace.markdown);
      }
    }

    return { runs, markdownByRunId };
  } catch (err) {
    console.warn('IndexedDB restore failed:', err);
    return null;
  }
}

/**
 * Read a value from localStorage with error handling.
 */
export { readStorage, removeStorage, writeStorage };
