import type {
  AdapterInfo,
  AgentDetectionResult,
  EnvironmentState,
  Locale,
  RuntimeReadinessProjection,
  TaskPackInfo,
  TelemetrySummary,
  UiInfo,
  UiRunStatus
} from "../types.ts";
import { deriveAdapterTrialStatus } from "./adapter-trial.ts";
import { deriveRunOutcome, type NormalizedRun } from "./run.ts";

export const PILOT_DIAGNOSTICS_SCHEMA = "agentarena.pilot-diagnostics/v1" as const;

export interface PilotDiagnosticsBundle {
  schema: typeof PILOT_DIAGNOSTICS_SCHEMA;
  generatedAt: string;
  product: {
    version: string | null;
    build: number | null;
    gitCommit: string | null;
    nodeMajor: number | null;
    platform: string | null;
  };
  adapters: Array<{
    id: string;
    supportTier: string;
    status: string;
    installed: boolean;
    version: string | null;
    errorCategory: string | null;
  }>;
  runtime: {
    profiles: Array<{
      agentKind: string;
      mode: string;
      readiness: string;
      receiptMatch: boolean;
      stages: Array<{ stage: string; status: string }>;
      nextStep: string;
    }>;
    verificationState: string;
  };
  taskPack: {
    id: string | null;
    lifecycle: string | null;
    repoType: "builtin" | "user" | "unknown";
    compatibilityStatus: string | null;
  };
  recentRun: {
    outcome: string | null;
    integrity: string | null;
    agentCount: number;
    state: string;
  };
  telemetry: {
    enabled: boolean;
    totalEvents: number;
    events: Record<string, number>;
  };
}

function errorCategory(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("secret")) return "secret-missing";
  if (normalized.includes("permission")) return "permission-denied";
  if (normalized.includes("install") || normalized.includes("not found")) return "installation-missing";
  if (normalized.includes("timeout")) return "timeout";
  if (normalized.includes("config") || normalized.includes("drift")) return "configuration-drift";
  return "readiness-unverified";
}

function nextStep(status: string, locale: Locale): string {
  if (status === "task-ready") return locale === "zh-CN" ? "可开始 repo-health 或自定义 Node 任务。" : "Ready for repo-health or a custom Node task.";
  if (status === "installed") return locale === "zh-CN" ? "运行三阶段验证以绑定当前仓库和任务。" : "Run three-stage verification for the selected repository and task.";
  if (status === "blocked" || status === "missing") return locale === "zh-CN" ? "修复诊断原因后重新检查。" : "Fix the diagnostic cause, then check again.";
  return locale === "zh-CN" ? "先完成本地 CLI 检测。" : "Complete local CLI detection first.";
}

function taskRepositoryType(task: TaskPackInfo | undefined): "builtin" | "user" | "unknown" {
  if (!task) return "unknown";
  if (task.repoSource?.startsWith("builtin://")) return "builtin";
  if (task.repoSource === "user" || !task.repoSource) return "user";
  return "unknown";
}

function latestRun(runs: NormalizedRun[]): NormalizedRun | undefined {
  return [...runs].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))[0];
}

export interface PilotDiagnosticsInput {
  uiInfo: UiInfo | null;
  adapters: AdapterInfo[];
  detectedAgents: AgentDetectionResult[];
  runtimeProfiles: EnvironmentState["runtimeProfiles"];
  runtimeReadiness: RuntimeReadinessProjection[];
  taskPacks: TaskPackInfo[];
  taskPath: string;
  telemetrySummary: TelemetrySummary | null;
  runs: NormalizedRun[];
  runStatus: UiRunStatus;
  locale: Locale;
}

