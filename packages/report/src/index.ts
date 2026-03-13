import { promises as fs } from "node:fs";
import path from "node:path";
import { AdapterPreflightResult, BenchmarkRun, ensureDirectory, formatDuration } from "@repoarena/core";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusTone(status: AdapterPreflightResult["status"]): string {
  switch (status) {
    case "ready":
      return "tone-ready";
    case "unverified":
      return "tone-unverified";
    case "blocked":
      return "tone-blocked";
    case "missing":
      return "tone-missing";
  }
}

function renderPreflights(run: BenchmarkRun): string {
  return run.preflights
    .map((preflight) => {
      const details = (preflight.details ?? [])
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("");

      return `
        <section class="preflight ${statusTone(preflight.status)}">
          <h2>${escapeHtml(preflight.agentTitle)} <span>${escapeHtml(preflight.agentId)}</span></h2>
          <p><strong>${escapeHtml(preflight.status)}</strong> ${escapeHtml(preflight.summary)}</p>
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
  return run.results
    .map((result) => {
      const judgeItems =
        result.judgeResults.length === 0
          ? "<li>No success commands executed.</li>"
          : result.judgeResults
              .map(
                (judge) =>
                  `<li><strong>${escapeHtml(judge.label)}</strong>: ${
                    judge.success ? "pass" : "fail"
                  } (${escapeHtml(formatDuration(judge.durationMs))})</li>`
              )
              .join("");

      const changedFiles = [...result.diff.added, ...result.diff.changed, ...result.diff.removed];

      return `
        <section class="card">
          <h2>${escapeHtml(result.agentTitle)} <span>${escapeHtml(result.agentId)}</span></h2>
          <p>${escapeHtml(result.summary)}</p>
          <p class="meta">Preflight: ${escapeHtml(result.preflight.status)} - ${escapeHtml(
            result.preflight.summary
          )}</p>
          <div class="stats">
            <div><strong>Status</strong><span>${result.status}</span></div>
            <div><strong>Duration</strong><span>${escapeHtml(formatDuration(result.durationMs))}</span></div>
            <div><strong>Tokens</strong><span>${result.tokenUsage}</span></div>
            <div><strong>Cost</strong><span>${
              result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
            }</span></div>
          </div>
          <h3>Judges</h3>
          <ul>${judgeItems}</ul>
          <h3>Changed Files</h3>
          <ul>${
            changedFiles.length === 0
              ? "<li>No diff detected.</li>"
              : changedFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join("")
          }</ul>
          <p class="meta">Trace: ${escapeHtml(result.tracePath)}</p>
          <p class="meta">Workspace: ${escapeHtml(result.workspacePath)}</p>
        </section>
      `;
    })
    .join("");
}

function renderHtml(run: BenchmarkRun): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RepoArena Report - ${escapeHtml(run.task.title)}</title>
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
      footer {
        margin-top: 24px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>RepoArena Report</h1>
        <p class="lede">${escapeHtml(run.task.title)} in ${escapeHtml(
          run.repoPath
        )}. Generated at ${escapeHtml(run.createdAt)} for run ${escapeHtml(run.runId)}.</p>
      </header>
      <h2 class="section-title">Adapter Preflight</h2>
      <section class="preflights">
        ${renderPreflights(run)}
      </section>
      <h2 class="section-title">Benchmark Results</h2>
      <section class="cards">
        ${renderAgentCards(run)}
      </section>
      <footer>
        <p>Prompt: ${escapeHtml(run.task.prompt)}</p>
      </footer>
    </main>
  </body>
</html>`;
}

export async function writeReport(run: BenchmarkRun): Promise<{ htmlPath: string; jsonPath: string }> {
  await ensureDirectory(run.outputPath);

  const jsonPath = path.join(run.outputPath, "summary.json");
  const htmlPath = path.join(run.outputPath, "report.html");

  await fs.writeFile(jsonPath, JSON.stringify(run, null, 2), "utf8");
  await fs.writeFile(htmlPath, renderHtml(run), "utf8");

  return { htmlPath, jsonPath };
}
