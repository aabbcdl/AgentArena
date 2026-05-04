import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { normalizePath } from "./paths.js";
import type { DiffSummary, FileSnapshotEntry } from "./types.js";

const INTERNAL_IGNORED_NAMES = new Set([".agentarena", ".git", "node_modules"]);

// Allow overriding via environment variable (in bytes).
// Falls back to 100 MB if not set or invalid.
const DEFAULT_MAX_SNAPSHOT_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
function getMaxSnapshotFileSize(): number {
  const envValue = process.env.AGENTARENA_MAX_SNAPSHOT_FILE_SIZE;
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_SNAPSHOT_FILE_SIZE;
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function copyRepository(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.cp(sourcePath, destinationPath, {
      force: true,
      recursive: true,
      filter: (itemPath) => {
        const name = path.basename(itemPath);
        return !INTERNAL_IGNORED_NAMES.has(name);
      }
    });
}

async function hashFileStream(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  await pipeline(stream, hash);
  return hash.digest("hex");
}

interface FileToHash {
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function snapshotDirectory(rootPath: string): Promise<Map<string, FileSnapshotEntry>> {
  const snapshots = new Map<string, FileSnapshotEntry>();
  const filesToHash: FileToHash[] = [];
  const maxFileSize = getMaxSnapshotFileSize();

  // Phase 1: Walk directory and collect file metadata
  async function walk(currentPath: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (_error) {
      console.warn(`Snapshot: skipped directory due to error: ${currentPath}`, _error instanceof Error ? _error.message : String(_error));
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = normalizePath(path.relative(rootPath, absolutePath));

      if (entry.isDirectory()) {
        if (INTERNAL_IGNORED_NAMES.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.size > maxFileSize) {
          // Create a synthetic hash based on metadata for huge files
          const hash = createHash("sha256")
            .update(`huge-file:${relativePath}:${stat.size}:${stat.mtimeMs}`)
            .digest("hex");
          snapshots.set(relativePath, { relativePath, hash });
          continue;
        }
        filesToHash.push({ absolutePath, relativePath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (_error) {
        console.warn(`Snapshot: skipped file due to error: ${relativePath}`, _error instanceof Error ? _error.message : String(_error));
      }
    }
  }

  await walk(rootPath);

  // Phase 2: Hash files in parallel with concurrency limit
  const concurrency = Math.max(1, cpus().length);
  const hashes = await mapWithConcurrency(filesToHash, concurrency, async (file) => {
    try {
      const hash = await hashFileStream(file.absolutePath);
      return { relativePath: file.relativePath, hash };
    } catch (_error) {
      console.warn(`Snapshot: skipped file due to error: ${file.relativePath}`, _error instanceof Error ? _error.message : String(_error));
      return null;
    }
  });

  for (const entry of hashes) {
    if (entry) {
      snapshots.set(entry.relativePath, entry);
    }
  }

  return snapshots;
}

export function diffSnapshots(
  before: Map<string, FileSnapshotEntry>,
  after: Map<string, FileSnapshotEntry>
): DiffSummary {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const skippedLargeFiles: string[] = [];

  for (const [relativePath, afterEntry] of after.entries()) {
    const beforeEntry = before.get(relativePath);

    // Track files that were skipped during snapshot due to size
    if (afterEntry.hash.startsWith("huge-file:")) {
      skippedLargeFiles.push(relativePath);
      continue;
    }

    if (!beforeEntry) {
      added.push(relativePath);
      continue;
    }

    // If before entry was a huge file hash, we can't accurately diff it
    if (beforeEntry.hash.startsWith("huge-file:")) {
      skippedLargeFiles.push(relativePath);
      continue;
    }

    if (beforeEntry.hash !== afterEntry.hash) {
      changed.push(relativePath);
    }
  }

  for (const relativePath of before.keys()) {
    if (!after.has(relativePath)) {
      // Don't mark as removed if it was a huge file (already in skippedLargeFiles)
      const beforeEntry = before.get(relativePath);
      if (beforeEntry?.hash.startsWith("huge-file:")) {
        if (!skippedLargeFiles.includes(relativePath)) {
          skippedLargeFiles.push(relativePath);
        }
        continue;
      }
      removed.push(relativePath);
    }
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
    skippedLargeFiles: skippedLargeFiles.sort()
  };
}
