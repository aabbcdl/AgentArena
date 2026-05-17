import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildExecutionEnvironment,
  type CommandExecutionSpec,
  INTERNAL_IGNORED_NAMES,
  isPathInsideWorkspace,
  MAX_PROCESS_OUTPUT_BYTES,
  pathExists,
  resolveTimeoutMs,
  throwIfAborted,
  uniqueSorted,
} from "@agentarena/core";
import Ajv from "ajv";
import picomatch from "picomatch";

export const COMMON_JUDGE_FIELDS = new Set(["id", "label", "type", "critical", "weight"]);
export const COMMAND_JUDGE_FIELDS = new Set([...COMMON_JUDGE_FIELDS, "command", "cwd", "timeoutMs", "envAllowList", "env"]);

export const DEFAULT_JUDGE_TIMEOUT_MS = 5 * 60 * 1_000;

export function hasReDoSRisk(pattern: string): boolean {
  if (/\([^)]*[+*][^)]*\)[+*?]/.test(pattern)) return true;
  if (/\([^)]*\|[^)]*\)[+*]/.test(pattern)) return true;
  return false;
}

export async function readTextFileSafe(filePath: string, label: string, maxSize = 50 * 1024 * 1024): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size > maxSize) {
    throw new Error(`${label}: file too large (${stat.size} bytes, max ${maxSize})`);
  }
  return fs.readFile(filePath, "utf8");
}

export function createAjv(): InstanceType<typeof Ajv> {
  return new Ajv({ allErrors: true, strict: false });
}

export interface JudgeExecutionOptions {
  updateSnapshots?: boolean;
  signal?: AbortSignal;
  tokenUsage?: number;
  tokenBudget?: number;
}

export function defaultJudgeTimeoutMs(): number {
  return resolveTimeoutMs(process.env.AGENTARENA_JUDGE_TIMEOUT_MS, DEFAULT_JUDGE_TIMEOUT_MS);
}

export async function resolveWorkspacePath(workspacePath: string, relativeTargetPath: string, label: string): Promise<string> {
  const candidatePath = path.resolve(workspacePath, relativeTargetPath);
  const isInside = await isPathInsideWorkspace(workspacePath, candidatePath);
  if (!isInside) {
    throw new Error(`${label} must stay inside the workspace.`);
  }
  return candidatePath;
}

export async function resolveJudgeWorkingDirectory(
  workspacePath: string,
  judge: Pick<CommandExecutionSpec, "id" | "cwd">
): Promise<string> {
  return resolveWorkspacePath(workspacePath, judge.cwd ?? ".", `Judge "${judge.id}" cwd`);
}

export async function resolveCommandWorkingDirectory(workspacePath: string, step: CommandExecutionSpec): Promise<string> {
  return resolveWorkspacePath(workspacePath, step.cwd ?? ".", `Command step "${step.id}" cwd`);
}

export function buildStepEnvironment(
  baseAllowedNames: string[],
  step: Pick<CommandExecutionSpec, "envAllowList" | "env">
): NodeJS.ProcessEnv {
  const effectiveAllowList = uniqueSorted([...(baseAllowedNames ?? []), ...(step.envAllowList ?? [])]);
  return buildExecutionEnvironment(effectiveAllowList, step.env ?? {});
}

export interface CommandExecutionCapture {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd: string;
}

export const throwIfCancelled = throwIfAborted;

export function stringifyExpectation(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function createGlobMatcher(pattern: string): (value: string) => boolean {
  return picomatch(pattern, { dot: true });
}

const MAX_WALK_DEPTH = 64;

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH) {
      console.warn(`Warning: Max depth (${MAX_WALK_DEPTH}) reached walking ${currentPath}. Skipping deeper files.`);
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (INTERNAL_IGNORED_NAMES.has(entry.name)) continue;
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push(path.relative(rootPath, absolutePath).split(path.sep).join("/"));
    }
  }

  await walk(rootPath, 0);
  return files.sort();
}

export function resolveJsonPointer(root: unknown, pointer: string): unknown {
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
  const pathSegments: string[] = [];

  for (const segment of segments) {
    pathSegments.push(segment);

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) {
        throw new Error(
          `JSON pointer segment "${segment}" at path "/${pathSegments.join("/")}" is not a valid array index. ` +
          `Expected an integer, got "${segment}".`
        );
      }
      if (index < 0) {
        throw new Error(
          `JSON pointer segment "${segment}" at path "/${pathSegments.join("/")}" is negative. ` +
          `Array indices must be non-negative integers.`
        );
      }
      if (index >= current.length) {
        throw new Error(
          `JSON pointer segment "${segment}" at path "/${pathSegments.join("/")}" is out of bounds. ` +
          `Array has ${current.length} elements (indices 0-${current.length - 1}).`
        );
      }
      current = current[index];
      continue;
    }

    if (current === null || current === undefined) {
      throw new Error(
        `JSON pointer segment "${segment}" at path "/${pathSegments.join("/")}" cannot be accessed. ` +
        `Parent is ${current === null ? "null" : "undefined"}.`
      );
    }

    if (typeof current !== "object") {
      throw new Error(
        `JSON pointer segment "${segment}" at path "/${pathSegments.join("/")}" cannot be accessed. ` +
        `Parent is a ${typeof current}, not an object.`
      );
    }

    if (!(segment in current)) {
      const availableKeys = Object.keys(current as Record<string, unknown>);
      const suggestion = availableKeys.length > 0
        ? `Available properties: ${availableKeys.slice(0, 10).join(", ")}${availableKeys.length > 10 ? "..." : ""}`
        : "Object has no properties.";
      throw new Error(
        `JSON pointer segment "${segment}" at path "/${pathSegments.join("/")}" does not exist. ${suggestion}`
      );
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function parseJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Expected JSON output but received empty content.");
  }

  const MAX_JSON_INPUT = 10 * 1024 * 1024;
  if (trimmed.length > MAX_JSON_INPUT) {
    throw new Error(
      `JSON output too large (${(trimmed.length / 1024 / 1024).toFixed(1)} MB, max ${MAX_JSON_INPUT / 1024 / 1024} MB). ` +
      `Consider using a reportFile instead of stdout for large outputs.`
    );
  }

  const candidates: string[] = [trimmed];

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

  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const errorDetail = lastError?.message ?? "unknown parse error";
  throw new Error(
    `Unable to parse JSON from judge output. Tried ${candidates.length} candidate(s). ` +
    `Last error: ${errorDetail}. ` +
    `Output preview: ${trimmed.slice(0, 200)}${trimmed.length > 200 ? "..." : ""}`
  );
}

