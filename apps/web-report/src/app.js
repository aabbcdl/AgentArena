import { elements } from "./app-elements.js";
import {
  apiFetch,
  clientRandomId,
  debounce,
  escapeHtml,
  fetchWithTimeout,
  formatElapsedDuration,
  handleApiError,
  providerDisplayName,
  readLocationState,
  setHidden,
  syncLocationState
} from "./app-helpers.js";
import { state } from "./app-state.js";
import { RUN_LOADED } from "./core/events.js";
import { judgeRegistry } from "./core/judge-registry.js";
import { stateManager } from "./core/state.js";
import { initCrossRunEvents } from "./cross-run-events.js";
import { buildDemoRun } from "./demo-data.js";
import { translate } from "./i18n.js";
import { selectAgent, selectRun } from "./selection-handlers.js";
import {
  taskIntentSummary as taskIntentSummaryImpl,
  baselineTaskWarning as baselineTaskWarningImpl,
  taskMeaningBadges as taskMeaningBadgesImpl,
  summarizeTaskPrompt as summarizeTaskPromptImpl,
  summarizeJudges as summarizeJudgesImpl,
  formatJudgeType as formatJudgeTypeImpl,
  translateDifficulty as translateDifficultyImpl,
  translateStatus as translateStatusImpl,
  statusClass,
} from "./task-utils.js";
import { createLauncherModule } from "./launcher/module.js";
import { createCrossRunRenders } from "./report/cross-run.js";
import { createDashboardModule } from "./report/dashboard.js";
import { createDetailFragments } from "./report/detail-fragments.js";
import {
  persistCachedRuns as persistCachedRunsImpl,
  readStorage,
  restoreCachedRuns as restoreCachedRunsImpl,
  restoreRunsFromIndexedDB,
  writeStorage
} from "./result-cache.js";
import { createResultLoaders } from "./results/loaders.js";
import {
  applyScorePreset as applyScorePresetImpl,
  getArchivedScoreModeLabel as getArchivedScoreModeLabelImpl,
  getScoreModeLabel as getScoreModeLabelImpl,
  renderScoreWeightsControls as renderScoreWeightsControlsImpl,
  renderWeightSliders as renderWeightSlidersImpl,
  saveScoreConfig as saveScoreConfigImpl,
  updateScoreWeight as updateScoreWeightImpl
} from "./score-config.js";
import { createTraceReplayModule } from "./trace-replay.js";
import { formatDuration } from "./utils/format.js";
import { resultStore } from "./utils/storage.js";
import {
  baseAgentLabel,
  buildLeaderboard,
  buildPrTable,
  buildShareCard,
  buildShareCardSvg,
  clearCachedCommunityData,
  DEFAULT_SCORE_WEIGHTS,
  diffPrecisionScore,
  fetchCommunityIndex,
  findCommunityRank,
  findJudgeByType,
  findPreviousComparableRun,
  formatCompositeScore,
  formatDiffPrecisionMetric,
  formatLintMetric,
  formatTestMetric,
  getAgentTrendRows,
  getCachedCommunityData,
  getCompareResults,
  getCompositeScoreReasons,
  getCrossRunCompareRows,
  getCrossRunRecommendation,
  getRunCompareRows,
  getRunToRunAgentDiff,
  getRunTrustSummary,
  getRunVerdict,
  getSelectionTrustSummary,
  normalizeScoreWeights,
  renderCommunityLeaderboard,
  resultLabel,
  resultRecordKey,
  runtimeIdentity,
  setCachedCommunityData,
  summarizeRun
} from "./view-model.js";

/**
 * 维护地图（慎改契约）：HTTP `/api/*` JSON 见 `tests/contracts-http-api.test.mjs` · 服务端鉴权见 `tests/server-unit.test.mjs` ·
 * Trace JSONL / TraceEvent 见 `tests/trace-event-contract.test.mjs` · 运维说明见仓库 `docs/ui-and-adapters.md`。
 */

// state is imported from ./app-state.js

// elements is imported from ./app-elements.js

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
  sort: "created",
  scope: "current-task"
};

// getAuthToken, handleApiError, apiFetch, readLocationState, syncLocationState
// are imported from ./app-helpers.js

function restoreCachedRuns() {
  return restoreCachedRunsImpl();
}

function persistCachedRuns() {
  persistCachedRunsImpl(state);
}

// debounce is imported from ./app-helpers.js

const scoreWeightElements = {
  status: "scoreWeightStatus",
  tests: "scoreWeightTests",
  criticalJudges: "scoreWeightCriticalJudges",
  nonCriticalJudges: "scoreWeightNonCriticalJudges",
  resolutionRate: "scoreWeightResolutionRate",
  tokenEfficiency: "scoreWeightTokenEfficiency",
  acceptanceRate: "scoreWeightAcceptanceRate",
  categoryScore: "scoreWeightCategoryScore",
  duration: "scoreWeightDuration",
  cost: "scoreWeightCost"
};



function t(key, ...args) {
  return translate(state.language, key, ...args);
}

function showLoading(message) {
  if (elements.loadingIndicator) elements.loadingIndicator.classList.remove('hidden');
  if (elements.loadingMessage) elements.loadingMessage.textContent = message || t("loadingResults");
}

function hideLoading() {
  if (elements.loadingIndicator) elements.loadingIndicator.classList.add('hidden');
}

function showError(message) {
  setHidden(elements.emptyState, true);
  setHidden(elements.dashboard, true);
  setHidden(elements.errorState, false);
  if (elements.errorTitle) elements.errorTitle.textContent = t("failedToLoad");
  if (elements.errorMessage) elements.errorMessage.textContent = message;
}

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) {
    element.textContent = value;
  }
}

