import { escapeHtml, formatRelativeTime, setHidden } from "../app-helpers.js";
import { renderBarChart, renderComparisonBarChart, renderRadarChart } from "../components/charts.js";
import {baselineTaskWarning, 
  formatJudgeType, statusClass, 
  taskIntentSummary, taskMeaningBadges,translateStatus 
} from "../task-utils.js";
import { createVirtualList } from "../utils/virtual-list.js";
import {baseAgentLabel,
  findPreviousComparableRun, getAgentTrendRows,getCompareResults,getRunCompareRows, getRunToRunAgentDiff, 
  getRunTrustSummary, 
  getRunVerdict, getSelectionTrustSummary, resultLabel, runtimeIdentity, 
  summarizeRun 
} from "../view-model/comparison.js";
import { formatCompositeScore, getCompositeScoreReasons } from "../view-model/scoring.js";

const VIRTUAL_LIST_THRESHOLD = 50;
let runListVirtual = null;

/**
 * Create the dashboard module.
 *
 * DI CONTRACT (untyped — plain JS, no interface):
 * The `deps` object must contain ALL of the following properties. Missing
 * properties will be `undefined` at runtime, causing silent failures in
 * render functions. The corresponding construction site is app.js lines 388-418.
 *
 * Required deps:
 *   state, elements, judgeFilters, compareFilters, runCompareFilters,
 *   t, localText, formatDuration, formatCost, recordKey,
 *   runtimeVerificationLabel, getArchivedScoreModeLabel, getScoreModeLabel,
 *   runFocusLine, formatDiffPrecisionMetric, formatTestMetric, formatLintMetric,
 *   findJudgeByType, diffPrecisionScore, renderStepCards, renderJudgeCards,
 *   renderDiff, renderMarkdownBlock, renderInlineAgentDetail,
 *   renderCodeReviewSection, renderTeamCostCalculator, setupShareActions,
 *   buildShareCard, buildLeaderboard
 *
 * Note: Pure utility functions (escapeHtml, formatDuration, statusClass, etc.)
 * are imported directly to reduce the DI surface. Only state, elements,
 * and render callbacks need to be injected.
 *
 * RENDER ORDER: renderDashboard() reads DOM elements created by renderRunList()
 * in app.js. See app.js lines 797-808 for the ordering constraint.
 */
