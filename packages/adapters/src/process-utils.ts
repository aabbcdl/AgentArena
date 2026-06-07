import { execFileSync, spawn } from "node:child_process";
import { access, constants as fsConstants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { BenchmarkCancelledError, MAX_PROCESS_OUTPUT_BYTES, pathExists, resolveTimeoutMs } from "@agentarena/core";
import { adapterWarn } from "./adapter-diagnostics.js";

const accessAsync = promisify(access);

export { MAX_PROCESS_OUTPUT_BYTES, pathExists };

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal?: NodeJS.Signals;
  error?: string;
}

interface ProcessError extends Error {
  code?: string;
  signal?: NodeJS.Signals;
  exitCode?: number | null;
}

/**
 * Default agent execution timeout: 15 minutes.
 *
 * Rationale: Most agent tasks complete in 1-5 minutes. 15 minutes provides
 * generous headroom for complex tasks (large codebases, multi-file changes)
 * while preventing indefinite hangs. Overridable via AGENTARENA_AGENT_TIMEOUT_MS env var.
 */
export const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60 * 1_000;

/**
 * Grace period before sending SIGKILL after SIGTERM (Unix only).
 * 2 seconds gives the process time to flush buffers, close file handles,
 * and run cleanup handlers. Shorter than TERMINATE_ESCALATE_MS because
 * runProcess has a timeout deadline and needs faster escalation.
 */
const SIGKILL_GRACE_MS = 2000;

/**
 * Wait time before escalating to SIGKILL in terminateProcessTree (Unix only).
 * 1 second is sufficient for graceful shutdown of child process trees.
 * Shorter than SIGKILL_GRACE_MS because terminateProcessTree is called
 * during workspace cleanup where speed matters more than graceful shutdown.
 */
const TERMINATE_ESCALATE_MS = 1000;

export function agentTimeoutMs(): number {
  return resolveTimeoutMs(process.env.AGENTARENA_AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS);
}

/**
 * Default preflight auth probe timeout: 60 seconds.
 *
 * Third-party providers (mimo, etc.) may have higher latency than official Anthropic API.
 * 60s provides enough headroom for slow networks + model cold starts.
 * Overridable via AGENTARENA_PREFLIGHT_TIMEOUT_MS env var.
 */
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 60_000;

export function preflightTimeoutMs(): number {
  return resolveTimeoutMs(process.env.AGENTARENA_PREFLIGHT_TIMEOUT_MS, DEFAULT_PREFLIGHT_TIMEOUT_MS);
}

/**
 * Default transport timeout: 120 seconds.
 *
 * Third-party providers may have high latency. 120s provides generous headroom.
 * Overridable via AGENTARENA_TRANSPORT_TIMEOUT_MS env var.
 */
const DEFAULT_TRANSPORT_TIMEOUT_MS = 120_000;

export function transportTimeoutMs(): number {
  return resolveTimeoutMs(process.env.AGENTARENA_TRANSPORT_TIMEOUT_MS, DEFAULT_TRANSPORT_TIMEOUT_MS);
}

export function formatTimeoutMessage(timeoutMs: number): string {
  return `Process timed out after ${timeoutMs}ms.`;
}

