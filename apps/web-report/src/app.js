import { translate } from "./i18n.js";
import { createLauncherModule } from "./launcher/module.js";
import { createCrossRunRenders } from "./report/cross-run.js";
import { createDashboardModule } from "./report/dashboard.js";
import { createDetailFragments } from "./report/detail-fragments.js";
import { createResultLoaders } from "./results/loaders.js";
import {
  baseAgentLabel,
  buildLeaderboard, 
  buildPrTable,
  buildShareCard,
  buildShareCardSvg,
  DEFAULT_SCORE_WEIGHTS,
  diffPrecisionScore,
  findJudgeByType,
  findPreviousComparableRun,
  formatCompositeScore,
  formatDiffPrecisionMetric,
  formatLintMetric,
  formatTestMetric,
  getAgentTrendRows,
  getCompareResults,
  getCompositeScoreReasons,
  getCrossRunCompareRows,
  getCrossRunRecommendation,
  getMatchingScorePresetId,
  getRunCompareRows,
  getRunToRunAgentDiff,
  getRunVerdict,
  getScoreWeightPreset,
  normalizeScoreWeights,
  resultLabel,
  resultRecordKey,
  runtimeIdentity,
  summarizeRun
} from "./view-model.js";

const state = {
  runs: [],
  run: null,
  selectedRunId: null,
  selectedAgentId: null,
  markdownByRunId: new Map(),
  standaloneMarkdown: null,
  language: "zh-CN",
  notice: null,
  serviceInfo: null,
  availableAdapters: [],
  availableTaskPacks: [],
  availableProviderProfiles: [],
  runInProgress: false,
  runStatus: null,
  runStatusPollTimer: null,
  runStatusRequestSeq: 0,
  launcherSelectedAgentIds: [],
  launcherCodexVariants: [],
  launcherClaudeVariants: [],
  launcherGeminiVariants: [],
  launcherAiderVariants: [],
  launcherKiloVariants: [],
  launcherOpencodeVariants: [],
  launcherProviderEditor: null,
  launcherExpanded: true,
  launcherScoreMode: "practical",
  crossRunSelectMode: false,
  crossRunSelectedIds: new Set(),
  crossRunCompareData: null,
  expandedCompareAgentId: null,
  sidebarOpen: false,
  scoreWeights: { ...DEFAULT_SCORE_WEIGHTS },
  runSearchQuery: ""
};