export function createDashboardModule(deps) {
  const {
    state,
    elements,
    judgeFilters,
    compareFilters,
    runCompareFilters,
    t,
    localText,
    formatDuration,
    formatCost,
    recordKey,
    runtimeVerificationLabel,
    getArchivedScoreModeLabel,
    getScoreModeLabel,
    runFocusLine,
    formatDiffPrecisionMetric,
    formatTestMetric,
    formatLintMetric,
    findJudgeByType,
    diffPrecisionScore,
    renderStepCards,
    renderJudgeCards,
    renderDiff,
    renderMarkdownBlock,
    renderInlineAgentDetail,
    renderCodeReviewSection,
    renderTeamCostCalculator,
    setupShareActions,
    buildShareCard,
    buildLeaderboard
  } = deps;

  // Shared helper: format a delta value with +/- sign and optional unit
  const formatDelta = (value, unit = "") => {
    if (value === null || value === undefined) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${typeof value === "number" && unit === "$" ? value.toFixed(4) : value}${unit}`;
  };
/**
 * Map a composite score (0-100) to a human-readable grade with CSS class.
 *
 * Grade bands:
 *   0-40   → "Failed"   (red)     — run failed or critical judges failed
 *   40-65  → "Fair"     (orange)  — partial success, room for improvement
 *   65-80  → "Good"     (green)   — solid result
 *   80-100 → "Excellent" (deep green) — outstanding result
 *
 * @param {number} score - Composite score 0-100
 * @param {string} [status] - Result status ("success" | "failed" | "cancelled")
 * @returns {{ label: string, labelZh: string, cssClass: string, color: string }}
 */
function scoreGrade(score, status) {
  if (status === "failed" || status === "cancelled") {
    return { label: "Failed", labelZh: "\u5931\u8d25", cssClass: "score-failed", color: "var(--danger, #e53935)" };
  }
  if (score >= 80) {
    return { label: "Excellent", labelZh: "\u4f18\u79c0", cssClass: "score-excellent", color: "var(--success, #2e7d32)" };
  }
  if (score >= 65) {
    return { label: "Good", labelZh: "\u826f\u597d", cssClass: "score-good", color: "var(--success, #43a047)" };
  }
  if (score >= 40) {
    return { label: "Fair", labelZh: "\u4e00\u822c", cssClass: "score-fair", color: "var(--warning, #f57c00)" };
  }
  return { label: "Poor", labelZh: "\u8f83\u5dee", cssClass: "score-poor", color: "var(--danger, #e53935)" };
}


/**
 * Render an enhanced empty state with icon, title, message, and dual CTA buttons
 * @param {Object} options
 * @param {string} options.title - Main title text
 * @param {string} options.message - Descriptive message
 * @param {string} [options.primaryCtaText] - Primary CTA button text (e.g., "Try Demo")
 * @param {string} [options.primaryCtaAction] - Primary CTA button action (data attribute)
 * @param {string} [options.secondaryCtaText] - Secondary CTA button text (e.g., "Configure Agents")
 * @param {string} [options.secondaryCtaAction] - Secondary CTA button action (data attribute)
 * @returns {string} HTML string
 */
function renderEmptyState({ title, message, primaryCtaText, primaryCtaAction, secondaryCtaText, secondaryCtaAction }) {
  return `
    <div class="empty-state-content">
      <h3 class="empty-state-title">${escapeHtml(title)}</h3>
      <p class="empty-state-message">${escapeHtml(message)}</p>
      <div class="empty-state-actions">
        ${primaryCtaText ? `<button class="btn btn-primary empty-state-cta" ${primaryCtaAction ? `data-action="${primaryCtaAction}"` : ''}>${escapeHtml(primaryCtaText)}</button>` : ''}
        ${secondaryCtaText ? `<button class="btn btn-ghost empty-state-cta-secondary" ${secondaryCtaAction ? `data-action="${secondaryCtaAction}"` : ''}>${escapeHtml(secondaryCtaText)}</button>` : ''}
      </div>
    </div>
  `;
}

/**
 * Render an error state with warning icon, title, message, and optional retry button
 * @param {Object} options
 * @param {string} options.title - Error title text
 * @param {string} options.message - Error description
 * @param {string} [options.retryText] - Optional retry button text
 * @param {string} [options.retryAction] - Optional retry button action (data attribute)
 * @returns {string} HTML string
 */
function renderErrorState({ title, message, retryText, retryAction }) {
  return `
    <div class="error-state-content">
      <div class="error-state-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h3 class="error-state-title">${escapeHtml(title)}</h3>
      <p class="error-state-message">${escapeHtml(message)}</p>
      ${retryText ? `<button class="btn btn-danger error-state-retry" ${retryAction ? `data-action="${retryAction}"` : ''}>${escapeHtml(retryText)}</button>` : ''}
    </div>
  `;
}

function renderRunInfo(run) {
  const intent = taskIntentSummary(run.task);
  const archivedScoreMode = getArchivedScoreModeLabel(run);
  const activeScoreMode = getScoreModeLabel();
  elements.runInfo.innerHTML = `
    <div class="panel-header">
      <h2>${escapeHtml(t("runInfoTitle"))}</h2>
      <span class="muted">#${escapeHtml(run.runId.slice(-4))}</span>
    </div>
    <p class="muted">${escapeHtml(t("createdAt"))} ${escapeHtml(formatRelativeTime(run.createdAt, localText))}</p>
    <p class="muted">${escapeHtml(t("taskSchema"))} ${escapeHtml(run.task.schemaVersion)}</p>
    <p class="muted"><strong>${escapeHtml(localText("归档评分模式", "Archived Score Mode"))}:</strong> ${escapeHtml(archivedScoreMode)}</p>
    <p class="muted"><strong>${escapeHtml(localText("当前评分模式", "Active Score Mode"))}:</strong> ${escapeHtml(activeScoreMode)}</p>
    ${run.scoreScope ? `<p class="muted"><strong>${escapeHtml(localText("评分范围", "Score Scope"))}:</strong> ${escapeHtml(run.scoreScope)}</p>` : ""}
    ${run.scoreValidityNote ? `<p class="warning-text">${escapeHtml(run.scoreValidityNote)}</p>` : ""}
    ${archivedScoreMode !== activeScoreMode ? `<p class="warning-text">${escapeHtml(localText("当前评分口径与归档结果不同；如需按原始口径复现排序，请恢复归档评分。", "Active scoring differs from the archived run; restore archived scoring to reproduce the original ranking lens."))}</p>` : ""}
    <div class="run-info-actions">
      <button type="button" class="archive-score-restore-btn" data-role="restore-archived-score" data-run-id="${escapeHtml(run.runId)}">
        <svg class="icon"><use href="#icon-archive"/></svg>
        ${escapeHtml(localText("恢复归档评分口径", "Restore Archived Scoring"))}
      </button>
    </div>
    <p class="muted"><strong>${escapeHtml(localText("目标", "Objective"))}:</strong> ${escapeHtml(intent.objective || "n/a")}</p>
    <p class="muted"><strong>${escapeHtml(localText("Judge 依据", "Judge Rationale"))}:</strong> ${escapeHtml(intent.rationale || "n/a")}</p>
    <p class="warning-text">${escapeHtml(baselineTaskWarning(run.task, t))}</p>
  `;
  setHidden(elements.runInfo, false);
}


function renderTaskBrief(run) {
  const intent = taskIntentSummary(run.task);
  const repoTypes = intent.repoTypes && intent.repoTypes !== "generic" ? intent.repoTypes : "generic";
  const resultCount = run.results.length;
  const variantLabels = run.results.map((result) => resultLabel(result)).join(", ");
  const badges = taskMeaningBadges(run.task, t);

  elements.taskBrief.innerHTML = `
    <div class="panel-header">
      <h3>${escapeHtml(localText("这次 benchmark 在测什么", "What this run actually measures"))}</h3>
      <span class="muted">${escapeHtml(resultCount)} ${escapeHtml(localText("个 variants", "variants"))}</span>
    </div>
    <div class="badge-row">
      ${badges.map((badge) => `<span class="meaning-badge">${escapeHtml(badge)}</span>`).join("")}
    </div>
    <article class="brief-card brief-focus-card">
      <p class="metric-label">${escapeHtml(localText("如何解读这次结果", "How to read this result"))}</p>
      <p>${escapeHtml(runFocusLine(run))}</p>
    </article>
    <div class="brief-grid">
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("目标", "Objective"))}</p>
        <p>${escapeHtml(intent.objective || run.task.description || "n/a")}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("Judge 依据", "Judge Rationale"))}</p>
        <p>${escapeHtml(intent.rationale || "n/a")}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("适用仓库", "Repo Types"))}</p>
        <p>${escapeHtml(repoTypes)}</p>
      </article>
      <article class="brief-card">
        <p class="metric-label">${escapeHtml(localText("参与对比的 Variants", "Compared Variants"))}</p>
        <p>${escapeHtml(variantLabels || "n/a")}</p>
      </article>
    </div>
    <p class="warning-text">${escapeHtml(baselineTaskWarning(run.task, t))}</p>
  `;
}

function renderRunListItem(run) {
  const active = run.runId === state.selectedRunId ? "active" : "";
  const successCount = run.results.filter((result) => result.status === "success").length;
  const hasMarkdown = state.markdownByRunId.has(run.runId);

  return `
    <div class="run-button ${active}" role="button" tabindex="0" data-run-id="${escapeHtml(run.runId)}" aria-label="${escapeHtml(run.task.title)}">
      <div class="run-actions">
        <button type="button" class="run-select-btn" data-role="select-run" data-run-id="${escapeHtml(run.runId)}" title="${escapeHtml(localText("打开这个 run", "Open this run"))}" aria-label="${escapeHtml(localText("打开这个 run", "Open this run"))}">
          <svg class="icon"><use href="#icon-open"/></svg>
          ${escapeHtml(localText("查看", "Open"))}
        </button>
        <button type="button" class="run-action-btn" data-role="export-run" data-run-id="${escapeHtml(run.runId)}" title="${escapeHtml(localText("导出 JSON", "Export JSON"))}" aria-label="${escapeHtml(localText("导出 JSON", "Export JSON"))}">
          <svg class="icon"><use href="#icon-export"/></svg>
          ${escapeHtml(localText("导出", "Export"))}
        </button>
        <button type="button" class="run-action-btn" data-role="delete-run" data-run-id="${escapeHtml(run.runId)}" title="${escapeHtml(localText("从列表移除", "Remove from list"))}" aria-label="${escapeHtml(localText("从列表移除", "Remove from list"))}">
          <svg class="icon"><use href="#icon-delete"/></svg>
          ${escapeHtml(localText("移除", "Remove"))}
        </button>
      </div>
      <strong>${escapeHtml(run.task.title)}</strong>
      <div class="meta">${escapeHtml(formatRelativeTime(run.createdAt, localText))}</div>
      <div class="meta">${successCount}/${run.results.length} ${localText("成功", "success")}</div>
      <div class="meta">${hasMarkdown ? escapeHtml(t("linkedMarkdown")) : escapeHtml(t("jsonOnly"))}</div>
    </div>
  `;
}

function renderRunList() {
  const query = state.runSearchQuery || "";
  const filteredRuns = query
    ? state.runs.filter((run) => {
        const title = (run.task.title || "").toLowerCase();
        const runId = (run.runId || "").toLowerCase();
        return title.includes(query) || runId.includes(query);
      })
    : state.runs;

  elements.runCount.textContent = `${filteredRuns.length} / ${state.runs.length}`;

  if (state.runs.length === 0) {
    if (runListVirtual) {
      runListVirtual.destroy();
      runListVirtual = null;
    }
    elements.runList.className = "run-list empty-state";
    elements.runList.textContent = t("noRunsLoaded");
    return;
  }

  if (filteredRuns.length === 0) {
    if (runListVirtual) {
      runListVirtual.destroy();
      runListVirtual = null;
    }
    elements.runList.className = "run-list empty-state";
    elements.runList.innerHTML = `<p>${escapeHtml(t("noRunsMatchSearch") || "No runs match your search.")}</p>`;
    return;
  }

  elements.runList.className = "run-list";

  // 虚拟滚动：列表项超过阈值时启用
  if (filteredRuns.length > VIRTUAL_LIST_THRESHOLD) {
    if (!runListVirtual) {
      runListVirtual = createVirtualList(elements.runList, {
        itemHeight: 80,
        overscan: 5,
        className: 'run-list-virtual',
        role: 'listbox'
      });
    }
    runListVirtual.setItems(filteredRuns, renderRunListItem);
    // 搜索/过滤后重置滚动位置
    if (query) {
      runListVirtual.scrollToTop();
    }
  } else {
    // 列表较短时销毁虚拟滚动，直接渲染
    if (runListVirtual) {
      runListVirtual.destroy();
      runListVirtual = null;
    }
    elements.runList.innerHTML = filteredRuns.map(renderRunListItem).join("");
  }
}

function translateFairComparisonReason(reason, t) {
  switch (reason) {
    case "different-task-pack":
      return t("runCompareReasonDifferentTaskPack");
    case "different-judge-logic":
      return t("runCompareReasonDifferentJudgeLogic");
    case "different-repo-baseline":
      return t("runCompareReasonDifferentRepoBaseline");
    case "missing-core-data":
    default:
      return t("runCompareReasonMissingCoreData");
  }
}

function renderExcludedRuns(excludedRows, t, escapeHtml) {
  if (excludedRows.length === 0) return "";
  return `
    <section class="compare-excluded-block">
      <h4>${escapeHtml(t("runCompareExcludedTitle"))}</h4>
      <p class="muted">${escapeHtml(t("runCompareExcludedDescription"))}</p>
      <ul class="compare-excluded-list">
        ${excludedRows.map((row) => `
          <li>
            <strong>${escapeHtml(row.run.task.title)}</strong>
            <code>${escapeHtml(row.run.runId)}</code>
            <p>${escapeHtml(row.reasons.map((reason) => translateFairComparisonReason(reason, t)).join(" "))}</p>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderRunCompareTable() {
  if (state.runs.length === 0) {
    elements.runCompareTable.innerHTML = renderEmptyState({
      title: t("noRunsLoaded"),
      message: t("noRunsLoadedHint"),
      primaryCtaText: t("tryDemo"),
      primaryCtaAction: "load-demo",
      secondaryCtaText: t("loadData")
    });
    return;
  }

  const taskTitle = runCompareFilters.scope === "current-task" ? state.run?.task.title ?? null : null;
  const { comparableRows, excludedRows } = getRunCompareRows(state.runs, {
    taskTitle,
    sort: runCompareFilters.sort,
    markdownByRunId: state.markdownByRunId,
    currentRunId: state.selectedRunId
  });

  if (comparableRows.length === 0) {
    elements.runCompareTable.innerHTML =
      renderEmptyState({
        title: t("runCompareNoComparable"),
        message: t("runCompareNoComparableHint")
      }) +
      renderExcludedRuns(excludedRows, t, escapeHtml);
    return;
  }

  const selectionTrust = getSelectionTrustSummary({ comparableRuns: comparableRows.map(r => r.run), excludedRuns: excludedRows.map(r => r.run), runs: state.runs });
  const tableHtml = `
    <p class="muted run-compare-fair-note">${escapeHtml(comparableRows.length === 1 ? t("runCompareSingleComparable") : t("runCompareFairOnlyDescription"))}</p>
    ${selectionTrust.level === "caution" ? `<p class="trust-hint warning-text">${escapeHtml(t("trustSelectionCautionExcluded"))}</p>` : ""}
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(localText("运行", "Run"))}</th>
          <th>${escapeHtml(localText("任务", "Task"))}</th>
          <th>${escapeHtml(localText("创建时间", "Created"))}</th>
          <th>${escapeHtml(t("metrics.success"))}</th>
          <th>${escapeHtml(t("metrics.agents"))}</th>
          <th>${escapeHtml(t("metrics.tokens"))}</th>
          <th>${escapeHtml(t("metrics.knownCost"))}</th>
          <th>${escapeHtml(localText("Markdown", "Markdown"))}</th>
        </tr>
      </thead>
      <tbody>
        ${comparableRows
          .map(({ run, summary }) => {
            const isActive = run.runId === state.selectedRunId ? "active" : "";
            return `
              <tr class="${isActive}" data-compare-run-id="${escapeHtml(run.runId)}" tabindex="0" role="button" aria-label="${escapeHtml(localText("打开 run", "Open run") + " " + run.runId)}">
                <td><code>#${escapeHtml(run.runId.slice(-4))}</code></td>
                <td>${escapeHtml(run.task.title)}</td>
                <td>${escapeHtml(formatRelativeTime(run.createdAt, localText))}</td>
                <td>${escapeHtml(String(summary.successCount))}/${escapeHtml(String(summary.totalAgents))}</td>
                <td>${escapeHtml(String(summary.totalAgents))}</td>
                <td>${escapeHtml(String(summary.totalTokens))}</td>
                <td>$${escapeHtml(summary.knownCost.toFixed(2))}</td>
                <td>${state.markdownByRunId.has(run.runId) ? escapeHtml(t("linkedMarkdown")) : escapeHtml(localText("无", "none"))}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  elements.runCompareTable.innerHTML = tableHtml + renderExcludedRuns(excludedRows, t, escapeHtml);
}

function renderRunDiffTableV2() {
  if (!state.run) {
    elements.runDiffTable.innerHTML = "";
    return;
  }

  const { previousRun, rows } = getRunToRunAgentDiff(state.runs, state.run);
  if (!previousRun || rows.length === 0) {
    elements.runDiffTable.innerHTML = renderEmptyState({
      title: localText("没有可对比的历史 run。", "No previous comparable run found."),
      message: localText("尝试加载更多历史运行以进行对比。", "Try loading more historical runs for comparison."),
      primaryCtaText: t("loadData")
    });
    return;
  }

  elements.runDiffTable.innerHTML = `
    <p class="muted">${escapeHtml(localText("对比", "Compared to"))}: <code>${escapeHtml(previousRun.runId)}</code></p>
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(localText("Variant", "Variant"))}</th>
          <th>${escapeHtml(localText("版本变化", "Version Change"))}</th>
          <th>${escapeHtml(localText("状态变化", "Status Change"))}</th>
          <th>${escapeHtml(localText("耗时变化", "Duration Δ"))}</th>
          <th>${escapeHtml(localText("Token 变化", "Token Δ"))}</th>
          <th>${escapeHtml(localText("成本变化", "Cost Δ"))}</th>
          <th>${escapeHtml(localText("Judge 变化", "Judge Δ"))}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr data-run-diff-agent-id="${escapeHtml(row.agentId)}" class="${row.agentId === state.selectedAgentId ? "active" : ""}" tabindex="0" role="button" aria-label="${escapeHtml(localText("选择 agent", "Select agent") + " " + (row.currentResult?.displayLabel ?? row.previousResult?.displayLabel ?? row.agentId))}">
            <td>${escapeHtml(row.currentResult?.displayLabel ?? row.previousResult?.displayLabel ?? row.agentId)}</td>
            <td>${escapeHtml(row.versionChange ?? "-")}</td>
            <td>${escapeHtml(row.statusChange)}</td>
            <td>${row.durationDeltaMs !== null ? escapeHtml(formatDelta(row.durationDeltaMs, "ms")) : "-"}</td>
            <td>${row.tokenDelta !== null ? escapeHtml(formatDelta(row.tokenDelta)) : "-"}</td>
            <td>${row.costDelta !== null ? escapeHtml(formatDelta(row.costDelta, "$")) : "-"}</td>
            <td>${row.judgeDelta !== null ? escapeHtml(formatDelta(row.judgeDelta)) : "-"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}


function renderAgentTrendTableV2(run) {
  if (!run || !state.selectedAgentId) {
    elements.agentTrendTable.innerHTML = "";
    return;
  }

  const rows = getAgentTrendRows(state.runs, run, state.selectedAgentId);
  if (rows.length === 0) {
    elements.agentTrendTable.innerHTML = renderEmptyState({
      title: localText("没有趋势数据。", "No trend data available."),
      message: localText("加载多次运行以查看 agent 性能趋势。", "Load multiple runs to see agent performance trends over time."),
      primaryCtaText: t("loadData")
    });
    return;
  }

  elements.agentTrendTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(localText("Run", "Run"))}</th>
          <th>${escapeHtml(localText("版本", "Version"))}</th>
          <th>${escapeHtml(localText("状态", "Status"))}</th>
          <th>${escapeHtml(localText("耗时", "Duration"))}</th>
          <th>${escapeHtml(localText("Tokens", "Tokens"))}</th>
          <th>${escapeHtml(localText("成本", "Cost"))}</th>
          <th>${escapeHtml(localText("Judge 变化", "Judge Δ"))}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr data-agent-trend-run-id="${escapeHtml(row.run.runId)}" class="${row.run.runId === state.selectedRunId ? "active" : ""}" tabindex="0" role="button" aria-label="${escapeHtml(localText("打开 run", "Open run") + " " + row.run.runId)}">
            <td><code>#${escapeHtml(row.run.runId.slice(-4))}</code></td>
            <td>${escapeHtml(row.runtime?.version ?? "—")}</td>
            <td><span class="status-badge ${row.result.status === "success" ? "status-success" : "status-failed"}">${escapeHtml(translateStatus(row.result.status, t))}</span></td>
            <td>${escapeHtml(formatDuration(row.result.durationMs))}</td>
            <td>${typeof row.result.tokenUsage === "number" && !Number.isNaN(row.result.tokenUsage) ? row.result.tokenUsage.toLocaleString() : "—"}</td>
            <td>${row.result.costKnown ? "$" + row.result.estimatedCostUsd.toFixed(4) : "n/a"}</td>
            <td>${row.judgeDelta !== null ? escapeHtml(formatDelta(row.judgeDelta)) : "-"}</td>
          </tr>
        `).join("")}
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
            <h3>${escapeHtml(resultLabel(preflight))}</h3>
            <span class="status-badge ${statusClass(preflight.status)}">${escapeHtml(translateStatus(preflight.status, t))}</span>
          </div>
          <p>${escapeHtml(preflight.summary)}</p>
          <p class="muted">${escapeHtml(localText("基础 Agent", "Base Agent"))}: ${escapeHtml(baseAgentLabel(preflight))}</p>
          <p class="muted">${escapeHtml(localText("Provider", "Provider"))}: ${escapeHtml(runtimeIdentity(preflight).provider)} | ${escapeHtml(localText("类型", "Kind"))}: ${escapeHtml(runtimeIdentity(preflight).providerKind)}</p>
          <p class="muted">${escapeHtml(localText("模型 / 推理", "Model / Reasoning"))}: ${escapeHtml(runtimeIdentity(preflight).model)} / ${escapeHtml(runtimeIdentity(preflight).reasoning)}</p>
          <p class="muted">${escapeHtml(localText("版本", "Version"))}: ${escapeHtml(runtimeIdentity(preflight).version)}</p>
          <p class="muted">${escapeHtml(localText("可信度", "Verification"))}: ${escapeHtml(runtimeVerificationLabel(preflight))}</p>
          <p class="muted">${escapeHtml(localText("支持层级", "Tier"))}: ${escapeHtml(preflight.capability.supportTier)} | ${escapeHtml(localText("Trace 路径", "Trace"))}: ${escapeHtml(preflight.capability.traceRichness)}</p>
          <p class="muted">${escapeHtml(localText("调用方式", "Invocation"))}: ${escapeHtml(preflight.capability.invocationMethod)}</p>
          <p class="muted">${escapeHtml(t("metrics.tokens"))}: ${escapeHtml(preflight.capability.tokenAvailability)} | ${escapeHtml(localText("成本", "Cost"))}: ${escapeHtml(preflight.capability.costAvailability)}</p>
          ${
            preflight.capability.authPrerequisites.length > 0
              ? `<p class="muted">${escapeHtml(localText("鉴权要求", "Auth"))}: ${escapeHtml(preflight.capability.authPrerequisites.join("; "))}</p>`
              : ""
          }
          ${
            preflight.capability.knownLimitations.length > 0
              ? `<p class="muted">${escapeHtml(localText("限制", "Limitations"))}: ${escapeHtml(preflight.capability.knownLimitations.join("; "))}</p>`
              : ""
          }
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


let agentListVirtual = null;

function renderAgentList(run) {
  elements.agentCount.textContent = String(run.results.length);
  elements.agentList.classList.remove("empty-state");

  // Clean up previous virtual list instance
  if (agentListVirtual) {
    agentListVirtual.destroy();
    agentListVirtual = null;
  }

  if (run.results.length > VIRTUAL_LIST_THRESHOLD) {
    // Use virtual scrolling for large agent lists
    agentListVirtual = createVirtualList(elements.agentList, {
      itemHeight: 64,
      overscan: 5,
      className: 'agent-list virtual-list',
      role: 'listbox'
    });
    agentListVirtual.setItems(run.results, (result) => {
      const active = recordKey(result) === state.selectedAgentId ? "active" : "";
      const runtime = runtimeIdentity(result);
      return `
        <button class="agent-button ${active}" type="button" data-agent-id="${escapeHtml(recordKey(result))}" style="width:100%;height:100%;text-align:left;">
          <div class="row">
            <strong>${escapeHtml(resultLabel(result))}</strong>
            <span class="status-badge ${statusClass(result.status)}">${escapeHtml(translateStatus(result.status, t))}</span>
          </div>
          <div class="meta">
            ${escapeHtml(runtime.provider)} | ${escapeHtml(runtime.model)} | ${escapeHtml(runtime.version)} | ${escapeHtml(formatDuration(result.durationMs))} | ${escapeHtml(formatCost(result))}
          </div>
        </button>
      `;
    });
  } else {
    // Standard rendering for small lists
    elements.agentList.innerHTML = run.results
      .map((result) => {
        const active = recordKey(result) === state.selectedAgentId ? "active" : "";
        const runtime = runtimeIdentity(result);
        return `
          <button class="agent-button ${active}" type="button" data-agent-id="${escapeHtml(recordKey(result))}">
            <div class="row">
              <strong>${escapeHtml(resultLabel(result))}</strong>
              <span class="status-badge ${statusClass(result.status)}">${escapeHtml(translateStatus(result.status, t))}</span>
            </div>
            <div class="meta">
              ${escapeHtml(runtime.provider)} | ${escapeHtml(runtime.model)} | ${escapeHtml(runtime.version)} | ${escapeHtml(formatDuration(result.durationMs))} | ${escapeHtml(formatCost(result))}
            </div>
          </button>
        `;
      })
      .join("");
  }
}


function populateJudgeFilters(run) {
  const judgeTypes = Array.from(
    new Set(run.results.flatMap((result) => result.judgeResults.map((judge) => judge.type)))
  ).sort();

  const currentType = judgeFilters.type;
  elements.judgeTypeFilter.innerHTML = [
    `<option value="all">${escapeHtml(t("judgeTypeAll"))}</option>`,
    ...judgeTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(formatJudgeType(type, t))}</option>`)
  ].join("");
  elements.judgeTypeFilter.value = judgeTypes.includes(currentType) ? currentType : "all";
}

