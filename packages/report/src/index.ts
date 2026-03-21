import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type AdapterPreflightResult,
  type AgentRequestedConfig,
  type AgentResolvedRuntime,
  type BenchmarkRun,
  ensureDirectory,
  formatDuration,
  portableBasename,
  portableRelativePath
} from "@repoarena/core";

// Internationalization support
export type Locale = "en" | "zh-CN";

export interface ReportTranslations {
  title: string;
  summary: string;
  adapterPreflight: string;
  benchmarkResults: string;
  setup: string;
  teardown: string;
  judges: string;
  changedFiles: string;
  diffBreakdown: string;
  added: string;
  changed: string;
  removed: string;
  noCommandsExecuted: string;
  noJudgesExecuted: string;
  noDiffDetected: string;
  none: string;
  pass: string;
  fail: string;
  debugOutput: string;
  stdout: string;
  stderr: string;
  cwd: string;
  successRate: string;
  failed: string;
  totalTokens: string;
  knownCost: string;
  badgeEndpoint: string;
  note: string;
  taskLibrary: string;
  repoTypes: string;
  objective: string;
  judgeRationale: string;
  provider: string;
  providerKind: string;
  providerSource: string;
  model: string;
  reasoning: string;
  verification: string;
  source: string;
  supportTier: string;
  invocation: string;
  tokens: string;
  cost: string;
  trace: string;
  authPrerequisites: string;
  knownLimitations: string;
  variant: string;
  baseAgent: string;
  status: string;
  duration: string;
  judgesPassed: string;
  filesChanged: string;
  preflight: string;
  run: string;
  attention: string;
  reviewTable: string;
  reviewFocus: string;
  artifacts: string;
  artifactsNote: string;
  noWarningsOrFailures: string;
  riskNote: string;
  prompt: string;
  generatedAt: string;
  forRun: string;
  comparesModelConfigurations: string;
  baselineRepoHealthNote: string;
}

const translations: Record<Locale, ReportTranslations> = {
  en: {
    title: "RepoArena Report",
    summary: "RepoArena Summary",
    adapterPreflight: "Adapter Preflight",
    benchmarkResults: "Benchmark Results",
    setup: "Setup",
    teardown: "Teardown",
    judges: "Judges",
    changedFiles: "Changed Files",
    diffBreakdown: "Diff Breakdown",
    added: "Added",
    changed: "Changed",
    removed: "Removed",
    noCommandsExecuted: "No commands executed.",
    noJudgesExecuted: "No judges executed.",
    noDiffDetected: "No diff detected.",
    none: "None",
    pass: "pass",
    fail: "fail",
    debugOutput: "Debug output",
    stdout: "stdout",
    stderr: "stderr",
    cwd: "cwd",
    successRate: "Success Rate",
    failed: "Failed",
    totalTokens: "Total Tokens",
    knownCost: "Known Cost",
    badgeEndpoint: "Badge Endpoint",
    note: "Note",
    taskLibrary: "Task Library",
    repoTypes: "Repo Types",
    objective: "Objective",
    judgeRationale: "Judge Rationale",
    provider: "Provider",
    providerKind: "Provider Kind",
    providerSource: "Provider Source",
    model: "Model",
    reasoning: "Reasoning",
    verification: "Verification",
    source: "Source",
    supportTier: "Support Tier",
    invocation: "Invocation",
    tokens: "Tokens",
    cost: "Cost",
    trace: "Trace",
    authPrerequisites: "Auth Prerequisites",
    knownLimitations: "Known Limitations",
    variant: "Variant",
    baseAgent: "Base Agent",
    status: "Status",
    duration: "Duration",
    judgesPassed: "Judges",
    filesChanged: "Files",
    preflight: "Preflight",
    run: "Run",
    attention: "Attention",
    reviewTable: "Review Table",
    reviewFocus: "Review Focus",
    artifacts: "Artifacts",
    artifactsNote: "Use `report.html` for drill-down, `summary.md` for share text, and `badge.json` for Shields endpoint output.",
    noWarningsOrFailures: "No warnings or failures in this run.",
    riskNote: "This result was produced through a provider-switched Claude Code configuration.",
    prompt: "Prompt",
    generatedAt: "Generated at",
    forRun: "for run",
    comparesModelConfigurations: "This report compares specific model configurations, not just adapter names.",
    baselineRepoHealthNote: "For baseline repo-health tasks, success only means the agent completed a small improvement without breaking baseline repository structure."
  },
  "zh-CN": {
    title: "RepoArena 报告",
    summary: "RepoArena 摘要",
    adapterPreflight: "适配器预检",
    benchmarkResults: "基准测试结果",
    setup: "设置",
    teardown: "清理",
    judges: "评判器",
    changedFiles: "变更文件",
    diffBreakdown: "差异分解",
    added: "新增",
    changed: "修改",
    removed: "删除",
    noCommandsExecuted: "未执行任何命令。",
    noJudgesExecuted: "未执行任何评判器。",
    noDiffDetected: "未检测到差异。",
    none: "无",
    pass: "通过",
    fail: "失败",
    debugOutput: "调试输出",
    stdout: "标准输出",
    stderr: "标准错误",
    cwd: "工作目录",
    successRate: "成功率",
    failed: "失败",
    totalTokens: "总令牌数",
    knownCost: "已知成本",
    badgeEndpoint: "徽章端点",
    note: "注意",
    taskLibrary: "任务库",
    repoTypes: "仓库类型",
    objective: "目标",
    judgeRationale: "评判依据",
    provider: "提供商",
    providerKind: "提供商类型",
    providerSource: "提供商来源",
    model: "模型",
    reasoning: "推理",
    verification: "验证",
    source: "来源",
    supportTier: "支持级别",
    invocation: "调用方式",
    tokens: "令牌",
    cost: "成本",
    trace: "追踪",
    authPrerequisites: "认证前提",
    knownLimitations: "已知限制",
    variant: "变体",
    baseAgent: "基础代理",
    status: "状态",
    duration: "耗时",
    judgesPassed: "评判器",
    filesChanged: "文件",
    preflight: "预检",
    run: "运行",
    attention: "关注",
    reviewTable: "审查表",
    reviewFocus: "审查重点",
    artifacts: "产物",
    artifactsNote: "使用 `report.html` 进行详细查看，`summary.md` 用于分享文本，`badge.json` 用于 Shields 端点输出。",
    noWarningsOrFailures: "本次运行没有警告或失败。",
    riskNote: "此结果是通过提供商切换的 Claude Code 配置生成的。",
    prompt: "提示词",
    generatedAt: "生成于",
    forRun: "运行",
    comparesModelConfigurations: "此报告比较特定的模型配置，而不仅仅是适配器名称。",
    baselineRepoHealthNote: "对于基线仓库健康任务，成功仅意味着代理完成了小幅改进而没有破坏基线仓库结构。"
  }
};

