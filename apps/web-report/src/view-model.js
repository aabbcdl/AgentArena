export {
  baseAgentLabel,
  diffPrecisionScore,
  fairComparisonIdentity,
  findJudgeByType,
  findPreviousComparableRun,
  formatCompositeScore,
  formatDiffPrecisionMetric,
  formatLintMetric,
  formatTestMetric,
  getAgentTrendRows,
  getComparableRuns,
  getCompareResults,
  getCompositeScoreDetails,
  getCompositeScoreReasons,
  getCrossRunCompareRows,
  getCrossRunRecommendation,
  getFairComparisonExclusionReasons,
  getRunCompareRows,
  getRunToRunAgentDiff,
  getRunTrustSummary,
  getRunVerdict,
  getSelectionTrustSummary, 
  judgePassRatio,
  missingCoreComparisonData,
  resultLabel,
  resultRecordKey,
  runtimeIdentity,
  summarizeRun
} from "./view-model/comparison.js";
export {
  buildPrTable, 
  buildShareCard,
  buildShareCardSvg
} from "./view-model/export-formatters.js";

export {
  buildLeaderboard,
  getLeaderboardExplanation
} from "./view-model/leaderboard.js";
export {
  DEFAULT_SCORE_WEIGHTS,
  DEPRECATED_SCORE_PRESETS,
  getAllScorePresets, 
  getMatchingScorePresetId,
  getScoreWeightPreset,
  normalizeScoreWeights,
  SCORE_WEIGHT_PRESETS
} from "./view-model/scoring.js";

export function getAgentConfidenceBadge(result, varianceStats, locale = "en") {
  if (!varianceStats || varianceStats.length === 0) return "";

  const stat = varianceStats.find((s) => s.agentId === result.agentId);
  if (!stat) return "";

  const isZhCn = locale === "zh-CN";
  const confidenceText =
    stat.confidence === "high"
      ? isZhCn
        ? "高可信"
        : "High confidence"
      : stat.confidence === "medium"
        ? isZhCn
          ? "中可信"
          : "Medium confidence"
        : isZhCn
          ? "低可信"
          : "Low confidence";
  const confidenceClass = stat.confidence;

  return `<span class="confidence-badge ${confidenceClass}" title="CV: ${(stat.scoreCV * 100).toFixed(1)}%, Runs: ${stat.runCount}">${confidenceText} (CV: ${(stat.scoreCV * 100).toFixed(0)}%)</span>`;
}
