export const TASK_PACK_SCHEMA_V1 = "agentarena.taskpack/v1";

export interface CommandExecutionSpec {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envAllowList?: string[];
  env?: Record<string, string>;
}

export interface CommandJudge extends CommandExecutionSpec {
  type: "command";
  critical?: boolean;
}

export interface TestResultJudge extends CommandExecutionSpec {
  type: "test-result";
  format?: "auto" | "jest" | "vitest";
  reportFile?: string;
  passOnNoTests?: boolean;
  critical?: boolean;
}

export interface LintCheckJudge extends CommandExecutionSpec {
  type: "lint-check";
  format?: "auto" | "eslint" | "biome";
  reportFile?: string;
  maxWarnings?: number;
  critical?: boolean;
}

export interface FileExistsJudge {
  id: string;
  label: string;
  type: "file-exists";
  path: string;
  critical?: boolean;
}

export interface FileContainsJudge {
  id: string;
  label: string;
  type: "file-contains";
  path: string;
  pattern: string;
  regex?: boolean;
  flags?: string;
  critical?: boolean;
}

export interface JsonValueJudge {
  id: string;
  label: string;
  type: "json-value";
  path: string;
  pointer: string;
  expected: unknown;
  critical?: boolean;
}

export interface GlobJudge {
  id: string;
  label: string;
  type: "glob";
  pattern: string;
  minMatches?: number;
  maxMatches?: number;
  critical?: boolean;
}

export interface FileCountJudge {
  id: string;
  label: string;
  type: "file-count";
  pattern: string;
  equals?: number;
  min?: number;
  max?: number;
  critical?: boolean;
}

export interface SnapshotJudge {
  id: string;
  label: string;
  type: "snapshot";
  path: string;
  snapshotPath: string;
  critical?: boolean;
}

export interface JsonSchemaJudge {
  id: string;
  label: string;
  type: "json-schema";
  path: string;
  schema?: Record<string, unknown>;
  schemaPath?: string;
  critical?: boolean;
}

// === SWE-Bench Extensions ===

/**
 * SWE-Bench: Patch validation judge for verifying code patches against test suites.
 * Validates both fail-to-pass and pass-to-pass test categories.
 */
export interface PatchValidationJudge extends CommandExecutionSpec {
  type: "patch-validation";
  testSuite: string;
  failToPassTests?: string[];
  passToPassTests?: string[];
  critical?: boolean;
}

// === CursorBench Extensions ===

/**
 * CursorBench: Token efficiency judge for measuring and constraining token usage.
 * Enforces token budget limits and efficiency targets.
 */
export interface TokenEfficiencyJudge {
  id: string;
  label: string;
  type: "token-efficiency";
  tokenBudget?: number;
  critical?: boolean;
}

export type TaskJudge =
  | CommandJudge
  | TestResultJudge
  | LintCheckJudge
  | FileExistsJudge
  | FileContainsJudge
  | JsonValueJudge
  | GlobJudge
  | FileCountJudge
  | SnapshotJudge
  | JsonSchemaJudge
  | PatchValidationJudge
  | TokenEfficiencyJudge;

export interface TaskPackMetadata {
  source: "official" | "community";
  owner: string;
  difficulty?: "easy" | "medium" | "hard";
  objective?: string;
  repoTypes: string[];
  tags: string[];
  dependencies: string[];
  judgeRationale?: string;
  differentiator?: string;

  // === SWE-Bench Extensions ===
  /** GitHub issue information for SWE-Bench task reproduction */
  githubIssue?: {
    owner: string;
    repo: string;
    issueNumber: number;
    baseCommit: string;
    testCommit: string;
    patchPath?: string;
  };
  /** Tests that should change from fail to pass after patch application */
  failToPassTests?: string[];
  /** Tests that should remain passing after patch application */
  passToPassTests?: string[];

  // === CursorBench Extensions ===
  /** Maximum token budget for the task */
  tokenBudget?: number;
  /** Target efficiency score (0-1) */
  efficiencyTarget?: number;
  /** Interaction model: single-turn or multi-turn */
  interactionModel?: "single-turn" | "multi-turn";
  /** How clearly the requirements are specified */
  requirementClarity?: "precise" | "fuzzy" | "ambiguous";

