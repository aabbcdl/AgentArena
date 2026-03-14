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

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function sanitizePath(value: string, basePath: string, prefix: string): string {
  const relativePath = normalizePath(path.relative(basePath, value));
  if (relativePath.length > 0 && !relativePath.startsWith("..")) {
    return `${prefix}/${relativePath}`;
  }

  return path.basename(value);
}

function sanitizeWorkspaceScopedPath(value: string, workspacePath: string, agentId: string): string {
  const relativePath = normalizePath(path.relative(workspacePath, value));
  if (relativePath === "") {
    return `workspace/${agentId}`;
  }

  if (!relativePath.startsWith("..")) {
    return `workspace/${agentId}/${relativePath}`;
  }

  return path.basename(value);
}

function sanitizeRun(run: BenchmarkRun): BenchmarkRun {
  return {
    ...run,
    repoPath: ".",
    outputPath: ".",
    preflights: run.preflights.map((preflight) => ({
      ...preflight,
      command: undefined
    })),
    results: run.results.map((result) => ({
      ...result,
      preflight: {
        ...result.preflight,
        command: undefined
      },
      setupResults: result.setupResults.map((step) => ({
        ...step,
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      judgeResults: result.judgeResults.map((judge) => ({
        ...judge,
        cwd: judge.cwd
          ? sanitizeWorkspaceScopedPath(judge.cwd, result.workspacePath, result.agentId)
          : undefined
      })),
      teardownResults: result.teardownResults.map((step) => ({
        ...step,
        cwd: sanitizeWorkspaceScopedPath(step.cwd, result.workspacePath, result.agentId)
      })),
      tracePath: sanitizePath(result.tracePath, run.outputPath, "run"),
      workspacePath: `workspace/${path.basename(result.workspacePath)}`
    }))
  };
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
      const changedFiles = result.changedFiles;
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
          ${renderCommandStepList("Setup", result.setupResults)}
          ${renderJudgeList(result)}
          ${renderCommandStepList("Teardown", result.teardownResults)}
          <h3>Changed Files</h3>
          <ul>${
            changedFiles.length === 0
              ? "<li>No diff detected.</li>"
              : changedFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join("")
          }</ul>
          <h3>Diff Breakdown</h3>
          <p class="meta">Added</p>
          <ul>${addedFiles}</ul>
          <p class="meta">Changed</p>
          <ul>${changedDiffFiles}</ul>
          <p class="meta">Removed</p>
          <ul>${removedFiles}</ul>
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
        <p class="lede">${escapeHtml(run.task.title)} in ${escapeHtml(run.repoPath)}. Generated at ${escapeHtml(
          run.createdAt
        )} for run ${escapeHtml(run.runId)}.</p>
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

function renderMarkdown(run: BenchmarkRun): string {
  const lines: string[] = [
    "# RepoArena Summary",
    "",
    `- Run ID: \`${run.runId}\``,
    `- Created At: \`${run.createdAt}\``,
    `- Task: \`${run.task.title}\``,
    `- Repository: \`${run.repoPath}\``,
    ""
  ];

  lines.push("## Adapter Preflight", "");
  lines.push("| Agent | Status | Summary |");
  lines.push("| --- | --- | --- |");
  for (const preflight of run.preflights) {
    lines.push(`| ${preflight.agentId} | ${preflight.status} | ${preflight.summary.replaceAll("\n", " ")} |`);
  }

  lines.push("", "## Results", "");
  lines.push("| Agent | Status | Duration | Tokens | Cost | Changed Files |");
  lines.push("| --- | --- | --- | ---: | --- | ---: |");
  for (const result of run.results) {
    lines.push(
      `| ${result.agentId} | ${result.status} | ${formatDuration(result.durationMs)} | ${result.tokenUsage} | ${
        result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"
      } | ${result.changedFiles.length} |`
    );
  }

  for (const result of run.results) {
    lines.push("", `### ${result.agentTitle} (\`${result.agentId}\`)`, "");
    lines.push(`- Summary: ${result.summary}`);
    lines.push(`- Preflight: ${result.preflight.status} - ${result.preflight.summary}`);
    lines.push(`- Trace: \`${result.tracePath}\``);
    lines.push(`- Workspace: \`${result.workspacePath}\``);

    if (result.changedFiles.length > 0) {
      lines.push("- Changed Files:");
      for (const file of result.changedFiles) {
        lines.push(`  - \`${file}\``);
      }
    } else {
      lines.push("- Changed Files: none");
    }

    if (result.judgeResults.length > 0) {
        lines.push("- Judges:");
      for (const judge of result.judgeResults) {
        lines.push(
          `  - ${judge.label}: ${judge.success ? "pass" : "fail"} (${formatDuration(judge.durationMs)})${
            judge.target ? ` target=${judge.target}` : ""
          }${judge.expectation ? ` expect=${judge.expectation}` : ""}`
        );
      }
    }
  }

  lines.push("", "## Prompt", "", "```text", run.task.prompt, "```", "");
  return lines.join("\n");
}

export async function writeReport(
  run: BenchmarkRun
): Promise<{ htmlPath: string; jsonPath: string; markdownPath: string }> {
  await ensureDirectory(run.outputPath);
  const publicRun = sanitizeRun(run);

  const jsonPath = path.join(run.outputPath, "summary.json");
  const htmlPath = path.join(run.outputPath, "report.html");
  const markdownPath = path.join(run.outputPath, "summary.md");

  await fs.writeFile(jsonPath, JSON.stringify(publicRun, null, 2), "utf8");
  await fs.writeFile(htmlPath, renderHtml(publicRun), "utf8");
  await fs.writeFile(markdownPath, renderMarkdown(publicRun), "utf8");

  return { htmlPath, jsonPath, markdownPath };
}
