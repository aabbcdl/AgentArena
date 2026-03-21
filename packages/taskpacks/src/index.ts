import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type CommandExecutionSpec,
  type CommandJudge,
  type FileContainsJudge,
  type FileCountJudge,
  type FileExistsJudge,
  type GlobJudge,
  type JsonSchemaJudge,
  type JsonValueJudge,
  type LintCheckJudge,
  type SnapshotJudge,
  TASK_PACK_SCHEMA_V1,
  type TaskJudge,
  type TaskPack, 
  type TaskPackMetadata,
  type TestResultJudge
} from "@repoarena/core";
import { parse as parseYaml } from "yaml";

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `Task pack field "${label}" must be a string. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": "my-value"`
    );
  }
  if (value.trim().length === 0) {
    throw new Error(
      `Task pack field "${label}" must be a non-empty string. ` +
      `Received empty or whitespace-only string. ` +
      `Example: "${label}": "my-value"`
    );
  }
  return value;
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertString(value, label);
}

function assertOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(
      `Task pack field "${label}" must be a number. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": 1000`
    );
  }
  if (!Number.isInteger(value)) {
    throw new Error(
      `Task pack field "${label}" must be an integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 1000`
    );
  }
  if (value <= 0) {
    throw new Error(
      `Task pack field "${label}" must be a positive integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 1000`
    );
  }
  return value;
}

function assertOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(
      `Task pack field "${label}" must be a boolean. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": true`
    );
  }
  return value;
}

function assertOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(
      `Task pack field "${label}" must be a number. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": 0`
    );
  }
  if (!Number.isInteger(value)) {
    throw new Error(
      `Task pack field "${label}" must be an integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 0`
    );
  }
  if (value < 0) {
    throw new Error(
      `Task pack field "${label}" must be a non-negative integer. ` +
      `Received: ${value}. ` +
      `Example: "${label}": 0`
    );
  }
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Task pack field "${label}" must be an array. ` +
      `Received type: ${typeof value}. ` +
      `Example: "${label}": ["value1", "value2"]`
    );
  }
  return value.map((entry, index) => assertString(entry, `${label}[${index}]`));
}

function assertStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Task pack field "${label}" must be an object. ` +
      `Received type: ${Array.isArray(value) ? "array" : typeof value}. ` +
      `Example: "${label}": { "KEY": "value" }`
    );
  }
  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
    key,
    assertString(entryValue, `${label}.${key}`)
  ]);
  return Object.fromEntries(entries);
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Task pack field "${label}" must be an object. ` +
      `Received type: ${Array.isArray(value) ? "array" : typeof value}. ` +
      `Example: "${label}": { "key": "value" }`
    );
  }
  return value as Record<string, unknown>;
}

function normalizeMetadata(value: unknown): TaskPackMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  const metadata = assertObject(value, "metadata");
  const source = assertString(metadata.source, "metadata.source");
  if (source !== "official" && source !== "community") {
    throw new Error(
      `Task pack field "metadata.source" must be "official" or "community". ` +
      `Received: "${source}". ` +
      `Example: "metadata": { "source": "official", "owner": "RepoArena" }`
    );
  }

  const difficulty = assertOptionalString(metadata.difficulty, "metadata.difficulty");
  if (difficulty !== undefined && !["easy", "medium", "hard"].includes(difficulty)) {
    throw new Error(
      `Task pack field "metadata.difficulty" must be "easy", "medium", or "hard". ` +
      `Received: "${difficulty}".`
    );
  }

  return {
    source,
    owner: assertString(metadata.owner, "metadata.owner"),
    difficulty: difficulty as "easy" | "medium" | "hard" | undefined,
    objective: assertOptionalString(metadata.objective, "metadata.objective"),
    repoTypes: assertStringArray(metadata.repoTypes, "metadata.repoTypes"),
    tags: assertStringArray(metadata.tags, "metadata.tags"),
    dependencies: assertStringArray(metadata.dependencies, "metadata.dependencies"),
    judgeRationale: assertOptionalString(metadata.judgeRationale, "metadata.judgeRationale"),
    differentiator: assertOptionalString(metadata.differentiator, "metadata.differentiator")
  };
}

function normalizeJudge(
  value: Record<string, unknown>,
  index: number,
  defaultIdPrefix: string
): TaskJudge {
  const type = value.type === undefined ? "command" : value.type;
  const id =
    assertOptionalString(value.id, `judges[${index}].id`) ??
    `${defaultIdPrefix}-${index + 1}`;
  const label = assertString(value.label, `judges[${index}].label`);

  if (type === "command") {
    const judge: CommandJudge = {
      id,
      label,
      type: "command",
      command: assertString(value.command, `judges[${index}].command`),
      cwd: assertOptionalString(value.cwd, `judges[${index}].cwd`),
      timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `judges[${index}].timeoutMs`),
      envAllowList: assertStringArray(value.envAllowList, `judges[${index}].envAllowList`),
      env: assertStringRecord(value.env, `judges[${index}].env`)
    };
    return judge;
  }

  if (type === "test-result") {
    const judge: TestResultJudge = {
      id,
      label,
      type: "test-result",
      command: assertString(value.command, `judges[${index}].command`),
      cwd: assertOptionalString(value.cwd, `judges[${index}].cwd`),
      timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `judges[${index}].timeoutMs`),
      envAllowList: assertStringArray(value.envAllowList, `judges[${index}].envAllowList`),
      env: assertStringRecord(value.env, `judges[${index}].env`),
      format: (assertOptionalString(value.format, `judges[${index}].format`) as TestResultJudge["format"] | undefined) ?? "auto",
      reportFile: assertOptionalString(value.reportFile, `judges[${index}].reportFile`),
      passOnNoTests: assertOptionalBoolean(value.passOnNoTests, `judges[${index}].passOnNoTests`)
    };
    return judge;
  }

  if (type === "lint-check") {
    const judge: LintCheckJudge = {
      id,
      label,
      type: "lint-check",
      command: assertString(value.command, `judges[${index}].command`),
      cwd: assertOptionalString(value.cwd, `judges[${index}].cwd`),
      timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `judges[${index}].timeoutMs`),
      envAllowList: assertStringArray(value.envAllowList, `judges[${index}].envAllowList`),
      env: assertStringRecord(value.env, `judges[${index}].env`),
      format: (assertOptionalString(value.format, `judges[${index}].format`) as LintCheckJudge["format"] | undefined) ?? "auto",
      reportFile: assertOptionalString(value.reportFile, `judges[${index}].reportFile`),
      maxWarnings: assertOptionalNonNegativeInteger(value.maxWarnings, `judges[${index}].maxWarnings`)
    };
    return judge;
  }

  if (type === "file-exists") {
    const judge: FileExistsJudge = {
      id,
      label,
      type: "file-exists",
      path: assertString(value.path, `judges[${index}].path`)
    };
    return judge;
  }

  if (type === "file-contains") {
    const judge: FileContainsJudge = {
      id,
      label,
      type: "file-contains",
      path: assertString(value.path, `judges[${index}].path`),
      pattern: assertString(value.pattern, `judges[${index}].pattern`),
      regex: assertOptionalBoolean(value.regex, `judges[${index}].regex`),
      flags: assertOptionalString(value.flags, `judges[${index}].flags`)
    };
    return judge;
  }

  if (type === "json-value") {
    if (!Object.hasOwn(value, "expected")) {
      throw new Error(
        `Task pack field "judges[${index}].expected" is required for type "json-value". ` +
        `Example: { "type": "json-value", "path": "data.json", "pointer": "/status", "expected": "ready" }`
      );
    }

    const judge: JsonValueJudge = {
      id,
      label,
      type: "json-value",
      path: assertString(value.path, `judges[${index}].path`),
      pointer: assertString(value.pointer, `judges[${index}].pointer`),
      expected: value.expected
    };
    return judge;
  }

  if (type === "glob") {
    const judge: GlobJudge = {
      id,
      label,
      type: "glob",
      pattern: assertString(value.pattern, `judges[${index}].pattern`),
      minMatches: assertOptionalNonNegativeInteger(value.minMatches, `judges[${index}].minMatches`),
      maxMatches: assertOptionalNonNegativeInteger(value.maxMatches, `judges[${index}].maxMatches`)
    };
    return judge;
  }

  if (type === "file-count") {
    const judge: FileCountJudge = {
      id,
      label,
      type: "file-count",
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

    return judge;
  }

  if (type === "snapshot") {
    const judge: SnapshotJudge = {
      id,
      label,
      type: "snapshot",
      path: assertString(value.path, `judges[${index}].path`),
      snapshotPath: assertString(value.snapshotPath, `judges[${index}].snapshotPath`)
    };
    return judge;
  }

  if (type === "json-schema") {
    const schema = value.schema === undefined ? undefined : assertObject(value.schema, `judges[${index}].schema`);
    const schemaPath = assertOptionalString(value.schemaPath, `judges[${index}].schemaPath`);
    if (!schema && !schemaPath) {
      throw new Error(
        `Task pack field "judges[${index}]" for type "json-schema" must define schema or schemaPath. ` +
        `Example with inline schema: { "type": "json-schema", "path": "data.json", "schema": { "type": "object" } } ` +
        `Example with schema file: { "type": "json-schema", "path": "data.json", "schemaPath": "schema.json" }`
      );
    }

    const judge: JsonSchemaJudge = {
      id,
      label,
      type: "json-schema",
      path: assertString(value.path, `judges[${index}].path`),
      schema,
      schemaPath
    };
    return judge;
  }

  const supportedTypes = [
    "command",
    "test-result",
    "lint-check",
    "file-exists",
    "file-contains",
    "json-value",
    "glob",
    "file-count",
    "snapshot",
    "json-schema"
  ];
  throw new Error(
    `Task pack judge at index ${index} has unsupported type "${String(type)}". ` +
    `Supported types: ${supportedTypes.join(", ")}. ` +
    `Example: { "type": "file-exists", "label": "README exists", "path": "README.md" }`
  );
}

function normalizeCommandSpec(
  value: Record<string, unknown>,
  index: number,
  fieldName: "setupCommands" | "teardownCommands",
  defaultIdPrefix: string
): CommandExecutionSpec {
  return {
    id:
      assertOptionalString(value.id, `${fieldName}[${index}].id`) ??
      `${defaultIdPrefix}-${index + 1}`,
    label: assertString(value.label, `${fieldName}[${index}].label`),
    command: assertString(value.command, `${fieldName}[${index}].command`),
    cwd: assertOptionalString(value.cwd, `${fieldName}[${index}].cwd`),
    timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `${fieldName}[${index}].timeoutMs`),
    envAllowList: assertStringArray(value.envAllowList, `${fieldName}[${index}].envAllowList`),
    env: assertStringRecord(value.env, `${fieldName}[${index}].env`)
  };
}

export async function loadTaskPack(taskPath: string): Promise<TaskPack> {
  const resolvedPath = path.resolve(taskPath);
  const extension = path.extname(resolvedPath).toLowerCase();

  if (![".json", ".yaml", ".yml"].includes(extension)) {
    throw new Error(
      `RepoArena task packs must use .json, .yaml, or .yml extensions. ` +
      `Received file: "${path.basename(taskPath)}" with extension "${extension}". ` +
      `Example: "my-task.yaml" or "my-task.json"`
    );
  }

  let rawContent: string;
  try {
    rawContent = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT") {
      throw new Error(
        `Task pack file not found: "${resolvedPath}". ` +
        `Please check the file path and ensure the file exists.`
      );
    }
    if (errorCode === "EACCES") {
      throw new Error(
        `Permission denied reading task pack file: "${resolvedPath}". ` +
        `Please check file permissions.`
      );
    }
    throw new Error(
      `Failed to read task pack file: "${resolvedPath}". ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed =
      extension === ".json"
        ? (JSON.parse(rawContent) as Record<string, unknown>)
        : (parseYaml(rawContent) as Record<string, unknown>);
  } catch (error) {
    throw new Error(
      `Failed to parse task pack file: "${resolvedPath}". ` +
      `The file contains invalid ${extension === ".json" ? "JSON" : "YAML"}. ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const taskId = assertString(parsed.id, "id");
  const schemaVersion =
    parsed.schemaVersion === undefined
      ? TASK_PACK_SCHEMA_V1
      : assertString(parsed.schemaVersion, "schemaVersion");

  if (schemaVersion !== TASK_PACK_SCHEMA_V1) {
    throw new Error(
      `Unsupported task pack schema version "${schemaVersion}". ` +
      `Expected: "${TASK_PACK_SCHEMA_V1}". ` +
      `Please update your task pack to use the current schema version.`
    );
  }

  const judgesInput = Array.isArray(parsed.judges)
    ? parsed.judges
    : Array.isArray(parsed.successCommands)
      ? parsed.successCommands
      : [];
  const setupCommandsInput = Array.isArray(parsed.setupCommands) ? parsed.setupCommands : [];
  const teardownCommandsInput = Array.isArray(parsed.teardownCommands) ? parsed.teardownCommands : [];

  const repoSource = assertOptionalString(parsed.repoSource, "repoSource");

  return {
    schemaVersion: TASK_PACK_SCHEMA_V1,
    id: taskId,
    title: assertString(parsed.title, "title"),
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    prompt: assertString(parsed.prompt, "prompt"),
    metadata: normalizeMetadata(parsed.metadata),
    repoSource,
    expectedChangedPaths: assertStringArray(parsed.expectedChangedPaths, "expectedChangedPaths"),
    envAllowList: assertStringArray(parsed.envAllowList, "envAllowList"),
    setupCommands: setupCommandsInput.map((value, index) => {
      if (!value || typeof value !== "object") {
        throw new Error(`Task pack setup command at index ${index} must be an object.`);
      }

      return normalizeCommandSpec(value as Record<string, unknown>, index, "setupCommands", `${taskId}-setup`);
    }),
    judges: judgesInput.map((value, index) => {
      if (!value || typeof value !== "object") {
        throw new Error(`Task pack judge at index ${index} must be an object.`);
      }

      return normalizeJudge(value as Record<string, unknown>, index, taskId);
    }),
    teardownCommands: teardownCommandsInput.map((value, index) => {
      if (!value || typeof value !== "object") {
        throw new Error(`Task pack teardown command at index ${index} must be an object.`);
      }

      return normalizeCommandSpec(
        value as Record<string, unknown>,
        index,
        "teardownCommands",
        `${taskId}-teardown`
      );
    })
  };
}