function renderMarkdownPanel() {
  const markdown =
    (state.run && state.markdownByRunId.get(state.run.runId)) ??
    state.standaloneMarkdown ??
    null;

  if (!markdown) {
    setHidden(elements.markdownPanel, true);
    elements.markdownStatus.textContent = localText("未加载", "Not loaded");
    elements.markdownContent.innerHTML = "";
    return;
  }

  setHidden(elements.markdownPanel, false);
  elements.markdownStatus.textContent = state.run && state.markdownByRunId.has(state.run.runId)
    ? localText("已关联当前 run", "Linked to selected run")
    : localText("独立 markdown", "Standalone markdown");
  elements.markdownHighlights.innerHTML = state.run
    ? `
        <section class="detail-card">
          <h4>${escapeHtml(localText("重点摘要", "Highlights"))}</h4>
          <pre>${escapeHtml(buildShareCard(state.run, { scoreWeights: state.scoreWeights, scoreModeLabel: getScoreModeLabel() }))}</pre>
        </section>
      `
    : renderEmptyState({
        title: localText("先加载一个 run，才能看到摘要亮点。", "Load a run to see summary highlights."),
        message: localText("选择一个运行记录以查看重点摘要和分享卡片。", "Select a run to see highlights and share card."),
        primaryCtaText: t("tryDemo"),
        primaryCtaAction: "load-demo"
      });
  elements.markdownContent.innerHTML = renderMarkdownBlock(markdown);
}

