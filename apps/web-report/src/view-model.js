/**
 * View model for AgentArena Web Report.
 *
 * TODO: Migrate to TypeScript for type safety.
 * This file contains critical scoring logic that should be type-checked.
 */

// Match backend PRACTICAL_WEIGHTS exactly (packages/report/src/scoring.ts)
export const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  status: 0.24,
  tests: 0.26,
  criticalJudges: 0.20,
  nonCriticalJudges: 0.08,
  precision: 0.05,
  lint: 0.03,
  duration: 0.08,
  cost: 0.06
});

// Simplified core presets - match backend weight definitions exactly
export const SCORE_WEIGHT_PRESETS = Object.freeze({
  // Match backend practical (default)
  "practical": Object.freeze({
    status: 0.24,
    tests: 0.26,
    criticalJudges: 0.20,
    nonCriticalJudges: 0.08,
    precision: 0.05,
    lint: 0.03,
    duration: 0.08,
    cost: 0.06
  }),
  // Match backend balanced
  "balanced": Object.freeze({
    status: 0.30,
    tests: 0.25,
    judges: 0.15,
    lint: 0.10,
    precision: 0.10,
    duration: 0.06,
    cost: 0.04
  }),
  // Match backend issue-resolution
  "issue-resolution": Object.freeze({
    status: 0.15,
    resolutionRate: 0.45,
    failToPassTests: 0.20,
    passToPassTests: 0.15,
    duration: 0.05
  }),
  // Match backend efficiency-first
  "efficiency-first": Object.freeze({
    status: 0.20,
    tests: 0.15,
    criticalJudges: 0.15,
    tokenEfficiency: 0.25,
    acceptanceRate: 0.10,
    duration: 0.10,
    cost: 0.05
  }),
  // Match backend rotating-tasks
  "rotating-tasks": Object.freeze({
    status: 0.20,
    tests: 0.20,
    criticalJudges: 0.20,
    categoryScore: 0.20,
    duration: 0.10,
    cost: 0.10
  }),
  // Match backend comprehensive
  "comprehensive": Object.freeze({
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
  })
});

// Keep truly deprecated presets for backward compatibility (no longer overlap with core presets)
export const DEPRECATED_SCORE_PRESETS = Object.freeze({
  "correctness-first": Object.freeze({ status: 0.20, tests: 0.30, criticalJudges: 0.25, nonCriticalJudges: 0.10, duration: 0.10, cost: 0.05 }),
  "speed-first": Object.freeze({ status: 0.12, tests: 0.08, judges: 0.08, lint: 0.02, precision: 0.02, duration: 0.48, cost: 0.2 }),
  "cost-first": Object.freeze({ status: 0.12, tests: 0.1, judges: 0.08, lint: 0.05, precision: 0.05, duration: 0.1, cost: 0.5 }),
  "scope-discipline": Object.freeze({ status: 0.14, tests: 0.1, judges: 0.08, lint: 0.06, precision: 0.56, duration: 0.03, cost: 0.03 })
});

/**
 * @param {string} [presetId]
 * @returns {Record<string, number>}
 */
export function getScoreWeightPreset(presetId = "practical") {
  // Default to 'practical' to match CLI default
  if (SCORE_WEIGHT_PRESETS[presetId]) {
    return SCORE_WEIGHT_PRESETS[presetId];
  }
  // Fall back to deprecated presets for backward compatibility
  if (DEPRECATED_SCORE_PRESETS[presetId]) {
    return DEPRECATED_SCORE_PRESETS[presetId];
  }
  // Default to practical
  return SCORE_WEIGHT_PRESETS.practical;
}

/**
 * @param {Record<string, number>} [weights]
 * @returns {string | null}
 */
export function getMatchingScorePresetId(weights = DEFAULT_SCORE_WEIGHTS) {
  const normalized = normalizeScoreWeights(weights);
  return (
    Object.entries(SCORE_WEIGHT_PRESETS).find(([, preset]) => {
      const normalizedPreset = normalizeScoreWeights(/** @type {Record<string, number>} */ (preset));
      return Object.keys(normalizedPreset).every((key) => Math.abs(normalizedPreset[key] - normalized[key]) < 0.001);
    })?.[0] ?? null
  );
}

/**
 * @param {Record<string, number>} [weights]
 * @returns {Record<string, number>}
 */
export function normalizeScoreWeights(weights = DEFAULT_SCORE_WEIGHTS) {
  const merged = {
    ...DEFAULT_SCORE_WEIGHTS,
    ...(weights ?? {})
  };
  const sanitized = Object.fromEntries(
    Object.entries(merged).map(([key, value]) => [key, Number.isFinite(value) && value >= 0 ? value : 0])
  );
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return { ...DEFAULT_SCORE_WEIGHTS };
  }

  return Object.fromEntries(Object.entries(sanitized).map(([key, value]) => [key, value / total]));
}

// Helper to get all available presets (core + deprecated)
export function getAllScorePresets() {
  return { ...SCORE_WEIGHT_PRESETS, ...DEPRECATED_SCORE_PRESETS };
}

