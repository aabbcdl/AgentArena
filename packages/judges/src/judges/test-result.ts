import type { JudgeResult, TestResultJudge } from "@agentarena/core";
import { executeCommand } from "../command-runner.js";
import {
  buildStepEnvironment,
  defaultJudgeTimeoutMs,
  type JudgeExecutionOptions,
  parseTestSummary,
  readJsonJudgePayload,
  resolveJudgeWorkingDirectory,
} from "../shared.js";

export async function runTestResultJudge(
  judge: TestResultJudge,
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult> {
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = await resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);
  const result = await executeCommand(judge.command, cwd, environment, timeoutMs, "Judge", options.signal);

  try {
    const payload = await readJsonJudgePayload(workspacePath, judge.reportFile, result.stdout, `Judge "${judge.id}" reportFile`);
    const summary = parseTestSummary(payload, judge.format ?? "auto");
    const passedWithNoTests = summary.totalCount === 0 && judge.passOnNoTests === true;
    const success = (result.exitCode === 0 || passedWithNoTests) && (summary.success || passedWithNoTests);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "test-result",
      command: judge.command,
      parser: summary.parser,
      target: judge.reportFile,
      expectation: judge.passOnNoTests ? "failed=0 or no tests" : "failed=0",
      exitCode: result.exitCode,
      success,
      stdout: `tests: ${summary.passedCount} passed, ${summary.failedCount} failed, ${summary.skippedCount} skipped, ${summary.totalCount} total`,
      stderr: result.stderr,
      durationMs: result.durationMs,
      cwd: result.cwd,
      passedCount: summary.passedCount,
      failedCount: summary.failedCount,
      skippedCount: summary.skippedCount,
      totalCount: summary.totalCount,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "test-result",
      command: judge.command,
      target: judge.reportFile,
      expectation: judge.passOnNoTests ? "failed=0 or no tests" : "failed=0",
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
