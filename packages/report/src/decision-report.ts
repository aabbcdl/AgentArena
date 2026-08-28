import { type AgentRunResult, type BenchmarkRun, type CostQuality, resolveCostQuality } from "@agentarena/core";
import { diagnoseResultFailure, type FailureDiagnostic, isResultScoreExcluded } from "./report-helpers.js";

export interface DecisionRecommendation {
  rank: number | null;
  agentId: string;
  displayLabel: string;
  recommendation: "recommended" | "alternative" | "not-recommended";
  successRate: number;
  avgCostPerRun: number;
  costQuality?: CostQuality;
  avgDurationMs: number;
  strengths: string[];
  weaknesses: string[];
  riskFactors: string[];
  confidence: "high" | "medium" | "low";
}

export interface TeamCostEstimate {
  agentId: string;
  monthlyCost: number;
  dailyRuns: number;
  teamSize: number;
  costPerRun: number;
  costComparison: { vs: string; savings: number };
}

export interface DecisionReport {
  generatedAt: string;
  scenario: string;
  recommendations: DecisionRecommendation[];
  teamEstimates: TeamCostEstimate[];
  keyInsights: string[];
  warnings: string[];
  failureDiagnostics: Array<{
    agentId: string;
    displayLabel: string;
    diagnostic: FailureDiagnostic;
  }>;
  reproduceCommand: string;
}

/**
 * Escape a string for safe use in a shell command.
 * Uses single-quote wrapping with embedded single-quote escaping.
 */
