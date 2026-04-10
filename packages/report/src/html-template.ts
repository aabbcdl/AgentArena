import { type BenchmarkRun, formatDuration } from "@agentarena/core";
import type { LeaderboardData } from "./leaderboard.js";
import {
  escapeHtml,
  formatDiffPrecisionMetric,
  formatLintMetric,
  formatRuntimeIdentity,
  formatTestMetric,
  getReportCopy,
  getRunScoreMode,
  type Locale,
  type ScoredResult,
  type ScoredRun,
  statusTone
} from "./report-helpers.js";

function renderJudgeList(run: BenchmarkRun["results"][number]): string {
  const items =
    run.judgeResults.length === 0
      ? "<li>No judges executed.</li>"
      : run.judgeResults
          .map((judge) => {
            const meta = [
              `type=${judge.type}`,
              judge.target ? `target=${judge.target}` : "",
              judge.expectation ? `expect=${judge.expectation}` : "",
              judge.cwd ? `cwd=${judge.cwd}` : "",
              judge.command ? `command=${judge.command}` : ""
            ]
              .filter(Boolean)
              .join(" | ");

            return `<li><strong>${escapeHtml(judge.label)}</strong>: ${
              judge.success ? "pass" : "fail"
            } (${escapeHtml(formatDuration(judge.durationMs))})${
              meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""
            }${
              judge.stdout || judge.stderr
                ? `<details><summary>Debug output</summary>${
                    judge.stdout
                      ? `<p class="meta"><strong>stdout</strong></p><pre>${escapeHtml(judge.stdout)}</pre>`
                      : ""
                  }${
                    judge.stderr
                      ? `<p class="meta"><strong>stderr</strong></p><pre>${escapeHtml(judge.stderr)}</pre>`
                      : ""
                  }</details>`
                : ""
            }</li>`;
          })
          .join("");

  return `<h3>Judges</h3><ul>${items}</ul>`;
}

function renderCommandStepList(
  title: string,
  steps: Array<{
    label: string;
    success: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    cwd: string;
  }>
): string {
  const items =
    steps.length === 0
      ? "<li>No commands executed.</li>"
      : steps
          .map(
            (step) =>
              `<li><strong>${escapeHtml(step.label)}</strong>: ${
                step.success ? "pass" : "fail"
              } (${escapeHtml(formatDuration(step.durationMs))})${
                step.stdout || step.stderr
                  ? `<details><summary>Debug output</summary>${
                      step.stdout
                        ? `<p class="meta"><strong>stdout</strong></p><pre>${escapeHtml(step.stdout)}</pre>`
                        : ""
                    }${
                      step.stderr
                        ? `<p class="meta"><strong>stderr</strong></p><pre>${escapeHtml(step.stderr)}</pre>`
                        : ""
                    }<p class="meta">cwd: ${escapeHtml(step.cwd)}</p></details>`
                  : ""
              }</li>`
          )
          .join("");

  return `<h3>${escapeHtml(title)}</h3><ul>${items}</ul>`;
}

function renderPreflights(run: BenchmarkRun): string {
  return run.preflights
    .map((preflight) => {
      const runtime = formatRuntimeIdentity(preflight);
      const details = (preflight.details ?? [])
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("");

      return `
        <section class="preflight ${statusTone(preflight.status)}">
          <h2>${escapeHtml(preflight.displayLabel ?? preflight.agentTitle ?? preflight.agentId)} <span>${escapeHtml(preflight.variantId ?? preflight.agentId)}</span></h2>
          <p><strong>${escapeHtml(preflight.status)}</strong> ${escapeHtml(preflight.summary)}</p>
          <p class="meta">Variant: ${escapeHtml(preflight.displayLabel ?? preflight.agentTitle ?? preflight.agentId)}</p>
          <p class="meta">Base Agent: ${escapeHtml(preflight.baseAgentId ?? preflight.agentId)}</p>
          <p class="meta">Provider: ${escapeHtml(runtime.provider)} | Kind: ${escapeHtml(runtime.providerKind)} | Provider Source: ${escapeHtml(runtime.providerSource)}</p>
          <p class="meta">Support tier: ${escapeHtml(preflight.capability.supportTier)}</p>
          <p class="meta">Invocation: ${escapeHtml(preflight.capability.invocationMethod)}</p>
          <p class="meta">Model: ${escapeHtml(runtime.model)} | Reasoning: ${escapeHtml(
            runtime.reasoning
          )} | Version: ${escapeHtml(runtime.version)} | Verification: ${escapeHtml(runtime.verification)} | Source: ${escapeHtml(runtime.source)}</p>
          <p class="meta">Tokens: ${escapeHtml(preflight.capability.tokenAvailability)} | Cost: ${escapeHtml(
            preflight.capability.costAvailability
          )} | Trace: ${escapeHtml(preflight.capability.traceRichness)}</p>
          ${
            preflight.capability.authPrerequisites.length > 0
              ? `<p class="meta">Auth prerequisites: ${escapeHtml(preflight.capability.authPrerequisites.join("; "))}</p>`
              : ""
          }
          ${
            preflight.capability.knownLimitations.length > 0
              ? `<p class="meta">Known limitations: ${escapeHtml(preflight.capability.knownLimitations.join("; "))}</p>`
              : ""
          }
          ${
            preflight.command
              ? `<p class="meta">Invocation: ${escapeHtml(preflight.command)}</p>`
              : ""
          }
          ${details ? `<ul>${details}</ul>` : ""}
        </section>
      `;
    })
    .join("");
}

