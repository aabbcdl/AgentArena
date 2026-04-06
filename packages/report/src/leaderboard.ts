import type { BenchmarkRun } from "@repoarena/core";
import { formatRuntimeIdentity, getRunScoreMode } from "./report-helpers.js";

/**
 * 历史排行榜的身份键
 * 用于确定哪些 run 可以在一起比较
 */
export interface LeaderboardIdentity {
  /** 任务 ID 或标题 */
  taskId: string;
  /** 评分模式 (balanced, correctness-first, etc.) */
  scoreMode: string;
  /** 基础 Agent ID (如 codex, claude-code, cursor) */
  baseAgentId: string;
  /** Provider/Profile 名称 */
  providerProfile: string;
  /** 模型名称 */
  model: string;
  /** Agent 版本号 */
  version: string;
}

/**
 * 从 run 和 result 生成历史身份键
 */
export function getLeaderboardIdentity(run: BenchmarkRun, result: BenchmarkRun["results"][number]): LeaderboardIdentity {
  const runtime = formatRuntimeIdentity(result);
  const taskId = run.task.id || run.task.title || "unknown-task";
  const scoreMode = getRunScoreMode(run);

  return {
    taskId,
    scoreMode,
    baseAgentId: result.baseAgentId || result.agentId,
    providerProfile: runtime.provider,
    model: runtime.model,
    version: runtime.version
  };
}

/**
 * 将身份键序列化为字符串，用于 Map 查找
 */
export function serializeLeaderboardIdentity(identity: LeaderboardIdentity): string {
  return JSON.stringify([
    identity.taskId,
    identity.scoreMode,
    identity.baseAgentId,
    identity.providerProfile,
    identity.model,
    identity.version
  ]);
}

/**
 * 单个 leaderboard 行的统计数据
 */
export interface LeaderboardStats {
  /** 有效 run 数量 */
  runCount: number;
  /** 平均分数 */
  averageScore: number;
  /** 胜率 (0-1) */
  winRate: number;
  /** 成功率 (0-1) */
  successRate: number;
  /** 首次通过率 (0-1) - 第一次尝试就成功的比例 */
  firstPassRate: number;
  /** 中位数耗时 (ms) */
  medianDurationMs: number;
  /** 已知成本的中位数 (USD) */
  medianCostUsd: number | null;
  /** 已知成本的平均值 (USD) */
  averageCostUsd: number | null;
  /** 最后一次出现的时间 */
  lastSeenAt: string;
  /** 样本是否充足 */
  sampleSizeSufficient: boolean;
}

/**
 * Leaderboard 的一行数据
 */
export interface LeaderboardRow {
  /** 身份键 */
  identity: LeaderboardIdentity;
  /** 显示名称 */
  displayLabel: string;
  /** 统计数据 */
  stats: LeaderboardStats;
  /** 历史 win 次数 */
  winCount: number;
  /** 历史总对比次数 */
  totalComparisons: number;
}

/**
 * 排行榜数据
 */
export interface LeaderboardData {
  /** 任务标识 */
  taskId: string;
  /** 评分模式 */
  scoreMode: string;
  /** 难度筛选 */
  difficultyFilter: "all" | "easy" | "medium" | "hard";
  /** 可比较的 run 总数 */
  comparableRunCount: number;
  /** 被排除的 run 数 */
  excludedRunCount: number;
  /** 排行榜行 */
  rows: LeaderboardRow[];
  /** 比较规则说明 */
  comparabilityRules: string[];
}

/**
 * 从 runs 中筛选出与当前 run 可比较的 runs
 * @param difficultyFilter 难度筛选：all | easy | medium | hard
 */
export function getComparableRuns(
  runs: BenchmarkRun[],
  currentRun: BenchmarkRun,
  difficultyFilter?: "all" | "easy" | "medium" | "hard"
): BenchmarkRun[] {
  const currentTaskId = currentRun.task.id || currentRun.task.title;
  const currentScoreMode = getRunScoreMode(currentRun);

  return runs.filter((run) => {
    const taskId = run.task.id || run.task.title;
    const scoreMode = getRunScoreMode(run);
    const runDifficulty = run.task.metadata?.difficulty;
    
    // 难度筛选
    if (difficultyFilter && difficultyFilter !== "all" && runDifficulty !== difficultyFilter) {
      return false;
    }
    
    return taskId === currentTaskId && scoreMode === currentScoreMode;
  });
}

