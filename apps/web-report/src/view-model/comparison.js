import {
  DEFAULT_SCORE_WEIGHTS,
  normalizeScoreWeights
} from "./scoring.js";

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

export function fairComparisonIdentity(run) {
  return {
    taskIdentity: run.fairComparison?.taskIdentity ?? taskIdentity(run),
    judgeIdentity: run.fairComparison?.judgeIdentity ?? null,
    repoBaselineIdentity: run.fairComparison?.repoBaselineIdentity ?? null
  };
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
  const candidateHasFairMetadata = Boolean(candidateRun?.fairComparison);
  const anchorHasFairMetadata = Boolean(anchorRun?.fairComparison);

  if (!candidate.taskIdentity || candidate.taskIdentity !== anchor.taskIdentity) {
    reasons.push("different-task-pack");
  }
  if (candidateHasFairMetadata && anchorHasFairMetadata) {
    if (!candidate.judgeIdentity || candidate.judgeIdentity !== anchor.judgeIdentity) {
      reasons.push("different-judge-logic");
    }
    if (!candidate.repoBaselineIdentity || candidate.repoBaselineIdentity !== anchor.repoBaselineIdentity) {
      reasons.push("different-repo-baseline");
    }
  }
  if (missingCoreComparisonData(candidateRun)) {
    reasons.push("missing-core-data");
  }

  return reasons;
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
  const resolutionRateScore = result.resolutionRate ?? 0;
  const tokenEfficiencyScore = result.tokenEfficiencyScore ?? 0;
  const acceptanceRateScore = result.acceptanceRate ?? 0;
  const categoryScoreScore = result.categoryScore ?? 0;

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
  if (details.components.resolutionRate > 0.95 * normalizedWeights.resolutionRate && normalizedWeights.resolutionRate > 0) {
    reasons.push("resolution-rate-high");
  }
  if (details.components.tokenEfficiency > 0.95 * normalizedWeights.tokenEfficiency && normalizedWeights.tokenEfficiency > 0) {
    reasons.push("token-efficiency-good");
  }
  if (details.components.acceptanceRate > 0.95 * normalizedWeights.acceptanceRate && normalizedWeights.acceptanceRate > 0) {
    reasons.push("acceptance-rate-high");
  }

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

function passedJudgeCount(result) {
  return result?.judgeResults?.filter((judge) => judge.success).length ?? 0;
}

export function findPreviousComparableRun(runs, currentRun) {
  const sameTaskRuns = getComparableRuns(runs, currentRun).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const currentIndex = sameTaskRuns.findIndex((run) => run.runId === currentRun.runId);

  if (currentIndex === -1 || currentIndex === sameTaskRuns.length - 1) {
    return null;
  }

  return sameTaskRuns[currentIndex + 1];
}

export function getRunToRunAgentDiff(runs, currentRun) {
  const previousRun = findPreviousComparableRun(runs, currentRun);
  if (!previousRun) {
    return {
      previousRun: null,
      rows: []
    };
  }

  const currentByAgent = new Map(currentRun.results.map((result) => [resultRecordKey(result), result]));
  const previousByAgent = new Map(previousRun.results.map((result) => [resultRecordKey(result), result]));
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
    const result = run.results.find((entry) => resultRecordKey(entry) === agentId) ?? null;
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

export function getComparableRuns(runs, currentRun) {
  const currentTaskId = currentRun.task?.id || currentRun.task?.title;
  const currentScoreMode = currentRun.scoreMode || "balanced";

  return runs.filter((run) => {
    const taskId = run.task?.id || run.task?.title;
    const scoreMode = run.scoreMode || "balanced";
    return taskId === currentTaskId && scoreMode === currentScoreMode;
  });
}

export function getCrossRunCompareRows(selectedRuns, options = {}) {
  if (!selectedRuns || selectedRuns.length === 0) {
    return { runs: [], comparableRuns: [], excludedRuns: [], agents: [], rows: [] };
  }

  const baselineRun = selectedRuns[0] ?? null;
  const comparableRuns = baselineRun ? selectedRuns.filter((run) => getFairComparisonExclusionReasons(run, baselineRun).length === 0) : [];
  const excludedRuns = baselineRun ? selectedRuns.filter((run) => getFairComparisonExclusionReasons(run, baselineRun).length > 0).map((run) => ({ run, reasons: getFairComparisonExclusionReasons(run, baselineRun) })) : [];
  const agentMap = new Map();

  for (const run of comparableRuns) {
    for (const result of run.results) {
      const key = resultRecordKey(result);
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
        const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
        const aggregateRun = { results: entries.map((e) => e.result) };
        const entryScore = getCompositeScoreDetails(entry.result, aggregateRun, scoreWeights).total;
        if (!best) {
          return { run: entry.run, result: entry.result, runtime: entry.runtime, durationMs: entry.result.durationMs, score: entryScore };
        }
        if (entryScore > best.score) {
          return { run: entry.run, result: entry.result, runtime: entry.runtime, durationMs: entry.result.durationMs, score: entryScore };
        }
        if (entryScore === best.score && entry.result.durationMs < best.durationMs) {
          return { run: entry.run, result: entry.result, runtime: entry.runtime, durationMs: entry.result.durationMs, score: entryScore };
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

export function getRunTrustSummary(run) {
  const totalAgents = run?.results?.length ?? 0;
  const failedAgents = run?.results?.filter((result) => result.status !== "success").length ?? 0;
  const missingCostCount = run?.results?.filter((result) => !result.costKnown).length ?? 0;
  const missingCoreDataCount = run?.results?.filter((result) => {
    const hasStatus = typeof result.status === "string" && result.status.length > 0;
    const hasJudgeResults = Array.isArray(result.judgeResults);
    const hasScoreInputs = typeof result.durationMs === "number" && typeof result.tokenUsage === "number";
    return !hasStatus || !hasJudgeResults || !hasScoreInputs;
  }).length ?? 0;
  const level = failedAgents > 0 || missingCostCount > 0 || missingCoreDataCount > 0 ? "caution" : "strong";

  return {
    totalAgents,
    failedAgents,
    missingCostCount,
    missingCoreDataCount,
    level
  };
}

export function getSelectionTrustSummary(selection, options = {}) {
  const minimumComparableRuns = options.minimumComparableRuns ?? 3;
  const comparableRuns = selection?.comparableRuns?.length ?? 0;
  const excludedRuns = selection?.excludedRuns?.length ?? 0;
  const runs = selection?.runs ?? [];
  const comparableRunSet = new Set((selection?.comparableRuns ?? []).map((run) => run.runId));
  const hasLegacyFallback = runs.some((run) => comparableRunSet.has(run.runId) && !run.fairComparison);
  const lowSampleSize = comparableRuns < minimumComparableRuns;
  const hasExclusions = excludedRuns > 0;
  const level = lowSampleSize || hasLegacyFallback || hasExclusions ? "caution" : "strong";

  return {
    comparableRuns,
    excludedRuns,
    hasLegacyFallback,
    lowSampleSize,
    hasExclusions,
    level
  };
}

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