function renderAgentCards(run: BenchmarkRun): string {
  return (run.results as ScoredResult[])
    .map((result) => {
      const runtime = formatRuntimeIdentity(result);
      const _changedFiles = result.changedFiles;
      const addedFiles =
        result.diff.added.length === 0
          ? "<li>None</li>"
          : result.diff.added.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
      const changedDiffFiles =
        result.diff.changed.length === 0
          ? "<li>None</li>"
          : result.diff.changed.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
      const removedFiles =
        result.diff.removed.length === 0
          ? "<li>None</li>"
          : result.diff.removed.map((file) => `<li>${escapeHtml(file)}</li>`).join("");

      return `
        <section class="card">
          <h2>${escapeHtml(result.displayLabel ?? result.agentTitle ?? result.agentId)} <span>${escapeHtml(result.variantId ?? result.agentId)}</span></h2>
          <p>${escapeHtml(result.summary)}</p>
          <p class="meta">Preflight: ${escapeHtml(result.preflight.status)} - ${escapeHtml(
            result.preflight.summary
          )}</p>
          <p class="meta">Model: ${escapeHtml(runtime.model)} | Reasoning: ${escapeHtml(
            runtime.reasoning
          )} | Version: ${escapeHtml(runtime.version)} | Verification: ${escapeHtml(runtime.verification)} | Source: ${escapeHtml(runtime.source)}</p>
          <div class="stats">
            <div><strong>Status</strong><span>${escapeHtml(result.status)}</span></div>
            <div><strong>Composite Score</strong><span>${escapeHtml(String((result.compositeScore ?? 0).toFixed(1)))}</span></div>
            <div><strong>Duration</strong><span>${escapeHtml(formatDuration(result.durationMs))}</span></div>
            <div><strong>Tokens</strong><span>${result.tokenUsage}</span></div>
            <div><strong>Cost</strong><span>${result.costKnown ? `$${result.estimatedCostUsd.toFixed(4)}` : "n/a"}</span></div>
            <div><strong>Tests</strong><span>${escapeHtml(formatTestMetric(result))}</span></div>
            <div><strong>Lint</strong><span>${escapeHtml(formatLintMetric(result))}</span></div>
            <div><strong>Diff Precision</strong><span>${escapeHtml(formatDiffPrecisionMetric(result))}</span></div>
          </div>
          <h3>Files</h3>
          <ul>
            <li><strong>Added:</strong></ul>
            <ul>${addedFiles}</ul>
            <li><strong>Changed:</strong></ul>
            <ul>${changedDiffFiles}</ul>
            <li><strong>Removed:</strong></ul>
            <ul>${removedFiles}</ul>
          </ul>
          ${renderJudgeList(result)}
          ${
            result.setupResults.length > 0
              ? renderCommandStepList("Setup Commands", result.setupResults)
              : ""
          }
          ${
            result.teardownResults.length > 0
              ? renderCommandStepList("Teardown Commands", result.teardownResults)
              : ""
          }
        </section>
      `;
    })
    .join("");
}

