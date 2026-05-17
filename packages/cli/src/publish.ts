import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import type {
  BenchmarkRun,
  CommunityAgentResult,
  CommunityLeaderboardEntry,
  CommunityLeaderboardIndex,
  CommunityRunEntry,
} from "@agentarena/core";
import { sanitizeRun } from "@agentarena/report";
import type { ParsedArgs } from "./args.js";

const DEFAULT_GITHUB_OWNER = "agentarena";
const DEFAULT_GITHUB_REPO = "leaderboard-data";
const MAX_RETRIES = 3;

function getGitHubOwner(): string {
  return process.env.AGENTARENA_COMMUNITY_OWNER ?? DEFAULT_GITHUB_OWNER;
}

function getGitHubRepo(): string {
  return process.env.AGENTARENA_COMMUNITY_REPO ?? DEFAULT_GITHUB_REPO;
}

/**
 * Resolve GitHub token: explicit flag > GITHUB_TOKEN env > gh auth token CLI
 */
export function getGitHubToken(explicit?: string): string {
  if (explicit) return explicit;

  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) return envToken;

  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) return token;
  } catch {
    // gh CLI not available or not authenticated
  }

  throw new Error(
    "No GitHub token found. Provide one via:\n" +
    "  1. --token <token> flag\n" +
    "  2. GITHUB_TOKEN environment variable\n" +
    "  3. `gh auth login` (uses gh CLI token)"
  );
}

/**
 * Fetch wrapper for GitHub REST API
 */
async function ghApi(
  endpoint: string,
  token: string,
  options: { method?: string; body?: string } = {}
): Promise<unknown> {
  const url = `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AgentArena-CLI",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GitHub API ${options.method ?? "GET"} ${endpoint} failed (${response.status}): ${text}`
    );
  }

  return response.json();
}

/**
 * Get file from GitHub repo with SHA for concurrency control
 */