  // === LiveBench Extensions ===
  /** Task categories for LiveBench classification */
  taskCategories?: string[];
  /** Anti-contamination tracking to ensure task freshness */
  antiContamination?: {
    rotationId: string;
    createdAt: string;
    expiresAt?: string;
    sourceTimestamp?: string;
  };
  /** Difficulty evolution tracking for progressive benchmarking */
  difficultyEvolution?: {
    generation: number;
    predecessorTaskId?: string;
  };
}

/**
 * Repository source configuration for task packs.
 * - "user": Use the user-provided repository (default)
 * - "builtin://name": Use a built-in standard test repository for fair comparison
 * - "https://...": Clone an external repository (future support)
 */
export type RepoSource = string;

export interface TaskPack {
  schemaVersion: typeof TASK_PACK_SCHEMA_V1;
  id: string;
  title: string;
  description?: string;
  prompt: string;
  metadata?: TaskPackMetadata;
  /** Repository source - "user" for user repo, "builtin://name" for standard test repo */
  repoSource?: RepoSource;
  expectedChangedPaths?: string[];
  envAllowList: string[];
  setupCommands: CommandExecutionSpec[];
  judges: TaskJudge[];
  teardownCommands: CommandExecutionSpec[];
}

export interface AgentRequestedConfig {
  model?: string;
  reasoningEffort?: string;
  providerProfileId?: string;
}

export interface AgentSelection {
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  config: AgentRequestedConfig;
  configSource?: "ui" | "cli";
}

export type AgentRuntimeSource =
  | "ui"
  | "cli"
  | "env"
  | "codex-config"
  | "cli-default"
  | "event-stream"
  | "profile-config"
  | "official-login"
  | "unknown";

export type AgentRuntimeVerification = "confirmed" | "inferred" | "unknown";
export type AgentVersionSource = "version-command" | "package-file" | "builtin" | "unknown";

export interface AgentResolvedRuntime {
  effectiveModel?: string;
  effectiveReasoningEffort?: string;
  effectiveAgentVersion?: string;
  agentVersionSource?: AgentVersionSource;
  providerProfileId?: string;
  providerProfileName?: string;
  providerKind?: ClaudeProviderProfileKind;
  providerSource?: "official-login" | "profile-config" | "env" | "unknown";
  source: AgentRuntimeSource;
  verification: AgentRuntimeVerification;
  notes?: string[];
}

export type ClaudeProviderProfileKind = "official" | "anthropic-compatible" | "openai-proxy";
export type ClaudeProviderApiFormat = "anthropic-messages" | "openai-chat-via-proxy";
export type ClaudeProviderRiskFlag =
  | "third-party-provider"
  | "compatibility-mode"
  | "user-managed-secret";

export interface ClaudeProviderProfile {
  id: string;
  name: string;
  kind: ClaudeProviderProfileKind;
  homepage?: string;
  baseUrl?: string;
  apiFormat: ClaudeProviderApiFormat;
  primaryModel?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  extraEnv: Record<string, string>;
  writeCommonConfig: boolean;
  notes?: string;
  riskFlags: ClaudeProviderRiskFlag[];
  isBuiltIn?: boolean;
  secretStored?: boolean;
}

