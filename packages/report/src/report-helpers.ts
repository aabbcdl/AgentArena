import path from "node:path";
import {
  type AdapterPreflightResult,
  type AgentRequestedConfig,
  type AgentResolvedRuntime,
  type BenchmarkRun,
  portableBasename,
  portableRelativePath
} from "@agentarena/core";

export type Locale = "en" | "zh-CN";

export type ReportCopy = {
  reportTitle: string;
  summaryTitle: string;
  prCommentTitle: string;
  adapterPreflightTitle: string;
  benchmarkResultsTitle: string;
  promptTitle: string;
  scoreModeLabel: string;
  scoreWeightsLabel: string;
  generatedAtLabel: string;
  runIdLabel: string;
  taskLabel: string;
  repositoryLabel: string;
  taskLibraryLabel: string;
  repoTypesLabel: string;
  objectiveLabel: string;
  judgeRationaleLabel: string;
  comparesModelConfigurations: string;
  baselineRepoHealthNote: string;
  successRateLabel: string;
  failedLabel: string;
  totalTokensLabel: string;
  knownCostLabel: string;
  badgeEndpointLabel: string;
  noteLabel: string;
  overviewLabel: string;
  reviewTableTitle: string;
  reviewFocusTitle: string;
  artifactsTitle: string;
  artifactsNote: string;
  noWarningsOrFailures: string;
  capabilityMatrixTitle: string;
  resultsTitle: string;
  failuresTitle: string;
  htmlReportTitlePrefix: string;
  htmlGeneratedAtLabel: string;
};

const REPORT_COPY: Record<Locale, ReportCopy> = {
  en: {
    reportTitle: "AgentArena Report",
    summaryTitle: "AgentArena Summary",
    prCommentTitle: "AgentArena Benchmark",
    adapterPreflightTitle: "Adapter Preflight",
    benchmarkResultsTitle: "Benchmark Results",
    promptTitle: "Prompt",
    scoreModeLabel: "Score Mode",
    scoreWeightsLabel: "Score Weights",
    generatedAtLabel: "Created At",
    runIdLabel: "Run ID",
    taskLabel: "Task",
    repositoryLabel: "Repository",
    taskLibraryLabel: "Task Library",
    repoTypesLabel: "Repo types",
    objectiveLabel: "Objective",
    judgeRationaleLabel: "Judge rationale",
    comparesModelConfigurations: "This report compares specific model configurations, not just adapter names.",
    baselineRepoHealthNote:
      "For baseline repo-health tasks, success only means the agent completed a small improvement without breaking baseline repository structure.",
    successRateLabel: "Success Rate",
    failedLabel: "Failed",
    totalTokensLabel: "Total Tokens",
    knownCostLabel: "Known Cost",
    badgeEndpointLabel: "Badge Endpoint",
    noteLabel: "Note",
    overviewLabel: "Overview",
    reviewTableTitle: "Review Table",
    reviewFocusTitle: "Review Focus",
    artifactsTitle: "Artifacts",
    artifactsNote: "Use `report.html` for drill-down, `summary.md` for share text, and `badge.json` for Shields endpoint output.",
    noWarningsOrFailures: "No warnings or failures in this run.",
    capabilityMatrixTitle: "Capability Matrix",
    resultsTitle: "Results",
    failuresTitle: "Failures",
    htmlReportTitlePrefix: "AgentArena Report -",
    htmlGeneratedAtLabel: "Generated at",
  },
  "zh-CN": {
    reportTitle: "AgentArena 报告",
    summaryTitle: "AgentArena 摘要",
    prCommentTitle: "AgentArena 评审摘要",
    adapterPreflightTitle: "适配器预检",
    benchmarkResultsTitle: "跑分结果",
    promptTitle: "提示词",
    scoreModeLabel: "评分模式",
    scoreWeightsLabel: "评分权重",
    generatedAtLabel: "生成时间",
    runIdLabel: "运行 ID",
    taskLabel: "任务",
    repositoryLabel: "仓库",
    taskLibraryLabel: "任务库",
    repoTypesLabel: "仓库类型",
    objectiveLabel: "目标",
    judgeRationaleLabel: "判定理由",
    comparesModelConfigurations: "这份报告比较的是具体模型配置，而不只是适配器名称。",
    baselineRepoHealthNote: "对于基础仓库健康检查任务，成功只表示模型完成了一个小改进，并且没有破坏仓库的基础结构。",
    successRateLabel: "成功率",
    failedLabel: "失败",
    totalTokensLabel: "总 Tokens",
    knownCostLabel: "已知成本",
    badgeEndpointLabel: "徽章接口",
    noteLabel: "说明",
    overviewLabel: "总览",
    reviewTableTitle: "检查表",
    reviewFocusTitle: "重点关注",
    artifactsTitle: "产物",
    artifactsNote: "用 `report.html` 看细节，用 `summary.md` 分享文本，用 `badge.json` 给 Shields 接口输出。",
    noWarningsOrFailures: "本次运行没有警告或失败。",
    capabilityMatrixTitle: "能力矩阵",
    resultsTitle: "结果",
    failuresTitle: "失败项",
    htmlReportTitlePrefix: "AgentArena 报告 -",
    htmlGeneratedAtLabel: "生成时间"
  }
};

export function getReportCopy(locale: Locale): ReportCopy {
  return REPORT_COPY[locale] ?? REPORT_COPY.en;
}

export type ScoredResult = BenchmarkRun["results"][number] & {
  compositeScore?: number;
  scoreReasons?: string[];
};

export type ScoredRun = BenchmarkRun & {
  scoreMode?: string;
  scoreWeights?: Record<string, number>;
  results: ScoredResult[];
};