/**
 * 计算中位数
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 从可比较的 runs 中聚合生成 leaderboard
 * @param difficultyFilter 难度筛选：all | easy | medium | hard
 */
export function buildLeaderboard(
  runs: BenchmarkRun[],
  currentRun: BenchmarkRun,
  difficultyFilter: "all" | "easy" | "medium" | "hard" = "all"
): LeaderboardData {
  const comparableRuns = getComparableRuns(runs, currentRun, difficultyFilter);
  const excludedRunCount = runs.length - comparableRuns.length;

  // 按身份键聚合结果
  const resultMap = new Map<string, { runs: BenchmarkRun[]; results: BenchmarkRun["results"] }>();

  for (const run of comparableRuns) {
    for (const result of run.results) {
      const identity = getLeaderboardIdentity(run, result);
      const key = serializeLeaderboardIdentity(identity);

      if (!resultMap.has(key)) {
        resultMap.set(key, { runs: [], results: [] });
      }
      const entry = resultMap.get(key);
      if (!entry) continue;
      if (!entry.runs.includes(run)) {
        entry.runs.push(run);
      }
      entry.results.push(result);
    }
  }

  // 为每个 run 确定 winner，用于计算 win rate
  const winMap = new Map<string, number>();
  const comparisonMap = new Map<string, number>();

  for (const run of comparableRuns) {
    // 找出这个 run 里的 winner
    const successfulResults = run.results.filter((r) => r.status === "success");
    const candidates = successfulResults.length > 0 ? successfulResults : run.results;

    // 按综合分排序
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

    // 记录所有参与对比的身份
    for (const result of run.results) {
      const identity = getLeaderboardIdentity(run, result);
      const key = serializeLeaderboardIdentity(identity);
      comparisonMap.set(key, (comparisonMap.get(key) ?? 0) + 1);
    }
  }

  // 生成 leaderboard rows
  const rows: LeaderboardRow[] = [];

  for (const [key, { runs: agentRuns, results }] of resultMap) {
    const firstResult = results[0];
    const identity = getLeaderboardIdentity(agentRuns[0], firstResult);

    const scores = results.map((r) => (r.compositeScore ?? 0)).filter((s) => s > 0);
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
    
    // 计算首次通过率：每个 run 的第一个结果是否成功
    const firstPassCount = agentRuns.filter((run) => {
      const firstResult = run.results[0];
      return firstResult && firstResult.status === "success";
    }).length;
    const firstPassRate = agentRuns.length > 0 ? firstPassCount / agentRuns.length : 0;

    const lastSeenAt = agentRuns
      .map((r) => r.createdAt)
      .sort()
      .reverse()[0] ?? new Date().toISOString();

    // 样本充足性：至少 3 次 run 才算稳定
    const sampleSizeSufficient = agentRuns.length >= 3;

    rows.push({
      identity,
      displayLabel: firstResult.displayLabel || firstResult.agentId,
      stats: {
        runCount: agentRuns.length,
        averageScore: Math.round(averageScore * 10) / 10,
        winRate,
        successRate,
        firstPassRate,
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

  // 排序：平均分 > 胜率 > 成功率 > 首次通过率 > 中位数耗时
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
    if (b.stats.firstPassRate !== a.stats.firstPassRate) {
      return b.stats.firstPassRate - a.stats.firstPassRate;
    }
    return a.stats.medianDurationMs - b.stats.medianDurationMs;
  });

  return {
    taskId: currentRun.task.id || currentRun.task.title || "unknown",
    scoreMode: getRunScoreMode(currentRun),
    difficultyFilter,
    comparableRunCount: comparableRuns.length,
    excludedRunCount,
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

/**
 * 获取排行榜的显示说明
 */
export function getLeaderboardExplanation(
  leaderboard: LeaderboardData,
  locale: "en" | "zh-CN" = "en"
): string[] {
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
