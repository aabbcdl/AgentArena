import assert from "node:assert/strict";
import test from "node:test";

// Import from built dist
import {
  clearCachedCommunityData,
  findCommunityRank,
  getCachedCommunityData,
  renderCommunityLeaderboard,
  safeCommunityRunCount,
  setCachedCommunityData,
} from "../apps/web-report/dist/view-model/community.js";

// Mock localStorage for Node environment
const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); },
};

test("getCachedCommunityData returns null when empty", () => {
  storage.clear();
  const result = getCachedCommunityData("test-task");
  assert.equal(result, null);
});

test("setCachedCommunityData and getCachedCommunityData round-trips", () => {
  storage.clear();
  const data = { taskPackId: "test", entries: [{ agentId: "a1" }] };
  setCachedCommunityData("test-task", data);

  const result = getCachedCommunityData("test-task");
  assert.deepEqual(result, data);
});

test("getCachedCommunityData returns null for expired cache", () => {
  storage.clear();
  const data = { taskPackId: "test", entries: [] };

  // Manually set expired cache
  const key = "agentarena-community-test-task";
  storage.set(key, JSON.stringify({
    timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    data,
  }));

  const result = getCachedCommunityData("test-task");
  assert.equal(result, null);
});

test("getCachedCommunityData returns data for fresh cache", () => {
  storage.clear();
  const data = { taskPackId: "test", entries: [] };

  const key = "agentarena-community-fresh-task";
  storage.set(key, JSON.stringify({
    timestamp: Date.now() - 30 * 60 * 1000, // 30 minutes ago
    data,
  }));

  const result = getCachedCommunityData("fresh-task");
  assert.deepEqual(result, data);
});

test("clearCachedCommunityData removes cached entry", () => {
  storage.clear();
  setCachedCommunityData("to-clear", { entries: [] });
  assert.ok(getCachedCommunityData("to-clear"));

  clearCachedCommunityData("to-clear");
  assert.equal(getCachedCommunityData("to-clear"), null);
});

test("safeCommunityRunCount only accepts non-negative integer counts", () => {
  assert.equal(safeCommunityRunCount(3, 1), 3);
  assert.equal(safeCommunityRunCount("4", 1), 4);
  assert.equal(safeCommunityRunCount("<img src=x onerror=alert(1)>", 2), 2);
  assert.equal(safeCommunityRunCount(-1, 2), 2);
  assert.equal(safeCommunityRunCount(1.5, 2), 2);
});

test("renderCommunityLeaderboard escapes remote data and translated labels", () => {
  const container = { innerHTML: "" };
  const t = (key, count) => {
    const labels = {
      communityAgent: 'Agent <img src=x onerror="alert(1)">',
      communityAvgScore: "Avg Score",
      communityBasedOn: `Based on ${count} <script>alert(1)</script>`,
      communityLastSeen: "Last Seen",
      communityModel: "Model",
      communityRuns: "Runs",
      communitySuccessRate: "Success"
    };
    return labels[key] ?? key;
  };

  renderCommunityLeaderboard(
    container,
    {
      totalRuns: '<img src=x onerror="alert(1)">',
      entries: [
        {
          avgScore: 99.9,
          displayLabel: '<img src=x onerror="alert(1)">',
          lastPublishedAt: "not-a-date",
          model: "<svg/onload=alert(1)>",
          runCount: '<script>alert(1)</script>',
          successRate: 1
        }
      ]
    },
    t,
    "en"
  );

  assert.match(container.innerHTML, /Based on 1/);
  assert.doesNotMatch(container.innerHTML, /<script/i);
  assert.doesNotMatch(container.innerHTML, /<img/i);
  assert.doesNotMatch(container.innerHTML, /<svg/i);
  assert.match(container.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("findCommunityRank returns null when no community data", () => {
  const run = { results: [{ baseAgentId: "claude-code", status: "success", compositeScore: 85 }] };
  assert.equal(findCommunityRank(run, null), null);
  assert.equal(findCommunityRank(run, { entries: [] }), null);
});

test("findCommunityRank returns null when no successful results", () => {
  const run = { results: [{ baseAgentId: "claude-code", status: "failed", compositeScore: 0 }] };
  const community = { entries: [{ baseAgentId: "claude-code" }] };
  assert.equal(findCommunityRank(run, community), null);
});

test("findCommunityRank returns correct rank", () => {
  const run = {
    results: [
      { baseAgentId: "claude-code", status: "success", compositeScore: 85 },
      { baseAgentId: "codex", status: "success", compositeScore: 72 },
    ],
  };
  const community = {
    entries: [
      { baseAgentId: "gemini-cli", avgScore: 90 },
      { baseAgentId: "claude-code", avgScore: 85 },
      { baseAgentId: "codex", avgScore: 72 },
    ],
  };

  // Best result is claude-code (score 85), which is rank 2 in community
  assert.equal(findCommunityRank(run, community), 2);
});

test("findCommunityRank returns null when agent not in community", () => {
  const run = {
    results: [{ baseAgentId: "unknown-agent", status: "success", compositeScore: 50 }],
  };
  const community = {
    entries: [
      { baseAgentId: "claude-code", avgScore: 85 },
    ],
  };

  assert.equal(findCommunityRank(run, community), null);
});

test("findCommunityRank picks best scoring agent", () => {
  const run = {
    results: [
      { baseAgentId: "codex", status: "success", compositeScore: 72 },
      { baseAgentId: "claude-code", status: "success", compositeScore: 90 },
    ],
  };
  const community = {
    entries: [
      { baseAgentId: "claude-code", avgScore: 90 },
      { baseAgentId: "codex", avgScore: 72 },
    ],
  };

  // Best result is claude-code (score 90), which is rank 1
  assert.equal(findCommunityRank(run, community), 1);
});