function _getTranslations(locale: Locale = "en"): ReportTranslations {
  return translations[locale] || translations.en;
}

interface BadgePayload {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

type ScoredResult = BenchmarkRun["results"][number] & {
  compositeScore?: number;
  scoreReasons?: string[];
};

type ScoredRun = BenchmarkRun & {
  scoreMode?: string;
  scoreWeights?: Record<string, number>;
  results: ScoredResult[];
};

function hasScoreMetadata(run: BenchmarkRun): run is BenchmarkRun & { scoreMode?: string; scoreWeights?: Record<string, number> } {
  return "scoreMode" in run || "scoreWeights" in run;
}

function getRunScoreMode(run: BenchmarkRun): string {
  return hasScoreMetadata(run) ? (run.scoreMode ?? "balanced") : "balanced";
}

function formatSupportTier(value: AdapterPreflightResult["capability"]["supportTier"]): string {
  switch (value) {
    case "supported":
      return "supported";
    case "experimental":
      return "experimental";
    case "blocked":
      return "blocked";
  }
}

function formatAvailability(
  value: AdapterPreflightResult["capability"]["tokenAvailability"]
): string {
  switch (value) {
    case "available":
      return "available";
    case "estimated":
      return "estimated";
    case "unavailable":
      return "unavailable";
  }
}

function formatTraceRichness(value: AdapterPreflightResult["capability"]["traceRichness"]): string {
  switch (value) {
    case "full":
      return "full";
    case "partial":
      return "partial";
    case "minimal":
      return "minimal";
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusTone(status: AdapterPreflightResult["status"]): string {
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

function sanitizeRun(run: BenchmarkRun): BenchmarkRun {
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
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      judgeResults: result.judgeResults.map((judge) => ({
        ...judge,
        cwd: judge.cwd
          ? sanitizeWorkspaceScopedPath(judge.cwd, result.workspacePath, result.agentId)
          : undefined
      })),
      teardownResults: result.teardownResults.map((step) => ({
        ...step,
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      tracePath: sanitizePath(result.tracePath, run.outputPath, "run"),
      workspacePath: `workspace/${portableBasename(result.workspacePath)}`
    }))
  };
}

function summarizeRun(run: BenchmarkRun): {
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

function findJudgeByType(result: BenchmarkRun["results"][number], type: string) {
  return result.judgeResults.find((judge) => judge.type === type);
}

function formatTestMetric(result: BenchmarkRun["results"][number]): string {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return "n/a";
  }

  return `${judge.passedCount ?? 0}/${judge.totalCount}`;
}

function formatLintMetric(result: BenchmarkRun["results"][number]): string {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return "n/a";
  }

  return `${judge.errorCount ?? 0}E/${judge.warningCount ?? 0}W`;
}

function formatDiffPrecisionMetric(result: BenchmarkRun["results"][number]): string {
  return typeof result.diffPrecision?.score === "number"
    ? `${Math.round(result.diffPrecision.score * 100)}%`
    : "n/a";
}

function judgePassRatio(result: BenchmarkRun["results"][number]): number {
  if (result.judgeResults.length === 0) {
    return 0;
  }

  return result.judgeResults.filter((judge) => judge.success).length / result.judgeResults.length;
}

function testPassRatio(result: BenchmarkRun["results"][number]): number {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return 0;
  }

  return judge.totalCount > 0 ? (judge.passedCount ?? 0) / judge.totalCount : judge.success ? 1 : 0;
}

function lintQualityScore(result: BenchmarkRun["results"][number]): number {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return 0;
  }

