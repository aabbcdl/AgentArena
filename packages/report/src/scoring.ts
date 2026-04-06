/**
 * Scoring system for RepoArena benchmark results.
 *
 * Design inspiration:
 * - Issue Resolution mode → Inspired by SWE-Bench (MIT License)
 * - Efficiency First mode → Inspired by industry best practices
 * - Rotating Tasks mode → Inspired by LiveBench (Apache 2.0)
 *
 * Implementation is fully independent with no official affiliation.
 */

import type { BenchmarkRun } from "@repoarena/core";
import { findJudgeByType, hasScoreMetadata, type ScoredRun } from "./report-helpers.js";

/**
 * 计算测试通过率
 */
function testPassRatio(result: BenchmarkRun["results"][number]): number {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return judge?.success ? 1 : 0;
  }

  return judge.totalCount > 0 ? (judge.passedCount ?? 0) / judge.totalCount : judge.success ? 1 : 0;
}

/**
 * 计算关键 judge 通过率
 * 关键 judge 失败会直接影响任务完成度
 */
function criticalJudgePassRatio(result: BenchmarkRun["results"][number]): number {
  const criticalJudges = result.judgeResults.filter((j) => j.critical === true);
  if (criticalJudges.length === 0) {
    return 1;
  }
  return criticalJudges.filter((j) => j.success).length / criticalJudges.length;
}

/**
 * 计算非关键 judge 通过率
 * 非关键 judge 失败只扣分，不直接判死
 */
function nonCriticalJudgePassRatio(result: BenchmarkRun["results"][number]): number {
  const nonCriticalJudges = result.judgeResults.filter((j) => j.critical !== true);
  if (nonCriticalJudges.length === 0) {
    return 1;
  }
  return nonCriticalJudges.filter((j) => j.success).length / nonCriticalJudges.length;
}

/**
 * 检查是否有任意关键 judge 失败
 */
function hasCriticalJudgeFailure(result: BenchmarkRun["results"][number]): boolean {
  return result.judgeResults.some((j) => j.critical === true && !j.success);
}

/**
 * fail-to-pass 测试分数（Issue Resolution 模式）
 * 使用 patch-validation judge 的成功率作为代理
 */
function failToPassScore(result: BenchmarkRun["results"][number]): number {
  const judges = result.judgeResults ?? [];
  const patchValidationJudges = judges.filter(j => j.type === "patch-validation");
  if (patchValidationJudges.length === 0) return 1; // 无 judge 时默认 1
  // 如果存在 patch-validation judge，使用其成功率
  const successCount = patchValidationJudges.filter(j => j.success).length;
  return successCount / patchValidationJudges.length;
}

/**
 * pass-to-pass 测试分数（Issue Resolution 模式）
 * 当前使用 patch-validation 成功率作为代理
 */
function passToPassScore(result: BenchmarkRun["results"][number]): number {
  // 与 failToPassScore 相同逻辑 - 使用 patch-validation 成功率作为代理
  return failToPassScore(result);
}

/**
 * Lint 质量分数
 */
function lintQualityScore(result: BenchmarkRun["results"][number]): number {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return 0;
  }

  const errors = judge.errorCount ?? 0;
  const warnings = judge.warningCount ?? 0;
  return 1 / (1 + errors * 10 + warnings);
}

/**
 * 时长效率分数（与最快者对比）
 */
function durationEfficiencyScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const durations = run.results.map((entry) => entry.durationMs).filter((value) => value > 0);
  if (durations.length === 0) {
    return 0;
  }

  const fastest = Math.min(...durations);
  return fastest / Math.max(result.durationMs, fastest);
}

/**
 * 成本效率分数（与最便宜者对比）
 */
function costEfficiencyScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  const costs = run.results.filter((entry) => entry.costKnown && entry.estimatedCostUsd > 0).map((entry) => entry.estimatedCostUsd);
  if (!result.costKnown || result.estimatedCostUsd <= 0 || costs.length === 0) {
    return 0;
  }

  const cheapest = Math.min(...costs);
  return cheapest / Math.max(result.estimatedCostUsd, cheapest);
}

/**
 * Precision 分数：仅当 task 定义了 expectedChangedPaths 时才计分
 */
function precisionScore(result: BenchmarkRun["results"][number], run: BenchmarkRun): number {
  // 只有当任务定义了预期改动范围时，precision 才参与计分
  const hasExpectedPaths = run.task.expectedChangedPaths && run.task.expectedChangedPaths.length > 0;
  if (!hasExpectedPaths) {
    return 0;
  }
  
  return Math.max(result.diffPrecision?.score ?? 0, 0);
}

/**
 * Practical 风格评分模式
 * 权重：
 * - status: 0.24
 * - tests: 0.26
 * - criticalJudges: 0.20
 * - nonCriticalJudges: 0.08
 * - precision: 0.05
 * - lint: 0.03
 * - duration: 0.08
 * - cost: 0.06
 */
const PRACTICAL_WEIGHTS = {
  status: 0.24,
  tests: 0.26,
  criticalJudges: 0.20,
  nonCriticalJudges: 0.08,
  precision: 0.05,
  lint: 0.03,
  duration: 0.08,
  cost: 0.06
};

