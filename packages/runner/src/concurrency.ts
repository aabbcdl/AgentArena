import { isAbortError } from "@agentarena/core";
import { formatErrorMessage } from "./workspace.js";

const DEFAULT_AGENT_CONCURRENCY = 1;
const DEFAULT_AGENT_EXECUTE_TIMEOUT_MS = 30 * 60 * 1_000;

export { DEFAULT_AGENT_CONCURRENCY };

export interface MapWithConcurrencyResult<R> {
  results: (R | Error)[];
  aborted: boolean;
}

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
        console.error(`mapWithConcurrency: item[${currentIndex}] failed: ${formatErrorMessage(error)}`);
      }
    }
  }

  const workers = Array.from({ length: safeLimit }, () => worker());
  await Promise.all(workers);

  return {
    results: results.filter((value): value is R | Error => value !== undefined),
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
