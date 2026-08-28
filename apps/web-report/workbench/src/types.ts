import type { NormalizedRun } from "./domain/run";
import type { CopyKey } from "./i18n";

export type Locale = "zh-CN" | "en";
export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export type CostQuality = "known" | "estimated" | "unavailable";
export type EvidenceStrength = "basic" | "structured" | "task-specific";
export type TaskCompatibilityStatus = "compatible" | "warning" | "incompatible" | "unknown";
export type LogKind = "phase" | "output" | "tool" | "file" | "warning" | "error" | "success" | "noise";
export type PageId = "runs" | "plan" | "live" | "outcome" | "evidence" | "compare" | "library" | "environment" | "settings";

export interface AdapterInfo {
  id: string;
  title: string;
  kind?: string;
  capability?: Record<string, unknown>;
}

export interface AgentDetectionResult {
  id: string;
  displayName: string;
  installed: boolean;
  version: string;
  configExists: boolean;
  configFilesFound: string[];
  configFilesMissing: string[];
  detail?: string;
  status?: "ready" | "unverified" | "blocked" | "missing";
}

export type AdapterTrialStatus = "supported" | "experimental" | "blocked" | "installed" | "task-ready" | "unverified" | "missing";

export interface TaskPackInfo {
  id?: string;
  title?: string;
  path: string;
  description?: string;
  difficulty?: "easy" | "medium" | "hard";
  source?: string;
  lifecycle?: "core" | "legacy" | "experimental";
  repoSource?: string;
  repoPath?: string;
  expectedChangedPaths?: string[];
  evidenceStrength?: EvidenceStrength;
  warningCodes?: string[];
  compatibility?: { status?: string; summary?: string; failedChecks?: Array<Record<string, unknown>> };
  objective?: string;
  judgeRationale?: string;
  i18n?: Partial<Record<Locale, { title?: string; description?: string; objective?: string; judgeRationale?: string }>>;
}

export interface AdhocTaskPackSummary {
  id: string;
  title: string;
  path: string;
  createdAt: string;
  promptPreview: string;
  repoPath?: string;
  source?: "adhoc";
  lifecycle?: "experimental";
  repoSource?: "user";
  expectedChangedPaths?: string[];
  evidenceStrength?: EvidenceStrength;
  warningCodes?: string[];
  compatibility?: {
    status?: TaskCompatibilityStatus;
    reasons?: string[];
  };
}

export interface AdhocGeneratedCheck {
  kind: "build" | "test" | "lint" | "generic";
  label: string;
  command?: string;
  strength: "basic";
}

export interface AdhocTaskPackPreview {
  id: string;
  title: string;
  prompt: string;
  repoPath: string;
  repoType: string;
  source: "adhoc";
  lifecycle: "draft" | "ready";
  expectedChangedPaths: string[];
  generatedChecks: AdhocGeneratedCheck[];
  warnings: string[];
  warningCodes?: string[];
  compatibility: {
    status: TaskCompatibilityStatus;
    reasons: string[];
  };
  evidenceStrength: "basic";
}

export interface CreateAdhocTaskpackRequest {
  prompt: string;
  title?: string;
  repoPath: string;
  expectedChangedPaths?: string[];
}

export type RuntimeAgentKind = "codex" | "claude-code";
export type RuntimeProfileMode = "inherit-local" | "managed-provider";
export type RuntimeReadiness = "not-installed" | "installed" | "conversation-ready" | "task-ready" | "blocked" | "changed";

export interface RuntimeProfileProvider {
  baseUrl?: string;
  protocol?: "openai-responses" | "openai-chat-completions" | "anthropic-messages" | "openai-chat-via-proxy";
  requestedModel?: string;
  canonicalModelIdentity?: string;
  modelIdentitySource?: "confirmed" | "declared" | "unknown";
  reasoningEffort?: string;
  modelMappings?: Record<string, string>;
}

export interface RuntimeProfile {
  id: string;
  name: string;
  agentKind: RuntimeAgentKind;
  mode: RuntimeProfileMode;
  revision: number;
  secretRevision: number;
  commandPath?: string;
  provider?: RuntimeProfileProvider;
  extraEnvKeys: string[];
  riskFlags: string[];
  notes?: string;
  secretStored: boolean;
  isBuiltIn?: boolean;
}

