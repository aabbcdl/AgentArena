import type { BenchmarkRun } from "@agentarena/core";
import { formatCompositeScoreValue, type ScoredRun } from "./report-helpers.js";

function escapeCsvField(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function generateCsv(run: BenchmarkRun): string {
  const scoredRun = run as ScoredRun;
  const headers = [
    "Agent",
    "Base Agent",
    "Variant",
    "Status",
    "Composite Score",
    "Duration (ms)",
    "Token Usage",
    "Cost (USD)",
    "Cost Known",
    "Files Changed",
    "Judges Passed",
    "Judges Total",
    "Test Pass Rate",
    "Lint Errors",
    "Model",
    "Version",
    "Provider"
  ];

  const rows = scoredRun.results.map((result) => {
    const judgesPassed = result.judgeResults.filter((j) => j.success).length;
    const judgesTotal = result.judgeResults.length;
    const testJudge = result.judgeResults.find((j) => j.type === "test-result");
    const lintJudge = result.judgeResults.find((j) => j.type === "lint-check");
    const testPassRate = testJudge?.totalCount
      ? ((testJudge.passedCount ?? 0) / testJudge.totalCount * 100).toFixed(1) + "%"
      : testJudge?.success ? "100%" : "n/a";
    const lintErrors = lintJudge?.errorCount ?? "n/a";
    const runtime = result.resolvedRuntime;

    return [
      result.displayLabel ?? result.agentId,
      result.baseAgentId,
      result.variantId,
      result.status,
      formatCompositeScoreValue(result),
      result.durationMs,
      result.tokenUsage,
      result.costKnown ? result.estimatedCostUsd.toFixed(4) : "n/a",
      result.costKnown ? "yes" : "no",
      result.changedFiles.length,
      judgesPassed,
      judgesTotal,
      testPassRate,
      lintErrors,
      runtime?.effectiveModel ?? "n/a",
      runtime?.effectiveAgentVersion ?? "n/a",
      runtime?.providerProfileName ?? runtime?.providerSource ?? "n/a"
    ];
  });

  const csvLines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(","))
  ];

  return csvLines.join("\n") + "\n";
}
