/**
 * @module app-helpers
 *
 * Shared utility functions for the AgentArena web-report SPA.
 *
 * Extracted from app.js to reduce its cognitive load.
 * These are pure-ish functions with minimal dependencies.
 */

// ---------------------------------------------------------------------------
// Cache constants
// ---------------------------------------------------------------------------

const _RUN_CACHE_STORAGE_KEY = "agentarena.webReport.cachedRuns.v1";
const _RUN_CACHE_MAX_BYTES = 1_500_000;

// ---------------------------------------------------------------------------
// Auth / API
// ---------------------------------------------------------------------------

/**
 * Get auth token from URL hash or localStorage.
 * If found in hash, persists to localStorage and clears the hash.
 * @returns {string}
 */
function getAuthToken() {
  const hash = window.location.hash;
  if (hash) {
    const match = hash.match(/[#&]token=([^&]+)/);
    if (match) {
      localStorage.setItem('agentarena_token', match[1]);
      window.location.hash = '';
      return match[1];
    }
  }
  return localStorage.getItem('agentarena_token') || '';
}

/**
 * Handle API error responses (401 = auth redirect).
 * @param {Response} response
 * @returns {boolean} true if the error was handled (caller should return)
 */
function handleApiError(response) {
  if (response.status === 401) {
    const token = getAuthToken();
    if (!token) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui"><div style="text-align:center"><h2>Authentication Required</h2><p>This server requires a Bearer token for API access.</p><p>Please open the URL provided when the server started (includes #token=...).</p></div></div>';
      return true;
    }
    localStorage.removeItem('agentarena_token');
    window.location.reload();
    return true;
  }
  return false;
}

/**
 * Fetch wrapper that injects Bearer auth token.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
function apiFetch(url, options = {}) {
  const token = getAuthToken();
  if (token) {
    options.headers = options.headers || {};
    if (!options.headers.Authorization) {
      options.headers.Authorization = 'Bearer ' + token;
    }
  }
  return fetch(url, options);
}

/**
 * Simple fetch with timeout (AbortController-based).
 * @param {string} url
 * @param {RequestInit & {timeout?: number}} [options]
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, options = {}) {
  const { timeout = 10_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

// ---------------------------------------------------------------------------
// Location state (URL query params)
// ---------------------------------------------------------------------------

/**
 * Read run/agent/language from URL query params.
 * @returns {{ language: string|null, runId: string|null, agentId: string|null }}
 */
function readLocationState() {
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lang");
  return {
    language: language === "zh-CN" || language === "en" ? language : null,
    runId: params.get("run"),
    agentId: params.get("agent")
  };
}

/**
 * Sync URL query params with current state.
 * @param {Object} state - Global state object
 * @param {"replace"|"push"} [mode="replace"]
 */
function syncLocationState(state, mode = "replace") {
  const url = new URL(window.location.href);
  if (state.language === "zh-CN" || state.language === "en") {
    url.searchParams.set("lang", state.language);
  } else {
    url.searchParams.delete("lang");
  }
  if (state.selectedRunId) {
    url.searchParams.set("run", state.selectedRunId);
  } else {
    url.searchParams.delete("run");
  }
  if (state.selectedAgentId) {
    url.searchParams.set("agent", state.selectedAgentId);
  } else {
    url.searchParams.delete("agent");
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) {
    return;
  }

  if (mode === "push") {
    window.history.pushState(null, "", nextUrl);
  } else {
    window.history.replaceState(null, "", nextUrl);
  }
}

// ---------------------------------------------------------------------------
// General-purpose utilities
// ---------------------------------------------------------------------------

/**
 * Show/hide an element by setting its `hidden` attribute.
 * @param {HTMLElement} element
 * @param {boolean} hidden
 */
function setHidden(element, hidden) {
  if (!element) return;
  if (hidden) {
    element.setAttribute("hidden", "");
  } else {
    element.removeAttribute("hidden");
  }
}

/**
 * Escape HTML special characters.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Simple debounce.
 * @param {Function} fn
 * @param {number} delayMs
 * @returns {Function}
 */
function debounce(fn, delayMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * Generate a short random ID for client-side use.
 * @returns {string}
 */
function clientRandomId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Format elapsed duration as "Xm Ys" or "Xs".
 * @param {number} ms
 * @returns {string}
 */
function formatElapsedDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

/**
 * Display name for a Claude provider profile.
 * @param {Object} profile
 * @returns {string}
 */
function providerDisplayName(profile) {
  if (!profile) return "Unknown";
  if (profile.kind === "official") return "Official";
  return profile.name || profile.kind || "Unknown";
}

export {
  _RUN_CACHE_MAX_BYTES,
  _RUN_CACHE_STORAGE_KEY,
  apiFetch,
  clientRandomId,
  debounce,
  escapeHtml,
  fetchWithTimeout,
  formatElapsedDuration,
  getAuthToken,
  handleApiError,
  providerDisplayName,
  readLocationState,
  setHidden,
  syncLocationState
};