export function summarizeRun(run) {
  const successCount = run.results.filter((result) => result.status === "success").length;
  const failedCount = run.results.filter((result) => result.status === "failed").length;
  const totalTokens = run.results.reduce((total, result) => total + result.tokenUsage, 0);
  const knownCost = run.results
    .filter((result) => result.costKnown)
    .reduce((total, result) => total + result.estimatedCostUsd, 0);

  return {
    successCount,
    failedCount,
    totalAgents: run.results.length,
    totalTokens,
    knownCost
  };
}

export function runtimeIdentity(result) {
  return {
    provider: result.resolvedRuntime?.providerProfileName ?? result.requestedConfig?.providerProfileId ?? "official",
    providerKind: result.resolvedRuntime?.providerKind ?? "unknown",
    providerSource: result.resolvedRuntime?.providerSource ?? "unknown",
    model: result.resolvedRuntime?.effectiveModel ?? result.requestedConfig?.model ?? "unknown",
    reasoning:
      result.resolvedRuntime?.effectiveReasoningEffort ??
      result.requestedConfig?.reasoningEffort ??
      "default",
    version: result.resolvedRuntime?.effectiveAgentVersion ?? "unknown",
    versionSource: result.resolvedRuntime?.agentVersionSource ?? "unknown",
    source: result.resolvedRuntime?.source ?? "unknown",
    verification: result.resolvedRuntime?.verification ?? "unknown"
  };
}

export function resultRecordKey(result) {
  const runtime = runtimeIdentity(result);
  return `${result.variantId ?? result.agentId}@@${runtime.version}`;
}

function resultKey(result) {
  return resultRecordKey(result);
}

export function fairComparisonIdentity(run) {
  return {
    taskIdentity: run.fairComparison?.taskIdentity ?? taskIdentity(run),
    judgeIdentity: run.fairComparison?.judgeIdentity ?? null,
    repoBaselineIdentity: run.fairComparison?.repoBaselineIdentity ?? null
  };
}

export function missingCoreComparisonData(run) {
  if (!run?.results?.length) return true;
  return run.results.some((result) => {
    const hasStatus = typeof result.status === "string" && result.status.length > 0;
    const hasJudgeResults = Array.isArray(result.judgeResults);
    const hasScoreInputs = typeof result.durationMs === "number" && typeof result.tokenUsage === "number";
    return !hasStatus || !hasJudgeResults || !hasScoreInputs;
  });
}

export function getFairComparisonExclusionReasons(candidateRun, anchorRun) {
  const candidate = fairComparisonIdentity(candidateRun);
  const anchor = fairComparisonIdentity(anchorRun);
  const reasons = [];

  if (!candidate.taskIdentity || candidate.taskIdentity !== anchor.taskIdentity) {
    reasons.push("different-task-pack");
  }
  if (!candidate.judgeIdentity || candidate.judgeIdentity !== anchor.judgeIdentity) {
    reasons.push("different-judge-logic");
  }
  if (!candidate.repoBaselineIdentity || candidate.repoBaselineIdentity !== anchor.repoBaselineIdentity) {
    reasons.push("different-repo-baseline");
  }
  if (missingCoreComparisonData(candidateRun)) {
    reasons.push("missing-core-data");
  }

  return reasons;
}

function taskIdentity(run) {
  if (!run?.task) {
    return null;
  }

  if (run.task.id) {
    return `id:${run.task.id}`;
  }

  if (run.task.title) {
    return `title:${run.task.title}`;
  }

  return null;
}

function areRunsComparable(leftRun, rightRun) {
  const leftIdentity = taskIdentity(leftRun);
  const rightIdentity = taskIdentity(rightRun);
  if (!leftIdentity || !rightIdentity) {
    return false;
  }

  return leftIdentity === rightIdentity;
}

export function resultLabel(result) {
  return result.displayLabel ?? result.agentTitle ?? result.variantId ?? result.agentId;
}

export function baseAgentLabel(result) {
  return result.baseAgentId ?? result.agentId;
}

export function judgePassRatio(result) {
  if (result.judgeResults.length === 0) {
    return 0;
  }

  return result.judgeResults.filter((judge) => judge.success).length / result.judgeResults.length;
}

export function diffPrecisionScore(result) {
  return typeof result.diffPrecision?.score === "number" ? result.diffPrecision.score : -1;
}

export function findJudgeByType(result, type) {
  return result.judgeResults.find((judge) => judge.type === type) ?? null;
}

export function formatTestMetric(result) {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return "n/a";
  }

  return `${judge.passedCount ?? 0}/${judge.totalCount}`;
}

export function formatLintMetric(result) {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return "n/a";
  }

  return `${judge.errorCount ?? 0}E/${judge.warningCount ?? 0}W`;
}

export function formatDiffPrecisionMetric(result) {
  if (typeof result.diffPrecision?.score !== "number") {
    return "n/a";
  }

  return `${Math.round(result.diffPrecision.score * 100)}%`;
}

function durationEfficiencyScore(result, run) {
  const durations = run.results.map((entry) => entry.durationMs).filter((value) => value > 0);
  if (durations.length === 0) {
    return 0;
  }

  const fastest = Math.min(...durations);
  if (fastest <= 0) return 0;
  return fastest / Math.max(result.durationMs, fastest);
}