export function hasScoreMetadata(run: BenchmarkRun): run is BenchmarkRun & { scoreMode?: string; scoreWeights?: Record<string, number> } {
  return "scoreMode" in run || "scoreWeights" in run;
}

export function getRunScoreMode(run: BenchmarkRun): string {
  return hasScoreMetadata(run) ? (run.scoreMode ?? "balanced") : "balanced";
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeMdCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function statusTone(status: AdapterPreflightResult["status"]): string {
  switch (status) {
    case "ready":
      return "tone-ready";
    case "unverified":
      return "tone-unverified";
    case "blocked":
      return "tone-blocked";
    case "missing":
      return "tone-missing";
  }
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function sanitizePath(value: string, basePath: string, prefix: string): string {
  const relativePath = normalizePath(portableRelativePath(basePath, value));
  if (relativePath.length > 0 && !relativePath.startsWith("..") && !/^[a-zA-Z]:/.test(relativePath)) {
    return `${prefix}/${relativePath}`;
  }

  return portableBasename(value);
}

function sanitizeWorkspaceScopedPath(value: string, workspacePath: string, agentId: string): string {
  const relativePath = normalizePath(portableRelativePath(workspacePath, value));
  if (relativePath === "") {
    return `workspace/${agentId}`;
  }

  if (!relativePath.startsWith("..") && !/^[a-zA-Z]:/.test(relativePath)) {
    return `workspace/${agentId}/${relativePath}`;
  }

  if (portableBasename(value) === agentId) {
    return `workspace/${agentId}`;
  }

  return portableBasename(value);
}

export function sanitizeRun(run: BenchmarkRun): BenchmarkRun {
  return {
    ...run,
    repoPath: ".",
    outputPath: ".",
    preflights: run.preflights.map((preflight) => ({
      ...preflight,
      command: undefined
    })),
    results: run.results.map((result) => ({
      ...result,
      preflight: {
        ...result.preflight,
        command: undefined
      },
      setupResults: result.setupResults.map((step) => ({
        ...step,
        command: "[redacted]",
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      judgeResults: result.judgeResults.map((judge) => ({
        ...judge,
        command: judge.command ? "[redacted]" : undefined,
        cwd: judge.cwd
          ? sanitizeWorkspaceScopedPath(judge.cwd, result.workspacePath, result.agentId)
          : undefined
      })),
      teardownResults: result.teardownResults.map((step) => ({
        ...step,
        command: "[redacted]",
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      tracePath: sanitizePath(result.tracePath, run.outputPath, "run"),
      workspacePath: `workspace/${portableBasename(result.workspacePath)}`
    }))
  };
}

export function summarizeRun(run: BenchmarkRun): {
  totalAgents: number;
  successCount: number;
  failedCount: number;
  totalTokens: number;
  knownCostUsd: number;
} {
  const successCount = run.results.filter((result) => result.status === "success").length;
  const failedCount = run.results.filter((result) => result.status === "failed").length;
  const totalTokens = run.results.reduce((total, result) => total + result.tokenUsage, 0);
  const knownCostUsd = run.results
    .filter((result) => result.costKnown)
    .reduce((total, result) => total + result.estimatedCostUsd, 0);

  return {
    totalAgents: run.results.length,
    successCount,
    failedCount,
    totalTokens,
    knownCostUsd
  };
}

export function findJudgeByType(result: BenchmarkRun["results"][number], type: string) {
  return result.judgeResults.find((judge) => judge.type === type);
}

export function formatTestMetric(result: BenchmarkRun["results"][number]): string {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return "n/a";
  }

  return `${judge.passedCount ?? 0}/${judge.totalCount}`;
}

export function formatLintMetric(result: BenchmarkRun["results"][number]): string {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return "n/a";
  }

  return `${judge.errorCount ?? 0}E/${judge.warningCount ?? 0}W`;
}

export function formatDiffPrecisionMetric(result: BenchmarkRun["results"][number]): string {
  return typeof result.diffPrecision?.score === "number"
    ? `${Math.round(result.diffPrecision.score * 100)}%`
    : "n/a";
}

export function formatRuntimeIdentity(result: {
  requestedConfig?: AgentRequestedConfig;
  resolvedRuntime?: AgentResolvedRuntime;
}): {
  provider: string;
  providerKind: string;
  providerSource: string;
  model: string;
  reasoning: string;
  version: string;
  versionSource: string;
  source: string;
  verification: string;
} {
  return {
    provider: result.resolvedRuntime?.providerProfileName ?? result.requestedConfig?.providerProfileId ?? "official",
    providerKind: result.resolvedRuntime?.providerKind ?? "unknown",
    providerSource: result.resolvedRuntime?.providerSource ?? "unknown",
    model: result.resolvedRuntime?.effectiveModel ?? result.requestedConfig?.model ?? "unknown",
    reasoning:
      result.resolvedRuntime?.effectiveReasoningEffort ??
      result.requestedConfig?.reasoningEffort ??
      "default",
    version: result.resolvedRuntime?.effectiveAgentVersion ?? "unknown",
    versionSource: result.resolvedRuntime?.agentVersionSource ?? "unknown",
    source: result.resolvedRuntime?.source ?? "unknown",
    verification: result.resolvedRuntime?.verification ?? "unknown"
  };
}

interface BadgePayload {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

export function buildBadgePayload(run: BenchmarkRun): BadgePayload {
  const summary = summarizeRun(run);
  const message = `${summary.successCount}/${summary.totalAgents} passing`;
  const color =
    summary.totalAgents === 0
      ? "lightgrey"
      : summary.successCount === summary.totalAgents
        ? "2f6945"
        : summary.successCount > 0
          ? "8d6715"
          : "8f3426";

  return {
    schemaVersion: 1,
    label: "AgentArena",
    message,
    color
  };
}
