/**
 * @module app-state
 *
 * Global application state for the AgentArena web-report SPA.
 *
 * IMPORTANT: This is the **single source of truth** for the state shape.
 * Every module that needs shared state imports this object and reads/writes
 * its properties directly. No module should create its own parallel state
 * objects, local caches of the same data, or independent reactive stores.
 *
 * Anti-patterns to avoid:
 *   - Creating a second object that shadows `state` fields
 *   - Caching a snapshot of state in module-level variables
 *   - Using separate event buses for state changes that belong here
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
  launcherGlobalModelOverride: "",
  launcherGlobalModelEnabled: false,
  launcherGlobalModelAgentIds: [],
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

/**
 * Return the canonical state object.
 *
 * Provided as a named accessor so callers that prefer a functional API
 * do not need to import the raw object. Identical to importing `state`
 * directly -- returns the same reference every time.
 *
 * @returns {typeof state} The shared state object.
 */
function getState() {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
    // In development, log a subtle hint if getState() is called
    // from a pattern that looks like it might be creating parallel state.
    // This is intentionally lenient -- it is a dev-only guard rail.
    if (new Error().stack?.includes("snapshot") || new Error().stack?.includes("cache")) {
      console.warn(
        "[app-state] getState() called from a context that references 'snapshot' or 'cache'. " +
        "Ensure you are not storing a copy of state -- always read from the live object."
      );
    }
  }
  return state;
}

/**
 * Merge a partial update into the canonical state object.
 *
 * Only properties present in `patch` are overwritten. This is a shallow
 * merge -- nested objects are replaced, not deep-merged.
 *
 * @param {Partial<typeof state>} patch - Fields to update.
 */
function setState(patch) {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
    for (const key of Object.keys(patch)) {
      if (!(key in state)) {
        console.warn(
          `[app-state] setState() setting unknown key "${key}". ` +
          "Add it to the state definition in app-state.js first."
        );
      }
    }
  }
  Object.assign(state, patch);
}

export { getState, setState, state };
