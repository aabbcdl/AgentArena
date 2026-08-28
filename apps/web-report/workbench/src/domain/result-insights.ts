import type { NormalizedAgentResult, NormalizedRun } from "./run";

export type RuntimeEvidence = "confirmed" | "declared" | "inferred" | "unknown";
export type EvidenceLevel = "strong" | "adequate" | "limited" | "insufficient";

function runtimeRecord(result: NormalizedAgentResult): Record<string, unknown> {
  return result.resolvedRuntime ?? {};
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAdhocTask(run: NormalizedRun): boolean {
  const task = run.raw.task;
  if (!task || typeof task !== "object" || Array.isArray(task)) return false;
  const metadata = (task as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const tags = (metadata as { tags?: unknown }).tags;
  return Array.isArray(tags) && tags.some((tag) => tag === "adhoc" || tag === "custom");
}

export function runtimeText(result: NormalizedAgentResult, key: string): string | null {
  return nonEmpty(runtimeRecord(result)[key]);
}

export function runtimeEvidence(result: NormalizedAgentResult, field: "model" | "reasoning"): RuntimeEvidence {
  const runtime = runtimeRecord(result);
  const value = field === "model" ? runtime.effectiveModel : runtime.effectiveReasoningEffort;
  if (!nonEmpty(value)) return "unknown";
  const explicit = runtime[field === "model" ? "modelIdentitySource" : "reasoningEffortSource"];
  if (explicit === "confirmed" || explicit === "declared" || explicit === "inferred" || explicit === "unknown") {
    return explicit;
  }
  if (runtime.source === "event-stream") return "confirmed";
  if (["ui", "profile-config", "codex-config", "cli"].includes(String(runtime.source))) return "declared";
  if (runtime.source === "env" || runtime.source === "cli-default") return "inferred";
  return "unknown";
}

export function taskDifficulty(run: NormalizedRun): "easy" | "medium" | "hard" | null {
  return run.task.difficulty;
}

export interface ResultEvidenceAssessment {
  level: EvidenceLevel;
  reasons: string[];
  comparable: boolean;
}

/**
 * Separate "the judges passed" from "this is convincing evidence of model
 * quality". A single easy task with an unknown model is intentionally limited.
 */
export function assessResultEvidence(run: NormalizedRun, result: NormalizedAgentResult): ResultEvidenceAssessment {
  const reasons: string[] = [];
  const basicGeneratedEvidence = isAdhocTask(run);
  const difficulty = taskDifficulty(run);
  if (difficulty === "easy") reasons.push("easy-task");
  if (run.results.length < 2) reasons.push("single-sample");
  if (runtimeEvidence(result, "model") === "unknown") reasons.push("model-unknown");
  if (result.costQuality === "unavailable") reasons.push("cost-unavailable");
  if (result.raw.tokenUsageReliable === false) reasons.push("tokens-unreliable");
  if (result.traceAvailability !== "available") reasons.push("trace-missing");
  if (basicGeneratedEvidence) reasons.push("basic-generated-checks");
  const judgeCount = result.judgeResults.length;
  const passed = result.judgeResults.filter((judge) => judge.success).length;
  if (judgeCount === 0) reasons.push("no-judges");
  if (result.status !== "success" || result.scoreExcluded) reasons.push("not-qualified");

  let level: EvidenceLevel = "strong";
  if (result.status !== "success" || result.scoreExcluded || judgeCount === 0 || run.integrity === "damaged") {
    level = "insufficient";
  } else if (passed < judgeCount || run.integrity !== "complete") {
    level = "limited";
  } else if (reasons.length > 0) {
    level = "adequate";
  }
  if (basicGeneratedEvidence && level === "strong") level = "limited";

  return {
    level,
    reasons,
    comparable: !basicGeneratedEvidence
      && Boolean(run.fairComparison)
      && run.results.length > 1
      && runtimeEvidence(result, "model") !== "unknown"
  };
}

export function formatTokenCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US");
}