async function getFile(
  owner: string,
  repo: string,
  path: string,
  token: string
): Promise<{ content: string; sha: string } | null> {
  try {
    const data = (await ghApi(
      `/repos/${owner}/${repo}/contents/${path}`,
      token
    )) as { content: string; sha: string };
    return {
      content: Buffer.from(data.content, "base64").toString("utf8"),
      sha: data.sha,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

/**
 * Create or update file in GitHub repo with SHA-based optimistic concurrency
 */
async function putFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  token: string,
  sha?: string,
  message?: string
): Promise<{ sha: string }> {
  const body = {
    message: message ?? `Update ${path} via AgentArena CLI`,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  };

  const data = (await ghApi(
    `/repos/${owner}/${repo}/contents/${path}`,
    token,
    { method: "PUT", body: JSON.stringify(body) }
  )) as { content: { sha: string } };

  return { sha: data.content.sha };
}

/**
 * Extract a sanitized community entry from a benchmark run
 */
export function extractCommunityEntry(
  run: BenchmarkRun,
  publishedBy: string
): CommunityRunEntry {
  const sanitized = sanitizeRun(run);

  const agentResults: CommunityAgentResult[] = sanitized.results.map((result) => {
    const judgeResults = result.judgeResults ?? [];
    const passedCount = judgeResults.filter((j) => j.success).length;
    const judgePassRate = judgeResults.length > 0 ? passedCount / judgeResults.length : 0;

    return {
      agentId: result.agentId,
      baseAgentId: result.baseAgentId,
      variantId: result.variantId,
      displayLabel: result.displayLabel || result.agentId,
      model: result.resolvedRuntime?.effectiveModel ?? "unknown",
      provider: result.resolvedRuntime?.providerProfileName ?? result.resolvedRuntime?.providerKind ?? "unknown",
      version: result.resolvedRuntime?.effectiveAgentVersion ?? "unknown",
      status: result.status,
      compositeScore: result.compositeScore ?? 0,
      durationMs: result.durationMs,
      tokenUsage: result.tokenUsage,
      estimatedCostUsd: result.estimatedCostUsd,
      costKnown: result.costKnown,
      judgePassRate,
    };
  });

  return {
    schemaVersion: "agentarena.community-run/v1",
    runId: sanitized.runId,
    publishedAt: new Date().toISOString(),
    publishedBy,
    taskPackId: sanitized.task?.id ?? "unknown",
    taskTitle: sanitized.task?.title ?? "Unknown Task",
    scoreMode: sanitized.scoreMode ?? "balanced",
    agentResults,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

interface AgentResultWithMeta {
  agent: CommunityAgentResult;
  publishedAt: string;
  runId: string;
}

/**
 * Build leaderboard entries from an array of raw run entries.
 * This is the single source of truth for aggregation — no synthetic data inflation.
 * Each run contributes its real agent results directly.
 */
export function buildLeaderboardEntries(
  allRuns: CommunityRunEntry[]
): CommunityLeaderboardEntry[] {
  // Flatten all agent results from all runs (real data only, no inflation)
  const allResults: AgentResultWithMeta[] = [];
  for (const run of allRuns) {
    for (const agent of run.agentResults) {
      allResults.push({
        agent,
        publishedAt: run.publishedAt,
        runId: run.runId,
      });
    }
  }

  // Group by agent identity (baseAgentId + model + provider + version)
  const agentMap = new Map<string, AgentResultWithMeta[]>();
  for (const result of allResults) {
    const key = `${result.agent.baseAgentId}::${result.agent.model}::${result.agent.provider}::${result.agent.version}`;
    if (!agentMap.has(key)) {
      agentMap.set(key, []);
    }
    agentMap.get(key)?.push(result);
  }

  const leaderboardEntries: CommunityLeaderboardEntry[] = [];

  for (const [, results] of agentMap) {
    const firstAgent = results[0].agent;

    const allScores = results.map((r) => r.agent.compositeScore).filter((s) => s > 0);
    const allDurations = results.map((r) => r.agent.durationMs).filter((d) => d > 0);
    const allCosts = results
      .filter((r) => r.agent.costKnown && r.agent.estimatedCostUsd > 0)
      .map((r) => r.agent.estimatedCostUsd);
    const successCount = results.filter((r) => r.agent.status === "success").length;

    // Win count: how many times this agent had the highest score in a run
    const runWinMap = new Map<string, boolean>();
    for (const result of results) {
      const runResults = allResults.filter((r) => r.runId === result.runId);
      const successfulResults = runResults.filter((r) => r.agent.status === "success");
      const candidates = successfulResults.length > 0 ? successfulResults : runResults;
      const sorted = [...candidates].sort((a, b) => b.agent.compositeScore - a.agent.compositeScore);
      if (sorted[0]?.agent.baseAgentId === firstAgent.baseAgentId) {
        runWinMap.set(result.runId, true);
      }
    }
    const winCount = runWinMap.size;

    leaderboardEntries.push({
      agentId: firstAgent.agentId,
      baseAgentId: firstAgent.baseAgentId,
      displayLabel: firstAgent.displayLabel,
      model: firstAgent.model,
      provider: firstAgent.provider,
      version: firstAgent.version,
      runCount: results.length,
      avgScore: allScores.length > 0 ? Math.round((allScores.reduce((s, v) => s + v, 0) / allScores.length) * 10) / 10 : 0,
      bestScore: allScores.length > 0 ? Math.max(...allScores) : 0,
      winRate: results.length > 0 ? winCount / results.length : 0,
      successRate: results.length > 0 ? successCount / results.length : 0,
      medianDurationMs: Math.round(median(allDurations)),
      medianCostUsd: allCosts.length > 0 ? Math.round(median(allCosts) * 10000) / 10000 : null,
      lastPublishedAt: results.map((r) => r.publishedAt).sort().reverse()[0] ?? new Date().toISOString(),
    });
  }

  // Sort by avgScore desc, then winRate desc, then successRate desc
  leaderboardEntries.sort((a, b) => {
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.successRate !== a.successRate) return b.successRate - a.successRate;
    return a.medianDurationMs - b.medianDurationMs;
  });

  return leaderboardEntries;
}

/**
 * Rebuild the per-task-pack leaderboard index from raw run data.
 * Instead of inflating aggregated stats back into fake data points (which
 * loses variance information and accumulates rounding errors), this version
 * reads all individual run files from GitHub and re-aggregates from scratch.
 *
 * The `existingRuns` parameter should contain ALL previously published run
 * entries for this task pack. If the index contains a `runIds` field
 * (schema v2+), we use it to fetch only the referenced runs. Otherwise
 * we fall back to the legacy inflation approach with a deprecation warning.
 */
export async function rebuildIndexFromRuns(
  _owner: string,
  _repo: string,
  _token: string,
  taskPackId: string,
  existingRuns: CommunityRunEntry[],
  newEntry: CommunityRunEntry
): Promise<CommunityLeaderboardIndex> {
  const allRuns = [...existingRuns, newEntry];
  const entries = buildLeaderboardEntries(allRuns);

  const uniqueRunIds = new Set(allRuns.map((r) => r.runId));

  return {
    schemaVersion: "agentarena.community-leaderboard/v1",
    taskPackId,
    taskTitle: newEntry.taskTitle,
    updatedAt: new Date().toISOString(),
    totalRuns: uniqueRunIds.size,
    entries,
  };
}

/**
 * List all run IDs for a task pack by listing the GitHub directory.
 * This avoids needing to read each individual run file just to discover IDs.
 */
async function listRunFiles(
  owner: string,
  repo: string,
  taskPackId: string,
  token: string
): Promise<string[]> {
  try {
    const data = (await ghApi(
      `/repos/${owner}/${repo}/contents/runs/${taskPackId}`,
      token
    )) as Array<{ name: string; type: string }>;

    return data
      .filter((item) => item.type === "file" && item.name.endsWith(".json") && item.name !== "index.json")
      .map((item) => item.name.replace(/\.json$/, ""));
  } catch {
    // Directory doesn't exist yet or API error
    return [];
  }
}

/**
 * Fetch all existing run entries for a task pack from GitHub.
 * Reads individual run files to preserve full data fidelity.
 */
async function fetchExistingRuns(
  owner: string,
  repo: string,
  taskPackId: string,
  token: string
): Promise<CommunityRunEntry[]> {
  const runIds = await listRunFiles(owner, repo, taskPackId, token);
  const runs: CommunityRunEntry[] = [];

  // Fetch runs in parallel (but cap concurrency to avoid GitHub API rate limits)
  const batchSize = 5;
  for (let i = 0; i < runIds.length; i += batchSize) {
    const batch = runIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (runId) => {
        const file = await getFile(owner, repo, `runs/${taskPackId}/${runId}.json`, token);
        if (!file) return null;
        return JSON.parse(file.content) as CommunityRunEntry;
      })
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        runs.push(result.value);
      }
    }
  }

  return runs;
}