const elements = {
  fileInput: document.querySelector("#summary-file"),
  markdownInput: document.querySelector("#markdown-file"),
  folderInput: document.querySelector("#runs-folder"),
  languageSelect: document.querySelector("#language-select"),
  resultLoaderPanel: document.querySelector("#result-loader-panel"),
  resultLoaderSummary: document.querySelector("#result-loader-summary"),
  resultLoaderMessage: document.querySelector("#result-loader-message"),
  launcherPanel: document.querySelector("#launcher-panel"),
  launcherBody: document.querySelector("#launcher-body"),
  launcherToggle: document.querySelector("#launcher-toggle"),
  launcherCompactSummary: document.querySelector("#launcher-compact-summary"),
  launcherRepoPath: document.querySelector("#launcher-repo-path"),
  launcherTaskSelect: document.querySelector("#launcher-task-select"),
  taskPackDetail: document.querySelector("#task-pack-detail"),
  launcherTaskPath: document.querySelector("#launcher-task-path"),
  launcherAdhocPromptField: document.querySelector("#launcher-adhoc-prompt-field"),
  launcherAdhocPrompt: document.querySelector("#launcher-adhoc-prompt"),
  launcherAdhocPromptLabel: document.querySelector("#launcher-adhoc-prompt-label"),
  launcherAdhocPromptHint: document.querySelector("#launcher-adhoc-prompt-hint"),
  launcherConcurrencyLabel: document.querySelector("#launcher-concurrency-label"),
  launcherOutputPath: document.querySelector("#launcher-output-path"),
  launcherAgents: document.querySelector("#launcher-agents"),
  launcherProbeAuth: document.querySelector("#launcher-probe-auth"),
  launcherScoreMode: document.querySelector("#launcher-score-mode"),
  launcherRun: document.querySelector("#launcher-run"),
  launcherStatus: document.querySelector("#launcher-status"),
  launcherProgress: document.querySelector("#launcher-progress"),
  launcherProgressTitle: document.querySelector("#launcher-progress-title"),
  launcherCurrentAgent: document.querySelector("#launcher-current-agent"),
  launcherLogList: document.querySelector("#launcher-log-list"),
  launcherValidation: document.querySelector("#launcher-validation"),
  taskBrief: document.querySelector("#task-brief"),
  runInfo: document.querySelector("#run-info"),
  runList: document.querySelector("#run-list"),
  runCount: document.querySelector("#run-count"),
  runSearch: document.querySelector("#run-search"),
  loadingIndicator: document.querySelector("#loading-indicator"),
  loadingMessage: document.querySelector("#loading-message"),
  agentList: document.querySelector("#agent-list"),
  agentCount: document.querySelector("#agent-count"),
  emptyState: document.querySelector("#empty-state"),
  errorState: document.querySelector("#error-state"),
  errorTitle: document.querySelector("#error-title"),
  errorMessage: document.querySelector("#error-message"),
  errorRetry: document.querySelector("#error-retry"),
  errorBack: document.querySelector("#error-back"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeLabel: document.querySelector("#theme-label"),
  dashboard: document.querySelector("#dashboard"),
  taskTitle: document.querySelector("#task-title"),
  taskMeta: document.querySelector("#task-meta"),
  verdictHero: document.querySelector("#verdict-hero"),
  comparisonBars: document.querySelector("#comparison-bars"),
  failuresSection: document.querySelector("#failures-section"),
  advancedAnalysis: document.querySelector("#advanced-analysis"),
  runCompareScope: document.querySelector("#run-compare-scope"),
  runCompareSort: document.querySelector("#run-compare-sort"),
  runCompareTable: document.querySelector("#run-compare-table"),
  runCompareSection: document.querySelector("#run-compare-section"),
  runDiffTable: document.querySelector("#run-diff-table"),
  runDiffSection: document.querySelector("#run-diff-section"),
  preflights: document.querySelector("#preflights"),
  preflightSection: document.querySelector("#preflight-section"),
  compareStatusFilter: document.querySelector("#compare-status-filter"),
  compareSort: document.querySelector("#compare-sort"),
  compareSortHint: document.querySelector("#compare-sort-hint"),
  scoreWeightsTitle: document.querySelector("#score-weights-title"),
  scoreWeightsReset: document.querySelector("#score-weights-reset"),
  scoreWeightsSummary: document.querySelector("#score-weights-summary"),
  scoreWeightStatus: document.querySelector("#score-weight-status"),
  scoreWeightTests: document.querySelector("#score-weight-tests"),
  scoreWeightJudges: document.querySelector("#score-weight-judges"),
  scoreWeightLint: document.querySelector("#score-weight-lint"),
  scoreWeightPrecision: document.querySelector("#score-weight-precision"),
  scoreWeightDuration: document.querySelector("#score-weight-duration"),
  scoreWeightCost: document.querySelector("#score-weight-cost"),
  scoreWeightPresets: document.querySelector("#score-weight-presets"),
  compareTable: document.querySelector("#compare-table"),
  agentCompareSection: document.querySelector("#agent-compare-section"),
  agentTrendTitle: document.querySelector("#agent-trend-title"),
  agentTrendTable: document.querySelector("#agent-trend-table"),
  agentTrendSection: document.querySelector("#agent-trend-section"),
  preflightTitle: document.querySelector("#preflight-title"),
  resultSummary: document.querySelector("#result-summary"),
  resultDetails: document.querySelector("#result-details"),
  judgeSearch: document.querySelector("#judge-search"),
  judgeTypeFilter: document.querySelector("#judge-type-filter"),
  judgeStatusFilter: document.querySelector("#judge-status-filter"),
  markdownPanel: document.querySelector("#markdown-panel"),
  markdownStatus: document.querySelector("#markdown-status"),
  markdownHighlights: document.querySelector("#markdown-highlights"),
  markdownContent: document.querySelector("#markdown-content"),
  copyShareCard: document.querySelector("#copy-share-card"),
  copyPrTable: document.querySelector("#copy-pr-table"),
  downloadShareSvg: document.querySelector("#download-share-svg"),
  clipboardStatus: document.querySelector("#clipboard-status"),
  crossRunCompareSection: document.querySelector("#cross-run-compare-section"),
  crossRunCompareTitle: document.querySelector("#cross-run-compare-title"),
  crossRunDescription: document.querySelector("#cross-run-description"),
  crossRunToggleSelect: document.querySelector("#cross-run-toggle-select"),
  crossRunSelectionPanel: document.querySelector("#cross-run-selection-panel"),
  crossRunSearch: document.querySelector("#cross-run-search"),
  crossRunSelectionList: document.querySelector("#cross-run-selection-list"),
  crossRunCompareBtn: document.querySelector("#cross-run-compare-btn"),
  crossRunClearBtn: document.querySelector("#cross-run-clear-btn"),
  crossRunCompareView: document.querySelector("#cross-run-compare-view"),
  crossRunCompareSummary: document.querySelector("#cross-run-compare-summary"),
  crossRunCloseCompare: document.querySelector("#cross-run-close-compare"),
  crossRunCompareTable: document.querySelector("#cross-run-compare-table"),
  advancedAnalysisSummary: document.querySelector("#advanced-analysis-summary"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
  sidebar: document.querySelector(".sidebar")
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
  sort: "created",
  scope: "current-task"
};

function debounce(fn, delayMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

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

// Weight name mapping for slider labels
const WEIGHT_NAMES = {
  status: '状态',
  tests: '测试通过率',
  criticalJudges: '关键Judge',
  nonCriticalJudges: '非关键Judge',
  resolutionRate: '解决率',
  tokenEfficiency: 'Token效率',
  acceptanceRate: '接受率',
  categoryScore: '类别得分',
  duration: '耗时',
  cost: '成本',
  precision: '精确度',
  lint: '代码质量'
};

function t(key, ...args) {
  return translate(state.language, key, ...args);
}

function showLoading(message) {
  if (elements.loadingIndicator) elements.loadingIndicator.classList.remove('hidden');
  if (elements.loadingMessage) elements.loadingMessage.textContent = message;
}

function hideLoading() {
  if (elements.loadingIndicator) elements.loadingIndicator.classList.add('hidden');
}

function showError(message) {
  setHidden(elements.emptyState, true);
  setHidden(elements.dashboard, true);
  setHidden(elements.errorState, false);
  if (elements.errorTitle) elements.errorTitle.textContent = localText("加载失败", "Failed to load results");
  if (elements.errorMessage) elements.errorMessage.textContent = message;
}

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) {
    element.textContent = value;
  }
}

function renderList(element, items) {
  element.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

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

function formatElapsedDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatCost(result) {
  return result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a";
}

function getNormalizedScoreWeights() {
  return normalizeScoreWeights(state.scoreWeights);
}

function saveScoreConfig() {
  try {
    localStorage.setItem(
      "repoarena.webReport.scoreConfig",
      JSON.stringify({
        scoreWeights: state.scoreWeights
      })
    );
  } catch {
    // ignore localStorage failures
  }
}

function loadScoreConfig() {
  try {
    const raw = localStorage.getItem("repoarena.webReport.scoreConfig");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getScoreModeLabel() {
  const presetId = getMatchingScorePresetId(state.scoreWeights);
  switch (presetId) {
    case "balanced":
      return t("scorePresetBalanced");
    case "correctness-first":
      return t("scorePresetCorrectness");
    case "speed-first":
      return t("scorePresetSpeed");
    case "cost-first":
      return t("scorePresetCost");
    case "scope-discipline":
      return t("scorePresetScope");
    case "issue-resolution":
      return t("scorePresetIssueResolution");
    case "efficiency-first":
      return t("scorePresetEfficiencyFirst");
    case "rotating-tasks":
      return t("scorePresetRotatingTasks");
    case "comprehensive":
      return t("scorePresetComprehensive");
    default:
      return localText("自定义权重", "Custom Weights");
  }
}

function getArchivedScoreModeLabel(run) {
  const mode = run?.scoreMode ?? "balanced";
  switch (mode) {
    case "balanced":
      return t("scorePresetBalanced");
    case "correctness-first":
      return t("scorePresetCorrectness");
    case "speed-first":
      return t("scorePresetSpeed");
    case "cost-first":
      return t("scorePresetCost");
    case "scope-discipline":
      return t("scorePresetScope");
    case "issue-resolution":
      return t("scorePresetIssueResolution");
    case "efficiency-first":
      return t("scorePresetEfficiencyFirst");
    case "rotating-tasks":
      return t("scorePresetRotatingTasks");
    case "comprehensive":
      return t("scorePresetComprehensive");
    default:
      return mode;
  }
}

function renderScoreWeightsControls() {
  const normalized = getNormalizedScoreWeights();
  for (const [key, elementName] of Object.entries(scoreWeightElements)) {
    if (elements[elementName]) {
      elements[elementName].value = String(state.scoreWeights[key]);
    }
  }

  if (elements.scoreWeightsSummary) {
    elements.scoreWeightsSummary.textContent = t(
      "scoreWeightsSummary",
      normalized
    );
  }

  if (elements.scoreWeightPresets) {
    const activePreset = getMatchingScorePresetId(state.scoreWeights);

    for (const button of elements.scoreWeightPresets.querySelectorAll("button[data-score-preset]")) {
      button.classList.toggle("active", button.dataset.scorePreset === activePreset);
    }
  }
  
  // Update weight sliders if they exist
  renderWeightSliders(state.scoreWeights);
}

function updateScoreWeight(key, value) {
  state.scoreWeights[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  saveScoreConfig();
  renderScoreWeightsControls();
  if (state.run) {
    renderVerdictHero(state.run);
    renderComparisonBars(state.run);
    renderCompareTableV2(state.run);
    renderSelectedAgentV2();
    renderRecommendationCard(state.run);
    renderMarkdownPanel();
  }
}

function applyScorePreset(presetId) {
  state.scoreWeights = { ...getScoreWeightPreset(presetId) };
  saveScoreConfig();
  renderScoreWeightsControls();
  renderWeightSliders(state.scoreWeights);
  if (state.run) {
    renderVerdictHero(state.run);
    renderComparisonBars(state.run);
    renderCompareTableV2(state.run);
    renderSelectedAgentV2();
    renderRecommendationCard(state.run);
    renderMarkdownPanel();
  }
}

// Weight slider generation
function renderWeightSliders(weights) {
  const container = document.getElementById('weight-sliders');
  if (!container) return;
  
  container.innerHTML = '';
  
  for (const [key, value] of Object.entries(weights)) {
    if (value === 0) continue; // Skip zero weights
    
    const slider = document.createElement('div');
    slider.className = 'weight-slider';
    
    const label = document.createElement('label');
    const weightName = WEIGHT_NAMES[key] || key;
    const percentage = (value * 100).toFixed(0);
    label.innerHTML = `${weightName} <span class="weight-value">${percentage}%</span>`;
    
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = percentage;
    input.dataset.weight = key;
    
    input.addEventListener('input', (e) => {
      const newWeight = parseInt(e.target.value) / 100;
      state.scoreWeights[key] = newWeight;
      label.querySelector('.weight-value').textContent = `${(newWeight * 100).toFixed(0)}%`;
      saveScoreConfig();
      // Update preset buttons active state (will be none if custom)
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
    
    slider.appendChild(label);
    slider.appendChild(input);
    container.appendChild(slider);
  }
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

function translateDifficulty(d) {
  if (!d) return "";
  const map = { easy: localText("简单", "Easy"), medium: localText("中等", "Medium"), hard: localText("困难", "Hard") };
  return map[d] || d;
}

function translateStatus(s) {
  if (s === "success") return localText("成功", "success");
  if (s === "failed") return localText("失败", "failed");
  return s;
}

function providerDisplayName(profile) {
  if (!profile) {
    return localText("官方", "Official");
  }
  return profile.name;
}

function clientRandomId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function taskIntentSummary(task) {
  const objective = task.metadata?.objective ?? task.description ?? "";
  const rationale = task.metadata?.judgeRationale ?? "";
  const repoTypes = task.metadata?.repoTypes?.length ? task.metadata.repoTypes.join(", ") : "generic";
  return {
    objective,
    rationale,
    repoTypes
  };
}

function baselineTaskWarning(task) {
  if (task.id === "official-repo-health" || task.id === "repo-health") {
    return localText(
      "这不是代码审查，也不是 bugfix benchmark。它只检查 Agent 是否做了一个小改动，同时没有破坏仓库的基础结构。",
      "This is not a code review or bug-fix benchmark. It only checks whether the agent made one small improvement without breaking baseline repository structure."
    );
  }

  return localText(
    "先看任务目标和 Judge 依据，再解读 compare 结果。",
    "Read the task objective and judge rationale before interpreting the compare results."
  );
}

function taskMeaningBadges(task) {
  if (task.id === "official-repo-health" || task.id === "repo-health") {
    return [
      localText("基线健全性检查", "Baseline Sanity Check"),
      localText("不是代码审查", "Not a code review"),
      localText("不是 bugfix benchmark", "Not a bugfix benchmark")
    ];
  }

  return [localText("按任务目标解读结果", "Interpret results through the task goal")];
}

function summarizeTaskPrompt(prompt) {
  const compact = String(prompt ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!compact) {
    return "n/a";
  }

  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function summarizeJudges(taskPack) {
  const judges = Array.isArray(taskPack?.judges) ? taskPack.judges : [];
  if (judges.length === 0) {
    return localText("没有 judge", "No judges");
  }

  const labels = judges.map((judge) => judge.label || judge.id).filter(Boolean);
  const summary = labels.slice(0, 3).join(", ");
  if (labels.length <= 3) {
    return summary;
  }

  return localText(`${summary} 等共 ${labels.length} 项`, `${summary} +${labels.length - 3} more`);
}


function runFocusLine(run) {
  const verdict = getRunVerdict(run, { scoreWeights: state.scoreWeights });
  const best = verdict.bestAgent ? resultLabel(verdict.bestAgent) : "n/a";
  const fastest = verdict.fastest ? resultLabel(verdict.fastest) : "n/a";

  if (run.task.id === "official-repo-health" || run.task.id === "repo-health") {
    return localText(
      `这是一次 baseline sanity check，不是代码审查。当前综合最佳是 ${best}，最快是 ${fastest}。`,
      `This is a baseline sanity check, not a code review. Current best is ${best} and fastest is ${fastest}.`
    );
  }

  return localText(
    `先按任务目标解读结果。当前综合最佳是 ${best}，最快是 ${fastest}。`,
    `Interpret this run through the task objective first. Current best is ${best} and fastest is ${fastest}.`
  );
}

const crossRunRenders = createCrossRunRenders({
  state,
  elements,
  t,
  localText,
  setHidden,
  summarizeRun,
  runtimeIdentity,
  formatDuration,
  getCrossRunRecommendation,
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
  baseAgentLabel
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
  validateLauncher,
  renderLauncherValidation,
  handleQuickStart,
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
  getAgentTrendRows,
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

const {
  downloadTextFile: downloadTextFileImpl,
  handleFileSelection: handleFileSelectionImpl,
  handleMarkdownSelection: handleMarkdownSelectionImpl,
  handleFolderSelection: handleFolderSelectionImpl
} = resultLoaders;

function renderStaticText() {
  setText("result-loader-summary", t("existingResultsFallback"));
  setText("app-title", t("appTitle"));
  setText("app-description", t("appDescription"));
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
  setText("launcher-probe-auth-label", t("launcherProbeAuthLabel"));
  setText("launcher-concurrency-label", t("launcherConcurrencyLabel"));
  if (elements.preflightTitle) {
    elements.preflightTitle.textContent = t("preflightTitle");
  }
  if (elements.advancedAnalysisSummary) {
    elements.advancedAnalysisSummary.textContent = t("advancedAnalysisSummary");
  }
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

function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function formatJudgeType(type) {
  switch (type) {
    case "test-result":
      return localText("测试结果", "Test Result");
    case "lint-check":
      return localText("Lint 检查", "Lint Check");
    case "file-exists":
      return localText("文件存在", "File Exists");
    case "file-contains":
      return localText("文件包含内容", "File Contains");
    case "json-value":
      return localText("JSON 值断言", "JSON Value");
    case "glob":
      return localText("Glob 匹配", "Glob");
    case "file-count":
      return localText("文件数量", "File Count");
    case "snapshot":
      return localText("快照", "Snapshot");
    case "json-schema":
      return localText("JSON Schema", "JSON Schema");
    default:
      return localText("命令", "Command");
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

  if (!state.run.results.some((result) => recordKey(result) === state.selectedAgentId)) {
    state.selectedAgentId = recordKey(state.run.results[0] ?? {}) ?? null;
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
    // Always hide hero when no run is loaded - the launcher will show instead
    setHidden(elements.emptyState, true);
    setHidden(elements.dashboard, true);
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
    elements.clipboardStatus.textContent = localText(`${label} 已复制。`, `${label} copied.`);
  } catch (error) {
    elements.clipboardStatus.textContent = localText(
      `${label} 复制失败。`,
      `Failed to copy ${label.toLowerCase()}.`
    );
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
    elements.launcherAdhocPromptLabel.textContent = localText("自定义提示词", "Custom Prompt");
    elements.launcherAdhocPromptHint.textContent = localText(
      "输入提示词后，系统会自动生成临时任务包并下发给选中的 Agent 执行。",
      "Enter your prompt and the system will create a temporary task pack and dispatch it to the selected agents."
    );
    elements.launcherAdhocPrompt.placeholder = localText(
      "输入你想让 Agent 执行的任务描述...",
      "Describe the task you want the agents to perform..."
    );
  }
  saveLauncherConfig();
  renderLauncher();
});
elements.launcherRepoPath.addEventListener("input", () => saveLauncherConfig());
elements.launcherTaskPath.addEventListener("input", () => saveLauncherConfig());
elements.launcherOutputPath.addEventListener("input", () => saveLauncherConfig());
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
});
elements.launcherRun.addEventListener("click", handleLauncherRun);
elements.launcherToggle.addEventListener("click", () => {
  state.launcherExpanded = !state.launcherExpanded;
  renderLauncher();
});
elements.languageSelect.addEventListener("change", (event) => {
  state.language = String(event.target.value ?? "en");
  document.documentElement.lang = state.language === "zh-CN" ? "zh-CN" : "en";
  try {
    localStorage.setItem("repoarena.webReport.language", state.language);
  } catch {
    // ignore localStorage failures
  }
  render();
});

elements.runList.addEventListener("click", (event) => {
  const deleteBtn = event.target.closest("[data-role='delete-run']");
  if (deleteBtn) {
    event.stopPropagation();
    const runId = deleteBtn.getAttribute("data-run-id");
    const confirmMsg = localText("确定删除这个 run？此操作不可撤销。", "Delete this run? This cannot be undone.");
    if (!confirm(confirmMsg)) return;
    state.runs = state.runs.filter((r) => r.runId !== runId);
    state.markdownByRunId.delete(runId);
    if (state.selectedRunId === runId) {
      state.selectedRunId = state.runs[0]?.runId ?? null;
    }
    updateCurrentRun();
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
    state.scoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...state.run.scoreWeights };
    saveScoreConfig();
    render();
  }
});

elements.agentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-agent-id]");
  if (!button || !state.run) {
    return;
  }

  state.selectedAgentId = button.getAttribute("data-agent-id");
  renderAgentList(state.run);
  renderCompareTableV2(state.run);
  renderAgentTrendTableV2(state.run);
  renderSelectedAgentV2();
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, state.run, state.selectedAgentId).length <= 1
  );
  // Scroll to compare table to show filter result
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

  state.selectedAgentId = clickedId;
  state.expandedCompareAgentId = null;
  renderAgentList(state.run);
  renderCompareTableV2(state.run);
  renderAgentTrendTableV2(state.run);
  renderSelectedAgentV2();
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, state.run, state.selectedAgentId).length <= 1
  );
});

elements.comparisonBars.addEventListener("click", (event) => {
  const barRow = event.target.closest("[data-bar-agent-id]");
  if (!barRow || !state.run) {
    return;
  }

  state.selectedAgentId = barRow.getAttribute("data-bar-agent-id");
  state.expandedCompareAgentId = null;
  renderAgentList(state.run);
  renderCompareTableV2(state.run);
  renderComparisonBars(state.run);
  renderAgentTrendTableV2(state.run);
  renderSelectedAgentV2();
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, state.run, state.selectedAgentId).length <= 1
  );
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
  if (!row) {
    return;
  }

  state.selectedRunId = row.getAttribute("data-compare-run-id");
  updateCurrentRun();
  render();
});

