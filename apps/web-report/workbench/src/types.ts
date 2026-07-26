import type { NormalizedRun } from "./domain/run";

export type Locale = "zh-CN" | "en";
export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export type CostQuality = "known" | "estimated" | "unavailable";
export type PageId = "runs" | "plan" | "live" | "outcome" | "evidence" | "compare" | "library" | "environment" | "settings";

export interface AdapterInfo {
  id: string;
  title: string;
  kind?: string;
  capability?: Record<string, unknown>;
}

export interface TaskPackInfo {
  id?: string;
  title?: string;
  path: string;
  description?: string;
  source?: string;
  compatibility?: { status?: string; summary?: string; failedChecks?: Array<Record<string, unknown>> };
  objective?: string;
  judgeRationale?: string;
  i18n?: Partial<Record<Locale, { title?: string; description?: string; objective?: string; judgeRationale?: string }>>;
}

export interface ProviderProfile {
  id: string;
  name: string;
  kind?: string;
  apiFormat?: string;
  primaryModel?: string;
  baseUrl?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  notes?: string;
  secretStored?: boolean;
  isBuiltIn?: boolean;
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
  defaultTaskPath?: string;
  defaultOutputPath?: string;
  riskNotice?: string | null;
  version?: { version?: string; buildNumber?: number; gitCommit?: string } | null;
  host?: string;
  port?: number;
  authRequired?: boolean;
  telemetryEnabled?: boolean;
  demoTaskPath?: string;
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
  error: string | null;
  uiInfo: UiInfo | null;
  adapters: AdapterInfo[];
  taskPacks: TaskPackInfo[];
  providers: ProviderProfile[];
  detectedAgents: Array<Record<string, unknown>>;
  installGuides: InstallGuide[];
  telemetrySummary: TelemetrySummary | null;
  checkedAt: string | null;
  /** Per-section fetch failures so the UI can distinguish "load failed" from a
   *  genuine empty result, instead of rendering a failure as zero. */
  failed: { adapters: boolean; taskPacks: boolean; providers: boolean; telemetry: boolean };
}

export interface RunPlan {
  repoPath: string;
  taskPath: string;
  agentIds: string[];
  scoreMode: string;
  probeAuth: boolean;
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
  environment: EnvironmentState;
  refreshEnvironment: () => Promise<void>;
  saveProviderProfile: (payload: Record<string, unknown>) => Promise<void>;
  deleteProviderProfile: (id: string) => Promise<void>;
  plan: RunPlan;
  updatePlan: (patch: Partial<RunPlan>) => void;
  preflight: Record<string, unknown>[];
  runPreflight: () => Promise<void>;
  runStatus: UiRunStatus;
  startRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
  clearNotice: () => void;
  setNotice: (notice: { kind: "info" | "success" | "warning" | "danger"; message: string }) => void;
  notice: { kind: "info" | "success" | "warning" | "danger"; message: string } | null;
}

export function localizeTaskPack(task: TaskPackInfo, locale: Locale): TaskPackInfo {
  const localized = task.i18n?.[locale];
  return localized ? { ...task, ...localized } : task;
}
