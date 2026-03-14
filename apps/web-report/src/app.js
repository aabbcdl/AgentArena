const state = {
  runs: [],
  run: null,
  selectedRunId: null,
  selectedAgentId: null,
  markdownByRunId: new Map(),
  standaloneMarkdown: null
};

const elements = {
  fileInput: document.querySelector("#summary-file"),
  markdownInput: document.querySelector("#markdown-file"),
  folderInput: document.querySelector("#runs-folder"),
  runInfo: document.querySelector("#run-info"),
  runList: document.querySelector("#run-list"),
  runCount: document.querySelector("#run-count"),
  agentList: document.querySelector("#agent-list"),
  agentCount: document.querySelector("#agent-count"),
  emptyState: document.querySelector("#empty-state"),
  dashboard: document.querySelector("#dashboard"),
  taskTitle: document.querySelector("#task-title"),
  taskMeta: document.querySelector("#task-meta"),
  metrics: document.querySelector("#metrics"),
  runCompareSort: document.querySelector("#run-compare-sort"),
  runCompareTable: document.querySelector("#run-compare-table"),
  preflights: document.querySelector("#preflights"),
  compareStatusFilter: document.querySelector("#compare-status-filter"),
  compareSort: document.querySelector("#compare-sort"),
  compareTable: document.querySelector("#compare-table"),
  resultSummary: document.querySelector("#result-summary"),
  resultDetails: document.querySelector("#result-details"),
  judgeSearch: document.querySelector("#judge-search"),
  judgeTypeFilter: document.querySelector("#judge-type-filter"),
  judgeStatusFilter: document.querySelector("#judge-status-filter"),
  markdownPanel: document.querySelector("#markdown-panel"),
  markdownStatus: document.querySelector("#markdown-status"),
  markdownContent: document.querySelector("#markdown-content"),
  expandAll: document.querySelector("#expand-all"),
  collapseAll: document.querySelector("#collapse-all")
};

const judgeFilters = {
  search: "",
  type: "all",
  status: "all"
};

const compareFilters = {
  status: "all",
  sort: "status"
};

