import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type CommandExecutionSpec,
  judgeTypeRegistry,
  TASK_PACK_SCHEMA_V1,
  type TaskJudge,
  type TaskPack,
  type TaskPackMetadata,
  validateTaskPackId,
} from "@agentarena/core";
import { parse as parseYaml } from "yaml";

import {
  assertObject,
  assertOptionalNonNegativeInteger,
  assertOptionalNumber,
  assertOptionalString,
  assertString,
  assertStringArray,
  assertStringRecord,
} from "./assert.js";
import { JUDGE_NORMALIZERS } from "./normalizers.js";

// Re-export for external consumers
export { JUDGE_NORMALIZERS } from "./normalizers.js";

function normalizeMetadata(value: unknown): TaskPackMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  const metadata = assertObject(value, "metadata");
  const source = assertString(metadata.source, "metadata.source");
  if (source !== "official" && source !== "community") {
    throw new Error(
      `Task pack field "metadata.source" must be "official" or "community". ` +
      `Received: "${source}".`
    );
  }

  const difficulty = assertOptionalString(metadata.difficulty, "metadata.difficulty");
  if (difficulty !== undefined && !["easy", "medium", "hard"].includes(difficulty)) {
    throw new Error(
      `Task pack field "metadata.difficulty" must be "easy", "medium", or "hard". ` +
      `Received: "${difficulty}".`
    );
  }

  const interactionModel = assertOptionalString(metadata.interactionModel, "metadata.interactionModel");
  if (interactionModel !== undefined && !["single-turn", "multi-turn"].includes(interactionModel)) {
    throw new Error(
      `Task pack field "metadata.interactionModel" must be "single-turn" or "multi-turn". ` +
      `Received: "${interactionModel}".`
    );
  }

  const requirementClarity = assertOptionalString(metadata.requirementClarity, "metadata.requirementClarity");
  if (requirementClarity !== undefined && !["precise", "fuzzy", "ambiguous"].includes(requirementClarity)) {
    throw new Error(
      `Task pack field "metadata.requirementClarity" must be "precise", "fuzzy", or "ambiguous". ` +
      `Received: "${requirementClarity}".`
    );
  }

  return {
    source: source as "official" | "community",
    owner: assertString(metadata.owner, "metadata.owner"),
    difficulty: difficulty as "easy" | "medium" | "hard" | undefined,
    objective: assertOptionalString(metadata.objective, "metadata.objective"),
    repoTypes: assertStringArray(metadata.repoTypes, "metadata.repoTypes"),
    tags: assertStringArray(metadata.tags, "metadata.tags"),
    dependencies: assertStringArray(metadata.dependencies, "metadata.dependencies"),
    judgeRationale: assertOptionalString(metadata.judgeRationale, "metadata.judgeRationale"),
    differentiator: assertOptionalString(metadata.differentiator, "metadata.differentiator"),
    githubIssue: metadata.githubIssue === undefined ? undefined : normalizeGithubIssue(metadata.githubIssue),
    failToPassTests: assertStringArray(metadata.failToPassTests, "metadata.failToPassTests"),
    passToPassTests: assertStringArray(metadata.passToPassTests, "metadata.passToPassTests"),
    tokenBudget: (() => {
      const val = assertOptionalNumber(metadata.tokenBudget, "metadata.tokenBudget");
      if (val !== undefined && val <= 0) {
        throw new Error(
          `Task pack field "metadata.tokenBudget" must be a positive number. ` +
          `Received: ${val}.`
        );
      }
      return val;
    })(),
    efficiencyTarget: assertOptionalNumber(metadata.efficiencyTarget, "metadata.efficiencyTarget"),
    interactionModel: interactionModel as "single-turn" | "multi-turn" | undefined,
    requirementClarity: requirementClarity as "precise" | "fuzzy" | "ambiguous" | undefined,
    taskCategories: assertStringArray(metadata.taskCategories, "metadata.taskCategories"),
    antiContamination: metadata.antiContamination === undefined ? undefined : normalizeAntiContamination(metadata.antiContamination),
    difficultyEvolution: metadata.difficultyEvolution === undefined ? undefined : normalizeDifficultyEvolution(metadata.difficultyEvolution)
  };
}

