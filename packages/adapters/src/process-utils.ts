import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { BenchmarkCancelledError, MAX_PROCESS_OUTPUT_BYTES, pathExists, resolveTimeoutMs } from "@agentarena/core";
import { adapterWarn } from "./adapter-diagnostics.js";

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

export const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60 * 1_000;

export function agentTimeoutMs(): number {
  return resolveTimeoutMs(process.env.AGENTARENA_AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS);
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

  await new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, durationMs);

    const onAbort = () => {
      clearTimeout(timeoutHandle);
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
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = agentTimeoutMs(),
  environment?: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<ProcessResult> {
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;
    let closeSignal: NodeJS.Signals | undefined;
    let processError: string | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let sigkillHandle: NodeJS.Timeout | undefined;

    const finish = (result: ProcessResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (sigkillHandle) clearTimeout(sigkillHandle);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const cleanup = () => {
      if (child && !child.killed && child.pid) {
        const pid = child.pid;
        try {
          // Clear any existing SIGKILL timer to prevent duplicates
          if (sigkillHandle) {
            clearTimeout(sigkillHandle);
            sigkillHandle = undefined;
          }
          if (process.platform !== "win32") {
            // Kill the entire process group on Unix
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
            }, 2000);
          } else {
            // Use taskkill to kill the process tree on Windows
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
        stdout,
        stderr: `${stderr}\nProcess cancelled.`.trim(),
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
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: false,
        ...(process.platform !== "win32" ? { detached: true } : {})
      });
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

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const str = chunk.toString("utf8");
      stdoutBytes += Buffer.byteLength(str, "utf8");
      if (stdoutBytes > MAX_PROCESS_OUTPUT_BYTES) {
        const remaining = MAX_PROCESS_OUTPUT_BYTES - (stdoutBytes - Buffer.byteLength(str, "utf8"));
        stdout += Buffer.from(str, "utf8").slice(0, remaining).toString("utf8");
        stdout += `\n[stdout truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`;
        stdoutTruncated = true;
      } else {
        stdout += str;
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      const str = chunk.toString("utf8");
      stderrBytes += Buffer.byteLength(str, "utf8");
      if (stderrBytes > MAX_PROCESS_OUTPUT_BYTES) {
        const remaining = MAX_PROCESS_OUTPUT_BYTES - (stderrBytes - Buffer.byteLength(str, "utf8"));
        stderr += Buffer.from(str, "utf8").slice(0, remaining).toString("utf8");
        stderr += `\n[stderr truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`;
        stderrTruncated = true;
      } else {
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (error: ProcessError) => {
      processError = error.message;
      finish({
        exitCode: error.exitCode ?? -1,
        stdout,
        stderr: `${stderr}\nProcess error: ${error.message}`.trim(),
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
        stdout,
        stderr: `${stderr}${timeoutSuffix}${errorSuffix}`.trim(),
        timedOut,
        signal: closeSignal
      });
    });

    child.on("disconnect", () => {
      if (!resolved) {
        stderr += "\nProcess disconnected unexpectedly.";
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
      } catch {
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
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
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch (error) { adapterWarn("process.kill SIGTERM fallback failed", { pid, error: error instanceof Error ? error.message : String(error) }); }
    }

    // Escalate to SIGKILL after 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try { process.kill(pid, "SIGKILL"); } catch (error) { adapterWarn("process.kill SIGKILL fallback failed", { pid, error: error instanceof Error ? error.message : String(error) }); }
    }
  }
}
