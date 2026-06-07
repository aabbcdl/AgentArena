import os from "node:os";
import { isAbortError, logger } from "@agentarena/core";
import { formatErrorMessage } from "./workspace.js";

const DEFAULT_AGENT_CONCURRENCY = Math.min(4, os.cpus().length || 1);
const DEFAULT_AGENT_EXECUTE_TIMEOUT_MS = 30 * 60 * 1_000;

export { DEFAULT_AGENT_CONCURRENCY };

export interface MapWithConcurrencyResult<R> {
  results: (R | Error | undefined)[];
  aborted: boolean;
}

/**
 * Run a mapper function over an array with bounded concurrency.
 *
 * CONCURRENCY SAFETY:
 * This implementation uses a shared mutable `nextIndex` counter that is
 * incremented inside an `async function`. This is safe in Node.js because:
 *   1. JavaScript is single-threaded — only one worker function runs at a time.
 *   2. The `nextIndex` read-increment is purely synchronous (no `await` between
 *      `const currentIndex = nextIndex` and `nextIndex += 1`), so no other
 *      worker can observe a torn read.
 *   3. Workers only yield control at `await mapper(...)` and `await` inside
 *      the while-loop body, both of which happen AFTER the index has been
 *      claimed.
 *
 * If this code were ever ported to a true multi-threaded runtime (e.g.
 * `worker_threads` with shared memory), the counter would need to be
 * replaced with `Atomics.add()` on a `SharedArrayBuffer`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
  options: { signal?: AbortSignal } = {}
): Promise<MapWithConcurrencyResult<R>> {
  if (items.length === 0) {
    return { results: [], aborted: false };
  }

  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R | Error | undefined>(items.length);
  let nextIndex = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (options.signal?.aborted) {
        aborted = true;
        return;
      }

      // Synchronous claim — no await between read and increment.
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (error) {
        if (isAbortError(error)) {
          aborted = true;
          return;
        }
        results[currentIndex] = error instanceof Error ? error : new Error(String(error));
        logger.error("runner", "concurrency.item_failed", `mapWithConcurrency: item[${currentIndex}] failed: ${formatErrorMessage(error)}`, { error });
      }
    }
  }

  const workers = Array.from({ length: safeLimit }, () => worker());
  await Promise.all(workers);

  return {
    results: results as (R | Error | undefined)[],
    aborted
  };
}

export function resolvePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function agentConcurrency(options: { maxConcurrency?: number }): number {
  return options.maxConcurrency ?? resolvePositiveInt(process.env.AGENTARENA_MAX_CONCURRENCY, DEFAULT_AGENT_CONCURRENCY);
}

export function agentExecuteTimeoutMs(): number {
  return resolvePositiveInt(
    process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS,
    DEFAULT_AGENT_EXECUTE_TIMEOUT_MS
  );
}
