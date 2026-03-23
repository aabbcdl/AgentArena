export const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  status: 0.3,
  tests: 0.25,
  judges: 0.15,
  lint: 0.1,
  precision: 0.1,
  duration: 0.06,
  cost: 0.04
});

export const SCORE_WEIGHT_PRESETS = Object.freeze({
  balanced: DEFAULT_SCORE_WEIGHTS,
  "correctness-first": Object.freeze({ status: 0.3, tests: 0.32, judges: 0.18, lint: 0.12, precision: 0.06, duration: 0.01, cost: 0.01 }),
  "speed-first": Object.freeze({ status: 0.12, tests: 0.08, judges: 0.08, lint: 0.02, precision: 0.02, duration: 0.48, cost: 0.2 }),
  "cost-first": Object.freeze({ status: 0.12, tests: 0.1, judges: 0.08, lint: 0.05, precision: 0.05, duration: 0.1, cost: 0.5 }),
  "scope-discipline": Object.freeze({ status: 0.14, tests: 0.1, judges: 0.08, lint: 0.06, precision: 0.56, duration: 0.03, cost: 0.03 })
});

export function getScoreWeightPreset(presetId = "balanced") {
  return SCORE_WEIGHT_PRESETS[presetId] ?? SCORE_WEIGHT_PRESETS.balanced;
}

export function getMatchingScorePresetId(weights = DEFAULT_SCORE_WEIGHTS) {
  const normalized = normalizeScoreWeights(weights);
  return (
    Object.entries(SCORE_WEIGHT_PRESETS).find(([, preset]) => {
      const normalizedPreset = normalizeScoreWeights(preset);
      return Object.keys(normalizedPreset).every((key) => Math.abs(normalizedPreset[key] - normalized[key]) < 0.001);
    })?.[0] ?? null
  );
}

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
    source: result.resolvedRuntime?.source ?? "unknown",
    verification: result.resolvedRuntime?.verification ?? "unknown"
  };
}

function resultKey(result) {
  return result.variantId ?? result.agentId;
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
  return fastest / Math.max(result.durationMs, fastest);
}

function costEfficiencyScore(result, run) {
  const costs = run.results.filter((entry) => entry.costKnown && entry.estimatedCostUsd > 0).map((entry) => entry.estimatedCostUsd);
  if (!result.costKnown || result.estimatedCostUsd <= 0 || costs.length === 0) {
    return 0;
  }

  const cheapest = Math.min(...costs);
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
  const judgesScore = Math.max(judgePassRatio(result), 0);
  const lintScore = Math.max(lintQualityScore(result), 0);
  const precisionScore = Math.max(diffPrecisionScore(result), 0);
  const durationScore = durationEfficiencyScore(result, run);
  const costScore = costEfficiencyScore(result, run);

  const weightedScore =
    statusScore * normalizedWeights.status +
    testsScore * normalizedWeights.tests +
    judgesScore * normalizedWeights.judges +
    lintScore * normalizedWeights.lint +
    precisionScore * normalizedWeights.precision +
    durationScore * normalizedWeights.duration +
    costScore * normalizedWeights.cost;

  return {
    total: Math.round(weightedScore * 1000) / 10,
    weights: normalizedWeights,
    components: {
      status: statusScore,
      tests: testsScore,
      judges: judgesScore,
      lint: lintScore,
      precision: precisionScore,
      duration: durationScore,
      cost: costScore
    }
  };
}

export function formatCompositeScore(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  return `${getCompositeScoreDetails(result, run, weights).total.toFixed(1)}`;
}

