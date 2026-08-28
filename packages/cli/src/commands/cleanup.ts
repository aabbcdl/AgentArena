import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ParsedArgs } from "../args.js";

const DEFAULT_MAX_RUNS = 50;

/** Prefix used by prepareWorkspace() for per-run temp workspace roots. */
const TEMP_WORKSPACE_PREFIX = "agentarena-workspaces-";
/**
 * Only reap temp workspaces older than this. Runs finish well within the agent
 * timeout (≤30 min), so 24h guarantees we never remove an in-flight run's
 * workspace or a just-finished run's workspace kept as evidence.
 */
const TEMP_WORKSPACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RunEntry {
  dirName: string;
  fullPath: string;
  mtime: number;
}

/**
 * Remove leaked temp workspace roots from previous runs. cleanupWorkspaces
 * defaults to false, so successful runs leave a full repo copy per agent in the
 * OS temp dir with nothing to reap them. Age-gated so active runs are safe.
 */
export async function reapStaleTempWorkspaces(nowMs: number, base: string = tmpdir()): Promise<number> {
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || !dirent.name.startsWith(TEMP_WORKSPACE_PREFIX)) continue;
    const fullPath = path.join(base, dirent.name);
    try {
      const stat = await fs.stat(fullPath);
      if (nowMs - stat.mtimeMs < TEMP_WORKSPACE_MAX_AGE_MS) continue;
      await fs.rm(fullPath, { recursive: true, force: true });
      removed++;
    } catch {
      // Best-effort: a workspace held by another process is skipped this pass.
    }
  }
  if (removed > 0) {
    console.log(`Reaped ${removed} stale temp workspace(s) from ${base}.`);
  }
  return removed;
}

export async function runCleanup(parsed: ParsedArgs): Promise<void> {
  const repoPath = parsed.repoPath ? path.resolve(parsed.repoPath) : process.cwd();
  const runsDir = parsed.outputPath
    ? path.resolve(parsed.outputPath)
    : path.join(repoPath, ".agentarena", "runs");
  const maxRuns = parsed.maxRuns ?? DEFAULT_MAX_RUNS;

  // Reap leaked temp workspaces regardless of the runs-dir state below.
  await reapStaleTempWorkspaces(Date.now());

  let entries: RunEntry[];
  try {
    const dirents = await fs.readdir(runsDir, { withFileTypes: true });
    const dirs = dirents.filter((d) => d.isDirectory());

    entries = await Promise.all(
      dirs.map(async (d) => {
        const fullPath = path.join(runsDir, d.name);
        const stat = await fs.stat(fullPath);
        return { dirName: d.name, fullPath, mtime: stat.mtimeMs };
      })
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("No runs directory found. Nothing to clean.");
      return;
    }
    throw e;
  }

  entries.sort((a, b) => b.mtime - a.mtime);

  const toRemove = entries.slice(maxRuns);

  if (toRemove.length === 0) {
    console.log(`${entries.length} run(s) found, within limit of ${maxRuns}. Nothing to clean.`);
    return;
  }

  console.log(`${entries.length} run(s) found, removing ${toRemove.length} oldest (keeping ${maxRuns})...`);

  let removed = 0;
  for (const entry of toRemove) {
    try {
      await fs.rm(entry.fullPath, { recursive: true, force: true });
      removed++;
    } catch (e) {
      console.warn(`Failed to remove ${entry.dirName}: ${(e as Error).message}`);
    }
  }

  console.log(`Removed ${removed} run(s). ${entries.length - removed} remaining.`);
}
