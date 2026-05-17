import { spawn } from "node:child_process";
import {
  BenchmarkCancelledError,
  type CommandExecutionSpec,
  type CommandStepResult,
} from "@agentarena/core";
import {
  buildStepEnvironment,
  type CommandExecutionCapture,
  defaultJudgeTimeoutMs,
  MAX_PROCESS_OUTPUT_BYTES,
  resolveCommandWorkingDirectory,
  throwIfCancelled,
} from "./shared.js";

export function parseCommand(command: string): [string, string[]] {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command string is empty.");
  }

  const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /(?:^|\s)(?:curl|wget)\s+.*[|-].*(?:base64|xxd|hexdump)/i, reason: "Command appears to exfiltrate data via network with encoding" },
    { pattern: /(?:^|\s)(?:nc|ncat|netcat)\s+/i, reason: "Netcat is not allowed in judge commands" },
    { pattern: /(?:^|\s)(?:sh|bash|zsh|fish|dash|ksh|csh|tcsh)\s+(-c|-i)/i, reason: "Interactive or eval shell invocation is not allowed in judge commands" },
    { pattern: /(?:^|\s)(?:python|python3|perl|ruby)\s+(-c|-e)\s+/i, reason: "Eval-style interpreter invocation is not allowed in judge commands" },
    { pattern: /(?:^|\s)(?:chmod|chown|chgrp)\s+/i, reason: "Permission modification commands are not allowed in judge commands" },
    { pattern: /(?:^|\s)(?:sudo|su|doas|pkexec)\s+/i, reason: "Privilege escalation commands are not allowed in judge commands" },
    { pattern: /(?:^|\s)(?:rm|rmdir)\s+.*-rf\s+\//i, reason: "Recursive root deletion is not allowed in judge commands" },
    { pattern: /(?:^|\s)(?:mkfifo|mknod)\s+/i, reason: "FIFO/device creation is not allowed in judge commands" },
    { pattern: />\s*\/dev\//i, reason: "Direct writes to /dev are not allowed in judge commands" }
  ];

  const commandToken = trimmed.split(/\s+/)[0].replace(/^["']|["']$/g, "");
  const DANGEROUS_COMMANDS = new Set([
    "nc", "ncat", "netcat", "sudo", "su", "doas", "pkexec",
    "chmod", "chown", "chgrp", "mkfifo", "mknod"
  ]);
  if (DANGEROUS_COMMANDS.has(commandToken)) {
    throw new Error(
      `Command rejected for security: "${commandToken}" is not allowed in judge commands. ` +
      `Suggestion: If you need this functionality, use a script file instead (e.g., ./run-tests.sh).`
    );
  }

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      const commandPart = trimmed.split(/\s+/)[0];
      if (commandPart === "echo" || commandPart === "printf" || commandPart === "printenv" || commandPart === "type" || commandPart === "which" || commandPart === "where") {
        continue;
      }
      throw new Error(
        `${reason}. Suggestion: Use a script file (e.g., ./run-check.sh) instead of inline commands. ` +
        `Command: "${trimmed.slice(0, 100)}"`
      );
    }
  }

  if (commandToken === "node" && trimmed.includes(" -e ")) {
    const DANGEROUS_NODE_MODULES = [
      "child_process", "require('fs'", 'require("fs"',
      "require('net'", 'require("net"',
      "require('http'", 'require("http"',
      "require('https'", 'require("https"',
      "require('dgram'", 'require("dgram"',
      "require('cluster'", 'require("cluster"',
      "require('os'", 'require("os"',
      "process.binding"
    ];
    for (const pattern of DANGEROUS_NODE_MODULES) {
      if (trimmed.includes(pattern)) {
        throw new Error(
          `Command rejected for security: node -e with "${pattern}" is not allowed. ` +
          `Suggestion: Use a script file (e.g., ./run-check.js) instead of inline code with system module access. ` +
          `Command: "${trimmed.slice(0, 100)}"`
        );
      }
    }
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

  return [args[0], args.slice(1)];
}

export async function executeCommand(
  commandOrCmd: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  timeoutLabel: string,
  signal?: AbortSignal,
  args?: string[]
): Promise<CommandExecutionCapture> {
  const startedAt = Date.now();
  throwIfCancelled(signal);

  let cmd: string;
  let cmdArgs: string[];
  if (args !== undefined) {
    cmd = commandOrCmd;
    cmdArgs = args;
  } else {
    [cmd, cmdArgs] = parseCommand(commandOrCmd);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

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
            console.warn(`[agentarena] Failed to SIGKILL process ${child.pid}: ${killError instanceof Error ? killError.message : String(killError)}`);
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
        stdout += chunk.toString("utf8").slice(0, MAX_PROCESS_OUTPUT_BYTES - (stdoutBytes - chunk.length));
        stdout += `\n[stdout truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`;
        stdoutTruncated = true;
      } else {
        stdout += chunk.toString("utf8");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_PROCESS_OUTPUT_BYTES) {
        stderr += chunk.toString("utf8").slice(0, MAX_PROCESS_OUTPUT_BYTES - (stderrBytes - chunk.length));
        stderr += `\n[stderr truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes]`;
        stderrTruncated = true;
      } else {
        stderr += chunk.toString("utf8");
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
        stdout: stdout.trim(),
        stderr: `${stderr}${timedOut ? `\n${timeoutLabel} timed out after ${timeoutMs}ms.` : ""}`.trim(),
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
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
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
  signal?: AbortSignal
): Promise<CommandStepResult> {
  const timeoutMs = step.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = await resolveCommandWorkingDirectory(workspacePath, step);
  const environment = buildStepEnvironment(baseAllowedNames, step);
  const result = await executeCommand(step.command, cwd, environment, timeoutMs, "Command step", signal);

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
  signal?: AbortSignal
): Promise<CommandStepResult[]> {
  const results: CommandStepResult[] = [];

  for (const step of steps) {
    throwIfCancelled(signal);
    results.push(await runCommandStep(step, workspacePath, baseAllowedNames, signal));
  }

  return results;
}
