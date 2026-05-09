import type {
  JudgeResult,
  TaskJudge,
} from "@agentarena/core";
import { judgeTypeRegistry } from "@agentarena/core";
import { parseCommand, runCommandStep, runCommandSteps } from "./command-runner.js";
import { runCommandJudge } from "./judges/command.js";
import { runCompilationJudge } from "./judges/compilation.js";
import { runDirectoryExistsJudge } from "./judges/directory-exists.js";
import { runFileContainsJudge } from "./judges/file-contains.js";
import { runFileCountJudge } from "./judges/file-count.js";
import { runFileExistsJudge } from "./judges/file-exists.js";
import { runGlobJudge } from "./judges/glob.js";
import { runJsonSchemaJudge } from "./judges/json-schema.js";
import { runJsonValueJudge } from "./judges/json-value.js";
import { runLintCheckJudge } from "./judges/lint-check.js";
import { runPatchValidationJudge } from "./judges/patch-validation.js";
import { runRegexMatchJudge } from "./judges/regex-match.js";
import { runSnapshotJudgeWithOptions } from "./judges/snapshot.js";
import { runTestResultJudge } from "./judges/test-result.js";
import { runTokenEfficiencyJudge } from "./judges/token-efficiency.js";
import {
  COMMAND_JUDGE_FIELDS,
  COMMON_JUDGE_FIELDS,
  type JudgeExecutionOptions,
  resolveCommandWorkingDirectory,
} from "./shared.js";

judgeTypeRegistry.register({ type: "command", allowedFields: COMMAND_JUDGE_FIELDS, isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "test-result", allowedFields: new Set([...COMMAND_JUDGE_FIELDS, "format", "reportFile", "passOnNoTests"]), isCriticalByDefault: true });
judgeTypeRegistry.register({ type: "lint-check", allowedFields: new Set([...COMMAND_JUDGE_FIELDS, "format", "reportFile", "maxWarnings"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "file-exists", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "path"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "file-contains", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "path", "pattern", "regex", "flags"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "json-value", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "path", "pointer", "expected"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "glob", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "pattern", "minMatches", "maxMatches"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "file-count", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "pattern", "equals", "min", "max"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "snapshot", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "path", "snapshotPath"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "json-schema", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "path", "schema", "schemaPath"]), isCriticalByDefault: true });
judgeTypeRegistry.register({ type: "patch-validation", allowedFields: new Set([...COMMAND_JUDGE_FIELDS, "testSuite", "failToPassTests", "passToPassTests"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "token-efficiency", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "tokenBudget"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "directory-exists", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "path"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "regex-match", allowedFields: new Set([...COMMON_JUDGE_FIELDS, "path", "pattern", "flags", "shouldNotMatch", "minMatches", "maxMatches"]), isCriticalByDefault: false });
judgeTypeRegistry.register({ type: "compilation", allowedFields: new Set([...COMMAND_JUDGE_FIELDS, "tool", "buildArgs"]), isCriticalByDefault: true });

export async function runJudge(
  judge: TaskJudge,
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult> {
  switch (judge.type) {
    case "command":
      return await runCommandJudge(judge, workspacePath, baseAllowedNames, options);
    case "test-result":
      return await runTestResultJudge(judge, workspacePath, baseAllowedNames, options);
    case "lint-check":
      return await runLintCheckJudge(judge, workspacePath, baseAllowedNames, options);
    case "file-exists":
      return await runFileExistsJudge(judge, workspacePath);
    case "file-contains":
      return await runFileContainsJudge(judge, workspacePath);
    case "json-value":
      return await runJsonValueJudge(judge, workspacePath);
    case "glob":
      return await runGlobJudge(judge, workspacePath);
    case "file-count":
      return await runFileCountJudge(judge, workspacePath);
    case "snapshot":
      return await runSnapshotJudgeWithOptions(judge, workspacePath, options);
    case "json-schema":
      return await runJsonSchemaJudge(judge, workspacePath);
    case "patch-validation":
      return await runPatchValidationJudge(judge, workspacePath, baseAllowedNames, options);
    case "token-efficiency":
      return await runTokenEfficiencyJudge(judge, options.tokenUsage, options.tokenBudget);
    case "directory-exists":
      return await runDirectoryExistsJudge(judge, workspacePath);
    case "regex-match":
      return await runRegexMatchJudge(judge, workspacePath);
    case "compilation":
      return await runCompilationJudge(judge, workspacePath, baseAllowedNames, options);
  }
}

export async function runJudges(
  judges: TaskJudge[],
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult[]> {
  const results: JudgeResult[] = [];
  for (const judge of judges) {
    results.push(await runJudge(judge, workspacePath, baseAllowedNames, options));
  }
  return results;
}

export type { JudgeExecutionOptions };
export { parseCommand, resolveCommandWorkingDirectory, runCommandStep, runCommandSteps };
