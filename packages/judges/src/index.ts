import { spawn } from "node:child_process";
import path from "node:path";
import { CommandExecutionSpec, CommandStepResult, CommandJudge, JudgeResult } from "@repoarena/core";

const DEFAULT_JUDGE_TIMEOUT_MS = 5 * 60 * 1_000;

function resolveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function defaultJudgeTimeoutMs(): number {
  return resolveTimeoutMs(process.env.REPOARENA_JUDGE_TIMEOUT_MS, DEFAULT_JUDGE_TIMEOUT_MS);
}

function resolveJudgeWorkingDirectory(workspacePath: string, judge: CommandJudge): string {
  const candidatePath = judge.cwd ? path.resolve(workspacePath, judge.cwd) : workspacePath;
  const relativePath = path.relative(workspacePath, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Judge "${judge.id}" cwd must stay inside the workspace.`);
  }

  return candidatePath;
}

function resolveCommandWorkingDirectory(workspacePath: string, step: CommandExecutionSpec): string {
  const candidatePath = step.cwd ? path.resolve(workspacePath, step.cwd) : workspacePath;
  const relativePath = path.relative(workspacePath, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Command step "${step.id}" cwd must stay inside the workspace.`);
  }

  return candidatePath;
}

export async function runJudge(
  judge: CommandJudge,
  workspacePath: string,
  environment: NodeJS.ProcessEnv
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveJudgeWorkingDirectory(workspacePath, judge);

  return await new Promise((resolve) => {
    const child = spawn(judge.command, {
      cwd,
      env: environment,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolve({
        judgeId: judge.id,
        label: judge.label,
        type: "command",
        command: judge.command,
        exitCode,
        success: exitCode === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: `${stderr}${timedOut ? `\nJudge timed out after ${timeoutMs}ms.` : ""}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        judgeId: judge.id,
        label: judge.label,
        type: "command",
        command: judge.command,
        exitCode: -1,
        success: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });
  });
}

export async function runJudges(
  judges: CommandJudge[],
  workspacePath: string,
  environment: NodeJS.ProcessEnv
): Promise<JudgeResult[]> {
  return await Promise.all(judges.map(async (judge) => await runJudge(judge, workspacePath, environment)));
}

export async function runCommandStep(
  step: CommandExecutionSpec,
  workspacePath: string,
  environment: NodeJS.ProcessEnv
): Promise<CommandStepResult> {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveCommandWorkingDirectory(workspacePath, step);

  return await new Promise((resolve) => {
    const child = spawn(step.command, {
      cwd,
      env: environment,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolve({
        stepId: step.id,
        label: step.label,
        command: step.command,
        exitCode,
        success: exitCode === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: `${stderr}${timedOut ? `\nCommand step timed out after ${timeoutMs}ms.` : ""}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        stepId: step.id,
        label: step.label,
        command: step.command,
        exitCode: -1,
        success: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });
  });
}

export async function runCommandSteps(
  steps: CommandExecutionSpec[],
  workspacePath: string,
  environment: NodeJS.ProcessEnv
): Promise<CommandStepResult[]> {
  return await Promise.all(
    steps.map(async (step) => await runCommandStep(step, workspacePath, environment))
  );
}
