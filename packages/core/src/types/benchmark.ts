import type {
  AdapterPreflightResult,
  AgentRequestedConfig,
  AgentResolvedRuntime,
  CostQuality,
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
  | "agent.cancelled"
  | "agent.skipped"
  // Phase events
  | "setup.error"
  | "setup.finish"
  | "setup.git_unavailable"
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
  /** Artifact schema version written by new trace recorders; absent on legacy traces. */
  schemaVersion?: string;
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
  /** Relative weight in weighted pass-ratio scoring; defaults to 1. Propagated from the judge config. */
  weight?: number;
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
  /**
   * Per-test outcomes for the patch-validation judge's fail-to-pass set.
   * Populated only by patch-validation; absent for all other judge types.
   * Status vocabulary: "pass" (test passed), "fail" (test ran but failed),
   * "error" (required test was not found in the report).
   */
  failToPassResults?: Array<{ test: string; status: "pass" | "fail" | "error" }>;
  /** Per-test outcomes for the patch-validation judge's pass-to-pass set. */
  passToPassResults?: Array<{ test: string; status: "pass" | "fail" | "error" }>;
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

/**
 * Per-file unified diff persisted for Workbench Evidence and report consumers.
 * Optional on historical runs — consumers must degrade to file names when absent.
 */
export interface FileDiffArtifact {
  path: string;
  /** Raw unified-diff text (e.g. `git diff HEAD -- <path>`). */
  text?: string;
  /** Pre-split hunks when the source provides them instead of raw text. */
  hunks?: string[];
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

export interface TaskCompatibilityCheck {
  /** What was checked */
  label: string;
  /** Check result */
  status: "pass" | "warn" | "fail";
  /** Human-readable message */
  message: string;
  /** Optional fix shown in reports when the check does not pass */
  fix?: string;
}

export interface TaskCompatibilityResult {
  /** Overall compatibility status */
  status: "compatible" | "warning" | "incompatible";
  /** Human-readable summary */
  summary: string;
  /** Individual check results */
  checks: TaskCompatibilityCheck[];
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
  /**
   * Whether the execution pipeline itself completed independently of validation.
   * Missing on historical results; consumers must fall back to `status`.
   */
  executionStatus?: "completed" | "failed" | "cancelled" | "not-run";
  /**
   * Outcome of judge validation after a completed agent execution.
   * `partial` means only non-critical judges failed.
   */
  validationStatus?: "passed" | "partial" | "failed" | "error" | "not-run";
  adapterKind: "demo" | "external";
  preflight: AdapterPreflightResult;
  summary: string;
  durationMs: number;
  tokenUsage: number;
  estimatedCostUsd: number;
  /**
   * @deprecated Use `costQuality` instead. `costKnown` is a boolean that
   * cannot distinguish "estimated" from "unavailable"; `costQuality` provides
   * three states ("known" | "estimated" | "unavailable"). This field is kept
   * for backward compatibility — new code must prefer `costQuality`.
   */
  costKnown: boolean;
  /** Three-state cost confidence. Missing values use costKnown for historical compatibility. */
  costQuality?: CostQuality;
  /**
   * False when the reported tokenUsage is from an unreliable source (fallback
   * transport / missing authoritative total / suspicious count). Absent means
   * legacy/unknown — treat as reliable. Drives whether tokenEfficiencyScore is
   * computed.
   */
  tokenUsageReliable?: boolean;
  /**
   * Present when the adapter detected a likely CLI output format mismatch.
   * Consumers SHOULD surface this in reports and exclude affected metrics
   * from scoring. Propagated from AdapterExecutionResult.dataQualityWarning.
   */
  dataQualityWarning?: string;
  /**
   * Names of critical events expected but not seen in the CLI output stream.
   * Propagated from AdapterExecutionResult.missingCriticalEvents.
   * When non-empty, tokenUsage and cost may be inaccurate.
   */
  missingCriticalEvents?: string[];
  /**
   * True when the JSONL trace recorder failed a write and stopped recording.
   * Consumers SHOULD treat the trace as incomplete for audit purposes.
   */
  traceWriteFailed?: boolean;
  /**
   * Number of trace events dropped due to write-queue backpressure.
   * Present only when at least one write was dropped.
   */
  traceDroppedWrites?: number;
  changedFiles: string[];
  changedFilesHint: string[];
  /**
   * Line-level diffs for changed files when the runner could collect them.
   * Absent on legacy results — UI must fall back to the file name list.
   */
  fileDiffs?: FileDiffArtifact[];
  setupResults: CommandStepResult[];
  judgeResults: JudgeResult[];
  teardownResults: CommandStepResult[];
  tracePath: string;
  workspacePath: string;
  diff: DiffSummary;
  diffPrecision?: DiffPrecisionSummary;
  /**
   * False when before/after snapshots were not both reliable. Absent means
   * legacy results, which remain compatible with existing consumers.
   */
  diffReliable?: boolean;
  compositeScore?: number;
  scoreReasons?: string[];
  /**
   * True when this row should not be used as evidence of agent/model quality.
   * Examples: task pack does not match the repository, setup failed before the
   * agent started, or adapter preflight blocked execution.
   */
  scoreExcluded?: boolean;
  /** Human-readable reason shown next to n/a scores. */
  scoreExclusionReason?: string;
  /** Coarse failure bucket for user-facing diagnostics. */
  failureCategory?: "task-pack" | "environment" | "agent" | "model" | "validation" | "cancelled" | "unknown";

  /**
   * Last N combined stdout+stderr lines from the agent process, captured
   * on failure for diagnostic purposes. Tagged with `[out]`/`[err]` prefixes.
   * Only populated when status === "failed". Additive: existing consumers
   * that don't read this field are unaffected.
   */
  failureTail?: string[];

  /** Process exit code if the agent exited with a non-zero code. */
  exitCode?: number | null;

  /** Signal name if the agent was terminated by a signal (e.g. "SIGTERM"). */
  signal?: string | null;

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
  taskCompatibility?: TaskCompatibilityResult;
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
  kind: "user" | "builtin";
  repoPath: string;
}