  const errors = judge.errorCount ?? 0;
  const warnings = judge.warningCount ?? 0;
  return 1 / (1 + errors * 10 + warnings);
}

function durationEfficiencyScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const durations = run.results.map((entry) => entry.durationMs).filter((value) => value > 0);
  if (durations.length === 0) {
    return 0;
  }

  const fastest = Math.min(...durations);
  return fastest / Math.max(result.durationMs, fastest);
}

function costEfficiencyScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const costs = run.results.filter((entry) => entry.costKnown && entry.estimatedCostUsd > 0).map((entry) => entry.estimatedCostUsd);
  if (!result.costKnown || result.estimatedCostUsd <= 0 || costs.length === 0) {
    return 0;
  }

  const cheapest = Math.min(...costs);
  return cheapest / Math.max(result.estimatedCostUsd, cheapest);
}

function computeCompositeScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const weightedScore =
    (result.status === "success" ? 1 : 0) * 0.3 +
    testPassRatio(result) * 0.25 +
    Math.max(judgePassRatio(result), 0) * 0.15 +
    lintQualityScore(result) * 0.1 +
    Math.max(result.diffPrecision?.score ?? 0, 0) * 0.1 +
    durationEfficiencyScore(result, run) * 0.06 +
    costEfficiencyScore(result, run) * 0.04;

  return Math.round(weightedScore * 1000) / 10;
}

function computeScoreReasons(result: BenchmarkRun["results"][number], run: BenchmarkRun): string[] {
  const reasons: string[] = [];
  if (testPassRatio(result) >= 0.999) reasons.push("tests");
  if (lintQualityScore(result) >= 0.999) reasons.push("lint");
  if ((result.diffPrecision?.score ?? 0) >= 0.999) reasons.push("precision");
  if (judgePassRatio(result) >= 0.999) reasons.push("judges");
  if (durationEfficiencyScore(result, run) >= 0.999) reasons.push("duration");
  if (costEfficiencyScore(result, run) >= 0.999) reasons.push("cost");
  return reasons;
}

function enrichRunWithScores(run: BenchmarkRun): ScoredRun {
  const scoreWeights = (hasScoreMetadata(run) ? run.scoreWeights : undefined) ?? {
    status: 0.3,
    tests: 0.25,
    judges: 0.15,
    lint: 0.1,
    precision: 0.1,
    duration: 0.06,
    cost: 0.04
  };
  return {
    ...run,
    scoreMode: hasScoreMetadata(run) ? (run.scoreMode ?? "balanced") : "balanced",
    scoreWeights,
    results: run.results.map((result) => ({
      ...result,
      compositeScore: computeCompositeScore(result, run),
      scoreReasons: computeScoreReasons(result, run)
    }))
  };
}

function formatRuntimeIdentity(result: {
  requestedConfig?: AgentRequestedConfig;
  resolvedRuntime?: AgentResolvedRuntime;
}): {
  provider: string;
  providerKind: string;
  providerSource: string;
  model: string;
  reasoning: string;
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
    source: result.resolvedRuntime?.source ?? "unknown",
    verification: result.resolvedRuntime?.verification ?? "unknown"
  };
}

function buildBadgePayload(run: BenchmarkRun): BadgePayload {
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
    label: "RepoArena",
    message,
    color
  };
}

function renderCommandStepList(
  title: string,
  steps: Array<{
    label: string;
    success: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    cwd: string;
  }>
): string {
  const items =
    steps.length === 0
      ? "<li>No commands executed.</li>"
      : steps
          .map(
            (step) =>
              `<li><strong>${escapeHtml(step.label)}</strong>: ${
                step.success ? "pass" : "fail"
              } (${escapeHtml(formatDuration(step.durationMs))})${
                step.stdout || step.stderr
                  ? `<details><summary>Debug output</summary>${
                      step.stdout
                        ? `<p class="meta"><strong>stdout</strong></p><pre>${escapeHtml(step.stdout)}</pre>`
                        : ""
                    }${
                      step.stderr
                        ? `<p class="meta"><strong>stderr</strong></p><pre>${escapeHtml(step.stderr)}</pre>`
                        : ""
                    }<p class="meta">cwd: ${escapeHtml(step.cwd)}</p></details>`
                  : ""
              }</li>`
          )
          .join("");

  return `<h3>${escapeHtml(title)}</h3><ul>${items}</ul>`;
}