function generateVerdictSummary(run) {
  const summary = summarizeRun(run);
  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const best = verdict.bestAgent;
  const fastest = verdict.fastest;
  const cheapest = verdict.lowestKnownCost;

  if (summary.successCount === 0) {
    return localText(
      `本次所有 ${summary.totalAgents} 个 agent 均未通过测试。`,
      `All ${summary.totalAgents} agent(s) failed this benchmark.`
    );
  }

  const bestName = best ? resultLabel(best) : "n/a";
  const passedJudges = best ? best.judgeResults.filter((j) => j.success).length : 0;
  const totalJudges = best ? best.judgeResults.length : 0;
  const duration = best ? formatDuration(best.durationMs) : "n/a";

  const extras = [];
  if (fastest && recordKey(fastest) === recordKey(best)) {
    extras.push(localText("最快", "fastest"));
  }
  if (cheapest && recordKey(cheapest) === recordKey(best)) {
    extras.push(localText("最省", "cheapest"));
  }
  const extrasText = extras.length > 0 ? localText(`，同时也是${extras.join("、")}`, `, also ${extras.join(" & ")}`) : "";

  if (summary.successCount === summary.totalAgents) {
    return localText(
      `本次结果：${bestName} 综合最佳，通过率 ${passedJudges}/${totalJudges}，耗时 ${duration}${extrasText}。全部 ${summary.totalAgents} 个 agent 通过。`,
      `Result: ${bestName} is the overall best with ${passedJudges}/${totalJudges} judges passed in ${duration}${extrasText}. All ${summary.totalAgents} agent(s) passed.`
    );
  }

  return localText(
    `本次 ${summary.successCount}/${summary.totalAgents} 通过，${bestName} 表现最佳（${passedJudges}/${totalJudges}，${duration}）${extrasText}。`,
    `${summary.successCount}/${summary.totalAgents} passed. ${bestName} performed best (${passedJudges}/${totalJudges}, ${duration})${extrasText}.`
  );
}

function renderVerdictHero(run) {
  const summary = summarizeRun(run);
  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const trustSummary = getRunTrustSummary(run);
  const best = verdict.bestAgent;
  const fastest = verdict.fastest;
  const cheapest = verdict.lowestKnownCost;
  const badges = taskMeaningBadges(run.task, t);
  const verdictText = generateVerdictSummary(run);

  const badgeHtml = badges.map((b) => `<span class="meaning-badge">${escapeHtml(b)}</span>`).join("");

  let winnerHtml;
  if (best && best.status === "success") {
    const runtime = runtimeIdentity(best);
    const passedJudges = best.judgeResults.filter((j) => j.success).length;
    const totalJudges = best.judgeResults.length;
    const scoreReasons = getCompositeScoreReasons(best, run, state.scoreWeights)
      .map((reason) => {
        switch (reason) {
          case "tests":
            return localText("测试最强", "Best tests");
          case "lint":
            return localText("Lint 最干净", "Cleanest lint");
          case "precision":
            return localText("改动最精准", "Most precise diff");
          case "judges":
            return localText("Judge 最稳", "Strongest judges");
          case "duration":
            return localText("速度最快", "Fastest");
          case "cost":
            return localText("成本最低", "Lowest cost");
          default:
            return reason;
        }
      })
      .slice(0, 3);
    const tags = [];
    tags.push(`<span class="compare-tag compare-tag-best">${escapeHtml(localText("综合最佳", "Overall Best"))}</span>`);
    if (fastest && recordKey(fastest) === recordKey(best)) {
      tags.push(`<span class="compare-tag compare-tag-fast">${escapeHtml(localText("最快", "Fastest"))}</span>`);
    }
    if (cheapest && recordKey(cheapest) === recordKey(best)) {
      tags.push(`<span class="compare-tag compare-tag-cheap">${escapeHtml(localText("最省", "Cheapest"))}</span>`);
    }

    winnerHtml = `
      <div class="winner-card">
        <span class="winner-eyebrow">
          <svg class="icon" aria-hidden="true"><use href="#icon-trophy"/></svg>
          ${escapeHtml(localText("综合最佳 Agent", "Overall Best Agent"))}
        </span>
        <span class="winner-name">${escapeHtml(resultLabel(best))}</span>
        ${runtime.model ? `<span class="winner-model">${escapeHtml(runtime.model)} · ${escapeHtml(runtime.reasoning)}</span>` : ""}
        <div class="winner-stats">
          <div class="winner-stat">
            <span class="winner-stat-label">${escapeHtml(localText("综合分", "Composite Score"))}</span>
            <span class="winner-stat-value">${escapeHtml(formatCompositeScore(best, run, state.scoreWeights))}</span>
          </div>
          <div class="winner-stat">
            <span class="winner-stat-label">${escapeHtml(localText("通过率", "Pass Rate"))}</span>
            <span class="winner-stat-value">${passedJudges}/${totalJudges}</span>
          </div>
          <div class="winner-stat">
            <span class="winner-stat-label">${escapeHtml(localText("测试", "Tests"))}</span>
            <span class="winner-stat-value">${escapeHtml(formatTestMetric(best))}</span>
          </div>
          <div class="winner-stat">
            <span class="winner-stat-label">${escapeHtml(localText("耗时", "Duration"))}</span>
            <span class="winner-stat-value">${escapeHtml(formatDuration(best.durationMs))}</span>
          </div>
          <div class="winner-stat">
            <span class="winner-stat-label">${escapeHtml(localText("成本", "Cost"))}</span>
            <span class="winner-stat-value">${escapeHtml(formatCost(best))}</span>
          </div>
          <div class="winner-stat">
            <span class="winner-stat-label">${escapeHtml(localText("令牌数", "Tokens"))}</span>
            <span class="winner-stat-value">${escapeHtml(String(best.tokenUsage ?? "N/A"))}</span>
          </div>
        </div>
        ${scoreReasons.length > 0 ? `<p class="muted">${escapeHtml(localText("领先原因", "Why it leads"))}: ${escapeHtml(scoreReasons.join(" · "))}</p>` : ""}
        <div class="winner-tags">${tags.join("")}</div>
      </div>
    `;
  } else {
    winnerHtml = `
      <div class="no-winner-card">
        <span>${escapeHtml(localText("无通过的 Agent", "No Passing Agent"))}</span>
        <span class="muted" style="font-weight:400;font-size:0.85rem">${escapeHtml(localText("所有 agent 均未通过本次测试", "All agents failed this benchmark"))}</span>
      </div>
    `;
  }

  elements.verdictHero.innerHTML = `
    <div class="verdict-hero">
      <div class="verdict-summary">
        <div class="verdict-badges">${badgeHtml}</div>
        <p class="verdict-text">${escapeHtml(verdictText)}</p>
        <p class="score-scope-hint muted">${escapeHtml(localText("⚠️ 分数仅用于本次 run 内部比较，不代表绝对排名。", "⚠️ Scores compare variants within this run only — not absolute rankings."))}</p>
        <p class="trust-hint ${trustSummary.level === "caution" ? "warning-text" : "muted"}">${escapeHtml(trustSummary.level === "strong" ? t("trustRunStrong") : t("trustRunCaution"))}</p>
        <div class="stats-row">
          <div class="stat-item">
            <span class="stat-label">${escapeHtml(t("metrics.agents"))}</span>
            <span class="stat-value">${summary.totalAgents}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">${escapeHtml(t("metrics.success"))}</span>
            <span class="stat-value success">${summary.successCount}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">${escapeHtml(t("metrics.failed"))}</span>
            <span class="stat-value${summary.failedCount > 0 ? " danger" : ""}">${summary.failedCount}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">${escapeHtml(localText("令牌数", "Tokens"))}</span>
            <span class="stat-value">${typeof summary.totalTokens === "number" && !Number.isNaN(summary.totalTokens) ? summary.totalTokens.toLocaleString() : "—"}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">${escapeHtml(t("metrics.knownCost"))}</span>
            <span class="stat-value">${typeof summary.knownCost === "number" && !Number.isNaN(summary.knownCost) ? "$" + summary.knownCost.toFixed(2) : "—"}</span>
          </div>
        </div>
      </div>
      ${winnerHtml}
    </div>
  `;
}

