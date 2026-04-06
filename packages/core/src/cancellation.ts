export class BenchmarkCancelledError extends Error {
  constructor(message = "Benchmark run cancelled.") {
    super(message);
    this.name = "BenchmarkCancelledError";
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof BenchmarkCancelledError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && (error as { name: string }).name === "AbortError")
  );
}

export function throwIfAborted(signal: AbortSignal | undefined, message = "Benchmark run cancelled."): void {
  if (signal?.aborted) {
    throw new BenchmarkCancelledError(message);
  }
}

export function createCancellation(signal?: AbortSignal): import("./types.js").BenchmarkCancellation {
  const effectiveSignal = signal ?? new AbortController().signal;
  return {
    signal: effectiveSignal,
    throwIfCancelled: () => {
      throwIfAborted(effectiveSignal);
    }
  };
}