elements.runDiffTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-run-diff-agent-id]");
  if (!row || !state.run) {
    return;
  }

  state.selectedAgentId = row.getAttribute("data-run-diff-agent-id");
  renderAgentList(state.run);
  renderCompareTableV2(state.run);
  renderRunDiffTableV2();
  renderAgentTrendTableV2(state.run);
  renderSelectedAgentV2();
  setHidden(
    elements.agentTrendSection,
    !state.selectedAgentId || getAgentTrendRows(state.runs, state.run, state.selectedAgentId).length <= 1
  );
});

elements.agentTrendTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-agent-trend-run-id]");
  if (!row) {
    return;
  }

  state.selectedRunId = row.getAttribute("data-agent-trend-run-id");
  updateCurrentRun();
  render();
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
  state.scoreWeights = { ...DEFAULT_SCORE_WEIGHTS };
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

    await copyToClipboard(buildShareCard(state.run, { scoreWeights: state.scoreWeights, scoreModeLabel: getScoreModeLabel() }), localText("摘要", "Summary"));
});

elements.copyPrTable.addEventListener("click", async () => {
  if (!state.run) {
    return;
  }

    await copyToClipboard(buildPrTable(state.run, { scoreWeights: state.scoreWeights, scoreModeLabel: getScoreModeLabel() }), localText("PR 表格", "PR table"));
});

