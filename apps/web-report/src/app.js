const state = {
  run: null,
  selectedAgentId: null
};

const elements = {
  fileInput: document.querySelector("#summary-file"),
  runInfo: document.querySelector("#run-info"),
  agentList: document.querySelector("#agent-list"),
  agentCount: document.querySelector("#agent-count"),
  emptyState: document.querySelector("#empty-state"),
  dashboard: document.querySelector("#dashboard"),
  taskTitle: document.querySelector("#task-title"),
  taskMeta: document.querySelector("#task-meta"),
  metrics: document.querySelector("#metrics"),
  preflights: document.querySelector("#preflights"),
  resultSummary: document.querySelector("#result-summary"),
  resultDetails: document.querySelector("#result-details"),
  expandAll: document.querySelector("#expand-all"),
  collapseAll: document.querySelector("#collapse-all")
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

function statusClass(status) {
  return `status-${status}`;
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
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
            ${escapeHtml(result.agentId)} · ${escapeHtml(formatDuration(result.durationMs))} · ${escapeHtml(
              formatCost(result)
            )}
          </div>
        </button>
      `;
    })
    .join("");
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
      <div class="summary-row"><span>Trace</span><code>${escapeHtml(result.tracePath)}</code></div>
      <div class="summary-row"><span>Workspace</span><code>${escapeHtml(result.workspacePath)}</code></div>
    </div>
    <p class="muted">${escapeHtml(result.summary)}</p>
  `;

  elements.resultDetails.innerHTML = [
    renderStepCards("Setup", result.setupResults),
    renderStepCards("Judges", result.judgeResults),
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
  elements.taskMeta.textContent = `${run.task.id} · ${run.task.schemaVersion} · ${run.createdAt}`;

  renderRunInfo(run);
  renderMetrics(run);
  renderPreflights(run);
  renderAgentList(run);
  renderSelectedAgent();
}

function applyRun(run) {
  state.run = run;
  state.selectedAgentId = run.results[0]?.agentId ?? null;
  renderDashboard(run);
}

async function handleFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  const parsed = JSON.parse(text);
  applyRun(parsed);
}

elements.fileInput.addEventListener("change", handleFileSelection);

elements.agentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-agent-id]");
  if (!button || !state.run) {
    return;
  }

  state.selectedAgentId = button.getAttribute("data-agent-id");
  renderAgentList(state.run);
  renderSelectedAgent();
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