function renderLeaderboardSection(_run: BenchmarkRun, leaderboard: LeaderboardData, locale: Locale): string {
  if (leaderboard.rows.length === 0) {
    return `
      <section class="leaderboard">
        <h2 class="section-title">${escapeHtml(locale === "zh-CN" ? "历史排行榜" : "Historical Leaderboard")}</h2>
        <p class="lede">${escapeHtml(locale === "zh-CN" ? "暂无历史数据。" : "No historical data available.")}</p>
      </section>
    `;
  }

  const explanation = locale === "zh-CN"
    ? [
        "此排行榜仅统计同任务、同评分模式、同配置的历史结果",
        "版本变化会开启新的历史记录，不会继承旧版本的分数",
        `当前榜单基于 ${leaderboard.comparableRunCount} 个可比较的 run`,
        `难度筛选：${leaderboard.difficultyFilter}`
      ]
    : [
        "This leaderboard only compares runs with the same task, score mode, and configuration",
        "Version changes create new historical records; scores are not inherited from old versions",
        `Current leaderboard is based on ${leaderboard.comparableRunCount} comparable runs`,
        `Difficulty filter: ${leaderboard.difficultyFilter}`
      ];

  if (leaderboard.excludedRunCount > 0) {
    explanation.push(
      locale === "zh-CN"
        ? `有 ${leaderboard.excludedRunCount} 个 run 因任务或评分模式不同被排除`
        : `${leaderboard.excludedRunCount} runs were excluded due to different task or score mode`
    );
  }

  const rows = leaderboard.rows
    .map((row) => {
      const { identity, stats } = row;
      const sampleWarning = !stats.sampleSizeSufficient
        ? `<span class="sample-warning">${escapeHtml(locale === "zh-CN" ? "样本不足" : "Insufficient samples")}</span>`
        : "";

      return `
        <tr class="leaderboard-row">
          <td><strong>${escapeHtml(row.displayLabel)}</strong></td>
          <td>${escapeHtml(identity.baseAgentId)}</td>
          <td>${escapeHtml(identity.providerProfile)}</td>
          <td>${escapeHtml(identity.model)}</td>
          <td>${escapeHtml(identity.version)}</td>
          <td>${stats.runCount}</td>
          <td>${stats.averageScore.toFixed(1)}</td>
          <td>${(stats.winRate * 100).toFixed(1)}% (${row.winCount}/${row.totalComparisons})${sampleWarning}</td>
          <td>${(stats.successRate * 100).toFixed(1)}%</td>
          <td>${(stats.firstPassRate * 100).toFixed(1)}%</td>
          <td>${escapeHtml(formatDuration(stats.medianDurationMs))}</td>
          <td>${stats.medianCostUsd !== null ? `$${stats.medianCostUsd.toFixed(4)}` : "n/a"}</td>
          <td class="last-seen">${escapeHtml(stats.lastSeenAt.slice(0, 10))}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="leaderboard">
      <h2 class="section-title">${escapeHtml(locale === "zh-CN" ? "历史排行榜" : "Historical Leaderboard")}</h2>
      <div class="leaderboard-explanation">
        ${explanation.map((text) => `<p class="lede">${escapeHtml(text)}</p>`).join("")}
      </div>
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>${escapeHtml(locale === "zh-CN" ? "配置" : "Variant")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "基础 Agent" : "Base Agent")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "Provider" : "Provider")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "模型" : "Model")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "版本" : "Version")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "Run 数" : "Runs")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "平均分" : "Avg Score")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "胜率" : "Win Rate")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "成功率" : "Success Rate")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "首次通过率" : "First Pass Rate")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "中位耗时" : "Median Duration")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "中位成本" : "Median Cost")}</th>
            <th>${escapeHtml(locale === "zh-CN" ? "最后更新" : "Last Seen")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
}

export function renderHtml(run: BenchmarkRun, locale: Locale, leaderboard?: LeaderboardData): string {
  const copy = getReportCopy(locale);
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(copy.htmlReportTitlePrefix)} ${escapeHtml(run.task.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --card: #fffdf7;
        --ink: #1f1b16;
        --muted: #6c6458;
        --accent: #b04a2b;
        --border: #dfd1bd;
        --ready: #315f43;
        --unverified: #946c14;
        --blocked: #8f3426;
        --missing: #5b5762;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(176, 74, 43, 0.12), transparent 25%),
          linear-gradient(180deg, #f8f4ec 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 48px 20px 72px;
      }
      header { margin-bottom: 28px; }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2.4rem, 5vw, 4.4rem);
        line-height: 0.95;
      }
      .lede {
        max-width: 760px;
        color: var(--muted);
        font-size: 1.05rem;
      }
      .section-title {
        margin: 32px 0 14px;
        font-size: 1.35rem;
      }
      .preflights, .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
      }
      .preflight, .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 22px;
        box-shadow: 0 18px 40px rgba(49, 34, 19, 0.07);
      }
      .tone-ready { border-left: 8px solid var(--ready); }
      .tone-unverified { border-left: 8px solid var(--unverified); }
      .tone-blocked { border-left: 8px solid var(--blocked); }
      .tone-missing { border-left: 8px solid var(--missing); }
      h2 {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin-top: 0;
      }
      h2 span {
        color: var(--muted);
        font-size: 0.9rem;
      }
      h3 { margin-bottom: 8px; }
      .stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin: 18px 0;
      }
      .stats div {
        display: flex;
        flex-direction: column;
        padding: 12px;
        border-radius: 14px;
        background: rgba(176, 74, 43, 0.08);
      }
      .stats strong {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .stats span {
        margin-top: 6px;
        font-size: 1.15rem;
      }
      ul { padding-left: 18px; }
      .meta {
        color: var(--muted);
        font-size: 0.9rem;
        word-break: break-word;
      }
      pre {
        overflow-x: auto;
        padding: 12px;
        border-radius: 12px;
        background: rgba(31, 27, 22, 0.06);
        white-space: pre-wrap;
      }
      details {
        margin-top: 8px;
      }
      .leaderboard {
        margin-top: 32px;
      }
      .leaderboard-explanation {
        margin-bottom: 16px;
      }
      .leaderboard-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      .leaderboard-table th,
      .leaderboard-table td {
        padding: 10px 8px;
        text-align: left;
        border-bottom: 1px solid var(--border);
      }
      .leaderboard-table th {
        font-weight: 600;
        color: var(--muted);
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .leaderboard-table tr:hover {
        background: rgba(176, 74, 43, 0.04);
      }
      .sample-warning {
        margin-left: 6px;
        font-size: 0.75rem;
        color: var(--accent);
        font-weight: 600;
      }
      .last-seen {
        color: var(--muted);
        font-size: 0.85rem;
      }
      footer {
        margin-top: 24px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(copy.reportTitle)}</h1>
        <p class="lede">${escapeHtml(run.task.title)} ${escapeHtml(copy.repositoryLabel)} ${escapeHtml(run.repoPath)}. ${escapeHtml(copy.generatedAtLabel)} ${escapeHtml(
          run.createdAt
        )} ${escapeHtml(copy.runIdLabel)} ${escapeHtml(run.runId)}.</p>
        <p class="lede">${escapeHtml(locale === "zh-CN" ? "评分模式" : "Score mode")}: ${escapeHtml(getRunScoreMode(run))} | ${escapeHtml(locale === "zh-CN" ? "评分权重" : "Score weights")}: ${escapeHtml(JSON.stringify((run as ScoredRun).scoreWeights ?? {}))}</p>
        <p class="lede">${escapeHtml(locale === "zh-CN" ? "评分范围" : "Score scope")}: ${escapeHtml(run.scoreScope ?? "run-local")} | ${escapeHtml(run.scoreValidityNote ?? "Scores only compare variants inside this run.")}</p>
        ${
          run.task.metadata
            ? `<p class="lede">${escapeHtml(copy.objectiveLabel)}: ${escapeHtml(run.task.metadata.objective ?? "n/a")} | ${escapeHtml(copy.judgeRationaleLabel)}: ${escapeHtml(
                run.task.metadata.judgeRationale ?? "n/a"
              )}</p>`
            : ""
        }
        <p class="lede">${escapeHtml(copy.comparesModelConfigurations)} ${escapeHtml(copy.baselineRepoHealthNote)}</p>
      </header>
      <h2 class="section-title">${escapeHtml(copy.adapterPreflightTitle)}</h2>
      <section class="preflights">
        ${renderPreflights(run)}
      </section>
      <h2 class="section-title">${escapeHtml(copy.benchmarkResultsTitle)}</h2>
      <section class="cards">
        ${renderAgentCards(run)}
      </section>
      ${leaderboard ? renderLeaderboardSection(run, leaderboard, locale) : ""}
      <footer>
        <p>${escapeHtml(copy.promptTitle)}: ${escapeHtml(run.task.prompt)}</p>
        ${
          run.task.metadata
            ? `<p>${escapeHtml(copy.taskLibraryLabel)}: ${escapeHtml(run.task.metadata.source)} by ${escapeHtml(run.task.metadata.owner)} | ${escapeHtml(copy.repoTypesLabel)}: ${escapeHtml(
                run.task.metadata.repoTypes.join(", ")
              )}</p>`
            : ""
        }
      </footer>
    </main>
  </body>
</html>`;
}
