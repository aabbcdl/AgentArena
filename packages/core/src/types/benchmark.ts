import type {
  AdapterPreflightResult,
  AgentRequestedConfig,
  AgentResolvedRuntime,
} from "./agent.js";
import type { TaskJudge } from "./judge.js";
import type { TaskPack } from "./task-pack.js";

export interface TraceEvent {
  timestamp: string;
  agentId: string;
  runId?: string;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface JudgeResult {
  judgeId: string;
  label: string;
  type: TaskJudge["type"];
  critical?: boolean;
  command?: string;
  parser?: string;
  target?: string;
  expectation?: string;
  exitCode: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd?: string;
  passedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  totalCount?: number;
  warningCount?: number;
  errorCount?: number;
}

export interface DiffPrecisionSummary {
  score: number | null;
  expectedScopeCount: number;
  totalChangedFiles: number;
  matchedFiles: string[];
  unexpectedFiles: string[];
}

export interface CommandStepResult {
  stepId: string;
  label: string;
  command: string;
  exitCode: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd: string;
}

export interface DiffSummary {
  added: string[];
  changed: string[];
  removed: string[];
  skippedLargeFiles: string[];
}

export interface SweBenchMetrics {
  patchValidationResult?: {
    resolved: boolean;
    failToPassResults: Array<{ test: string; status: "pass" | "fail" | "error" }>;
    passToPassResults: Array<{ test: string; status: "pass" | "fail" | "error" }>;
  };
  resolutionRate?: number;
}

export interface CursorBenchMetrics {
  acceptanceRate?: number;
  undoRate?: number;
  completionRate?: number;
}

export interface LiveBenchMetrics {
  taskCategory?: string;
  contaminationChecked?: boolean;
  difficultyGeneration?: number;
}

export interface AgentRunResult {
  agentId: string;
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  requestedConfig: AgentRequestedConfig;
  resolvedRuntime?: AgentResolvedRuntime;
  agentTitle: string;
  status: "success" | "failed" | "cancelled";
  adapterKind: "demo" | "external";
  preflight: AdapterPreflightResult;
  summary: string;
  durationMs: number;
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  changedFiles: string[];
  changedFilesHint: string[];
  setupResults: CommandStepResult[];
  judgeResults: JudgeResult[];
  teardownResults: CommandStepResult[];
  tracePath: string;
  workspacePath: string;
  diff: DiffSummary;
  diffPrecision?: DiffPrecisionSummary;
  compositeScore?: number;
  scoreReasons?: string[];

  tokenUsageBreakdown?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  tokenEfficiencyScore?: number;

  sweBench?: SweBenchMetrics;
  cursorBench?: CursorBenchMetrics;
  liveBench?: LiveBenchMetrics;
}

export interface BenchmarkCancellation {
  signal: AbortSignal;
  throwIfCancelled: () => void;
}

export interface FairComparisonMetadata {
  taskIdentity?: string;
  judgeIdentity?: string;
  repoBaselineIdentity?: string;
}

export interface BenchmarkRun {
  runId: string;
  createdAt: string;
  repoPath: string;
  outputPath: string;
  scoreMode?: string;
  scoreWeights?: Record<string, number>;
  scoreScope?: "run-local";
  scoreValidityNote?: string;
  fairComparison?: FairComparisonMetadata;
  task: TaskPack;
  preflights: AdapterPreflightResult[];
  results: AgentRunResult[];
}

export interface ScoredRunResult extends AgentRunResult {
  compositeScore: number;
  scoreReasons?: string[];
}

export interface FileSnapshotEntry {
  relativePath: string;
  hash: string;
}

export interface RepoSourceResolution {
  kind: "user" | "builtin" | "url";
  repoPath: string;
}