function costEfficiencyScore(result, run) {
  const costs = run.results.filter((entry) => entry.costKnown && entry.estimatedCostUsd > 0).map((entry) => entry.estimatedCostUsd);
  if (!result.costKnown || result.estimatedCostUsd <= 0 || costs.length === 0) {
    return 0;
  }

  const cheapest = Math.min(...costs);
  if (cheapest <= 0) return 0;
  return cheapest / Math.max(result.estimatedCostUsd, cheapest);
}

function testPassRatio(result) {
  const judge = findJudgeByType(result, "test-result");
  if (!judge || typeof judge.totalCount !== "number") {
    return -1;
  }

  return judge.totalCount > 0 ? (judge.passedCount ?? 0) / judge.totalCount : judge.success ? 1 : 0;
}

function lintQualityScore(result) {
  const judge = findJudgeByType(result, "lint-check");
  if (!judge) {
    return -1;
  }

  const errors = judge.errorCount ?? 0;
  const warnings = judge.warningCount ?? 0;
  return 1 / (1 + errors * 10 + warnings);
}

export function getCompositeScoreDetails(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  const normalizedWeights = normalizeScoreWeights(weights);
  const statusScore = result.status === "success" ? 1 : 0;
  const testsScore = Math.max(testPassRatio(result), 0);
  const criticalJudgePassRatio = result.criticalJudgePassRatio ?? judgePassRatio(result);
  const nonCriticalJudgePassRatio = result.nonCriticalJudgePassRatio ?? judgePassRatio(result);
  const criticalJudgesScore = Math.max(criticalJudgePassRatio, 0);
  const nonCriticalJudgesScore = Math.max(nonCriticalJudgePassRatio, 0);
  const lintScore = Math.max(lintQualityScore(result), 0);
  const precisionScore = Math.max(diffPrecisionScore(result), 0);
  const durationScore = durationEfficiencyScore(result, run);
  const costScore = costEfficiencyScore(result, run);
  // New components with proper fallbacks
  const resolutionRateScore = result.resolutionRate ?? (result.status === "success" ? 1 : 0);
  const tokenEfficiencyScore = result.tokenEfficiencyScore ?? 0.5;
  const acceptanceRateScore = result.acceptanceRate ?? 1;
  const categoryScoreScore = result.status === "success" ? 1 : 0;

  const weightedScore =
    statusScore * (normalizedWeights.status ?? 0) +
    testsScore * (normalizedWeights.tests ?? 0) +
    criticalJudgesScore * (normalizedWeights.criticalJudges ?? 0) +
    nonCriticalJudgesScore * (normalizedWeights.nonCriticalJudges ?? 0) +
    lintScore * (normalizedWeights.lint ?? 0) +
    precisionScore * (normalizedWeights.precision ?? 0) +
    durationScore * (normalizedWeights.duration ?? 0) +
    costScore * (normalizedWeights.cost ?? 0) +
    resolutionRateScore * (normalizedWeights.resolutionRate ?? 0) +
    tokenEfficiencyScore * (normalizedWeights.tokenEfficiency ?? 0) +
    acceptanceRateScore * (normalizedWeights.acceptanceRate ?? 0) +
    categoryScoreScore * (normalizedWeights.categoryScore ?? 0);

  return {
    total: Math.round(weightedScore * 1000) / 10,
    weights: normalizedWeights,
    components: {
      status: statusScore,
      tests: testsScore,
      criticalJudges: criticalJudgesScore,
      nonCriticalJudges: nonCriticalJudgesScore,
      lint: lintScore,
      precision: precisionScore,
      duration: durationScore,
      cost: costScore,
      resolutionRate: resolutionRateScore,
      tokenEfficiency: tokenEfficiencyScore,
      acceptanceRate: acceptanceRateScore,
      categoryScore: categoryScoreScore
    }
  };
}

export function formatCompositeScore(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  return `${getCompositeScoreDetails(result, run, weights).total.toFixed(1)}`;
}

export function getCompositeScoreReasons(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  const details = getCompositeScoreDetails(result, run, weights);
  const reasons = [];
  const normalizedWeights = normalizeScoreWeights(weights);

  if (details.components.tests >= 0.999) {
    reasons.push("tests");
  }
  if (details.components.criticalJudges >= 0.999) {
    reasons.push("criticalJudges");
  }
  if (details.components.nonCriticalJudges >= 0.999) {
    reasons.push("nonCriticalJudges");
  }
  if (details.components.lint >= 0.999) {
    reasons.push("lint");
  }
  if (details.components.precision >= 0.999) {
    reasons.push("precision");
  }
  if (details.components.duration >= 0.999) {
    reasons.push("duration");
  }
  if (details.components.cost >= 0.999) {
    reasons.push("cost");
  }
  // New components: use more meaningful thresholds (> 0.95 of their weight contribution)
  if (details.components.resolutionRate > 0.95 * normalizedWeights.resolutionRate && normalizedWeights.resolutionRate > 0) {
    reasons.push("resolution-rate-high");
  }
  if (details.components.tokenEfficiency > 0.95 * normalizedWeights.tokenEfficiency && normalizedWeights.tokenEfficiency > 0) {
    reasons.push("token-efficiency-good");
  }
  // acceptanceRate default is 1, so skip it
  // categoryScore is binary based on status, skip

  return reasons;
}

