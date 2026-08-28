import path from "node:path";
import { type BenchmarkRun, ensureDirectory, SUMMARY_ARTIFACT_SCHEMA, writeAtomic } from "@agentarena/core";
import { renderHtml } from "./html-template.js";
import { buildLeaderboard, } from "./leaderboard.js";
import { renderMarkdown, renderPrComment } from "./markdown-template.js";
import { buildBadgePayload, type Locale, sanitizeRun } from "./report-helpers.js";
import { enrichRunWithScores } from "./scoring.js";

export { getDefaultWeights } from "@agentarena/core";
export type { RunConclusion } from "./conclusion.js";
export { generateConclusion } from "./conclusion.js";
export { generateCsv } from "./csv-export.js";
export {
  type DecisionRecommendation,
  type DecisionReport, 
  formatDecisionReport,
  generateDecisionReport,
  type TeamCostEstimate
} from "./decision-report.js";
export {
  buildLeaderboard,
  getComparableRuns,
  getLeaderboardExplanation,
  type LeaderboardData,
  type LeaderboardIdentity,
  type LeaderboardRow,
  type LeaderboardStats
} from "./leaderboard.js";
export type { AggregatedAgentStats, MultiRunComparison } from "./multi-run.js";
export { aggregateMultiRuns, formatMultiRunReport } from "./multi-run.js";
export type { Locale, ReportCopy, ScoredResult, ScoredRun } from "./report-helpers.js";
export { formatCompositeScoreValue, getReportCopy, isResultScoreExcluded, sanitizeRun } from "./report-helpers.js";
export {
  CRITICAL_FAIL_SCORE_BAND,
  computeCompositeScore,
  computeScoreComponents,
  computeScoreReasons,
  enrichRunWithScores,
  FAILED_SCORE_BAND,
  isScoreExcluded,
  normalizeApplicableWeights
} from "./scoring.js";
export {
  type CompositeScore,
  getDefaultScoreComponents,
  type ScoreComponents,
  validateCompositeScore,
  validateScoreComponents
} from "./scoring-schema.js";
export {
  type AgentVarianceStats,
  computeVarianceAnalysis,
  formatVarianceReport,
  type VarianceReport
} from "./variance-analysis.js";

export interface WriteReportOptions {
  locale?: Locale;
  /** Additional runs used to build the historical leaderboard. */
  allRuns?: BenchmarkRun[];
}

export async function writeReport(
  run: BenchmarkRun,
  options: WriteReportOptions = {}
): Promise<{ htmlPath: string; jsonPath: string; markdownPath: string; badgePath: string; prCommentPath: string }> {
  const locale = options.locale ?? "en";
  const allRuns = options.allRuns ?? [];
  
  await ensureDirectory(run.outputPath);
  const scoredRun = enrichRunWithScores(run);
  const publicRun = sanitizeRun(scoredRun);

  // Score historical and current runs through the same pipeline before aggregation.
  const leaderboardRuns = allRuns
    .filter((candidate) => candidate.runId !== run.runId)
    .map((candidate) => enrichRunWithScores(candidate));
  leaderboardRuns.push(scoredRun);
  const leaderboard = buildLeaderboard(leaderboardRuns, scoredRun);

  const jsonPath = path.join(run.outputPath, "summary.json");
  const htmlPath = path.join(run.outputPath, "report.html");
  const markdownPath = path.join(run.outputPath, "summary.md");
  const badgePath = path.join(run.outputPath, "badge.json");
  const prCommentPath = path.join(run.outputPath, "pr-comment.md");

  // Export JSON that includes leaderboard data alongside the run.
  const exportData = {
    artifactSchemaVersion: SUMMARY_ARTIFACT_SCHEMA,
    ...publicRun,
    leaderboard: {
      taskId: leaderboard.taskId,
      scoreMode: leaderboard.scoreMode,
      comparableRunCount: leaderboard.comparableRunCount,
      excludedRunCount: leaderboard.excludedRunCount,
      rows: leaderboard.rows.map((row) => ({
        identity: row.identity,
        displayLabel: row.displayLabel,
        stats: row.stats,
        winCount: row.winCount,
        totalComparisons: row.totalComparisons
      })),
      comparabilityRules: leaderboard.comparabilityRules
    }
  };
  
  // Use core writeAtomic (fsync + Windows rename recovery) — same contract as
  // agent result.json and UI run-state.json.
  await Promise.all([
    writeAtomic(jsonPath, JSON.stringify(exportData, null, 2)),
    writeAtomic(htmlPath, renderHtml(publicRun, locale, leaderboard)),
    writeAtomic(markdownPath, renderMarkdown(publicRun, locale, leaderboard)),
    writeAtomic(badgePath, JSON.stringify(buildBadgePayload(publicRun), null, 2)),
    writeAtomic(prCommentPath, renderPrComment(publicRun, locale, leaderboard))
  ]);

  return { htmlPath, jsonPath, markdownPath, badgePath, prCommentPath };
}
