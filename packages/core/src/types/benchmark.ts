import type {
  AdapterPreflightResult,
  AgentRequestedConfig,
  AgentResolvedRuntime,
} from "./agent.js";
import type { TaskJudge } from "./judge.js";
import type { TaskPack } from "./task-pack.js";

/**
 * Closed enumeration of every trace event `type` that is emitted by AgentArena.
 *
 * Adding a new event type:
 *   1. Add the literal here.
 *   2. (If the event has typed payload) document the metadata fields nearby
 *      or in the emitting module's JSDoc.
 *
 * Keeping this union closed catches typos at compile time (a misspelled event
 * name fails to compile rather than silently producing a trace entry no
 * consumer recognises).
 */
export type TraceEventType =
  // Adapter lifecycle (canonical names from packages/adapters/src/adapter-events.ts)
  | "adapter.start"
  | "adapter.message"
  | "adapter.prompt"
  | "adapter.tool_use"
  | "adapter.file_change"
  | "adapter.usage"
  | "adapter.result"
  | "adapter.error"
  | "adapter.finish"
  // Adapter-vendor-specific result events
  | "adapter.augment.result"
  | "adapter.claude.profile"
  | "adapter.claude.result"
  | "adapter.codex.result"
  | "adapter.cursor.result"
  | "adapter.gemini.result"
  | "adapter.qwen.result"
  | "adapter.trae.result"
  // Transport fallback events
  | "adapter.transport_fallback"
  // Agent runner lifecycle
  | "agent.copy_failed"
  | "agent.skipped"
  // Phase events
  | "setup.error"
  | "setup.finish"
  | "judge.error"
  | "judge.finish"
  | "teardown.error"
  | "teardown.finish"
  | "preflight.result"
  // Snapshot reliability
  | "snapshot.before_failed"
  | "snapshot.after_failed"
  // Sandbox policy
  | "sandbox.violation";

export interface TraceEvent {
  timestamp: string;
  agentId: string;
  runId?: string;
  type: TraceEventType;
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
  /**
   * When false, the before/after snapshots failed and the diff cannot be trusted.
   * Consumers (scoring, precision) must treat the run as having unknown changes,
   * not zero changes. Absent for legacy results — treat absence as true.
   */
  reliable?: boolean;
  /** Optional reason set alongside `reliable: false`. */
  unreliableReason?: string;
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
  assembledPrompt?: string;
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