export async function readJsonJudgePayload(
  workspacePath: string,
  reportFile: string | undefined,
  fallbackOutput: string,
  label: string
): Promise<unknown> {
  if (reportFile) {
    const reportPath = await resolveWorkspacePath(workspacePath, reportFile, label);
    return parseJsonPayload(await fs.readFile(reportPath, "utf8"));
  }

  return parseJsonPayload(fallbackOutput);
}

export interface ParsedTestSummary {
  parser: "jest" | "vitest";
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  totalCount: number;
  success: boolean;
}

export function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTestSummary(payload: unknown, format: string | undefined): ParsedTestSummary {
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

export interface ParsedLintSummary {
  parser: "eslint" | "biome";
  errorCount: number;
  warningCount: number;
  totalCount: number;
}

export interface TestDetail {
  name: string;
  fullName: string;
  status: "pass" | "fail" | "skip" | "pending";
}

export function extractTestDetails(payload: unknown, parser: string): TestDetail[] {
  const tests: TestDetail[] = [];

  if (!payload || typeof payload !== "object") {
    return tests;
  }

  const data = payload as Record<string, unknown>;

  let detectedFormat: "jest" | "vitest" | null = null;

  if (parser === "auto") {
    const testResults = data.testResults as Array<Record<string, unknown>> | undefined;
    if (testResults?.[0]?.assertionResults !== undefined) {
      detectedFormat = "jest";
    } else if (testResults?.[0]?.assertions !== undefined) {
      detectedFormat = "vitest";
    }
  } else {
    detectedFormat = parser as "jest" | "vitest";
  }

  if (!detectedFormat) {
    return tests;
  }

  const testResults = (data.testResults as Array<Record<string, unknown>>) ?? [];

  for (const file of testResults) {
    const assertions = detectedFormat === "jest"
      ? (file.assertionResults as Array<Record<string, unknown>>) ?? []
      : (file.assertions as Array<Record<string, unknown>>) ?? [];

    for (const test of assertions) {
      tests.push({
        name: (test.title as string) ?? (test.name as string) ?? "",
        fullName: (test.fullName as string) ?? (test.name as string) ?? "",
        status: (test.status as TestDetail["status"]) ?? "fail"
      });
    }
  }

  return tests;
}

export function checkRequiredTests(
  tests: TestDetail[],
  requiredPatterns: string[]
): Array<{ name: string; status: string; matched: boolean }> {
  const results: Array<{ name: string; status: string; matched: boolean }> = [];

  for (const pattern of requiredPatterns) {
    const matcher = picomatch(pattern, { dot: true });
    const matched = tests.filter(test => {
      if (test.name === pattern || test.fullName === pattern) {
        return true;
      }
      return matcher(test.fullName) || matcher(test.name);
    });

    if (matched.length > 0) {
      const test = matched[0];
      results.push({
        name: test.fullName || test.name,
        status: test.status,
        matched: true
      });
    } else {
      results.push({
        name: pattern,
        status: "not_found",
        matched: false
      });
    }
  }

  return results;
}

export function parseEslintSummary(payload: unknown): ParsedLintSummary | null {
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

export function parseBiomeSummary(payload: unknown): ParsedLintSummary | null {
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

export function parseLintSummary(payload: unknown, format: string | undefined): ParsedLintSummary {
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

/**
 * Validate that a value is a valid JudgeResult structure.
 * Returns true if valid, false otherwise.
 *
 * This prevents garbage-in → garbage-out in scoring by ensuring
 * judge results have the required fields with correct types.
 */
export function validateJudgeResult(result: unknown): result is {
  judgeId: string;
  label: string;
  type: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
} {
  if (!result || typeof result !== "object") {
    return false;
  }

  const obj = result as Record<string, unknown>;

  // Required string fields
  if (typeof obj.judgeId !== "string" || obj.judgeId.length === 0) {
    return false;
  }
  if (typeof obj.label !== "string") {
    return false;
  }
  if (typeof obj.type !== "string" || obj.type.length === 0) {
    return false;
  }

  // Required boolean field
  if (typeof obj.success !== "boolean") {
    return false;
  }

  // Required number fields
  if (obj.exitCode !== null && typeof obj.exitCode !== "number") {
    return false;
  }
  if (typeof obj.durationMs !== "number" || obj.durationMs < 0) {
    return false;
  }

  // Required string fields for output
  if (typeof obj.stdout !== "string") {
    return false;
  }
  if (typeof obj.stderr !== "string") {
    return false;
  }

  return true;
}

export { MAX_PROCESS_OUTPUT_BYTES, pathExists };
