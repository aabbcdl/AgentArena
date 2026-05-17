import type {
  CommandJudge,
  CompilationJudge,
  DirectoryExistsJudge,
  FileContainsJudge,
  FileCountJudge,
  FileExistsJudge,
  GlobJudge,
  JsonSchemaJudge,
  JsonValueJudge,
  LintCheckJudge,
  PatchValidationJudge,
  RegexMatchJudge,
  SnapshotJudge,
  TaskJudge,
  TestResultJudge,
  TokenEfficiencyJudge,
} from "@agentarena/core";
import {
  assertObject,
  assertOptionalBoolean,
  assertOptionalNonNegativeInteger,
  assertOptionalPositiveInteger,
  assertOptionalString,
  assertString,
  assertStringArray,
  assertStringRecord,
} from "./assert.js";

export type JudgeNormalizer = (
  value: Record<string, unknown>,
  index: number,
  id: string,
  label: string,
  critical: boolean
) => TaskJudge;

export function normalizeCommandLikeFields(value: Record<string, unknown>, index: number) {
  return {
    command: assertString(value.command, `judges[${index}].command`),
    cwd: assertOptionalString(value.cwd, `judges[${index}].cwd`),
    timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `judges[${index}].timeoutMs`),
    envAllowList: assertStringArray(value.envAllowList, `judges[${index}].envAllowList`),
    env: assertStringRecord(value.env, `judges[${index}].env`)
  };
}

// SYNC CONTRACT: JUDGE_NORMALIZERS
//
// Every key here MUST match a judgeTypeRegistry.register() call in:
//   packages/judges/src/index.ts
//
// The fields accessed by each normalizer MUST match the allowedFields
// set registered for that type. Divergence causes "unrecognized field"
// errors for fields the normalizer actually needs.
//
// See packages/judges/src/index.ts for the full checklist.