const runCompareFilters = {
  sort: "created"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatCost(result) {
  return result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a";
}

function formatJudgeType(type) {
  switch (type) {
    case "file-exists":
      return "File Exists";
    case "file-contains":
      return "File Contains";
    case "json-value":
      return "JSON Value";
    case "glob":
      return "Glob";
    case "file-count":
      return "File Count";
    case "snapshot":
      return "Snapshot";
    case "json-schema":
      return "JSON Schema";
    default:
      return "Command";
  }
}

function statusClass(status) {
  return `status-${status}`;
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function sortRuns(runs) {
  return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function updateCurrentRun() {
  state.run = state.runs.find((run) => run.runId === state.selectedRunId) ?? null;
  if (!state.run) {
    state.selectedAgentId = null;
    return;
  }

  if (!state.run.results.some((result) => result.agentId === state.selectedAgentId)) {
    state.selectedAgentId = state.run.results[0]?.agentId ?? null;
  }
}

function applyRuns(runs, markdownByRunId = new Map()) {
  state.runs = sortRuns(runs);
  state.markdownByRunId = markdownByRunId;
  state.selectedRunId = state.runs[0]?.runId ?? null;
  updateCurrentRun();
  render();
}

function applySingleRun(run, markdown = null) {
  const existingRuns = state.runs.filter((entry) => entry.runId !== run.runId);
  const markdownByRunId = new Map(state.markdownByRunId);
  if (markdown) {
    markdownByRunId.set(run.runId, markdown);
  }
  applyRuns([run, ...existingRuns], markdownByRunId);
}

function renderRunInfo(run) {
  elements.runInfo.innerHTML = `
    <div class="panel-header">
      <h2>Run</h2>
      <span class="muted">${escapeHtml(run.runId)}</span>
    </div>
    <p class="muted">Created at ${escapeHtml(run.createdAt)}</p>
    <p class="muted">Task schema ${escapeHtml(run.task.schemaVersion)}</p>
  `;
  setHidden(elements.runInfo, false);
}

function renderRunList() {
  elements.runCount.textContent = String(state.runs.length);

  if (state.runs.length === 0) {
    elements.runList.className = "run-list empty-state";
    elements.runList.textContent = "No runs loaded.";
    return;
  }

  elements.runList.className = "run-list";
  elements.runList.innerHTML = state.runs
    .map((run) => {
      const active = run.runId === state.selectedRunId ? "active" : "";
      const successCount = run.results.filter((result) => result.status === "success").length;
      const hasMarkdown = state.markdownByRunId.has(run.runId);

      return `
        <button class="run-button ${active}" type="button" data-run-id="${escapeHtml(run.runId)}">
          <strong>${escapeHtml(run.task.title)}</strong>
          <div class="meta">${escapeHtml(run.createdAt)}</div>
          <div class="meta">${successCount}/${run.results.length} success | ${escapeHtml(run.runId)}</div>
          <div class="meta">${hasMarkdown ? "markdown linked" : "json only"}</div>
        </button>
      `;
    })
    .join("");
}

function renderMetrics(run) {
  const successCount = run.results.filter((result) => result.status === "success").length;
  const failedCount = run.results.length - successCount;
  const totalTokens = run.results.reduce((total, result) => total + result.tokenUsage, 0);
  const knownCost = run.results
    .filter((result) => result.costKnown)
    .reduce((total, result) => total + result.estimatedCostUsd, 0);

  elements.metrics.innerHTML = `
    <article class="metric">
      <p class="metric-label">Agents</p>
      <p class="metric-value">${run.results.length}</p>
    </article>
    <article class="metric">
      <p class="metric-label">Success</p>
      <p class="metric-value">${successCount}</p>
    </article>
    <article class="metric">
      <p class="metric-label">Failed</p>
      <p class="metric-value">${failedCount}</p>
    </article>
    <article class="metric">
      <p class="metric-label">Tokens</p>
      <p class="metric-value">${totalTokens}</p>
    </article>
    <article class="metric">
      <p class="metric-label">Known Cost</p>
      <p class="metric-value">$${knownCost.toFixed(2)}</p>
    </article>
  `;
}

function summarizeRunForCompare(run) {
  const successCount = run.results.filter((result) => result.status === "success").length;
  const totalTokens = run.results.reduce((total, result) => total + result.tokenUsage, 0);
  const knownCost = run.results
    .filter((result) => result.costKnown)
    .reduce((total, result) => total + result.estimatedCostUsd, 0);

  return {
    successCount,
    totalAgents: run.results.length,
    totalTokens,
    knownCost
  };
}

function getRunCompareRows() {
  const rows = state.runs.map((run) => ({
    run,
    summary: summarizeRunForCompare(run)
  }));

  return rows.sort((left, right) => {
    switch (runCompareFilters.sort) {
      case "success":
        return right.summary.successCount / Math.max(right.summary.totalAgents, 1) -
          left.summary.successCount / Math.max(left.summary.totalAgents, 1);
      case "tokens":
        return right.summary.totalTokens - left.summary.totalTokens;
      case "cost":
        return left.summary.knownCost - right.summary.knownCost;
      case "created":
      default:
        return right.run.createdAt.localeCompare(left.run.createdAt);
    }
  });
}

function renderRunCompareTable() {
  if (state.runs.length === 0) {
    elements.runCompareTable.innerHTML = `<p class="empty-state">No runs loaded.</p>`;
    return;
  }

  const rows = getRunCompareRows();
  elements.runCompareTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Task</th>
          <th>Created</th>
          <th>Success</th>
          <th>Agents</th>
          <th>Tokens</th>
          <th>Known Cost</th>
          <th>Markdown</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(({ run, summary }) => {
            const isActive = run.runId === state.selectedRunId ? "active" : "";
            return `
              <tr class="${isActive}" data-compare-run-id="${escapeHtml(run.runId)}">
                <td><code>${escapeHtml(run.runId)}</code></td>
                <td>${escapeHtml(run.task.title)}</td>
                <td>${escapeHtml(run.createdAt)}</td>
                <td>${summary.successCount}/${summary.totalAgents}</td>
                <td>${summary.totalAgents}</td>
                <td>${summary.totalTokens}</td>
                <td>$${summary.knownCost.toFixed(2)}</td>
                <td>${state.markdownByRunId.has(run.runId) ? "linked" : "none"}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPreflights(run) {
  elements.preflights.innerHTML = run.preflights
    .map(
      (preflight) => `
        <article class="preflight-card ${escapeHtml(preflight.status)}">
          <div class="panel-header">
            <h3>${escapeHtml(preflight.agentTitle)}</h3>
            <span class="status-badge ${statusClass(preflight.status)}">${escapeHtml(preflight.status)}</span>
          </div>
          <p>${escapeHtml(preflight.summary)}</p>
          ${
            preflight.details?.length
              ? `<ul>${preflight.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

function renderAgentList(run) {
  elements.agentCount.textContent = String(run.results.length);
  elements.agentList.classList.remove("empty-state");
  elements.agentList.innerHTML = run.results
    .map((result) => {
      const active = result.agentId === state.selectedAgentId ? "active" : "";
      return `
        <button class="agent-button ${active}" type="button" data-agent-id="${escapeHtml(result.agentId)}">
          <div class="row">
            <strong>${escapeHtml(result.agentTitle)}</strong>
            <span class="status-badge ${statusClass(result.status)}">${escapeHtml(result.status)}</span>
          </div>
          <div class="meta">
            ${escapeHtml(result.agentId)} | ${escapeHtml(formatDuration(result.durationMs))} | ${escapeHtml(
              formatCost(result)
            )}
          </div>
        </button>
      `;
    })
    .join("");
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

function compareJudgeRatio(result) {
  if (result.judgeResults.length === 0) {
    return 0;
  }

  return result.judgeResults.filter((judge) => judge.success).length / result.judgeResults.length;
}

function getCompareResults(run) {
  const filteredResults = run.results.filter((result) => {
    return compareFilters.status === "all" || result.status === compareFilters.status;
  });

  const sortedResults = [...filteredResults].sort((left, right) => {
    switch (compareFilters.sort) {
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
        return compareJudgeRatio(right) - compareJudgeRatio(left);
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

  return sortedResults;
}

function renderCompareTable(run) {
  const results = getCompareResults(run);

  if (results.length === 0) {
    elements.compareTable.innerHTML = `<p class="empty-state">No agents match the current compare filters.</p>`;
    return;
  }

  elements.compareTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Tokens</th>
          <th>Cost</th>
          <th>Changed</th>
          <th>Judges</th>
        </tr>
      </thead>
      <tbody>
        ${results
          .map((result) => {
            const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
            const isActive = result.agentId === state.selectedAgentId ? "active" : "";

            return `
              <tr class="${isActive}" data-compare-agent-id="${escapeHtml(result.agentId)}">
                <td><strong>${escapeHtml(result.agentTitle)}</strong><br /><code>${escapeHtml(result.agentId)}</code></td>
                <td><span class="status-badge ${statusClass(result.status)}">${escapeHtml(result.status)}</span></td>
                <td>${escapeHtml(formatDuration(result.durationMs))}</td>
                <td>${result.tokenUsage}</td>
                <td>${escapeHtml(formatCost(result))}</td>
                <td>${result.changedFiles.length}</td>
                <td>${passedJudges}/${result.judgeResults.length}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderStepCards(title, steps) {
  const content =
    steps.length === 0
      ? `<p class="empty-state">No commands executed.</p>`
      : `<div class="step-list">${steps
          .map(
            (step) => `
              <details class="step-card">
                <summary>
                  <strong>${escapeHtml(step.label)}</strong>
                  <span class="status-badge ${statusClass(step.success ? "success" : "failed")}">${
                    step.success ? "pass" : "fail"
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(step.durationMs))}</span>
                </summary>
                <div class="detail-row"><span>Command</span><code>${escapeHtml(step.command)}</code></div>
                <div class="detail-row"><span>CWD</span><code>${escapeHtml(step.cwd)}</code></div>
                ${
                  step.stdout
                    ? `<p class="muted">stdout</p><pre>${escapeHtml(step.stdout)}</pre>`
                    : ""
                }
                ${
                  step.stderr
                    ? `<p class="muted">stderr</p><pre>${escapeHtml(step.stderr)}</pre>`
                    : ""
                }
              </details>
            `
          )
          .join("")}</div>`;

  return `<section class="detail-card"><h3>${escapeHtml(title)}</h3>${content}</section>`;
}

function renderJudgeCards(result) {
  const judges = result.judgeResults;
  const filteredJudges = judges.filter((judge) => {
    const matchesType = judgeFilters.type === "all" || judge.type === judgeFilters.type;
    const matchesStatus =
      judgeFilters.status === "all" ||
      (judgeFilters.status === "pass" ? judge.success : !judge.success);
    const haystack = [judge.label, judge.target ?? "", judge.expectation ?? "", judge.command ?? ""]
      .join(" ")
      .toLowerCase();
    const matchesSearch = judgeFilters.search === "" || haystack.includes(judgeFilters.search);

    return matchesType && matchesStatus && matchesSearch;
  });

  const byType = judges.reduce((map, judge) => {
    map.set(judge.type, (map.get(judge.type) ?? 0) + 1);
    return map;
  }, new Map());

  const overview =
    judges.length === 0
      ? `<p class="empty-state">No judges executed.</p>`
      : `
        <div class="judge-overview">
          ${Array.from(byType.entries())
            .map(
              ([type, count]) => `
                <div class="judge-chip">
                  <span>${escapeHtml(formatJudgeType(type))}</span>
                  <strong>${count}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      `;

  const content =
    filteredJudges.length === 0
      ? ""
      : `<div class="step-list">${filteredJudges
          .map(
            (judge) => `
              <details class="step-card judge-card">
                <summary>
                  <strong>${escapeHtml(judge.label)}</strong>
                  <span class="judge-kind">${escapeHtml(formatJudgeType(judge.type))}</span>
                  <span class="status-badge ${statusClass(judge.success ? "success" : "failed")}">${
                    judge.success ? "pass" : "fail"
                  }</span>
                  <span class="muted">${escapeHtml(formatDuration(judge.durationMs))}</span>
                </summary>
                ${
                  judge.target
                    ? `<div class="detail-row"><span>Target</span><code>${escapeHtml(judge.target)}</code></div>`
                    : ""
                }
                ${
                  judge.expectation
                    ? `<div class="detail-row"><span>Expectation</span><code>${escapeHtml(judge.expectation)}</code></div>`
                    : ""
                }
                ${
                  judge.command
                    ? `<div class="detail-row"><span>Command</span><code>${escapeHtml(judge.command)}</code></div>`
                    : ""
                }
                ${
                  judge.cwd
                    ? `<div class="detail-row"><span>CWD</span><code>${escapeHtml(judge.cwd)}</code></div>`
                    : ""
                }
                ${
                  judge.stdout
                    ? `<p class="muted">stdout</p><pre>${escapeHtml(judge.stdout)}</pre>`
                    : ""
                }
                ${
                  judge.stderr
                    ? `<p class="muted">stderr</p><pre>${escapeHtml(judge.stderr)}</pre>`
                    : ""
                }
              </details>
            `
          )
          .join("")}</div>`;

  return `<section class="detail-card"><h3>Judges</h3>${overview}${
    filteredJudges.length === 0 && judges.length > 0
      ? `<p class="empty-state">No judges match the current filters.</p>`
      : content
  }</section>`;
}

function populateJudgeFilters(run) {
  const judgeTypes = Array.from(
    new Set(run.results.flatMap((result) => result.judgeResults.map((judge) => judge.type)))
  ).sort();

  const currentType = judgeFilters.type;
  elements.judgeTypeFilter.innerHTML = [
    `<option value="all">All Types</option>`,
    ...judgeTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(formatJudgeType(type))}</option>`)
  ].join("");
  elements.judgeTypeFilter.value = judgeTypes.includes(currentType) ? currentType : "all";
}

function renderDiff(result) {
  const sections = [
    ["Added", result.diff.added],
    ["Changed", result.diff.changed],
    ["Removed", result.diff.removed]
  ];

  return `
    <section class="detail-card">
      <h3>Diff Breakdown</h3>
      <div class="diff-grid">
        ${sections
          .map(
            ([label, files]) => `
              <div class="diff-column">
                <h4>${escapeHtml(label)}</h4>
                ${
                  files.length === 0
                    ? `<p class="empty-state">None</p>`
                    : `<ul>${files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul>`
                }
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMarkdownBlock(markdown) {
  const escaped = escapeHtml(markdown);
  return `<pre>${escaped}</pre>`;
}

function renderMarkdownPanel() {
  const markdown =
    (state.run && state.markdownByRunId.get(state.run.runId)) ??
    state.standaloneMarkdown ??
    null;

  if (!markdown) {
    setHidden(elements.markdownPanel, true);
    elements.markdownStatus.textContent = "Not loaded";
    elements.markdownContent.innerHTML = "";
    return;
  }

  setHidden(elements.markdownPanel, false);
  elements.markdownStatus.textContent = state.run && state.markdownByRunId.has(state.run.runId)
    ? "Linked to selected run"
    : "Standalone markdown";
  elements.markdownContent.innerHTML = renderMarkdownBlock(markdown);
}

function renderSelectedAgent() {
  if (!state.run || !state.selectedAgentId) {
    return;
  }

  const result = state.run.results.find((entry) => entry.agentId === state.selectedAgentId);
  if (!result) {
    return;
  }

  elements.resultSummary.innerHTML = `
    <h3>${escapeHtml(result.agentTitle)}</h3>
    <div class="summary-grid">
      <div class="summary-row"><span>Status</span><strong>${escapeHtml(result.status)}</strong></div>
      <div class="summary-row"><span>Duration</span><strong>${escapeHtml(formatDuration(result.durationMs))}</strong></div>
      <div class="summary-row"><span>Tokens</span><strong>${result.tokenUsage}</strong></div>
      <div class="summary-row"><span>Cost</span><strong>${escapeHtml(formatCost(result))}</strong></div>
      <div class="summary-row"><span>Changed Files</span><strong>${result.changedFiles.length}</strong></div>
      <div class="summary-row"><span>Judge Types</span><strong>${escapeHtml(
        Array.from(new Set(result.judgeResults.map((judge) => formatJudgeType(judge.type)))).join(", ") || "None"
      )}</strong></div>
      <div class="summary-row"><span>Trace</span><code>${escapeHtml(result.tracePath)}</code></div>
      <div class="summary-row"><span>Workspace</span><code>${escapeHtml(result.workspacePath)}</code></div>
    </div>
    <p class="muted">${escapeHtml(result.summary)}</p>
  `;

  elements.resultDetails.innerHTML = [
    renderStepCards("Setup", result.setupResults),
    renderJudgeCards(result),
    renderStepCards("Teardown", result.teardownResults),
    `
      <section class="detail-card">
        <h3>Changed Files</h3>
        ${
          result.changedFiles.length === 0
            ? `<p class="empty-state">No diff detected.</p>`
            : `<ul>${result.changedFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul>`
        }
      </section>
    `,
    renderDiff(result)
  ].join("");
}

function renderDashboard(run) {
  setHidden(elements.emptyState, true);
  setHidden(elements.dashboard, false);

  elements.taskTitle.textContent = run.task.title;
  elements.taskMeta.textContent = `${run.task.id} | ${run.task.schemaVersion} | ${run.createdAt}`;

  renderRunInfo(run);
  renderMetrics(run);
  renderRunCompareTable();
  renderPreflights(run);
  renderAgentList(run);
  renderCompareTable(run);
  populateJudgeFilters(run);
  renderSelectedAgent();
  renderMarkdownPanel();
}

function render() {
  renderRunList();

  if (!state.run) {
    setHidden(elements.runInfo, true);
    setHidden(elements.emptyState, false);
    setHidden(elements.dashboard, true);
    elements.agentCount.textContent = "0";
    elements.agentList.className = "agent-list empty-state";
    elements.agentList.textContent = "No report loaded.";
    elements.runCompareTable.innerHTML = "";
    renderMarkdownPanel();
    return;
  }

  renderDashboard(state.run);
}

async function readRunFromFile(file) {
  return JSON.parse(await file.text());
}

async function handleFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const run = await readRunFromFile(file);
  applySingleRun(run);
}

async function handleMarkdownSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  state.standaloneMarkdown = await file.text();
  renderMarkdownPanel();
}

function folderOf(file) {
  const relativePath = file.webkitRelativePath || file.name;
  const segments = relativePath.split("/");
  segments.pop();
  return segments.join("/");
}

async function handleFolderSelection(event) {
  const files = Array.from(event.target.files ?? []);
  const summaryFiles = files.filter((file) => file.name.toLowerCase() === "summary.json");
  if (summaryFiles.length === 0) {
    return;
  }

  const markdownByFolder = new Map();
  for (const file of files.filter((entry) => entry.name.toLowerCase() === "summary.md")) {
    markdownByFolder.set(folderOf(file), await file.text());
  }

  const runs = [];
  const markdownByRunId = new Map();
  for (const file of summaryFiles) {
    const run = await readRunFromFile(file);
    runs.push(run);
    const markdown = markdownByFolder.get(folderOf(file));
    if (markdown) {
      markdownByRunId.set(run.runId, markdown);
    }
  }

  applyRuns(runs, markdownByRunId);
}

elements.fileInput.addEventListener("change", handleFileSelection);
elements.markdownInput.addEventListener("change", handleMarkdownSelection);
elements.folderInput.addEventListener("change", handleFolderSelection);

elements.runList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-run-id]");
  if (!button) {
    return;
  }

  state.selectedRunId = button.getAttribute("data-run-id");
  updateCurrentRun();
  render();
});

elements.agentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-agent-id]");
  if (!button || !state.run) {
    return;
  }

  state.selectedAgentId = button.getAttribute("data-agent-id");
  renderAgentList(state.run);
  renderCompareTable(state.run);
  renderSelectedAgent();
});

