import { validateSummaryArtifact } from "../../../../../packages/core/src/artifact-contract.ts";
import { deriveEvaluationStatus, getQualifiedResults } from "../../../src/core/result-contract.js";
import { normalizeScoreMode } from "./score-mode.ts";
export type RunSourceKind = "generated" | "imported" | "demo" | "legacy" | "unknown";
export type IntegrityLevel = "complete" | "partial" | "degraded" | "damaged";
export type EvaluationStatus = "pass" | "partial" | "fail" | "incomplete";
export type CostQuality = "known" | "estimated" | "unavailable";
export type ExecutionStatus = "completed" | "cancelled" | "interrupted" | "running" | "unknown";

export interface NormalizedJudgeResult {
  judgeId: string;
  label: string;
  type: string;
  success: boolean;
  message: string | null;
}

export interface FileDiff {
  path: string;
  /** Raw unified-diff text (e.g. `git diff HEAD -- <path>` output). */
  text?: string;
  /** Pre-split hunks when the source provides them instead of raw text. */
  hunks?: string[];
}

export interface NormalizedAgentResult {
  agentId: string;
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  status: string;
  durationMs: number | null;
  tokenUsage: number | null;
  estimatedCostUsd: number | null;
  costKnown: boolean;
  costQuality: CostQuality;
  compositeScore: number | null;
  scoreExcluded: boolean;
  changedFiles: string[];
  /** Line-level diffs, when the runner persisted them. Undefined today — the
   * runner only stores file names, so the UI degrades to a file list. */
  fileDiffs?: FileDiff[];
  judgeResults: NormalizedJudgeResult[];
  tracePath: string | null;
  traceAvailability: "available" | "missing" | "unknown";
  summary: string;
  failureReason: string | null;
  requestedConfig: Record<string, unknown>;
  resolvedRuntime: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface NormalizedRun {
  runId: string;
  createdAt: string | null;
  repository: { path: string | null; revision: string | null };
  task: { id: string | null; title: string; schemaVersion: string | null };
  scoreMode: string;
  fairComparison: {
    taskIdentity: string;
    judgeIdentity: string;
    repoBaselineIdentity: string;
  } | null;
  source: { kind: RunSourceKind; label: string };
  results: NormalizedAgentResult[];
  integrity: IntegrityLevel;
  integrityReasons: string[];
  raw: Record<string, unknown>;
}

export interface RunOutcome {
  execution: ExecutionStatus;
  evaluation: EvaluationStatus;
  winner: NormalizedAgentResult | null;
  qualifiedResults: NormalizedAgentResult[];
  failedResults: NormalizedAgentResult[];
  trust: { level: IntegrityLevel; reasons: string[] };
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeJudge(value: unknown, index: number): NormalizedJudgeResult {
  const item = record(value);
  return {
    judgeId: text(item.judgeId) ?? text(item.id) ?? `judge-${index + 1}`,
    label: text(item.label) ?? text(item.name) ?? text(item.judgeId) ?? `Judge ${index + 1}`,
    type: text(item.type) ?? "unknown",
    success: item.success === true || item.status === "pass" || item.status === "success",
    message: text(item.message) ?? text(item.error) ?? text(item.summary)
  };
}

function normalizeFileDiff(value: unknown): FileDiff | null {
  const item = record(value);
  const path = text(item.path ?? item.file);
  if (!path) return null;
  const textValue = text(item.text);
  const hunks = Array.isArray(item.hunks) ? item.hunks.filter((line): line is string => typeof line === "string") : [];
  if (!textValue && hunks.length === 0) return null;
  return { path, text: textValue ?? undefined, hunks: hunks.length > 0 ? hunks : undefined };
}

function normalizeResult(value: unknown, index: number): NormalizedAgentResult {
  const item = record(value);
  const agentId = text(item.agentId) ?? text(item.baseAgentId) ?? `agent-${index + 1}`;
  const variantId = text(item.variantId) ?? agentId;
  const tracePath = text(item.tracePath);
  const declaredCostQuality = text(item.costQuality);
  const costQuality: CostQuality = declaredCostQuality === "known" || declaredCostQuality === "estimated" || declaredCostQuality === "unavailable"
    ? declaredCostQuality
    : item.costKnown === true ? "known" : "unavailable";
  const costKnown = costQuality === "known";
  const fileDiffs = Array.isArray(item.fileDiffs)
    ? item.fileDiffs.map((entry) => normalizeFileDiff(entry)).filter((entry): entry is FileDiff => entry !== null)
    : [];
  return {
    agentId,
    baseAgentId: text(item.baseAgentId) ?? agentId,
    variantId,
    displayLabel: text(item.displayLabel) ?? text(item.agentTitle) ?? variantId,
    status: text(item.status) ?? "unknown",
    durationMs: finiteNumber(item.durationMs),
    tokenUsage: finiteNumber(item.tokenUsage),
    estimatedCostUsd: costQuality !== "unavailable" ? finiteNumber(item.estimatedCostUsd) : null,
    costKnown,
    costQuality,
    compositeScore: finiteNumber(item.compositeScore) ?? finiteNumber(item.score),
    scoreExcluded: item.scoreExcluded === true,
    changedFiles: stringList(item.changedFiles),
    fileDiffs: fileDiffs.length > 0 ? fileDiffs : undefined,
    judgeResults: Array.isArray(item.judgeResults)
      ? item.judgeResults.map(normalizeJudge)
      : [],
    tracePath,
    traceAvailability: tracePath ? "available" : "missing",
    summary: text(item.summary) ?? "",
    failureReason: text(item.failureReason) ?? text(item.error) ?? null,
    requestedConfig: record(item.requestedConfig),
    resolvedRuntime: item.resolvedRuntime == null ? null : record(item.resolvedRuntime),
    raw: item
  };
}

function inferSource(raw: Record<string, unknown>): { kind: RunSourceKind; label: string } {
  const source = record(raw.source);
  const declared = text(source.kind);
  if (declared === "generated" || declared === "imported" || declared === "demo" || declared === "legacy") {
    return { kind: declared, label: text(source.label) ?? declared };
  }
  if (raw.isDemo === true) return { kind: "demo", label: "Demo" };
  if (raw.imported === true) return { kind: "imported", label: "Imported" };
  if (raw.legacy === true) return { kind: "legacy", label: "Legacy" };
  return { kind: "generated", label: "Local run" };
}

export function normalizeRun(value: unknown): NormalizedRun {
  const raw = record(value);
  const artifactValidation = validateSummaryArtifact(value);
  const repository = record(raw.repository);
  const fairComparison = record(raw.fairComparison);
  const taskIdentity = text(fairComparison.taskIdentity);
  const judgeIdentity = text(fairComparison.judgeIdentity);
  const repoBaselineIdentity = text(fairComparison.repoBaselineIdentity);
  const task = record(raw.task);
  const source = inferSource(raw);
  const rawResults: unknown[] | null = Array.isArray(raw.results) ? raw.results : null;
  const resultsValid = rawResults !== null;
  const results = rawResults ? rawResults.map(normalizeResult) : [];
  const integrityReasons: string[] = [];

  if (!resultsValid) integrityReasons.push("results-invalid");
  if (results.length === 0) integrityReasons.push("results-missing");
  if (!artifactValidation.ok) integrityReasons.push("artifact-invalid");
  if (artifactValidation.legacy) integrityReasons.push("legacy-artifact");
  if (source.kind === "legacy") integrityReasons.push("legacy-source");
  if (results.some((item) => item.costQuality === "unavailable")) integrityReasons.push("cost-unknown");
  if (results.some((item) => item.costQuality === "estimated")) integrityReasons.push("cost-estimated");
  if (results.some((item) => item.traceAvailability === "missing")) integrityReasons.push("trace-missing");
  if (results.some((item) => item.raw.tokenUsageReliable === false)) {
    integrityReasons.push("token-unreliable");
  }
  if (results.some((item) => typeof item.raw.dataQualityWarning === "string" && item.raw.dataQualityWarning.trim())) {
    integrityReasons.push("data-quality-warning");
  }
  if (results.some((item) => {
    const dropped = item.raw.traceDroppedWrites;
    return item.raw.traceWriteFailed === true || (typeof dropped === "number" && dropped > 0);
  })) {
    integrityReasons.push("trace-incomplete");
  }

  let integrity: IntegrityLevel = "complete";
  if (!resultsValid || !artifactValidation.ok) integrity = "damaged";
  else if (source.kind === "legacy" || artifactValidation.legacy) integrity = "degraded";
  else if (integrityReasons.length > 0) integrity = "partial";

  return {
    runId: text(raw.runId) ?? text(raw.id) ?? "unknown-run",
    createdAt: text(raw.createdAt),
    repository: {
      path: text(repository.path) ?? text(raw.repoPath) ?? text(fairComparison.repositoryPath),
      revision: text(repository.revision) ?? text(repository.snapshot) ?? text(fairComparison.repositoryRevision)
    },
    task: {
      id: text(task.id) ?? text(raw.taskId) ?? text(fairComparison.taskId),
      title: text(task.title) ?? text(raw.taskTitle) ?? "Untitled task",
      schemaVersion: text(task.schemaVersion) ?? text(fairComparison.taskSchemaVersion)
    },
    scoreMode: normalizeScoreMode(text(raw.scoreMode) ?? "practical"),
    fairComparison: taskIdentity && judgeIdentity && repoBaselineIdentity
      ? { taskIdentity, judgeIdentity, repoBaselineIdentity }
      : null,
    source,
    results,
    integrity,
    integrityReasons,
    raw
  };
}

function isTerminalFailure(status: string): boolean {
  return ["failed", "error", "cancelled", "skipped", "blocked"].includes(status);
}

function rankValue(result: NormalizedAgentResult): number {
  if (result.compositeScore !== null) return result.compositeScore;
  const passed = result.judgeResults.filter((judge) => judge.success).length;
  const ratio = result.judgeResults.length > 0 ? passed / result.judgeResults.length : 1;
  const durationPenalty = result.durationMs === null ? 0 : Math.min(result.durationMs / 1_000_000, 0.5);
  return ratio * 100 - durationPenalty;
}

export function deriveRunOutcome(run: NormalizedRun): RunOutcome {
  const structurallyQualifiedResults = getQualifiedResults(run.results);
  const qualifiedResults = run.integrity === "damaged" ? [] : structurallyQualifiedResults;
  const qualifiedIds = new Set(qualifiedResults.map((item) => item.variantId));
  const failedResults = run.results.filter((item) => !qualifiedIds.has(item.variantId));
  const rawRunStatus = text(run.raw.status) ?? text(run.raw.state);

  let execution: ExecutionStatus = "completed";
  if (rawRunStatus === "running" || rawRunStatus === "cancelling") execution = "running";
  else if (rawRunStatus === "cancelled") execution = "cancelled";
  else if (rawRunStatus === "interrupted" || rawRunStatus === "error") execution = "interrupted";
  else if (run.results.length === 0) execution = "unknown";

  const evaluation: EvaluationStatus = deriveEvaluationStatus(
    run.results.length,
    qualifiedResults.length,
    { damaged: run.integrity === "damaged" }
  );

  const winner = qualifiedResults.length === 0
    ? null
    : [...qualifiedResults].sort((a, b) => rankValue(b) - rankValue(a))[0] ?? null;

  const trustReasons = [...run.integrityReasons];
  if (run.results.every((item) => isTerminalFailure(item.status))) trustReasons.push("all-agents-failed");

  return {
    execution,
    evaluation,
    winner,
    qualifiedResults,
    failedResults,
    trust: { level: run.integrity, reasons: [...new Set(trustReasons)] }
  };
}

export function runIdentityKey(run: NormalizedRun, agentId: string | null = null): string {
  return `${run.runId}::${agentId ?? "run"}::${run.source.kind}`;
}

export function comparisonExclusionReasons(base: NormalizedRun, candidate: NormalizedRun): string[] {
  const reasons: string[] = [];
  if (base.fairComparison && candidate.fairComparison) {
    if (base.fairComparison.taskIdentity !== candidate.fairComparison.taskIdentity) {
      reasons.push("different-task");
    }
    if (base.fairComparison.judgeIdentity !== candidate.fairComparison.judgeIdentity) {
      reasons.push("different-judge-logic");
    }
    if (base.fairComparison.repoBaselineIdentity !== candidate.fairComparison.repoBaselineIdentity) {
      reasons.push("different-repo-baseline");
    }
  } else {
    if (base.task.id !== candidate.task.id || base.task.schemaVersion !== candidate.task.schemaVersion) {
      reasons.push("different-task");
    }
    if (base.repository.revision !== candidate.repository.revision) reasons.push("different-revision");
  }
  if (normalizeScoreMode(base.scoreMode) !== normalizeScoreMode(candidate.scoreMode)) {
    reasons.push("different-score-mode");
  }
  if (candidate.integrity === "damaged") reasons.push("damaged-result");
  return reasons;
}


