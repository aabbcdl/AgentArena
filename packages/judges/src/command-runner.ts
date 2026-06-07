import { spawn } from "node:child_process";
import {
  BenchmarkCancelledError,
  type CommandExecutionSpec,
  type CommandStepResult,
  logger,
} from "@agentarena/core";
import {
  buildStepEnvironment,
  type CommandExecutionCapture,
  defaultJudgeTimeoutMs,
  MAX_PROCESS_OUTPUT_BYTES,
  resolveCommandWorkingDirectory,
  throwIfCancelled,
} from "./shared.js";

/**
 * Allowlist: only known-safe commands may be executed in judge steps.
 *
 * DESIGN PRINCIPLES (evolved from incident response, not formal threat modeling):
 *
 * 1. Blocklist → Allowlist migration: The previous blocklist was bypassable via
 *    absolute paths, whitespace variants, and alias expansion. The allowlist
 *    approach is fundamentally more secure but requires explicit enumeration.
 *
 * 2. "Read-only or text-processing" principle: Commands are included if they
 *    primarily read/inspect rather than modify. However, this is ASPIRATIONAL,
 *    not enforced:
 *    - curl can POST, upload files, write to disk with -o
 *    - sed can modify files with -i flag
 *    - awk can write files with > redirection
 *    The allowlist trusts that task pack authors are not malicious.
 *
 * 3. Shell exclusion: sh/bash are intentionally EXCLUDED because they can
 *    execute arbitrary code from script files, bypassing the allowlist entirely.
 *    Task packs needing shell scripts must use `node script.js` or `python script.py`.
 *
 * 4. Interpreter escape hatch: node -e, python -c, bun -e are blocked by a
 *    separate regex check (not the allowlist) because they can execute arbitrary
 *    code. The AGENTARENA_ALLOW_EVAL_IN_JUDGES=1 env var disables this for
 *    test harnesses that legitimately use inline code in fixture task packs.
 *
 * 5. Adding a new command: Consider whether the command can execute arbitrary
 *    code, write files, or make network requests. If it can, document the risk
 *    in this comment and explain why the risk is acceptable.
 *
 * THREAT MODEL: Task packs from the community/task-pack-market are the primary
 * attack surface. The allowlist prevents malicious task packs from executing
 * arbitrary commands. However, any command that can read files or make network
 * requests can still exfiltrate data — the allowlist does not provide data
 * isolation, only command execution control.
 */
const SAFE_COMMANDS = new Set([
  // Package managers
  "node", "npm", "npx", "pnpm", "pnpx", "yarn", "bun",
  // Languages
  "python", "python3", "go", "cargo", "rustc", "ruby", "bundle", "rake",
  // Build tools
  "make", "cmake", "gradle", "mvn", "sbt",
  // Version control
  "git",
  // Shell utilities (safe for read-only inspection)
  "grep", "rg", "find", "fd", "ls", "cat", "echo", "printf", "printenv",
  "test", "diff", "wc", "head", "tail", "sort", "uniq", "tr", "cut",
  "sed", "awk", "tee", "env", "type", "which", "where", "date",
  // Data processing
  "jq", "yq",
  // Network (read-only)
  "curl", "wget",
  // Archive
  "tar", "gzip", "gunzip", "unzip", "zip",
  // Python ecosystem
  "pip", "pip3", "poetry", "uv", "pytest", "unittest", "flake8", "ruff",
  "mypy", "pylint", "black", "isort",
  // JS ecosystem
  "eslint", "biome", "prettier", "tsc", "vitest", "jest", "mocha",
  "playwright", "ava", "tap",
  // Go ecosystem
  "gofmt", "golint", "staticcheck", "golangci-lint",
  // Rust ecosystem
  "clippy", "rustfmt",
  // Ruby ecosystem
  "rubocop", "rspec",
  // NOTE: sh/bash are intentionally excluded from the allowlist.
  // They can execute arbitrary code from script files, bypassing the allowlist.
  // Task packs that need shell scripts must use a specific interpreter (e.g., node, python).
]);

const RISKY_COMMANDS = new Set(["curl", "wget", "sed", "awk", "tee"]);
const COMMANDS_USING_E_FLAG = new Set(["echo", "printf", "type", "which", "where"]);

export interface CommandSecurityOptions {
  allowEval?: boolean;
  allowRiskyCommands?: boolean;
}

/**
 * Tokenize a shell-style command into [command, args]. Handles single/double quotes
 * and backslash escapes. Returns the raw argv without any allowlist validation.
 */
