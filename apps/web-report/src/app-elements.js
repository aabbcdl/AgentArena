/**
 * @module app-elements
 *
 * DOM element cache for the AgentArena web-report SPA.
 *
 * IMPORTANT: All document.querySelector calls are concentrated here.
 * No other module should call document.querySelector — import from here instead.
 * This makes it easy to find which DOM elements the app depends on
 * and prevents stale references.
 *
 * When adding a new DOM element:
 * 1. Add it here with a descriptive key name
 * 2. Use the CSS ID selector as the query
 * 3. Import from this module where needed
 *
 * NOTE: document.querySelector() returns Element | null, but we cast to
 * HTMLElement because all queried elements are HTML elements. This avoids
 * TS2322 "Element is not assignable to HTMLElement" errors in checkJs mode.
 *
 * NULL GUARD: If a selector matches no element in the DOM, a console warning
 * is emitted in development mode. The cached value remains null — consumers
 * must still null-check before use. This catches missing HTML elements early
 * without crashing the app at init time.
 */

/**
 * Query a single DOM element by selector, emitting a dev-mode warning
 * when the element is not found. Returns null (not an exception) so
 * the app can degrade gracefully.
 *
 * @param {string} selector - CSS selector (typically an ID like "#foo")
 * @returns {HTMLElement|null}
 */
function queryElement(selector) {
  const el = /** @type {HTMLElement|null} */ (document.querySelector(selector));
  if (!el) {
    console.warn(
      `[app-elements] DOM element not found: "${selector}". ` +
      "Check that the HTML includes this element. The app will degrade gracefully."
    );
  }
  return el;
}