function normalizeGithubIssue(value: unknown): NonNullable<TaskPackMetadata["githubIssue"]> {
  const obj = assertObject(value, "metadata.githubIssue");
  return {
    owner: assertOptionalString(obj.owner, "metadata.githubIssue.owner") ?? "",
    repo: assertOptionalString(obj.repo, "metadata.githubIssue.repo") ?? "",
    issueNumber: assertOptionalNonNegativeInteger(obj.issueNumber, "metadata.githubIssue.issueNumber") ?? assertOptionalNonNegativeInteger(obj.number, "metadata.githubIssue.number") ?? 0,
    baseCommit: assertOptionalString(obj.baseCommit, "metadata.githubIssue.baseCommit") ?? "",
    testCommit: assertOptionalString(obj.testCommit, "metadata.githubIssue.testCommit") ?? "",
    patchPath: assertOptionalString(obj.patchPath, "metadata.githubIssue.patchPath")
  };
}

function normalizeAntiContamination(value: unknown): NonNullable<TaskPackMetadata["antiContamination"]> {
  const obj = assertObject(value, "metadata.antiContamination");
  return {
    rotationId: assertString(obj.rotationId, "metadata.antiContamination.rotationId"),
    createdAt: assertString(obj.createdAt, "metadata.antiContamination.createdAt"),
    expiresAt: assertOptionalString(obj.expiresAt, "metadata.antiContamination.expiresAt"),
    sourceTimestamp: assertOptionalString(obj.sourceTimestamp, "metadata.antiContamination.sourceTimestamp")
  };
}

function normalizeDifficultyEvolution(value: unknown): NonNullable<TaskPackMetadata["difficultyEvolution"]> {
  const obj = assertObject(value, "metadata.difficultyEvolution");
  return {
    generation: assertOptionalNonNegativeInteger(obj.generation, "metadata.difficultyEvolution.generation") ?? 0,
    predecessorTaskId: assertOptionalString(obj.predecessorTaskId, "metadata.difficultyEvolution.predecessorTaskId")
  };
}

// Helper for normalizer to access assertOptionalBoolean
function assertOptionalBooleanLocal(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(
      `Task pack field "${label}" must be a boolean. Received type: ${typeof value}.`
    );
  }
  return value;
}

function normalizeJudge(
  value: Record<string, unknown>,
  index: number,
  defaultIdPrefix: string
): TaskJudge {
  const rawType = value.type;
  const type = rawType === undefined || rawType === null ? "command" : String(rawType);

  const descriptor = judgeTypeRegistry.get(type);
  if (descriptor) {
    const unknownFields = Object.keys(value).filter((key) => !descriptor.allowedFields.has(key));
    if (unknownFields.length > 0) {
      throw new Error(
        `Judge "${type}" at index ${index} contains ${unknownFields.length} unrecognized field(s): ` +
        `"${unknownFields.join('", "')}". ` +
        `Allowed fields: ${Array.from(descriptor.allowedFields).sort().join(", ")}.`
      );
    }
  }

  const id =
    assertOptionalString(value.id, `judges[${index}].id`) ??
    `${defaultIdPrefix}-${index + 1}`;
  const label = assertString(value.label, `judges[${index}].label`);
  const critical = value.critical === undefined
    ? (descriptor?.isCriticalByDefault ?? false)
    : (assertOptionalBooleanLocal(value.critical, `judges[${index}].critical`) ?? false);

  const normalizer = JUDGE_NORMALIZERS[type];
  if (normalizer) {
    return normalizer(value, index, id, label, critical);
  }

  const supportedTypes = judgeTypeRegistry.getAllTypes();
  throw new Error(
    `Task pack judge at index ${index} has unsupported type "${String(type)}". ` +
    `Supported types: ${supportedTypes.join(", ")}.`
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
    timeoutMs: assertOptionalNonNegativeInteger(value.timeoutMs, `${fieldName}[${index}].timeoutMs`),
    envAllowList: assertStringArray(value.envAllowList, `${fieldName}[${index}].envAllowList`),
    env: assertStringRecord(value.env, `${fieldName}[${index}].env`)
  };
}

