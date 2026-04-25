import {
  getComparableRuns, 
  getLeaderboardIdentity,
  serializeLeaderboardIdentity
} from "./comparison.js";

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function buildLeaderboard(runs, currentRun) {
  const comparableRuns = getComparableRuns(runs, currentRun);
  const excludedRuns = runs.filter((run) => !comparableRuns.includes(run));

  const resultMap = new Map();

  for (const run of comparableRuns) {
    for (const result of run.results) {
      const identity = getLeaderboardIdentity(run, result);
      const key = serializeLeaderboardIdentity(identity);

      if (!resultMap.has(key)) {
        resultMap.set(key, { runs: [], results: [] });
      }
      const entry = resultMap.get(key);
      if (!entry.runs.includes(run)) {
        entry.runs.push(run);
      }
      entry.results.push(result);
    }
  }

  const winMap = new Map();
  const comparisonMap = new Map();

  for (const run of comparableRuns) {
    const successfulResults = run.results.filter((r) => r.status === "success");
    const candidates = successfulResults.length > 0 ? successfulResults : run.results;

    const sorted = [...candidates].sort((a, b) => {
      const scoreA = a.compositeScore ?? 0;
      const scoreB = b.compositeScore ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.durationMs - b.durationMs;
    });

    const winner = sorted[0];
    if (winner) {
      const winnerIdentity = getLeaderboardIdentity(run, winner);
      const winnerKey = serializeLeaderboardIdentity(winnerIdentity);
      winMap.set(winnerKey, (winMap.get(winnerKey) ?? 0) + 1);
    }

    for (const result of run.results) {
      const identity = getLeaderboardIdentity(run, result);
      const key = serializeLeaderboardIdentity(identity);
      comparisonMap.set(key, (comparisonMap.get(key) ?? 0) + 1);
    }
  }

  const rows = [];

  for (const [key, { runs: agentRuns, results }] of resultMap) {
    const firstResult = results[0];
    const identity = getLeaderboardIdentity(agentRuns[0], firstResult);

    const scores = results.map((r) => r.compositeScore ?? 0).filter((s) => s > 0);
    const durations = results.map((r) => r.durationMs).filter((d) => d > 0);
    const costs = results
      .filter((r) => r.costKnown && r.estimatedCostUsd > 0)
      .map((r) => r.estimatedCostUsd);
    const successCount = results.filter((r) => r.status === "success").length;

    const averageScore = scores.length > 0
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length
      : 0;
    const winCount = winMap.get(key) ?? 0;
    const totalComparisons = comparisonMap.get(key) ?? 0;
    const winRate = totalComparisons > 0 ? winCount / totalComparisons : 0;
    const successRate = results.length > 0 ? successCount / results.length : 0;

    const lastSeenAt = agentRuns
      .map((r) => r.createdAt)
      .sort()
      .reverse()[0] ?? new Date().toISOString();

    const sampleSizeSufficient = agentRuns.length >= 3;

    rows.push({
      identity,
      displayLabel: firstResult.displayLabel || firstResult.agentId,
      stats: {
        runCount: agentRuns.length,
        averageScore: Math.round(averageScore * 10) / 10,
        winRate,
        successRate,
        medianDurationMs: median(durations),
        medianCostUsd: costs.length > 0 ? median(costs) : null,
        averageCostUsd: costs.length > 0
          ? costs.reduce((sum, c) => sum + c, 0) / costs.length
          : null,
        lastSeenAt,
        sampleSizeSufficient
      },
      winCount,
      totalComparisons
    });
  }

  rows.sort((a, b) => {
    if (b.stats.averageScore !== a.stats.averageScore) {
      return b.stats.averageScore - a.stats.averageScore;
    }
    if (b.stats.winRate !== a.stats.winRate) {
      return b.stats.winRate - a.stats.winRate;
    }
    if (b.stats.successRate !== a.stats.successRate) {
      return b.stats.successRate - a.stats.successRate;
    }
    return a.stats.medianDurationMs - b.stats.medianDurationMs;
  });

  return {
    taskId: currentRun.task?.id || currentRun.task?.title || "unknown",
    scoreMode: currentRun.scoreMode || "balanced",
    comparableRunCount: comparableRuns.length,
    excludedRunCount: excludedRuns.length,
    rows,
    comparabilityRules: [
      "Only runs with the same task are compared",
      "Only runs with the same score mode are compared",
      "Different agent versions are treated as separate entries",
      "Different providers/profiles are treated as separate entries",
      "Different models are treated as separate entries"
    ]
  };
}

export function getLeaderboardExplanation(leaderboard, locale = "en") {
  if (locale === "zh-CN") {
    return [
      "此排行榜仅统计同任务、同评分模式、同配置的历史结果",
      "版本变化会开启新的历史记录，不会继承旧版本的分数",
      `当前榜单基于 ${leaderboard.comparableRunCount} 个可比较的 run`,
      leaderboard.excludedRunCount > 0
        ? `有 ${leaderboard.excludedRunCount} 个 run 因任务或评分模式不同被排除`
        : "所有 run 都参与对比"
    ];
  }

  return [
    "This leaderboard only compares runs with the same task, score mode, and configuration",
    "Version changes create new historical records; scores are not inherited from old versions",
    `Current leaderboard is based on ${leaderboard.comparableRunCount} comparable runs`,
    leaderboard.excludedRunCount > 0
      ? `${leaderboard.excludedRunCount} runs were excluded due to different task or score mode`
      : "All runs are included in the comparison"
  ];
}
