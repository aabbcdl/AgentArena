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

function runtimeIdentity(result) {
  return {
    model: result.resolvedRuntime?.effectiveModel ?? result.requestedConfig?.model ?? "unknown",
    reasoning:
      result.resolvedRuntime?.effectiveReasoningEffort ??
      result.requestedConfig?.reasoningEffort ??
      "default",
    source: result.resolvedRuntime?.source ?? "unknown",
    verification: result.resolvedRuntime?.verification ?? "unknown"
  };
}

function resultLabel(result) {
  return result.displayLabel ?? result.agentTitle ?? result.variantId ?? result.agentId;
}

function baseAgentLabel(result) {
  return result.baseAgentId ?? result.agentId;
}

export function judgePassRatio(result) {
  if (result.judgeResults.length === 0) {
    return 0;
  }

  return result.judgeResults.filter((judge) => judge.success).length / result.judgeResults.length;
}

export function getRunVerdict(run) {
  const successfulResults = run.results.filter((result) => result.status === "success");
  const candidates = successfulResults.length > 0 ? successfulResults : run.results;
  const fastest = [...candidates].sort((left, right) => left.durationMs - right.durationMs)[0] ?? null;
  const lowestKnownCost =
    [...run.results.filter((result) => result.costKnown)].sort(
      (left, right) => left.estimatedCostUsd - right.estimatedCostUsd
    )[0] ?? null;
  const highestJudgePassRate =
    [...run.results].sort((left, right) => judgePassRatio(right) - judgePassRatio(left))[0] ?? null;
  const bestAgent =
    [...run.results].sort((left, right) => {
      const statusDelta = Number(right.status === "success") - Number(left.status === "success");
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const judgeDelta = judgePassRatio(right) - judgePassRatio(left);
      if (judgeDelta !== 0) {
        return judgeDelta;
      }

      return left.durationMs - right.durationMs;
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

  const rows = runs
    .filter((run) => !taskTitle || run.task.title === taskTitle)
    .map((run) => ({
      run,
      summary: summarizeRun(run),
      hasMarkdown: markdownByRunId.has(run.runId)
    }));

  return rows.sort((left, right) => {
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
}

function compareStatusRank(status) {
  switch (status) {
    case "success":
      return 0;
    case "failed":
      return 1;
    default:
      return 2;
  }
}

export function getCompareResults(run, options = {}) {
  const status = options.status ?? "all";
  const sort = options.sort ?? "status";

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
      case "status":
      default: {
        const statusDelta = compareStatusRank(left.status) - compareStatusRank(right.status);
        if (statusDelta !== 0) {
          return statusDelta;
        }

        return left.durationMs - right.durationMs;
      }
    }
  });
}

export function buildShareCard(run) {
  const summary = summarizeRun(run);
  const verdict = getRunVerdict(run);
  const lines = [
    `RepoArena | ${run.task.title}`,
    `${summary.successCount}/${summary.totalAgents} agents passed`,
    `Failed: ${summary.failedCount}`,
    `Tokens: ${summary.totalTokens}`,
    `Known cost: $${summary.knownCost.toFixed(2)}`
  ];

  if (verdict.bestAgent) {
    const runtime = runtimeIdentity(verdict.bestAgent);
    lines.push(
      `Best variant: ${resultLabel(verdict.bestAgent)} (${baseAgentLabel(verdict.bestAgent)} | ${runtime.model} | ${runtime.reasoning})`
    );
  }

  if (verdict.fastest) {
    lines.push(`Fastest: ${resultLabel(verdict.fastest)} (${verdict.fastest.durationMs}ms)`);
  }

  return lines.join("\n");
}

export function buildShareCardSvg(run) {
  const summary = summarizeRun(run);
  const verdict = getRunVerdict(run);
  const bestAgent = verdict.bestAgent
    ? `${resultLabel(verdict.bestAgent)} (${runtimeIdentity(verdict.bestAgent).model})`
    : "n/a";
  const fastest = verdict.fastest
    ? `${resultLabel(verdict.fastest)} (${verdict.fastest.durationMs}ms)`
    : "n/a";
  const text = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="RepoArena share card">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f9f5ed" />
      <stop offset="100%" stop-color="#efe6d6" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#fffdf8" stroke="#d9cebb" />
  <text x="84" y="116" fill="#6b6259" font-family="Georgia, serif" font-size="22" letter-spacing="4">REPOARENA</text>
  <text x="84" y="174" fill="#211911" font-family="Georgia, serif" font-size="54" font-weight="700">${text(run.task.title)}</text>
  <text x="84" y="220" fill="#6b6259" font-family="Georgia, serif" font-size="24">${text(`${summary.successCount}/${summary.totalAgents} passing | Failed ${summary.failedCount} | Tokens ${summary.totalTokens}`)}</text>

  <rect x="84" y="266" width="320" height="124" rx="20" fill="#f7f1e5" stroke="#d9cebb" />
  <text x="108" y="306" fill="#6b6259" font-family="Georgia, serif" font-size="18">Best Agent</text>
  <text x="108" y="348" fill="#211911" font-family="Georgia, serif" font-size="30" font-weight="700">${text(bestAgent)}</text>

  <rect x="440" y="266" width="320" height="124" rx="20" fill="#f7f1e5" stroke="#d9cebb" />
  <text x="464" y="306" fill="#6b6259" font-family="Georgia, serif" font-size="18">Fastest</text>
  <text x="464" y="348" fill="#211911" font-family="Georgia, serif" font-size="30" font-weight="700">${text(fastest)}</text>

  <rect x="796" y="266" width="320" height="124" rx="20" fill="#f7f1e5" stroke="#d9cebb" />
  <text x="820" y="306" fill="#6b6259" font-family="Georgia, serif" font-size="18">Known Cost</text>
  <text x="820" y="348" fill="#211911" font-family="Georgia, serif" font-size="30" font-weight="700">${text(`$${summary.knownCost.toFixed(2)}`)}</text>

  <text x="84" y="456" fill="#9f4525" font-family="Georgia, serif" font-size="20">Generated from local RepoArena benchmark results</text>
  <text x="84" y="500" fill="#6b6259" font-family="Georgia, serif" font-size="22">${text(`Run ${run.runId}`)}</text>
  <text x="84" y="536" fill="#6b6259" font-family="Georgia, serif" font-size="22">${text(run.createdAt)}</text>
</svg>`;
}

export function buildPrTable(run) {
  const header = [
    "| Variant | Base Agent | Model | Reasoning | Verification | Status | Duration | Tokens | Cost | Judges | Files |",
    "| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | ---: |"
  ];
  const rows = run.results.map((result) => {
    const runtime = runtimeIdentity(result);
    const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
    return `| ${resultLabel(result)} | ${baseAgentLabel(result)} | ${runtime.model} | ${runtime.reasoning} | ${runtime.verification}/${runtime.source} | ${result.status} | ${result.durationMs}ms | ${result.tokenUsage} | ${
      result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
    } | ${passedJudges}/${result.judgeResults.length} | ${result.changedFiles.length} |`;
  });

  return [...header, ...rows].join("\n");
}

export function findPreviousComparableRun(runs, currentRun) {
  const sameTaskRuns = [...runs]
    .filter((run) => run.task.title === currentRun.task.title)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

  const currentByAgent = new Map(currentRun.results.map((result) => [result.agentId, result]));
  const previousByAgent = new Map(previousRun.results.map((result) => [result.agentId, result]));
  const agentIds = Array.from(new Set([...currentByAgent.keys(), ...previousByAgent.keys()])).sort();

  return {
    previousRun,
    rows: agentIds.map((agentId) => {
      const currentResult = currentByAgent.get(agentId) ?? null;
      const previousResult = previousByAgent.get(agentId) ?? null;
      return {
        agentId,
        currentResult,
        previousResult,
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
          currentResult && previousResult ? passedJudgeCount(currentResult) - passedJudgeCount(previousResult) : null
      };
    })
  };
}

export function getAgentTrendRows(runs, currentRun, agentId) {
  if (!currentRun || !agentId) {
    return [];
  }

  const sameTaskRuns = [...runs]
    .filter((run) => run.task.title === currentRun.task.title)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const rows = [];
  let previousResult = null;
  for (const run of sameTaskRuns) {
    const result = run.results.find((entry) => entry.agentId === agentId) ?? null;
    if (!result) {
      continue;
    }

    rows.push({
      run,
      result,
      previousResult,
      statusChange: `${previousResult?.status ?? "start"} -> ${result.status}`,
      durationDeltaMs: previousResult ? result.durationMs - previousResult.durationMs : null,
      tokenDelta: previousResult ? result.tokenUsage - previousResult.tokenUsage : null,
      costDelta:
        previousResult?.costKnown && result.costKnown
          ? result.estimatedCostUsd - previousResult.estimatedCostUsd
          : null,
      judgeDelta: previousResult
        ? passedJudgeCount(result) - passedJudgeCount(previousResult)
        : null
    });
    previousResult = result;
  }

  return rows;
}
