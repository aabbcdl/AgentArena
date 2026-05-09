import type { JudgeResult, LintCheckJudge } from "@agentarena/core";
import { executeCommand } from "../command-runner.js";
import {
  buildStepEnvironment,
  defaultJudgeTimeoutMs,
  type JudgeExecutionOptions,
  parseLintSummary,
  readJsonJudgePayload,
  resolveJudgeWorkingDirectory,
} from "../shared.js";

export async function runLintCheckJudge(
  judge: LintCheckJudge,
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult> {
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = await resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);
  const result = await executeCommand(judge.command, cwd, environment, timeoutMs, "Judge", options.signal);
  const maxWarnings = judge.maxWarnings ?? 0;

  try {
    const payload = await readJsonJudgePayload(workspacePath, judge.reportFile, result.stdout, `Judge "${judge.id}" reportFile`);
    const summary = parseLintSummary(payload, judge.format ?? "auto");
    const success = result.exitCode === 0 && summary.errorCount === 0 && summary.warningCount <= maxWarnings;

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "lint-check",
      command: judge.command,
      parser: summary.parser,
      target: judge.reportFile,
      expectation: `errors=0, warnings<=${maxWarnings}`,
      exitCode: result.exitCode,
      success,
      stdout: `lint: ${summary.errorCount} errors, ${summary.warningCount} warnings`,
      stderr: result.stderr,
      durationMs: result.durationMs,
      cwd: result.cwd,
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      totalCount: summary.totalCount,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "lint-check",
      command: judge.command,
      target: judge.reportFile,
      expectation: `errors=0, warnings<=${maxWarnings}`,
      exitCode: result.exitCode,
      success: false,
      stdout: result.stdout,
      stderr: `${result.stderr}\n${error instanceof Error ? error.message : String(error)}`.trim(),
      durationMs: result.durationMs,
      cwd: result.cwd,
      critical: judge.critical ?? false
    };
  }
}
