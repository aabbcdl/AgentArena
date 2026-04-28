import { renderBarChart, renderRadarChart } from "../components/charts.js";

export function createDashboardModule(deps) {
  const {
    state,
    elements,
    judgeFilters,
    compareFilters,
    runCompareFilters,
    t,
    localText,
    escapeHtml,
    setHidden,
    formatDuration,
    formatCost,
    translateStatus,
    statusClass,
    formatJudgeType,
    resultLabel,
    baseAgentLabel,
    recordKey,
    runtimeVerificationLabel,
    taskIntentSummary,
    getArchivedScoreModeLabel,
    getScoreModeLabel,
    baselineTaskWarning,
    taskMeaningBadges,
    runFocusLine,
    summarizeRun,
    getRunCompareRows,
    getRunToRunAgentDiff,
    getRunTrustSummary,
    getAgentTrendRows,
    getSelectionTrustSummary,
    getRunVerdict,
    getCompareResults,
    findPreviousComparableRun,
    runtimeIdentity,
    formatCompositeScore,
    formatDiffPrecisionMetric,
    formatTestMetric,
    formatLintMetric,
    findJudgeByType,
    getCompositeScoreReasons,
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

/**
 * Render an enhanced empty state with icon, title, message, and optional CTA button
 * @param {Object} options
 * @param {string} options.title - Main title text
 * @param {string} options.message - Descriptive message
 * @param {string} [options.ctaText] - Optional CTA button text
 * @param {string} [options.ctaAction] - Optional CTA button action (data attribute)
 * @returns {string} HTML string
 */
function renderEmptyState({ title, message, ctaText, ctaAction }) {
  return `
    <div class="empty-state-content">
      <h3 class="empty-state-title">${escapeHtml(title)}</h3>
      <p class="empty-state-message">${escapeHtml(message)}</p>
      ${ctaText ? `<button class="btn btn-primary empty-state-cta" ${ctaAction ? `data-action="${ctaAction}"` : ''}>${escapeHtml(ctaText)}</button>` : ''}
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
      <span class="muted">${escapeHtml(run.runId)}</span>
    </div>
    <p class="muted">${escapeHtml(t("createdAt"))} ${escapeHtml(run.createdAt)}</p>
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
    <p class="warning-text">${escapeHtml(baselineTaskWarning(run.task))}</p>
  `;
  setHidden(elements.runInfo, false);
}


function renderTaskBrief(run) {
  const intent = taskIntentSummary(run.task);
  const repoTypes = intent.repoTypes && intent.repoTypes !== "generic" ? intent.repoTypes : "generic";
  const resultCount = run.results.length;
  const variantLabels = run.results.map((result) => resultLabel(result)).join(", ");
  const badges = taskMeaningBadges(run.task);

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
    <p class="warning-text">${escapeHtml(baselineTaskWarning(run.task))}</p>
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
    elements.runList.className = "run-list empty-state";
    elements.runList.textContent = t("noRunsLoaded");
    return;
  }

  if (filteredRuns.length === 0) {
    elements.runList.className = "run-list empty-state";
    elements.runList.innerHTML = `<p>${escapeHtml(t("noRunsMatchSearch") || "No runs match your search.")}</p>`;
    return;
  }

  elements.runList.className = "run-list";
  elements.runList.innerHTML = filteredRuns
    .map((run) => {
      const active = run.runId === state.selectedRunId ? "active" : "";
      const successCount = run.results.filter((result) => result.status === "success").length;
      const hasMarkdown = state.markdownByRunId.has(run.runId);

      return `
        <div class="run-button ${active}" role="button" tabindex="0" data-run-id="${escapeHtml(run.runId)}" aria-label="${escapeHtml(run.task.title)}">
          <strong>${escapeHtml(run.task.title)}</strong>
          <div class="meta">${escapeHtml(run.createdAt)}</div>
          <div class="meta">${successCount}/${run.results.length} ${localText("成功", "success")} | ${escapeHtml(run.runId)}</div>
          <div class="meta">${hasMarkdown ? escapeHtml(t("linkedMarkdown")) : escapeHtml(t("jsonOnly"))}</div>
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
        </div>
      `;
    })
    .join("");
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
      ctaText: t("loadData")
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
              <tr class="${isActive}" data-compare-run-id="${escapeHtml(run.runId)}">
                <td><code>${escapeHtml(run.runId)}</code></td>
                <td>${escapeHtml(run.task.title)}</td>
                <td>${escapeHtml(run.createdAt)}</td>
                <td>${summary.successCount}/${summary.totalAgents}</td>
                <td>${summary.totalAgents}</td>
                <td>${summary.totalTokens}</td>
                <td>$${summary.knownCost.toFixed(2)}</td>
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
      message: localText("尝试加载更多历史运行以进行对比。", "Try loading more historical runs for comparison.")
    });
    return;
  }

  const formatDelta = (value, unit = "") => {
    if (value === null || value === undefined) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${typeof value === "number" && unit === "$" ? value.toFixed(4) : value}${unit}`;
  };

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
          <tr data-run-diff-agent-id="${escapeHtml(row.agentId)}" class="${row.agentId === state.selectedAgentId ? "active" : ""}">
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
      message: localText("加载多次运行以查看 agent 性能趋势。", "Load multiple runs to see agent performance trends over time.")
    });
    return;
  }

  const formatDelta = (value, unit = "") => {
    if (value === null || value === undefined) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${typeof value === "number" && unit === "$" ? value.toFixed(4) : value}${unit}`;
  };

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
          <tr data-agent-trend-run-id="${escapeHtml(row.run.runId)}" class="${row.run.runId === state.selectedRunId ? "active" : ""}">
            <td><code>${escapeHtml(row.run.runId.slice(0, 16))}</code></td>
            <td>${escapeHtml(row.runtime?.version ?? "unknown")}</td>
            <td><span class="status-badge ${row.result.status === "success" ? "status-success" : "status-failed"}">${escapeHtml(translateStatus(row.result.status))}</span></td>
            <td>${escapeHtml(formatDuration(row.result.durationMs))}</td>
            <td>${row.result.tokenUsage.toLocaleString()}</td>
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
            <span class="status-badge ${statusClass(preflight.status)}">${escapeHtml(translateStatus(preflight.status))}</span>
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