/**
 * Main publish orchestrator
 */
export async function runPublish(parsed: ParsedArgs): Promise<void> {
  // 1. Read and validate result file
  if (!parsed.resultFile) {
    throw new Error(
      "Missing result file. Usage: agentarena publish <result-file>\n" +
      "The result file should be a summary.json from a benchmark run."
    );
  }

  const resolvedPath = parsed.resultFile;
  let rawData: string;
  try {
    rawData = await fs.readFile(resolvedPath, "utf8");
  } catch {
    throw new Error(`Cannot read result file: ${resolvedPath}`);
  }

  let run: BenchmarkRun;
  try {
    run = JSON.parse(rawData);
  } catch {
    throw new Error(`Invalid JSON in result file: ${resolvedPath}`);
  }

  if (!run.runId) {
    throw new Error("Result file is missing 'runId'. Is this a valid AgentArena benchmark result?");
  }

  if (!run.task?.id) {
    throw new Error("Result file is missing 'task.id'. Is this a valid AgentArena benchmark result?");
  }

  // 2. Resolve GitHub auth
  const token = getGitHubToken(parsed.githubToken);
  const owner = getGitHubOwner();
  const repo = getGitHubRepo();

  // 3. Fetch GitHub username
  console.log("Authenticating with GitHub...");
  const userData = (await ghApi("/user", token)) as { login: string };
  const publishedBy = userData.login;
  console.log(`Authenticated as: ${publishedBy}`);

  // 4. Extract sanitized community entry
  const entry = extractCommunityEntry(run, publishedBy);
  console.log(`Task: ${entry.taskTitle}`);
  console.log(`Agents: ${entry.agentResults.length}`);
  console.log(`Score mode: ${entry.scoreMode}`);

  // 5. Write run file
  const runPath = `runs/${entry.taskPackId}/${entry.runId}.json`;
  console.log(`\nPublishing run data to ${owner}/${repo}/${runPath}...`);

  await putFile(
    owner,
    repo,
    runPath,
    JSON.stringify(entry, null, 2),
    token,
    undefined,
    `Add benchmark run ${entry.runId} for ${entry.taskPackId}`
  );
  console.log("Run data published.");

  // 6. Update per-task-pack index with retry
  const indexPath = `runs/${entry.taskPackId}/index.json`;
  let indexUpdated = false;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const existingIndex = await getFile(owner, repo, indexPath, token);

      // Fetch all real run data from GitHub instead of inflating aggregated stats.
      // This preserves full data fidelity — no precision loss from synthetic data points.
      const existingRuns = await fetchExistingRuns(owner, repo, entry.taskPackId, token);

      const newIndex = await rebuildIndexFromRuns(
        owner, repo, token,
        entry.taskPackId,
        existingRuns,
        entry
      );

      await putFile(
        owner,
        repo,
        indexPath,
        JSON.stringify(newIndex, null, 2),
        token,
        existingIndex?.sha,
        `Update leaderboard index for ${entry.taskPackId} (run ${entry.runId})`
      );

      console.log(`Leaderboard index updated (${newIndex.totalRuns} runs).`);
      indexUpdated = true;
      break;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("409") && attempt < MAX_RETRIES - 1) {
        console.log(`Conflict on index update, retrying (${attempt + 1}/${MAX_RETRIES})...`);
        continue;
      }
      throw error;
    }
  }

  if (!indexUpdated) {
    throw new Error("Failed to update leaderboard index after retries");
  }

  // 7. Update global index
  const globalIndexPath = "index.json";
  try {
    const existingGlobal = await getFile(owner, repo, globalIndexPath, token);
    const globalIndex = existingGlobal
      ? JSON.parse(existingGlobal.content)
      : { taskPacks: [] };

    if (!Array.isArray(globalIndex.taskPacks)) {
      globalIndex.taskPacks = [];
    }

    const existingEntry = globalIndex.taskPacks.find(
      (tp: { id: string }) => tp.id === entry.taskPackId
    );
    if (existingEntry) {
      existingEntry.title = entry.taskTitle;
      existingEntry.lastUpdated = new Date().toISOString();
    } else {
      globalIndex.taskPacks.push({
        id: entry.taskPackId,
        title: entry.taskTitle,
        lastUpdated: new Date().toISOString(),
      });
    }

    await putFile(
      owner,
      repo,
      globalIndexPath,
      JSON.stringify(globalIndex, null, 2),
      token,
      existingGlobal?.sha,
      `Update global index for ${entry.taskPackId}`
    );
  } catch (error: unknown) {
    // Non-fatal: log but don't fail the publish
    console.warn(`Warning: Could not update global index: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 8. Print success
  console.log("\nBenchmark result published successfully!");
  console.log(`  Run ID: ${entry.runId}`);
  console.log(`  Task Pack: ${entry.taskPackId}`);
  console.log(`  View at: https://github.com/${owner}/${repo}/tree/main/runs/${entry.taskPackId}`);
}