function renderJudgeList(run: BenchmarkRun["results"][number]): string {
  const items =
    run.judgeResults.length === 0
      ? "<li>No judges executed.</li>"
      : run.judgeResults
          .map((judge) => {
            const meta = [
              `type=${judge.type}`,
              judge.target ? `target=${judge.target}` : "",
              judge.expectation ? `expect=${judge.expectation}` : "",
              judge.cwd ? `cwd=${judge.cwd}` : "",
              judge.command ? `command=${judge.command}` : ""
            ]
              .filter(Boolean)
              .join(" | ");

            return `<li><strong>${escapeHtml(judge.label)}</strong>: ${
              judge.success ? "pass" : "fail"
            } (${escapeHtml(formatDuration(judge.durationMs))})${
              meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""
            }${
              judge.stdout || judge.stderr
                ? `<details><summary>Debug output</summary>${
                    judge.stdout
                      ? `<p class="meta"><strong>stdout</strong></p><pre>${escapeHtml(judge.stdout)}</pre>`
                      : ""
                  }${
                    judge.stderr
                      ? `<p class="meta"><strong>stderr</strong></p><pre>${escapeHtml(judge.stderr)}</pre>`
                      : ""
                  }</details>`
                : ""
            }</li>`;
          })
          .join("");

  return `<h3>Judges</h3><ul>${items}</ul>`;
}

function renderPreflights(run: BenchmarkRun): string {
  return run.preflights
    .map((preflight) => {
      const runtime = formatRuntimeIdentity(preflight);
      const details = (preflight.details ?? [])
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("");

      return `
        <section class="preflight ${statusTone(preflight.status)}">
          <h2>${escapeHtml(preflight.displayLabel ?? preflight.agentTitle ?? preflight.agentId)} <span>${escapeHtml(preflight.variantId ?? preflight.agentId)}</span></h2>
          <p><strong>${escapeHtml(preflight.status)}</strong> ${escapeHtml(preflight.summary)}</p>
          <p class="meta">Variant: ${escapeHtml(preflight.displayLabel ?? preflight.agentTitle ?? preflight.agentId)}</p>
          <p class="meta">Base Agent: ${escapeHtml(preflight.baseAgentId ?? preflight.agentId)}</p>
          <p class="meta">Provider: ${escapeHtml(runtime.provider)} | Kind: ${escapeHtml(runtime.providerKind)} | Provider Source: ${escapeHtml(runtime.providerSource)}</p>
          <p class="meta">Support tier: ${escapeHtml(formatSupportTier(preflight.capability.supportTier))}</p>
          <p class="meta">Invocation: ${escapeHtml(preflight.capability.invocationMethod)}</p>
          <p class="meta">Model: ${escapeHtml(runtime.model)} | Reasoning: ${escapeHtml(
            runtime.reasoning
          )} | Verification: ${escapeHtml(runtime.verification)} | Source: ${escapeHtml(runtime.source)}</p>
          <p class="meta">Tokens: ${escapeHtml(formatAvailability(preflight.capability.tokenAvailability))} | Cost: ${escapeHtml(
            formatAvailability(preflight.capability.costAvailability)
          )} | Trace: ${escapeHtml(formatTraceRichness(preflight.capability.traceRichness))}</p>
          ${
            preflight.capability.authPrerequisites.length > 0
              ? `<p class="meta">Auth prerequisites: ${escapeHtml(preflight.capability.authPrerequisites.join("; "))}</p>`
              : ""
          }
          ${
            preflight.capability.knownLimitations.length > 0
              ? `<p class="meta">Known limitations: ${escapeHtml(preflight.capability.knownLimitations.join("; "))}</p>`
              : ""
          }
          ${
            preflight.command
              ? `<p class="meta">Invocation: ${escapeHtml(preflight.command)}</p>`
              : ""
          }
          ${details ? `<ul>${details}</ul>` : ""}
        </section>
      `;
    })
    .join("");
}