function shellEscape(value: string): string {
  // Wrap in single quotes; replace internal single quotes with '\''
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Generate a decision report from benchmark results
 */
export function generateDecisionReport(
  run: BenchmarkRun,
  options: {
    scenario?: string;
    teamSize?: number;
    dailyRuns?: number;
  } = {}
): DecisionReport {
  const { teamSize = 10, dailyRuns = 5 } = options;
  const scenario = options.scenario ?? inferScenario(run);

  const recommendations = computeRecommendations(run.results);
  const teamEstimates = computeTeamCostEstimates(run.results, teamSize, dailyRuns);
  const keyInsights = extractKeyInsights(run.results);
  const warnings = extractWarnings(run.results);
  const failureDiagnostics = run.results
    .map((result) => {
      const diagnostic = diagnoseResultFailure(result, run.task);
      return diagnostic ? { agentId: result.agentId, displayLabel: result.displayLabel, diagnostic } : undefined;
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  return {
    generatedAt: new Date().toISOString(),
    scenario,
    recommendations,
    teamEstimates,
    keyInsights,
    warnings,
    failureDiagnostics,
    reproduceCommand: `agentarena run --repo ${shellEscape(run.repoPath)} --task ${shellEscape(run.task.id)} --agents ${run.results.map((r) => shellEscape(r.agentId)).join(",")}`
  };
}

/**
 * Infer the scenario from task metadata
 */
function inferScenario(run: BenchmarkRun): string {
  const task = run.task;
  const tags = task.metadata?.tags ?? [];
  const difficulty = task.metadata?.difficulty;

  if (tags.includes("swe-bench") || tags.includes("issue-resolution")) {
    return "GitHub Issue Fix";
  }
  if (tags.includes("efficiency-first") || tags.includes("cursorbench")) {
    return "Token Efficiency Focus";
  }
  if (tags.includes("refactoring") || tags.includes("multi-file")) {
    return "Multi-file Refactoring";
  }
  if (difficulty === "hard") {
    return "Complex Engineering Task";
  }
  if (difficulty === "easy") {
    return "Simple Task";
  }
  return "General Coding Task";
}

/**
 * Compute recommendations with confidence levels
 */
function computeRecommendations(results: AgentRunResult[]): DecisionRecommendation[] {
  const qualified = results
    .filter((result) => result.status === "success" && !isResultScoreExcluded(result))
    .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0) || a.durationMs - b.durationMs);
  const qualifiedRank = new Map(qualified.map((result, index) => [result.variantId ?? result.agentId, index + 1]));
  const sorted = [...results].sort((a, b) => {
    const rankA = qualifiedRank.get(a.variantId ?? a.agentId) ?? Number.POSITIVE_INFINITY;
    const rankB = qualifiedRank.get(b.variantId ?? b.agentId) ?? Number.POSITIVE_INFINITY;
    return rankA - rankB || (a.displayLabel ?? a.agentId).localeCompare(b.displayLabel ?? b.agentId);
  });

  return sorted.map((result) => {
    const rank = qualifiedRank.get(result.variantId ?? result.agentId) ?? null;
    if (isResultScoreExcluded(result)) {
      return {
        rank: null,
        agentId: result.agentId,
        displayLabel: result.displayLabel,
        recommendation: "not-recommended",
        successRate: 0,
        avgCostPerRun: result.estimatedCostUsd,
        costQuality: resolveCostQuality(result),
        avgDurationMs: result.durationMs,
        strengths: [],
        weaknesses: [result.scoreExclusionReason ?? "Result was not scored because it is not comparable."],
        riskFactors: ["Do not use this result to compare agent or model quality."],
        confidence: "low"
      };
    }

    const recommendation: DecisionRecommendation["recommendation"] =
      rank === 1 && result.compositeScore != null && result.compositeScore >= 50
        ? "recommended"
        : rank !== null && result.compositeScore != null && result.compositeScore >= 30
          ? "alternative"
          : "not-recommended";
    const costQuality = resolveCostQuality(result);

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const riskFactors: string[] = [];

    // Analyze strengths
    if (result.compositeScore != null && result.compositeScore >= 80) {
      strengths.push(`High overall score (${result.compositeScore.toFixed(0)}/100)`);
    }
    const passedJudges = result.judgeResults.filter((j) => j.success).length;
    const totalJudges = result.judgeResults.length;
    if (totalJudges > 0) {
      const passRatio = passedJudges / totalJudges;
      if (passRatio > 0.9) {
        strengths.push(`Excellent judge pass rate (${(passRatio * 100).toFixed(0)}%)`);
      }
    }
    if (result.durationMs < 60000) {
      strengths.push(`Fast execution (${(result.durationMs / 1000).toFixed(0)}s)`);
    }
    if (costQuality === "known" && result.estimatedCostUsd < 0.5) {
      strengths.push(`Low cost ($${result.estimatedCostUsd.toFixed(2)})`);
    }

    // Analyze weaknesses
    if (result.status === "failed") {
      weaknesses.push("Task failed to complete");
    }
    if (result.status === "cancelled") {
      weaknesses.push("Task was cancelled");
    }
    if (costQuality === "unavailable") {
      weaknesses.push("Cost unavailable");
    } else if (costQuality === "estimated") {
      weaknesses.push("Cost is an estimate, not a confirmed charge");
    }
    if (result.changedFiles.length > 10) {
      weaknesses.push(
        `Modified many files (${result.changedFiles.length}) - may lack precision`
      );
    }

    // Analyze risks
    if (costQuality === "unavailable") {
      riskFactors.push("Actual cost is unavailable");
    } else if (costQuality === "estimated") {
      riskFactors.push("Estimated cost may differ from the actual charge");
    }
    if (
      result.status === "success" &&
      result.compositeScore != null &&
      result.compositeScore < 60
    ) {
      riskFactors.push("Low score despite success - may have quality issues");
    }
    if (result.changedFiles.length > 20) {
      riskFactors.push("Extensive file changes increase review overhead");
    }

    // Determine confidence
    let confidence: "high" | "medium" | "low" = "medium";
    if (
      result.status === "success" &&
      costQuality === "known" &&
      result.compositeScore != null &&
      result.compositeScore >= 70
    ) {
      confidence = "high";
    }
    if (result.status === "failed" || result.status === "cancelled" || costQuality === "unavailable") {
      confidence = "low";
    }

    const successRate = result.status === "success" ? 1 : 0;

    return {
      rank,
      agentId: result.agentId,
      displayLabel: result.displayLabel,
      recommendation,
      successRate,
      avgCostPerRun: result.estimatedCostUsd,
      costQuality,
      avgDurationMs: result.durationMs,
      strengths,
      weaknesses,
      riskFactors,
      confidence
    };
  });
}

/**
 * Compute team cost estimates
 */
function computeTeamCostEstimates(
  results: AgentRunResult[],
  teamSize: number,
  dailyRuns: number
): TeamCostEstimate[] {
  const workingDays = 22; // Average per month
  const monthlyMultiplier = teamSize * dailyRuns * workingDays;

  const successfulResults = results
    .filter((r) => !isResultScoreExcluded(r) && r.status === "success")
    .filter((r) => resolveCostQuality(r) === "known" && r.estimatedCostUsd > 0)
    .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd);

  const cheapest = successfulResults[0]?.estimatedCostUsd ?? 0;

  return results
    .filter((result) => !isResultScoreExcluded(result) && result.status === "success" && resolveCostQuality(result) === "known")
    .map((result) => {
      const monthlyCost = result.estimatedCostUsd * monthlyMultiplier;

      return {
        agentId: result.agentId,
        monthlyCost,
        dailyRuns,
        teamSize,
        costPerRun: result.estimatedCostUsd,
        costComparison: {
          vs:
            cheapest > 0
              ? (successfulResults[0]?.displayLabel ?? "cheapest")
              : "N/A",
          savings: monthlyCost - (cheapest * monthlyMultiplier)
        }
      };
    })
    .sort((a, b) => a.monthlyCost - b.monthlyCost);
}

