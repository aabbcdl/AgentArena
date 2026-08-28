import { createHash } from "node:crypto";
import type { FairComparisonMetadata, TaskPack } from "./types/index.js";

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function identity(prefix: "task" | "judge" | "repo", value: unknown): string {
  return `${prefix}:${createHash("sha256").update(stableSerialize(value)).digest("hex")}`;
}

export function createFairComparisonMetadata(
  task: TaskPack,
  repositoryBaseline: string
): FairComparisonMetadata {
  const { judges, ...taskDefinition } = task;
  return {
    taskIdentity: identity("task", taskDefinition),
    judgeIdentity: identity("judge", judges),
    repoBaselineIdentity: identity("repo", repositoryBaseline)
  };
}
