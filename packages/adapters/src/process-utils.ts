import { execFile, execFileSync, spawn } from "node:child_process";
import { access, constants as fsConstants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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
  timeoutKind?: "total" | "idle";
  signal?: NodeJS.Signals;
  error?: string;
}

interface ProcessError extends Error {
  code?: string;
  signal?: NodeJS.Signals;
  exitCode?: number | null;
}

interface ProcessSpawnSpec {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

function normalizedIdleTimeoutMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : undefined;
}

function isWindowsClaudeInvocation(command: string, args: string[]): boolean {
  if (process.platform !== "win32") return false;
  const commandName = path.basename(command).toLowerCase();
  if (commandName !== "claude.cmd" && commandName !== "claude.exe" && commandName !== "claude") {
    return false;
  }
  return args.includes("-p") || args.includes("--print");
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
 * Default transport timeout: 10 minutes.
 *
 * Real coding agents can spend several minutes reading, editing, and verifying
 * even tiny tasks on cold starts. Keep this below the per-agent timeout, but
 * long enough that successful work is not mislabeled as a transport failure.
 * Overridable via AGENTARENA_TRANSPORT_TIMEOUT_MS env var.
 */
const DEFAULT_TRANSPORT_TIMEOUT_MS = 10 * 60_000;

export function transportTimeoutMs(): number {
  return resolveTimeoutMs(process.env.AGENTARENA_TRANSPORT_TIMEOUT_MS, DEFAULT_TRANSPORT_TIMEOUT_MS);
}

export function formatTimeoutMessage(timeoutMs: number): string {
  return `Process timed out after ${timeoutMs}ms.`;
}

export function safeNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Cached Windows console code page (e.g., "936" for GBK on Chinese Windows).
 * Retrieved lazily via `chcp` command. Undefined on non-Windows platforms.
 */
let cachedWindowsCodePage: string | undefined | null = null;

/**
 * Get the active Windows console code page (e.g., "936" for GBK, "437" for US).
 * Returns undefined on non-Windows or if the `chcp` command fails.
 */
function getWindowsCodePage(): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (cachedWindowsCodePage === null) {
    try {
      const output = execFileSync("chcp", [], { encoding: "utf8", windowsHide: true, timeout: 3000 });
      const match = output.match(/(\d+)/);
      cachedWindowsCodePage = match ? match[1] : undefined;
    } catch {
      cachedWindowsCodePage = undefined;
    }
  }
  return cachedWindowsCodePage ?? undefined;
}

/**
 * Map Windows code page numbers to Node.js TextDecoder-compatible labels.
 * Only includes the most common East Asian code pages that cause garbled output.
 */
function codePageToLabel(cp: string): string | undefined {
  const map: Record<string, string> = {
    "936": "gbk",      // Simplified Chinese
    "950": "big5",     // Traditional Chinese
    "932": "shift-jis", // Japanese
    "949": "euc-kr",   // Korean
    "1252": "windows-1252", // Western European
    "1250": "windows-1250", // Central European
    "1251": "windows-1251", // Cyrillic
  };
  return map[cp];
}

/**
 * Decode a process output buffer to string.
 *
 * On Windows, subprocess output may be in the system's ANSI code page
 * (e.g., GBK on Chinese Windows) rather than UTF-8. We try UTF-8 first;
 * if the result contains U+FFFD replacement characters (indicating invalid
 * UTF-8 sequences), we retry with the system's console code page.
 */
function decodeProcessOutput(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (process.platform !== "win32") return utf8;

  // Check for replacement characters that indicate UTF-8 decode failures
  if (!utf8.includes("\uFFFD")) return utf8;

  // Try the system's console code page as a fallback
  const cp = getWindowsCodePage();
  if (!cp) return utf8;

  const label = codePageToLabel(cp);
  if (!label) return utf8;

  try {
    const decoder = new TextDecoder(label, { fatal: false });
    const decoded = decoder.decode(buffer);
    // Only use the fallback if it doesn't contain replacement characters
    if (!decoded.includes("\uFFFD")) return decoded;
  } catch {
    // TextDecoder does not support this label; fall through.
  }

  return utf8;
}