function renderComparisonBars(run) {
  const results = getCompareResults(run, { sort: "status", scoreWeights: state.scoreWeights });
  if (results.length < 2) {
    elements.comparisonBars.innerHTML = "";
    return;
  }

  const maxDuration = Math.max(...results.map((r) => r.durationMs || 0), 1);
  const maxCost = Math.max(...results.filter((r) => r.costKnown).map((r) => r.estimatedCostUsd), 0.01);
  const maxPrecision = Math.max(...results.map((r) => Math.max(diffPrecisionScore(r), 0)), 0.01);

  function barRows(getValue, maxVal, formatFn, colorFn, tooltipFn) {
    return results.map((r) => {
      const val = getValue(r);
      const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
      const color = colorFn(r);
      const key = recordKey(r);
      const activeClass = key === state.selectedAgentId ? " bar-row-active" : "";
      const tooltip = tooltipFn(r);
      return `
        <div class="bar-row${activeClass}" tabindex="0" role="button" data-bar-agent-id="${escapeHtml(key)}" data-tooltip="${escapeHtml(tooltip)}">
          <span class="bar-label" title="${escapeHtml(resultLabel(r))}">${escapeHtml(resultLabel(r))}</span>
          <div class="bar-track"><div class="bar-fill ${color}" style="width:${pct}%"></div></div>
          <span class="bar-value">${escapeHtml(formatFn(r))}</span>
        </div>
      `;
    }).join("");
  }

  const statusColor = (r) => r.status === "success" ? "success" : "danger";

  const passRateRows = results.map((r) => {
    const total = r.judgeResults.length;
    const passed = r.judgeResults.filter((j) => j.success).length;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const color = pct === 100 ? "success" : pct >= 50 ? "warning" : "danger";
    const key = recordKey(r);
    const activeClass = key === state.selectedAgentId ? " bar-row-active" : "";
    return `
      <div class="bar-row${activeClass}" tabindex="0" role="button" data-bar-agent-id="${escapeHtml(key)}" data-tooltip="${escapeHtml(resultLabel(r))}: ${passed}/${total} (${pct}%)">
        <span class="bar-label" title="${escapeHtml(resultLabel(r))}">${escapeHtml(resultLabel(r))}</span>
        <div class="bar-track"><div class="bar-fill ${color}" style="width:${pct}%"></div></div>
        <span class="bar-value">${passed}/${total}</span>
      </div>
    `;
  }).join("");

  const durationRows = barRows(
    (r) => r.durationMs || 0,
    maxDuration,
    (r) => formatDuration(r.durationMs),
    statusColor,
    (r) => `${resultLabel(r)}: ${formatDuration(r.durationMs)}`
  );

  const costRows = barRows(
    (r) => r.costKnown ? r.estimatedCostUsd : 0,
    maxCost,
    (r) => formatCost(r),
    statusColor,
    (r) => `${resultLabel(r)}: ${formatCost(r)}`
  );

  const precisionRows = barRows(
    (r) => Math.max(diffPrecisionScore(r), 0),
    maxPrecision,
    (r) => formatDiffPrecisionMetric(r),
    statusColor,
    (r) => `${resultLabel(r)}: ${formatDiffPrecisionMetric(r)}`
  );

  elements.comparisonBars.innerHTML = `
    <div class="comparison-bars">
      <div class="bar-chart">
        <div class="bar-chart-title">${escapeHtml(localText("Judge 通过率", "Judge Pass Rate"))}</div>
        ${passRateRows}
      </div>
      <div class="bar-chart">
        <div class="bar-chart-title">${escapeHtml(localText("耗时", "Duration"))}</div>
        ${durationRows}
      </div>
      <div class="bar-chart">
        <div class="bar-chart-title">${escapeHtml(localText("成本", "Cost"))}</div>
        ${costRows}
      </div>
      <div class="bar-chart">
        <div class="bar-chart-title">${escapeHtml(localText("Diff 精准度", "Diff Precision"))}</div>
        ${precisionRows}
      </div>
      <div id="score-bar-chart" class="score-chart-container"></div>
      <div id="score-comparison-chart" class="score-chart-container"></div>
      <div id="score-radar-chart" class="score-chart-container"></div>
    </div>
  `;

  // Render new SVG bar chart for score dimensions
  const scoreBarContainer = elements.comparisonBars.querySelector("#score-bar-chart");
  if (scoreBarContainer && state.scoreWeights) {
    const chartData = [{
      group: getScoreModeLabel ? getScoreModeLabel() : "Current",
      dimensions: Object.entries(state.scoreWeights).map(([name, weight]) => ({
        name,
        value: weight * 100,
        weight
      }))
    }];
    renderBarChart(scoreBarContainer, chartData, { width: 600, height: 200 });
  }

  // Render comparison bar chart across agents
  const comparisonContainer = elements.comparisonBars.querySelector("#score-comparison-chart");
  if (comparisonContainer && results.length > 0 && state.scoreWeights) {
    const dimKeys = Object.keys(state.scoreWeights).filter(k => state.scoreWeights[k] > 0);
    const agentsData = results.slice(0, 6).map(r => ({
      label: resultLabel(r),
      dimensions: dimKeys.map(key => {
        let value = 0;
        if (key === 'status') value = r.status === 'success' ? 100 : 0;
        else if (key === 'tests') value = (r.judgeResults?.filter(j => j.success).length / Math.max(r.judgeResults?.length || 1, 1)) * 100;
        else if (key === 'duration') value = Math.max(0, 100 - Math.min((r.durationMs || 0) / 60000, 1) * 100);
        else if (key === 'cost') value = r.estimatedCostUsd ? Math.max(0, 100 - Math.min(r.estimatedCostUsd, 1) * 100) : 50;
        else if (key === 'precision') value = Math.max(diffPrecisionScore(r), 0) * 100;
        else if (key === 'lint') value = 100; // placeholder
        else value = (state.scoreWeights[key] || 0) * 100;
        return { key, name: key, value, max: 100, weight: state.scoreWeights[key] };
      })
    }));
    renderComparisonBarChart(comparisonContainer, agentsData, null, {
      width: 600,
      title: t('chartComparisonTitle'),
      animation: true
    });
  }

  // Render radar chart for agent comparison
  const radarContainer = elements.comparisonBars.querySelector("#score-radar-chart");
  if (radarContainer && results.length > 0) {
    const radarData = results.slice(0, 3).map(r => ({
      name: resultLabel(r),
      dimensions: [
        { name: t("scoreWeightStatus"), value: r.status === "success" ? 100 : 0 },
        { name: t("scoreWeightTests"), value: r.judgeResults.filter(j => j.success).length / Math.max(r.judgeResults.length, 1) * 100 },
        { name: t("scoreWeightDuration"), value: Math.max(0, 100 - (r.durationMs || 0) / 1000) },
        { name: t("scoreWeightPrecision"), value: Math.max(diffPrecisionScore(r), 0) * 100 }
      ]
    }));
    if (radarData.length > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 300;
      radarContainer.appendChild(canvas);
      renderRadarChart(canvas, radarData[0], { width: 300, height: 300 });
    }
  }
}

function renderFailures(run) {
  const failed = run.results.filter((r) => r.status === "failed");
  if (failed.length === 0) {
    setHidden(elements.failuresSection, true);
    return;
  }

  setHidden(elements.failuresSection, false);
  const items = failed.map((r) => {
    const failedJudges = r.judgeResults.filter((j) => !j.success);
    const judgeHtml = failedJudges.length > 0
      ? `<div class="failure-judges">${failedJudges.map((j) => `<span class="failure-judge">${escapeHtml(j.label || j.id)}</span>`).join("")}</div>`
      : "";
    return `
      <div class="failure-item">
        <div class="failure-agent">${escapeHtml(resultLabel(r))}</div>
        <div class="failure-reason">${escapeHtml(r.summary || localText("未知原因", "Unknown reason"))}</div>
        ${judgeHtml}
      </div>
    `;
  }).join("");

  elements.failuresSection.innerHTML = `
    <div class="failures-section">
      <div class="failures-title">${escapeHtml(localText("失败与风险", "Failures & Risks"))}</div>
      ${items}
    </div>
  `;
}

