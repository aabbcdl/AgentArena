/**
 * Timeout utility for wrapping promises with a deadline.
 *
 * Extracted from agent-lifecycle.ts for independent testability.
 */

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve within
 * `timeoutMs`, the returned promise rejects with a timeout error.
 *
 * The original promise is NOT cancelled on timeout — it continues running
 * in the background. The timer is cleared when the promise settles.
 */
export function wrapWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      clearTimeout(timeoutHandle);
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutHandle);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
  });
}