function resultQualitySort(left, right, weights = DEFAULT_SCORE_WEIGHTS) {
  const scopedRun = { results: [left, right] };
  const scoreDelta = getCompositeScoreDetails(right, scopedRun, weights).total - getCompositeScoreDetails(left, scopedRun, weights).total;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const precisionDelta = diffPrecisionScore(right) - diffPrecisionScore(left);
  if (precisionDelta !== 0) {
    return precisionDelta;
  }

  return left.durationMs - right.durationMs;
}

export function getRunVerdict(run, options = {}) {
  const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const successfulResults = run.results.filter((result) => result.status === "success");
  const candidates = successfulResults.length > 0 ? successfulResults : run.results;
  const fastest = [...candidates].sort((left, right) => left.durationMs - right.durationMs)[0] ?? null;
  const lowestKnownCost =
    [...run.results.filter((result) => result.costKnown)].sort(
      (left, right) => left.estimatedCostUsd - right.estimatedCostUsd
    )[0] ?? null;
  const highestJudgePassRate =
    [...run.results].sort((left, right) => judgePassRatio(right) - judgePassRatio(left))[0] ?? null;
  const bestAgent = [...run.results].sort((left, right) => {
    const scoreDelta = getCompositeScoreDetails(right, run, scoreWeights).total - getCompositeScoreDetails(left, run, scoreWeights).total;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return resultQualitySort(left, right, scoreWeights);
  })[0] ?? null;

  return {
    bestAgent,
    fastest,
    lowestKnownCost,
    highestJudgePassRate
  };
}

function runCompareSortValue(sort, row) {
  switch (sort) {
    case "success":
      return row.summary.successCount / Math.max(row.summary.totalAgents, 1);
    case "tokens":
      return row.summary.totalTokens;
    case "cost":
      return -row.summary.knownCost;
    case "created":
    default:
      return row.run.createdAt;
  }
}

export function getRunCompareRows(runs, options = {}) {
  const taskTitle = options.taskTitle ?? null;
  const sort = options.sort ?? "created";
  const markdownByRunId = options.markdownByRunId ?? new Map();
  const currentRunId = options.currentRunId ?? null;

  const filteredRuns = runs.filter((run) => !taskTitle || run.task.title === taskTitle);
  const anchorRun = filteredRuns.find((run) => run.runId === currentRunId) ?? filteredRuns[0] ?? null;

  if (!anchorRun) {
    return { anchorRun: null, comparableRows: [], excludedRows: [] };
  }

  const comparableRows = [];
  const excludedRows = [];

  for (const run of filteredRuns) {
    const row = {
      run,
      summary: summarizeRun(run),
      hasMarkdown: markdownByRunId.has(run.runId)
    };
    const reasons = run.runId === anchorRun.runId ? [] : getFairComparisonExclusionReasons(run, anchorRun);
    if (reasons.length === 0) {
      comparableRows.push(row);
    } else {
      excludedRows.push({ ...row, reasons });
    }
  }

  const sortedComparable = comparableRows.sort((left, right) => {
    if (sort === "created") {
      return right.run.createdAt.localeCompare(left.run.createdAt);
    }
    const rightValue = runCompareSortValue(sort, right);
    const leftValue = runCompareSortValue(sort, left);
    if (rightValue === leftValue) {
      return right.run.createdAt.localeCompare(left.run.createdAt);
    }
    return rightValue > leftValue ? 1 : -1;
  });

  return {
    anchorRun,
    comparableRows: sortedComparable,
    excludedRows: excludedRows.sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
  };
}

export function getCompareResults(run, options = {}) {
  const status = options.status ?? "all";
  const sort = options.sort ?? "status";
  const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;

  const filteredResults = run.results.filter((result) => status === "all" || result.status === status);
  return [...filteredResults].sort((left, right) => {
    switch (sort) {
      case "duration":
        return left.durationMs - right.durationMs;
      case "tokens":
        return right.tokenUsage - left.tokenUsage;
      case "cost":
        return (left.costKnown ? left.estimatedCostUsd : Number.POSITIVE_INFINITY) -
          (right.costKnown ? right.estimatedCostUsd : Number.POSITIVE_INFINITY);
      case "changed":
        return right.changedFiles.length - left.changedFiles.length;
      case "judges":
        return judgePassRatio(right) - judgePassRatio(left);
      case "precision":
        return diffPrecisionScore(right) - diffPrecisionScore(left);
      case "status":
      default: {
        const scoreDelta = getCompositeScoreDetails(right, run, scoreWeights).total - getCompositeScoreDetails(left, run, scoreWeights).total;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return resultQualitySort(left, right, scoreWeights);
      }
    }
  });
}

