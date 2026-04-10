import { execSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BenchmarkCancelledError, resolveTimeoutMs } from "@agentarena/core";

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

/** Maximum bytes to accumulate from stdout/stderr before truncating (50 MB). */
export const MAX_PROCESS_OUTPUT_BYTES = 50 * 1024 * 1024;

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

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
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

    const cleanup = () => {
      if (child && !child.killed && child.pid) {
        const pid = child.pid;
        try {
          if (process.platform !== "win32") {
            // Kill the entire process group on Unix
            try {
              process.kill(-pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
            setTimeout(() => {
              try {
                process.kill(-pid, "SIGKILL");
              } catch {
                if (child && !child.killed) child.kill("SIGKILL");
              }
            }, 2000);
          } else {
            // Use taskkill to kill the process tree on Windows
            try {
              execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
            } catch {
              child.kill("SIGTERM");
            }
          }
        } catch {
          // Ignore kill errors
        }
      }
    };

    const finish = (result: ProcessResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
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

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      cleanup();
      // Wait a bit for the process to actually terminate
      setTimeout(() => {
        finish({
          exitCode: null,
          stdout,
          stderr: `${stderr}\n${formatTimeoutMessage(timeoutMs)}`.trim(),
          timedOut: true,
          signal: "SIGTERM"
        });
      }, 1000);
    }, timeoutMs);

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
      clearTimeout(timeoutHandle);
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

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PROCESS_OUTPUT_BYTES) {
        stdout += chunk.toString().slice(0, MAX_PROCESS_OUTPUT_BYTES - (stdoutBytes - chunk.length));
        stdout += `\n[stdout truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`;
        stdoutTruncated = true;
      } else {
        stdout += chunk.toString();
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_PROCESS_OUTPUT_BYTES) {
        stderr += chunk.toString().slice(0, MAX_PROCESS_OUTPUT_BYTES - (stderrBytes - chunk.length));
        stderr += `\n[stderr truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`;
        stderrTruncated = true;
      } else {
        stderr += chunk.toString();
      }
    });

    child.on("error", (error: ProcessError) => {
      clearTimeout(timeoutHandle);
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
      clearTimeout(timeoutHandle);
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

    // Handle process not responding
    child.on("disconnect", () => {
      if (!resolved) {
        stderr += "\nProcess disconnected unexpectedly.";
      }
    });
  });
}