function setTextBySelector(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function renderList(element, items) {
  element.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

// escapeHtml is imported from ./app-helpers.js

// formatElapsedDuration is imported from ./app-helpers.js

function formatCost(result) {
  return result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a";
}

function _getNormalizedScoreWeights() {
  return normalizeScoreWeights(state.scoreWeights);
}

function saveScoreConfig() {
  saveScoreConfigImpl(state);
}

function loadScoreConfig() {
  try {
    const raw = readStorage("agentarena.webReport.scoreConfig");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getScoreModeLabel() {
  return getScoreModeLabelImpl(state, t);
}

function getArchivedScoreModeLabel(run) {
  return getArchivedScoreModeLabelImpl(run, t);
}

function renderScoreWeightsControls() {
  renderScoreWeightsControlsImpl(state, elements, t);
}

function updateScoreWeight(key, value) {
  updateScoreWeightImpl(state, key, value, {
    renderScoreWeightsControls,
    renderAll: () => {
      if (state.run) {
        renderVerdictHero(state.run);
        renderComparisonBars(state.run);
        renderCompareTableV2(state.run);
        renderSelectedAgentV2();
        renderRecommendationCard(state.run);
        renderMarkdownPanel();
      }
    }
  });
}

function applyScorePreset(presetId) {
  applyScorePresetImpl(state, presetId, {
    renderScoreWeightsControls,
    renderWeightSliders: () => renderWeightSlidersImpl(state.scoreWeights),
    renderAll: () => {
      if (state.run) {
        renderVerdictHero(state.run);
        renderComparisonBars(state.run);
        renderCompareTableV2(state.run);
        renderSelectedAgentV2();
        renderRecommendationCard(state.run);
        renderMarkdownPanel();
      }
    }
  });
}

// Weight slider generation
function renderWeightSliders(weights) {
  renderWeightSlidersImpl(weights);
}

function recordKey(record) {
  return resultRecordKey(record);
}

function runtimeVerificationLabel(record) {
  const runtime = runtimeIdentity(record);
  return `${runtime.verification} / ${runtime.source}`;
}

function localText(zh, en) {
  return state.language === "zh-CN" ? zh : en;
}

function translateDifficulty(d) { return translateDifficultyImpl(d, t); }
function translateStatus(s) { return translateStatusImpl(s, t); }

// providerDisplayName is imported from ./app-helpers.js

// clientRandomId is imported from ./app-helpers.js

function taskIntentSummary(task) { return taskIntentSummaryImpl(task); }
function baselineTaskWarning(task) { return baselineTaskWarningImpl(task, t); }
function taskMeaningBadges(task) { return taskMeaningBadgesImpl(task, t); }

function summarizeTaskPrompt(prompt) { return summarizeTaskPromptImpl(prompt); }
function summarizeJudges(taskPack) { return summarizeJudgesImpl(taskPack, t); }


function runFocusLine(run) {
  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const best = verdict.bestAgent ? resultLabel(verdict.bestAgent) : "n/a";
  const fastest = verdict.fastest ? resultLabel(verdict.fastest) : "n/a";

  if (run.task.id === "official-repo-health" || run.task.id === "repo-health") {
    return t("sanityFocusLine", best, fastest);
  }

  return t("generalFocusLine", best, fastest);
}

const crossRunRenders = createCrossRunRenders({
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
});

const detailFragments = createDetailFragments({
  state,
  judgeFilters,
  localText,
  escapeHtml,
  formatDuration,
  statusClass,
  formatJudgeType,
  findJudgeByType,
  formatDiffPrecisionMetric,
  formatCompositeScore,
  formatTestMetric,
  formatLintMetric,
  baseAgentLabel,
  render
});

const {
  renderCrossRunCompare: renderCrossRunCompareImpl,
  renderCrossRunSelectionList: renderCrossRunSelectionListImpl
} = crossRunRenders;

const {
  renderStepCards,
  renderJudgeCards,
  renderDiff,
  renderMarkdownBlock,
  renderInlineAgentDetail,
  renderCodeReviewSection,
  renderTeamCostCalculator,
  setupShareActions
} = detailFragments;

const {
  renderLauncher,
  detectService,
  syncLauncherStateFromDom,
  saveLauncherConfig,
  validateLauncher,
  renderLauncherValidation,
  handleLauncherRun,
  openProviderEditor,
  saveProviderProfileFromEditor,
  deleteProviderProfileById,
  defaultCodexVariant,
  defaultGeminiVariant,
  defaultAiderVariant,
  defaultKiloVariant,
  defaultOpencodeVariant
} = createLauncherModule({
  state,
  elements,
  t,
  localText,
  escapeHtml,
  setHidden,
  clientRandomId,
  providerDisplayName,
  formatElapsedDuration,
  fetchWithTimeout,
apiFetch,
handleApiError,
baselineTaskWarning,
summarizeTaskPrompt,
  summarizeJudges,
  translateDifficulty,
  applySingleRun,
  render
});

const {
  renderRunList,
  renderRunCompareTable,
  renderRunDiffTableV2,
  renderAgentTrendTableV2,
  renderAgentList,
  renderMarkdownPanel,
  renderVerdictHero,
  renderComparisonBars,
  renderCompareTableV2,
  renderSelectedAgentV2,
  renderRecommendationCard,
  renderDashboard
} = createDashboardModule({
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
});

const resultLoaders = createResultLoaders({
  state,
  localText,
  render,
  renderMarkdownPanel,
  applySingleRun,
  applyRuns,
  showLoading,
  hideLoading,
  showError
});

const traceReplay = createTraceReplayModule({
  escapeHtml,
  t
});

// Shared deps for selectAgent/selectRun helpers
const selectionDeps = {
  elements,
  syncLocationState,
  renderAgentList,
  renderCompareTableV2,
  renderComparisonBars,
  renderAgentTrendTableV2,
  renderSelectedAgentV2,
  renderRunDiffTableV2,
  getAgentTrendRows,
  setHidden,
  updateCurrentRun,
  render
};

const {
  downloadTextFile: downloadTextFileImpl,
  handleFileSelection: handleFileSelectionImpl,
  handleMarkdownSelection: handleMarkdownSelectionImpl,
  handleFolderSelection: handleFolderSelectionImpl
} = resultLoaders;

function renderStaticText() {
  document.title = `AgentArena · ${t("appTitle")}`;
  setText("result-loader-summary", t("existingResultsFallback"));
  setText("app-title", t("appTitle"));
  setText("app-description", t("appDescription"));
  setText("skip-link", t("skipToContent"));
  setText("update-banner-text", t("updateAvailable"));
  setText("language-label", t("languageLabel"));
  if (elements.languageSelect.options[0]) {
    elements.languageSelect.options[0].text = "English";
  }
  if (elements.languageSelect.options[1]) {
    elements.languageSelect.options[1].text = t("languageChineseLabel");
  }
  setText("runs-folder-title", t("runsFolderTitle"));
  setText("runs-folder-hint", t("runsFolderHint"));
  setText("summary-file-title", t("summaryFileTitle"));
  setText("summary-file-hint", t("summaryFileHint"));
  setText("markdown-file-title", t("markdownFileTitle"));
  setText("markdown-file-hint", t("markdownFileHint"));
  setText("runs-heading", t("runsHeading"));
  setText("agents-heading", t("agentsHeading"));
  if (elements.runSearch) {
    elements.runSearch.placeholder = t("searchRuns");
  }
  if (elements.agentListHint) {
    elements.agentListHint.textContent = t("agentListHint");
  }
  if (elements.loadingMessage && elements.loadingIndicator?.classList.contains("hidden")) {
    elements.loadingMessage.textContent = t("loadingResults");
  }
  setText("hero-eyebrow", t("heroEyebrow"));
  setText("hero-title", t("heroTitle"));
  setText("hero-description", t("heroDescription"));
  setText("hero-what-title", t("heroWhatTitle"));
  setText("hero-what-body", t("heroWhatBody"));
  setText("hero-how-title", t("heroHowTitle"));
  setText("topbar-eyebrow", t("topbarEyebrow"));
  setText("run-compare-title", t("runCompareTitle"));
  setText("run-diff-title", t("runDiffTitle"));
  setText("run-diff-description", t("runDiffDescription"));
  setText("agent-compare-title", t("agentCompareTitle"));
  setText("score-weights-title", t("scoreWeightsTitle"));
  setText("score-weights-reset", t("scoreWeightsReset"));
  setText("score-weight-status-label", t("scoreWeightStatus"));
  setText("score-weight-tests-label", t("scoreWeightTests"));
  setText("score-weight-judges-label", t("scoreWeightJudges"));
  setText("score-weight-lint-label", t("scoreWeightLint"));
  setText("score-weight-precision-label", t("scoreWeightPrecision"));
  setText("score-weight-duration-label", t("scoreWeightDuration"));
  setText("score-weight-cost-label", t("scoreWeightCost"));
  const presetButtons = elements.scoreWeightPresets?.querySelectorAll("button[data-score-preset]") ?? [];
  // Updated to only 3 core presets
  for (const button of presetButtons) {
    const presetId = button.dataset.scorePreset;
    switch (presetId) {
      case "correctness-first":
        button.textContent = t("scorePresetCorrectness");
        break;
      case "efficiency-first":
        button.textContent = t("scorePresetEfficiencyFirst");
        break;
      case "comprehensive":
        button.textContent = t("scorePresetComprehensive");
        break;
    }
  }
  setText("agent-trend-description", t("agentTrendDescription"));
  setText("judge-filters-title", t("judgeFiltersTitle"));
  setText("markdown-summary-title", t("markdownSummaryTitle"));
  setText("launcher-title", t("launcherTitle"));
  setText("launcher-eyebrow", t("launcherEyebrow"));
  setText("launcher-mode", t("launcherMode"));
  setText("launcher-description", t("launcherDescription"));
  setText("launcher-repo-label", t("launcherRepoLabel"));
  setText("launcher-task-select-label", t("launcherTaskSelectLabel"));
  setText("launcher-task-path-label", t("launcherTaskPathLabel"));
  setText("launcher-adhoc-prompt-label", t("launcherAdhocPromptLabel"));
  setText("launcher-adhoc-prompt-hint", t("launcherAdhocPromptHint"));
  if (elements.launcherAdhocPrompt) {
    elements.launcherAdhocPrompt.placeholder = t("launcherAdhocPromptHint");
  }
  setText("launcher-output-label", t("launcherOutputLabel"));
  setText("launcher-agents-label", t("launcherAgentsLabel"));
  setText("launcher-agents-note", t("launcherAgentsNote"));
  setText("launcher-probe-auth-label", t("launcherProbeAuthLabel"));
  setText("launcher-concurrency-label", t("launcherConcurrencyLabel"));
  if (elements.preflightTitle) {
    elements.preflightTitle.textContent = t("preflightTitle");
  }
  if (elements.advancedAnalysisSummary) {
    elements.advancedAnalysisSummary.textContent = t("advancedAnalysisSummary");
  }
  setText("compare-zone-eyebrow", t("compareZoneEyebrow"));
  setText("compare-zone-title", t("compareZoneTitle"));
  setText("compare-zone-description", t("compareZoneDescription"));
  setText("diagnostics-zone-eyebrow", t("diagnosticsZoneEyebrow"));
  setText("diagnostics-zone-title", t("diagnosticsZoneTitle"));
  setText("diagnostics-zone-description", t("diagnosticsZoneDescription"));
  setText("cross-run-compare-title", t("crossRunCompareTitle"));
  setText("cross-run-description", t("crossRunDescription"));
  if (elements.crossRunToggleSelect) {
    elements.crossRunToggleSelect.textContent = t("crossRunToggleSelect");
  }
  if (elements.crossRunSearch) {
    elements.crossRunSearch.placeholder = t("crossRunSearchPlaceholder");
  }
  if (elements.crossRunCompareBtn) {
    elements.crossRunCompareBtn.textContent = t("crossRunCompareBtn");
  }
  if (elements.crossRunClearBtn) {
    elements.crossRunClearBtn.textContent = t("crossRunClearBtn");
  }
  if (elements.crossRunCloseCompare) {
    elements.crossRunCloseCompare.textContent = t("crossRunCloseCompare");
  }
  setText("copy-share-card", t("copySummary"));
  setText("copy-pr-table", t("copyPrTable"));
  setText("download-share-svg", t("downloadShareSvg"));
  setTextBySelector('[data-i18n="teamCostCalculatorTitle"]', t("teamCostCalculatorTitle"));
  setTextBySelector('[data-i18n="teamSizeLabel"]', t("teamSizeLabel"));
  setTextBySelector('[data-i18n="dailyRunsLabel"]', t("dailyRunsLabel"));
  setTextBySelector('[data-i18n="recalculateBtn"]', t("recalculateBtn"));
  if (elements.sidebarToggle) {
    elements.sidebarToggle.setAttribute("aria-label", t("toggleSidebar"));
  }
  if (elements.themeToggle) {
    elements.themeToggle.setAttribute("aria-label", t("toggleTheme"));
  }
  if (elements.themeLabel) {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    elements.themeLabel.textContent = currentTheme === "dark" ? t("themeLabelLight") : t("themeLabelDark");
  }
  elements.judgeSearch.placeholder = t("judgeSearchPlaceholder");
  elements.languageSelect.value = state.language;
  elements.runCompareScope.options[0].text = t("runCompareScopeCurrent");
  elements.runCompareScope.options[1].text = t("runCompareScopeAll");
  elements.runCompareSort.options[0].text = t("runCompareSortCreated");
  elements.runCompareSort.options[1].text = t("runCompareSortSuccess");
  elements.runCompareSort.options[2].text = t("runCompareSortTokens");
  elements.runCompareSort.options[3].text = t("runCompareSortCost");
  elements.compareStatusFilter.options[0].text = t("compareStatusAll");
  elements.compareStatusFilter.options[1].text = t("compareStatusSuccess");
  elements.compareStatusFilter.options[2].text = t("compareStatusFailed");
  elements.compareSort.options[0].text = t("compareSortStatus");
  elements.compareSort.options[1].text = t("compareSortDuration");
  elements.compareSort.options[2].text = t("compareSortTokens");
  elements.compareSort.options[3].text = t("compareSortCost");
  elements.compareSort.options[4].text = t("compareSortChanged");
  elements.compareSort.options[5].text = t("compareSortJudges");
  if (elements.compareSort.options[6]) {
    elements.compareSort.options[6].text = t("compareSortPrecision");
  }
  elements.judgeTypeFilter.options[0].text = t("judgeTypeAll");
  elements.judgeStatusFilter.options[0].text = t("judgeStatusAll");
  elements.judgeStatusFilter.options[1].text = t("judgeStatusPass");
  elements.judgeStatusFilter.options[2].text = t("judgeStatusFail");
  elements.launcherRun.textContent = t("launcherRunButton");
  renderList(document.querySelector("#hero-how-list"), t("heroHowSteps"));
  renderScoreWeightsControls();
  // Render weight sliders on initial load
  renderWeightSliders(state.scoreWeights);
}

// fetchWithTimeout is imported from ./app-helpers.js

function formatJudgeType(type) { return formatJudgeTypeImpl(type, t); }
// statusClass imported from task-utils.js

// setHidden is imported from ./app-helpers.js

function sortRuns(runs) {
  return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function updateCurrentRun() {
  state.run = state.runs.find((run) => run.runId === state.selectedRunId) ?? null;
  if (!state.run) {
    state.selectedAgentId = null;
    return;
  }

  if (!state.run.results.some((result) => recordKey(result) === state.selectedAgentId)) {
    state.selectedAgentId = recordKey(state.run.results[0] ?? {}) ?? null;
  }
}

function applyRuns(runs, markdownByRunId = new Map()) {
  const locationState = readLocationState();
  state.runs = sortRuns(runs);
  state.markdownByRunId = markdownByRunId;
  const preferredRunId =
    locationState.runId && state.runs.some((run) => run.runId === locationState.runId)
      ? locationState.runId
      : state.selectedRunId;
  state.selectedRunId =
    preferredRunId && state.runs.some((run) => run.runId === preferredRunId)
      ? preferredRunId
      : state.runs[0]?.runId ?? null;
  if (locationState.agentId) {
    state.selectedAgentId = locationState.agentId;
  }
  updateCurrentRun();
  persistCachedRuns();
  syncLocationState(state);
  render();
}

function applySingleRun(run, markdown = null) {
  const existingRuns = state.runs.filter((entry) => entry.runId !== run.runId);
  const markdownByRunId = new Map(state.markdownByRunId);
  if (markdown) {
    markdownByRunId.set(run.runId, markdown);
  }
  applyRuns([run, ...existingRuns], markdownByRunId);

  // Load trace replay for the run
  if (traceReplay.isVisible()) {
    traceReplay.loadTraceForRun(run);
  }
}

async function renderCommunityView() {
  if (!elements.communitySection) return;
  if (!state.run) {
    setHidden(elements.communitySection, true);
    return;
  }

  const taskPackId = state.run.task?.id;
  if (!taskPackId) {
    setHidden(elements.communitySection, true);
    return;
  }

  setHidden(elements.communitySection, false);
  elements.communityEyebrow.textContent = t("communityEyebrow");
  elements.communityTitle.textContent = t("communityTitle");
  elements.communityDescription.textContent = t("communityDescription");

  // Check if we already have data for this task pack
  if (state.communityTaskPackId === taskPackId && state.communityData) {
    elements.communityStatus.textContent = "";
    renderCommunityLeaderboard(elements.communityContent, state.communityData, t, state.language);
    return;
  }

  // Guard against stale fetches overwriting newer data
  const requestId = ++state._communityRequestId;

  // Try cache first
  const cached = getCachedCommunityData(taskPackId);
  if (cached) {
    state.communityTaskPackId = taskPackId;
    state.communityData = cached;
    elements.communityStatus.textContent = "";
    renderCommunityLeaderboard(elements.communityContent, cached, t, state.language);
    return;
  }

  // Fetch from network
  if (!navigator.onLine) {
    elements.communityStatus.textContent = t("communityOffline");
    elements.communityContent.innerHTML = `<p class="community-empty">${t("communityNoData")}</p>`;
    return;
  }

  state.communityLoading = true;
  elements.communityStatus.textContent = t("communityLoading");
  elements.communityContent.innerHTML = "";

  try {
    const data = await fetchCommunityIndex(taskPackId);

    // Discard stale results if a newer request was made
    if (state._communityRequestId !== requestId) return;

    state.communityTaskPackId = taskPackId;
    state.communityData = data;
    state.communityLoading = false;
    state.communityError = null;

    if (data) {
      setCachedCommunityData(taskPackId, data);
      elements.communityStatus.textContent = "";
      renderCommunityLeaderboard(elements.communityContent, data, t, state.language);
    } else {
      elements.communityStatus.textContent = "";
      elements.communityContent.innerHTML = `<p class="community-empty">${t("communityNoData")}</p><p class="community-hint">${t("communityPublishHint")}</p>`;
    }
  } catch (error) {
    // Discard stale errors if a newer request was made
    if (state._communityRequestId !== requestId) return;

    state.communityLoading = false;
    state.communityError = error?.message ?? "Unknown error";
    elements.communityStatus.textContent = t("communityError");
    elements.communityContent.innerHTML = `<p class="community-empty">${t("communityNoData")}</p>`;
  }
}

/**
 * Master render function. Call order matters:
 *
 * 1. renderStaticText() — sets all i18n text nodes (no DOM dependency)
 * 2. renderLauncher()   — updates launcher panel (independent)
 * 3. renderRunList()    — builds run list DOM (creates elements used by dashboard)
 * 4. renderDashboard()  — reads run list DOM, renders comparison/verdict/agent detail
 * 5. renderCommunityView() — async fetch, renders community leaderboard
 *
 * DO NOT reorder without verifying that downstream functions don't depend on
 * DOM elements created by upstream functions. Specifically, renderDashboard()
 * reads elements that renderRunList() creates.
 */
function render() {
  renderStaticText();
  if (elements.resultLoaderMessage) {
    elements.resultLoaderMessage.textContent = state.notice ?? "";
    elements.resultLoaderMessage.hidden = !state.notice;
  }
  renderLauncher();
  renderRunList();

  if (!state.run) {
    setHidden(elements.runInfo, true);
    setHidden(elements.emptyState, false);
    setHidden(elements.dashboard, true);
    setHidden(elements.communitySection, true);
    traceReplay.hide(); // Clean up setInterval when navigating away
    elements.agentCount.textContent = "0";
    elements.agentList.className = "agent-list empty-state";
    elements.agentList.textContent = t("noReportLoaded");
    elements.runCompareTable.innerHTML = "";
    elements.runDiffTable.innerHTML = "";
    elements.agentTrendTitle.textContent = t("agentTrendTitle");
    elements.agentTrendTable.innerHTML = "";
    renderMarkdownPanel();
    return;
  }

  renderDashboard(state.run);
  renderCommunityView();
}

async function handleFileSelection(event) {
  return handleFileSelectionImpl(event);
}

async function handleMarkdownSelection(event) {
  return handleMarkdownSelectionImpl(event);
}

async function copyToClipboard(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    elements.clipboardStatus.textContent = t("summaryCopied", label);
  } catch (error) {
    elements.clipboardStatus.textContent = t("summaryCopyFailed", label);
    console.error(error);
  }
}

function downloadTextFile(filename, contents, mimeType) {
  return downloadTextFileImpl(filename, contents, mimeType);
}

async function handleFolderSelection(event) {
  return handleFolderSelectionImpl(event);
}

elements.fileInput.addEventListener("change", handleFileSelection);
elements.markdownInput.addEventListener("change", handleMarkdownSelection);
elements.folderInput.addEventListener("change", handleFolderSelection);
elements.launcherTaskSelect.addEventListener("change", (event) => {
  const value = String(event.target.value ?? "");
  if (value) {
    elements.launcherTaskPath.value = value;
    elements.launcherAdhocPromptField.style.display = "none";
  } else {
    elements.launcherAdhocPromptField.style.display = "";
    elements.launcherAdhocPromptLabel.textContent = t("launcherAdhocPromptLabel");
    elements.launcherAdhocPromptHint.textContent = t("customPromptHint");
    elements.launcherAdhocPrompt.placeholder = t("customPromptPlaceholder");
  }
  saveLauncherConfig();
  renderLauncher();
});
elements.launcherRepoPath.addEventListener("input", () => saveLauncherConfig());
elements.launcherTaskPath.addEventListener("input", () => saveLauncherConfig());
elements.launcherOutputPath.addEventListener("input", () => saveLauncherConfig());

function extractAgentConfigFromCard(buttonEl) {
  const card = buttonEl.closest(".variant-card");
  const role = buttonEl.getAttribute("data-role");

  // Real agent (no card container)
  if (role === "real-agent-test") {
    const agentId = buttonEl.getAttribute("data-agent-id");
    return { baseAgentId: agentId, displayLabel: agentId, config: {} };
  }

  if (!card) return null;

  // Determine agent type from card data attributes
  if (card.hasAttribute("data-codex-variant-id")) {
    return {
      baseAgentId: "codex",
      displayLabel: card.querySelector('[data-role="variant-label"]')?.value?.trim() || "Codex CLI",
      config: {
        model: card.querySelector('[data-role="variant-model"]')?.value?.trim() || undefined,
        reasoningEffort: card.querySelector('[data-role="variant-reasoning"]')?.value?.trim() || undefined,
      },
    };
  }
  if (card.hasAttribute("data-claude-variant-id")) {
    return {
      baseAgentId: "claude-code",
      displayLabel: card.querySelector('[data-role="claude-variant-label"]')?.value?.trim() || "Claude Code",
      config: {
        model: card.querySelector('[data-role="claude-variant-model"]')?.value?.trim() || undefined,
        providerProfileId: card.getAttribute("data-profile-id") || undefined,
      },
    };
  }
  if (card.hasAttribute("data-gemini-variant-id")) {
    return {
      baseAgentId: "gemini-cli",
      displayLabel: card.querySelector('[data-role="gemini-variant-label"]')?.value?.trim() || "Gemini CLI",
      config: { model: card.querySelector('[data-role="gemini-variant-model"]')?.value?.trim() || undefined },
    };
  }
  if (card.hasAttribute("data-aider-variant-id")) {
    return {
      baseAgentId: "aider",
      displayLabel: card.querySelector('[data-role="aider-variant-label"]')?.value?.trim() || "Aider",
      config: { model: card.querySelector('[data-role="aider-variant-model"]')?.value?.trim() || undefined },
    };
  }
  if (card.hasAttribute("data-kilo-variant-id")) {
    return {
      baseAgentId: "kilo-cli",
      displayLabel: card.querySelector('[data-role="kilo-variant-label"]')?.value?.trim() || "Kilo CLI",
      config: { model: card.querySelector('[data-role="kilo-variant-model"]')?.value?.trim() || undefined },
    };
  }
  if (card.hasAttribute("data-opencode-variant-id")) {
    return {
      baseAgentId: "opencode",
      displayLabel: card.querySelector('[data-role="opencode-variant-label"]')?.value?.trim() || "OpenCode",
      config: { model: card.querySelector('[data-role="opencode-variant-model"]')?.value?.trim() || undefined },
    };
  }

  return null;
}

function showPreflightToast(buttonEl, status, summary) {
  // Remove any existing toast on this card
  const existingToast = buttonEl.parentElement?.querySelector(".preflight-toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("span");
  toast.className = `preflight-toast ${status}`;
  const icon = status === "ready" ? "✓" : status === "unverified" ? "?" : "✗";
  const labelKey = `testConnection${status.charAt(0).toUpperCase() + status.slice(1)}`;
  toast.textContent = `${icon} ${t(labelKey)}`;
  if (summary) toast.title = summary;
  buttonEl.parentElement?.appendChild(toast);

  // Auto-remove after 5 seconds
  setTimeout(() => toast.remove(), 5000);
}

async function handleTestConnection(buttonEl) {
  const agentConfig = extractAgentConfigFromCard(buttonEl);
  if (!agentConfig) return;

  // Loading state with spinner
  const originalText = buttonEl.textContent;
  buttonEl.innerHTML = `<span class="spinner"></span> ${escapeHtml(t("testConnectionTesting"))}`;
  buttonEl.disabled = true;
  buttonEl.classList.add("testing");

  try {
    const response = await apiFetch("/api/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentConfig),
    });

    if (handleApiError(response)) return;

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      showPreflightToast(buttonEl, "error", err.error || `HTTP ${response.status}`);
      return;
    }

    const result = await response.json();
    showPreflightToast(buttonEl, result.status, result.summary);
  } catch (error) {
    showPreflightToast(buttonEl, "error", error?.message || "Network error");
  } finally {
    buttonEl.textContent = originalText;
    buttonEl.disabled = false;
    buttonEl.classList.remove("testing");
  }
}
elements.launcherProbeAuth.addEventListener("change", () => saveLauncherConfig());
elements.launcherScoreMode?.addEventListener("change", (event) => {
  state.launcherScoreMode = event.target.value;
  saveLauncherConfig();
});
elements.launcherAgents.addEventListener("change", (event) => {
  if (event.target?.id === "launcher-add-codex-variant") {
    return;
  }
  syncLauncherStateFromDom();
});
elements.launcherAgents.addEventListener("input", () => {
  syncLauncherStateFromDom();
});
elements.launcherAgents.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.id === "launcher-add-codex-variant") {
    state.launcherCodexVariants = [...state.launcherCodexVariants, defaultCodexVariant()];
    renderLauncher();
    return;
  }

  if (target.id === "launcher-add-gemini-variant") {
    state.launcherGeminiVariants = [...state.launcherGeminiVariants, defaultGeminiVariant()];
    renderLauncher();
    return;
  }

  if (target.id === "launcher-add-aider-variant") {
    state.launcherAiderVariants = [...state.launcherAiderVariants, defaultAiderVariant()];
    renderLauncher();
    return;
  }

  if (target.id === "launcher-add-kilo-variant") {
    state.launcherKiloVariants = [...state.launcherKiloVariants, defaultKiloVariant()];
    renderLauncher();
    return;
  }

  if (target.id === "launcher-add-opencode-variant") {
    state.launcherOpencodeVariants = [...state.launcherOpencodeVariants, defaultOpencodeVariant()];
    renderLauncher();
    return;
  }

  if (target.id === "launcher-add-provider") {
    openProviderEditor();
    renderLauncher();
    return;
  }

  if (target.getAttribute("data-role") === "provider-edit") {
    openProviderEditor(target.getAttribute("data-profile-id"));
    renderLauncher();
    return;
  }

  if (target.getAttribute("data-role") === "provider-cancel") {
    state.launcherProviderEditor = null;
    renderLauncher();
    return;
  }

  if (target.getAttribute("data-role") === "provider-save") {
    void (async () => {
      try {
        await saveProviderProfileFromEditor();
        state.notice = localText("Claude Provider 已保存。", "Claude provider saved.");
      } catch (error) {
        state.notice = error instanceof Error ? error.message : String(error);
      }
      render();
    })();
    return;
  }

  if (target.getAttribute("data-role") === "provider-delete") {
    const profileId = target.getAttribute("data-profile-id");
    if (!profileId) {
      return;
    }
    void (async () => {
      try {
        await deleteProviderProfileById(profileId);
        state.notice = localText("Claude Provider 已删除。", "Claude provider deleted.");
      } catch (error) {
        state.notice = error instanceof Error ? error.message : String(error);
      }
      render();
    })();
    return;
  }

  if (target.getAttribute("data-role") === "variant-remove") {
    const card = target.closest("[data-codex-variant-id]");
    const variantId = card?.getAttribute("data-codex-variant-id");
    state.launcherCodexVariants = state.launcherCodexVariants.filter((variant) => variant.id !== variantId);
    if (state.launcherCodexVariants.length === 0) {
      state.launcherCodexVariants = [defaultCodexVariant()];
    }
    renderLauncher();
  }

  if (target.getAttribute("data-role") === "gemini-variant-remove") {
    const card = target.closest("[data-gemini-variant-id]");
    const variantId = card?.getAttribute("data-gemini-variant-id");
    state.launcherGeminiVariants = state.launcherGeminiVariants.filter((variant) => variant.id !== variantId);
    if (state.launcherGeminiVariants.length === 0) {
      state.launcherGeminiVariants = [defaultGeminiVariant()];
    }
    renderLauncher();
  }

  if (target.getAttribute("data-role") === "aider-variant-remove") {
    const card = target.closest("[data-aider-variant-id]");
    const variantId = card?.getAttribute("data-aider-variant-id");
    state.launcherAiderVariants = state.launcherAiderVariants.filter((variant) => variant.id !== variantId);
    if (state.launcherAiderVariants.length === 0) {
      state.launcherAiderVariants = [defaultAiderVariant()];
    }
    renderLauncher();
  }

  if (target.getAttribute("data-role") === "kilo-variant-remove") {
    const card = target.closest("[data-kilo-variant-id]");
    const variantId = card?.getAttribute("data-kilo-variant-id");
    state.launcherKiloVariants = state.launcherKiloVariants.filter((variant) => variant.id !== variantId);
    if (state.launcherKiloVariants.length === 0) {
      state.launcherKiloVariants = [defaultKiloVariant()];
    }
    renderLauncher();
  }

  if (target.getAttribute("data-role") === "opencode-variant-remove") {
    const card = target.closest("[data-opencode-variant-id]");
    const variantId = card?.getAttribute("data-opencode-variant-id");
    state.launcherOpencodeVariants = state.launcherOpencodeVariants.filter((variant) => variant.id !== variantId);
    if (state.launcherOpencodeVariants.length === 0) {
      state.launcherOpencodeVariants = [defaultOpencodeVariant()];
    }
    renderLauncher();
  }

  // Test connection buttons
  const testRole = target.getAttribute("data-role");
  if (testRole?.endsWith("-variant-test") || testRole === "real-agent-test") {
    handleTestConnection(target);
  }
});
elements.launcherRun.addEventListener("click", handleLauncherRun);
elements.launcherToggle.addEventListener("click", () => {
  state.launcherExpanded = !state.launcherExpanded;
  renderLauncher();
});
elements.languageSelect.addEventListener("change", (event) => {
  state.language = String(event.target.value ?? "en");
  document.documentElement.lang = state.language === "zh-CN" ? "zh-CN" : "en";
  writeStorage("agentarena.webReport.language", state.language);
  syncLocationState(state, "push");
  render();
});