export interface RuntimeVerificationStage {
  stage: "installation" | "conversation" | "task";
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  durationMs: number;
  exitCode?: number | null;
  errorCategory?: string;
  summary: string;
  details?: string[];
}

export type RuntimeVerificationProgressStageStatus = "pending" | "running" | RuntimeVerificationStage["status"];

export interface RuntimeVerificationProgressStage extends Omit<RuntimeVerificationStage, "status"> {
  status: RuntimeVerificationProgressStageStatus;
}

export interface RuntimeVerificationProgress {
  progressId: string;
  profileId: string;
  state: "running" | "completed" | "failed";
  currentStage?: RuntimeVerificationStage["stage"];
  startedAt: string;
  updatedAt: string;
  readiness?: RuntimeReadiness;
  stages: RuntimeVerificationProgressStage[];
  error?: string;
}

export interface RuntimeReadinessProjection {
  profile: RuntimeProfile;
  readiness: RuntimeReadiness;
  receiptMatch: boolean;
  installation?: {
    id: string;
    executable: string;
    displayCommand: string;
    source: string;
    version?: string;
    fingerprint: string;
    discoveredAt: string;
  };
  harness?: {
    snapshotId: string;
    repositoryBaselineIdentity: string;
    riskFlags: string[];
    entries: Array<Record<string, unknown>>;
  };
  launchSpec?: Record<string, unknown>;
  receipt?: {
    receiptId: string;
    createdAt: string;
    readiness: RuntimeReadiness;
    stages: RuntimeVerificationStage[];
  };
  stages: RuntimeVerificationStage[];
  failure?: { errorCategory: string; summary: string };
}

export interface RuntimeProfilesResponse {
  profiles: RuntimeProfile[];
  repository?: {
    requestedPath: string;
    resolvedPath: string;
    baselineIdentity: string;
    kind: "user" | "builtin";
  };
  readiness?: RuntimeReadinessProjection[];
}

export interface InstallGuide {
  id: string;
  displayName: string;
  homepage?: string;
  docs?: string;
  github?: string;
  install: {
    windows?: Record<string, string>;
    macos?: Record<string, string>;
    linux?: Record<string, string>;
    all?: Record<string, string>;
  };
  warnings?: string[];
  postInstall?: string[];
}

export interface UiInfo {
  mode?: string;
  repoPath?: string;
  workspaceRoot?: string;
  defaultTaskPath?: string;
  defaultOutputPath?: string;
  riskNotice?: string | null;
  version?: { version?: string; buildNumber?: number; gitCommit?: string } | null;
  host?: string;
  port?: number;
  authRequired?: boolean;
  authTokenFilePath?: string;
  authTokenSource?: "cli" | "local-env" | "env" | "generated" | "unknown";
  authMode?: "password" | "token";
  authSetupRequired?: boolean;
  telemetryEnabled?: boolean;
  demoTaskPath?: string;
  codexDefaults?: {
    effectiveModel?: string;
    effectiveReasoningEffort?: string;
    modelIdentitySource?: "confirmed" | "declared" | "inferred" | "unknown";
    reasoningEffortSource?: "confirmed" | "declared" | "inferred" | "unknown";
    source?: string;
    verification?: "confirmed" | "inferred" | "unknown";
    notes?: string[];
  };
  nodeMajor?: number;
  platform?: string;
}

export interface TelemetrySummary {
  enabled: boolean;
  totalEvents: number;
  events: Record<
    "app_opened" | "run_started" | "run_completed" | "result_viewed" | "preflight_completed" | "evidence_opened",
    number
  >;
  entryPoints: Record<string, number>;
  resultIntegrity: Record<string, number>;
  outcomes: Record<string, number>;
}

export interface RunLogEntry {
  timestamp?: string;
  phase?: string;
  message?: string;
  agentId?: string;
  variantId?: string;
  displayLabel?: string;
  stream?: "stdout" | "stderr";
  seq?: number;
  kind?: LogKind;
}