export function safeNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return;
  }

  if (signal.aborted) {
    throw new BenchmarkCancelledError();
  }

  await new Promise<void>((resolve, reject) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      signal.removeEventListener("abort", onAbort);
    };

    timeoutHandle = setTimeout(() => {
      cleanup();
      resolve();
    }, durationMs);

    const onAbort = () => {
      cleanup();
      reject(new BenchmarkCancelledError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function findExecutableOnPath(names: string[]): Promise<string | undefined> {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      try {
        // Check both existence and execute permission (on Unix)
        await accessAsync(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Not found or not executable — continue searching
      }
    }
  }

  return undefined;
}

/**
 * Spawn a child process and collect its output.
 *
 * ERROR HANDLING CONTRACT:
 * This function NEVER throws. All failure modes (spawn errors, timeouts,
 * cancellations, process crashes) are captured and returned as fields on
 * the `ProcessResult` object:
 *   - `exitCode: null` + `error: "<message>"` → spawn failed
 *   - `timedOut: true` → process exceeded timeoutMs
 *   - `signal: "SIGTERM"` + `error: "cancelled"` → AbortSignal fired
 *
 * Callers should check `result.exitCode === 0 && !result.error` to
 * determine success. A try/catch around the `await runProcess(...)` call
 * is unnecessary but harmless — it will never trigger.
 */
export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = agentTimeoutMs(),
  environment?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  stdinInput?: string
): Promise<ProcessResult> {
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    // Accumulate chunks as Buffers and concat once at finish.
    // This avoids the O(n²) `stdout += chunk.toString()` pattern that
    // grows quadratically with output size (each concat reallocates the
    // entire prefix). It also lets us count bytes from `chunk.length`
    // directly instead of round-tripping through `.toString().byteLength`.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let resolved = false;
    /**
     * cleanedUp guards the cleanup() helper against re-entry. Without it, a
     * race between onAbort and onTimeout could create two SIGKILL timers, and
     * the second would orphan when finish() clears only the first reference.
     */
    let cleanedUp = false;
    let closeSignal: NodeJS.Signals | undefined;
    let processError: string | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let sigkillHandle: NodeJS.Timeout | undefined;

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const truncateMarker = (label: "stdout" | "stderr") =>
      Buffer.from(`\n[${label} truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`);

    const buildStdout = (): string => Buffer.concat(stdoutChunks).toString("utf8");
    const buildStderr = (): string => Buffer.concat(stderrChunks).toString("utf8");

    const finish = (result: ProcessResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (sigkillHandle) clearTimeout(sigkillHandle);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (child && !child.killed && child.pid) {
        const pid = child.pid;
        try {
          if (sigkillHandle) {
            clearTimeout(sigkillHandle);
            sigkillHandle = undefined;
          }
          if (process.platform !== "win32") {
            try {
              process.kill(-pid, "SIGTERM");
            } catch (e) {
              adapterWarn("process group SIGTERM failed, falling back to child.kill", { pid, error: e instanceof Error ? e.message : String(e) });
              if (child) child.kill("SIGTERM");
            }
            sigkillHandle = setTimeout(() => {
              try {
                process.kill(-pid, "SIGKILL");
              } catch (e) {
                adapterWarn("process group SIGKILL failed", { pid, error: e instanceof Error ? e.message : String(e) });
                if (child && !child.killed) child.kill("SIGKILL");
              }
              sigkillHandle = undefined;
            }, SIGKILL_GRACE_MS);
          } else {
            if (pid === undefined) return;
            try {
              execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
            } catch (e) {
              adapterWarn("taskkill failed, falling back to child.kill", { pid, error: e instanceof Error ? e.message : String(e) });
              if (child) child.kill("SIGTERM");
            }
          }
        } catch (e) {
          adapterWarn("all process kill attempts failed — possible orphan", { pid, error: e instanceof Error ? e.message : String(e) });
        }
      }
    };

    const onAbort = () => {
      cleanup();
      finish({
        exitCode: null,
        stdout: buildStdout(),
        stderr: `${buildStderr()}\nProcess cancelled.`.trim(),
        timedOut: false,
        signal: "SIGTERM",
        error: "cancelled"
      });
    };

    const onTimeout = () => {
      timedOut = true;
      cleanup();
    };

    try {
      child = spawn(command, args, {
        cwd,
        env: environment,
        stdio: [stdinInput !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        windowsHide: true,
        windowsVerbatimArguments: false,
        ...(process.platform !== "win32" ? { detached: true } : {})
      });

      // Feed stdin input (e.g. prompt text) then close the stream.
      // This avoids shell escaping issues on Windows where special
      // characters in the prompt (quotes, backticks, etc.) would break
      // argument parsing under shell: true.
      if (stdinInput !== undefined && child.stdin) {
        child.stdin.write(stdinInput);
        child.stdin.end();
      }
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      finish({
        exitCode: -1,
        stdout: "",
        stderr: `Failed to spawn process: ${errorMessage}`,
        timedOut: false,
        error: errorMessage
      });
      return;
    }

    timeoutHandle = setTimeout(onTimeout, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROCESS_OUTPUT_BYTES) {
        const remaining = MAX_PROCESS_OUTPUT_BYTES - (stdoutBytes - chunk.length);
        if (remaining > 0) stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutChunks.push(truncateMarker("stdout"));
        stdoutTruncated = true;
      } else {
        stdoutChunks.push(chunk);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_PROCESS_OUTPUT_BYTES) {
        const remaining = MAX_PROCESS_OUTPUT_BYTES - (stderrBytes - chunk.length);
        if (remaining > 0) stderrChunks.push(chunk.subarray(0, remaining));
        stderrChunks.push(truncateMarker("stderr"));
        stderrTruncated = true;
      } else {
        stderrChunks.push(chunk);
      }
    });

    child.on("error", (error: ProcessError) => {
      processError = error.message;
      finish({
        exitCode: error.exitCode ?? -1,
        stdout: buildStdout(),
        stderr: `${buildStderr()}\nProcess error: ${error.message}`.trim(),
        timedOut: false,
        signal: error.signal,
        error: error.message
      });
    });

    child.on("close", (exitCode, closeSignalValue) => {
      closeSignal = closeSignalValue ?? undefined;
      const timeoutSuffix = timedOut ? `\n${formatTimeoutMessage(timeoutMs)}` : "";
      const errorSuffix = processError ? `\nProcess error: ${processError}` : "";
      finish({
        exitCode,
        stdout: buildStdout(),
        stderr: `${buildStderr()}${timeoutSuffix}${errorSuffix}`.trim(),
        timedOut,
        signal: closeSignal
      });
    });

    child.on("disconnect", () => {
      if (!resolved) {
        stderrChunks.push(Buffer.from("\nProcess disconnected unexpectedly."));
      }
    });
  });
}

/**
 * Forcefully terminate a process tree.
 * On Windows: uses taskkill /F /T with retry.
 * On Unix: kills process group, escalates to SIGKILL after 1s.
 * This is used when cancelling a run to guarantee subprocess termination.
 */
export async function terminateProcessTree(pid: number): Promise<void> {
  if (!pid || pid <= 0) return;

  if (process.platform === "win32") {
    // Windows: taskkill with retry (3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
        return; // Success
      } catch { /* best-effort: retry loop handles failure */ }
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    // Final fallback: try child.kill
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      adapterWarn("process.kill SIGTERM fallback failed", { pid, error: error instanceof Error ? error.message : String(error) });
    }
  } else {
    // Unix: kill entire process group
    try {
      process.kill(-pid, "SIGTERM");
    } catch { /* best-effort: fall back to single-process kill */
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        adapterWarn("process.kill SIGTERM fallback failed", {
          pid,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Escalate to SIGKILL after grace period
    await new Promise((resolve) => setTimeout(resolve, TERMINATE_ESCALATE_MS));
    try {
      process.kill(-pid, "SIGKILL");
    } catch { /* best-effort: fall back to single-process kill */
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        adapterWarn("process.kill SIGKILL fallback failed", {
          pid,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
