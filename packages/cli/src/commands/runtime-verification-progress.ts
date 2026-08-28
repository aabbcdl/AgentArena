import type {
  RuntimeReadiness,
  VerificationReceipt,
  VerificationStageResult
} from "@agentarena/core";

export type RuntimeVerificationProgressStageStatus = "pending" | "running" | VerificationStageResult["status"];

export interface RuntimeVerificationProgressStage {
  stage: VerificationStageResult["stage"];
  status: RuntimeVerificationProgressStageStatus;
  startedAt: string;
  durationMs: number;
  exitCode?: number | null;
  errorCategory?: VerificationStageResult["errorCategory"];
  summary: string;
  details?: string[];
}

export interface RuntimeVerificationProgress {
  progressId: string;
  profileId: string;
  state: "running" | "completed" | "failed";
  currentStage?: VerificationStageResult["stage"];
  startedAt: string;
  updatedAt: string;
  readiness?: RuntimeReadiness;
  stages: RuntimeVerificationProgressStage[];
  error?: string;
}

const STAGES: VerificationStageResult["stage"][] = ["installation", "conversation", "task"];
const PROGRESS_TTL_MS = 30 * 60 * 1000;
const progressStore = new Map<string, RuntimeVerificationProgress>();

function storeKey(profileId: string, progressId: string): string {
  return `${profileId}:${progressId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pendingSummary(stage: VerificationStageResult["stage"]): string {
  if (stage === "installation") return "Waiting to check the CLI installation and version.";
  if (stage === "conversation") return "Waiting to run a real Provider conversation.";
  return "Waiting to test the exact repository edit in a disposable copy.";
}

function cloneProgress(progress: RuntimeVerificationProgress): RuntimeVerificationProgress {
  return {
    ...progress,
    stages: progress.stages.map((stage) => ({
      ...stage,
      details: stage.details ? [...stage.details] : undefined
    }))
  };
}

function pruneExpired(now = Date.now()): void {
  for (const [key, progress] of progressStore) {
    if (now - Date.parse(progress.updatedAt) > PROGRESS_TTL_MS) progressStore.delete(key);
  }
}

function updateProgress(
  profileId: string,
  progressId: string,
  update: (current: RuntimeVerificationProgress) => RuntimeVerificationProgress
): RuntimeVerificationProgress | undefined {
  pruneExpired();
  const current = progressStore.get(storeKey(profileId, progressId));
  if (!current) return undefined;
  const next = update(current);
  progressStore.set(storeKey(profileId, progressId), next);
  return cloneProgress(next);
}

export function startRuntimeVerificationProgress(
  profileId: string,
  progressId: string,
  startedAt = nowIso()
): RuntimeVerificationProgress {
  pruneExpired();
  const progress: RuntimeVerificationProgress = {
    progressId,
    profileId,
    state: "running",
    startedAt,
    updatedAt: startedAt,
    stages: STAGES.map((stage) => ({
      stage,
      status: "pending",
      startedAt,
      durationMs: 0,
      summary: pendingSummary(stage)
    }))
  };
  progressStore.set(storeKey(profileId, progressId), progress);
  return cloneProgress(progress);
}

export function markRuntimeVerificationStageStarted(
  profileId: string,
  progressId: string,
  stage: VerificationStageResult["stage"],
  startedAt = nowIso()
): RuntimeVerificationProgress | undefined {
  return updateProgress(profileId, progressId, (current) => ({
    ...current,
    state: "running",
    currentStage: stage,
    updatedAt: nowIso(),
    stages: current.stages.map((item) => item.stage === stage
      ? { ...item, status: "running", startedAt, durationMs: 0, summary: pendingSummary(stage) }
      : item)
  }));
}

export function markRuntimeVerificationStageComplete(
  profileId: string,
  progressId: string,
  stage: VerificationStageResult
): RuntimeVerificationProgress | undefined {
  return updateProgress(profileId, progressId, (current) => ({
    ...current,
    updatedAt: nowIso(),
    stages: current.stages.map((item) => item.stage === stage.stage ? { ...stage } : item)
  }));
}

export function completeRuntimeVerificationProgress(
  profileId: string,
  progressId: string,
  receipt: VerificationReceipt
): RuntimeVerificationProgress | undefined {
  return updateProgress(profileId, progressId, (current) => ({
    ...current,
    state: "completed",
    currentStage: undefined,
    readiness: receipt.readiness,
    updatedAt: nowIso(),
    stages: receipt.stages.map((stage) => ({ ...stage }))
  }));
}

export function failRuntimeVerificationProgress(
  profileId: string,
  progressId: string,
  error: string
): RuntimeVerificationProgress | undefined {
  return updateProgress(profileId, progressId, (current) => ({
    ...current,
    state: "failed",
    currentStage: undefined,
    updatedAt: nowIso(),
    error: error.slice(0, 2_000)
  }));
}

export function getRuntimeVerificationProgress(
  profileId: string,
  progressId: string
): RuntimeVerificationProgress | undefined {
  pruneExpired();
  const progress = progressStore.get(storeKey(profileId, progressId));
  return progress ? cloneProgress(progress) : undefined;
}

export const __runtimeVerificationProgressTestUtils = {
  clear(): void {
    progressStore.clear();
  },
  size(): number {
    return progressStore.size;
  }
};