export interface UiRunStatus {
  state: "idle" | "running" | "done" | "error" | "cancelled" | "cancelling";
  phase: string;
  logs: RunLogEntry[];
  updatedAt?: string;
  startedAt?: string;
  repoPath?: string;
  taskPath?: string;
  runId?: string;
  outputPath?: string;
  currentAgentId?: string;
  currentVariantId?: string;
  currentDisplayLabel?: string;
  snapshot?: Record<string, unknown>;
  result?: { run?: unknown; markdown?: string; report?: Record<string, unknown> };
  error?: string;
}

export interface EnvironmentState {
  loading: boolean;
  runtimeLoading: boolean;
  runtimeAuthRequired: boolean;
  error: string | null;
  runStatusLoaded: boolean;
  uiInfo: UiInfo | null;
  adapters: AdapterInfo[];
  taskPacks: TaskPackInfo[];
  runtimeProfiles: RuntimeProfile[];
  runtimeReadiness: RuntimeReadinessProjection[];
  runtimeVerificationProgress: RuntimeVerificationProgress | null;
  runtimeRepository: RuntimeProfilesResponse["repository"] | null;
  detectedAgents: AgentDetectionResult[];
  installGuides: InstallGuide[];
  telemetrySummary: TelemetrySummary | null;
  checkedAt: string | null;
  /** Per-section fetch failures so the UI can distinguish "load failed" from a
   *  genuine empty result, instead of rendering a failure as zero. */
  failed: { adapters: boolean; taskPacks: boolean; runtimeProfiles: boolean; telemetry: boolean };
}

export interface WorkbenchNotice {
  kind: "info" | "success" | "warning" | "danger";
  message?: string;
  messageKey?: CopyKey;
  params?: Record<string, string | number>;
}

export interface RunPlan {
  repoPath: string;
  taskPath: string;
  runtimeProfileIds: string[];
  scoreMode: string;
  maxConcurrency: number;
}

export interface WorkbenchContextValue {
  locale: Locale;
  theme: Theme;
  density: Density;
  page: PageId;
  setPage: (page: PageId) => void;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
  runs: NormalizedRun[];
  selectedRun: NormalizedRun | null;
  selectedAgentId: string | null;
  setSelectedRunId: (runId: string) => void;
  setSelectedAgentId: (agentId: string | null) => void;
  importRuns: (files: FileList | File[]) => Promise<{ imported: number; errors: string[] }>;
  loadDemo: () => void;
  startDemo: () => Promise<void>;
  environment: EnvironmentState;
  refreshEnvironment: (repositoryPathOverride?: string, taskPathOverride?: string) => Promise<void>;
  adhocPreview: AdhocTaskPackPreview | null;
  createAdhocTaskpack: (request: CreateAdhocTaskpackRequest) => Promise<AdhocTaskPackPreview>;
  clearAdhocPreview: () => void;
  refreshRuntimeReadiness: (repoPath?: string, taskPath?: string) => Promise<RuntimeProfilesResponse>;
  saveRuntimeProfile: (payload: Record<string, unknown>) => Promise<RuntimeProfile | undefined>;
  deleteRuntimeProfile: (id: string) => Promise<void>;
  verifyRuntimeProfile: (id: string) => Promise<void>;
  plan: RunPlan;
  updatePlan: (patch: Partial<RunPlan>) => void;
  preparePlanFromRun: (run: NormalizedRun) => void;
  runStatus: UiRunStatus;
  startRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
  clearNotice: () => void;
  setNotice: (notice: WorkbenchNotice) => void;
  notice: WorkbenchNotice | null;
}

export function localizeTaskPack(task: TaskPackInfo, locale: Locale): TaskPackInfo {
  const localized = task.i18n?.[locale];
  return localized ? { ...task, ...localized } : task;
}

export function resolveTaskRepositorySource(task: Pick<TaskPackInfo, "repoSource"> | null | undefined, userRepoPath: string): { kind: "builtin" | "user"; value: string } {
  const repoSource = task?.repoSource?.trim();
  return repoSource?.startsWith("builtin://")
    ? { kind: "builtin", value: repoSource }
    : { kind: "user", value: userRepoPath };
}