/**
 * Balanced 风格评分模式（旧版兼容）
 */
const BALANCED_WEIGHTS = {
  status: 0.3,
  tests: 0.25,
  judges: 0.15,
  lint: 0.1,
  precision: 0.1,
  duration: 0.06,
  cost: 0.04
};

// === SWE-Bench Inspired: Issue Resolution Mode ===
// Focus on whether the reported issue is actually resolved.
// Heavily weights resolution rate and test pass-through.
const ISSUE_RESOLUTION_WEIGHTS = {
  status: 0.15,
  resolutionRate: 0.45,
  failToPassTests: 0.20,
  passToPassTests: 0.15,
  duration: 0.05
};

// === CursorBench Inspired: Efficiency First Mode ===
// Emphasizes token efficiency and acceptance rate alongside quality.
// Rewards agents that produce correct results with minimal overhead.
const EFFICIENCY_FIRST_WEIGHTS = {
  status: 0.20,
  tests: 0.15,
  criticalJudges: 0.15,
  tokenEfficiency: 0.25,
  acceptanceRate: 0.10,
  duration: 0.10,
  cost: 0.05
};

// === LiveBench Inspired: Rotating Tasks Mode ===
// Balanced across category scores, critical judges, and tests.
// Designed for diverse task types with equal importance.
const ROTATING_TASKS_WEIGHTS = {
  status: 0.20,
  tests: 0.20,
  criticalJudges: 0.20,
  categoryScore: 0.20,
  duration: 0.10,
  cost: 0.10
};

// === Unified Mode: Combines all three benchmarks ===
// Comprehensive scoring that incorporates signals from all three inspirations.
// Suitable for general-purpose agent evaluation.
const COMPREHENSIVE_WEIGHTS = {
  status: 0.12,
  tests: 0.15,
  criticalJudges: 0.10,
  nonCriticalJudges: 0.05,
  resolutionRate: 0.12,
  tokenEfficiency: 0.08,
  categoryScore: 0.08,
  duration: 0.15,
  cost: 0.15,
  precision: 0.05,
  lint: 0.05
};

/**
 * 解析率分数（Issue Resolution 模式）
 * 直接使用 result 上定义的 resolutionRate，回退到 status 布尔值
 */
function resolutionRateScore(result: BenchmarkRun["results"][number]): number {
  return result.resolutionRate ?? (result.status === "success" ? 1 : 0);
}

/**
 * Token 效率分数组件（Efficiency First / Comprehensive 模式）
 * 直接使用 result 上预计算的 tokenEfficiencyScore
 */
function tokenEfficiencyScoreComponent(result: BenchmarkRun["results"][number]): number {
  return result.tokenEfficiencyScore ?? 0;
}

/**
 * 接受率分数（Efficiency First 模式）
 * 衡量 agent 生成内容被直接接受的比例
 */
function acceptanceRateScore(result: BenchmarkRun["results"][number]): number {
  return result.acceptanceRate ?? 1;
}

/**
 * 类别分数（Rotating Tasks 模式）
 * 成功完成任务即得满分，按类别平等计分
 */
function categoryScore(result: BenchmarkRun["results"][number]): number {
  return result.status === "success" ? 1 : 0;
}

/**
 * 计算综合分数
 * 核心规则：
 * 1. 失败 run 直接压入失败区间（< 50 分）
 * 2. 关键 judge 失败进入"未完成"区间（50-70 分）
 * 3. 只有任务完成后，速度和成本才拉开差距
 */