const WINDOWS_BATCH_COMMAND = /\.(?:cmd|bat)$/i;

function quoteWindowsCmdArgument(value: string): string {
  // Percent expansion happens even inside cmd.exe quotes, and quotes/newlines
  // can break the generated command line. Other characters are passed inside
  // double quotes as literal argument text.
  if (/[%;"\r\n]/.test(value)) {
    throw new Error(
      "Unsupported Windows cmd.exe argument: values passed through .cmd/.bat shims cannot contain %, ;, double quotes, or newlines."
    );
  }
  return `"${value.replace(/\\+$/u, (slashes) => `${slashes}${slashes}`)}"`;
}

function resolveProcessSpawnSpec(command: string, args: string[]): ProcessSpawnSpec {
  if (process.platform === "win32" && WINDOWS_BATCH_COMMAND.test(command)) {
    const commandLine = `"${[command, ...args].map(quoteWindowsCmdArgument).join(" ")}"`;
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/v:off", "/c", commandLine],
      windowsVerbatimArguments: true,
    };
  }

  return { command, args };
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPowerShellArray(values: string[]): string {
  if (values.length === 0) return "@()";
  return `@(${values.map(quotePowerShellSingle).join(", ")})`;
}

function uniqueLines(lines: string[]): string[] {
  return Array.from(new Set(lines.filter(Boolean)));
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function runWindowsClaudeDetached(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  environment?: NodeJS.ProcessEnv,
  stdinInput?: string,
  signal?: AbortSignal,
  callbacks?: RunProcessCallbacks
): Promise<ProcessResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-claude-run-"));
  const scriptPath = path.join(tempDir, "run.ps1");
  const stdoutPath = path.join(tempDir, "stdout.txt");
  const stderrPath = path.join(tempDir, "stderr.txt");
  const stdinPath = path.join(tempDir, "stdin.txt");
  const exitPath = path.join(tempDir, "exit.txt");

  try {
    const idleTimeoutMs = normalizedIdleTimeoutMs(callbacks?.idleTimeoutMs);
    const pollIntervalMs = idleTimeoutMs
      ? Math.max(25, Math.min(250, Math.floor(idleTimeoutMs / 4)))
      : 250;
    if (stdinInput !== undefined) {
      await writeFile(stdinPath, stdinInput, "utf8");
    } else {
      await writeFile(stdinPath, "", "utf8");
    }

    const redirectInput = stdinInput !== undefined ? ` -RedirectStandardInput ${quotePowerShellSingle(stdinPath)}` : "";
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$timeoutMs = ${Math.max(1, Math.floor(timeoutMs))}`,
      `$idleTimeoutMs = ${idleTimeoutMs ?? 0}`,
      `$pollIntervalMs = ${pollIntervalMs}`,
      "function Stop-ProcessTree([int]$ProcessId) {",
      "  try {",
      "    Get-CimInstance Win32_Process -Filter \"ParentProcessId = $ProcessId\" | ForEach-Object { Stop-ProcessTree ([int]$_.ProcessId) }",
      "  } catch {}",
      "  try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}",
      "}",
      `$p = Start-Process -FilePath ${quotePowerShellSingle(command)} -ArgumentList ${buildPowerShellArray(args)} -WorkingDirectory ${quotePowerShellSingle(cwd)} -WindowStyle Hidden${redirectInput} -RedirectStandardOutput ${quotePowerShellSingle(stdoutPath)} -RedirectStandardError ${quotePowerShellSingle(stderrPath)} -PassThru`,
      "$startedAt = [DateTime]::UtcNow",
      "$lastActivityAt = $startedAt",
      "$lastStdoutLength = 0L",
      "$lastStderrLength = 0L",
      "$timeoutKind = $null",
      "while (-not $p.HasExited) {",
      "  Start-Sleep -Milliseconds $pollIntervalMs",
      `  $stdoutLength = if (Test-Path -LiteralPath ${quotePowerShellSingle(stdoutPath)}) { (Get-Item -LiteralPath ${quotePowerShellSingle(stdoutPath)}).Length } else { 0L }`,
      `  $stderrLength = if (Test-Path -LiteralPath ${quotePowerShellSingle(stderrPath)}) { (Get-Item -LiteralPath ${quotePowerShellSingle(stderrPath)}).Length } else { 0L }`,
      "  if ($stdoutLength -ne $lastStdoutLength -or $stderrLength -ne $lastStderrLength) {",
      "    $lastStdoutLength = $stdoutLength",
      "    $lastStderrLength = $stderrLength",
      "    $lastActivityAt = [DateTime]::UtcNow",
      "  }",
      "  $now = [DateTime]::UtcNow",
      "  if (($now - $startedAt).TotalMilliseconds -ge $timeoutMs) { $timeoutKind = 'TIMEOUT'; break }",
      "  if ($idleTimeoutMs -gt 0 -and ($now - $lastActivityAt).TotalMilliseconds -ge $idleTimeoutMs) { $timeoutKind = 'IDLE_TIMEOUT'; break }",
      "}",
      "if ($timeoutKind) {",
      "  Stop-ProcessTree ([int]$p.Id)",
      `  $timeoutKind | Set-Content -Encoding UTF8 ${quotePowerShellSingle(exitPath)}`,
      "  exit 124",
      "}",
      "$p.WaitForExit()",
      `$p.ExitCode | Set-Content -Encoding UTF8 ${quotePowerShellSingle(exitPath)}`,
      "exit $p.ExitCode"
    ].filter(Boolean).join("\n");

    await writeFile(scriptPath, script, "utf8");

    const wrapperResult = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      cwd,
      timeoutMs + 30_000,
      environment ?? process.env,
      signal
    );

    const [stdoutBuf, stderrBuf, exitText] = await Promise.all([
      readFile(stdoutPath).catch(() => Buffer.alloc(0)),
      readFile(stderrPath).catch(() => Buffer.alloc(0)),
      readFile(exitPath, "utf8").catch(() => "")
    ]);
    const stdout = decodeProcessOutput(stdoutBuf);
    const stderr = decodeProcessOutput(stderrBuf);
    if (stdout && callbacks?.onStdout) {
      try { callbacks.onStdout(stdout); } catch { /* ignore callback errors */ }
    }
    if (stderr && callbacks?.onStderr) {
      try { callbacks.onStderr(stderr); } catch { /* ignore callback errors */ }
    }
    const wrapperExit = exitText.trim();
    const timeoutKind = wrapperExit === "IDLE_TIMEOUT"
      ? "idle" as const
      : wrapperResult.timedOut || wrapperExit === "TIMEOUT" || wrapperResult.exitCode === 124
        ? "total" as const
        : undefined;
    const timedOut = timeoutKind !== undefined;
    const exitCode = Number.parseInt(exitText.trim(), 10);

    return {
      exitCode: Number.isInteger(exitCode) ? exitCode : wrapperResult.exitCode,
      stdout,
      stderr: uniqueLines([
        stderr.trim(),
        wrapperResult.stderr.trim(),
        timeoutKind === "idle" && idleTimeoutMs
          ? `Process produced no output for ${idleTimeoutMs}ms.`
          : timeoutKind === "total"
            ? formatTimeoutMessage(timeoutMs)
            : ""
      ]).join("\n"),
      timedOut,
      timeoutKind,
      signal: wrapperResult.signal,
      error: wrapperResult.error
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
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
        // Not found or not executable; continue searching.
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
 *   - `exitCode: null` + `error: "<message>"` -> spawn failed
 *   - `timedOut: true` -> process exceeded timeoutMs
 *   - `signal: "SIGTERM"` + `error: "cancelled"` -> AbortSignal fired
 *
 * Callers should check `result.exitCode === 0 && !result.error` to
 * determine success. A try/catch around the `await runProcess(...)` call
 * is unnecessary but harmless; it will never trigger.
 */
export interface RunProcessCallbacks {
  /** Called as stdout data arrives (pre-decode, per-chunk). */
  onStdout?: (chunk: string) => void;
  /** Called as stderr data arrives (pre-decode, per-chunk). */
  onStderr?: (chunk: string) => void;
  /** Optional inactivity deadline. Any stdout or stderr bytes reset it. */
  idleTimeoutMs?: number;
}

export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = agentTimeoutMs(),
  environment?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  stdinInput?: string,
  callbacks?: RunProcessCallbacks
): Promise<ProcessResult> {
  if (stdinInput !== undefined && isWindowsClaudeInvocation(command, args)) {
    return await runWindowsClaudeDetached(command, args, cwd, timeoutMs, environment, stdinInput, signal, callbacks);
  }

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
    let timeoutKind: ProcessResult["timeoutKind"];
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
    let idleTimeoutHandle: NodeJS.Timeout | undefined;
    let sigkillHandle: NodeJS.Timeout | undefined;

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const truncateMarker = (label: "stdout" | "stderr") =>
      Buffer.from(`\n[${label} truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`);

    const buildStdout = (): string => decodeProcessOutput(Buffer.concat(stdoutChunks));
    const buildStderr = (): string => decodeProcessOutput(Buffer.concat(stderrChunks));

    const finish = (result: ProcessResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
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
            execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, (err) => {
              if (err) {
                if (!processExists(pid)) return;
                adapterWarn("taskkill failed, falling back to child.kill", { pid, error: err instanceof Error ? err.message : String(err) });
                if (child && !child.killed) child.kill("SIGTERM");
              }
            });
          }
        } catch (e) {
          adapterWarn("all process kill attempts failed - possible orphan", { pid, error: e instanceof Error ? e.message : String(e) });
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

    const triggerTimeout = (kind: NonNullable<ProcessResult["timeoutKind"]>) => {
      if (timedOut || resolved) return;
      timedOut = true;
      timeoutKind = kind;
      if (kind === "idle" && timeoutHandle) clearTimeout(timeoutHandle);
      if (kind === "total" && idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
      cleanup();
    };

    const idleTimeoutMs = normalizedIdleTimeoutMs(callbacks?.idleTimeoutMs);
    const resetIdleTimeout = () => {
      if (!idleTimeoutMs || timedOut || resolved) return;
      if (idleTimeoutHandle) clearTimeout(idleTimeoutHandle);
      idleTimeoutHandle = setTimeout(() => triggerTimeout("idle"), idleTimeoutMs);
    };

    try {
      const spawnSpec = resolveProcessSpawnSpec(command, args);
      child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd,
        env: environment,
        stdio: [stdinInput !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments ?? false,
        ...(process.platform !== "win32" ? { detached: true } : {})
      });

      // Feed stdin input (e.g. prompt text) then close the stream. Keeping
      // prompts out of argv avoids quoting and command-line length issues.
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

    timeoutHandle = setTimeout(() => triggerTimeout("total"), timeoutMs);
    resetIdleTimeout();

    child.stdout?.on("data", (chunk: Buffer) => {
      resetIdleTimeout();
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
      // Fire streaming callback for real-time activity capture
      if (callbacks?.onStdout) {
        try { callbacks.onStdout(decodeProcessOutput(chunk)); } catch { /* ignore callback errors */ }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      resetIdleTimeout();
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
      // Fire streaming callback for real-time activity capture
      if (callbacks?.onStderr) {
        try { callbacks.onStderr(decodeProcessOutput(chunk)); } catch { /* ignore callback errors */ }
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
      const timeoutSuffix = timeoutKind === "idle" && idleTimeoutMs
        ? `\nProcess produced no output for ${idleTimeoutMs}ms.`
        : timeoutKind === "total"
          ? `\n${formatTimeoutMessage(timeoutMs)}`
          : "";
      const errorSuffix = processError ? `\nProcess error: ${processError}` : "";
      finish({
        exitCode,
        stdout: buildStdout(),
        stderr: `${buildStderr()}${timeoutSuffix}${errorSuffix}`.trim(),
        timedOut,
        timeoutKind,
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
