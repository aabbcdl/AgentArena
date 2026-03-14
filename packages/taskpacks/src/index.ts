import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CommandExecutionSpec,
  CommandJudge,
  FileContainsJudge,
  FileCountJudge,
  FileExistsJudge,
  GlobJudge,
  JsonValueJudge,
  TASK_PACK_SCHEMA_V1,
  TaskJudge,
  TaskPack
} from "@repoarena/core";
import { parse as parseYaml } from "yaml";

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Task pack field "${label}" must be a non-empty string.`);
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

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Task pack field "${label}" must be a positive integer when provided.`);
  }

  return value;
}

function assertOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Task pack field "${label}" must be a boolean when provided.`);
  }

  return value;
}

function assertOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Task pack field "${label}" must be a non-negative integer when provided.`);
  }

  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Task pack field "${label}" must be an array of strings when provided.`);
  }

  return value.map((entry, index) => assertString(entry, `${label}[${index}]`));
}

function assertStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Task pack field "${label}" must be an object of string values when provided.`);
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
    key,
    assertString(entryValue, `${label}.${key}`)
  ]);

  return Object.fromEntries(entries);
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
    if (!Object.prototype.hasOwnProperty.call(value, "expected")) {
      throw new Error(`Task pack field "judges[${index}].expected" is required.`);
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
        `Task pack field "judges[${index}]" for type "file-count" must define equals, min, or max.`
      );
    }

    return judge;
  }

  throw new Error(`Task pack judge at index ${index} has unsupported type "${String(type)}".`);
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
    throw new Error("RepoArena task packs must use .json, .yaml, or .yml extensions.");
  }

  const rawContent = await fs.readFile(resolvedPath, "utf8");
  const parsed =
    extension === ".json"
      ? (JSON.parse(rawContent) as Record<string, unknown>)
      : (parseYaml(rawContent) as Record<string, unknown>);
  const taskId = assertString(parsed.id, "id");
  const schemaVersion =
    parsed.schemaVersion === undefined
      ? TASK_PACK_SCHEMA_V1
      : assertString(parsed.schemaVersion, "schemaVersion");

  if (schemaVersion !== TASK_PACK_SCHEMA_V1) {
    throw new Error(`Unsupported task pack schema version "${schemaVersion}".`);
  }

  const judgesInput = Array.isArray(parsed.judges)
    ? parsed.judges
    : Array.isArray(parsed.successCommands)
      ? parsed.successCommands
      : [];
  const setupCommandsInput = Array.isArray(parsed.setupCommands) ? parsed.setupCommands : [];
  const teardownCommandsInput = Array.isArray(parsed.teardownCommands) ? parsed.teardownCommands : [];

  return {
    schemaVersion: TASK_PACK_SCHEMA_V1,
    id: taskId,
    title: assertString(parsed.title, "title"),
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    prompt: assertString(parsed.prompt, "prompt"),
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
