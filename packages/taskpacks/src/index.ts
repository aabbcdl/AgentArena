import { promises as fs } from "node:fs";
import path from "node:path";
import { CommandExecutionSpec, CommandJudge, TASK_PACK_SCHEMA_V1, TaskPack } from "@repoarena/core";

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

function assertStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Task pack field "${label}" must be an array of strings when provided.`);
  }

  return value.map((entry, index) => assertString(entry, `${label}[${index}]`));
}

function normalizeJudge(
  value: Record<string, unknown>,
  index: number,
  defaultIdPrefix: string
): CommandJudge {
  const type = value.type === undefined ? "command" : value.type;
  if (type !== "command") {
    throw new Error(`Task pack judge at index ${index} has unsupported type "${String(type)}".`);
  }

  return {
    id:
      assertOptionalString(value.id, `judges[${index}].id`) ??
      `${defaultIdPrefix}-${index + 1}`,
    label: assertString(value.label, `judges[${index}].label`),
    type: "command",
    command: assertString(value.command, `judges[${index}].command`),
    cwd: assertOptionalString(value.cwd, `judges[${index}].cwd`),
    timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `judges[${index}].timeoutMs`)
  };
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
    timeoutMs: assertOptionalPositiveInteger(value.timeoutMs, `${fieldName}[${index}].timeoutMs`)
  };
}

export async function loadTaskPack(taskPath: string): Promise<TaskPack> {
  const resolvedPath = path.resolve(taskPath);
  const extension = path.extname(resolvedPath).toLowerCase();

  if (extension !== ".json") {
    throw new Error("This initial slice supports JSON task packs only.");
  }

  const rawContent = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(rawContent) as Record<string, unknown>;
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
