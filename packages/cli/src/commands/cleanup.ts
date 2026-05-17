import { promises as fs } from "node:fs";
import path from "node:path";
import type { ParsedArgs } from "../args.js";

const DEFAULT_MAX_RUNS = 50;

interface RunEntry {
  dirName: string;
  fullPath: string;
  mtime: number;
}

export async function runCleanup(parsed: ParsedArgs): Promise<void> {
  const repoPath = parsed.repoPath ? path.resolve(parsed.repoPath) : process.cwd();
  const runsDir = path.join(repoPath, ".agentarena", "runs");
  const maxRuns = parsed.maxRuns ?? DEFAULT_MAX_RUNS;

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
      console.error("No runs directory found. Nothing to clean.");
      return;
    }
    throw e;
  }

  entries.sort((a, b) => b.mtime - a.mtime);

  const toRemove = entries.slice(maxRuns);

  if (toRemove.length === 0) {
    console.error(`${entries.length} run(s) found, within limit of ${maxRuns}. Nothing to clean.`);
    return;
  }

  console.error(`${entries.length} run(s) found, removing ${toRemove.length} oldest (keeping ${maxRuns})...`);

  let removed = 0;
  for (const entry of toRemove) {
    try {
      await fs.rm(entry.fullPath, { recursive: true, force: true });
      removed++;
    } catch (e) {
      console.warn(`Failed to remove ${entry.dirName}: ${(e as Error).message}`);
    }
  }

  console.error(`Removed ${removed} run(s). ${entries.length - removed} remaining.`);
}
