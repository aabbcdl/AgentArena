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
 */

/** @type {Record<string, HTMLElement|null>} */
const elements = {
  // File inputs
  fileInput: document.querySelector("#summary-file"),
  markdownInput: document.querySelector("#markdown-file"),
  folderInput: document.querySelector("#runs-folder"),
  languageSelect: document.querySelector("#language-select"),

  // Result loader
  resultLoaderPanel: document.querySelector("#result-loader-panel"),
  resultLoaderSummary: document.querySelector("#result-loader-summary"),
  resultLoaderMessage: document.querySelector("#result-loader-message"),

  // Launcher
  launcherPanel: document.querySelector("#launcher-panel"),
  launcherBody: document.querySelector("#launcher-body"),
  launcherToggle: document.querySelector("#launcher-toggle"),
  launcherCompactSummary: document.querySelector("#launcher-compact-summary"),
  launcherRepoPath: document.querySelector("#launcher-repo-path"),
  launcherUseBuiltin: document.querySelector("#launcher-use-builtin"),
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

  // Run info & navigation
  runInfo: document.querySelector("#run-info"),
  runList: document.querySelector("#run-list"),
  runCount: document.querySelector("#run-count"),
  runSearch: document.querySelector("#run-search"),
  loadingIndicator: document.querySelector("#loading-indicator"),
  loadingMessage: document.querySelector("#loading-message"),
  agentList: document.querySelector("#agent-list"),
  agentCount: document.querySelector("#agent-count"),
  emptyState: document.querySelector("#empty-state"),

  // Theme
  themeToggle: document.querySelector("#theme-toggle"),
  themeLabel: document.querySelector("#theme-label"),

  // Demo hint
  tryDemoBtn: document.querySelector("#try-demo-btn"),
  tryDemoText: document.querySelector("#try-demo-text"),
  demoHint: document.querySelector("#demo-hint"),

  // Dashboard
  dashboard: document.querySelector("#dashboard"),
  taskTitle: document.querySelector("#task-title"),
  taskMeta: document.querySelector("#task-meta"),
  summaryCard: document.querySelector("#summary-card"),
  verdictHero: document.querySelector("#verdict-hero"),

  // Leaderboard
  leaderboardSection: document.querySelector("#leaderboard-section"),
  leaderboardTitle: document.querySelector("#leaderboard-title"),
  leaderboardContent: document.querySelector("#leaderboard-content"),

  // Comparison & analysis
  comparisonBars: document.querySelector("#comparison-bars"),
  failuresSection: document.querySelector("#failures-section"),
  advancedAnalysis: document.querySelector("#advanced-analysis"),

  // Run compare
  runCompareScope: document.querySelector("#run-compare-scope"),
  runCompareSort: document.querySelector("#run-compare-sort"),
  runCompareTable: document.querySelector("#run-compare-table"),
  runCompareSection: document.querySelector("#run-compare-section"),
  runDiffTable: document.querySelector("#run-diff-table"),
  runDiffSection: document.querySelector("#run-diff-section"),

  // Preflights
  preflights: document.querySelector("#preflights"),
  preflightSection: document.querySelector("#preflight-section"),

  // Agent compare
  compareStatusFilter: document.querySelector("#compare-status-filter"),
  compareSort: document.querySelector("#compare-sort"),
  compareSortHint: document.querySelector("#compare-sort-hint"),

  // Score weights
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

  // Compare table
  compareTable: document.querySelector("#compare-table"),
  agentCompareSection: document.querySelector("#agent-compare-section"),
  agentTrendTitle: document.querySelector("#agent-trend-title"),
  agentTrendTable: document.querySelector("#agent-trend-table"),
  agentTrendSection: document.querySelector("#agent-trend-section"),
  preflightTitle: document.querySelector("#preflight-title"),

  // Result details
  resultSummary: document.querySelector("#result-summary"),
  resultDetails: document.querySelector("#result-details"),
  judgeSearch: document.querySelector("#judge-search"),
  judgeTypeFilter: document.querySelector("#judge-type-filter"),
  judgeStatusFilter: document.querySelector("#judge-status-filter"),

  // Markdown panel
  markdownPanel: document.querySelector("#markdown-panel"),
  markdownStatus: document.querySelector("#markdown-status"),
  markdownHighlights: document.querySelector("#markdown-highlights"),
  markdownContent: document.querySelector("#markdown-content"),

  // Share / copy actions
  copyShareCard: document.querySelector("#copy-share-card"),
  copyPrTable: document.querySelector("#copy-pr-table"),
  downloadShareSvg: document.querySelector("#download-share-svg"),
  clipboardStatus: document.querySelector("#clipboard-status"),

  // Cross-run comparison
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

  // Community
  communitySection: document.querySelector("#community-section"),
  communityEyebrow: document.querySelector("#community-eyebrow"),
  communityTitle: document.querySelector("#community-title"),
  communityDescription: document.querySelector("#community-description"),
  communityRefresh: document.querySelector("#community-refresh"),
  communityStatus: document.querySelector("#community-status"),
  communityContent: document.querySelector("#community-content"),
  advancedAnalysisSummary: document.querySelector("#advanced-analysis-summary"),

  // Sidebar
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
  sidebar: document.querySelector(".sidebar"),
  skipLink: document.querySelector("#skip-link"),
  agentListHint: document.querySelector("#agent-list-hint"),
  updateBannerText: document.querySelector("#update-banner-text"),

  // Sticky benchmark bar
  stickyBenchmarkBar: document.querySelector("#sticky-benchmark-bar"),
  stickyBarSummary: document.querySelector("#sticky-bar-summary"),
  stickyBarRunBtn: document.querySelector("#sticky-bar-run-btn"),
  stickyBarRunText: document.querySelector("#sticky-bar-run-text")
};

export { elements };