function renderCompareTableV2(run) {
  const results = getCompareResults(run, { ...compareFilters, scoreWeights: state.scoreWeights });
  const sortHintMap = {
    status: localText("先按状态分层，再把更快的结果排前面。", "Sorted by status first, then by fastest duration."),
    duration: localText("按耗时排序，越快越靠前。", "Sorted by fastest variants first."),
    tokens: localText("按 token 用量排序，越高越靠前。", "Sorted by highest token usage first."),
    cost: localText("按已知成本排序，越低越靠前。", "Sorted by lowest known cost first."),
    changed: localText("按改动文件数排序，越多越靠前。", "Sorted by most changed files first."),
    judges: localText("按 judge 通过率排序，越高越靠前。", "Sorted by highest judge pass rate first."),
    precision: localText("按 diff 精准度排序，越高越靠前。", "Sorted by highest diff precision first.")
  };
  elements.compareSortHint.textContent = sortHintMap[compareFilters.sort] ?? sortHintMap.status;

  if (results.length === 0) {
    elements.compareTable.innerHTML = renderEmptyState({
      title: localText("没有 variant 符合当前筛选条件。", "No variants match the current compare filters."),
      message: localText("尝试调整筛选条件或切换排序方式。", "Try adjusting the filter conditions or changing the sort method."),
      primaryCtaText: t("loadData")
    });
    return;
  }

  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const bestKey = verdict.bestAgent ? recordKey(verdict.bestAgent) : null;
  const fastestKey = verdict.fastest ? recordKey(verdict.fastest) : null;
  const cheapestKey = verdict.lowestKnownCost ? recordKey(verdict.lowestKnownCost) : null;
  const medals = ["🥇", "🥈", "🥉"];

  // Pagination: show first 25 rows, then "show all" button
  const COMPARE_PAGE_SIZE = 25;
  const showAll = state._compareShowAll || results.length <= COMPARE_PAGE_SIZE;
  const displayResults = showAll ? results : results.slice(0, COMPARE_PAGE_SIZE);

  // Separate passed and failed results for cleaner display
  const passedResults = displayResults.filter(r => r.status === "success");
  const failedResults = displayResults.filter(r => r.status !== "success");

  // ── Build the simplified compare table (6 core columns) ──
  function buildCompareRow(result, index, allResults) {
    const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
    const totalJudges = result.judgeResults.length;
    const passRatio = totalJudges > 0 ? passedJudges / totalJudges : 0;
    const passPercent = Math.round(passRatio * 100);
    const isActive = recordKey(result) === state.selectedAgentId ? "active" : "";
    const key = recordKey(result);
    const runtime = runtimeIdentity(result);
    const isBest = key === bestKey;
    const rowClass = [isActive, isBest ? "compare-row-best" : "", result.status === "failed" ? "compare-row-failed" : ""].filter(Boolean).join(" ");
    const medal = index < 3 && allResults.length > 1 ? medals[index] : "";

    // Score with grade
    let scoreCell = "—";
    if (typeof result.compositeScore === "number") {
      const grade = scoreGrade(result.compositeScore, result.status);
      const gradeLabel = localText(grade.labelZh, grade.label);
      scoreCell = `<span class="score-cell ${grade.cssClass}" title="${escapeHtml(gradeLabel)}">${escapeHtml(result.compositeScore.toFixed(1))} <small class="score-grade-label">${escapeHtml(gradeLabel)}</small></span>`;
    }

    // Status icon
    const statusIcon = result.status === "success" ? "\u2705" : result.status === "cancelled" ? "\u23f9\ufe0f" : "\u274c";

    // Tags
    const tags = [];
    if (key === bestKey) tags.push(`<span class="compare-tag compare-tag-best">${escapeHtml(localText("最佳", "Best"))}</span>`);
    if (key === fastestKey) tags.push(`<span class="compare-tag compare-tag-fast">${escapeHtml(localText("最快", "Fastest"))}</span>`);
    if (key === cheapestKey) tags.push(`<span class="compare-tag compare-tag-cheap">${escapeHtml(localText("最省", "Cheapest"))}</span>`);

    // Pass rate bar
    const barColor = passPercent === 100 ? "var(--success)" : passPercent >= 50 ? "var(--warning)" : "var(--danger)";

    return `
      <tr class="compare-row ${rowClass}" data-compare-agent-id="${escapeHtml(key)}" tabindex="0" role="button" aria-label="${escapeHtml(localText("展开详情", "Expand details") + " " + resultLabel(result))}">
        <td class="compare-rank">${medal || index + 1}</td>
        <td class="compare-variant">
          <strong>${escapeHtml(resultLabel(result))}</strong>
          ${tags.length > 0 ? `<div class="compare-tags-inline">${tags.join("")}</div>` : ""}
          <div class="compare-model-muted muted">${escapeHtml(runtime.model || "")}</div>
        </td>
        <td class="compare-status"><span title="${escapeHtml(translateStatus(result.status, t))}">${statusIcon}</span></td>
        <td class="compare-score">${scoreCell}</td>
        <td class="compare-passrate">
          <div class="judge-bar-wrap"><div class="judge-bar" style="width:${passPercent}%;background:${barColor}"></div></div>
          <span class="judge-bar-label">${passedJudges}/${totalJudges}</span>
        </td>
        <td class="compare-duration">${escapeHtml(formatDuration(result.durationMs))}</td>
      </tr>
      ${key === state.expandedCompareAgentId ? `<tr class="compare-detail-row"><td colspan="6">${renderInlineAgentDetail(result)}</td></tr>` : ""}
    `;
  }

  let tableHtml = `
    <table class="compare-table compare-table-compact">
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>${escapeHtml(localText("配置", "Variant"))}</th>
          <th style="width:50px">${escapeHtml(localText("状态", "Status"))}</th>
          <th style="width:120px">${escapeHtml(localText("综合分", "Score"))}</th>
          <th style="width:120px">${escapeHtml(localText("通过率", "Pass Rate"))}</th>
          <th style="width:90px">${escapeHtml(localText("耗时", "Duration"))}</th>
        </tr>
      </thead>
      <tbody>
  `;

  // Passed results first
  passedResults.forEach((result, i) => {
    tableHtml += buildCompareRow(result, i, displayResults);
  });

  // Failed results in a separate section if any exist
  if (failedResults.length > 0 && passedResults.length > 0) {
    tableHtml += `
      </tbody>
    </table>
    <details class="compare-failed-section" ${failedResults.length <= 3 ? "open" : ""}>
      <summary class="compare-failed-summary">
        \u274c ${escapeHtml(localText("失败", "Failed"))} (${failedResults.length})
      </summary>
      <table class="compare-table compare-table-compact compare-table-failed">
        <thead>
          <tr>
            <th style="width:40px">#</th>
            <th>${escapeHtml(localText("配置", "Variant"))}</th>
            <th style="width:50px">${escapeHtml(localText("状态", "Status"))}</th>
            <th style="width:120px">${escapeHtml(localText("综合分", "Score"))}</th>
            <th style="width:120px">${escapeHtml(localText("通过率", "Pass Rate"))}</th>
            <th style="width:90px">${escapeHtml(localText("耗时", "Duration"))}</th>
          </tr>
        </thead>
        <tbody>
    `;
    failedResults.forEach((result, i) => {
      tableHtml += buildCompareRow(result, passedResults.length + i, displayResults);
    });
  } else if (failedResults.length > 0) {
    failedResults.forEach((result, i) => {
      tableHtml += buildCompareRow(result, i, displayResults);
    });
  }

  tableHtml += `
      </tbody>
    </table>
    ${!showAll ? `<div class="compare-show-more"><button class="btn-link" data-action="show-all-compare">${escapeHtml(localText("显示全部 " + results.length + " 个变体", "Show all " + results.length + " variants"))}</button></div>` : ""}
  `;

  elements.compareTable.innerHTML = tableHtml;

  // Set up show-all handler via event delegation (avoids global namespace pollution)
  const showAllBtn = elements.compareTable.querySelector('[data-action="show-all-compare"]');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      state._compareShowAll = true;
      renderCompareTableV2(run);
    });
  }

  // Render radar charts for expanded agent detail panels
  const radarContainers = elements.compareTable?.querySelectorAll?.('.agent-radar-chart') || [];
  radarContainers.forEach(container => {
    const agentId = container.dataset.agentId;
    const result = run.results.find(r => r.agentId === agentId);
    if (!result) return;
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    container.appendChild(canvas);
    const radarData = {
      dimensions: [
        { name: t('chartCodeQuality'), value: result.judgeResults?.filter(j => j.success).length / Math.max(result.judgeResults?.length || 1, 1) * 100 },
        { name: t('chartSpeed'), value: Math.max(0, 100 - Math.min((result.durationMs || 0) / 60000, 1) * 100) },
        { name: t('chartTokenEfficiency'), value: result.tokenUsage ? Math.max(0, 100 - Math.min(result.tokenUsage / 100000, 1) * 100) : 50 },
        { name: t('chartDebugAbility'), value: result.status === 'success' ? 80 : 20 },
        { name: t('chartRefactorAbility'), value: Math.max(diffPrecisionScore(result), 0) * 100 },
        { name: t('chartDocsAbility'), value: 50 }
      ]
    };
    renderRadarChart(canvas, radarData, { width: 200, height: 200, padding: 30 });
  });
}


