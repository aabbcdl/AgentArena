/**
 * @module app-state
 *
 * Global application state for the AgentArena web-report SPA.
 *
 * IMPORTANT: This is the single source of truth for the state shape.
 * Every module that needs shared state imports this object and reads/writes
 * its properties. No module should create its own parallel state.
 *
 * When adding a new state field:
 * 1. Add it here with a sensible default
 * 2. Document its purpose in the JSDoc below
 * 3. Add a comment in the module that writes to it
 */

import { DEFAULT_SCORE_WEIGHTS } from "./view-model/scoring.js";

/**
 * @type {Object} state
 *
 * Run data:
 * @property {Array} runs - All loaded benchmark runs
 * @property {Object|null} run - Currently selected run
 * @property {string|null} selectedRunId - ID of the selected run
 * @property {string|null} selectedAgentId - ID of the selected agent
 * @property {Map} markdownByRunId - Cached markdown per run ID
 * @property {string|null} standaloneMarkdown - Markdown from file upload (no run)
 *
 * UI / locale:
 * @property {string} language - Current language ("zh-CN" or "en")
 * @property {string|null} notice - Transient notice message
 *
 * Service / launcher:
 * @property {Object|null} serviceInfo - Server info from /api/ui-info
 * @property {Array} availableAdapters - Adapter list from /api/adapters
 * @property {Array} availableTaskPacks - Task pack list from /api/taskpacks
 * @property {Array} availableProviderProfiles - Claude provider profiles
 * @property {boolean} runInProgress - Whether a benchmark is running
 * @property {Object|null} runStatus - Current run status from polling
 * @property {number|null} runStatusPollTimer - Interval timer ID
 * @property {number} runStatusRequestSeq - Request sequence for race protection
 *
 * Launcher variant state:
 * @property {Array} launcherSelectedAgentIds - Non-variant agent IDs
 * @property {Array} launcherCodexVariants - Codex variant configs
 * @property {Array} launcherClaudeVariants - Claude provider variant configs
 * @property {Array} launcherGeminiVariants - Gemini variant configs
 * @property {Array} launcherAiderVariants - Aider variant configs
 * @property {Array} launcherKiloVariants - Kilo variant configs
 * @property {Array} launcherOpencodeVariants - OpenCode variant configs
 * @property {Object|null} launcherProviderEditor - Provider editor form state
 * @property {boolean} launcherExpanded - Whether launcher panel is expanded
 * @property {string} launcherScoreMode - Current score mode
 *
 * Cross-run comparison:
 * @property {boolean} crossRunSelectMode - Whether cross-run select is active
 * @property {Set} crossRunSelectedIds - Selected run IDs for comparison
 * @property {Object|null} crossRunCompareData - Computed cross-run comparison
 * @property {string|null} expandedCompareAgentId - Expanded agent in comparison
 *
 * Community:
 * @property {string|null} communityTaskPackId - Task pack for community data
 * @property {Object|null} communityData - Cached community index data
 * @property {boolean} communityLoading - Whether community data is loading
 * @property {string|null} communityError - Community fetch error message
 *
 * Layout:
 * @property {boolean} sidebarOpen - Whether mobile sidebar is open
 *
 * Scoring:
 * @property {Record<string, number>} scoreWeights - Current score weights
 *
 * Search:
 * @property {string} runSearchQuery - Run list search filter
 *
 * Internal:
 * @property {boolean} _launcherConfigRestored - Whether saved config has been loaded
 */
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
  launcherExpanded: false,
  launcherScoreMode: "practical",
  crossRunSelectMode: false,
  crossRunSelectedIds: new Set(),
  crossRunCompareData: null,
  expandedCompareAgentId: null,
  communityTaskPackId: null,
  communityData: null,
  communityLoading: false,
  communityError: null,
  _communityRequestId: 0,
  sidebarOpen: false,
  scoreWeights: /** @type {Record<string, number>} */ ({ ...DEFAULT_SCORE_WEIGHTS }),
  runSearchQuery: "",
  _launcherConfigRestored: false
};

export { state };
