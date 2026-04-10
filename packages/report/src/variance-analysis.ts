import type { AgentRunResult, BenchmarkRun } from "@agentarena/core";

export interface AgentVarianceStats {
  agentId: string;
  displayLabel: string;
  runCount: number;
  scoreMean: number;
  scoreStdDev: number;
  scoreCV: number;
  durationMean: number;
  durationStdDev: number;
  costMean: number;
  costStdDev: number;
  successRate: number;
  confidence: "high" | "medium" | "low";
  isStable: boolean;
}

export interface VarianceReport {
  agents: AgentVarianceStats[];
  overallConfidence: "high" | "medium" | "low";
  recommendation: string;
  minRunsForConfidence: number;
  warnings: string[];
}

/**
 * Compute variance statistics across multiple runs for the same task.
 */
export function computeVarianceAnalysis(
  runs: BenchmarkRun[],
  options: { minRunsForConfidence?: number } = {}
): VarianceReport {
  const { minRunsForConfidence = 3 } = options;

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
    const scores = results.map((result) => result.compositeScore ?? 0).filter((score) => score > 0);
    const durations = results.map((result) => result.durationMs).filter((duration) => duration > 0);
    const costs = results.map((result) => result.estimatedCostUsd).filter((cost) => cost >= 0);
    const successes = results.filter((result) => result.status === "success").length;

    const scoreCV = computeCV(scores);

    agents.push({
      agentId,
      displayLabel: results[0]?.displayLabel ?? agentId,
      runCount: results.length,
      scoreMean: computeMean(scores),
      scoreStdDev: computeStdDev(scores),
      scoreCV,
      durationMean: computeMean(durations),
      durationStdDev: computeStdDev(durations),
      costMean: computeMean(costs),
      costStdDev: computeStdDev(costs),
      successRate: results.length > 0 ? successes / results.length : 0,
      confidence: computeConfidence(results.length, scoreCV),
      isStable: scoreCV < 0.1
    });
  }

  const warnings: string[] = [];
  for (const agent of agents) {
    if (agent.runCount < minRunsForConfidence) {
      warnings.push(`${agent.displayLabel}: only ${agent.runCount} run(s); need ${minRunsForConfidence} for reliable statistics.`);
    }
  }

  const allHaveMinRuns = agents.every((agent) => agent.runCount >= minRunsForConfidence);
  const allStable = agents.every((agent) => agent.isStable);
  const overallConfidence =
    allHaveMinRuns && allStable ? "high" : agents.some((agent) => agent.runCount >= minRunsForConfidence) ? "medium" : "low";

  const recommendation =
    overallConfidence === "high"
      ? "Results are statistically significant and reliable for decision-making."
      : overallConfidence === "medium"
        ? "Results show some consistency. Run additional comparisons for higher confidence."
        : `Results are not yet reliable. Run each agent at least ${minRunsForConfidence} times.`;

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
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = computeMean(values);
  const squaredDiffs = values.map((value) => (value - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((sum, value) => sum + value, 0) / (values.length - 1));
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
 * Format variance report as human-readable text.
 */
export function formatVarianceReport(report: VarianceReport): string {
  const lines: string[] = [];

  lines.push("## Result Confidence Analysis");
  lines.push("");
  lines.push(`**Overall confidence**: ${report.overallConfidence}`);
  lines.push(`**Recommendation**: ${report.recommendation}`);
  lines.push("");

  lines.push("| Agent | Runs | Mean Score | Std Dev | Coefficient of Variation | Stability |");
  lines.push("|-------|------|------------|---------|---------------------------|-----------|");

  for (const agent of report.agents) {
    const stability = agent.isStable ? "stable" : "volatile";
    lines.push(
      `| ${agent.displayLabel} | ${agent.runCount} | ${agent.scoreMean.toFixed(1)} | ${agent.scoreStdDev.toFixed(1)} | ${(agent.scoreCV * 100).toFixed(1)}% | ${stability} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}
