import {
  type AdapterPreflightResult,
  type AgentRequestedConfig,
  type AgentResolvedRuntime,
  type BenchmarkRun,
  escapeHtml,
  formatDuration,
  isScoreMode,
  type JobManifest,
  normalizePath,
  portableBasename,
  portableRelativePath,
  redactSensitiveText,
  relativizeWorkspacePathsInText,
  resolveCostQuality,
  type ScoreMode
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
  decisionReportTitle: string;
  recommendationLabel: string;
  averageCostLabel: string;
  confidenceLabel: string;
  fullReportLabel: string;
  perRun: string;
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
    decisionReportTitle: "AGENTARENA DECISION REPORT",
    recommendationLabel: "Recommendation",
    averageCostLabel: "Avg Cost",
    confidenceLabel: "Confidence",
    fullReportLabel: "Full Report",
    perRun: "run",
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
    htmlGeneratedAtLabel: "生成时间",
    decisionReportTitle: "AGENTARENA 决策报告",
    recommendationLabel: "推荐",
    averageCostLabel: "平均成本",
    confidenceLabel: "置信度",
    fullReportLabel: "完整报告",
    perRun: "次",
  }
};

export function getReportCopy(locale: Locale): ReportCopy {
  return REPORT_COPY[locale] ?? REPORT_COPY.en;
}

/**
 * Individual score components (0–1 scale) that sum into `compositeScore`.
 *
 * Computed once by the backend in `enrichRunWithScores()` and serialized into
 * summary.json. The frontend reads these as the single source of truth and
 * only recomputes when absent (legacy runs) or when the user adjusts weights
 * (in which case only the weighted aggregation runs client-side — the
 * component values themselves never change with weight adjustments).
 */
export type ScoreComponents = {
  status: number;
  tests: number;
  criticalJudges: number;
  nonCriticalJudges: number;
  lint: number;
  precision: number;
  duration: number;
  cost: number;
  resolutionRate: number;
  tokenEfficiency: number;
  acceptanceRate: number;
  categoryScore: number;
  failToPassTests: number;
  passToPassTests: number;
};

export type ScoredResult = BenchmarkRun["results"][number] & {
  compositeScore?: number;
  scoreReasons?: string[];
  scoreComponents?: ScoreComponents;
};

export type ScoredRun = BenchmarkRun & {
  scoreMode?: ScoreMode;
  scoreWeights?: Record<string, number>;
  results: ScoredResult[];
};

export function isResultScoreExcluded(result: BenchmarkRun["results"][number]): boolean {
  return result.scoreExcluded === true;
}

export function formatCompositeScoreValue(result: BenchmarkRun["results"][number]): string {
  if (isResultScoreExcluded(result)) {
    return "n/a";
  }
  const score = result.compositeScore;
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(1) : "n/a";
}

