import { type CopyKey, copy } from "../i18n.ts";
import type { Locale, TaskPackInfo } from "../types.ts";

export type TaskDifficulty = NonNullable<TaskPackInfo["difficulty"]>;

const reasonKeyByCode: Record<string, CopyKey> = {
  "cost-unknown": "reasonCostUnknown",
  "cost-estimated": "reasonCostEstimated",
  "trace-missing": "reasonTraceMissing",
  "trace-incomplete": "reasonTraceIncomplete",
  "legacy-source": "reasonLegacySource",
  "legacy-artifact": "reasonLegacyArtifact",
  "results-invalid": "reasonResultsInvalid",
  "results-missing": "reasonResultsMissing",
  "artifact-invalid": "reasonArtifactInvalid",
  "all-agents-failed": "reasonAllAgentsFailed",
  "token-unreliable": "reasonTokenUnreliable",
  "data-quality-warning": "reasonDataQualityWarning"
};

const executionKeyByCode: Record<string, CopyKey> = {
  completed: "executionCompleted",
  cancelled: "executionCancelled",
  interrupted: "executionInterrupted",
  running: "executionRunning",
  unknown: "executionUnknown"
};

const runStateKeyByCode: Record<string, CopyKey> = {
  idle: "runStateIdle",
  running: "runStateRunning",
  done: "runStateDone",
  error: "runStateError",
  cancelled: "runStateCancelled",
  cancelling: "runStateCancelling"
};

const phaseKeyByCode: Record<string, CopyKey> = {
  idle: "phaseIdle",
  starting: "phaseStarting",
  preflight: "phasePreflight",
  benchmark: "phaseBenchmark",
  report: "phaseReport",
  done: "phaseDone"
};

const preflightKeyByCode: Record<string, CopyKey> = {
  ready: "preflightReady",
  pass: "preflightPass",
  success: "preflightSuccess",
  blocked: "preflightStatusBlocked",
  missing: "preflightMissing",
  error: "preflightError",
  warning: "preflightWarning",
  unknown: "preflightUnknown"
};

function resolve(locale: Locale, map: Record<string, CopyKey>, code: string, fallbackKey?: CopyKey): string {
  const key = map[code] ?? fallbackKey;
  if (key && key in copy[locale]) return copy[locale][key];
  return code;
}

export function labelTrustReason(locale: Locale, reason: string): string {
  return resolve(locale, reasonKeyByCode, reason);
}

export function labelExecution(locale: Locale, status: string): string {
  return resolve(locale, executionKeyByCode, status, "executionUnknown");
}

export function labelRunState(locale: Locale, state: string): string {
  return resolve(locale, runStateKeyByCode, state);
}

export function labelPhase(locale: Locale, phase: string): string {
  return resolve(locale, phaseKeyByCode, phase);
}

export function labelPreflightStatus(locale: Locale, status: string): string {
  return resolve(locale, preflightKeyByCode, status, "preflightUnknown");
}

export function isComingSoonAdapter(title: string | undefined): boolean {
  return typeof title === "string" && /coming\s*soon/i.test(title);
}

export function adapterSupportTier(capability: Record<string, unknown> | undefined): string {
  const tier = capability?.supportTier;
  return typeof tier === "string" ? tier : "unknown";
}

export function isBlockedSupportTier(capability: Record<string, unknown> | undefined): boolean {
  return adapterSupportTier(capability) === "blocked";
}

export function labelSupportTier(locale: Locale, tier: string): string {
  const map: Record<string, CopyKey> = {
    supported: "tierSupported",
    experimental: "tierExperimental",
    blocked: "tierBlocked",
    unknown: "tierUnknown"
  };
  return resolve(locale, map, tier, "tierUnknown");
}

export function labelTokenAvailability(locale: Locale, value: string): string {
  const map: Record<string, CopyKey> = {
    available: "capTokensAvailable",
    estimated: "capTokensEstimated",
    unavailable: "capTokensUnavailable"
  };
  return resolve(locale, map, value, "capTokensUnavailable");
}

export function labelCostAvailability(locale: Locale, value: string): string {
  const map: Record<string, CopyKey> = {
    available: "capCostAvailable",
    estimated: "capCostEstimated",
    unavailable: "capCostUnavailable"
  };
  return resolve(locale, map, value, "capCostUnavailable");
}

export function labelTaskDifficulty(locale: Locale, difficulty: TaskDifficulty | undefined): string {
  if (locale === "zh-CN") {
    if (difficulty === "easy") return "简单";
    if (difficulty === "medium") return "中等";
    if (difficulty === "hard") return "困难";
    return "未标注难度";
  }
  if (difficulty === "easy") return "Easy";
  if (difficulty === "medium") return "Medium";
  if (difficulty === "hard") return "Hard";
  return "Difficulty not set";
}

export function taskDifficultyTone(
  difficulty: TaskDifficulty | undefined
): "success" | "info" | "warning" | "neutral" {
  if (difficulty === "easy") return "success";
  if (difficulty === "medium") return "info";
  if (difficulty === "hard") return "warning";
  return "neutral";
}