function renderAgentList(run) {
  elements.agentCount.textContent = String(run.results.length);
  elements.agentList.classList.remove("empty-state");
  elements.agentList.innerHTML = run.results
    .map((result) => {
      const active = recordKey(result) === state.selectedAgentId ? "active" : "";
      const runtime = runtimeIdentity(result);
      return `
        <button class="agent-button ${active}" type="button" data-agent-id="${escapeHtml(recordKey(result))}">
          <div class="row">
            <strong>${escapeHtml(resultLabel(result))}</strong>
            <span class="status-badge ${statusClass(result.status)}">${escapeHtml(translateStatus(result.status))}</span>
          </div>
          <div class="meta">
            ${escapeHtml(runtime.provider)} | ${escapeHtml(runtime.model)} | ${escapeHtml(runtime.version)} | ${escapeHtml(formatDuration(result.durationMs))} | ${escapeHtml(formatCost(result))}
          </div>
        </button>
      `;
    })
    .join("");
}


function populateJudgeFilters(run) {
  const judgeTypes = Array.from(
    new Set(run.results.flatMap((result) => result.judgeResults.map((judge) => judge.type)))
  ).sort();

  const currentType = judgeFilters.type;
  elements.judgeTypeFilter.innerHTML = [
    `<option value="all">${escapeHtml(t("judgeTypeAll"))}</option>`,
    ...judgeTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(formatJudgeType(type))}</option>`)
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
        message: localText("选择一个运行记录以查看重点摘要和分享卡片。", "Select a run to see highlights and share card.")
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
  const badges = taskMeaningBadges(run.task);
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
        <span class="winner-eyebrow">${escapeHtml(localText("综合最佳 Agent", "Overall Best Agent"))}</span>
        <span class="winner-name">${escapeHtml(resultLabel(best))}</span>
        <span class="winner-model">${escapeHtml(runtime.model)} · ${escapeHtml(runtime.reasoning)}</span>
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
            <span class="winner-stat-value">${best.tokenUsage}</span>
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
            <span class="stat-value">${summary.totalTokens.toLocaleString()}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">${escapeHtml(t("metrics.knownCost"))}</span>
            <span class="stat-value">$${summary.knownCost.toFixed(2)}</span>
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

  // Render radar chart for agent comparison
  const radarContainer = elements.comparisonBars.querySelector("#score-radar-chart");
  if (radarContainer && results.length > 0) {
    const radarData = results.slice(0, 3).map(r => ({
      name: resultLabel(r),
      dimensions: [
        { name: "Status", value: r.status === "success" ? 100 : 0 },
        { name: "Tests", value: r.judgeResults.filter(j => j.success).length / Math.max(r.judgeResults.length, 1) * 100 },
        { name: "Duration", value: Math.max(0, 100 - (r.durationMs || 0) / 1000) },
        { name: "Precision", value: Math.max(diffPrecisionScore(r), 0) * 100 }
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
      message: localText("尝试调整筛选条件或切换排序方式。", "Try adjusting the filter conditions or changing the sort method.")
    });
    return;
  }

  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const bestKey = verdict.bestAgent ? recordKey(verdict.bestAgent) : null;
  const fastestKey = verdict.fastest ? recordKey(verdict.fastest) : null;
  const cheapestKey = verdict.lowestKnownCost ? recordKey(verdict.lowestKnownCost) : null;
  const medals = ["🥇", "🥈", "🥉"];

  elements.compareTable.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>#</th>
          <th>${escapeHtml(localText("配置名称", "Variant"))}</th>
          <th>${escapeHtml(localText("模型", "Model"))}</th>
          <th>${escapeHtml(localText("版本", "Version"))}</th>
          <th>${escapeHtml(localText("可信度", "Verification"))}</th>
          <th>${escapeHtml(localText("状态", "Status"))}</th>
          <th>${escapeHtml(localText("综合分", "Composite Score"))}</th>
          <th>${escapeHtml(localText("Judge 通过率", "Judge Pass Rate"))}</th>
          <th>${escapeHtml(localText("耗时", "Duration"))}</th>
          <th>${escapeHtml(t("metrics.tokens"))}</th>
          <th>${escapeHtml(localText("成本", "Cost"))}</th>
          <th>${escapeHtml(localText("测试", "Tests"))}</th>
          <th>${escapeHtml(localText("Lint", "Lint"))}</th>
          <th>${escapeHtml(localText("Diff 精准度", "Diff Precision"))}</th>
          <th>${escapeHtml(localText("改动文件", "Changed"))}</th>
          <th>${escapeHtml(localText("标签", "Tags"))}</th>
        </tr>
      </thead>
      <tbody>
        ${results
          .map((result, index) => {
            const passedJudges = result.judgeResults.filter((judge) => judge.success).length;
            const totalJudges = result.judgeResults.length;
            const passRatio = totalJudges > 0 ? passedJudges / totalJudges : 0;
            const passPercent = Math.round(passRatio * 100);
            const isActive = recordKey(result) === state.selectedAgentId ? "active" : "";
            const key = recordKey(result);
            const runtime = runtimeIdentity(result);
            const isBest = key === bestKey;
            const rowClass = [isActive, isBest ? "compare-row-best" : "", result.status === "failed" ? "compare-row-failed" : ""].filter(Boolean).join(" ");
            const medal = index < 3 && results.length > 1 ? medals[index] : "";
            const tags = [];
            if (key === bestKey) tags.push(`<span class="compare-tag compare-tag-best">${escapeHtml(localText("最佳", "Best"))}</span>`);
            if (key === fastestKey) tags.push(`<span class="compare-tag compare-tag-fast">${escapeHtml(localText("最快", "Fastest"))}</span>`);
            if (key === cheapestKey) tags.push(`<span class="compare-tag compare-tag-cheap">${escapeHtml(localText("最省", "Cheapest"))}</span>`);

            const barColor = passPercent === 100 ? "var(--success)" : passPercent >= 50 ? "var(--warning)" : "var(--danger)";

            return `
              <tr class="${rowClass}" data-compare-agent-id="${escapeHtml(key)}" tabindex="0">
                <td class="compare-rank">${medal || index + 1}</td>
                <td><strong>${escapeHtml(resultLabel(result))}</strong><br /><code>${escapeHtml(baseAgentLabel(result))}</code></td>
                <td><span class="compare-model">${escapeHtml(runtime.model)}</span><br /><span class="muted" style="font-size:0.75rem">${escapeHtml(runtime.reasoning)}</span></td>
                <td>${escapeHtml(runtime.version)}</td>
                <td>${escapeHtml(runtimeVerificationLabel(result))}</td>
                <td><span class="status-badge ${statusClass(result.status)}">${escapeHtml(translateStatus(result.status))}</span></td>
                <td>${escapeHtml(formatCompositeScore(result, run, state.scoreWeights))}</td>
                <td>
                  <div class="judge-bar-wrap">
                    <div class="judge-bar" style="width:${passPercent}%;background:${barColor}"></div>
                  </div>
                  <span class="judge-bar-label">${passedJudges}/${totalJudges} (${passPercent}%)</span>
                </td>
                <td>${escapeHtml(formatDuration(result.durationMs))}</td>
                <td>${result.tokenUsage}</td>
                <td>${escapeHtml(formatCost(result))}</td>
                <td>${escapeHtml(formatTestMetric(result))}</td>
                <td>${escapeHtml(formatLintMetric(result))}</td>
                <td>${escapeHtml(formatDiffPrecisionMetric(result))}</td>
                <td>${result.changedFiles.length}</td>
                <td>${tags.join(" ")}</td>
              </tr>
              ${key === state.expandedCompareAgentId ? `<tr class="compare-detail-row"><td colspan="16">${renderInlineAgentDetail(result)}</td></tr>` : ""}
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
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
    Array.from(new Set(result.judgeResults.map((judge) => formatJudgeType(judge.type)))).join(", ") ||
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
      <div class="summary-row"><span>${escapeHtml(localText("状态", "Status"))}</span><strong>${escapeHtml(translateStatus(result.status))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("综合分", "Composite Score"))}</span><strong>${escapeHtml(formatCompositeScore(result, state.run, state.scoreWeights))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("耗时", "Duration"))}</span><strong>${escapeHtml(formatDuration(result.durationMs))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(t("metrics.tokens"))}</span><strong>${result.tokenUsage}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("成本", "Cost"))}</span><strong>${escapeHtml(formatCost(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("测试结果", "Test Result"))}</span><strong>${escapeHtml(formatTestMetric(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Lint 结果", "Lint Result"))}</span><strong>${escapeHtml(formatLintMetric(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("Diff 精准度", "Diff Precision"))}</span><strong>${escapeHtml(formatDiffPrecisionMetric(result))}</strong></div>
      <div class="summary-row"><span>${escapeHtml(localText("改动文件", "Changed Files"))}</span><strong>${result.changedFiles.length}</strong></div>
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
  card.innerHTML = `
    <span class="recommendation-eyebrow">💡 ${escapeHtml(localText("推荐", "Recommendation"))}</span>
    <span class="recommendation-agent">${escapeHtml(localText("对于你的仓库，推荐使用", "For your repo, we recommend"))} <strong>${escapeHtml(resultLabel(best))}</strong></span>
    <span class="recommendation-reason">${escapeHtml(localText("原因", "Because"))}: ${escapeHtml(reasons.join(" · "))} · ${escapeHtml(runtime.model)} · ${escapeHtml(formatDuration(best.durationMs))} · ${escapeHtml(formatCost(best))}</span>
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
      message: t("leaderboardNoDataHint")
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

function renderDashboard(run) {
  setHidden(elements.emptyState, true);
  setHidden(elements.dashboard, false);

  elements.taskTitle.textContent = run.task.title;
  elements.taskMeta.textContent = `${run.task.id} | ${run.createdAt}`;

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
    renderDashboard
  };
}