elements.compareTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-compare-agent-id]");
  if (!row || !state.run) {
    return;
  }

  state.selectedAgentId = row.getAttribute("data-compare-agent-id");
  renderAgentList(state.run);
  renderCompareTable(state.run);
  renderSelectedAgent();
});

elements.runCompareTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-compare-run-id]");
  if (!row) {
    return;
  }

  state.selectedRunId = row.getAttribute("data-compare-run-id");
  updateCurrentRun();
  render();
});

elements.expandAll.addEventListener("click", () => {
  document.querySelectorAll("details").forEach((element) => {
    element.open = true;
  });
});

elements.collapseAll.addEventListener("click", () => {
  document.querySelectorAll("details").forEach((element) => {
    element.open = false;
  });
});

elements.judgeSearch.addEventListener("input", (event) => {
  judgeFilters.search = String(event.target.value ?? "").trim().toLowerCase();
  renderSelectedAgent();
});

elements.judgeTypeFilter.addEventListener("change", (event) => {
  judgeFilters.type = String(event.target.value ?? "all");
  renderSelectedAgent();
});

elements.judgeStatusFilter.addEventListener("change", (event) => {
  judgeFilters.status = String(event.target.value ?? "all");
  renderSelectedAgent();
});

elements.compareStatusFilter.addEventListener("change", (event) => {
  compareFilters.status = String(event.target.value ?? "all");
  if (state.run) {
    renderCompareTable(state.run);
  }
});

elements.compareSort.addEventListener("change", (event) => {
  compareFilters.sort = String(event.target.value ?? "status");
  if (state.run) {
    renderCompareTable(state.run);
  }
});

elements.runCompareSort.addEventListener("change", (event) => {
  runCompareFilters.sort = String(event.target.value ?? "created");
  renderRunCompareTable();
});
