import type { CommandJudge, JudgeResult } from "@agentarena/core";
import { executeCommand } from "../command-runner.js";
import {
  buildStepEnvironment,
  defaultJudgeTimeoutMs,
  type JudgeExecutionOptions,
  resolveJudgeWorkingDirectory,
} from "../shared.js";

export async function runCommandJudge(
  judge: CommandJudge,
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult> {
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = await resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);

  const result = await executeCommand(judge.command, cwd, environment, timeoutMs, "Judge", options.signal);

  return {
    judgeId: judge.id,
    label: judge.label,
    type: "command",
    command: judge.command,
    exitCode: result.exitCode,
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    cwd: result.cwd,
    critical: judge.critical ?? false
  };
}
