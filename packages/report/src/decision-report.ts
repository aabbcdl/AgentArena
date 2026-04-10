import type { AgentRunResult, BenchmarkRun } from "@agentarena/core";

export interface DecisionRecommendation {
  rank: number;
  agentId: string;
  displayLabel: string;
  recommendation: "recommended" | "alternative" | "not-recommended";
  successRate: number;
  avgCostPerRun: number;
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
  reproduceCommand: string;
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

  return {
    generatedAt: new Date().toISOString(),
    scenario,
    recommendations,
    teamEstimates,
    keyInsights,
    warnings,
    reproduceCommand: `agentarena run --repo ${run.repoPath} --task ${run.task.id} --agents ${run.results.map((r) => r.agentId).join(",")}`
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
  // Sort by composite score (descending)
  const sorted = [...results].sort(
    (a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0)
  );

  return sorted.map((result, index) => {
    const recommendation: DecisionRecommendation["recommendation"] =
      index === 0 && result.compositeScore != null && result.compositeScore >= 50
        ? "recommended"
        : result.status === "success" && result.compositeScore != null && result.compositeScore >= 30
          ? "alternative"
          : "not-recommended";

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
    if (result.costKnown && result.estimatedCostUsd < 0.5) {
      strengths.push(`Low cost ($${result.estimatedCostUsd.toFixed(2)})`);
    }

    // Analyze weaknesses
    if (result.status === "failed") {
      weaknesses.push("Task failed to complete");
    }
    if (result.status === "cancelled") {
      weaknesses.push("Task was cancelled");
    }
    if (!result.costKnown) {
      weaknesses.push("Cost unknown - may be higher than expected");
    }
    if (result.changedFiles.length > 10) {
      weaknesses.push(
        `Modified many files (${result.changedFiles.length}) - may lack precision`
      );
    }

    // Analyze risks
    if (!result.costKnown) {
      riskFactors.push("Actual cost may significantly exceed estimate");
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
      result.costKnown &&
      result.compositeScore != null &&
      result.compositeScore >= 70
    ) {
      confidence = "high";
    }
    if (result.status === "failed" || result.status === "cancelled" || !result.costKnown) {
      confidence = "low";
    }

    const successRate = result.status === "success" ? 1 : 0;

    return {
      rank: index + 1,
      agentId: result.agentId,
      displayLabel: result.displayLabel,
      recommendation,
      successRate,
      avgCostPerRun: result.estimatedCostUsd,
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
    .filter((r) => r.costKnown && r.estimatedCostUsd > 0)
    .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd);

  const cheapest = successfulResults[0]?.estimatedCostUsd ?? 0;

  return results
    .map((result) => {
      const monthlyCost = result.costKnown
        ? result.estimatedCostUsd * monthlyMultiplier
        : 0;

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
  const successful = results.filter((r) => r.status === "success");
  const failed = results.filter((r) => r.status !== "success");

  if (successful.length > 0) {
    const best = successful.reduce((a, b) =>
      (a.compositeScore ?? 0) > (b.compositeScore ?? 0) ? a : b
    );
    insights.push(
      `${best.displayLabel} achieved the highest score (${best.compositeScore?.toFixed(0)}/100)`
    );
  }

  if (failed.length > 0) {
    insights.push(`${failed.length} agent(s) failed to complete the task`);
  }

  const costKnown = results.filter((r) => r.costKnown);
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

  const unknownCost = results.filter((r) => !r.costKnown);
  if (unknownCost.length > 0) {
    warnings.push(
      `${unknownCost.length} agent(s) have unknown costs - actual costs may be higher than expected`
    );
  }

  const manyChanges = results.filter((r) => r.changedFiles.length > 10);
  if (manyChanges.length > 0) {
    warnings.push(
      `${manyChanges.length} agent(s) modified many files - review changes carefully`
    );
  }

  const allFailed = results.every((r) => r.status !== "success");
  if (allFailed) {
    warnings.push(
      "All agents failed - task may be too difficult or task pack needs adjustment"
    );
  }

  return warnings;
}

/**
 * Format decision report as Markdown for export
 */
export function formatDecisionReport(report: DecisionReport): string {
  const lines: string[] = [];

  lines.push(`# AgentArena 决策报告`);
  lines.push(``);
  lines.push(`**生成时间**: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push(`**场景**: ${report.scenario}`);
  lines.push(``);

  lines.push(`## 🏆 推荐方案`);
  lines.push(``);

  for (const rec of report.recommendations) {
    const emoji =
      rec.recommendation === "recommended"
        ? "🥇"
        : rec.recommendation === "alternative"
          ? "🥈"
          : "❌";

    lines.push(`### ${emoji} #${rec.rank} ${rec.displayLabel}`);
    lines.push(``);
    lines.push(
      `- **推荐度**: ${rec.recommendation === "recommended" ? "推荐" : rec.recommendation === "alternative" ? "备选" : "不推荐"}`
    );
    lines.push(`- **成功率**: ${(rec.successRate * 100).toFixed(0)}%`);
    lines.push(`- **平均成本**: $${rec.avgCostPerRun.toFixed(2)}/次`);
    lines.push(`- **平均耗时**: ${(rec.avgDurationMs / 1000).toFixed(0)}s`);
    lines.push(
      `- **置信度**: ${rec.confidence === "high" ? "高" : rec.confidence === "medium" ? "中" : "低"}`
    );
    lines.push(``);

    if (rec.strengths.length > 0) {
      lines.push(`**优势**:`);
      for (const s of rec.strengths) {
        lines.push(`- ✅ ${s}`);
      }
      lines.push(``);
    }

    if (rec.weaknesses.length > 0) {
      lines.push(`**劣势**:`);
      for (const w of rec.weaknesses) {
        lines.push(`- ❌ ${w}`);
      }
      lines.push(``);
    }

    if (rec.riskFactors.length > 0) {
      lines.push(`**风险**:`);
      for (const r of rec.riskFactors) {
        lines.push(`- ⚠️ ${r}`);
      }
      lines.push(``);
    }
  }

  if (report.teamEstimates.length > 0) {
    const first = report.teamEstimates[0];
    lines.push(
      `## 💰 团队成本估算（${first.teamSize}人 × ${first.dailyRuns}次/天）`
    );
    lines.push(``);
    lines.push(`| Agent | 月成本 | 单次成本 | 与最便宜差距 |`);
    lines.push(`|-------|--------|----------|-------------|`);

    for (const est of report.teamEstimates) {
      const savings =
        est.costComparison.savings > 0
          ? `+$${est.costComparison.savings.toFixed(0)}`
          : "最便宜";
      lines.push(
        `| ${est.agentId} | $${est.monthlyCost.toFixed(0)} | $${est.costPerRun.toFixed(2)} | ${savings} |`
      );
    }
    lines.push(``);
  }

  if (report.keyInsights.length > 0) {
    lines.push(`## 🔍 关键发现`);
    lines.push(``);
    for (const insight of report.keyInsights) {
      lines.push(`- ${insight}`);
    }
    lines.push(``);
  }

  if (report.warnings.length > 0) {
    lines.push(`## ⚠️ 注意事项`);
    lines.push(``);
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push(``);
  }

  lines.push(`## 🔄 复现命令`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(report.reproduceCommand);
  lines.push(`\`\`\``);
  lines.push(``);

  return lines.join("\n");
}