function tokenizeCommand(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command string is empty.");
  }

  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && (inDoubleQuote || (!inSingleQuote && !inDoubleQuote))) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (ch === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escaped) {
    args.push(current || "\\");
  } else if (current.length > 0) {
    args.push(current);
  }

  if (args.length === 0) {
    throw new Error(`Invalid command string: "${command}"`);
  }

  return args;
}

/**
 * Reduce an absolute or relative command path to its basename for allowlist lookup.
 * Strips trailing `.exe`/`.cmd`/`.bat` so Windows paths like `node.exe` match `node`.
 */
function commandBasenameForAllowlist(commandToken: string): string {
  const basename = commandToken.includes("/") || commandToken.includes("\\")
    ? commandToken.split(/[/\\]/).pop() ?? commandToken
    : commandToken;
  // Strip Windows executable suffixes so `node.exe`, `python.cmd`, `git.bat` are matched
  return basename.replace(/\.(exe|cmd|bat)$/i, "");
}

function resolveCommandSecurityOptions(options?: CommandSecurityOptions): Required<CommandSecurityOptions> {
  return {
    allowEval: options?.allowEval ?? process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES === "1",
    allowRiskyCommands: options?.allowRiskyCommands ?? process.env.AGENTARENA_ALLOW_RISKY_COMMANDS_IN_JUDGES === "1"
  };
}

function validateParsedCommand(
  commandToken: string,
  commandArgs: string[],
  commandForMessage: string,
  options?: CommandSecurityOptions
): void {
  const commandBasename = commandBasenameForAllowlist(commandToken);
  if (!SAFE_COMMANDS.has(commandBasename)) {
    throw new Error(
      `Command "${commandBasename}" is not in the allowed command list. ` +
      `Allowed commands include: node, npm, npx, pnpm, python, go, cargo, git, etc. ` +
      `Suggestion: Use a script file (e.g., ./run-check.sh) instead. ` +
      `Command: "${commandForMessage.slice(0, 100)}"`
    );
  }

  const security = resolveCommandSecurityOptions(options);
  if (!security.allowRiskyCommands && RISKY_COMMANDS.has(commandBasename)) {
    throw new Error(
      `Command "${commandBasename}" is disabled by the strict task-pack security policy because it can write files, modify streams, or access the network. ` +
      `Use a safer command or run this task pack as trusted content. ` +
      `Command: "${commandForMessage.slice(0, 100)}"`
    );
  }

  if (!security.allowEval && (/\s-(?:e|c)\s/.test(commandForMessage) || /\s--eval[\s=]/.test(commandForMessage) || commandArgs.some(a => a === "--eval" || a.startsWith("--eval=") || a === "-e" || a === "-c"))) {
    if (!COMMANDS_USING_E_FLAG.has(commandBasename)) {
      throw new Error(
        `Eval-style invocation (-e/-c/--eval) is not allowed for "${commandBasename}" in setup/judge commands. ` +
        `The task pack uses "node -e" which is blocked by the security policy. ` +
        `Fix: Replace the inline code with a script file (e.g., create install-deps.js and run "node install-deps.js"). ` +
        `Command: "${commandForMessage.slice(0, 100)}"`
      );
    }
  }
}

export function parseCommand(command: string, options?: CommandSecurityOptions): [string, string[]] {
  const trimmed = command.trim();
  const args = tokenizeCommand(command);
  const commandToken = args[0];
  const commandBasename = commandBasenameForAllowlist(commandToken);

  if (!SAFE_COMMANDS.has(commandBasename)) {
    throw new Error(
      `Command "${commandBasename}" is not in the allowed command list. ` +
      `Allowed commands include: node, npm, npx, pnpm, python, go, cargo, git, etc. ` +
      `Suggestion: Use a script file (e.g., ./run-check.sh) instead. ` +
      `Command: "${trimmed.slice(0, 100)}"`
    );
  }

  const security = resolveCommandSecurityOptions(options);
  if (!security.allowRiskyCommands && RISKY_COMMANDS.has(commandBasename)) {
    throw new Error(
      `Command "${commandBasename}" is disabled by the strict task-pack security policy because it can write files, modify streams, or access the network. ` +
      `Use a safer command or run this task pack as trusted content. ` +
      `Command: "${trimmed.slice(0, 100)}"`
    );
  }

  // Block eval-style invocations that could bypass the allowlist
  // by running arbitrary code inside an allowed interpreter.
  // Detects: node -e, node --eval, python -c, ruby -e, perl -e, etc.
  //
  // Task pack commands (setup + judge) are trusted content defined by the
  // user, not by the agent. Allow eval for them. External / untrusted
  // callers can still block via the options flag.
  const allowEval = security.allowEval;
  if (!allowEval && (/\s-(?:e|c)\s/.test(trimmed) || /\s--eval[\s=]/.test(trimmed) || args.some(a => a === "--eval" || a.startsWith("--eval=") || a === "-e" || a === "-c"))) {
    // Allow echo/printf/type/which/where — they use -e for their own flags
    if (!COMMANDS_USING_E_FLAG.has(commandBasename)) {
      throw new Error(
        `Eval-style invocation (-e/-c/--eval) is not allowed for "${commandBasename}" in setup/judge commands. ` +
        `The task pack uses "node -e" which is blocked by the security policy. ` +
        `Fix: Replace the inline code with a script file (e.g., create install-deps.js and run "node install-deps.js"). ` +
        `Command: "${trimmed.slice(0, 100)}"`
      );
    }
  }

  return [commandToken, args.slice(1)];
}