export async function loadTaskPack(taskPath: string): Promise<TaskPack> {
  const resolvedPath = path.resolve(taskPath);
  const extension = path.extname(resolvedPath).toLowerCase();

  if (![".json", ".yaml", ".yml"].includes(extension)) {
    throw new Error(
      `AgentArena task packs must use .json, .yaml, or .yml extensions. ` +
      `Received file: "${path.basename(taskPath)}" with extension "${extension}".`
    );
  }

  let rawContent: string;
  try {
    rawContent = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT") {
      throw new Error(`Task pack file not found: "${resolvedPath}".`);
    }
    if (errorCode === "EACCES") {
      throw new Error(`Permission denied reading task pack file: "${resolvedPath}".`);
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
  if (!validateTaskPackId(taskId)) {
    throw new Error(
      `Task pack ID "${taskId}" is invalid. ` +
      `IDs must be 1-64 lowercase alphanumeric characters with optional hyphens, starting and ending with an alphanumeric character.`
    );
  }

  const schemaVersion = parsed.schemaVersion === undefined
    ? TASK_PACK_SCHEMA_V1
    : assertString(parsed.schemaVersion, "schemaVersion");

  if (schemaVersion !== TASK_PACK_SCHEMA_V1) {
    throw new Error(
      `Unsupported task pack schema version "${schemaVersion}". Expected: "${TASK_PACK_SCHEMA_V1}".`
    );
  }

  const ALLOWED_TOP_LEVEL_FIELDS = new Set([
    "schemaVersion", "id", "title", "description", "prompt", "metadata",
    "repoSource", "expectedChangedPaths", "envAllowList", "setupCommands",
    "judges", "teardownCommands", "successCommands"
  ]);

  const unknownFields = Object.keys(parsed).filter((key) => !ALLOWED_TOP_LEVEL_FIELDS.has(key));
  if (unknownFields.length > 0) {
    console.warn(
      `Task pack contains ${unknownFields.length} unrecognized top-level field(s): ` +
      `"${unknownFields.join('", "')}". These fields will be ignored.`
    );
  }

  if (parsed.judges !== undefined && parsed.judges !== null && !Array.isArray(parsed.judges)) {
    throw new Error(
      `Task pack field "judges" must be an array. Received type: ${typeof parsed.judges}.`
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
      return normalizeCommandSpec(value as Record<string, unknown>, index, "teardownCommands", `${taskId}-teardown`);
    })
  };
}

/**
 * Conflict detected between multiple task packs.
 */
export interface TaskPackConflict {
  taskPackIds: string[];
  type: "duplicate-id" | "conflicting-setup" | "conflicting-teardown" | "env-allowlist-mismatch";
  message: string;
}

/**
 * Detect potential conflicts when combining multiple task packs.
 */
export function detectTaskPackConflicts(taskPacks: Array<{ id: string; setupCommands: Array<{ id: string; command: string }>; teardownCommands: Array<{ id: string; command: string }>; envAllowList: string[] }>): TaskPackConflict[] {
  const conflicts: TaskPackConflict[] = [];
  const idCounts = new Map<string, string[]>();
  for (const pack of taskPacks) {
    const existing = idCounts.get(pack.id) ?? [];
    existing.push(pack.id);
    idCounts.set(pack.id, existing);
  }
  for (const [, ids] of idCounts) {
    if (ids.length > 1) {
      conflicts.push({
        taskPackIds: ids,
        type: "duplicate-id",
        message: `Multiple task packs share the same id. Each task pack must have a unique id.`
      });
    }
  }

  const setupIds = new Map<string, string[]>();
  for (const pack of taskPacks) {
    for (const cmd of pack.setupCommands) {
      const existing = setupIds.get(cmd.id) ?? [];
      existing.push(pack.id);
      setupIds.set(cmd.id, existing);
    }
  }
  for (const [, ids] of setupIds) {
    if (ids.length > 1) {
      conflicts.push({
        taskPackIds: [...new Set(ids)],
        type: "conflicting-setup",
        message: `Setup command id is used by multiple task packs. This may cause unexpected behavior when combined.`
      });
    }
  }

  const teardownIds = new Map<string, string[]>();
  for (const pack of taskPacks) {
    for (const cmd of pack.teardownCommands) {
      const existing = teardownIds.get(cmd.id) ?? [];
      existing.push(pack.id);
      teardownIds.set(cmd.id, existing);
    }
  }
  for (const [, ids] of teardownIds) {
    if (ids.length > 1) {
      conflicts.push({
        taskPackIds: [...new Set(ids)],
        type: "conflicting-teardown",
        message: `Teardown command id is used by multiple task packs. This may cause unexpected behavior when combined.`
      });
    }
  }

  return conflicts;
}