function renderAgentCards(run: BenchmarkRun): string {
  return (run.results as ScoredResult[])
    .map((result) => {
      const runtime = formatRuntimeIdentity(result);
      const changedFiles = result.changedFiles;
      const addedFiles =
        result.diff.added.length === 0
          ? "<li>None</li>"
          : result.diff.added.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
      const changedDiffFiles =
        result.diff.changed.length === 0
          ? "<li>None</li>"
          : result.diff.changed.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
      const removedFiles =
        result.diff.removed.length === 0
          ? "<li>None</li>"
          : result.diff.removed.map((file) => `<li>${escapeHtml(file)}</li>`).join("");

      return `
        <section class="card">
          <h2>${escapeHtml(result.displayLabel ?? result.agentTitle ?? result.agentId)} <span>${escapeHtml(result.variantId ?? result.agentId)}</span></h2>
          <p>${escapeHtml(result.summary)}</p>
          <p class="meta">Preflight: ${escapeHtml(result.preflight.status)} - ${escapeHtml(
            result.preflight.summary
          )}</p>
          <p class="meta">Model: ${escapeHtml(runtime.model)} | Reasoning: ${escapeHtml(
            runtime.reasoning
          )} | Verification: ${escapeHtml(runtime.verification)} | Source: ${escapeHtml(runtime.source)}</p>
          <div class="stats">
            <div><strong>Status</strong><span>${result.status}</span></div>
            <div><strong>Composite Score</strong><span>${(result.compositeScore ?? 0).toFixed(1)}</span></div>
            <div><strong>Duration</strong><span>${escapeHtml(formatDuration(result.durationMs))}</span></div>
            <div><strong>Tokens</strong><span>${result.tokenUsage}</span></div>
            <div><strong>Cost</strong><span>${
              result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
            }</span></div>
            <div><strong>Tests</strong><span>${escapeHtml(formatTestMetric(result))}</span></div>
            <div><strong>Lint</strong><span>${escapeHtml(formatLintMetric(result))}</span></div>
            <div><strong>Diff Precision</strong><span>${escapeHtml(formatDiffPrecisionMetric(result))}</span></div>
          </div>
          ${result.scoreReasons && result.scoreReasons.length > 0 ? `<p class="meta">Score Reasons: ${escapeHtml(result.scoreReasons.join(", "))}</p>` : ""}
          ${renderCommandStepList("Setup", result.setupResults)}
          <h3>Model Identity</h3>
          <ul>
            <li><strong>Provider</strong>: ${escapeHtml(runtime.provider)} (${escapeHtml(runtime.providerKind)}) via ${escapeHtml(runtime.providerSource)}</li>
            <li><strong>Requested</strong>: model=${escapeHtml(result.requestedConfig?.model ?? "default")} | reasoning=${escapeHtml(
              result.requestedConfig?.reasoningEffort ?? "default"
            )}</li>
            <li><strong>Effective</strong>: model=${escapeHtml(runtime.model)} | reasoning=${escapeHtml(
              runtime.reasoning
            )}</li>
            <li><strong>Source</strong>: ${escapeHtml(runtime.source)}</li>
            <li><strong>Verification</strong>: ${escapeHtml(runtime.verification)}</li>
          </ul>
          ${
            runtime.providerKind !== "official" && runtime.provider !== "official"
              ? `<p class="meta">This result was produced through a provider-switched Claude Code configuration.</p>`
              : ""
          }
          ${renderJudgeList(result)}
          ${renderCommandStepList("Teardown", result.teardownResults)}
          <h3>Changed Files</h3>
          <ul>${
            changedFiles.length === 0
              ? "<li>No diff detected.</li>"
              : changedFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join("")
          }</ul>
          <h3>Diff Breakdown</h3>
          <p class="meta">Added</p>
          <ul>${addedFiles}</ul>
          <p class="meta">Changed</p>
          <ul>${changedDiffFiles}</ul>
          <p class="meta">Removed</p>
          <ul>${removedFiles}</ul>
          <p class="meta">Trace: ${escapeHtml(result.tracePath)}</p>
          <p class="meta">Workspace: ${escapeHtml(result.workspacePath)}</p>
        </section>
      `;
    })
    .join("");
}

