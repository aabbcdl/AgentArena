import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  buildExecutionEnvironment,
  type CommandExecutionSpec,
  type CommandJudge,
  type CommandStepResult,
  type FileContainsJudge,
  type FileCountJudge,
  type FileExistsJudge,
  type GlobJudge,
  type JsonSchemaJudge,
  type JsonValueJudge,
  type JudgeResult,
  type LintCheckJudge,
  resolveTimeoutMs,
  type SnapshotJudge,
  type TaskJudge,
  type TestResultJudge,
  uniqueSorted
} from "@repoarena/core";
import Ajv from "ajv";
import picomatch from "picomatch";

const DEFAULT_JUDGE_TIMEOUT_MS = 5 * 60 * 1_000;

/** Create a fresh Ajv instance per validation to avoid accumulating compiled schemas in memory. */
function createAjv(): InstanceType<typeof Ajv> {
  return new Ajv({ allErrors: true, strict: false });
}

export interface JudgeExecutionOptions {
  updateSnapshots?: boolean;
}

function defaultJudgeTimeoutMs(): number {
  return resolveTimeoutMs(process.env.REPOARENA_JUDGE_TIMEOUT_MS, DEFAULT_JUDGE_TIMEOUT_MS);
}

function resolveWorkspacePath(workspacePath: string, relativeTargetPath: string, label: string): string {
  const candidatePath = path.resolve(workspacePath, relativeTargetPath);
  const relativePath = path.relative(workspacePath, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the workspace.`);
  }

  return candidatePath;
}

function resolveJudgeWorkingDirectory(
  workspacePath: string,
  judge: Pick<CommandExecutionSpec, "id" | "cwd">
): string {
  return resolveWorkspacePath(workspacePath, judge.cwd ?? ".", `Judge "${judge.id}" cwd`);
}

function resolveCommandWorkingDirectory(workspacePath: string, step: CommandExecutionSpec): string {
  return resolveWorkspacePath(workspacePath, step.cwd ?? ".", `Command step "${step.id}" cwd`);
}

function buildStepEnvironment(
  baseAllowedNames: string[],
  step: Pick<CommandExecutionSpec, "envAllowList" | "env">
): NodeJS.ProcessEnv {
  const effectiveAllowList = uniqueSorted([...(baseAllowedNames ?? []), ...(step.envAllowList ?? [])]);
  return buildExecutionEnvironment(effectiveAllowList, step.env ?? {});
}

interface CommandExecutionCapture {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd: string;
}

function stringifyExpectation(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Create a picomatch matcher for glob patterns (replaces custom globToRegExp). */
function createGlobMatcher(pattern: string): (value: string) => boolean {
  return picomatch(pattern, { dot: true });
}

async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push(path.relative(rootPath, absolutePath).split(path.sep).join("/"));
    }
  }

  await walk(rootPath);
  return files.sort();
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === "") {
    return root;
  }

  if (!pointer.startsWith("/")) {
    throw new Error(
      `JSON pointer "${pointer}" must start with "/". ` +
      `Example: "/foo/bar" or "/0". ` +
      `Use "~0" for "~" and "~1" for "/" in property names.`
    );
  }

  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));

  let current: unknown = root;
  const path: string[] = [];

  for (const segment of segments) {
    path.push(segment);

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) {
        throw new Error(
          `JSON pointer segment "${segment}" at path "/${path.join("/")}" is not a valid array index. ` +
          `Expected an integer, got "${segment}".`
        );
      }
      if (index < 0) {
        throw new Error(
          `JSON pointer segment "${segment}" at path "/${path.join("/")}" is negative. ` +
          `Array indices must be non-negative integers.`
        );
      }
      if (index >= current.length) {
        throw new Error(
          `JSON pointer segment "${segment}" at path "/${path.join("/")}" is out of bounds. ` +
          `Array has ${current.length} elements (indices 0-${current.length - 1}).`
        );
      }
      current = current[index];
      continue;
    }

    if (current === null || current === undefined) {
      throw new Error(
        `JSON pointer segment "${segment}" at path "/${path.join("/")}" cannot be accessed. ` +
        `Parent is ${current === null ? "null" : "undefined"}.`
      );
    }

    if (typeof current !== "object") {
      throw new Error(
        `JSON pointer segment "${segment}" at path "/${path.join("/")}" cannot be accessed. ` +
        `Parent is a ${typeof current}, not an object.`
      );
    }

    if (!(segment in current)) {
      const availableKeys = Object.keys(current as Record<string, unknown>);
      const suggestion = availableKeys.length > 0
        ? `Available properties: ${availableKeys.slice(0, 10).join(", ")}${availableKeys.length > 10 ? "..." : ""}`
        : "Object has no properties.";
      throw new Error(
        `JSON pointer segment "${segment}" at path "/${path.join("/")}" does not exist. ${suggestion}`
      );
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

async function runCommandJudge(
  judge: CommandJudge,
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<JudgeResult> {
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);

  const result = await executeCommand(judge.command, cwd, environment, timeoutMs, "Judge");

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
    cwd: result.cwd
  };
}

async function executeCommand(
  command: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  timeoutLabel: string
): Promise<CommandExecutionCapture> {
  const startedAt = Date.now();

  return await new Promise((resolve) => {
    const child = spawn(command, {
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
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000);
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
        exitCode,
        stdout: stdout.trim(),
        stderr: `${stderr}${timedOut ? `\n${timeoutLabel} timed out after ${timeoutMs}ms.` : ""}`.trim(),
        durationMs: Date.now() - startedAt,
        cwd
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
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

function parseJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Expected JSON output but received empty content.");
  }

  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Unable to parse JSON from judge output.");
}

async function readJsonJudgePayload(
  workspacePath: string,
  reportFile: string | undefined,
  fallbackOutput: string,
  label: string
): Promise<unknown> {
  if (reportFile) {
    const reportPath = resolveWorkspacePath(workspacePath, reportFile, label);
    return parseJsonPayload(await fs.readFile(reportPath, "utf8"));
  }

  return parseJsonPayload(fallbackOutput);
}

interface ParsedTestSummary {
  parser: "jest" | "vitest";
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  totalCount: number;
  success: boolean;
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTestSummary(payload: unknown, format: TestResultJudge["format"]): ParsedTestSummary {
  if (!isObjectRecord(payload)) {
    throw new Error("Test result payload must be a JSON object.");
  }

  const totalCount = toNonNegativeNumber(payload.numTotalTests);
  const passedCount = toNonNegativeNumber(payload.numPassedTests);
  const failedCount = toNonNegativeNumber(payload.numFailedTests);
  const skippedCount = toNonNegativeNumber(payload.numPendingTests) + toNonNegativeNumber(payload.numTodoTests);

  if (totalCount === 0 && passedCount === 0 && failedCount === 0 && skippedCount === 0) {
    throw new Error("Test result JSON did not contain Jest/Vitest aggregate counters.");
  }

  const parser = format === "jest" ? "jest" : format === "vitest" ? "vitest" : "vitest" in payload ? "vitest" : "jest";
  const success = typeof payload.success === "boolean" ? payload.success : failedCount === 0;

  return {
    parser,
    passedCount,
    failedCount,
    skippedCount,
    totalCount,
    success
  };
}

interface ParsedLintSummary {
  parser: "eslint" | "biome";
  errorCount: number;
  warningCount: number;
  totalCount: number;
}

function parseEslintSummary(payload: unknown): ParsedLintSummary | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const totals = payload.reduce(
    (summary, entry) => {
      if (!isObjectRecord(entry)) {
        return summary;
      }

      const entryErrors = toNonNegativeNumber(entry.errorCount);
      const entryWarnings = toNonNegativeNumber(entry.warningCount);
      return {
        errorCount: summary.errorCount + entryErrors,
        warningCount: summary.warningCount + entryWarnings,
        totalCount: summary.totalCount + entryErrors + entryWarnings
      };
    },
    { errorCount: 0, warningCount: 0, totalCount: 0 }
  );

  return {
    parser: "eslint",
    ...totals
  };
}

function parseBiomeSummary(payload: unknown): ParsedLintSummary | null {
  if (!isObjectRecord(payload) || !Array.isArray(payload.diagnostics)) {
    return null;
  }

  const totals = payload.diagnostics.reduce(
    (summary, entry) => {
      if (!isObjectRecord(entry)) {
        return summary;
      }

      const severity = entry.severity;
      if (severity === "error") {
        summary.errorCount += 1;
      } else if (severity === "warning") {
        summary.warningCount += 1;
      }
      summary.totalCount += 1;
      return summary;
    },
    { errorCount: 0, warningCount: 0, totalCount: 0 }
  );

  return {
    parser: "biome",
    errorCount: Math.max(totals.errorCount, toNonNegativeNumber(payload.errors)),
    warningCount: totals.warningCount,
    totalCount: Math.max(totals.totalCount, toNonNegativeNumber(payload.errors) + totals.warningCount)
  };
}

function parseLintSummary(payload: unknown, format: LintCheckJudge["format"]): ParsedLintSummary {
  const eslintSummary = format !== "biome" ? parseEslintSummary(payload) : null;
  if (eslintSummary) {
    return eslintSummary;
  }

  const biomeSummary = format !== "eslint" ? parseBiomeSummary(payload) : null;
  if (biomeSummary) {
    return biomeSummary;
  }

  throw new Error("Lint result JSON did not match ESLint or Biome reporter output.");
}

async function runTestResultJudge(
  judge: TestResultJudge,
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<JudgeResult> {
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);
  const result = await executeCommand(judge.command, cwd, environment, timeoutMs, "Judge");

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
      totalCount: summary.totalCount
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
      cwd: result.cwd
    };
  }
}

async function runLintCheckJudge(
  judge: LintCheckJudge,
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<JudgeResult> {
  const timeoutMs = judge.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveJudgeWorkingDirectory(workspacePath, judge);
  const environment = buildStepEnvironment(baseAllowedNames, judge);
  const result = await executeCommand(judge.command, cwd, environment, timeoutMs, "Judge");
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
      totalCount: summary.totalCount
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
      cwd: result.cwd
    };
  }
}

async function runFileExistsJudge(judge: FileExistsJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    await fs.access(targetPath);
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-exists",
      target: judge.path,
      expectation: "exists",
      exitCode: 0,
      success: true,
      stdout: `Found ${judge.path}.`,
      stderr: "",
      durationMs: Date.now() - startedAt
    };
  } catch {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-exists",
      target: judge.path,
      expectation: "exists",
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: `Expected file "${judge.path}" to exist.`,
      durationMs: Date.now() - startedAt
    };
  }
}

async function runFileContainsJudge(judge: FileContainsJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    const content = await fs.readFile(targetPath, "utf8");
    const matched = judge.regex
      ? new RegExp(judge.pattern, judge.flags).test(content)
      : content.includes(judge.pattern);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-contains",
      target: judge.path,
      expectation: judge.regex
        ? `regex:${judge.pattern}${judge.flags ? `/${judge.flags}` : ""}`
        : judge.pattern,
      exitCode: matched ? 0 : 1,
      success: matched,
      stdout: matched ? `Matched content in ${judge.path}.` : "",
      stderr: matched
        ? ""
        : `Expected file "${judge.path}" to contain ${judge.regex ? "a regex match" : "the target string"}.`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-contains",
      target: judge.path,
      expectation: judge.pattern,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runJsonValueJudge(judge: JsonValueJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);
  const expectation = stringifyExpectation(judge.expected);

  try {
    const parsed = JSON.parse(await fs.readFile(targetPath, "utf8")) as unknown;
    const actual = resolveJsonPointer(parsed, judge.pointer);
    const matched = isDeepStrictEqual(actual, judge.expected);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-value",
      target: `${judge.path}#${judge.pointer}`,
      expectation,
      exitCode: matched ? 0 : 1,
      success: matched,
      stdout: matched ? `Matched JSON value at ${judge.pointer}.` : `Actual: ${stringifyExpectation(actual)}`,
      stderr: matched
        ? ""
        : `Expected ${judge.path} at "${judge.pointer}" to equal ${expectation}.`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-value",
      target: `${judge.path}#${judge.pointer}`,
      expectation,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runGlobJudge(judge: GlobJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const matcher = createGlobMatcher(judge.pattern);

  try {
    const matches = (await listWorkspaceFiles(workspacePath)).filter((filePath) => matcher(filePath));
    const minMatches = judge.minMatches ?? 1;
    const maxMatches = judge.maxMatches;
    const success = matches.length >= minMatches && (maxMatches === undefined || matches.length <= maxMatches);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "glob",
      target: judge.pattern,
      expectation:
        maxMatches === undefined
          ? `matches>=${minMatches}`
          : `matches>=${minMatches} && matches<=${maxMatches}`,
      exitCode: success ? 0 : 1,
      success,
      stdout: matches.length > 0 ? `Matched files: ${matches.join(", ")}` : "",
      stderr: success
        ? ""
        : `Expected glob "${judge.pattern}" to match within configured bounds, actual matches=${matches.length}.`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "glob",
      target: judge.pattern,
      expectation:
        judge.maxMatches === undefined
          ? `matches>=${judge.minMatches ?? 1}`
          : `matches>=${judge.minMatches ?? 1} && matches<=${judge.maxMatches}`,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runFileCountJudge(judge: FileCountJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const matcher = createGlobMatcher(judge.pattern);

  try {
    const matches = (await listWorkspaceFiles(workspacePath)).filter((filePath) => matcher(filePath));
    const actual = matches.length;
    const success =
      (judge.equals === undefined || actual === judge.equals) &&
      (judge.min === undefined || actual >= judge.min) &&
      (judge.max === undefined || actual <= judge.max);

    const expectationParts = [
      judge.equals !== undefined ? `equals=${judge.equals}` : "",
      judge.min !== undefined ? `min=${judge.min}` : "",
      judge.max !== undefined ? `max=${judge.max}` : ""
    ].filter(Boolean);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-count",
      target: judge.pattern,
      expectation: expectationParts.join(", "),
      exitCode: success ? 0 : 1,
      success,
      stdout: `Actual count=${actual}${matches.length > 0 ? `; matches: ${matches.join(", ")}` : ""}`,
      stderr: success ? "" : `File count assertion failed for pattern "${judge.pattern}".`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-count",
      target: judge.pattern,
      expectation: stringifyExpectation({
        equals: judge.equals,
        min: judge.min,
        max: judge.max
      }),
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runSnapshotJudgeWithOptions(
  judge: SnapshotJudge,
  workspacePath: string,
  options: JudgeExecutionOptions
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);
  const snapshotPath = resolveWorkspacePath(
    workspacePath,
    judge.snapshotPath,
    `Judge "${judge.id}" snapshotPath`
  );

  try {
    const [actual, expected] = await Promise.all([
      fs.readFile(targetPath, "utf8"),
      fs.readFile(snapshotPath, "utf8")
    ]);
    const normalizedActual = actual.replaceAll("\r\n", "\n");
    const normalizedExpected = expected.replaceAll("\r\n", "\n");
    let success = normalizedActual === normalizedExpected;

    if (!success && options.updateSnapshots) {
      await fs.writeFile(snapshotPath, actual, "utf8");
      success = true;
    }

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "snapshot",
      target: judge.path,
      expectation: `matches ${judge.snapshotPath}`,
      exitCode: success ? 0 : 1,
      success,
      stdout: success
        ? normalizedActual === normalizedExpected
          ? `Snapshot matched ${judge.snapshotPath}.`
          : `Updated snapshot ${judge.snapshotPath} from ${judge.path}.`
        : "",
      stderr: success ? "" : `Snapshot mismatch for "${judge.path}" against "${judge.snapshotPath}".`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "snapshot",
      target: judge.path,
      expectation: `matches ${judge.snapshotPath}`,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

async function runJsonSchemaJudge(judge: JsonSchemaJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    const schema =
      judge.schema ??
      (JSON.parse(
        await fs.readFile(
          resolveWorkspacePath(workspacePath, judge.schemaPath ?? "", `Judge "${judge.id}" schemaPath`),
          "utf8"
        )
      ) as Record<string, unknown>);
    const payload = JSON.parse(await fs.readFile(targetPath, "utf8")) as unknown;
    const ajv = createAjv();
    const validate = ajv.compile(schema);
    const success = Boolean(validate(payload));
    const validationErrors =
      validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`) ?? [];

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-schema",
      target: judge.path,
      expectation: judge.schemaPath ? `schemaPath=${judge.schemaPath}` : "inline-schema",
      exitCode: success ? 0 : 1,
      success,
      stdout: success ? `JSON schema validation passed for ${judge.path}.` : "",
      stderr: success ? "" : validationErrors.join("; "),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-schema",
      target: judge.path,
      expectation: judge.schemaPath ? `schemaPath=${judge.schemaPath}` : "inline-schema",
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

export async function runJudge(
  judge: TaskJudge,
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult> {
  switch (judge.type) {
    case "command":
      return await runCommandJudge(judge, workspacePath, baseAllowedNames);
    case "test-result":
      return await runTestResultJudge(judge, workspacePath, baseAllowedNames);
    case "lint-check":
      return await runLintCheckJudge(judge, workspacePath, baseAllowedNames);
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
  }
}

export async function runJudges(
  judges: TaskJudge[],
  workspacePath: string,
  baseAllowedNames: string[],
  options: JudgeExecutionOptions = {}
): Promise<JudgeResult[]> {
  return await Promise.all(
    judges.map(async (judge) => await runJudge(judge, workspacePath, baseAllowedNames, options))
  );
}

export async function runCommandStep(
  step: CommandExecutionSpec,
  workspacePath: string,
  baseAllowedNames: string[]
): Promise<CommandStepResult> {
  const timeoutMs = step.timeoutMs ?? defaultJudgeTimeoutMs();
  const cwd = resolveCommandWorkingDirectory(workspacePath, step);
  const environment = buildStepEnvironment(baseAllowedNames, step);
  const result = await executeCommand(step.command, cwd, environment, timeoutMs, "Command step");

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
  baseAllowedNames: string[]
): Promise<CommandStepResult[]> {
  const results: CommandStepResult[] = [];

  for (const step of steps) {
    results.push(await runCommandStep(step, workspacePath, baseAllowedNames));
  }

  return results;
}
