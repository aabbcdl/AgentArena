import type { BenchmarkRun, AgentRunResult } from "@repoarena/core";

export interface AgentVarianceStats {
  agentId: string;
  displayLabel: string;
  runCount: number;
  scoreMean: number;
  scoreStdDev: number;
  scoreCV: number; // Coefficient of Variation
  durationMean: number;
  durationStdDev: number;
  costMean: number;
  costStdDev: number;
  successRate: number;
  confidence: "high" | "medium" | "low";
  isStable: boolean; // CV < 0.1 means stable
}

export interface VarianceReport {
  agents: AgentVarianceStats[];
  overallConfidence: "high" | "medium" | "low";
  recommendation: string;
  minRunsForConfidence: number;
  warnings: string[];
}

/**
 * Compute variance statistics across multiple runs for the same task
 */
export function computeVarianceAnalysis(
  runs: BenchmarkRun[],
  options: { minRunsForConfidence?: number } = {}
): VarianceReport {
  const { minRunsForConfidence = 3 } = options;

  // Group runs by agent
  const agentResults = new Map<string, AgentRunResult[]>();
  for (const run of runs) {
    for (const result of run.results) {
      const existing = agentResults.get(result.agentId) ?? [];
      existing.push(result);
      agentResults.set(result.agentId, existing);
    }
  }

  const agents: AgentVarianceStats[] = [];
  for (const [agentId, results] of agentResults) {
    const scores = results.map((r) => r.compositeScore ?? 0).filter((s) => s > 0);
    const durations = results.map((r) => r.durationMs).filter((d) => d > 0);
    const costs = results.map((r) => r.estimatedCostUsd).filter((c) => c >= 0);
    const successes = results.filter((r) => r.status === "success").length;

    agents.push({
      agentId,
      displayLabel: results[0]?.displayLabel ?? agentId,
      runCount: results.length,
      scoreMean: computeMean(scores),
      scoreStdDev: computeStdDev(scores),
      scoreCV: computeCV(scores),
      durationMean: computeMean(durations),
      durationStdDev: computeStdDev(durations),
      costMean: computeMean(costs),
      costStdDev: computeStdDev(costs),
      successRate: results.length > 0 ? successes / results.length : 0,
      confidence: computeConfidence(results.length, computeCV(scores)),
      isStable: computeCV(scores) < 0.1
    });
  }

  // 生成警告信息
  const warnings: string[] = [];
  for (const agent of agents) {
    if (agent.runCount < minRunsForConfidence) {
      warnings.push(`${agent.displayLabel}: Only ${agent.runCount} run(s), need ${minRunsForConfidence} for reliable statistics`);
    }
  }

  // Overall confidence
  const allHaveMinRuns = agents.every((a) => a.runCount >= minRunsForConfidence);
  const allStable = agents.every((a) => a.isStable);
  const overallConfidence =
    allHaveMinRuns && allStable
      ? "high"
      : agents.some((a) => a.runCount >= minRunsForConfidence)
        ? "medium"
        : "low";

  const recommendation =
    overallConfidence === "high"
      ? "Results are statistically significant and reliable for decision-making."
      : overallConfidence === "medium"
        ? "Results show some consistency. Consider running more times for higher confidence."
        : `Results may not be reliable. Recommend running at least ${minRunsForConfidence} times for each agent.`;

  return {
    agents,
    overallConfidence,
    recommendation,
    minRunsForConfidence,
    warnings
  };
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = computeMean(values);
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1));
}

function computeCV(values: number[]): number {
  const mean = computeMean(values);
  if (mean === 0) return 0;
  const stdDev = computeStdDev(values);
  return stdDev / mean;
}

function computeConfidence(runCount: number, cv: number): "high" | "medium" | "low" {
  if (runCount >= 5 && cv < 0.05) return "high";
  if (runCount >= 3 && cv < 0.1) return "medium";
  return "low";
}

/**
 * Format variance report as human-readable text
 */
export function formatVarianceReport(report: VarianceReport): string {
  const lines: string[] = [];

  lines.push(`## 📊 结果可信度分析`);
  lines.push(``);
  lines.push(
    `**整体置信度**: ${report.overallConfidence === "high" ? "高" : report.overallConfidence === "medium" ? "中" : "低"}`
  );
  lines.push(`**建议**: ${report.recommendation}`);
  lines.push(``);

  lines.push(`| Agent | 运行次数 | 平均分 | 标准差 | 变异系数 | 稳定性 |`);
  lines.push(`|-------|---------|--------|--------|---------|--------|`);

  for (const agent of report.agents) {
    const stability = agent.isStable ? "✅ 稳定" : "⚠️ 波动";
    lines.push(
      `| ${agent.displayLabel} | ${agent.runCount} | ${agent.scoreMean.toFixed(1)} | ${agent.scoreStdDev.toFixed(1)} | ${(agent.scoreCV * 100).toFixed(1)}% | ${stability} |`
    );
  }

  lines.push(``);
  return lines.join("\n");
}