export async function executeCommand(
  commandOrCmd: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  timeoutLabel: string,
  signal?: AbortSignal,
  args?: string[],
  options?: CommandSecurityOptions
): Promise<CommandExecutionCapture> {
  const startedAt = Date.now();
  throwIfCancelled(signal);

  let cmd: string;
  let cmdArgs: string[];
  if (args !== undefined) {
    cmd = commandOrCmd;
    cmdArgs = args;
    validateParsedCommand(cmd, cmdArgs, [cmd, ...cmdArgs].join(" "), options);
  } else {
    [cmd, cmdArgs] = parseCommand(commandOrCmd, options);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const truncateMarker = (label: "stdout" | "stderr") =>
      Buffer.from(`\n[${label} truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`);
    const buildStdout = (): string => Buffer.concat(stdoutChunks).toString("utf8");
    const buildStderr = (): string => Buffer.concat(stderrChunks).toString("utf8");

    const settle = () => {
      if (settled) return false;
      settled = true;
      return true;
    };

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      signal?.removeEventListener("abort", cancelExecution);
    };

    let killHandle: ReturnType<typeof setTimeout> | undefined;

    const scheduleForceKill = () => {
      if (killHandle) return; // prevent duplicate timers
      killHandle = setTimeout(() => {
        if (!child.killed && child.pid) {
          try {
            if (process.platform !== "win32") {
              process.kill(-child.pid, "SIGKILL");
            } else {
              child.kill("SIGKILL");
            }
          } catch (killError) {
            logger.warn("judge", "process.sigkill_failed", `Failed to SIGKILL process ${child.pid}: ${killError instanceof Error ? killError.message : String(killError)}`, {
              metadata: { pid: child.pid }
            });
          }
        }
      }, 3_000);
    };

    const cancelExecution = () => {
      cancelled = true;
      if (!child.killed) {
        child.kill();
        scheduleForceKill();
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (!child.killed) {
        child.kill();
        scheduleForceKill();
      }
    }, timeoutMs);

    signal?.addEventListener("abort", cancelExecution, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
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

    child.stderr.on("data", (chunk: Buffer) => {
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

    child.on("close", (exitCode) => {
      cleanup();
      if (!settle()) return;
      if (cancelled) {
        reject(new BenchmarkCancelledError());
        return;
      }
      resolve({
        exitCode,
        stdout: buildStdout().trim(),
        stderr: `${buildStderr()}${timedOut ? `\n${timeoutLabel} timed out after ${timeoutMs}ms.` : ""}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });

    child.on("error", (error) => {
      cleanup();
      if (!settle()) return;
      if (cancelled) {
        reject(new BenchmarkCancelledError());
        return;
      }
      resolve({
        exitCode: -1,
        stdout: buildStdout(),
        stderr: `${buildStderr()}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });
  });
}

export async function runCommandStep(
  step: CommandExecutionSpec,
  workspacePath: string,
  baseAllowedNames: string[],
  signal?: AbortSignal,
  options?: CommandSecurityOptions
): Promise<CommandStepResult> {
  const timeoutMs = step.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = await resolveCommandWorkingDirectory(workspacePath, step);
  const environment = buildStepEnvironment(baseAllowedNames, step);
  const result = await executeCommand(step.command, cwd, environment, timeoutMs, "Command step", signal, undefined, options);

  return {
    stepId: step.id,
    label: step.label,
    command: step.command,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    cwd: result.cwd
  };
}

export async function runCommandSteps(
  steps: CommandExecutionSpec[],
  workspacePath: string,
  baseAllowedNames: string[],
  signal?: AbortSignal,
  options?: CommandSecurityOptions
): Promise<CommandStepResult[]> {
  const results: CommandStepResult[] = [];

  for (const step of steps) {
    throwIfCancelled(signal);
    results.push(await runCommandStep(step, workspacePath, baseAllowedNames, signal, options));
  }

  return results;
}
