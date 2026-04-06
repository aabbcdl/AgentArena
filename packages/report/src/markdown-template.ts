import { type AdapterPreflightResult, type BenchmarkRun, formatDuration } from "@repoarena/core";
import type { LeaderboardData } from "./leaderboard.js";
import {
  escapeMdCell,
  formatDiffPrecisionMetric,
  formatLintMetric,
  formatRuntimeIdentity,
  formatTestMetric,
  getReportCopy,
  getRunScoreMode,
  type Locale,
  type ScoredResult,
  type ScoredRun,
  summarizeRun
} from "./report-helpers.js";

function formatSupportTier(value: AdapterPreflightResult["capability"]["supportTier"]): string {
  return value;
}

function formatAvailability(value: AdapterPreflightResult["capability"]["tokenAvailability"]): string {
  return value;
}

function formatTraceRichness(value: AdapterPreflightResult["capability"]["traceRichness"]): string {
  return value;
}

export function renderMarkdown(run: BenchmarkRun, locale: Locale, leaderboard?: LeaderboardData): string {
  const copy = getReportCopy(locale);
  const summary = summarizeRun(run);
  const failedResults = run.results.filter((result) => result.status !== "success");
  const lines: string[] = [
    `# ${copy.summaryTitle}`,
    "",
    `- ${copy.runIdLabel}: \`${run.runId}\``,
    `- ${copy.generatedAtLabel}: \`${run.createdAt}\``,
    `- ${copy.taskLabel}: \`${run.task.title}\``,
    `- ${locale === "zh-CN" ? "评分模式" : "Score Mode"}: \`${getRunScoreMode(run)}\``,
    `- ${locale === "zh-CN" ? "评分权重" : "Score Weights"}: \`${JSON.stringify((run as ScoredRun).scoreWeights ?? {})}\``,
    `- ${locale === "zh-CN" ? "评分范围" : "Score Scope"}: \`${run.scoreScope ?? "run-local"}\``,
    `- ${copy.repositoryLabel}: \`${run.repoPath}\``,
    ...(run.task.metadata
      ? [
          `- ${copy.taskLibraryLabel}: \`${run.task.metadata.source}\` by \`${run.task.metadata.owner}\``,
          `- ${copy.repoTypesLabel}: \`${run.task.metadata.repoTypes.join(", ") || "unspecified"}\``,
          `- ${copy.objectiveLabel}: \`${run.task.metadata.objective ?? "unspecified"}\``,
          `- ${copy.judgeRationaleLabel}: \`${run.task.metadata.judgeRationale ?? "unspecified"}\``
        ]
      : []),
    `- ${copy.successRateLabel}: \`${summary.successCount}/${summary.totalAgents}\``,
    `- ${copy.failedLabel}: \`${summary.failedCount}\``,
    `- ${copy.totalTokensLabel}: \`${summary.totalTokens}\` | ${copy.knownCostLabel}: \`$${summary.knownCostUsd.toFixed(2)}\``,
    `- ${copy.badgeEndpointLabel}: \`badge.json\``,
    `- ${copy.noteLabel}: ${copy.comparesModelConfigurations} ${copy.baselineRepoHealthNote}`,
    `- ${locale === "zh-CN" ? "分数说明" : "Score Note"}: ${run.scoreValidityNote ?? "Scores only compare variants inside this run."}`,
    ""
  ];

  // 添加历史排行榜摘要
  if (leaderboard && leaderboard.rows.length > 0) {
    lines.push(`## ${locale === "zh-CN" ? "历史排行榜摘要" : "Historical Leaderboard Summary"}`, "");
    lines.push(`- ${locale === "zh-CN" ? "可比较 run 数" : "Comparable runs"}: \`${leaderboard.comparableRunCount}\``);
    if (leaderboard.excludedRunCount > 0) {
      lines.push(`- ${locale === "zh-CN" ? "排除的 run 数" : "Excluded runs"}: \`${leaderboard.excludedRunCount}\``);
    }
    lines.push(`- ${locale === "zh-CN" ? "评分模式" : "Score mode"}: \`${leaderboard.scoreMode}\``);
    lines.push(`- ${locale === "zh-CN" ? "难度筛选" : "Difficulty filter"}: \`${leaderboard.difficultyFilter}\``);
    lines.push(`- ${locale === "zh-CN" ? "任务" : "Task"}: \`${leaderboard.taskId}\``);
    lines.push("");
    lines.push(`${locale === "zh-CN" ? "> 此排行榜仅统计同任务、同评分模式、同配置的历史结果。版本变化会开启新的历史记录。" : "> This leaderboard only compares runs with the same task, score mode, and configuration. Version changes create new historical records."}`);
    lines.push("");
    
    if (leaderboard.rows.length <= 5) {
      // 如果行数少，直接展示所有
      lines.push("| Variant | Base Agent | Version | Runs | Avg Score | Win Rate | Success Rate | First Pass Rate |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const row of leaderboard.rows) {
        lines.push(
          `| ${escapeMdCell(row.displayLabel)} | ${escapeMdCell(row.identity.baseAgentId)} | ${escapeMdCell(row.identity.version)} | ${row.stats.runCount} | ${row.stats.averageScore.toFixed(1)} | ${(row.stats.winRate * 100).toFixed(1)}% | ${(row.stats.successRate * 100).toFixed(1)}% | ${(row.stats.firstPassRate * 100).toFixed(1)}% |`
        );
      }
      lines.push("");
    } else {
      // 只展示前 5 名
      lines.push(`${locale === "zh-CN" ? "前 5 名：" : "Top 5:"}`);
      lines.push("");
      lines.push("| Rank | Variant | Version | Avg Score | Win Rate | Success Rate | First Pass Rate |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (let i = 0; i < Math.min(5, leaderboard.rows.length); i++) {
        const row = leaderboard.rows[i];
        lines.push(
          `| ${i + 1} | ${escapeMdCell(row.displayLabel)} | ${escapeMdCell(row.identity.version)} | ${row.stats.averageScore.toFixed(1)} | ${(row.stats.winRate * 100).toFixed(1)}% | ${(row.stats.successRate * 100).toFixed(1)}% | ${(row.stats.firstPassRate * 100).toFixed(1)}% |`
        );
      }
      lines.push("");
    }
  }

  lines.push(`## ${copy.adapterPreflightTitle}`, "");
  lines.push("| Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Version | Verification | Status | Summary |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const preflight of run.preflights) {
    const runtime = formatRuntimeIdentity(preflight);
    lines.push(
      `| ${escapeMdCell(preflight.displayLabel)} | ${escapeMdCell(preflight.baseAgentId)} | ${escapeMdCell(runtime.provider)} | ${escapeMdCell(runtime.providerKind)} | ${escapeMdCell(runtime.model)} | ${escapeMdCell(runtime.reasoning)} | ${escapeMdCell(runtime.version)} | ${escapeMdCell(runtime.verification)}/${escapeMdCell(runtime.source)} | ${escapeMdCell(preflight.status)} | ${escapeMdCell(preflight.summary)} |`
    );
  }

  lines.push("", `## ${copy.capabilityMatrixTitle}`, "");
  lines.push("| Variant | Base Agent | Tier | Invocation | Tokens | Cost | Trace |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const preflight of run.preflights) {
    lines.push(
      `| ${escapeMdCell(preflight.displayLabel)} | ${escapeMdCell(preflight.baseAgentId)} | ${formatSupportTier(preflight.capability.supportTier)} | ${escapeMdCell(preflight.capability.invocationMethod)} | ${formatAvailability(preflight.capability.tokenAvailability)} | ${formatAvailability(preflight.capability.costAvailability)} | ${formatTraceRichness(preflight.capability.traceRichness)} |`
    );
    if (preflight.capability.knownLimitations.length > 0) {
      lines.push(
        `|  | limitations | ${escapeMdCell(preflight.capability.knownLimitations.join("; "))} |  |  |  |`
      );
    }
  }

  lines.push("", `## ${copy.resultsTitle}`, "");
  const scoredResults = run.results as ScoredResult[];
  lines.push("| Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Version | Verification | Status | Score | Duration | Tokens | Cost | Changed Files | Judges | Tests | Lint | Diff Precision |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | ---: | --- | --- | --- | --- |");
  for (const result of scoredResults) {
    const runtime = formatRuntimeIdentity(result);
    const passedJudgeCount = result.judgeResults.filter((judge) => judge.success).length;
    lines.push(
      `| ${escapeMdCell(result.displayLabel ?? result.agentId)} | ${escapeMdCell(result.baseAgentId)} | ${escapeMdCell(runtime.provider)} | ${escapeMdCell(runtime.providerKind)} | ${escapeMdCell(runtime.model)} | ${escapeMdCell(runtime.reasoning)} | ${escapeMdCell(runtime.version)} | ${escapeMdCell(runtime.verification)}/${escapeMdCell(runtime.source)} | ${result.status} | ${(result.compositeScore ?? 0).toFixed(1)} | ${formatDuration(result.durationMs)} | ${result.tokenUsage} | ${
        result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
      } | ${result.changedFiles.length} | ${passedJudgeCount}/${result.judgeResults.length} | ${escapeMdCell(formatTestMetric(result))} | ${escapeMdCell(formatLintMetric(result))} | ${escapeMdCell(formatDiffPrecisionMetric(result))} |`
    );
  }

  if (failedResults.length > 0) {
    lines.push("", `## ${copy.failuresTitle}`, "");
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
      `- Model Identity: requested=${result.requestedConfig.model ?? "default"} | requested reasoning=${result.requestedConfig.reasoningEffort ?? "default"} | effective model=${runtime.model} | effective reasoning=${runtime.reasoning} | version=${runtime.version} | version source=${runtime.versionSource} | source=${runtime.source} | verification=${runtime.verification}`
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

  lines.push("", `## ${copy.promptTitle}`, "", "```text", run.task.prompt, "```", "");
  return lines.join("\n");
}

export function renderPrComment(run: BenchmarkRun, locale: Locale, leaderboard?: LeaderboardData): string {
  const copy = getReportCopy(locale);
  const summary = summarizeRun(run);
  const scoredResults = run.results as ScoredResult[];
  const failedResults = run.results.filter((result) => result.status !== "success");
  const attentionPreflights = run.preflights.filter((preflight) => preflight.status !== "ready");
  const header = [
    `## ${copy.prCommentTitle}`,
    "",
    `${copy.taskLabel}: \`${run.task.title}\``,
    "",
    `${locale === "zh-CN" ? "评分模式" : "Score mode"}: \`${getRunScoreMode(run)}\``,
    `${locale === "zh-CN" ? "评分权重" : "Score weights"}: \`${JSON.stringify((run as ScoredRun).scoreWeights ?? {})}\``,
    "",
    `${copy.overviewLabel}: \`${summary.successCount}/${summary.totalAgents}\`${locale === "zh-CN" ? " 通过" : " passing"} | ${copy.failedLabel}: \`${summary.failedCount}\` | ${copy.totalTokensLabel}: \`${summary.totalTokens}\` | ${copy.knownCostLabel}: \`$${summary.knownCostUsd.toFixed(2)}\``
  ];

  // 添加历史排行榜摘要
  if (leaderboard && leaderboard.rows.length > 0 && leaderboard.comparableRunCount > 1) {
    const bestRow = leaderboard.rows[0];
    if (bestRow) {
      header.push(
        "",
        `${locale === "zh-CN" ? "历史最佳" : "Historical Best"}: \`${bestRow.displayLabel}\` (v${bestRow.identity.version}) - ${locale === "zh-CN" ? "平均分" : "Avg Score"}: \`${bestRow.stats.averageScore.toFixed(1)}\`, ${locale === "zh-CN" ? "胜率" : "Win Rate"}: \`${(bestRow.stats.winRate * 100).toFixed(1)}%\``
      );
    }
  }

  const table = [
    "",
    `### ${copy.reviewTableTitle}`,
    "",
    "| Attention | Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Version | Verification | Tier | Preflight | Run | Score | Duration | Tokens | Cost | Judges | Tests | Lint | Diff Precision | Files | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- | ---: | --- |"
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
      `| ${attention} | ${escapeMdCell(result.displayLabel ?? result.agentId)} | ${escapeMdCell(result.baseAgentId)} | ${escapeMdCell(runtime.provider)} | ${escapeMdCell(runtime.providerKind)} | ${escapeMdCell(runtime.model)} | ${escapeMdCell(runtime.reasoning)} | ${escapeMdCell(runtime.version)} | ${escapeMdCell(runtime.verification)}/${escapeMdCell(runtime.source)} | ${formatSupportTier(result.preflight.capability.supportTier)} | ${result.preflight.status} | ${result.status} | ${(result.compositeScore ?? 0).toFixed(1)} | ${formatDuration(result.durationMs)} | ${result.tokenUsage} | ${
        result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
      } | ${passedJudgeCount}/${result.judgeResults.length} | ${escapeMdCell(formatTestMetric(result))} | ${escapeMdCell(formatLintMetric(result))} | ${escapeMdCell(formatDiffPrecisionMetric(result))} | ${result.changedFiles.length} | ${escapeMdCell(note)} |`
    );
  }

  const reviewFocus = ["", `### ${copy.reviewFocusTitle}`, ""];
  if (attentionPreflights.length === 0 && failedResults.length === 0) {
    reviewFocus.push(`- ${copy.noWarningsOrFailures}`);
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
    `### ${copy.artifactsTitle}`,
    "",
    "- `summary.json`",
    "- `summary.md`",
    "- `pr-comment.md`",
    "- `report.html`",
    "- `badge.json`",
    "",
    `_${copy.artifactsNote}_`
  ];

  return [...header, ...table, ...reviewFocus, ...artifacts].join("\n");
}