export interface TraceEvent {
  timestamp: string;
  agentId: string;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AdapterExecutionContext {
  agentId: string;
  selection: AgentSelection;
  repoPath: string;
  workspacePath: string;
  environment: NodeJS.ProcessEnv;
  task: TaskPack;
  signal?: AbortSignal;
  trace: (event: Omit<TraceEvent, "agentId" | "timestamp">) => Promise<void>;
}

export interface AdapterExecutionResult {
  status: "success" | "failed";
  summary: string;
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  changedFilesHint: string[];
  resolvedRuntime?: AgentResolvedRuntime;
  /** Detailed token usage breakdown for efficiency analysis */
  tokenUsageBreakdown?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

export type AdapterPreflightStatus = "ready" | "unverified" | "blocked" | "missing";
export type AdapterSupportTier = "supported" | "experimental" | "blocked";
export type AdapterMetricAvailability = "available" | "estimated" | "unavailable";
export type AdapterTraceRichness = "full" | "partial" | "minimal";

export interface AdapterCapability {
  supportTier: AdapterSupportTier;
  invocationMethod: string;
  authPrerequisites: string[];
  tokenAvailability: AdapterMetricAvailability;
  costAvailability: AdapterMetricAvailability;
  traceRichness: AdapterTraceRichness;
  knownLimitations: string[];
  configurableRuntime?: {
    model: boolean;
    reasoningEffort: boolean;
    providerProfile?: boolean;
  };
}

export interface AdapterPreflightOptions {
  probeAuth?: boolean;
  selection?: AgentSelection;
}

export interface AdapterPreflightResult {
  agentId: string;
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  requestedConfig: AgentRequestedConfig;
  resolvedRuntime?: AgentResolvedRuntime;
  agentTitle: string;
  adapterKind: "demo" | "external";
  status: AdapterPreflightStatus;
  summary: string;
  capability: AdapterCapability;
  command?: string;
  details?: string[];
}

export interface AgentAdapter {
  id: string;
  title: string;
  kind: "demo" | "external";
  capability: AdapterCapability;
  preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult>;
  execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;
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

  // === CursorBench Metrics ===
  /** Detailed token usage breakdown for efficiency analysis */
  tokenUsageBreakdown?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  /** Token efficiency score (0-1, higher is better) */
  tokenEfficiencyScore?: number;
  /** Agent code acceptance rate (0-1) */
  acceptanceRate?: number;
  /** Agent undo/rollback rate (0-1, lower is better) */
  undoRate?: number;
  /** Task completion rate (0-1) */
  completionRate?: number;

  // === SWE-Bench Metrics ===
  /** Patch validation results for SWE-Bench tasks */
  patchValidationResult?: {
    resolved: boolean;
    failToPassResults: Array<{ test: string; status: "pass" | "fail" | "error" }>;
    passToPassResults: Array<{ test: string; status: "pass" | "fail" | "error" }>;
  };
  /** Issue resolution rate (0-1) */
  resolutionRate?: number;

  // === LiveBench Metrics ===
  /** Task category for LiveBench classification */
  taskCategory?: string;
  /** Whether contamination check was performed */
  contaminationChecked?: boolean;
  /** Difficulty generation number for progressive benchmarking */
  difficultyGeneration?: number;
}

export interface BenchmarkCancellation {
  signal: AbortSignal;
  throwIfCancelled: () => void;
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
  task: TaskPack;
  preflights: AdapterPreflightResult[];
  results: AgentRunResult[];
}

/**
 * Agent run result with composite score attached.
 * Used after scoring has been applied to a run result.
 */
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

// === Leaderboard & Task Rotation Extensions ===

/**
 * Leaderboard entry for tracking agent performance across tasks.
 * Aggregates scores, efficiency metrics, and category performance.
 */
export interface LeaderboardEntry {
  agentId: string;
  displayLabel: string;
  totalScore: number;
  taskCount: number;
  avgTokenEfficiency: number;
  avgResolutionRate: number;
  avgDurationMs: number;
  categories: Record<string, number>;
  lastUpdated: string;
}

/**
 * Task rotation configuration for LiveBench anti-contamination.
 * Manages task lifecycle and expiration to prevent training data leakage.
 */
export interface TaskRotation {
  rotationId: string;
  createdAt: string;
  expiresAt?: string;
  taskIds: string[];
  isActive: boolean;
}

/**
 * Leaderboard schema for aggregating and displaying benchmark results.
 * Supports task rotations and category-based scoring.
 */
export interface Leaderboard {
  version: "agentarena.leaderboard/v1";
  updatedAt: string;
  scoreMode: string;
  entries: LeaderboardEntry[];
  rotations: TaskRotation[];
  categories: string[];
}