function renderHtml(run: BenchmarkRun): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RepoArena Report - ${escapeHtml(run.task.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --card: #fffdf7;
        --ink: #1f1b16;
        --muted: #6c6458;
        --accent: #b04a2b;
        --border: #dfd1bd;
        --ready: #315f43;
        --unverified: #946c14;
        --blocked: #8f3426;
        --missing: #5b5762;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(176, 74, 43, 0.12), transparent 25%),
          linear-gradient(180deg, #f8f4ec 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 48px 20px 72px;
      }
      header { margin-bottom: 28px; }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2.4rem, 5vw, 4.4rem);
        line-height: 0.95;
      }
      .lede {
        max-width: 760px;
        color: var(--muted);
        font-size: 1.05rem;
      }
      .section-title {
        margin: 32px 0 14px;
        font-size: 1.35rem;
      }
      .preflights, .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
      }
      .preflight, .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 22px;
        box-shadow: 0 18px 40px rgba(49, 34, 19, 0.07);
      }
      .tone-ready { border-left: 8px solid var(--ready); }
      .tone-unverified { border-left: 8px solid var(--unverified); }
      .tone-blocked { border-left: 8px solid var(--blocked); }
      .tone-missing { border-left: 8px solid var(--missing); }
      h2 {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-top: 0;
      }
      h2 span {
        color: var(--muted);
        font-size: 0.9rem;
      }
      h3 { margin-bottom: 8px; }
      .stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin: 18px 0;
      }
      .stats div {
        display: flex;
        flex-direction: column;
        padding: 12px;
        border-radius: 14px;
        background: rgba(176, 74, 43, 0.08);
      }
      .stats strong {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .stats span {
        margin-top: 6px;
        font-size: 1.15rem;
      }
      ul { padding-left: 18px; }
      .meta {
        color: var(--muted);
        font-size: 0.9rem;
        word-break: break-word;
      }
      pre {
        overflow-x: auto;
        padding: 12px;
        border-radius: 12px;
        background: rgba(31, 27, 22, 0.06);
        white-space: pre-wrap;
      }
      details {
        margin-top: 8px;
      }
      footer {
        margin-top: 24px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>RepoArena Report</h1>
        <p class="lede">${escapeHtml(run.task.title)} in ${escapeHtml(run.repoPath)}. Generated at ${escapeHtml(
          run.createdAt
        )} for run ${escapeHtml(run.runId)}.</p>
        ${
          run.task.metadata
            ? `<p class="lede">Objective: ${escapeHtml(run.task.metadata.objective ?? "n/a")} | Judge rationale: ${escapeHtml(
                run.task.metadata.judgeRationale ?? "n/a"
              )}</p>`
            : ""
        }
        <p class="lede">This report compares specific model configurations, not just adapter names. For baseline repo-health tasks, success only means the agent completed a small improvement without breaking baseline repository structure.</p>
      </header>
      <h2 class="section-title">Adapter Preflight</h2>
      <section class="preflights">
        ${renderPreflights(run)}
      </section>
      <h2 class="section-title">Benchmark Results</h2>
      <section class="cards">
        ${renderAgentCards(run)}
      </section>
      <footer>
        <p>Prompt: ${escapeHtml(run.task.prompt)}</p>
        ${
          run.task.metadata
            ? `<p>Task library: ${escapeHtml(run.task.metadata.source)} by ${escapeHtml(run.task.metadata.owner)} | Repo types: ${escapeHtml(
                run.task.metadata.repoTypes.join(", ")
              )}</p>`
            : ""
        }
      </footer>
    </main>
  </body>
</html>`;
}

function renderMarkdown(run: BenchmarkRun): string {
  const summary = summarizeRun(run);
  const failedResults = run.results.filter((result) => result.status !== "success");
  const lines: string[] = [
    "# RepoArena Summary",
    "",
    `- Run ID: \`${run.runId}\``,
    `- Created At: \`${run.createdAt}\``,
    `- Task: \`${run.task.title}\``,
    `- Score Mode: \`${getRunScoreMode(run)}\``,
    `- Repository: \`${run.repoPath}\``,
    ...(run.task.metadata
      ? [
          `- Task Library: \`${run.task.metadata.source}\` by \`${run.task.metadata.owner}\``,
          `- Repo Types: \`${run.task.metadata.repoTypes.join(", ") || "unspecified"}\``,
          `- Objective: \`${run.task.metadata.objective ?? "unspecified"}\``,
          `- Judge Rationale: \`${run.task.metadata.judgeRationale ?? "unspecified"}\``
        ]
      : []),
    `- Success Rate: \`${summary.successCount}/${summary.totalAgents}\``,
    `- Failed: \`${summary.failedCount}\``,
    `- Total Tokens: \`${summary.totalTokens}\` | Known Cost: \`$${summary.knownCostUsd.toFixed(2)}\``,
    `- Badge Endpoint: \`badge.json\``,
    "- Note: This run compares concrete agent variants. For baseline repo-health tasks, success is a sanity check, not a code-review score.",
    ""
  ];

  lines.push("## Adapter Preflight", "");
  lines.push("| Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Verification | Status | Summary |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const preflight of run.preflights) {
    const runtime = formatRuntimeIdentity(preflight);
    lines.push(
      `| ${preflight.displayLabel} | ${preflight.baseAgentId} | ${runtime.provider} | ${runtime.providerKind} | ${runtime.model} | ${runtime.reasoning} | ${runtime.verification}/${runtime.source} | ${preflight.status} | ${preflight.summary.replaceAll("\n", " ")} |`
    );
  }

  lines.push("", "## Capability Matrix", "");
  lines.push("| Variant | Base Agent | Tier | Invocation | Tokens | Cost | Trace |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const preflight of run.preflights) {
    lines.push(
      `| ${preflight.displayLabel} | ${preflight.baseAgentId} | ${formatSupportTier(preflight.capability.supportTier)} | ${preflight.capability.invocationMethod.replaceAll("\n", " ")} | ${formatAvailability(preflight.capability.tokenAvailability)} | ${formatAvailability(preflight.capability.costAvailability)} | ${formatTraceRichness(preflight.capability.traceRichness)} |`
    );
    if (preflight.capability.knownLimitations.length > 0) {
      lines.push(
        `|  | limitations | ${preflight.capability.knownLimitations.join("; ").replaceAll("\n", " ")} |  |  |  |`
      );
    }
  }

  lines.push("", "## Results", "");
  const scoredResults = run.results as ScoredResult[];
  lines.push("| Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Verification | Status | Score | Duration | Tokens | Cost | Changed Files | Judges | Tests | Lint | Diff Precision |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | ---: | --- | --- | --- | --- |");
  for (const result of scoredResults) {
    const runtime = formatRuntimeIdentity(result);
    const passedJudgeCount = result.judgeResults.filter((judge) => judge.success).length;
    lines.push(
      `| ${result.displayLabel} | ${result.baseAgentId} | ${runtime.provider} | ${runtime.providerKind} | ${runtime.model} | ${runtime.reasoning} | ${runtime.verification}/${runtime.source} | ${result.status} | ${(result.compositeScore ?? 0).toFixed(1)} | ${formatDuration(result.durationMs)} | ${result.tokenUsage} | ${
        result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
      } | ${result.changedFiles.length} | ${passedJudgeCount}/${result.judgeResults.length} | ${formatTestMetric(result)} | ${formatLintMetric(result)} | ${formatDiffPrecisionMetric(result)} |`
    );
  }

  if (failedResults.length > 0) {
    lines.push("", "## Failures", "");
    for (const result of failedResults) {
      lines.push(`- \`${result.agentId}\`: ${result.summary}`);
      const failedJudges = result.judgeResults.filter((judge) => !judge.success);
      for (const judge of failedJudges) {
        lines.push(
          `  - judge \`${judge.label}\` (${judge.type})${judge.target ? ` target=${judge.target}` : ""}${
            judge.expectation ? ` expect=${judge.expectation}` : ""
          }`
        );
      }
    }
  }

  for (const result of scoredResults) {
    const runtime = formatRuntimeIdentity(result);
    lines.push("", `### ${result.displayLabel} (\`${result.variantId}\`)`, "");
    lines.push(`- Summary: ${result.summary}`);
    lines.push(`- Preflight: ${result.preflight.status} - ${result.preflight.summary}`);
    lines.push(
      `- Provider Identity: provider=${runtime.provider} | kind=${runtime.providerKind} | provider source=${runtime.providerSource}`,
      `- Model Identity: requested=${result.requestedConfig.model ?? "default"} | requested reasoning=${result.requestedConfig.reasoningEffort ?? "default"} | effective model=${runtime.model} | effective reasoning=${runtime.reasoning} | source=${runtime.source} | verification=${runtime.verification}`
    );
    if (runtime.providerKind !== "official" && runtime.provider !== "official") {
      lines.push("- Risk Note: This result was produced through a provider-switched Claude Code configuration.");
    }
    lines.push(`- Trace: \`${result.tracePath}\``);
    lines.push(`- Workspace: \`${result.workspacePath}\``);

    if (result.changedFiles.length > 0) {
      lines.push("- Changed Files:");
      for (const file of result.changedFiles) {
        lines.push(`  - \`${file}\``);
      }
    } else {
      lines.push("- Changed Files: none");
    }

    lines.push(`- Test Result: ${formatTestMetric(result)}`);
    lines.push(`- Lint Result: ${formatLintMetric(result)}`);
    lines.push(`- Diff Precision: ${formatDiffPrecisionMetric(result)}`);
    lines.push(`- Composite Score: ${(result.compositeScore ?? 0).toFixed(1)}`);
    if ((result.scoreReasons?.length ?? 0) > 0) {
      lines.push(`- Score Reasons: ${result.scoreReasons?.join(", ")}`);
    }

    if (result.judgeResults.length > 0) {
      lines.push("- Judges:");
      for (const judge of result.judgeResults) {
        lines.push(
          `  - ${judge.label}: ${judge.success ? "pass" : "fail"} (${formatDuration(judge.durationMs)})${
            judge.target ? ` target=${judge.target}` : ""
          }${judge.expectation ? ` expect=${judge.expectation}` : ""}`
        );
      }
    }
  }

  lines.push("", "## Prompt", "", "```text", run.task.prompt, "```", "");
  return lines.join("\n");
}