export function computeCompositeScore(
  result: BenchmarkRun["results"][number],
  run: BenchmarkRun,
  scoreWeights?: Record<string, number>,
  scoreMode?: string
): number {
  // 根据评分模式选择权重
  let weights = scoreWeights;
  if (!weights) {
    switch (scoreMode) {
      case "balanced":
        weights = BALANCED_WEIGHTS;
        break;
      case "issue-resolution":
        weights = ISSUE_RESOLUTION_WEIGHTS;
        break;
      case "efficiency-first":
        weights = EFFICIENCY_FIRST_WEIGHTS;
        break;
      case "rotating-tasks":
        weights = ROTATING_TASKS_WEIGHTS;
        break;
      case "comprehensive":
        weights = COMPREHENSIVE_WEIGHTS;
        break;
      default:
        weights = PRACTICAL_WEIGHTS;
        break;
    }
  }
  
  // 归一化权重
  const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
  const n = total > 0
    ? Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]))
    : weights;

  // 规则 1: 如果 run 失败，直接压入失败区间 (10-40 分)
  if (result.status !== "success") {
    // 即使速度快/成本低，也不能超过 40 分
    // 设置最低基础分为 10 分
    const baseScore = 10;
    const efficiencyBonus = (
      durationEfficiencyScore(result, run) * 0.3 +
      costEfficiencyScore(result, run) * 0.2
    );
    return Math.round(Math.min(40, baseScore + efficiencyBonus * 10) * 10) / 10;
  }

  // 规则 2: 检查关键 judge 是否失败
  const criticalJudgeFailed = hasCriticalJudgeFailure(result);
  
  // 计算各部分得分
  const statusScore = result.status === "success" ? 1 : 0;
  const testScore = testPassRatio(result);
  const criticalScore = criticalJudgePassRatio(result);
  const nonCriticalScore = nonCriticalJudgePassRatio(result);
  const lintScore = lintQualityScore(result);
  const precisionVal = precisionScore(result, run);
  const durationScore = durationEfficiencyScore(result, run);
  const costScore = costEfficiencyScore(result, run);
  // 新增评分组件（用于 Issue Resolution / Efficiency First / Rotating Tasks / Comprehensive 模式）
  const resolutionRateVal = resolutionRateScore(result);
  const tokenEfficiencyVal = tokenEfficiencyScoreComponent(result);
  const acceptanceRateVal = acceptanceRateScore(result);
  const categoryScoreVal = categoryScore(result);
  // Issue Resolution 模式专用分数
  const failToPassVal = failToPassScore(result);
  const passToPassVal = passToPassScore(result);

  // 规则 3: 如果关键 judge 失败，进入"未完成"区间 (50-70 分)
  if (criticalJudgeFailed) {
    const baseScore = 50 + (
      testScore * 10 +
      nonCriticalScore * 5 +
      lintScore * 3 +
      durationScore * 2
    );
    return Math.round(Math.min(70, baseScore) * 10) / 10;
  }

  // 规则 4: 任务完成，按权重计算综合分
  const weightedScore =
    statusScore * (n.status ?? 0) +
    testScore * (n.tests ?? 0) +
    criticalScore * (n.criticalJudges ?? 0) +
    nonCriticalScore * (n.nonCriticalJudges ?? 0) +
    lintScore * (n.lint ?? 0) +
    precisionVal * (n.precision ?? 0) +
    durationScore * (n.duration ?? 0) +
    costScore * (n.cost ?? 0) +
    // 新增评分组件加权
    resolutionRateVal * (n.resolutionRate ?? 0) +
    tokenEfficiencyVal * (n.tokenEfficiency ?? 0) +
    acceptanceRateVal * (n.acceptanceRate ?? 0) +
    categoryScoreVal * (n.categoryScore ?? 0) +
    // Issue Resolution 模式分数
    failToPassVal * (n.failToPassTests ?? 0) +
    passToPassVal * (n.passToPassTests ?? 0);

  // 转换为 0-100 分数
  const finalScore = weightedScore * 100;
  return Math.round(finalScore * 10) / 10;
}

/**
 * 计算分数原因
 */
export function computeScoreReasons(result: BenchmarkRun["results"][number], run: BenchmarkRun, _scoreMode?: string): string[] {
  const reasons: string[] = [];
  
  if (result.status !== "success") {
    reasons.push("failed");
    return reasons;
  }
  
  if (hasCriticalJudgeFailure(result)) {
    reasons.push("critical-judge-failed");
  }
  
  if (testPassRatio(result) >= 0.999) reasons.push("tests");
  if (criticalJudgePassRatio(result) >= 0.999) reasons.push("critical-judges");
  if (nonCriticalJudgePassRatio(result) >= 0.999) reasons.push("non-critical-judges");
  if (lintQualityScore(result) >= 0.999) reasons.push("lint");
  if (precisionScore(result, run) >= 0.999) reasons.push("precision");
  if (durationEfficiencyScore(result, run) >= 0.999) reasons.push("duration");
  if (costEfficiencyScore(result, run) >= 0.999) reasons.push("cost");
  
  return reasons;
}

/**
 * 根据评分模式获取默认权重
 */
export function getDefaultWeights(scoreMode: string): Record<string, number> {
  switch (scoreMode) {
    case "balanced":
      return BALANCED_WEIGHTS;
    case "issue-resolution":
      return ISSUE_RESOLUTION_WEIGHTS;
    case "efficiency-first":
      return EFFICIENCY_FIRST_WEIGHTS;
    case "rotating-tasks":
      return ROTATING_TASKS_WEIGHTS;
    case "comprehensive":
      return COMPREHENSIVE_WEIGHTS;
    default:
      return PRACTICAL_WEIGHTS;
  }
}

/**
 * 为 run 添加评分元数据
 */
export function enrichRunWithScores(run: BenchmarkRun): ScoredRun {
  const scoreMode = hasScoreMetadata(run) ? (run.scoreMode ?? "practical") : "practical";
  const scoreWeights = (hasScoreMetadata(run) ? run.scoreWeights : undefined) ?? getDefaultWeights(scoreMode);

  return {
    ...run,
    scoreMode,
    scoreWeights,
    scoreScope: run.scoreScope ?? "run-local",
    scoreValidityNote:
      run.scoreValidityNote ??
      "Scores only compare variants inside this run. Treat them as local rankings for the current agent version, model, and provider settings.",
    results: run.results.map((result) => ({
      ...result,
      compositeScore: computeCompositeScore(result, run, scoreWeights, scoreMode),
      scoreReasons: computeScoreReasons(result, run, scoreMode)
    }))
  };
}
