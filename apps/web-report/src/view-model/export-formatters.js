import {
  baseAgentLabel,
  formatCompositeScore,
  formatDiffPrecisionMetric,
  formatLintMetric,
  formatTestMetric,
  getRunVerdict, 
  resultLabel,
  runtimeIdentity,
  summarizeRun
} from "./comparison.js";
import { DEFAULT_SCORE_WEIGHTS } from "./scoring.js";

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

  <rect width="1200" height="630" fill="url(#card-bg)" />
  <rect width="1200" height="3" fill="url(#accent-glow)" />

  <g transform="translate(60, 36) scale(0.09)">
    <rect width="512" height="512" rx="128" fill="url(#icon-grad)" />
    <path d="M128 352V160l128-64 128 64v192l-128 64-128-64z" stroke="#fff" stroke-width="24" fill="none" opacity="0.9"/>
    <path d="M128 160l128 64 128-64M256 224v192" stroke="#fff" stroke-width="24" opacity="0.6"/>
    <circle cx="256" cy="192" r="32" fill="#fff" opacity="0.9"/>
    <circle cx="160" cy="304" r="24" fill="#10b981" opacity="0.8"/>
    <circle cx="352" cy="304" r="24" fill="#818cf8" opacity="0.8"/>
  </g>

  <text x="114" y="72" fill="#6366f1" font-family="${font}" font-size="18" font-weight="700" letter-spacing="3">AGENTARENA</text>

  <text x="68" y="130" fill="#f1f5f9" font-family="${font}" font-size="36" font-weight="700">${esc(truncate(run.task.title, 50))}</text>
  ${scoreModeLabel ? `<text x="68" y="152" fill="#94a3b8" font-family="${font}" font-size="16">Score mode: ${esc(scoreModeLabel)}</text>` : ""}

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

  <rect x="68" y="260" width="1064" height="1" fill="#2d2d44" />

  <text x="92" y="294" fill="#94a3b8" font-family="${font}" font-size="13" font-weight="600" letter-spacing="1">AGENT</text>
  <text x="560" y="294" fill="#94a3b8" font-family="${font}" font-size="13" font-weight="600" letter-spacing="1" text-anchor="middle">JUDGE PASS RATE</text>
  <text x="872" y="294" fill="#94a3b8" font-family="${font}" font-size="13" font-weight="600" letter-spacing="1" text-anchor="middle">STATUS</text>

  ${agentBars}
  ${moreAgents}

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