function renderSelectedAgentV2() {
  if (!state.run || !state.selectedAgentId) {
    return;
  }

  const result = state.run.results.find((entry) => recordKey(entry) === state.selectedAgentId);
  if (!result) {
    return;
  }

  const runtime = runtimeIdentity(result);
  const testJudge = findJudgeByType(result, "test-result");
  const lintJudge = findJudgeByType(result, "lint-check");
  const judgeKinds =
    Array.from(new Set(result.judgeResults.map((judge) => formatJudgeType(judge.type, t)))).join(", ") ||
    localText("无", "None");

  elements.resultSummary.innerHTML = `
    <h3>${escapeHtml(resultLabel(result))}</h3>
    <div class="summary-grid">
      <div class="summary-row"><span>${escapeHtml(localText("基础 Agent", "Base Agent"))}</span><strong>${escapeHtml(baseAgentLabel(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Provider", "Provider"))}</span><strong>${escapeHtml(runtime.provider)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("类型", "Kind"))}</span><strong>${escapeHtml(runtime.providerKind)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("模型", "Model"))}</span><strong>${escapeHtml(runtime.model)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("推理", "Reasoning"))}</span><strong>${escapeHtml(runtime.reasoning)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("版本", "Version"))}</span><strong>${escapeHtml(runtime.version)}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("可信度", "Verification"))}</span><strong>${escapeHtml(runtimeVerificationLabel(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("状态", "Status"))}</span><strong>${escapeHtml(translateStatus(result.status, t))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("综合分", "Composite Score"))}</span><strong>${escapeHtml(formatCompositeScore(result, state.run, state.scoreWeights))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("耗时", "Duration"))}</span><strong>${escapeHtml(formatDuration(result.durationMs))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(t("metrics.tokens"))}</span><strong>${escapeHtml(String(result.tokenUsage ?? "N/A"))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("成本", "Cost"))}</span><strong>${escapeHtml(formatCost(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("测试结果", "Test Result"))}</span><strong>${escapeHtml(formatTestMetric(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Lint 结果", "Lint Result"))}</span><strong>${escapeHtml(formatLintMetric(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Diff 精准度", "Diff Precision"))}</span><strong>${escapeHtml(formatDiffPrecisionMetric(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("改动文件", "Changed Files"))}</span><strong>${escapeHtml(String(result.changedFiles.length))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Judge 类型", "Judge Types"))}</span><strong>${escapeHtml(judgeKinds)}</strong></div>
      ${testJudge ? `<div class="summary-row"><span>${escapeHtml(localText("测试解析器", "Test Parser"))}</span><strong>${escapeHtml(testJudge.parser ?? "auto")}</strong></div>` : ""}
      ${lintJudge ? `<div class="summary-row"><span>${escapeHtml(localText("Lint 解析器", "Lint Parser"))}</span><strong>${escapeHtml(lintJudge.parser ?? "auto")}</strong></div>` : ""}
      <div class="summary-row"><span>${escapeHtml(localText("Trace 路径", "Trace"))}</span><code>${escapeHtml(result.tracePath)}</code></div>
      <div class="summary-row"><span>${escapeHtml(localText("工作区", "Workspace"))}</span><code>${escapeHtml(result.workspacePath)}</code></div>
    </div>
    <p class="muted">${escapeHtml(result.summary)}</p>
  `;

  elements.resultDetails.innerHTML = [
    `
      <section class="detail-card">
        <h3>${escapeHtml(localText("模型信息", "Model Identity"))}</h3>
        <div class="summary-grid">
          <div class="summary-row"><span>${escapeHtml(localText("请求配置", "Requested"))}</span><strong>${escapeHtml(result.requestedConfig?.model ?? "default")} / ${escapeHtml(result.requestedConfig?.reasoningEffort ?? "default")}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("实际使用", "Effective"))}</span><strong>${escapeHtml(runtime.model)} / ${escapeHtml(runtime.reasoning)}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("版本", "Version"))}</span><strong>${escapeHtml(runtime.version)}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("版本来源", "Version Source"))}</span><strong>${escapeHtml(runtime.versionSource)}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("来源", "Source"))}</span><strong>${escapeHtml(runtime.source)}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("可信度", "Verification"))}</span><strong>${escapeHtml(runtime.verification)}</strong></div>
        </div>
      </section>
    `,
    `
      <section class="detail-card">
        <h3>${escapeHtml(localText("Provider 信息", "Provider Identity"))}</h3>
        <div class="summary-grid">
          <div class="summary-row"><span>${escapeHtml(localText("请求 Profile", "Requested Profile"))}</span><strong>${escapeHtml(result.requestedConfig?.providerProfileId ?? "official")}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("实际 Provider", "Effective Provider"))}</span><strong>${escapeHtml(runtime.provider)}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("Provider 类型", "Provider Kind"))}</span><strong>${escapeHtml(runtime.providerKind)}</strong></div>
          <div class="summary-row"><span>${escapeHtml(localText("Provider 来源", "Provider Source"))}</span><strong>${escapeHtml(runtime.providerSource)}</strong></div>
        </div>
        ${
          runtime.providerKind !== "official" && runtime.provider !== "official"
            ? `<p class="warning-text">${escapeHtml(localText("此结果通过非官方 Provider 的 Claude Code 配置生成。", "This result was produced through a provider-switched Claude Code configuration."))}</p>`
            : ""
        }
      </section>
    `,
    renderStepCards(localText("准备步骤", "Setup"), result.setupResults),
    renderJudgeCards(result),
    renderStepCards(localText("收尾步骤", "Teardown"), result.teardownResults),
    `
      <section class="detail-card">
        <h3>${escapeHtml(localText("改动文件", "Changed Files"))}</h3>
        ${
          result.changedFiles.length === 0
            ? `<p class="empty-state">${escapeHtml(localText("没有检测到 diff。", "No diff detected."))}</p>`
            : `<ul>${result.changedFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul>`
        }
      </section>
    `,
    renderDiff(result)
  ].join("");
}


function renderRecommendationCard(run) {
  // Clean up previous recommendation cards and cost projections
  document.querySelectorAll(".recommendation-hero, .cost-projection").forEach((el) => { el.remove(); });

  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const best = verdict.bestAgent;
  if (!best || best.status !== "success") return;

  const runtime = runtimeIdentity(best);
  const passed = best.judgeResults.filter((j) => j.success).length;
  const total = best.judgeResults.length;
  const reasons = [];
  reasons.push(`${localText("综合分", "Composite Score")} ${formatCompositeScore(best, run, state.scoreWeights)}`);
  if (passed === total) reasons.push(localText("全部 Judge 通过", "All judges passed"));
  if (verdict.fastest && recordKey(verdict.fastest) === recordKey(best)) reasons.push(localText("速度最快", "Fastest"));
  if (verdict.lowestKnownCost && recordKey(verdict.lowestKnownCost) === recordKey(best)) reasons.push(localText("成本最低", "Lowest cost"));
  if (reasons.length === 0) reasons.push(localText("综合评分最高", "Highest overall score"));

  const el = document.querySelector("#verdict-hero");
  if (!el) return;
  const card = document.createElement("div");
  card.className = "recommendation-hero";
  const reasonTags = reasons.map((r) => `<span class="rec-tag">${escapeHtml(r)}</span>`).join("");
  const modelTag = runtime.model ? `<span class="rec-tag rec-tag-model">${escapeHtml(runtime.model)}</span>` : "";
  const durationTag = `<span class="rec-tag rec-tag-duration">⚡ ${escapeHtml(formatDuration(best.durationMs))}</span>`;
  const costTag = `<span class="rec-tag rec-tag-cost">💰 ${escapeHtml(formatCost(best))}</span>`;
  card.innerHTML = `
    <span class="recommendation-eyebrow">💡 ${escapeHtml(localText("推荐", "Recommendation"))}</span>
    <span class="recommendation-agent">${escapeHtml(localText("对于你的仓库，推荐使用", "For your repo, we recommend"))} <strong>${escapeHtml(resultLabel(best))}</strong></span>
    <div class="recommendation-tags">${reasonTags}${modelTag}${durationTag}${costTag}</div>
  `;
  el.parentNode.insertBefore(card, el);
}

function renderCostProjection(run) {
  const knownCostResults = run.results.filter((r) => r.costKnown && r.estimatedCostUsd > 0);
  if (knownCostResults.length === 0) return;

  const runsPerMonth = 100;
  const rows = knownCostResults.map((r) => {
    const monthly = r.estimatedCostUsd * runsPerMonth;
    return `
      <div class="cost-proj-row">
        <span class="cost-proj-agent">${escapeHtml(resultLabel(r))}</span>
        <span class="cost-proj-single">${escapeHtml(formatCost(r))}</span>
        <span class="cost-proj-monthly">$${monthly.toFixed(2)}</span>
      </div>
    `;
  }).join("");

  const section = document.createElement("section");
  section.className = "cost-projection";
  section.innerHTML = `
    <div class="cost-proj-title">${escapeHtml(localText("成本预测", "Cost Projection"))} <span class="muted">(${runsPerMonth} ${escapeHtml(localText("次/月", "runs/mo"))})</span></div>
    <div class="cost-proj-header">
      <span>${escapeHtml(localText("Agent", "Agent"))}</span>
      <span>${escapeHtml(localText("单次", "Per Run"))}</span>
      <span>${escapeHtml(localText("月度预估", "Monthly Est."))}</span>
    </div>
    ${rows}
  `;
  elements.verdictHero.after(section);
}

function renderLeaderboard(run) {
  if (!run || state.runs.length < 1) {
    setHidden(elements.leaderboardSection, true);
    return;
  }

  const leaderboard = buildLeaderboard(state.runs, run);
  
  if (leaderboard.rows.length === 0) {
    setHidden(elements.leaderboardSection, false);
    elements.leaderboardTitle.textContent = t("leaderboardTitle");
    elements.leaderboardContent.innerHTML = renderEmptyState({
      title: t("leaderboardNoData"),
      message: t("leaderboardNoDataHint"),
      primaryCtaText: t("tryDemo"),
      primaryCtaAction: "load-demo"
    });
    return;
  }

  const explanation = [
    t("leaderboardExplanation1"),
    t("leaderboardExplanation2"),
    t("leaderboardExplanation3", leaderboard.comparableRunCount)
  ];
  
  if (leaderboard.excludedRunCount > 0) {
    explanation.push(t("leaderboardExplanation4", leaderboard.excludedRunCount));
  } else {
    explanation.push(t("leaderboardExplanation4All"));
  }
  
  setHidden(elements.leaderboardSection, false);
  elements.leaderboardTitle.textContent = t("leaderboardTitle");
  
  const explanationHtml = explanation.map(text => `<p class="muted">${escapeHtml(text)}</p>`).join("");
  
  const sampleWarning = t("leaderboardSampleWarning");
  
  const rowsHtml = leaderboard.rows.map((row) => {
    const { identity, stats } = row;
    const sampleBadge = !stats.sampleSizeSufficient
      ? `<span class="badge badge-warning" title="${escapeHtml(sampleWarning)}">!</span>`
      : "";
    
    return `
      <tr class="leaderboard-row">
        <td>
          <strong>${escapeHtml(row.displayLabel)}</strong>
          ${sampleBadge}
        </td>
        <td>${escapeHtml(identity.baseAgentId)}</td>
        <td>${escapeHtml(identity.providerProfile)}</td>
        <td>${escapeHtml(identity.model)}</td>
        <td><code>${escapeHtml(identity.version)}</code></td>
        <td>${stats.runCount}</td>
        <td><strong>${stats.averageScore.toFixed(1)}</strong></td>
        <td>${(stats.winRate * 100).toFixed(1)}% (${row.winCount}/${row.totalComparisons})</td>
        <td>${(stats.successRate * 100).toFixed(1)}%</td>
        <td>${escapeHtml(formatDuration(stats.medianDurationMs))}</td>
        <td>${stats.medianCostUsd !== null ? `$${stats.medianCostUsd.toFixed(4)}` : "n/a"}</td>
        <td class="muted">${escapeHtml(stats.lastSeenAt.slice(0, 10))}</td>
      </tr>
    `;
  }).join("");
  
  elements.leaderboardContent.innerHTML = `
    <div class="leaderboard-explanation">
      ${explanationHtml}
    </div>
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("leaderboardVariant"))}</th>
          <th>${escapeHtml(t("leaderboardBaseAgent"))}</th>
          <th>${escapeHtml(t("leaderboardProvider"))}</th>
          <th>${escapeHtml(t("leaderboardModel"))}</th>
          <th>${escapeHtml(t("leaderboardVersion"))}</th>
          <th>${escapeHtml(t("leaderboardRuns"))}</th>
          <th>${escapeHtml(t("leaderboardAvgScore"))}</th>
          <th>${escapeHtml(t("leaderboardWinRate"))}</th>
          <th>${escapeHtml(t("leaderboardSuccessRate"))}</th>
          <th>${escapeHtml(t("leaderboardMedianDuration"))}</th>
          <th>${escapeHtml(t("leaderboardMedianCost"))}</th>
          <th>${escapeHtml(t("leaderboardLastSeen"))}</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <p class="muted" style="margin-top:12px;font-size:0.8rem">
      ${escapeHtml(t("leaderboardNote"))}
    </p>
  `;
}


/**
 * Render the Task Trace section: what was asked vs what came back.
 *
 * This answers the user's question: "Did the agent actually receive the task?
 * What did it return?"
 */
function renderTaskTrace(run) {
  if (!elements.taskTrace) return;

  const taskPrompt = run.task?.prompt || "";
  const results = run.results || [];

  // Build per-agent trace blocks
  const agentBlocks = results.map(result => {
    const summary = result.summary || "";
    const hasRealResponse = summary && summary.trim().length > 0 && !summary.includes("did not return a result");

    // Extract CLI command from trace
    let cliCommand = "";
    if (result.traceEvents) {
      const startEvent = result.traceEvents.find(e => e.type === "adapter.start");
      if (startEvent?.metadata?.command) {
        const args = startEvent.metadata.args || [];
        cliCommand = startEvent.metadata.command + " " + args.join(" ");
      }
    }

    const statusIcon = result.status === "success" ? "\u2705" : "\u274c";
    const label = resultLabel(result);

    return `
      <div class="task-trace-block" style="margin-bottom:12px;">
        <div class="task-trace-block-header">
          <span>${statusIcon} ${escapeHtml(label)}</span>
          <span style="font-size:0.75rem;font-weight:400;text-transform:none;letter-spacing:0;">
            ${escapeHtml(localText("状态", "Status"))}: ${escapeHtml(translateStatus(result.status, t))}
          </span>
        </div>
        ${cliCommand ? `
        <div class="task-trace-command">${escapeHtml(cliCommand.length > 200 ? cliCommand.slice(0, 200) + "..." : cliCommand)}</div>
        ` : ""}
        <div style="padding:12px 14px;">
          <div style="font-weight:600;font-size:0.82rem;color:var(--text-muted);margin-bottom:6px;">${escapeHtml(t("taskTraceResponse"))}</div>
          ${hasRealResponse
            ? `<pre style="margin:0;font-size:0.82rem;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;">${escapeHtml(summary)}</pre>`
            : `<p class="task-trace-response-empty">${escapeHtml(t("taskTraceNoResponse"))}</p>`
          }
        </div>
      </div>
    `;
  }).join("");

  elements.taskTrace.innerHTML = `
    <details class="task-trace-section">
      <summary>
        <span>\ud83d\udd0d</span>
        ${escapeHtml(t("taskTraceTitle"))}
      </summary>
      <div class="task-trace-body">
        <div class="task-trace-block">
          <div class="task-trace-block-header">
            <span>${escapeHtml(t("taskTracePrompt"))}</span>
            <button class="btn-copy-trace" data-copy-target="task-prompt">\ud83d\udccb ${escapeHtml(localText("复制", "Copy"))}</button>
          </div>
          <pre id="task-prompt-text">${escapeHtml(taskPrompt)}</pre>
        </div>
        ${agentBlocks}
      </div>
    </details>
  `;

  // Wire up copy button
  const copyBtn = elements.taskTrace.querySelector('[data-copy-target="task-prompt"]');
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const textEl = document.getElementById("task-prompt-text");
      if (textEl) {
        navigator.clipboard?.writeText(textEl.textContent).then(() => {
          copyBtn.textContent = "\u2713 " + localText("已复制", "Copied");
          setTimeout(() => { copyBtn.textContent = "\ud83d\udccb " + localText("复制", "Copy"); }, 2000);
        });
      }
    });
  }
}

