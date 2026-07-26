import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  type AgentRunResult,
  type AgentSelection,
  logger, 
  RESULT_ARTIFACT_SCHEMA,
  type ScoreMode,
  type writeJsonAtomic
} from "@agentarena/core";

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

export function repositoryIdentity(repoPath: string): string {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const status = execFileSync("git", ["status", "--porcelain=v1"], { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return `${head}\n${status}`;
  } catch {
    return `non-git:${path.resolve(repoPath)}`;
  }
}

function hashFingerprint(payload: unknown): string {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

export function createRunContractFingerprint(repoPath: string, task: unknown, scoreMode: ScoreMode): string {
  return hashFingerprint({
    schema: "agentarena.run-contract/v1",
    repository: repositoryIdentity(repoPath),
    task,
    scoreMode
  });
}

export function createSelectionFingerprint(selection: Pick<AgentSelection, "baseAgentId" | "variantId" | "displayLabel" | "config">): string {
  return hashFingerprint({
    schema: "agentarena.agent-selection/v1",
    baseAgentId: selection.baseAgentId,
    variantId: selection.variantId,
    displayLabel: selection.displayLabel,
    config: selection.config
  });
}

export function createRunFingerprint(repoPath: string, task: unknown, selections: AgentSelection[], scoreMode: ScoreMode): string {
  return hashFingerprint({
    schema: "agentarena.run-fingerprint/v2",
    contract: createRunContractFingerprint(repoPath, task, scoreMode),
    selections: selections.map(createSelectionFingerprint),
  });
}

export function createResultSelectionFingerprint(result: AgentRunResult): string {
  return createSelectionFingerprint({
    baseAgentId: result.baseAgentId,
    variantId: result.variantId,
    displayLabel: result.displayLabel,
    config: result.requestedConfig
  });
}

export function isAgentRunResult(value: unknown): value is AgentRunResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.variantId === "string" &&
    typeof result.agentId === "string" &&
    (result.status === "success" ||
      result.status === "failed" ||
      result.status === "cancelled")
  );
}

export class AgentResultPersistenceError extends Error {
  constructor(result: AgentRunResult, cause: unknown) {
    super(
      `Failed to persist resumable result for ${result.displayLabel}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
    this.name = "AgentResultPersistenceError";
  }
}

export async function writeAgentResult(outputPath: string, result: AgentRunResult, resultArtifactSchema: string, writeJsonAtomicFn: typeof writeJsonAtomic): Promise<void> {
  const filePath = agentResultPath(outputPath, result.variantId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeJsonAtomicFn(filePath, { artifactSchemaVersion: resultArtifactSchema, ...result });
  } catch (error) {
    throw new AgentResultPersistenceError(result, error);
  }
}

function agentResultPath(outputPath: string, variantId: string): string {
  return path.join(outputPath, "agents", variantId, "result.json");
}

export async function loadResumeState(
  resumeFrom: string | undefined,
  expectedFingerprint?: string,
  expectedContractFingerprint?: string,
): Promise<{ taskId?: string; runFingerprint?: string; runContractFingerprint?: string; results: Map<string, AgentRunResult>; mismatchReason?: string }> {
  const results = new Map<string, AgentRunResult>();
  if (!resumeFrom) {
    return { results };
  }

  let taskId: string | undefined;
  let runFingerprint: string | undefined;
  let runContractFingerprint: string | undefined;
  let mismatchReason: string | undefined;
  try {
    const marker = JSON.parse(
      await fs.readFile(path.join(resumeFrom, "run-state.json"), "utf8"),
    ) as Record<string, unknown>;
    if (typeof marker.taskId === "string") {
      taskId = marker.taskId;
    }
    if (typeof marker.runFingerprint === "string") {
      runFingerprint = marker.runFingerprint;
    }
    if (typeof marker.runContractFingerprint === "string") {
      runContractFingerprint = marker.runContractFingerprint;
    }
  } catch {
    // Older or partial runs may not have a readable marker.
  }

  if (expectedContractFingerprint && runContractFingerprint !== expectedContractFingerprint) {
    mismatchReason = runContractFingerprint
      ? "resume contract fingerprint does not match the current task, repository, or score mode"
      : "resume result has no verifiable contract fingerprint and cannot be checked against the current run";
  } else if (expectedFingerprint && !runFingerprint) {
    mismatchReason = "resume result has no fingerprint and cannot be verified against the current agent selection";
  }

  try {
    const summary = JSON.parse(
      await fs.readFile(path.join(resumeFrom, "summary.json"), "utf8"),
    ) as { task?: { id?: string }; results?: AgentRunResult[] };
    if (typeof summary.task?.id === "string") {
      taskId = summary.task.id;
    }
    if (!mismatchReason) {
      for (const result of summary.results ?? []) {
        if (isAgentRunResult(result) && result.status !== "cancelled") {
          results.set(result.variantId, result);
        }
      }
    }
  } catch {
    // Interrupted runs may not have reached report generation.
  }

  try {
    const agentsDir = path.join(resumeFrom, "agents");
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const resultPath = path.join(agentsDir, entry.name, "result.json");
      let rawResult: string;
      try {
        rawResult = await fs.readFile(resultPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
          continue;
        }
        throw new Error(
          `Cannot resume agent "${entry.name}": result file could not be read. Refusing to rerun completed work silently.`,
          { cause: error }
        );
      }

      let result: unknown;
      try {
        result = JSON.parse(rawResult) as unknown;
      } catch (error) {
        throw new Error(
          `Cannot resume agent "${entry.name}": result file is corrupt or malformed. Refusing to rerun completed work silently.`,
          { cause: error }
        );
      }
      if (!isAgentRunResult(result) || result.variantId !== entry.name) {
        throw new Error(
          `Cannot resume agent "${entry.name}": result file has an invalid shape or mismatched variant id. Refusing to rerun completed work silently.`
        );
      }
      if (!mismatchReason && result.status !== "cancelled") {
        results.set(result.variantId, result);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
    // No per-agent result directory yet.
  }

  return { taskId, runFingerprint, runContractFingerprint, results, mismatchReason };
}