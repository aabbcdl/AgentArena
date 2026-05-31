import type {
  JudgeResult,
  TaskJudge,
} from "@agentarena/core";
import { BenchmarkCancelledError, judgeTypeRegistry, metrics } from "@agentarena/core";
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
  } catch (error) {
    // Cancellation is a control-flow signal, not a judge failure. Re-throw so
    // the runner's abort handling can short-circuit; otherwise this judge
    // would silently produce a fake "Judge did not produce a result" fallback
    // and the benchmark would proceed as if cancellation had been ignored.
    if (error instanceof BenchmarkCancelledError) {
      throw error;
    }
    // Treat the OS AbortError the same way as BenchmarkCancelledError —
    // both signal "user asked us to stop, don't pretend you scored anything".
    if (error instanceof Error && (error.name === "AbortError" || (error as NodeJS.ErrnoException).code === "ABORT_ERR")) {
      throw error;
    }
    // Otherwise surface as a structured judge failure with the error message
    // so the SPA can render something more useful than "did not produce a result".
    result = {
      judgeId: judge.id,
      type: judge.type,
      success: false,
      label: judge.label,
      exitCode: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  } finally {
    const durationSeconds = (Date.now() - startTime) / 1000;
    const status = result?.success ? "success" : "failure";
    metrics.judgeExecutionTotal.inc({ type: judge.type, status });
    metrics.judgeExecutionDurationSeconds.observe({ type: judge.type }, durationSeconds);
  }
  return result ?? { judgeId: judge.id, type: judge.type, success: false, label: judge.label, exitCode: null, stdout: "", stderr: "Judge did not produce a result", durationMs: 0 };
}

const COMMAND_BASED_TYPES = new Set(["command", "test-result", "lint-check", "compilation", "patch-validation"]);
/**
 * Max command-based judges to run in parallel. Each command judge typically
 * spawns a child process (npm test, eslint, tsc, …). Running them serially
 * stretched a 5-judge task pack into 5x the total command duration with
 * minimal CPU saturation. The workspace is effectively read-only between
 * agent execution and judge phase, so concurrent reads/builds are safe.
 *
 * Override at runtime via AGENTARENA_JUDGE_CONCURRENCY.
 */
const DEFAULT_JUDGE_CONCURRENCY = 4;

function getJudgeConcurrency(): number {
  const raw = process.env.AGENTARENA_JUDGE_CONCURRENCY;
  if (!raw) return DEFAULT_JUDGE_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_JUDGE_CONCURRENCY;
  return Math.min(Math.floor(parsed), 16);
}

/**
 * Run command-based judges with bounded concurrency.
 *
 * See `mapWithConcurrency` in packages/runner/src/concurrency.ts for the
 * full concurrency safety rationale. The shared `cursor` counter is safe
 * under Node.js's single-threaded event loop because the read-increment
 * is synchronous (no `await` between `const at = cursor` and `cursor += 1`).
 */
async function mapJudgesWithConcurrency(
  indices: number[],
  judges: TaskJudge[],
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions,
  fileList: string[] | undefined,
  results: (JudgeResult | null)[],
  concurrency: number
): Promise<void> {
  let cursor = 0;
  const next = async (): Promise<void> => {
    while (cursor < indices.length) {
      // Synchronous claim — no await between read and increment.
      const at = cursor;
      cursor += 1;
      const idx = indices[at];
      results[idx] = await runJudge(judges[idx], workspacePath, baseAllowedNames, options, fileList);
    }
  };
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, indices.length); w += 1) {
    workers.push(next());
  }
  await Promise.all(workers);
}

export async function runJudges(
  judges: TaskJudge[],
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult[]> {
  const fileList = await listWorkspaceFiles(workspacePath);
  const results: (JudgeResult | null)[] = new Array(judges.length).fill(null);

  const parallelIndices: number[] = [];
  const commandIndices: number[] = [];
  for (let i = 0; i < judges.length; i++) {
    if (COMMAND_BASED_TYPES.has(judges[i].type)) {
      commandIndices.push(i);
    } else {
      parallelIndices.push(i);
    }
  }

  // Pure parallel judges (file-exists, glob, json-value, …) run with full
  // parallelism; command-based judges run with bounded concurrency since
  // each forks a child process.
  await Promise.all([
    (async () => {
      const parallelResults = await Promise.all(
        parallelIndices.map((i) => runJudge(judges[i], workspacePath, baseAllowedNames, options, fileList))
      );
      for (let j = 0; j < parallelIndices.length; j++) {
        results[parallelIndices[j]] = parallelResults[j];
      }
    })(),
    mapJudgesWithConcurrency(commandIndices, judges, workspacePath, baseAllowedNames, options, fileList, results, getJudgeConcurrency()),
  ]);

  // Validate every slot is populated. A `null` here means a judge throwing
  // BenchmarkCancelledError above propagated out before its slot was filled —
  // we should already have unwound from runBenchmark, but guard anyway so
  // downstream type assertions are not a lie.
  for (let i = 0; i < results.length; i += 1) {
    if (results[i] === null) {
      throw new Error(`runJudges: missing result for judge index ${i} (judge ${judges[i].id} of type ${judges[i].type}). This indicates an internal scheduling bug.`);
    }
  }

  return results as JudgeResult[];
}

export { validateJudgeResult } from "./shared.js";
export type { JudgeExecutionOptions };
export { parseCommand, resolveCommandWorkingDirectory, runCommandStep, runCommandSteps };
