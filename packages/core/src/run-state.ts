/**
 * Run state persistence for the UI server.
 *
 * Saves run state to disk so that if the server crashes or restarts,
 * the frontend can recover the last known state instead of being stuck
 * on "running" forever.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface UiRunState {
  state: "idle" | "running" | "done" | "error" | "cancelled" | "cancelling";
  phase: "idle" | "starting" | "preflight" | "benchmark" | "report";
  logs: Array<{
    timestamp: string;
    phase: "idle" | "starting" | "preflight" | "benchmark" | "report";
    message: string;
    agentId?: string;
    variantId?: string;
    displayLabel?: string;
  }>;
  updatedAt: string;
  startedAt?: string;
  repoPath?: string;
  taskPath?: string;
  runId?: string;
  outputPath?: string;
  currentAgentId?: string;
  currentVariantId?: string;
  currentDisplayLabel?: string;
  error?: string;
}

const STATE_FILE_NAME = "run-state.json";

function getStateDir(cwd: string): string {
  return path.join(cwd, ".agentarena", "ui");
}

function getStateFilePath(cwd: string): string {
  return path.join(getStateDir(cwd), STATE_FILE_NAME);
}

/**
 * Persist run state to disk atomically.
 */
export async function saveRunState(cwd: string, state: UiRunState): Promise<void> {
  const dir = getStateDir(cwd);
  await fs.mkdir(dir, { recursive: true });

  const filePath = getStateFilePath(cwd);
  const tmpPath = `${filePath}.tmp`;

  // Only persist essential fields (skip result to avoid huge files)
  const persisted: UiRunState = {
    state: state.state,
    phase: state.phase,
    logs: state.logs.slice(-50),
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    repoPath: state.repoPath,
    taskPath: state.taskPath,
    runId: state.runId,
    outputPath: state.outputPath,
    currentAgentId: state.currentAgentId,
    currentVariantId: state.currentVariantId,
    currentDisplayLabel: state.currentDisplayLabel,
    error: state.error,
  };

  try {
    await fs.writeFile(tmpPath, JSON.stringify(persisted, null, 2), "utf8");
    await fs.rename(tmpPath, filePath);
  } catch {
    // Best-effort persistence — don't crash the server on write failure
    try { await fs.unlink(tmpPath).catch(() => {}); } catch {}
  }
}

/**
 * Load persisted run state from disk.
 * Returns null if file doesn't exist or is corrupted.
 */
export async function loadRunState(cwd: string): Promise<UiRunState | null> {
  try {
    const filePath = getStateFilePath(cwd);
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as UiRunState;

    // Basic validation
    if (!parsed || typeof parsed !== "object" || !parsed.state || !parsed.updatedAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Delete persisted run state from disk.
 */
export async function clearRunState(cwd: string): Promise<void> {
  try {
    const filePath = getStateFilePath(cwd);
    await fs.unlink(filePath);
  } catch {
    // File may not exist — that's fine
  }
}