/**
 * Extract key insights from results
 */
function extractKeyInsights(results: AgentRunResult[]): string[] {
  const insights: string[] = [];
  const comparable = results.filter((r) => !isResultScoreExcluded(r));
  const excluded = results.length - comparable.length;
  const successful = comparable.filter((r) => r.status === "success");
  const failed = comparable.filter((r) => r.status !== "success");

  if (excluded > 0) {
    insights.push(`${excluded} result(s) were not scored because the task pack, repository, or local setup was not comparable`);
  }

  if (successful.length > 0) {
    const scoredSuccessful = successful.filter(
      (result) => typeof result.compositeScore === "number" && Number.isFinite(result.compositeScore)
    );
    if (scoredSuccessful.length > 0) {
      const best = scoredSuccessful.reduce((a, b) =>
        (a.compositeScore ?? 0) > (b.compositeScore ?? 0) ? a : b
      );
      insights.push(
        `${best.displayLabel} achieved the highest score (${best.compositeScore?.toFixed(0)}/100)`
      );
    } else {
      insights.push(`${successful.length} agent(s) completed the task successfully`);
    }
  }

  if (failed.length > 0) {
    insights.push(`${failed.length} agent(s) failed to complete the task`);
  }

  const costKnown = comparable.filter((r) => resolveCostQuality(r) === "known");
  if (costKnown.length > 1) {
    const cheapest = costKnown.reduce((a, b) =>
      a.estimatedCostUsd < b.estimatedCostUsd ? a : b
    );
    const mostExpensive = costKnown.reduce((a, b) =>
      a.estimatedCostUsd > b.estimatedCostUsd ? a : b
    );
    const diff = mostExpensive.estimatedCostUsd - cheapest.estimatedCostUsd;
    insights.push(
      `Cost range: $${cheapest.estimatedCostUsd.toFixed(2)} - $${mostExpensive.estimatedCostUsd.toFixed(2)} (difference: $${diff.toFixed(2)})`
    );
  }

  const fastSuccessful = successful.filter((r) => r.durationMs < 60000);
  if (fastSuccessful.length > 0) {
    const fastest = fastSuccessful.reduce((a, b) =>
      a.durationMs < b.durationMs ? a : b
    );
    insights.push(
      `${fastest.displayLabel} was fastest (${(fastest.durationMs / 1000).toFixed(0)}s)`
    );
  }

  return insights;
}

/**
 * Extract warnings from results
 */
function extractWarnings(results: AgentRunResult[]): string[] {
  const warnings: string[] = [];
  const comparable = results.filter((r) => !isResultScoreExcluded(r));

  const estimatedCost = comparable.filter((r) => resolveCostQuality(r) === "estimated");
  const unavailableCost = comparable.filter((r) => resolveCostQuality(r) === "unavailable");
  if (estimatedCost.length > 0) warnings.push(`${estimatedCost.length} agent(s) have estimated costs that are not confirmed charges`);
  if (unavailableCost.length > 0) warnings.push(`${unavailableCost.length} agent(s) have unavailable costs`);

  const manyChanges = comparable.filter((r) => r.changedFiles.length > 10);
  if (manyChanges.length > 0) {
    warnings.push(
      `${manyChanges.length} agent(s) modified many files - review changes carefully`
    );
  }

  const allFailed = comparable.length > 0 && comparable.every((r) => r.status !== "success");
  const allExcluded = results.length > 0 && results.every((r) => isResultScoreExcluded(r));
  if (allExcluded) {
    warnings.push(
      "No agents were run because the task pack, repository, or local setup was not comparable"
    );
  } else if (allFailed) {
    warnings.push(
      "All agents failed - task may be too difficult or task pack needs adjustment"
    );
  }

  return warnings;
}

/**
 * Format decision report as Markdown for export
 */
