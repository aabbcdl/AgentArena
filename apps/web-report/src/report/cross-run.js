export function createCrossRunRenders({
	state,
	elements,
	t,
	setHidden,
	summarizeRun,
	runtimeIdentity,
	formatDuration,
	getCrossRunRecommendation,
	getSelectionTrustSummary,
	escapeHtml
}) {
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

	function renderCrossRunCompare() {
    if (state.runs.length < 2) {
      setHidden(elements.crossRunCompareSection, true);
      return;
    }

    setHidden(elements.crossRunCompareSection, false);
    elements.crossRunCompareTitle.textContent = t("crossRunCompareTitle");
    elements.crossRunDescription.textContent = t("crossRunDescription");
    elements.crossRunCompareBtn.textContent = t("crossRunCompareBtn");
    elements.crossRunClearBtn.textContent = t("crossRunClearBtn");
    elements.crossRunCloseCompare.textContent = t("crossRunCloseCompare");
    elements.crossRunSearch.placeholder = t("crossRunSearchPlaceholder");

    const isSelectedMode = state.crossRunSelectMode;
    elements.crossRunToggleSelect.textContent = isSelectedMode
      ? t("crossRunCancelSelection")
      : t("crossRunToggleSelect");
    setHidden(elements.crossRunSelectionPanel, !isSelectedMode);
    setHidden(elements.crossRunCompareView, !state.crossRunCompareData);

    if (isSelectedMode) {
      renderCrossRunSelectionList();
      elements.crossRunCompareBtn.disabled = state.crossRunSelectedIds.size < 2;
    }

    if (state.crossRunCompareData) {
      renderCrossRunCompareTable();
    }
  }

  function renderCrossRunSelectionList() {
    const searchTerm = (elements.crossRunSearch?.value || "").toLowerCase();
    const filteredRuns = state.runs.filter(
      (run) =>
        !searchTerm ||
        run.task.title.toLowerCase().includes(searchTerm) ||
        run.runId.toLowerCase().includes(searchTerm)
    );

    if (filteredRuns.length === 0) {
      elements.crossRunSelectionList.innerHTML = `<p class="empty-state">${escapeHtml(t("crossRunNoRuns"))}</p>`;
      return;
    }

    elements.crossRunSelectionList.innerHTML = filteredRuns
      .map((run) => {
        const summary = summarizeRun(run);
        const isSelected = state.crossRunSelectedIds.has(run.runId);
        const runtime = run.results[0] ? runtimeIdentity(run.results[0]) : {};

        return `
      <label class="cross-run-item ${isSelected ? "selected" : ""}">
        <input type="checkbox" data-run-id="${escapeHtml(run.runId)}" ${isSelected ? "checked" : ""} />
        <div class="cross-run-item-content">
          <strong>${escapeHtml(run.task.title)}</strong>
          <p class="muted">
            ${escapeHtml(run.runId.slice(0, 16))}... |
            ${escapeHtml(run.createdAt.slice(0, 10))} |
            ${summary.successCount}/${summary.totalAgents} ${t("crossRunPassed")} |
            ${t("crossRunModelLabel")}: ${escapeHtml(runtime.model || "unknown")} |
            ${t("crossRunProviderLabel")}: ${escapeHtml(runtime.provider || "official")}
          </p>
        </div>
      </label>
    `;
      })
      .join("");
  }

  function renderCrossRunCompareTable() {
    if (!state.crossRunCompareData || state.crossRunCompareData.rows.length === 0) {
      elements.crossRunCompareTable.innerHTML = `<p class="empty-state">${escapeHtml(t("crossRunEmptySelection"))}</p>`;
      return;
    }

    const { runs, comparableRuns, excludedRuns, rows } = state.crossRunCompareData;
    elements.crossRunCompareSummary.textContent = excludedRuns.length > 0
      ? t("crossRunSelectedRuns", runs.length, comparableRuns.length, excludedRuns.length)
      : t("crossRunAllRunsMeetRules", runs.length);

    const recommendation = getCrossRunRecommendation(state.crossRunCompareData, { scoreWeights: state.scoreWeights });
    const trustSummary = getSelectionTrustSummary(state.crossRunCompareData);
    const trustHtml = trustSummary.level === "caution"
      ? `<p class="trust-hint warning-text">${escapeHtml(trustSummary.lowSampleSize ? t("trustSelectionCautionLowSample") : trustSummary.hasLegacyFallback ? t("trustSelectionCautionLegacy") : t("trustSelectionCautionExcluded"))}</p>`
      : `<p class="trust-hint muted">${escapeHtml(t("trustSelectionStrong"))}</p>`;

    const header = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("crossRunVariantLabel"))}</th>
          <th>${escapeHtml(t("crossRunBaseAgentLabel"))}</th>
          <th>${escapeHtml(t("crossRunRuns"))}</th>
          <th>${escapeHtml(t("crossRunSuccessRate"))}</th>
          <th>${escapeHtml(t("crossRunAvgDuration"))}</th>
          <th>${escapeHtml(t("crossRunAvgTokens"))}</th>
          <th>${escapeHtml(t("crossRunAvgCost"))}</th>
          <th>${escapeHtml(t("crossRunBestModelLabel"))}</th>
          <th>${escapeHtml(t("crossRunBestProviderLabel"))}</th>
        </tr>
      </thead>
      <tbody>
    `;

    const body = rows
      .map((row) => {
        const avgDuration = Math.round(row.stats.totalDurationMs / row.stats.totalRuns);
        const avgTokens = Math.round(row.stats.totalTokens / row.stats.totalRuns);
        const avgCost =
          row.stats.costKnownCount > 0 ? (row.stats.totalCost / row.stats.costKnownCount).toFixed(4) : null;
        const successRate = ((row.stats.successCount / row.stats.totalRuns) * 100).toFixed(1);
        const isRecommended = recommendation && recommendation.agentId === row.agentId;

        return `
      <tr class="${isRecommended ? "recommended-row" : ""}">
        <td>
          <strong>${escapeHtml(row.displayLabel)}</strong>
          ${isRecommended ? `<span class="badge">${escapeHtml(t("crossRunBestConfig"))}</span>` : ""}
        </td>
        <td>${escapeHtml(row.baseAgent)}</td>
        <td>${row.stats.totalRuns}</td>
        <td>
          <span class="status-badge ${row.stats.successCount === row.stats.totalRuns ? "status-success" : row.stats.successCount > 0 ? "status-partial" : "status-fail"}">
            ${successRate}%
          </span>
          (${row.stats.successCount}/${row.stats.totalRuns})
        </td>
        <td>${escapeHtml(formatDuration(avgDuration))}</td>
        <td>${avgTokens.toLocaleString()}</td>
        <td>${avgCost !== null ? `$${avgCost}` : "n/a"}</td>
        <td>${escapeHtml(row.bestRuntime?.runtime?.model || "n/a")}</td>
        <td>${escapeHtml(row.bestRuntime?.runtime?.provider || "n/a")}</td>
      </tr>
    `;
      })
      .join("");

    const excludedHtml = excludedRuns.length === 0
      ? ""
      : `
        <section class="compare-excluded-block">
          <h4>${escapeHtml(t("runCompareExcludedTitle"))}</h4>
          <ul class="compare-excluded-list">
            ${excludedRuns.map(({ run, reasons }) => `
              <li>
                <strong>${escapeHtml(run.task.title)}</strong>
                <code>${escapeHtml(run.runId)}</code>
                <p>${escapeHtml(reasons.map((reason) => translateFairComparisonReason(reason, t)).join(" "))}</p>
              </li>
            `).join("")}
          </ul>
        </section>
      `;

    elements.crossRunCompareTable.innerHTML = header + trustHtml + body + "</tbody></table>" + excludedHtml;
  }


  return {
    renderCrossRunCompare,
    renderCrossRunSelectionList,
    renderCrossRunCompareTable
  };
}
