import { promises as fs } from "node:fs";
import path from "node:path";
import { type BenchmarkRun, ensureDirectory } from "@repoarena/core";
import { renderHtml } from "./html-template.js";
import { buildLeaderboard, } from "./leaderboard.js";
import { renderMarkdown, renderPrComment } from "./markdown-template.js";
import { buildBadgePayload, type Locale, sanitizeRun } from "./report-helpers.js";
import { enrichRunWithScores } from "./scoring.js";

export {
  buildLeaderboard,
  getLeaderboardExplanation,
  type LeaderboardData,
  type LeaderboardIdentity,
  type LeaderboardRow,
  type LeaderboardStats
} from "./leaderboard.js";
export type { Locale, ReportCopy, ScoredResult, ScoredRun } from "./report-helpers.js";
export { computeCompositeScore, computeScoreReasons, enrichRunWithScores, getDefaultWeights } from "./scoring.js";
export {
  generateDecisionReport,
  formatDecisionReport,
  type DecisionRecommendation,
  type TeamCostEstimate,
  type DecisionReport
} from "./decision-report.js";
export {
  computeVarianceAnalysis,
  formatVarianceReport,
  type VarianceReport,
  type AgentVarianceStats
} from "./variance-analysis.js";
export { aggregateMultiRuns, formatMultiRunReport } from "./multi-run.js";
export type { MultiRunComparison, AggregatedAgentStats } from "./multi-run.js";

export interface WriteReportOptions {
  locale?: Locale;
  /** 用于生成历史排行榜的其他 runs */
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

  // 生成历史排行榜数据
  const leaderboard = buildLeaderboard(allRuns, run);

  const jsonPath = path.join(run.outputPath, "summary.json");
  const htmlPath = path.join(run.outputPath, "report.html");
  const markdownPath = path.join(run.outputPath, "summary.md");
  const badgePath = path.join(run.outputPath, "badge.json");
  const prCommentPath = path.join(run.outputPath, "pr-comment.md");

  // 导出带 leaderboard 的 JSON
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
  
  await fs.writeFile(jsonPath, JSON.stringify(exportData, null, 2), "utf8");
  await fs.writeFile(htmlPath, renderHtml(publicRun, locale, leaderboard), "utf8");
  await fs.writeFile(markdownPath, renderMarkdown(publicRun, locale, leaderboard), "utf8");
  await fs.writeFile(badgePath, JSON.stringify(buildBadgePayload(publicRun), null, 2), "utf8");
  await fs.writeFile(prCommentPath, renderPrComment(publicRun, locale, leaderboard), "utf8");

  return { htmlPath, jsonPath, markdownPath, badgePath, prCommentPath };
}