export function getCompositeScoreReasons(result, run, weights = DEFAULT_SCORE_WEIGHTS) {
  const details = getCompositeScoreDetails(result, run, weights);
  const reasons = [];

  if (details.components.tests >= 0.999) {
    reasons.push("tests");
  }
  if (details.components.lint >= 0.999) {
    reasons.push("lint");
  }
  if (details.components.precision >= 0.999) {
    reasons.push("precision");
  }
  if (details.components.judges >= 0.999) {
    reasons.push("judges");
  }
  if (details.components.duration >= 0.999) {
    reasons.push("duration");
  }
  if (details.components.cost >= 0.999) {
    reasons.push("cost");
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
    `RepoArena | ${run.task.title}`,
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
      `Best variant: ${resultLabel(verdict.bestAgent)} (${baseAgentLabel(verdict.bestAgent)} | ${runtime.provider} | ${runtime.model} | ${runtime.reasoning} | score ${formatCompositeScore(verdict.bestAgent, run)})`
      .replace(`score ${formatCompositeScore(verdict.bestAgent, run)}`, `score ${formatCompositeScore(verdict.bestAgent, run, scoreWeights)}`)
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="RepoArena share card">
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
  <text x="114" y="72" fill="#6366f1" font-family="${font}" font-size="18" font-weight="700" letter-spacing="3">REPOARENA</text>

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
  <text x="1132" y="616" fill="#6366f1" font-family="${font}" font-size="13" text-anchor="end" font-weight="600">repoarena.dev</text>
</svg>`;
}

export function buildPrTable(run, options = {}) {
  const scoreWeights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const scoreModeLabel = options.scoreModeLabel ?? null;
  const header = [
    ...(scoreModeLabel ? [`Score mode: ${scoreModeLabel}`] : []),
    "| Variant | Base Agent | Provider | Provider Kind | Model | Reasoning | Verification | Status | Score | Duration | Tokens | Cost | Judges | Tests | Lint | Diff Precision | Files |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- | ---: |"
  ];
  const rows = run.results.map((result) => {
    const runtime = runtimeIdentity(result);
    const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
    return `| ${resultLabel(result)} | ${baseAgentLabel(result)} | ${runtime.provider} | ${runtime.providerKind} | ${runtime.model} | ${runtime.reasoning} | ${runtime.verification}/${runtime.source} | ${result.status} | ${formatCompositeScore(result, run, scoreWeights)} | ${result.durationMs}ms | ${result.tokenUsage} | ${
      result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
    } | ${passedJudges}/${result.judgeResults.length} | ${formatTestMetric(result)} | ${formatLintMetric(result)} | ${formatDiffPrecisionMetric(result)} | ${result.changedFiles.length} |`;
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

  const currentByAgent = new Map(currentRun.results.map((result) => [resultKey(result), result]));
  const previousByAgent = new Map(previousRun.results.map((result) => [resultKey(result), result]));
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
    const result = run.results.find((entry) => resultKey(entry) === agentId) ?? null;
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

/**
 * 跨运行对比：聚合多个 run 的结果，按 agent 聚合
 * 用于对比同一 agent 在不同配置/模型下的表现
 */
export function getCrossRunCompareRows(selectedRuns) {
  if (!selectedRuns || selectedRuns.length === 0) {
    return { runs: [], agents: [], rows: [] };
  }

  // 收集所有 run 的所有 agent variant
  const agentMap = new Map(); // key: variantId, value: array of {run, result}
  
  for (const run of selectedRuns) {
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

  // 为每个 agent 生成跨运行对比数据
  const rows = [];
  for (const [agentId, entries] of agentMap) {
    if (entries.length === 0) continue;

    const firstEntry = entries[0];
    const stats = {
      totalRuns: entries.length,
      successCount: entries.filter(e => e.result.status === "success").length,
      totalDurationMs: entries.reduce((sum, e) => sum + e.result.durationMs, 0),
      totalTokens: entries.reduce((sum, e) => sum + e.result.tokenUsage, 0),
      totalCost: entries.filter(e => e.result.costKnown).reduce((sum, e) => sum + e.result.estimatedCostUsd, 0),
      costKnownCount: entries.filter(e => e.result.costKnown).length,
      totalJudgePasses: entries.reduce((sum, e) => sum + passedJudgeCount(e.result), 0),
      totalJudges: entries.reduce((sum, e) => sum + e.result.judgeResults.length, 0)
    };

    // 按不同维度聚合的运行详情
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
      agentId,
      displayLabel: resultLabel(firstEntry.result),
      baseAgent: baseAgentLabel(firstEntry.result),
      stats,
      entries,
      byModel: Object.fromEntries(byModel),
      byProvider: Object.fromEntries(byProvider),
      bestRuntime: entries.reduce((best, e) => {
        if (e.result.status !== "success") return best;
        if (!best || e.result.durationMs < best.durationMs) {
          return { run: e.run, result: e.result, runtime: e.runtime };
        }
        return best;
      }, null)
    });
  }

  // 按成功率降序，然后按耗时升序排序
  rows.sort((a, b) => {
    const successDelta = b.stats.successCount - a.stats.successCount;
    if (successDelta !== 0) return successDelta;
    return a.stats.totalDurationMs - b.stats.totalDurationMs;
  });

  return {
    runs: selectedRuns,
    agents: Array.from(agentMap.keys()),
    rows
  };
}

/**
 * 获取跨运行对比的最佳配置推荐
 */
export function getCrossRunRecommendation(crossRunData) {
  if (!crossRunData || crossRunData.rows.length === 0) {
    return null;
  }

  // 找出成功率最高且平均耗时最低的配置
  const candidates = crossRunData.rows
    .filter(row => row.stats.successCount > 0)
    .map(row => ({
      agentId: row.agentId,
      displayLabel: row.displayLabel,
      successRate: row.stats.successCount / row.stats.totalRuns,
      avgDurationMs: row.stats.totalDurationMs / row.stats.totalRuns,
      avgTokens: row.stats.totalTokens / row.stats.totalRuns,
      avgCost: row.stats.costKnownCount > 0 
        ? row.stats.totalCost / row.stats.costKnownCount 
        : null,
      bestRuntime: row.bestRuntime
    }));

  if (candidates.length === 0) return null;

  // 综合评分：成功率权重 60%，耗时权重 30%，成本权重 10%
  const maxSuccessRate = Math.max(...candidates.map(c => c.successRate));
  const minDuration = Math.min(...candidates.filter(c => c.avgDurationMs > 0).map(c => c.avgDurationMs));
  const minCost = Math.min(...candidates.filter(c => c.avgCost !== null).map(c => c.avgCost));

  for (const c of candidates) {
    const successScore = c.successRate / maxSuccessRate;
    const durationScore = minDuration > 0 ? minDuration / c.avgDurationMs : 0;
    const costScore = c.avgCost !== null && minCost > 0 ? minCost / c.avgCost : 0;
    c.score = successScore * 0.6 + durationScore * 0.3 + costScore * 0.1;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}