/** @type {Record<string, HTMLElement|null>} */
const elements = {
  // File inputs
  fileInput: queryElement("#summary-file"),
  markdownInput: queryElement("#markdown-file"),
  folderInput: queryElement("#runs-folder"),
  languageSelect: queryElement("#language-select"),

  // Result loader
  resultLoaderPanel: queryElement("#result-loader-panel"),
  resultLoaderSummary: queryElement("#result-loader-summary"),
  resultLoaderMessage: queryElement("#result-loader-message"),

  // Launcher
  launcherPanel: queryElement("#launcher-panel"),
  launcherBody: queryElement("#launcher-body"),
  launcherToggle: queryElement("#launcher-toggle"),
  launcherCompactSummary: queryElement("#launcher-compact-summary"),
  launcherRepoPath: queryElement("#launcher-repo-path"),
  launcherUseBuiltin: queryElement("#launcher-use-builtin"),
  launcherTaskSelect: queryElement("#launcher-task-select"),
  taskPackDetail: queryElement("#task-pack-detail"),
  launcherTaskPath: queryElement("#launcher-task-path"),
  launcherAdhocPromptField: queryElement("#launcher-adhoc-prompt-field"),
  launcherAdhocPrompt: queryElement("#launcher-adhoc-prompt"),
  launcherAdhocPromptLabel: queryElement("#launcher-adhoc-prompt-label"),
  launcherAdhocPromptHint: queryElement("#launcher-adhoc-prompt-hint"),
  launcherConcurrencyLabel: queryElement("#launcher-concurrency-label"),
  launcherOutputPath: queryElement("#launcher-output-path"),
  launcherAgents: queryElement("#launcher-agents"),
  launcherProbeAuth: queryElement("#launcher-probe-auth"),
  launcherScoreMode: queryElement("#launcher-score-mode"),
  launcherRun: queryElement("#launcher-run"),
  launcherStatus: queryElement("#launcher-status"),
  launcherProgress: queryElement("#launcher-progress"),
  launcherProgressTitle: queryElement("#launcher-progress-title"),
  launcherCurrentAgent: queryElement("#launcher-current-agent"),
  launcherLogList: queryElement("#launcher-log-list"),
  launcherValidation: queryElement("#launcher-validation"),
  taskBrief: queryElement("#task-brief"),

  // Run info & navigation
  runInfo: queryElement("#run-info"),
  runList: queryElement("#run-list"),
  runCount: queryElement("#run-count"),
  runSearch: queryElement("#run-search"),
  loadingIndicator: queryElement("#loading-indicator"),
  loadingMessage: queryElement("#loading-message"),
  agentList: queryElement("#agent-list"),
  agentCount: queryElement("#agent-count"),
  emptyState: queryElement("#empty-state"),

  // Theme
  themeSelect: queryElement("#theme-select"),

  // Demo hint
  tryDemoBtn: queryElement("#try-demo-btn"),
  tryDemoText: queryElement("#try-demo-text"),
  demoHint: queryElement("#demo-hint"),

  // Dashboard
  dashboard: queryElement("#dashboard"),
  taskTitle: queryElement("#task-title"),
  taskMeta: queryElement("#task-meta"),
  summaryCard: queryElement("#summary-card"),
  taskTrace: queryElement("#task-trace"),
  verdictHero: queryElement("#verdict-hero"),
  backToLauncher: queryElement("#back-to-launcher"),

  // Leaderboard
  leaderboardSection: queryElement("#leaderboard-section"),
  leaderboardTitle: queryElement("#leaderboard-title"),
  leaderboardContent: queryElement("#leaderboard-content"),

  // Comparison & analysis
  comparisonBars: queryElement("#comparison-bars"),
  failuresSection: queryElement("#failures-section"),
  advancedAnalysis: queryElement("#advanced-analysis"),

  // Run compare
  runCompareScope: queryElement("#run-compare-scope"),
  runCompareSort: queryElement("#run-compare-sort"),
  runCompareTable: queryElement("#run-compare-table"),
  runCompareSection: queryElement("#run-compare-section"),
  runDiffTable: queryElement("#run-diff-table"),
  runDiffSection: queryElement("#run-diff-section"),

  // Preflights
  preflights: queryElement("#preflights"),
  preflightSection: queryElement("#preflight-section"),

  // Agent compare
  compareStatusFilter: queryElement("#compare-status-filter"),
  compareSort: queryElement("#compare-sort"),
  compareSortHint: queryElement("#compare-sort-hint"),

  // Score weights
  scoreWeightsTitle: queryElement("#score-weights-title"),
  scoreWeightsReset: queryElement("#score-weights-reset"),
  scoreWeightsSummary: queryElement("#score-weights-summary"),
  scoreWeightStatus: queryElement("#score-weight-status"),
  scoreWeightTests: queryElement("#score-weight-tests"),
  scoreWeightJudges: queryElement("#score-weight-judges"),
  scoreWeightLint: queryElement("#score-weight-lint"),
  scoreWeightPrecision: queryElement("#score-weight-precision"),
  scoreWeightDuration: queryElement("#score-weight-duration"),
  scoreWeightCost: queryElement("#score-weight-cost"),
  scoreWeightPresets: queryElement("#score-weight-presets"),

  // Compare table
  compareTable: queryElement("#compare-table"),
  agentCompareSection: queryElement("#agent-compare-section"),
  agentTrendTitle: queryElement("#agent-trend-title"),
  agentTrendTable: queryElement("#agent-trend-table"),
  agentTrendSection: queryElement("#agent-trend-section"),
  preflightTitle: queryElement("#preflight-title"),

  // Result details
  resultSummary: queryElement("#result-summary"),
  resultDetails: queryElement("#result-details"),
  judgeSearch: queryElement("#judge-search"),
  judgeTypeFilter: queryElement("#judge-type-filter"),
  judgeStatusFilter: queryElement("#judge-status-filter"),

  // Markdown panel
  markdownPanel: queryElement("#markdown-panel"),
  markdownStatus: queryElement("#markdown-status"),
  markdownHighlights: queryElement("#markdown-highlights"),
  markdownContent: queryElement("#markdown-content"),

  // Share / copy actions
  copyShareCard: queryElement("#copy-share-card"),
  copyPrTable: queryElement("#copy-pr-table"),
  downloadShareSvg: queryElement("#download-share-svg"),
  clipboardStatus: queryElement("#clipboard-status"),

  // Cross-run comparison
  crossRunCompareSection: queryElement("#cross-run-compare-section"),
  crossRunCompareTitle: queryElement("#cross-run-compare-title"),
  crossRunDescription: queryElement("#cross-run-description"),
  crossRunToggleSelect: queryElement("#cross-run-toggle-select"),
  crossRunSelectionPanel: queryElement("#cross-run-selection-panel"),
  crossRunSearch: queryElement("#cross-run-search"),
  crossRunSelectionList: queryElement("#cross-run-selection-list"),
  crossRunCompareBtn: queryElement("#cross-run-compare-btn"),
  crossRunClearBtn: queryElement("#cross-run-clear-btn"),
  crossRunCompareView: queryElement("#cross-run-compare-view"),
  crossRunCompareSummary: queryElement("#cross-run-compare-summary"),
  crossRunCloseCompare: queryElement("#cross-run-close-compare"),
  crossRunCompareTable: queryElement("#cross-run-compare-table"),

  // Community
  communitySection: queryElement("#community-section"),
  communityEyebrow: queryElement("#community-eyebrow"),
  communityTitle: queryElement("#community-title"),
  communityDescription: queryElement("#community-description"),
  communityRefresh: queryElement("#community-refresh"),
  communityStatus: queryElement("#community-status"),
  communityContent: queryElement("#community-content"),
  advancedAnalysisSummary: queryElement("#advanced-analysis-summary"),

  // Sidebar
  sidebarToggle: queryElement("#sidebar-toggle"),
  sidebarBackdrop: queryElement("#sidebar-backdrop"),
  sidebar: queryElement(".sidebar"),
  skipLink: queryElement("#skip-link"),
  agentListHint: queryElement("#agent-list-hint"),
  updateBannerText: queryElement("#update-banner-text"),

  // Sticky benchmark bar
  stickyBenchmarkBar: queryElement("#sticky-benchmark-bar"),
  stickyBarSummary: queryElement("#sticky-bar-summary"),
  stickyBarRunBtn: queryElement("#sticky-bar-run-btn"),
  stickyBarRunText: queryElement("#sticky-bar-run-text")
};

export { elements };