export function formatDecisionReport(report: DecisionReport, locale?: string): string {
  const zh = locale !== "en";
  const lines: string[] = [];

  lines.push(zh ? `# AgentArena 决策报告` : `# AgentArena Decision Report`);
  lines.push(``);
  lines.push(zh ? `**生成时间**: ${new Date(report.generatedAt).toLocaleString()}` : `**Generated**: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push(zh ? `**场景**: ${report.scenario}` : `**Scenario**: ${report.scenario}`);
  lines.push(``);

  lines.push(zh ? `## 🏆 推荐方案` : `## 🏆 Recommendations`);
  lines.push(``);

  for (const rec of report.recommendations) {
    const emoji =
      rec.recommendation === "recommended"
        ? "🥇"
        : rec.recommendation === "alternative"
          ? "🥈"
          : "❌";

    lines.push(`### ${emoji} ${rec.rank === null ? "\u2014" : `#${rec.rank}`} ${rec.displayLabel}`);
    lines.push(``);
    lines.push(
      zh
        ? `- **推荐度**: ${rec.recommendation === "recommended" ? "推荐" : rec.recommendation === "alternative" ? "备选" : "不推荐"}`
        : `- **Recommendation**: ${rec.recommendation}`
    );
    lines.push(zh ? `- **成功率**: ${(rec.successRate * 100).toFixed(0)}%` : `- **Success rate**: ${(rec.successRate * 100).toFixed(0)}%`);
    const costQuality = rec.costQuality ?? "known";
    const costText =
      costQuality === "unavailable"
        ? "n/a"
        : `${costQuality === "estimated" ? "\u2248" : ""}$${rec.avgCostPerRun.toFixed(2)}`;
    lines.push(zh ? `- **平均成本**: ${costText}/次` : `- **Avg cost**: ${costText}/run`);
    lines.push(zh ? `- **平均耗时**: ${(rec.avgDurationMs / 1000).toFixed(0)}s` : `- **Avg duration**: ${(rec.avgDurationMs / 1000).toFixed(0)}s`);
    lines.push(
      zh
        ? `- **置信度**: ${rec.confidence === "high" ? "高" : rec.confidence === "medium" ? "中" : "低"}`
        : `- **Confidence**: ${rec.confidence}`
    );
    lines.push(``);

    if (rec.strengths.length > 0) {
      lines.push(zh ? `**优势**:` : `**Strengths**:`);
      for (const s of rec.strengths) {
        lines.push(`- ✅ ${s}`);
      }
      lines.push(``);
    }

    if (rec.weaknesses.length > 0) {
      lines.push(zh ? `**劣势**:` : `**Weaknesses**:`);
      for (const w of rec.weaknesses) {
        lines.push(`- ❌ ${w}`);
      }
      lines.push(``);
    }

    if (rec.riskFactors.length > 0) {
      lines.push(zh ? `**风险**:` : `**Risks**:`);
      for (const r of rec.riskFactors) {
        lines.push(`- ⚠️ ${r}`);
      }
      lines.push(``);
    }
  }

  if (report.teamEstimates.length > 0) {
    const first = report.teamEstimates[0];
    lines.push(
      zh
        ? `## 💰 团队成本估算（${first.teamSize}人 × ${first.dailyRuns}次/天）`
        : `## 💰 Team cost estimate (${first.teamSize} people × ${first.dailyRuns} runs/day)`
    );
    lines.push(``);
    lines.push(zh ? `| Agent | 月成本 | 单次成本 | 与最便宜差距 |` : `| Agent | Monthly cost | Per-run cost | vs cheapest |`);
    lines.push(`|-------|--------|----------|-------------|`);

    for (const est of report.teamEstimates) {
      const savings =
        est.costComparison.savings > 0
          ? `+$${est.costComparison.savings.toFixed(0)}`
          : (zh ? "最便宜" : "cheapest");
      lines.push(
        `| ${est.agentId} | $${est.monthlyCost.toFixed(0)} | $${est.costPerRun.toFixed(2)} | ${savings} |`
      );
    }
    lines.push(``);
  }

  if (report.keyInsights.length > 0) {
    lines.push(zh ? `## 🔍 关键发现` : `## 🔍 Key findings`);
    lines.push(``);
    for (const insight of report.keyInsights) {
      lines.push(`- ${insight}`);
    }
    lines.push(``);
  }

  if (report.warnings.length > 0) {
    lines.push(zh ? `## ⚠️ 注意事项` : `## ⚠️ Warnings`);
    lines.push(``);
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push(``);
  }

  lines.push(`## 🔄 复现命令`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  if ((report.failureDiagnostics?.length ?? 0) > 0) {
    const diagLines: string[] = [`## Failure diagnosis`, ``];
    for (const item of report.failureDiagnostics) {
      diagLines.push(`### ${item.displayLabel}`, ``);
      diagLines.push(`- Cause: ${item.diagnostic.cause}`);
      for (const evidence of item.diagnostic.evidence) {
        diagLines.push(`- Evidence: ${evidence}`);
      }
      for (const fix of item.diagnostic.fixes) {
        diagLines.push(`- Fix: ${fix}`);
      }
      diagLines.push(``);
    }
    lines.push(...diagLines);
  }

  lines.push(report.reproduceCommand);
  lines.push(`\`\`\``);
  lines.push(``);

  return lines.join("\n");
}