export function formatCostUsd(value: number | undefined, known: boolean, quality?: "known" | "estimated" | "unavailable"): string {
  const resolved = quality ?? (known ? "known" : "unavailable");
  if (resolved === "unavailable" || typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${resolved === "estimated" ? "\u2248" : ""}$${value.toFixed(2)}`;
}

export function hasScoreMetadata(run: BenchmarkRun): run is BenchmarkRun & { scoreMode?: ScoreMode; scoreWeights?: Record<string, number> } {
  return "scoreMode" in run || "scoreWeights" in run;
}

/**
 * Resolve a run's effective scoring mode.
 *
 * Historical runs may carry an arbitrary string in `scoreMode`. Invalid or
 * missing values fall back to `practical` — the same default used by the
 * runner and `enrichRunWithScores` — so leaderboard grouping, re-scoring, and
 * UI compare never disagree about the fallback.
 */
export function getRunScoreMode(run: BenchmarkRun): ScoreMode {
  if (!hasScoreMetadata(run) || !run.scoreMode) return "practical";
  return isScoreMode(run.scoreMode) ? run.scoreMode : "practical";
}

export { escapeHtml };

export function escapeMdCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
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

const COMMAND_SECRET_PATTERNS: RegExp[] = [
  /\B--(?:token|api[-_]?key|apikey|password|passwd|secret|auth|authorization)\b/i,
  /\b(?:password|passwd|secret|token|api[-_]?key|apikey|authorization)\s*[=:]/i,
  /\b(?:gh|github)_?(?:token|pat)\b/i,
  /\bbearer\s+[A-Za-z0-9._-]+/i
];

function sanitizeCommandForDiagnostics(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/\bnpx\s+--no-install\b|\bpnpx\s+--no-install\b/u.test(trimmed)) {
    return "[redacted: npx --no-install]";
  }
  // Redact commands that embed credentials inline, but keep benign commands
  // (e.g. `npm test`) visible for diagnostics.
  if (COMMAND_SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "[redacted: command contains credentials]";
  }
  // Mask any long high-entropy token-like argument so it cannot leak a secret.
  return trimmed.replace(/\b([A-Za-z0-9_-]{24,})\b/g, (match) =>
    /[A-Z]/.test(match) && /[a-z]/.test(match) && /[0-9]/.test(match) ? "[redacted-token]" : match
  );
}

function sanitizeJobManifest(manifest: JobManifest | undefined): JobManifest | undefined {
  if (!manifest) return undefined;
  return {
    schemaVersion: manifest.schemaVersion,
    runId: manifest.runId,
    status: manifest.status,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    failureSummary: manifest.failureSummary
      ? redactSensitiveText(manifest.failureSummary)
      : undefined,
    repositoryBaselineIdentity: manifest.repositoryBaselineIdentity,
    taskIdentity: manifest.taskIdentity,
    judgeIdentity: manifest.judgeIdentity,
    scoreMode: manifest.scoreMode,
    variants: manifest.variants.map((variant) => ({
      order: variant.order,
      variantId: variant.variantId,
      agentKind: variant.agentKind,
      profileId: variant.profileId,
      profileRevision: variant.profileRevision,
      secretRevision: variant.secretRevision,
      launchSpecHash: variant.launchSpecHash,
      verificationReceiptId: variant.verificationReceiptId,
      installationFingerprint: variant.installationFingerprint,
      installationVersion: variant.installationVersion,
      harnessSnapshotId: variant.harnessSnapshotId,
      providerKind: variant.providerKind,
      requestedModel: variant.requestedModel,
      canonicalModelIdentity: variant.canonicalModelIdentity,
      modelIdentitySource: variant.modelIdentitySource,
      reasoningEffort: variant.reasoningEffort,
      providerPolicyIdentity: variant.providerPolicyIdentity,
      modelParametersIdentity: variant.modelParametersIdentity,
      permissionMode: variant.permissionMode,
      fullPermissionBypass: variant.fullPermissionBypass,
      riskFlags: [...variant.riskFlags],
      harnessDrift: variant.harnessDrift
        ? {
            status: variant.harnessDrift.status,
            checkedAt: variant.harnessDrift.checkedAt,
            postRunSnapshotId: variant.harnessDrift.postRunSnapshotId,
            summary: redactSensitiveText(variant.harnessDrift.summary)
          }
        : undefined
    }))
  };
}

export function sanitizeRun(run: BenchmarkRun): BenchmarkRun {
  return {
    ...run,
    repoPath: ".",
    outputPath: ".",
    jobManifest: sanitizeJobManifest(run.jobManifest),
    preflights: run.preflights.map((preflight) => ({
      ...preflight,
    })),
    results: run.results.map((result) => ({
      ...result,
      summary: redactSensitiveText(
        relativizeWorkspacePathsInText(result.summary, result.workspacePath)
      ),
      preflight: {
        ...result.preflight,
        command: undefined
      },
      setupResults: result.setupResults.map((step) => ({
        ...step,
        command: "[redacted]",
        stdout: "[redacted]",
        stderr: "[redacted]",
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      judgeResults: result.judgeResults.map((judge) => ({
        ...judge,
        command: sanitizeCommandForDiagnostics(judge.command),
        stdout: "[redacted]",
        stderr: "[redacted]",
        cwd: judge.cwd
          ? sanitizeWorkspaceScopedPath(judge.cwd, result.workspacePath, result.agentId)
          : undefined
      })),
      teardownResults: result.teardownResults.map((step) => ({
        ...step,
        command: "[redacted]",
        stdout: "[redacted]",
        stderr: "[redacted]",
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      tracePath: sanitizePath(result.tracePath, run.outputPath, "run"),
      workspacePath: `workspace/${portableBasename(result.workspacePath)}`,
      // The assembled prompt can embed repo file contents or secrets pulled into
      // context; never ship it in shareable/published output. The task intent
      // stays visible via run.task.prompt, which is the human-authored source.
      assembledPrompt: result.assembledPrompt === undefined ? undefined : "[redacted]"
    }))
  };
}

export function summarizeRun(run: BenchmarkRun): {
  totalAgents: number;
  successCount: number;
  failedCount: number;
  scoreExcludedCount: number;
  totalTokens: number;
  knownCostCount: number;
  knownCostUsd: number;
} {
  const successCount = run.results.filter((result) => result.status === "success").length;
  const failedCount = run.results.filter((result) => result.status === "failed").length;
  const scoreExcludedCount = run.results.filter((result) => isResultScoreExcluded(result)).length;
  const totalTokens = run.results.reduce(
    (total, result) => total + (Number.isFinite(result.tokenUsage) ? result.tokenUsage : 0),
    0
  );
  const knownCostResults = run.results.filter((result) => resolveCostQuality(result) === "known");
  const knownCostUsd = knownCostResults
    .reduce((total, result) => total + (Number.isFinite(result.estimatedCostUsd) ? result.estimatedCostUsd : 0), 0);

  return {
    totalAgents: run.results.length,
    successCount,
    failedCount,
    scoreExcludedCount,
    totalTokens,
    knownCostCount: knownCostResults.length,
    knownCostUsd
  };
}

export interface FailureDiagnostic {
  cause: string;
  evidence: string[];
  fixes: string[];
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  return value
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

function mentionsMissingPath(value: string): boolean {
  return /enoent|no such file|cannot find path|requirements\.txt|package\.json|not found/i.test(value);
}

function mentionsMissingLocalNodeTool(value: string): boolean {
  return /npx\s+--no-install|could not determine executable|local tool|node_modules|command not found|is not recognized/i.test(value);
}

export function diagnoseResultFailure(
  result: BenchmarkRun["results"][number],
  task?: BenchmarkRun["task"]
): FailureDiagnostic | undefined {
  if (result.status === "success") {
    return undefined;
  }

  const evidence: string[] = [];
  const fixes: string[] = [];
  const setupFailure = (result.setupResults ?? []).find((step) => !step.success);

  if (isResultScoreExcluded(result) && !setupFailure) {
    const cause =
      result.failureCategory === "task-pack"
        ? "The task did not run because the task pack or setup does not match this repository."
        : result.failureCategory === "environment"
          ? "The task did not run because the local environment or adapter preflight was not ready."
          : "The task did not produce a comparable agent score.";
    evidence.push(result.scoreExclusionReason ?? result.summary);
    if (result.summary) {
      evidence.push(result.summary);
    }
    if (result.failureCategory === "task-pack") {
      fixes.push("Use a repository that matches the task pack, or choose a task pack that matches this repository.");
      fixes.push("If this task pack is custom, update its setup commands and judges to match the repository.");
    } else {
      fixes.push("Run doctor/preflight for the adapter and fix the reported local setup or authentication issue.");
    }
    return {
      cause,
      evidence: Array.from(new Set(evidence.filter(Boolean))),
      fixes: Array.from(new Set(fixes.filter(Boolean)))
    };
  }

  const failedJudges = (result.judgeResults ?? []).filter((judge) => !judge.success);
  const setupCommand =
    setupFailure?.command && setupFailure.command !== "[redacted]"
      ? setupFailure.command
      : task?.setupCommands?.find((step) => step.id === setupFailure?.stepId)?.command;
  const combinedText = [
    result.summary,
    setupCommand,
    setupFailure?.stderr,
    setupFailure?.stdout,
    ...failedJudges.flatMap((judge) => [judge.command, judge.stderr, judge.stdout])
  ].filter(Boolean).join("\n");
  const lowerText = combinedText.toLowerCase();
  let cause = "Run failed before AgentArena could confirm success.";

  if (setupFailure) {
    cause = `Setup failed before the agent started: ${setupFailure.label}.`;
    evidence.push(`Setup command exit code: ${setupFailure.exitCode ?? "unknown"}.`);
    if (setupCommand) {
      evidence.push(`Setup command: ${setupCommand}`);
    }
    const setupLine = firstNonEmptyLine(setupFailure.stderr) ?? firstNonEmptyLine(setupFailure.stdout);
    if (setupLine) {
      evidence.push(setupLine);
    }
    if (mentionsMissingPath(combinedText)) {
      fixes.push("Use a repository that matches the task pack, or update the task pack setup command to point at the real dependency file.");
    } else {
      fixes.push("Run the setup command manually in the target repo and fix the dependency or environment issue it reports.");
    }
    fixes.push("If setup only needs more time, raise the setup command timeout in the task pack.");
  } else if (/timed?\s*out|timeout/i.test(result.summary)) {
    cause = "The agent timed out before producing a final answer.";
    evidence.push(`Duration: ${formatDuration(result.durationMs)}.`);
    fixes.push("Increase --agent-timeout and keep AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS above it.");
    fixes.push("Reduce the task scope or use a faster model/provider for this task pack.");
    if (result.resolvedRuntime?.providerKind && result.resolvedRuntime.providerKind !== "official") {
      fixes.push("For third-party provider profiles, also raise AGENTARENA_TRANSPORT_TIMEOUT_MS and verify provider latency/quota.");
    }
  } else if (/failed with exit code|process error|execution failed/i.test(result.summary)) {
    cause = "The agent CLI exited with an error before validation completed.";
    evidence.push(result.summary);
    fixes.push("Open the trace file and inspect the adapter result stderr for the exact CLI error.");
    fixes.push("Check local CLI authentication, disabled/broken MCP servers, and provider/model compatibility.");
  } else if (failedJudges.length > 0 && mentionsMissingLocalNodeTool(combinedText)) {
    cause = "Validation could not run because the task pack depends on local project tools that are not available in the workspace.";
    for (const judge of failedJudges.slice(0, 3)) {
      evidence.push(`${judge.label}: ${firstNonEmptyLine(judge.stderr) ?? firstNonEmptyLine(judge.stdout) ?? "missing local tool"}`);
    }
    fixes.push("Prepare dependencies before benchmarking, or add a repository-specific setup step that does not count as agent work.");
    fixes.push("If the task pack is generic, replace local-tool judges with checks that work in a fresh workspace.");
  } else if (failedJudges.length > 0) {
    cause = `Validation failed after the agent ran: ${failedJudges.length} judge(s) failed.`;
    for (const judge of failedJudges.slice(0, 3)) {
      evidence.push(`${judge.label}: ${firstNonEmptyLine(judge.stderr) ?? firstNonEmptyLine(judge.stdout) ?? "failed"}`);
    }
    if (mentionsMissingPath(combinedText)) {
      fixes.push("Check whether the task pack expects files that this repo does not contain, then use a matching repo or adjust the task pack paths.");
    }
    fixes.push("Fix the code or task pack until every failed judge passes when run manually.");
  } else if (result.preflight?.status && result.preflight.status !== "ready") {
    cause = `Adapter preflight is ${result.preflight.status}.`;
    evidence.push(result.preflight.summary);
    fixes.push("Run doctor with auth probing for this adapter and fix the reported CLI/API key/profile issue.");
  } else if (lowerText.includes("quota") || lowerText.includes("usage limit") || lowerText.includes("402")) {
    cause = "The provider rejected the run because of quota or billing limits.";
    evidence.push(result.summary);
    fixes.push("Wait for quota reset, switch provider/profile, or use a model with available quota.");
  } else {
    evidence.push(result.summary || "No failure summary was provided.");
    fixes.push("Inspect the trace file, setup output, and failed judges to identify the exact failing step.");
  }

  if (result.changedFiles.length > 20) {
    evidence.push(`Changed files: ${result.changedFiles.length}.`);
    fixes.push("Review the diff for unrelated churn; tighten the prompt or expectedChangedPaths if the task should be narrow.");
  }

  if (result.resolvedRuntime?.providerKind && result.resolvedRuntime.providerKind !== "official") {
    evidence.push(`Provider profile: ${result.resolvedRuntime.providerProfileName ?? result.resolvedRuntime.providerKind}.`);
    fixes.push("Compare with the official provider once to separate task-pack issues from provider compatibility issues.");
  }

  return {
    cause,
    evidence: Array.from(new Set(evidence.filter(Boolean))),
    fixes: Array.from(new Set(fixes.filter(Boolean)))
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

export function usesThirdPartyProviderConfiguration(result: {
  resolvedRuntime?: AgentResolvedRuntime;
}): boolean {
  const runtime = result.resolvedRuntime;
  if (!runtime) return false;

  return runtime.providerSource === "profile-config"
    || runtime.source === "profile-config"
    || (runtime.providerKind !== undefined && runtime.providerKind !== "official");
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
