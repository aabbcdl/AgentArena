const CACHE_PREFIX = "agentarena-community-";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_OWNER = "agentarena";
const DEFAULT_REPO = "leaderboard-data";

function getOwner() {
  return DEFAULT_OWNER;
}

function getRepo() {
  return DEFAULT_REPO;
}

/**
 * Fetch community leaderboard index for a task pack from GitHub raw
 */
export async function fetchCommunityIndex(taskPackId) {
  const url = `https://raw.githubusercontent.com/${getOwner()}/${getRepo()}/main/runs/${encodeURIComponent(taskPackId)}/index.json`;
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch community data: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch global index of all task packs
 */
export async function fetchGlobalIndex() {
  const url = `https://raw.githubusercontent.com/${getOwner()}/${getRepo()}/main/index.json`;
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch global index: ${response.status}`);
  }
  return response.json();
}

/**
 * Get cached community data from localStorage
 */
export function getCachedCommunityData(taskPackId) {
  try {
    const key = `${CACHE_PREFIX}${taskPackId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return cached.data;
  } catch {
    return null;
  }
}

/**
 * Set community data in localStorage cache
 */
export function setCachedCommunityData(taskPackId, data) {
  try {
    const key = `${CACHE_PREFIX}${taskPackId}`;
    localStorage.setItem(key, JSON.stringify({
      timestamp: Date.now(),
      data,
    }));
  } catch {
    // localStorage quota exceeded — silently ignore
  }
}

/**
 * Clear cached community data for a task pack
 */
export function clearCachedCommunityData(taskPackId) {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${taskPackId}`);
  } catch {
    // ignore
  }
}

/**
 * Render community leaderboard HTML table
 */
export function renderCommunityLeaderboard(container, indexData, t, locale) {
  if (!indexData || !indexData.entries || indexData.entries.length === 0) {
    container.innerHTML = `<p class="community-empty">${t("communityNoData")}</p>`;
    return;
  }

  const isZhCn = locale === "zh-CN";
  const entries = indexData.entries;

  let html = `<div class="community-meta">${t("communityBasedOn", indexData.totalRuns)}</div>`;
  html += `<table class="community-table"><thead><tr>`;
  html += `<th>#</th>`;
  html += `<th>${t("communityAgent")}</th>`;
  html += `<th>${t("communityModel")}</th>`;
  html += `<th>${t("communityAvgScore")}</th>`;
  html += `<th>${t("communitySuccessRate")}</th>`;
  html += `<th>${t("communityRuns")}</th>`;
  html += `<th>${t("communityLastSeen")}</th>`;
  html += `</tr></thead><tbody>`;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : "";
    const lastSeen = new Date(entry.lastPublishedAt);
    const lastSeenStr = lastSeen.toLocaleDateString(isZhCn ? "zh-CN" : "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    html += `<tr class="${rankClass}">`;
    html += `<td class="rank-cell"><span class="rank-badge">${rank}</span></td>`;
    html += `<td>${escapeHtml(entry.displayLabel)}</td>`;
    html += `<td>${escapeHtml(entry.model)}</td>`;
    html += `<td class="score-cell">${entry.avgScore.toFixed(1)}</td>`;
    html += `<td>${(entry.successRate * 100).toFixed(0)}%</td>`;
    html += `<td>${entry.runCount}</td>`;
    html += `<td>${lastSeenStr}</td>`;
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  container.innerHTML = html;
}

/**
 * Find the rank of the user's run in community data
 * @param {object} run - The user's benchmark run
 * @param {object} communityData - CommunityLeaderboardIndex
 * @returns {number|null} Rank (1-based) or null if not found
 */
export function findCommunityRank(run, communityData) {
  if (!communityData?.entries || !run?.results) return null;

  // Find the best scoring agent in the user's run
  const bestResult = [...run.results]
    .filter((r) => r.status === "success" && r.compositeScore > 0)
    .sort((a, b) => b.compositeScore - a.compositeScore)[0];

  if (!bestResult) return null;

  // Find matching entry in community data
  const agentKey = bestResult.baseAgentId;
  for (let i = 0; i < communityData.entries.length; i++) {
    const entry = communityData.entries[i];
    if (entry.baseAgentId === agentKey) {
      return i + 1;
    }
  }

  return null;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