export const JUDGE_NORMALIZERS: Record<string, JudgeNormalizer> = {
  "command": (value, index, id, label, critical): CommandJudge => ({
    id, label, type: "command", critical,
    ...normalizeCommandLikeFields(value, index)
  }),

  "test-result": (value, index, id, label, critical): TestResultJudge => ({
    id, label, type: "test-result", critical,
    ...normalizeCommandLikeFields(value, index),
    format: (assertOptionalString(value.format, `judges[${index}].format`) as TestResultJudge["format"] | undefined) ?? "auto",
    reportFile: assertOptionalString(value.reportFile, `judges[${index}].reportFile`),
    passOnNoTests: assertOptionalBoolean(value.passOnNoTests, `judges[${index}].passOnNoTests`)
  }),

  "lint-check": (value, index, id, label, critical): LintCheckJudge => ({
    id, label, type: "lint-check", critical,
    ...normalizeCommandLikeFields(value, index),
    format: (assertOptionalString(value.format, `judges[${index}].format`) as LintCheckJudge["format"] | undefined) ?? "auto",
    reportFile: assertOptionalString(value.reportFile, `judges[${index}].reportFile`),
    maxWarnings: assertOptionalNonNegativeInteger(value.maxWarnings, `judges[${index}].maxWarnings`)
  }),

  "file-exists": (value, index, id, label, critical): FileExistsJudge => ({
    id, label, type: "file-exists", critical,
    path: assertString(value.path, `judges[${index}].path`)
  }),

  "file-contains": (value, index, id, label, critical): FileContainsJudge => ({
    id, label, type: "file-contains", critical,
    path: assertString(value.path, `judges[${index}].path`),
    pattern: assertString(value.pattern, `judges[${index}].pattern`),
    regex: assertOptionalBoolean(value.regex, `judges[${index}].regex`),
    flags: assertOptionalString(value.flags, `judges[${index}].flags`)
  }),

  "json-value": (value, index, id, label, critical): JsonValueJudge => {
    if (!Object.hasOwn(value, "expected")) {
      throw new Error(
        `Task pack field "judges[${index}].expected" is required for type "json-value". ` +
        `Example: { "type": "json-value", "path": "data.json", "pointer": "/status", "expected": "ready" }`
      );
    }
    return {
      id, label, type: "json-value", critical,
      path: assertString(value.path, `judges[${index}].path`),
      pointer: assertString(value.pointer, `judges[${index}].pointer`),
      expected: value.expected
    };
  },

  "glob": (value, index, id, label, critical): GlobJudge => {
    const judge: GlobJudge = {
      id, label, type: "glob", critical,
      pattern: assertString(value.pattern, `judges[${index}].pattern`),
      minMatches: assertOptionalNonNegativeInteger(value.minMatches, `judges[${index}].minMatches`),
      maxMatches: assertOptionalNonNegativeInteger(value.maxMatches, `judges[${index}].maxMatches`)
    };
    if (judge.minMatches !== undefined && judge.maxMatches !== undefined && judge.minMatches > judge.maxMatches) {
      throw new Error(
        `Task pack judge at index ${index}: minMatches (${judge.minMatches}) must be <= maxMatches (${judge.maxMatches}).`
      );
    }
    return judge;
  },

  "file-count": (value, index, id, label, critical): FileCountJudge => {
    const judge: FileCountJudge = {
      id, label, type: "file-count", critical,
      pattern: assertString(value.pattern, `judges[${index}].pattern`),
      equals: assertOptionalNonNegativeInteger(value.equals, `judges[${index}].equals`),
      min: assertOptionalNonNegativeInteger(value.min, `judges[${index}].min`),
      max: assertOptionalNonNegativeInteger(value.max, `judges[${index}].max`)
    };
    if (judge.equals === undefined && judge.min === undefined && judge.max === undefined) {
      throw new Error(
        `Task pack field "judges[${index}]" for type "file-count" must define equals, min, or max. ` +
        `Example: { "type": "file-count", "pattern": "*.ts", "min": 1, "max": 10 }`
      );
    }
    if (judge.min !== undefined && judge.max !== undefined && judge.min > judge.max) {
      throw new Error(
        `Task pack judge at index ${index}: min (${judge.min}) must be <= max (${judge.max}).`
      );
    }
    return judge;
  },

  "snapshot": (value, index, id, label, critical): SnapshotJudge => ({
    id, label, type: "snapshot", critical,
    path: assertString(value.path, `judges[${index}].path`),
    snapshotPath: assertString(value.snapshotPath, `judges[${index}].snapshotPath`)
  }),

  "json-schema": (value, index, id, label, critical): JsonSchemaJudge => {
    const schema = value.schema === undefined ? undefined : assertObject(value.schema, `judges[${index}].schema`);
    const schemaPath = assertOptionalString(value.schemaPath, `judges[${index}].schemaPath`);
    if (!schema && !schemaPath) {
      throw new Error(
        `Task pack field "judges[${index}]" for type "json-schema" must define schema or schemaPath. ` +
        `Example with inline schema: { "type": "json-schema", "path": "data.json", "schema": { "type": "object" } } ` +
        `Example with schema file: { "type": "json-schema", "path": "data.json", "schemaPath": "schema.json" }`
      );
    }
    return {
      id, label, type: "json-schema", critical,
      path: assertString(value.path, `judges[${index}].path`),
      schema,
      schemaPath
    };
  },

  "patch-validation": (value, index, id, label, critical): PatchValidationJudge => ({
    id, label, type: "patch-validation", critical,
    testSuite: assertString(value.testSuite, `judges[${index}].testSuite`),
    failToPassTests: assertStringArray(value.failToPassTests, `judges[${index}].failToPassTests`),
    passToPassTests: assertStringArray(value.passToPassTests, `judges[${index}].passToPassTests`),
    command: assertOptionalString(value.command, `judges[${index}].command`) ?? "",
    cwd: assertOptionalString(value.cwd, `judges[${index}].cwd`),
    timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `judges[${index}].timeoutMs`),
    envAllowList: assertStringArray(value.envAllowList, `judges[${index}].envAllowList`),
    env: assertStringRecord(value.env, `judges[${index}].env`)
  }),

  "token-efficiency": (value, index, id, label, critical): TokenEfficiencyJudge => ({
    id, label, type: "token-efficiency", critical,
    tokenBudget: assertOptionalPositiveInteger(value.tokenBudget, `judges[${index}].tokenBudget`)
  }),

  "directory-exists": (value, index, id, label, critical): DirectoryExistsJudge => ({
    id, label, type: "directory-exists", critical,
    path: assertString(value.path, `judges[${index}].path`)
  }),

  "regex-match": (value, index, id, label, critical): RegexMatchJudge => {
    const judge: RegexMatchJudge = {
      id, label, type: "regex-match", critical,
      path: assertString(value.path, `judges[${index}].path`),
      pattern: assertString(value.pattern, `judges[${index}].pattern`),
      flags: assertOptionalString(value.flags, `judges[${index}].flags`),
      shouldNotMatch: assertOptionalBoolean(value.shouldNotMatch, `judges[${index}].shouldNotMatch`),
      minMatches: assertOptionalNonNegativeInteger(value.minMatches, `judges[${index}].minMatches`),
      maxMatches: assertOptionalNonNegativeInteger(value.maxMatches, `judges[${index}].maxMatches`)
    };
    if (judge.minMatches !== undefined && judge.maxMatches !== undefined && judge.maxMatches > 0 && judge.minMatches > judge.maxMatches) {
      throw new Error(
        `Task pack judge at index ${index}: minMatches (${judge.minMatches}) must be <= maxMatches (${judge.maxMatches}).`
      );
    }
    return judge;
  },

  "compilation": (value, index, id, label, critical): CompilationJudge => {
    const validTools = ["auto", "npm", "pnpm", "yarn", "cargo", "go", "make", "gradle", "maven"];
    const tool = assertOptionalString(value.tool, `judges[${index}].tool`) as CompilationJudge["tool"] | undefined;
    if (tool && !validTools.includes(tool)) {
      throw new Error(
        `Task pack judge at index ${index}: invalid compilation tool "${tool}". ` +
        `Valid options: ${validTools.join(", ")}.`
      );
    }
    const command = assertOptionalString(value.command, `judges[${index}].command`);
    const cwd = assertOptionalString(value.cwd, `judges[${index}].cwd`);
    const timeoutMs = assertOptionalPositiveInteger(value.timeoutMs, `judges[${index}].timeoutMs`);
    const envAllowList = assertStringArray(value.envAllowList, `judges[${index}].envAllowList`);
    const env = assertStringRecord(value.env, `judges[${index}].env`);
    const buildArgs = assertStringArray(value.buildArgs, `judges[${index}].buildArgs`);
    return {
      id, label, type: "compilation", critical,
      ...(command ? { command } : {}),
      ...(cwd ? { cwd } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(envAllowList.length > 0 ? { envAllowList } : {}),
      ...(env ? { env } : {}),
      ...(tool ? { tool } : {}),
      ...(buildArgs.length > 0 ? { buildArgs } : {})
    };
  }
};