elements.downloadShareSvg.addEventListener("click", () => {
  if (!state.run) {
    return;
  }

  downloadTextFile(
    `repoarena-${state.run.runId}.svg`,
    buildShareCardSvg(state.run, { scoreWeights: state.scoreWeights, scoreModeLabel: getScoreModeLabel() }),
    "image/svg+xml"
  );
  elements.clipboardStatus.textContent = localText("分享 SVG 已下载。", "Share SVG downloaded.");
});

try {
  state.language = localStorage.getItem("repoarena.webReport.language") || "zh-CN";
} catch {
  state.language = "zh-CN";
}
document.documentElement.lang = state.language === "zh-CN" ? "zh-CN" : "en";

const savedScoreConfig = loadScoreConfig();
if (savedScoreConfig?.scoreWeights) {
  state.scoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...savedScoreConfig.scoreWeights };
}

// 跨运行对比功能
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
  
  state.crossRunCompareData = getCrossRunCompareRows(selectedRuns);
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

function renderCrossRunCompare() {
  return renderCrossRunCompareImpl();
}

function renderCrossRunSelectionList() {
  return renderCrossRunSelectionListImpl();
}

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
  render();
});

// Theme toggle
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
if (elements.themeLabel) elements.themeLabel.textContent = savedTheme === 'dark' ? 'Light' : 'Dark';

elements.themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  if (elements.themeLabel) elements.themeLabel.textContent = next === 'dark' ? 'Light' : 'Dark';
});

// Feature 2: Live validation on task select and agent changes
elements.launcherTaskSelect.addEventListener("change", () => {
  renderLauncherValidation(validateLauncher());
});
elements.launcherAgents.addEventListener("change", () => {
  renderLauncherValidation(validateLauncher());
});

detectService();
render();