export function buildPilotDiagnostics(input: PilotDiagnosticsInput, generatedAt = new Date().toISOString()): PilotDiagnosticsBundle {
  const adapterRows = input.adapters.map((adapter) => {
    const detection = input.detectedAgents.find((agent) => agent.id === adapter.id);
    const projection = deriveAdapterTrialStatus(adapter, detection, input.runtimeReadiness);
    return {
      id: adapter.id,
      supportTier: projection.supportTier,
      status: projection.status,
      installed: detection?.installed ?? adapter.kind === "demo",
      version: detection?.version || null,
      errorCategory: errorCategory(projection.reason)
    };
  });
  const runtimeRows = input.runtimeProfiles.map((profile) => {
    const readiness = input.runtimeReadiness.find((entry) => entry.profile.id === profile.id);
    const state = readiness?.readiness ?? "blocked";
    return {
      agentKind: profile.agentKind,
      mode: profile.mode,
      readiness: state,
      receiptMatch: readiness?.receiptMatch === true,
      stages: (readiness?.stages ?? []).map((stage) => ({ stage: stage.stage, status: stage.status })),
      nextStep: nextStep(state, input.locale)
    };
  });
  const task = input.taskPacks.find((candidate) => candidate.path === input.taskPath);
  const recent = latestRun(input.runs);
  const outcome = recent ? deriveRunOutcome(recent) : null;
  const telemetry = input.telemetrySummary;
  return {
    schema: PILOT_DIAGNOSTICS_SCHEMA,
    generatedAt,
    product: {
      version: input.uiInfo?.version?.version ?? null,
      build: typeof input.uiInfo?.version?.buildNumber === "number" ? input.uiInfo.version.buildNumber : null,
      gitCommit: input.uiInfo?.version?.gitCommit ?? null,
      nodeMajor: typeof input.uiInfo?.nodeMajor === "number" ? input.uiInfo.nodeMajor : null,
      platform: input.uiInfo?.platform ?? null
    },
    adapters: adapterRows,
    runtime: {
      profiles: runtimeRows,
      verificationState: input.runStatus.state === "running" ? "running" : runtimeRows.some((row) => row.readiness === "task-ready" && row.receiptMatch) ? "task-ready" : "not-ready"
    },
    taskPack: {
      id: task?.id ?? null,
      lifecycle: task?.lifecycle ?? null,
      repoType: taskRepositoryType(task),
      compatibilityStatus: task?.compatibility?.status ?? null
    },
    recentRun: {
      outcome: outcome?.evaluation ?? null,
      integrity: recent?.integrity ?? null,
      agentCount: recent?.results.length ?? 0,
      state: input.runStatus.state
    },
    telemetry: {
      enabled: telemetry?.enabled === true,
      totalEvents: telemetry?.totalEvents ?? 0,
      events: { ...(telemetry?.events ?? {}) }
    }
  };
}

export function pilotDiagnosticsMarkdown(bundle: PilotDiagnosticsBundle, locale: Locale): string {
  const title = locale === "zh-CN" ? "# AgentArena 内部试用诊断" : "# AgentArena internal pilot diagnostics";
  const adapterLines = bundle.adapters.map((adapter) => `- ${adapter.id}: ${adapter.status} (${adapter.supportTier})${adapter.version ? `, ${adapter.version}` : ""}${adapter.errorCategory ? `, ${adapter.errorCategory}` : ""}`);
  const runtimeLines = bundle.runtime.profiles.map((profile) => `- ${profile.agentKind}: ${profile.readiness}, receiptMatch=${profile.receiptMatch}, stages=${profile.stages.map((stage) => `${stage.stage}:${stage.status}`).join(",") || "none"}`);
  return [
    title,
    `schema: ${bundle.schema}`,
    `build: ${bundle.product.version ?? "unknown"} (${bundle.product.build ?? "unknown"}), commit=${bundle.product.gitCommit ?? "unknown"}`,
    `platform: ${bundle.product.platform ?? "unknown"}, node=${bundle.product.nodeMajor ?? "unknown"}`,
    "",
    locale === "zh-CN" ? "## Adapters" : "## Adapters",
    ...(adapterLines.length > 0 ? adapterLines : ["- none"]),
    locale === "zh-CN" ? "## Runtime" : "## Runtime",
    ...(runtimeLines.length > 0 ? runtimeLines : ["- none"]),
    `taskPack: ${bundle.taskPack.id ?? "unknown"}, repoType=${bundle.taskPack.repoType}, compatibility=${bundle.taskPack.compatibilityStatus ?? "unknown"}`,
    `recentRun: outcome=${bundle.recentRun.outcome ?? "unknown"}, integrity=${bundle.recentRun.integrity ?? "unknown"}, agents=${bundle.recentRun.agentCount}, state=${bundle.recentRun.state}`,
    `telemetry: enabled=${bundle.telemetry.enabled}, totalEvents=${bundle.telemetry.totalEvents}`
  ].join("\n");
}