export function buildShareCard(run, options = {}) {
  const summary = summarizeRun(run);
  const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const verdict = getRunVerdict(run, { scoreWeights });
  const scoreModeLabel = options.scoreModeLabel ?? null;
  const lines = [
    `AgentArena | ${run.task.title}`,
    `${summary.successCount}/${summary.totalAgents} agents passed`,
    `Failed: ${summary.failedCount}`,
    `Tokens: ${summary.totalTokens}`,
    `Known cost: $${summary.knownCost.toFixed(2)}`
  ];

  if (scoreModeLabel) {
    lines.push(`Score mode: ${scoreModeLabel}`);
  }

  if (verdict.bestAgent) {
    const runtime = runtimeIdentity(verdict.bestAgent);
    lines.push(
      `Best variant: ${resultLabel(verdict.bestAgent)} (${baseAgentLabel(verdict.bestAgent)} | ${runtime.provider} | ${runtime.model} | ${runtime.reasoning} | ${runtime.version} | score ${formatCompositeScore(verdict.bestAgent, run, scoreWeights)})`
    );
  }

  if (verdict.fastest) {
    lines.push(`Fastest: ${resultLabel(verdict.fastest)} (${verdict.fastest.durationMs}ms)`);
  }

  return lines.join("\n");
}

export function buildShareCardSvg(run, options = {}) {
  const summary = summarizeRun(run);
  const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const scoreModeLabel = options.scoreModeLabel ?? null;
  const verdict = getRunVerdict(run, { scoreWeights });
  const esc = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const truncate = (str, max) => {
    const s = String(str);
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  };
  const font = "Inter, system-ui, -apple-system, sans-serif";
  const successRate = summary.totalAgents > 0
    ? Math.round((summary.successCount / summary.totalAgents) * 100)
    : 0;

  // Build agent result bars
  const agentBars = run.results.slice(0, 6).map((result, i) => {
    const y = 310 + i * 44;
    const label = truncate(resultLabel(result), 28);
    const runtime = runtimeIdentity(result);
    const model = truncate(runtime.model, 20);
    const passed = result.judgeResults.filter((j) => j.success).length;
    const total = result.judgeResults.length;
    const isSuccess = result.status === "success";
    const barColor = isSuccess ? "#10b981" : "#ef4444";
    const barWidth = total > 0 ? Math.max(40, (passed / total) * 440) : (isSuccess ? 440 : 40);
    return `
    <rect x="380" y="${y}" width="440" height="28" rx="6" fill="#1e1e2e" />
    <rect x="380" y="${y}" width="${barWidth}" height="28" rx="6" fill="${barColor}" opacity="0.7" />
    <text x="92" y="${y + 20}" fill="#e2e8f0" font-family="${font}" font-size="15" font-weight="500">${esc(label)}</text>
    <text x="830" y="${y + 20}" fill="#94a3b8" font-family="${font}" font-size="13" text-anchor="end">${esc(model)}</text>
    <rect x="840" y="${y + 4}" width="64" height="20" rx="4" fill="${isSuccess ? '#065f46' : '#7f1d1d'}" />
    <text x="872" y="${y + 18}" fill="${isSuccess ? '#6ee7b7' : '#fca5a5'}" font-family="${font}" font-size="12" text-anchor="middle" font-weight="600">${isSuccess ? "PASS" : "FAIL"}</text>
    <text x="920" y="${y + 20}" fill="#64748b" font-family="${font}" font-size="12">${passed}/${total}</text>`;
  }).join("");

  const moreAgents = run.results.length > 6
    ? `<text x="600" y="${310 + 6 * 44 + 16}" fill="#64748b" font-family="${font}" font-size="13" text-anchor="middle">+${run.results.length - 6} more agent(s)</text>`
    : "";

  const bestAgent = verdict.bestAgent
    ? truncate(`${resultLabel(verdict.bestAgent)}`, 24)
    : "n/a";
  const fastestTime = verdict.fastest
    ? `${(verdict.fastest.durationMs / 1000).toFixed(1)}s`
    : "n/a";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="AgentArena share card">
  <defs>
    <linearGradient id="card-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0f" />
      <stop offset="50%" stop-color="#0f0f1a" />
      <stop offset="100%" stop-color="#12121f" />
    </linearGradient>
    <linearGradient id="accent-glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#818cf8" />
    </linearGradient>
    <linearGradient id="icon-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#4f46e5" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#card-bg)" />
  <rect width="1200" height="3" fill="url(#accent-glow)" />

  <!-- Brand icon (simplified from icon.svg) -->
  <g transform="translate(60, 36) scale(0.09)">
    <rect width="512" height="512" rx="128" fill="url(#icon-grad)" />
    <path d="M128 352V160l128-64 128 64v192l-128 64-128-64z" stroke="#fff" stroke-width="24" fill="none" opacity="0.9"/>
    <path d="M128 160l128 64 128-64M256 224v192" stroke="#fff" stroke-width="24" opacity="0.6"/>
    <circle cx="256" cy="192" r="32" fill="#fff" opacity="0.9"/>
    <circle cx="160" cy="304" r="24" fill="#10b981" opacity="0.8"/>
    <circle cx="352" cy="304" r="24" fill="#818cf8" opacity="0.8"/>
  </g>

  <!-- Brand text -->
  <text x="114" y="72" fill="#6366f1" font-family="${font}" font-size="18" font-weight="700" letter-spacing="3">AGENTARENA</text>

  <!-- Task title -->
  <text x="68" y="130" fill="#f1f5f9" font-family="${font}" font-size="36" font-weight="700">${esc(truncate(run.task.title, 50))}</text>
  ${scoreModeLabel ? `<text x="68" y="152" fill="#94a3b8" font-family="${font}" font-size="16">Score mode: ${esc(scoreModeLabel)}</text>` : ""}

  <!-- Stats row -->
  <rect x="68" y="160" width="180" height="80" rx="12" fill="#1a1a2e" stroke="#2d2d44" />
  <text x="158" y="192" fill="#94a3b8" font-family="${font}" font-size="13" text-anchor="middle">Success Rate</text>
  <text x="158" y="226" fill="${successRate === 100 ? '#10b981' : successRate > 0 ? '#f59e0b' : '#ef4444'}" font-family="${font}" font-size="28" font-weight="700" text-anchor="middle">${successRate}%</text>

  <rect x="264" y="160" width="180" height="80" rx="12" fill="#1a1a2e" stroke="#2d2d44" />
  <text x="354" y="192" fill="#94a3b8" font-family="${font}" font-size="13" text-anchor="middle">Agents</text>
  <text x="354" y="226" fill="#e2e8f0" font-family="${font}" font-size="28" font-weight="700" text-anchor="middle">${esc(`${summary.successCount}/${summary.totalAgents}`)}</text>

  <rect x="460" y="160" width="180" height="80" rx="12" fill="#1a1a2e" stroke="#2d2d44" />
  <text x="550" y="192" fill="#94a3b8" font-family="${font}" font-size="13" text-anchor="middle">Best Agent</text>
  <text x="550" y="224" fill="#e2e8f0" font-family="${font}" font-size="17" font-weight="600" text-anchor="middle">${esc(bestAgent)}</text>

  <rect x="656" y="160" width="180" height="80" rx="12" fill="#1a1a2e" stroke="#2d2d44" />
  <text x="746" y="192" fill="#94a3b8" font-family="${font}" font-size="13" text-anchor="middle">Fastest</text>
  <text x="746" y="226" fill="#e2e8f0" font-family="${font}" font-size="28" font-weight="700" text-anchor="middle">${esc(fastestTime)}</text>

  <rect x="852" y="160" width="180" height="80" rx="12" fill="#1a1a2e" stroke="#2d2d44" />
  <text x="942" y="192" fill="#94a3b8" font-family="${font}" font-size="13" text-anchor="middle">Cost</text>
  <text x="942" y="226" fill="#e2e8f0" font-family="${font}" font-size="28" font-weight="700" text-anchor="middle">$${esc(summary.knownCost.toFixed(2))}</text>

  <!-- Divider -->
  <rect x="68" y="260" width="1064" height="1" fill="#2d2d44" />

  <!-- Agent header -->
  <text x="92" y="294" fill="#94a3b8" font-family="${font}" font-size="13" font-weight="600" letter-spacing="1">AGENT</text>
  <text x="560" y="294" fill="#94a3b8" font-family="${font}" font-size="13" font-weight="600" letter-spacing="1" text-anchor="middle">JUDGE PASS RATE</text>
  <text x="872" y="294" fill="#94a3b8" font-family="${font}" font-size="13" font-weight="600" letter-spacing="1" text-anchor="middle">STATUS</text>

  <!-- Agent result bars -->
  ${agentBars}
  ${moreAgents}

  <!-- Footer -->
  <rect x="0" y="590" width="1200" height="40" fill="#08080d" />
  <text x="68" y="616" fill="#475569" font-family="${font}" font-size="13">Run ${esc(truncate(run.runId, 30))} · ${esc(run.createdAt)}</text>
  <text x="1132" y="616" fill="#6366f1" font-family="${font}" font-size="13" text-anchor="end" font-weight="600">agentarena.dev</text>
</svg>`;
}

export function buildPrTable(run, options = {}) {
  const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const scoreModeLabel = options.scoreModeLabel ?? null;
  const header = [
    ...(scoreModeLabel ? [`Score mode: ${scoreModeLabel}`] : []),
    "| Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Version | Verification | Status | Score | Duration | Tokens | Cost | Judges | Tests | Lint | Diff Precision | Files |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- | ---: |"
  ];
  const rows = run.results.map((result) => {
    const runtime = runtimeIdentity(result);
    const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
    return `| ${resultLabel(result)} | ${baseAgentLabel(result)} | ${runtime.provider} | ${runtime.providerKind} | ${runtime.model} | ${runtime.reasoning} | ${runtime.version} | ${runtime.verification}/${runtime.source} | ${result.status} | ${formatCompositeScore(result, run, scoreWeights)} | ${result.durationMs}ms | ${result.tokenUsage} | ${
      result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
    } | ${passedJudges}/${result.judgeResults.length} | ${formatTestMetric(result)} | ${formatLintMetric(result)} | ${formatDiffPrecisionMetric(result)} | ${result.changedFiles.length} |`;
  });

  return [...header, ...rows].join("\n");
}

export function findPreviousComparableRun(runs, currentRun) {
  const sameTaskRuns = getComparableRuns(runs, currentRun).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const currentIndex = sameTaskRuns.findIndex((run) => run.runId === currentRun.runId);

  if (currentIndex === -1 || currentIndex === sameTaskRuns.length - 1) {
    return null;
  }

  return sameTaskRuns[currentIndex + 1];
}

function passedJudgeCount(result) {
  return result?.judgeResults?.filter((judge) => judge.success).length ?? 0;
}

export function getRunToRunAgentDiff(runs, currentRun) {
  const previousRun = findPreviousComparableRun(runs, currentRun);
  if (!previousRun) {
    return {
      previousRun: null,
      rows: []
    };
  }

  const currentByAgent = new Map(currentRun.results.map((result) => [resultKey(result), result]));
  const previousByAgent = new Map(previousRun.results.map((result) => [resultKey(result), result]));
  const agentIds = Array.from(new Set([...currentByAgent.keys(), ...previousByAgent.keys()])).sort();

  return {
    previousRun,
    rows: agentIds.map((agentId) => {
      const currentResult = currentByAgent.get(agentId) ?? null;
      const previousResult = previousByAgent.get(agentId) ?? null;
      const currentRuntime = currentResult ? runtimeIdentity(currentResult) : null;
      const previousRuntime = previousResult ? runtimeIdentity(previousResult) : null;
      return {
        agentId,
        currentResult,
        previousResult,
        currentRuntime,
        previousRuntime,
        statusChange: `${previousResult?.status ?? "missing"} -> ${currentResult?.status ?? "missing"}`,
        durationDeltaMs:
          currentResult && previousResult ? currentResult.durationMs - previousResult.durationMs : null,
        tokenDelta:
          currentResult && previousResult ? currentResult.tokenUsage - previousResult.tokenUsage : null,
        costDelta:
          currentResult?.costKnown && previousResult?.costKnown
            ? currentResult.estimatedCostUsd - previousResult.estimatedCostUsd
            : null,
        judgeDelta:
          currentResult && previousResult ? passedJudgeCount(currentResult) - passedJudgeCount(previousResult) : null,
        versionChange:
          currentRuntime || previousRuntime
            ? `${previousRuntime?.version ?? "unknown"} -> ${currentRuntime?.version ?? "unknown"}`
            : null
      };
    })
  };
}

export function getAgentTrendRows(runs, currentRun, agentId) {
  if (!currentRun || !agentId) {
    return [];
  }

  const sameTaskRuns = getComparableRuns(runs, currentRun).sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const rows = [];
  let previousResult = null;
  for (const run of sameTaskRuns) {
    const result = run.results.find((entry) => resultKey(entry) === agentId) ?? null;
    if (!result) {
      continue;
    }

    rows.push({
      run,
      result,
      runtime: runtimeIdentity(result),
      previousResult,
      previousRuntime: previousResult ? runtimeIdentity(previousResult) : null,
      statusChange: `${previousResult?.status ?? "start"} -> ${result.status}`,
      durationDeltaMs: previousResult ? result.durationMs - previousResult.durationMs : null,
      tokenDelta: previousResult ? result.tokenUsage - previousResult.tokenUsage : null,
      costDelta:
        previousResult?.costKnown && result.costKnown
          ? result.estimatedCostUsd - previousResult.estimatedCostUsd
          : null,
      judgeDelta: previousResult
        ? passedJudgeCount(result) - passedJudgeCount(previousResult)
        : null,
      versionChange: `${previousResult ? runtimeIdentity(previousResult).version : "start"} -> ${runtimeIdentity(result).version}`
    });
    previousResult = result;
  }

  return rows;
}

/**
 * 跨运行对比：聚合多个 run 的结果，按 agent 聚合
 * 用于对比同一 agent 在不同配置/模型下的表现
 */
export function getCrossRunCompareRows(selectedRuns) {
  if (!selectedRuns || selectedRuns.length === 0) {
    return { runs: [], comparableRuns: [], excludedRuns: [], agents: [], rows: [] };
  }

  const baselineRun = selectedRuns[0] ?? null;
  const comparableRuns = baselineRun ? selectedRuns.filter((run) => getFairComparisonExclusionReasons(run, baselineRun).length === 0) : [];
  const excludedRuns = baselineRun ? selectedRuns.filter((run) => getFairComparisonExclusionReasons(run, baselineRun).length > 0).map((run) => ({ run, reasons: getFairComparisonExclusionReasons(run, baselineRun) })) : [];
  const agentMap = new Map();

  for (const run of comparableRuns) {
    for (const result of run.results) {
      const key = resultKey(result);
      if (!agentMap.has(key)) {
        agentMap.set(key, []);
      }
      agentMap.get(key).push({
        run,
        result,
        runtime: runtimeIdentity(result)
      });
    }
  }

  const rows = [];
  for (const [recordKey, entries] of agentMap) {
    if (entries.length === 0) continue;

    const firstEntry = entries[0];
    const stats = {
      totalRuns: entries.length,
      successCount: entries.filter((entry) => entry.result.status === "success").length,
      totalDurationMs: entries.reduce((sum, entry) => sum + entry.result.durationMs, 0),
      totalTokens: entries.reduce((sum, entry) => sum + entry.result.tokenUsage, 0),
      totalCost: entries.filter((entry) => entry.result.costKnown).reduce((sum, entry) => sum + entry.result.estimatedCostUsd, 0),
      costKnownCount: entries.filter((entry) => entry.result.costKnown).length,
      totalJudgePasses: entries.reduce((sum, entry) => sum + passedJudgeCount(entry.result), 0),
      totalJudges: entries.reduce((sum, entry) => sum + entry.result.judgeResults.length, 0)
    };

    const byModel = new Map();
    const byProvider = new Map();

    for (const entry of entries) {
      const modelKey = entry.runtime.model || "unknown";
      const providerKey = entry.runtime.provider || "unknown";

      if (!byModel.has(modelKey)) byModel.set(modelKey, []);
      byModel.get(modelKey).push(entry);

      if (!byProvider.has(providerKey)) byProvider.set(providerKey, []);
      byProvider.get(providerKey).push(entry);
    }

    rows.push({
      agentId: firstEntry.result.variantId ?? firstEntry.result.agentId,
      recordKey,
      displayLabel: resultLabel(firstEntry.result),
      baseAgent: baseAgentLabel(firstEntry.result),
      version: firstEntry.runtime.version,
      versionSource: firstEntry.runtime.versionSource,
      stats,
      entries,
      byModel: Object.fromEntries(byModel),
      byProvider: Object.fromEntries(byProvider),
      bestRuntime: entries.reduce((best, entry) => {
        if (entry.result.status !== "success") return best;
        if (!best || entry.result.durationMs < best.durationMs) {
          return { run: entry.run, result: entry.result, runtime: entry.runtime, durationMs: entry.result.durationMs };
        }
        return best;
      }, null)
    });
  }

  rows.sort((left, right) => {
    const successDelta = right.stats.successCount - left.stats.successCount;
    if (successDelta !== 0) return successDelta;
    return left.stats.totalDurationMs - right.stats.totalDurationMs;
  });

  return {
    runs: selectedRuns,
    comparableRuns,
    excludedRuns,
    agents: Array.from(agentMap.keys()),
    rows
  };
}

/**
 * 获取跨运行对比的最佳配置推荐
 */
export function getCrossRunRecommendation(crossRunData, options = {}) {
  if (!crossRunData || crossRunData.rows.length === 0) {
    return null;
  }

  const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const candidates = crossRunData.rows
    .filter((row) => row.stats.successCount > 0)
    .map((row) => {
      const aggregateRun = {
        results: row.entries.map((entry) => entry.result)
      };
      const averageScore = row.entries.reduce(
        (sum, entry) => sum + getCompositeScoreDetails(entry.result, aggregateRun, scoreWeights).total,
        0
      ) / Math.max(row.entries.length, 1);

      return {
        agentId: row.agentId,
        recordKey: row.recordKey,
        displayLabel: row.displayLabel,
        version: row.version,
        successRate: row.stats.successCount / row.stats.totalRuns,
        avgDurationMs: row.stats.totalDurationMs / row.stats.totalRuns,
        avgTokens: row.stats.totalTokens / row.stats.totalRuns,
        avgCost: row.stats.costKnownCount > 0
          ? row.stats.totalCost / row.stats.costKnownCount
          : null,
        bestRuntime: row.bestRuntime,
        score: averageScore
      };
    });

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.successRate !== left.successRate) {
      return right.successRate - left.successRate;
    }
    return left.avgDurationMs - right.avgDurationMs;
  });
  return candidates[0];
}

/**
 * ============= Leaderboard 相关函数 =============
 * 历史排行榜：按任务、评分模式、agent 身份桶聚合
 */

/**
 * 生成 leaderboard 身份键
 */
export function getLeaderboardIdentity(run, result) {
  const runtime = runtimeIdentity(result);
  const taskId = run.task?.id || run.task?.title || "unknown-task";
  const scoreMode = run.scoreMode || "balanced";

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
 * 序列化身份键
 */
export function serializeLeaderboardIdentity(identity) {
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
 * 计算中位数
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 筛选可比较的 runs
 */
export function getComparableRuns(runs, currentRun) {
  const currentTaskId = currentRun.task?.id || currentRun.task?.title;
  const currentScoreMode = currentRun.scoreMode || "balanced";

  return runs.filter((run) => {
    const taskId = run.task?.id || run.task?.title;
    const scoreMode = run.scoreMode || "balanced";
    return taskId === currentTaskId && scoreMode === currentScoreMode;
  });
}

/**
 * 构建 leaderboard 数据
 */
export function buildLeaderboard(runs, currentRun) {
  const comparableRuns = getComparableRuns(runs, currentRun);
  const excludedRuns = runs.filter((run) => !comparableRuns.includes(run));

  // 按身份键聚合结果
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

  // 为每个 run 确定 winner，用于计算 win rate
  const winMap = new Map();
  const comparisonMap = new Map();

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

    // 样本充足性：至少 3 次 run 才算稳定
    const sampleSizeSufficient = agentRuns.length >= 3;

    rows.push({
      identity,
      displayLabel: firstResult.displayLabel || firstResult.agentId,
      stats: {
        runCount: agentRuns.length,
        averageScore: Math.round(averageScore * 10) / 10,
        winRate,  // 保持 0-1 之间的值
        successRate,  // 保持 0-1 之间的值
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

  // 排序：平均分 > 胜率 > 成功率 > 中位数耗时
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

/**
 * 获取排行榜说明
 */
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

/**
 * 获取 Agent 置信度徽章 HTML
 * @param {object} result - Agent 运行结果
 * @param {Array} varianceStats - 方差统计数组
 * @param {string} locale - 语言环境
 * @returns {string} HTML 片段
 */
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
