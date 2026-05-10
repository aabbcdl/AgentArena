/**
 * Cross-run comparison event bindings for AgentArena web report.
 *
 * Wires up the DOM event listeners for cross-run selection, comparison,
 * clearing, and community leaderboard refresh. This module owns no state
 * directly — it receives dependencies through the init function.
 */

/**
 * Initialize cross-run comparison event listeners.
 *
 * @param {object} deps
 * @param {object} deps.elements - DOM element references
 * @param {object} deps.state - Application state object
 * @param {Function} deps.getCrossRunCompareRows - View-model function for computing comparison data
 * @param {Function} deps.clearCachedCommunityData - Community data cache clearer
 * @param {Function} deps.renderCommunityView - Community view renderer
 * @param {Function} deps.renderCrossRunCompareImpl - Cross-run compare renderer
 * @param {Function} deps.renderCrossRunSelectionListImpl - Cross-run selection list renderer
 */
export function initCrossRunEvents({
  elements,
  state,
  getCrossRunCompareRows,
  clearCachedCommunityData,
  renderCommunityView,
  renderCrossRunCompareImpl,
  renderCrossRunSelectionListImpl
}) {
  function renderCrossRunCompare() {
    return renderCrossRunCompareImpl();
  }

  function renderCrossRunSelectionList() {
    return renderCrossRunSelectionListImpl();
  }

  elements.crossRunToggleSelect.addEventListener("click", () => {
    state.crossRunSelectMode = !state.crossRunSelectMode;
    if (!state.crossRunSelectMode) {
      state.crossRunSelectedIds.clear();
      state.crossRunCompareData = null;
    }
    renderCrossRunCompare();
  });

  elements.crossRunSearch.addEventListener("input", () => {
    renderCrossRunSelectionList();
  });

  elements.crossRunSelectionList.addEventListener("click", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    
    const runId = checkbox.getAttribute("data-run-id");
    if (!runId) return;
    
    if (checkbox.checked) {
      state.crossRunSelectedIds.add(runId);
    } else {
      state.crossRunSelectedIds.delete(runId);
    }
    elements.crossRunCompareBtn.disabled = state.crossRunSelectedIds.size < 2;
    renderCrossRunSelectionList();
  });

  elements.crossRunCompareBtn.addEventListener("click", () => {
    const selectedRuns = state.runs.filter(run => state.crossRunSelectedIds.has(run.runId));
    if (selectedRuns.length < 2) return;
    
    state.crossRunCompareData = getCrossRunCompareRows(selectedRuns, { scoreWeights: state.scoreWeights });
    state.crossRunSelectMode = false;
    state.crossRunSelectedIds = new Set(state.crossRunCompareData.comparableRuns.map((run) => run.runId));
    renderCrossRunCompare();
  });

  elements.crossRunClearBtn.addEventListener("click", () => {
    state.crossRunSelectedIds.clear();
    state.crossRunCompareData = null;
    elements.crossRunCompareBtn.disabled = true;
    renderCrossRunSelectionList();
    renderCrossRunCompare();
  });

  elements.crossRunCloseCompare.addEventListener("click", () => {
    state.crossRunCompareData = null;
    state.crossRunSelectedIds.clear();
    renderCrossRunCompare();
  });

  elements.communityRefresh?.addEventListener("click", async () => {
    if (state.communityTaskPackId) {
      clearCachedCommunityData(state.communityTaskPackId);
      state.communityData = null;
      state.communityTaskPackId = null;
    }
    await renderCommunityView();
  });

  // Return the renderer functions so app.js can use them
  return { renderCrossRunCompare, renderCrossRunSelectionList };
}
