import { promises as fs } from "node:fs";
import path from "node:path";
import { type BenchmarkRun, ensureDirectory } from "@agentarena/core";
import { renderHtml } from "./html-template.js";
import { buildLeaderboard, } from "./leaderboard.js";
import { renderMarkdown, renderPrComment } from "./markdown-template.js";
import { buildBadgePayload, type Locale, sanitizeRun } from "./report-helpers.js";
import { enrichRunWithScores } from "./scoring.js";

async function atomicWriteFile(filePath: string, content: string, retries = 3, delayMs = 100): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, content, "utf8");
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.rename(tmpPath, filePath);
      return;
    } catch (err: unknown) {
      if (attempt < retries && err instanceof Error && "code" in err && (err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES")) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      // Clean up temp file on final failure
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }
}

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
  const allRuns = options.allRuns ?? [run];
  
  await ensureDirectory(run.outputPath);
  const publicRun = sanitizeRun(enrichRunWithScores(run));

  // Build historical leaderboard from prior runs.
  const leaderboard = buildLeaderboard(allRuns, run);

  const jsonPath = path.join(run.outputPath, "summary.json");
  const htmlPath = path.join(run.outputPath, "report.html");
  const markdownPath = path.join(run.outputPath, "summary.md");
  const badgePath = path.join(run.outputPath, "badge.json");
  const prCommentPath = path.join(run.outputPath, "pr-comment.md");

  // Export JSON that includes leaderboard data alongside the run.
  const exportData = {
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
  
  await Promise.all([
    atomicWriteFile(jsonPath, JSON.stringify(exportData, null, 2)),
    atomicWriteFile(htmlPath, renderHtml(publicRun, locale, leaderboard)),
    atomicWriteFile(markdownPath, renderMarkdown(publicRun, locale, leaderboard)),
    atomicWriteFile(badgePath, JSON.stringify(buildBadgePayload(publicRun), null, 2)),
    atomicWriteFile(prCommentPath, renderPrComment(publicRun, locale, leaderboard))
  ]);

  return { htmlPath, jsonPath, markdownPath, badgePath, prCommentPath };
}
