import type {
  JudgeResult,
  TaskJudge,
} from "@agentarena/core";
import { judgeTypeRegistry, metrics } from "@agentarena/core";
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
  listWorkspaceFiles,
  resolveCommandWorkingDirectory,
} from "./shared.js";

// SYNC CONTRACT: judgeTypeRegistry registrations
//
// Each type registered here MUST have a corresponding entry in:
//   packages/taskpacks/src/index.ts → JUDGE_NORMALIZERS
//
// The allowedFields sets are used for unknown-field validation at task pack
// load time. JUDGE_NORMALIZERS defines how to construct the typed judge object.
//
// Adding a new judge type:
//   1. Add the TypeScript interface in packages/core/src/types/judge.ts
//   2. Add the union member to TaskJudge
//   3. Register it here with its allowedFields
//   4. Add a normalizer in packages/taskpacks/src/index.ts JUDGE_NORMALIZERS
//   5. Add the runner in packages/judges/src/judges/<type>.ts
//   6. Add the case to runJudge() switch below
//
// tests/judge-registry-sync.test.mjs verifies this sync at CI time.

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
  options: JudgeExecutionOptions = {},
  fileList?: string[]
): Promise<JudgeResult> {
  const startTime = Date.now();
  let result: JudgeResult | undefined;
  try {
    switch (judge.type) {
      case "command":
        result = await runCommandJudge(judge, workspacePath, baseAllowedNames, options);
        break;
      case "test-result":
        result = await runTestResultJudge(judge, workspacePath, baseAllowedNames, options);
        break;
      case "lint-check":
        result = await runLintCheckJudge(judge, workspacePath, baseAllowedNames, options);
        break;
      case "file-exists":
        result = await runFileExistsJudge(judge, workspacePath);
        break;
      case "file-contains":
        result = await runFileContainsJudge(judge, workspacePath);
        break;
      case "json-value":
        result = await runJsonValueJudge(judge, workspacePath);
        break;
      case "glob":
        result = await runGlobJudge(judge, workspacePath, fileList);
        break;
      case "file-count":
        result = await runFileCountJudge(judge, workspacePath, fileList);
        break;
      case "snapshot":
        result = await runSnapshotJudgeWithOptions(judge, workspacePath, options);
        break;
      case "json-schema":
        result = await runJsonSchemaJudge(judge, workspacePath);
        break;
      case "patch-validation":
        result = await runPatchValidationJudge(judge, workspacePath, baseAllowedNames, options);
        break;
      case "token-efficiency":
        result = await runTokenEfficiencyJudge(judge, options.tokenUsage, options.tokenBudget);
        break;
      case "directory-exists":
        result = await runDirectoryExistsJudge(judge, workspacePath);
        break;
      case "regex-match":
        result = await runRegexMatchJudge(judge, workspacePath);
        break;
      case "compilation":
        result = await runCompilationJudge(judge, workspacePath, baseAllowedNames, options);
        break;
      default: {
        const unknownType = (judge as TaskJudge).type;
        result = {
          judgeId: (judge as TaskJudge).id ?? "unknown",
          label: `Unknown judge: ${unknownType}`,
          type: unknownType,
          exitCode: null,
          success: false,
          stdout: "",
          stderr: `Unknown judge type: ${unknownType}`,
          durationMs: 0,
        };
        break;
      }
    }
  } finally {
    const durationSeconds = (Date.now() - startTime) / 1000;
    const status = result?.success ? "success" : "failure";
    metrics.judgeExecutionTotal.inc({ type: judge.type, status });
    metrics.judgeExecutionDurationSeconds.observe({ type: judge.type }, durationSeconds);
  }
  return result!;
}

const COMMAND_BASED_TYPES = new Set(["command", "test-result", "lint-check", "compilation", "patch-validation"]);

export async function runJudges(
  judges: TaskJudge[],
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult[]> {
  const fileList = await listWorkspaceFiles(workspacePath);
  const results: (JudgeResult | null)[] = new Array(judges.length).fill(null);

  const parallelIndices: number[] = [];
  const sequentialIndices: number[] = [];
  for (let i = 0; i < judges.length; i++) {
    if (COMMAND_BASED_TYPES.has(judges[i].type)) {
      sequentialIndices.push(i);
    } else {
      parallelIndices.push(i);
    }
  }

  const [parallelResults] = await Promise.all([
    Promise.all(parallelIndices.map((i) => runJudge(judges[i], workspacePath, baseAllowedNames, options, fileList))),
    (async () => {
      for (const i of sequentialIndices) {
        results[i] = await runJudge(judges[i], workspacePath, baseAllowedNames, options, fileList);
      }
    })()
  ]);

  for (let j = 0; j < parallelIndices.length; j++) {
    results[parallelIndices[j]] = parallelResults[j];
  }

  return results as JudgeResult[];
}

export { validateJudgeResult } from "./shared.js";
export type { JudgeExecutionOptions };
export { parseCommand, resolveCommandWorkingDirectory, runCommandStep, runCommandSteps };
