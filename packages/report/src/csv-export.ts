import { type BenchmarkRun, resolveCostQuality } from "@agentarena/core";
import { formatCompositeScoreValue, type ScoredResult, type ScoredRun } from "./report-helpers.js";
import { enrichRunWithScores } from "./scoring.js";

function escapeCsvField(value: unknown): string {
  let str = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function generateCsv(run: BenchmarkRun): string {
  // Enrich only when scores are missing so CSV output matches the JSON/HTML
  // reports (which render "n/a" for un-scored results) instead of enriching
  // solely based on task presence.
  const needsEnrichment = (run.results ?? []).some(
    (result) => typeof (result as ScoredResult).compositeScore !== "number"
  );
  const scoredRun = needsEnrichment ? (enrichRunWithScores(run) as ScoredRun) : (run as ScoredRun);
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
    "Cost Quality",
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
      resolveCostQuality(result) !== "unavailable" && Number.isFinite(result.estimatedCostUsd) ? result.estimatedCostUsd.toFixed(4) : "n/a",
      resolveCostQuality(result) === "known" ? "yes" : "no",
      resolveCostQuality(result),
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