elements.runList.addEventListener("click", (event) => {
  const deleteBtn = event.target.closest("[data-role='delete-run']");
  if (deleteBtn) {
    event.stopPropagation();
    const runId = deleteBtn.getAttribute("data-run-id");
    const confirmMsg = t("deleteRunConfirm");
    if (!confirm(confirmMsg)) return;
    state.runs = state.runs.filter((r) => r.runId !== runId);
    state.markdownByRunId.delete(runId);
    if (state.selectedRunId === runId) {
      state.selectedRunId = state.runs[0]?.runId ?? null;
    }
    updateCurrentRun();
    persistCachedRuns();
    syncLocationState(state);
    render();
    return;
  }

  const exportBtn = event.target.closest("[data-role='export-run']");
  if (exportBtn) {
    event.stopPropagation();
    const runId = exportBtn.getAttribute("data-run-id");
    const run = state.runs.find((r) => r.runId === runId);
    if (run) {
      const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `summary-${runId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return;
  }

  const button = event.target.closest("[data-run-id]");
  if (!button) {
    return;
  }

  state.selectedRunId = button.getAttribute("data-run-id");
  updateCurrentRun();
  syncLocationState(state, "push");
  render();
  if (window.innerWidth <= 768) {
    state.sidebarOpen = false;
    elements.sidebar.classList.remove("sidebar-open");
    elements.sidebarBackdrop.classList.remove("active");
  }
});

// Run list search filter
elements.runSearch?.addEventListener("input", (event) => {
  state.runSearchQuery = String(event.target.value ?? "").trim().toLowerCase();
  renderRunList();
});

elements.runInfo.addEventListener("click", (event) => {
  const button = event.target.closest('button[data-role="restore-archived-score"]');
  if (!button || !state.run) {
    return;
  }

  if (state.run.scoreWeights) {
    state.scoreWeights = /** @type {Record<string, number>} */ ({ ...DEFAULT_SCORE_WEIGHTS, ...state.run.scoreWeights });
    saveScoreConfig();
    render();
  }
});

elements.agentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-agent-id]");
  if (!button || !state.run) return;
  selectAgent(button.getAttribute("data-agent-id"), state, selectionDeps);
  elements.agentCompareSection?.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.compareTable.addEventListener("click", (event) => {
  const viewFullLink = event.target.closest("[data-role='view-full-details']");
  if (viewFullLink) {
    event.preventDefault();
    elements.advancedAnalysis.open = true;
    elements.resultSummary.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const row = event.target.closest("[data-compare-agent-id]");
  if (!row || !state.run) {
    return;
  }

  const clickedId = row.getAttribute("data-compare-agent-id");
  if (clickedId === state.selectedAgentId) {
    state.expandedCompareAgentId =
      state.expandedCompareAgentId === clickedId ? null : clickedId;
    renderCompareTableV2(state.run);
    return;
  }

  state.expandedCompareAgentId = null;
  selectAgent(clickedId, state, selectionDeps);
});

elements.comparisonBars.addEventListener("click", (event) => {
  const barRow = event.target.closest("[data-bar-agent-id]");
  if (!barRow || !state.run) return;
  state.expandedCompareAgentId = null;
  selectAgent(barRow.getAttribute("data-bar-agent-id"), state, selectionDeps);
});

elements.compareTable.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("[data-compare-agent-id]");
  if (!row || !state.run) return;
  event.preventDefault();
  row.click();
});

elements.comparisonBars.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const barRow = event.target.closest("[data-bar-agent-id]");
  if (!barRow || !state.run) return;
  event.preventDefault();
  barRow.click();
});

elements.runCompareTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-compare-run-id]");
  if (!row) return;
  selectRun(row.getAttribute("data-compare-run-id"), state, selectionDeps);
});

elements.runDiffTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-run-diff-agent-id]");
  if (!row || !state.run) return;
  selectAgent(row.getAttribute("data-run-diff-agent-id"), state, selectionDeps);
});

elements.agentTrendTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-agent-trend-run-id]");
  if (!row) return;
  selectRun(row.getAttribute("data-agent-trend-run-id"), state, selectionDeps);
});

elements.judgeSearch.addEventListener("input", (event) => {
  judgeFilters.search = String(event.target.value ?? "").trim().toLowerCase();
  renderSelectedAgentV2();
});

elements.judgeTypeFilter.addEventListener("change", (event) => {
  judgeFilters.type = String(event.target.value ?? "all");
  renderSelectedAgentV2();
});

elements.judgeStatusFilter.addEventListener("change", (event) => {
  judgeFilters.status = String(event.target.value ?? "all");
  renderSelectedAgentV2();
});

elements.compareStatusFilter.addEventListener("change", (event) => {
  compareFilters.status = String(event.target.value ?? "all");
  if (state.run) {
    renderCompareTableV2(state.run);
  }
});

elements.compareSort.addEventListener("change", (event) => {
  compareFilters.sort = String(event.target.value ?? "status");
  if (state.run) {
    renderCompareTableV2(state.run);
  }
});

for (const [key, elementName] of Object.entries(scoreWeightElements)) {
  const debouncedUpdate = debounce((value) => updateScoreWeight(key, value), 150);
  elements[elementName]?.addEventListener("input", (event) => {
    debouncedUpdate(Number(event.target.value ?? 0));
  });
}

elements.scoreWeightsReset?.addEventListener("click", () => {
  state.scoreWeights = /** @type {Record<string, number>} */ ({ ...DEFAULT_SCORE_WEIGHTS });
  renderScoreWeightsControls();
  if (state.run) {
    renderVerdictHero(state.run);
    renderComparisonBars(state.run);
    renderCompareTableV2(state.run);
    renderSelectedAgentV2();
    renderRecommendationCard(state.run);
    renderMarkdownPanel();
  }
});

elements.scoreWeightPresets?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-score-preset]");
  if (!button) {
    return;
  }

  applyScorePreset(button.dataset.scorePreset);
});

elements.runCompareSort.addEventListener("change", (event) => {
  runCompareFilters.sort = String(event.target.value ?? "created");
  renderRunCompareTable();
});

elements.runCompareScope.addEventListener("change", (event) => {
  runCompareFilters.scope = String(event.target.value ?? "current-task");
  renderRunCompareTable();
});

elements.copyShareCard.addEventListener("click", async () => {
  if (!state.run) {
    return;
  }

    await copyToClipboard(buildShareCard(state.run, { scoreWeights: state.scoreWeights, scoreModeLabel: getScoreModeLabel() }), t("copySummary"));
});

elements.copyPrTable.addEventListener("click", async () => {
  if (!state.run) {
    return;
  }

    await copyToClipboard(buildPrTable(state.run, { scoreWeights: state.scoreWeights, scoreModeLabel: getScoreModeLabel() }), t("copyPrTable"));
});

elements.downloadShareSvg.addEventListener("click", () => {
  if (!state.run) {
    return;
  }

  const communityRank = state.communityData ? findCommunityRank(state.run, state.communityData) : null;
  downloadTextFile(
    `agentarena-${state.run.runId}.svg`,
    buildShareCardSvg(state.run, { scoreWeights: state.scoreWeights, scoreModeLabel: getScoreModeLabel(), communityRank }),
    "image/svg+xml"
  );
  elements.clipboardStatus.textContent = t("svgDownloaded");
});

const initialLocationState = readLocationState();
state.language = initialLocationState.language ?? readStorage("agentarena.webReport.language") ?? "zh-CN";
document.documentElement.lang = state.language === "zh-CN" ? "zh-CN" : "en";

const savedScoreConfig = loadScoreConfig();
if (savedScoreConfig?.scoreWeights) {
  state.scoreWeights = /** @type {Record<string, number>} */ ({ ...DEFAULT_SCORE_WEIGHTS, ...savedScoreConfig.scoreWeights });
}

const restoredCache = restoreCachedRuns();
if (restoredCache) {
  state.standaloneMarkdown = restoredCache.standaloneMarkdown;
  applyRuns(restoredCache.runs, restoredCache.markdownByRunId);
  state.notice = localText("已恢复最近一次缓存结果，可离线查看。", "Restored the latest cached report for offline viewing.");
} else {
  // localStorage 无缓存时，尝试从 IndexedDB 恢复
  restoreRunsFromIndexedDB().then((idbData) => {
    if (idbData && idbData.runs.length > 0 && state.runs.length === 0) {
      applyRuns(idbData.runs, idbData.markdownByRunId);
      state.notice = localText(
        "已从 IndexedDB 恢复历史数据。",
        "Restored history from IndexedDB."
      );
      render();
    }
  });
}

// 跨运行对比功能 — delegated to cross-run-events module
initCrossRunEvents({
  elements,
  state,
  getCrossRunCompareRows,
  clearCachedCommunityData,
  renderCommunityView,
  renderCrossRunCompareImpl,
  renderCrossRunSelectionListImpl
});

// Feature 5: Sidebar toggle for mobile
elements.sidebarToggle.addEventListener("click", () => {
  state.sidebarOpen = !state.sidebarOpen;
  elements.sidebar.classList.toggle("sidebar-open", state.sidebarOpen);
  elements.sidebarBackdrop.classList.toggle("active", state.sidebarOpen);
});

elements.sidebarBackdrop.addEventListener("click", () => {
  state.sidebarOpen = false;
  elements.sidebar.classList.remove("sidebar-open");
  elements.sidebarBackdrop.classList.remove("active");
});

// Error state handlers
elements.errorRetry?.addEventListener("click", () => {
  // Hide error, show empty state again
  setHidden(elements.errorState, true);
  setHidden(elements.emptyState, false);
});

elements.errorBack?.addEventListener("click", () => {
  // Reset to initial state
  setHidden(elements.errorState, true);
  setHidden(elements.emptyState, false);
  setHidden(elements.dashboard, true);
  state.run = null;
  state.runs = [];
  state.selectedRunId = null;
  state.selectedAgentId = null;
  state.notice = null;
  persistCachedRuns();
  syncLocationState(state);
  render();
});

// Demo button event listener
if (elements.tryDemoBtn) {
  elements.tryDemoBtn.addEventListener("click", () => {
    loadDemoData();
  });
} else {
  console.warn('try-demo-btn not found, retrying after DOM ready');
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector("#try-demo-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        loadDemoData();
      });
    }
  });
}

// Expose for debugging and HTML onclick (localhost only)
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  window.loadDemoData = loadDemoData;
  window.applyRuns = applyRuns;
  window.state = state;
}

// Theme toggle
const savedTheme = readStorage("theme") || "dark";
document.documentElement.setAttribute('data-theme', savedTheme);
if (elements.themeLabel) elements.themeLabel.textContent = savedTheme === "dark" ? t("themeLabelLight") : t("themeLabelDark");

elements.themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  writeStorage("theme", next);
  renderStaticText();
});

// Update banner handling
const updateBanner = document.getElementById('update-banner');
const updateReload = document.getElementById('update-reload');
if (updateReload) {
  updateReload.addEventListener('click', () => {
    const registration = globalThis.__agentarenaSwRegistration;
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  });
}

// Expose to SW update handler in index.html
globalThis.showUpdateBanner = (registration) => {
  if (registration) {
    globalThis.__agentarenaSwRegistration = registration;
  }
  if (updateBanner) {
    updateBanner.classList.remove('hidden');
  }
};

function hideUpdateBanner() {
  if (updateBanner) {
    updateBanner.classList.add('hidden');
  }
}
hideUpdateBanner();

// Trace Replay UI setup
traceReplay.setupEventListeners();

// Feature 2: Live validation on task select and agent changes
elements.launcherTaskSelect.addEventListener("change", () => {
  renderLauncherValidation(validateLauncher());
});
elements.launcherAgents.addEventListener("change", () => {
  renderLauncherValidation(validateLauncher());
});

window.addEventListener("popstate", () => {
  const locationState = readLocationState();
  state.language = locationState.language ?? readStorage("agentarena.webReport.language") ?? state.language;
  document.documentElement.lang = state.language === "zh-CN" ? "zh-CN" : "en";
  state.selectedRunId = locationState.runId;
  state.selectedAgentId = locationState.agentId;
  updateCurrentRun();
  render();
});

/**
 * Load demo data to showcase the UI functionality
 * Creates a simulated benchmark run with sample agents and results
 */
function loadDemoData() {
  if (elements.tryDemoBtn) {
    elements.tryDemoText.textContent = t("loadingDemo");
    elements.tryDemoBtn.disabled = true;
  }

  // Create demo run data from extracted module
  const demoRun = buildDemoRun({ defaultScoreWeights: DEFAULT_SCORE_WEIGHTS });

  // Apply the demo data
  setTimeout(() => {
    applyRuns([demoRun]);
    state.notice = localText(
      "演示数据已加载。这是一个模拟的 benchmark 结果，展示了 AgentArena 的主要功能。",
      "Demo data loaded. This is a simulated benchmark result showcasing AgentArena's main features."
    );
    
    if (elements.tryDemoBtn) {
      elements.tryDemoText.textContent = t("tryDemo");
      elements.tryDemoBtn.disabled = false;
    }
  }, 500); // Small delay for UX
}

// Initialize new modules
async function initNewModules() {
  // Initialize storage (IndexedDB)
  await resultStore.init();
  
  // Check if IndexedDB is available, show warning if not (Safari private mode)
  if (!resultStore.isAvailable()) {
    showIndexedDBWarning();
  }
  
  // Initialize judge registry
  await judgeRegistry.init();
  
  // Publish initial state
  stateManager.publish(RUN_LOADED, { runs: state.runs });
}

function showIndexedDBWarning() {
  const notice = document.createElement('div');
  notice.className = 'indexeddb-warning';

  const icon = document.createElement('span');
  icon.className = 'warning-icon';
  icon.textContent = '⚠️';

  const text = document.createElement('span');
  text.className = 'warning-text';
  text.textContent = state.language === 'zh-CN'
    ? '当前处于隐私模式，数据不会持久化保存。建议切换到普通模式以使用完整功能。'
    : 'You are in private mode. Data will not be persisted. Please switch to normal mode for full functionality.';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'warning-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => notice.remove());

  notice.append(icon, text, closeBtn);
  document.body.appendChild(notice);

  // Auto-remove after 10 seconds
  setTimeout(() => notice.remove(), 10000);
}

// Run initialization
detectService();
syncLocationState(state);
render();
initNewModules();
