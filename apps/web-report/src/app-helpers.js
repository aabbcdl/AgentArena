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

const AUTH_TOKEN_SESSION_KEY = 'agentarena-auth-token';
const LEGACY_AUTH_TOKEN_LOCAL_KEY = 'agentarena_token';
let memoryAuthToken = '';

function readSessionValue(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeSessionValue(key, value) {
  memoryAuthToken = value;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Session storage can be disabled; keep the token in memory for this page.
  }
}

function removeSessionValue(key) {
  memoryAuthToken = '';
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Best-effort cleanup for browsers with unavailable storage.
  }
}

function readLocalValue(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function removeLocalValue(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup for legacy persistent token storage.
  }
}

/**
 * Get auth token from URL hash, meta tag, or sessionStorage.
 * Priority: URL hash > meta tag (localhost auto-inject) > sessionStorage.
 * Legacy localStorage tokens are migrated once and removed.
 * @returns {string}
 */
function getAuthToken() {
  // Check URL hash first (backwards compatibility)
  const hash = window.location.hash;
  if (hash) {
    const match = hash.match(/[#&]token=([^&]+)/);
    if (match) {
      writeSessionValue(AUTH_TOKEN_SESSION_KEY, match[1]);
      removeLocalValue(LEGACY_AUTH_TOKEN_LOCAL_KEY);
      window.location.hash = '';
      return match[1];
    }
  }

  // Check meta tag (localhost auto-inject for seamless UX)
  const metaEl = document.querySelector('meta[name="agentarena-auth-token"]');
  const metaToken = metaEl instanceof HTMLMetaElement ? metaEl.content : undefined;
  if (metaToken) {
    writeSessionValue(AUTH_TOKEN_SESSION_KEY, metaToken);
    removeLocalValue(LEGACY_AUTH_TOKEN_LOCAL_KEY);
    return metaToken;
  }

  const sessionToken = readSessionValue(AUTH_TOKEN_SESSION_KEY) || memoryAuthToken;
  if (sessionToken) {
    return sessionToken;
  }

  const legacyToken = readLocalValue(LEGACY_AUTH_TOKEN_LOCAL_KEY);
  if (legacyToken) {
    writeSessionValue(AUTH_TOKEN_SESSION_KEY, legacyToken);
    removeLocalValue(LEGACY_AUTH_TOKEN_LOCAL_KEY);
    return legacyToken;
  }

  return '';
}

/**
 * Render a bilingual "Authentication Required" prompt with a token input.
 * Builds DOM via createElement instead of innerHTML — preserves the existing
 * page (no document.body wipe that destroys all event listeners) and uses
 * safe DOM APIs that cannot be XSS-exploited even if locale strings change.
 */
function renderAuthRequiredOverlay() {
  const existing = document.getElementById('auth-required-overlay');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = 'auth-required-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'auth-required-title');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)', zIndex: '9999', fontFamily: 'system-ui'
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'var(--bg-elevated, #211d1a)', color: 'var(--text-primary, #f5f5f4)', padding: '24px 28px', borderRadius: '12px',
    maxWidth: '440px', boxShadow: '0 12px 32px rgba(0,0,0,0.4)', position: 'relative',
    border: '1px solid var(--border-strong, rgba(255,255,255,0.08))'
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭 / Close');
  closeButton.innerHTML = '&times;';
  Object.assign(closeButton.style, {
    position: 'absolute', top: '12px', right: '12px',
    background: 'transparent', border: 'none', fontSize: '24px', lineHeight: '1',
    cursor: 'pointer', color: '#666', padding: '4px 8px'
  });
  closeButton.addEventListener('click', () => {
    overlay.remove();
  });
  card.appendChild(closeButton);

  const title = document.createElement('h2');
  title.id = 'auth-required-title';
  title.textContent = '需要认证 · Authentication Required';
  title.style.margin = '0 0 12px';
  card.appendChild(title);

  const desc = document.createElement('p');
  desc.textContent = '本服务器需要 Bearer Token 才能访问 API。请打开服务器启动时打印的 auth_token_file 路径，粘贴文件内容到下方。 ／ This server requires a Bearer token. Open the auth_token_file printed by the server and paste its contents below.';
  desc.style.margin = '0 0 16px';
  desc.style.fontSize = '14px';
  card.appendChild(desc);

  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Auth token');
  input.placeholder = 'Paste auth token';
  Object.assign(input.style, {
    width: '100%', padding: '8px 12px', fontSize: '14px',
    border: '1px solid #d4d4d4', borderRadius: '6px', boxSizing: 'border-box'
  });
  card.appendChild(input);

  const error = document.createElement('div');
  error.style.color = '#b91c1c';
  error.style.fontSize = '13px';
  error.style.marginTop = '6px';
  error.hidden = true;
  card.appendChild(error);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '提交 / Submit';
  Object.assign(button.style, {
    marginTop: '14px', padding: '8px 14px', fontSize: '14px',
    background: '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer'
  });
  button.addEventListener('click', () => {
    const token = input.value.trim();
    if (!token) {
      error.textContent = '请输入 token / Token is required';
      error.hidden = false;
      return;
    }
    writeSessionValue(AUTH_TOKEN_SESSION_KEY, token);
    removeLocalValue(LEGACY_AUTH_TOKEN_LOCAL_KEY);
    window.location.reload();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') button.click();
  });
  card.appendChild(button);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const closeOverlay = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape' && document.getElementById('auth-required-overlay')) {
      closeOverlay();
      document.removeEventListener('keydown', handler);
    }
  });

  setTimeout(() => input.focus(), 0);
}

/**
 * Handle API error responses (401 = auth required).
 * @param {Response} response
 * @returns {boolean} true if the error was handled (caller should return)
 */
function handleApiError(response) {
  if (response.status === 401) {
    const token = getAuthToken();
    if (!token) {
      renderAuthRequiredOverlay();
      return true;
    }
    removeSessionValue(AUTH_TOKEN_SESSION_KEY);
    removeLocalValue(LEGACY_AUTH_TOKEN_LOCAL_KEY);
    renderAuthRequiredOverlay();
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
    element.classList.add("hidden");
  } else {
    element.removeAttribute("hidden");
    element.classList.remove("hidden");
  }
}

/**
 * Escape HTML special characters.
 * NOTE: TS equivalent in packages/core/src/fs-utils.ts
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
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
 * Format an ISO timestamp as a human-readable relative time string.
 * @param {string} isoString - ISO 8601 timestamp
 * @param {Function} [localText] - i18n function (zh, en) => string
 * @returns {string}
 */
function formatRelativeTime(isoString, localText) {
  if (!isoString) return "—";
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return isoString;
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return localText ? localText("刚刚", "just now") : "just now";
  if (diffMin < 60) return localText ? localText(`${diffMin} 分钟前`, `${diffMin}m ago`) : `${diffMin}m ago`;
  if (diffHour < 24) return localText ? localText(`${diffHour} 小时前`, `${diffHour}h ago`) : `${diffHour}h ago`;
  if (diffDay < 7) return localText ? localText(`${diffDay} 天前`, `${diffDay}d ago`) : `${diffDay}d ago`;

  // Fallback: show date in local format
  const d = new Date(isoString);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${min}`;
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
  formatRelativeTime,
  getAuthToken,
  handleApiError,
  providerDisplayName,
  readLocationState,
  setHidden,
  syncLocationState
};
