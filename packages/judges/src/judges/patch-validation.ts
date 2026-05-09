import type { JudgeResult, PatchValidationJudge } from "@agentarena/core";
import { executeCommand } from "../command-runner.js";
import {
  buildStepEnvironment,
  checkRequiredTests,
  defaultJudgeTimeoutMs,
  extractTestDetails,
  type JudgeExecutionOptions,
  parseJsonPayload,
  parseTestSummary,
  resolveJudgeWorkingDirectory,
} from "../shared.js";

export async function runPatchValidationJudge(
  judge: PatchValidationJudge,
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult> {
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = await resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);

  const result = await executeCommand(judge.testSuite, cwd, environment, timeoutMs, "Patch Validation Judge", options.signal);

  try {
    const payload = parseJsonPayload(result.stdout);
    const summary = parseTestSummary(payload, "auto");

    const failToPassRequired = judge.failToPassTests ?? [];
    const passToPassRequired = judge.passToPassTests ?? [];

    const hasSpecificTests = failToPassRequired.length > 0 || passToPassRequired.length > 0;

    let success: boolean;
    let stdoutMessage: string;
    let stderrMessage: string;

    if (hasSpecificTests) {
      const testDetails = extractTestDetails(payload, summary.parser);

      const failToPassResults = checkRequiredTests(testDetails, failToPassRequired);
      const allFailToPassPassed = failToPassResults.every(r => r.status === "pass");

      const passToPassResults = checkRequiredTests(testDetails, passToPassRequired);
      const allPassToPassPassed = passToPassResults.every(r => r.status === "pass");

      const noUnexpectedFailures = summary.failedCount === 0 ||
        (summary.failedCount > 0 && failToPassResults.every(r => r.status === "pass"));

      success = allFailToPassPassed && allPassToPassPassed && noUnexpectedFailures;

      const failToPassSummary = failToPassResults.map(r =>
        `${r.name}: ${r.status}`
      ).join(", ");
      const passToPassSummary = passToPassResults.map(r =>
        `${r.name}: ${r.status}`
      ).join(", ");

      stdoutMessage = `Patch validation: ${summary.passedCount}/${summary.totalCount} tests passed.\n` +
        `Fail-to-pass tests (${failToPassResults.filter(r => r.status === "pass").length}/${failToPassRequired.length} passed):\n  ${failToPassSummary}\n` +
        `Pass-to-pass tests (${passToPassResults.filter(r => r.status === "pass").length}/${passToPassRequired.length} passed):\n  ${passToPassSummary}`;
      stderrMessage = success ? "" : result.stderr;
    } else {
      success = summary.failedCount === 0;
      stdoutMessage = `Patch validation: ${summary.passedCount}/${summary.totalCount} tests passed. ` +
        `Required fail-to-pass tests: ${failToPassRequired.length}. ` +
        `Required pass-to-pass tests: ${passToPassRequired.length}. ` +
        (success ? "All tests passed." : `${summary.failedCount} tests failed.`);
      stderrMessage = success ? "" : result.stderr;
    }

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "patch-validation",
      command: judge.testSuite,
      parser: summary.parser,
      expectation: `failToPass=${failToPassRequired.length}, passToPass=${passToPassRequired.length}`,
      exitCode: result.exitCode,
      success,
      stdout: stdoutMessage,
      stderr: stderrMessage,
      durationMs: result.durationMs,
      cwd: result.cwd,
      passedCount: summary.passedCount,
      failedCount: summary.failedCount,
      skippedCount: summary.skippedCount,
      totalCount: summary.totalCount,
      critical: judge.critical ?? false
    };
  } catch (error) {
    const success = result.exitCode === 0;
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "patch-validation",
      command: judge.testSuite,
      expectation: `exitCode=0`,
      exitCode: result.exitCode,
      success,
      stdout: result.stdout,
      stderr: `${result.stderr}\nFailed to parse test results JSON: ${error instanceof Error ? error.message : String(error)}`.trim(),
      durationMs: result.durationMs,
      cwd: result.cwd,
      critical: judge.critical ?? false
    };
  }
}