function renderPrComment(run: BenchmarkRun): string {
  const summary = summarizeRun(run);
  const scoredResults = run.results as ScoredResult[];
  const failedResults = run.results.filter((result) => result.status !== "success");
  const attentionPreflights = run.preflights.filter((preflight) => preflight.status !== "ready");
  const header = [
    "## RepoArena Benchmark",
    "",
    `Task: \`${run.task.title}\``,
    "",
    `Score mode: \`${getRunScoreMode(run)}\``,
    "",
    `Overview: \`${summary.successCount}/${summary.totalAgents}\` passing | Failed: \`${summary.failedCount}\` | Tokens: \`${summary.totalTokens}\` | Known Cost: \`$${summary.knownCostUsd.toFixed(2)}\``
  ];

  const table = [
    "",
    "### Review Table",
    "",
    "| Attention | Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Verification | Tier | Preflight | Run | Score | Duration | Tokens | Cost | Judges | Tests | Lint | Diff Precision | Files | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- | ---: | --- |"
  ];

  for (const result of scoredResults) {
    const runtime = formatRuntimeIdentity(result);
    const passedJudgeCount = result.judgeResults.filter((judge) => judge.success).length;
    const failedJudge = result.judgeResults.find((judge) => !judge.success);
    const attention =
      result.status !== "success"
        ? "fail"
        : result.preflight.status !== "ready"
          ? "warn"
          : "ok";
    const note =
      result.status !== "success"
        ? result.summary
        : failedJudge
          ? `${failedJudge.label} failed`
          : result.preflight.status !== "ready"
            ? result.preflight.summary
            : "ready";
    table.push(
      `| ${attention} | ${result.displayLabel} | ${result.baseAgentId} | ${runtime.provider} | ${runtime.providerKind} | ${runtime.model} | ${runtime.reasoning} | ${runtime.verification}/${runtime.source} | ${formatSupportTier(result.preflight.capability.supportTier)} | ${result.preflight.status} | ${result.status} | ${(result.compositeScore ?? 0).toFixed(1)} | ${formatDuration(result.durationMs)} | ${result.tokenUsage} | ${
        result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
      } | ${passedJudgeCount}/${result.judgeResults.length} | ${formatTestMetric(result)} | ${formatLintMetric(result)} | ${formatDiffPrecisionMetric(result)} | ${result.changedFiles.length} | ${note.replaceAll("\n", " ")} |`
    );
  }

  const reviewFocus = ["", "### Review Focus", ""];
  if (attentionPreflights.length === 0 && failedResults.length === 0) {
    reviewFocus.push("- No warnings or failures in this run.");
  } else {
    for (const preflight of attentionPreflights) {
      reviewFocus.push(
        `- preflight \`${preflight.agentId}\` (${formatSupportTier(preflight.capability.supportTier)}): ${preflight.status} - ${preflight.summary}`
      );
    }

    for (const result of failedResults) {
      reviewFocus.push(`- result \`${result.agentId}\`: ${result.summary}`);
      const failedJudges = result.judgeResults.filter((judge) => !judge.success);
      for (const judge of failedJudges) {
        reviewFocus.push(
          `  - judge \`${judge.label}\` (${judge.type})${judge.target ? ` target=${judge.target}` : ""}${
            judge.expectation ? ` expect=${judge.expectation}` : ""
          }`
        );
      }
    }
  }

  const artifacts = [
    "",
    "### Artifacts",
    "",
    "- `summary.json`",
    "- `summary.md`",
    "- `pr-comment.md`",
    "- `report.html`",
    "- `badge.json`",
    "",
    "_Use `report.html` for drill-down, `summary.md` for share text, and `badge.json` for Shields endpoint output._"
  ];

  return [...header, ...table, ...reviewFocus, ...artifacts].join("\n");
}

export async function writeReport(
  run: BenchmarkRun
): Promise<{ htmlPath: string; jsonPath: string; markdownPath: string; badgePath: string; prCommentPath: string }> {
  await ensureDirectory(run.outputPath);
  const publicRun = sanitizeRun(enrichRunWithScores(run));

  const jsonPath = path.join(run.outputPath, "summary.json");
  const htmlPath = path.join(run.outputPath, "report.html");
  const markdownPath = path.join(run.outputPath, "summary.md");
  const badgePath = path.join(run.outputPath, "badge.json");
  const prCommentPath = path.join(run.outputPath, "pr-comment.md");

  await fs.writeFile(jsonPath, JSON.stringify(publicRun, null, 2), "utf8");
  await fs.writeFile(htmlPath, renderHtml(publicRun), "utf8");
  await fs.writeFile(markdownPath, renderMarkdown(publicRun), "utf8");
  await fs.writeFile(badgePath, JSON.stringify(buildBadgePayload(publicRun), null, 2), "utf8");
  await fs.writeFile(prCommentPath, renderPrComment(publicRun), "utf8");

  return { htmlPath, jsonPath, markdownPath, badgePath, prCommentPath };
}
