import type { AgentRunResult, BenchmarkRun } from "@agentarena/core";

export interface AggregatedAgentStats {
  agentId: string;
  displayLabel: string;
  runCount: number;
  avgScore: number;
  scoreStdDev: number;
  avgDurationMs: number;
  avgCostUsd: number;
  successRate: number;
  trend: "improving" | "stable" | "declining";
}

export interface MultiRunComparison {
  agents: AggregatedAgentStats[];
  totalRuns: number;
  dateRange: { earliest: string; latest: string };
}

/**
 * Aggregate statistics across multiple benchmark runs.
 */
export function aggregateMultiRuns(runs: BenchmarkRun[]): MultiRunComparison {
  const agentRuns = new Map<string, AgentRunResult[]>();
  for (const run of runs) {
    for (const result of run.results) {
      const existing = agentRuns.get(result.agentId) ?? [];
      existing.push(result);
      agentRuns.set(result.agentId, existing);
    }
  }

  const agents: AggregatedAgentStats[] = [];
  for (const [agentId, results] of agentRuns) {
    const scores = results.map((result) => result.compositeScore ?? 0).filter((score) => score > 0);
    const durations = results.map((result) => result.durationMs).filter((duration) => duration > 0);
    const costs = results.map((result) => result.estimatedCostUsd).filter((cost) => cost >= 0);
    const successes = results.filter((result) => result.status === "success").length;

    const avgScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const scoreStdDev =
      scores.length > 1
        ? Math.sqrt(scores.map((score) => (score - avgScore) ** 2).reduce((sum, value) => sum + value, 0) / (scores.length - 1))
        : 0;

    let trend: "improving" | "stable" | "declining" = "stable";
    if (results.length >= 3) {
      const mid = Math.floor(results.length / 2);
      const firstHalfAvg = results.slice(0, mid).reduce((sum, result) => sum + (result.compositeScore ?? 0), 0) / mid;
      const secondHalfAvg =
        results.slice(mid).reduce((sum, result) => sum + (result.compositeScore ?? 0), 0) / (results.length - mid);
      if (secondHalfAvg > firstHalfAvg * 1.05) trend = "improving";
      else if (secondHalfAvg < firstHalfAvg * 0.95) trend = "declining";
    }

    agents.push({
      agentId,
      displayLabel: results[0]?.displayLabel ?? agentId,
      runCount: results.length,
      avgScore,
      scoreStdDev,
      avgDurationMs: durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      avgCostUsd: costs.length > 0 ? costs.reduce((sum, value) => sum + value, 0) / costs.length : 0,
      successRate: results.length > 0 ? successes / results.length : 0,
      trend
    });
  }

  agents.sort((left, right) => right.avgScore - left.avgScore);

  const dates = runs.map((run) => run.createdAt).sort();
  return {
    agents,
    totalRuns: runs.length,
    dateRange: { earliest: dates[0] ?? "", latest: dates[dates.length - 1] ?? "" }
  };
}

/**
 * Format multi-run aggregation as Markdown table.
 */
export function formatMultiRunReport(comparison: MultiRunComparison): string {
  const lines: string[] = [];
  lines.push("# Multi-Run Agent Comparison");
  lines.push("");
  lines.push(`**Total Runs**: ${comparison.totalRuns}`);
  lines.push(`**Date Range**: ${comparison.dateRange.earliest} -> ${comparison.dateRange.latest}`);
  lines.push("");
  lines.push("| Agent | Runs | Avg Score | Std Dev | Success Rate | Avg Duration | Avg Cost | Trend |");
  lines.push("|-------|------|-----------|---------|--------------|--------------|----------|-------|");

  for (const agent of comparison.agents) {
    const trendEmoji = agent.trend === "improving" ? "up" : agent.trend === "declining" ? "down" : "stable";
    lines.push(
      `| ${agent.displayLabel} | ${agent.runCount} | ${agent.avgScore.toFixed(1)} | ${agent.scoreStdDev.toFixed(1)} | ${(agent.successRate * 100).toFixed(0)}% | ${(agent.avgDurationMs / 1000).toFixed(0)}s | $${agent.avgCostUsd.toFixed(2)} | ${trendEmoji} |`
    );
  }

  return lines.join("\n");
}