/**
 * Render the top-level Results Summary Card.
 *
 * This is the FIRST thing users see on the dashboard. It answers three
 * questions in 5 seconds:
 *   1. How did it go? (overall verdict)
 *   2. Who's best? (winner with score grade)
 *   3. Why? (key differentiators)
 */
function renderSummaryCard(run) {
  const summary = summarizeRun(run);
  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const best = verdict.bestAgent;
  const fastest = verdict.fastest;
  const cheapest = verdict.lowestKnownCost;

  if (!elements.summaryCard) return;

  // ── Compute score for the best agent ──
  let scoreHtml = "";
  let gradeInfo = null;
  if (best && typeof best.compositeScore === "number") {
    gradeInfo = scoreGrade(best.compositeScore, best.status);
    const gradeLabel = localText(gradeInfo.labelZh, gradeInfo.label);
    scoreHtml = `
      <div class="summary-score-block">
        <div class="summary-score-value ${gradeInfo.cssClass}">${escapeHtml(best.compositeScore.toFixed(1))}</div>
        <span class="summary-score-grade ${gradeInfo.cssClass}">${escapeHtml(gradeLabel)}</span>
        <span class="muted" style="font-size:0.75rem">${escapeHtml(localText("/ 100 分", "/ 100 pts"))}</span>
      </div>
    `;
  }

  // ── Pass rate ──
  let passRateHtml = "";
  if (best) {
    const passed = best.judgeResults.filter(j => j.success).length;
    const total = best.judgeResults.length;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const barColor = pct === 100 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";
    passRateHtml = `
      <div class="summary-metric">
        <span class="summary-metric-label">${escapeHtml(localText("通过率", "Pass Rate"))}</span>
        <div class="summary-pass-ring">
          <div class="summary-pass-bar" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <span class="summary-metric-value">${passed}/${total} (${pct}%)</span>
      </div>
    `;
  }

  // ── Verdict sentence ──
  const verdictText = generateVerdictSummary(run);

  // ── Quick badges ──
  const badges = [];
  if (summary.successCount > 0) {
    badges.push(`<span class="summary-badge summary-badge-pass">${escapeHtml(localText("通过", "Passed"))} ${summary.successCount}</span>`);
  }
  if (summary.failedCount > 0) {
    badges.push(`<span class="summary-badge summary-badge-fail">${escapeHtml(localText("失败", "Failed"))} ${summary.failedCount}</span>`);
  }
  if (fastest && recordKey(fastest) !== recordKey(best)) {
    badges.push(`<span class="summary-badge summary-badge-fast">\u26a1 ${escapeHtml(resultLabel(fastest))} ${escapeHtml(formatDuration(fastest.durationMs))}</span>`);
  }
  if (cheapest && cheapest.estimatedCostUsd > 0 && recordKey(cheapest) !== recordKey(best)) {
    badges.push(`<span class="summary-badge summary-badge-cheap">\ud83d\udcb0 ${escapeHtml(resultLabel(cheapest))} ${escapeHtml(formatCost(cheapest))}</span>`);
  }

  // ── Winner name ──
  let winnerBlock = "";
  if (best && best.status === "success") {
    const runtime = runtimeIdentity(best);
    winnerBlock = `
      <div class="summary-winner">
        <span class="summary-winner-icon">\ud83c\udfc6</span>
        <div>
          <div class="summary-winner-name">${escapeHtml(resultLabel(best))}</div>
          <div class="summary-winner-model muted">${escapeHtml(runtime.model || runtime.provider || "")}</div>
        </div>
      </div>
    `;
  } else if (summary.successCount === 0) {
    winnerBlock = `
      <div class="summary-winner summary-winner-fail">
        <span class="summary-winner-icon">\u274c</span>
        <div>
          <div class="summary-winner-name">${escapeHtml(localText("无通过的 Agent", "No Passing Agent"))}</div>
          <div class="summary-winner-model muted">${escapeHtml(localText("所有 agent 均未通过", "All agents failed"))}</div>
        </div>
      </div>
    `;
  }

  elements.summaryCard.innerHTML = `
    <div class="summary-card">
      <div class="summary-card-header">
        <div class="summary-verdict">
          <h2 class="summary-verdict-title">${escapeHtml(localText("结果摘要", "Results Summary"))}</h2>
          <p class="summary-verdict-text">${escapeHtml(verdictText)}</p>
        </div>
        <div class="summary-badges">${badges.join("")}</div>
      </div>
      <div class="summary-card-body">
        <div class="summary-card-left">
          ${winnerBlock}
          ${scoreHtml}
        </div>
        <div class="summary-card-right">
          ${passRateHtml}
          <div class="summary-metric">
            <span class="summary-metric-label">${escapeHtml(localText("总耗时", "Total Time"))}</span>
            <span class="summary-metric-value">${escapeHtml(formatDuration(Math.max(...run.results.map(r => r.durationMs || 0))))}</span>
          </div>
          <div class="summary-metric">
            <span class="summary-metric-label">${escapeHtml(localText("Agent 数量", "Agents"))}</span>
            <span class="summary-metric-value">${summary.totalAgents}</span>
          </div>
          ${summary.knownCost > 0 ? `
          <div class="summary-metric">
            <span class="summary-metric-label">${escapeHtml(localText("已知成本", "Known Cost"))}</span>
            <span class="summary-metric-value">$${summary.knownCost.toFixed(2)}</span>
          </div>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderDashboard(run) {
  setHidden(elements.emptyState, true);
  setHidden(elements.dashboard, false);

  elements.taskTitle.textContent = run.task.title;
  elements.taskMeta.textContent = `${run.task.id} | ${formatRelativeTime(run.createdAt, localText)}`;

  // 首屏摘要卡（5 秒看懂结果）
  renderSummaryCard(run);

  // 首屏推荐卡片
  renderRecommendationCard(run);
  // 首屏结论
  renderVerdictHero(run);
  // 成本预测
  renderCostProjection(run);
  // 历史排行榜
  renderLeaderboard(run);
  // 核心对比表
  renderCompareTableV2(run);
  // 横向条形图
  renderComparisonBars(run);
  // 失败与风险
  renderFailures(run);
  // 高级分析内部
  renderTaskBrief(run);
  renderRunInfo(run);
  renderRunCompareTable();
  renderRunDiffTableV2();
  renderPreflights(run);
  renderAgentList(run);
  renderAgentTrendTableV2(run);
  populateJudgeFilters(run);
  renderSelectedAgentV2();
  renderMarkdownPanel();
  renderCodeReviewSection(elements.dashboard, run);
  // 团队成本计算器
  renderTeamCostCalculator(elements.dashboard, run);
  // 分享/导出功能
  setupShareActions(elements.dashboard, run);
  setHidden(elements.runCompareSection, state.runs.length <= 1);
  setHidden(elements.runDiffSection, !findPreviousComparableRun(state.runs, run));
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, run, state.selectedAgentId).length <= 1
  );
  // 高级分析 summary 文案
  if (elements.advancedAnalysis) {
    const summaryEl = elements.advancedAnalysis.querySelector("summary");
    if (summaryEl) {
      summaryEl.textContent = localText("高级分析", "Advanced Analysis");
    }
  }

  // 任务轨迹（任务要求 vs Agent 返回）
  renderTaskTrace(run);

  // 免责声明
  let disclaimer = document.querySelector(".agentarena-disclaimer");
  if (!disclaimer) {
    disclaimer = document.createElement("section");
    disclaimer.className = "agentarena-disclaimer muted";
    disclaimer.style.cssText = "margin-top:24px;padding:16px;border:1px solid var(--border);border-radius:8px;font-size:0.8rem;line-height:1.5;opacity:0.7";
    elements.dashboard.appendChild(disclaimer);
  }
  disclaimer.innerHTML = escapeHtml(localText(
    "免责声明：本报告由 AgentArena 自动生成，仅供技术参考。跑分结果受网络延迟、API 负载、硬件配置、任务包设计等多种因素影响，不构成对任何 AI 产品的官方评价或排名。第三方 Provider 的结果不代表原厂官方表现。成本估算基于 API 返回数据，可能与实际账单存在差异。使用本工具产生的 API 调用费用由用户自行承担。AgentArena 不对跑分结果的准确性、完整性或适用性做任何保证。",
    "Disclaimer: This report is auto-generated by AgentArena for technical reference only. Benchmark results are influenced by network latency, API load, hardware, and task pack design, and do not constitute an official evaluation or ranking of any AI product. Third-party provider results do not represent the vendor's official performance. Cost estimates are based on API-reported data and may differ from actual billing. API usage costs incurred by this tool are the user's responsibility. AgentArena makes no warranties regarding the accuracy, completeness, or fitness of benchmark results."
  ));
}

  return {
    renderRunInfo,
    renderTaskBrief,
    renderRunList,
    renderRunCompareTable,
    renderRunDiffTableV2,
    renderAgentTrendTableV2,
    renderPreflights,
    renderAgentList,
    populateJudgeFilters,
    renderMarkdownPanel,
    generateVerdictSummary,
    renderVerdictHero,
    renderComparisonBars,
    renderFailures,
    renderCompareTableV2,
    renderSelectedAgentV2,
    renderRecommendationCard,
    renderCostProjection,
    renderLeaderboard,
    renderSummaryCard,
    scoreGrade,
    renderTaskTrace,
    renderDashboard
  };
}
