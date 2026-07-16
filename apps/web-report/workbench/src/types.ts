import type { NormalizedRun } from "./domain/run";

export type Locale = "zh-CN" | "en";
export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
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
}

export interface ProviderProfile {
  id: string;
  name: string;
  kind?: string;
  apiFormat?: string;
  primaryModel?: string;
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
  checkedAt: string | null;
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
