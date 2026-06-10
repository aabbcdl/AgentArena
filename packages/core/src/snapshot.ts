import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { logger } from "./logging.js";
import { normalizePath } from "./paths.js";
import type { DiffSummary, FileSnapshotEntry } from "./types/index.js";

export const INTERNAL_IGNORED_NAMES = new Set([".agentarena", ".git", "node_modules"]);

// Allow overriding via environment variable (in bytes).
// Falls back to 100 MB if not set or invalid.
const DEFAULT_MAX_SNAPSHOT_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_MAX_SNAPSHOT_DEPTH = 64;
const DEFAULT_MAX_SNAPSHOT_FILES = 100_000;
const DEFAULT_MAX_SNAPSHOT_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GB

function positiveNumberFromEnv(name: string, fallback: number): number {
  const envValue = process.env[name];
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function getMaxSnapshotFileSize(): number {
  return positiveNumberFromEnv("AGENTARENA_MAX_SNAPSHOT_FILE_SIZE", DEFAULT_MAX_SNAPSHOT_FILE_SIZE);
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function copyRepository(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.cp(sourcePath, destinationPath, {
      force: true,
      recursive: true,
      verbatimSymlinks: true,
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

/**
 * Bounded-concurrency map. See packages/runner/src/concurrency.ts for
 * the full concurrency-safety rationale (shared counter is safe under
 * Node.js single-threaded event loop when read-increment is synchronous).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      // Synchronous claim — no await between read and increment.
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
  const maxDepth = positiveNumberFromEnv("AGENTARENA_MAX_SNAPSHOT_DEPTH", DEFAULT_MAX_SNAPSHOT_DEPTH);
  const maxFiles = positiveNumberFromEnv("AGENTARENA_MAX_SNAPSHOT_FILES", DEFAULT_MAX_SNAPSHOT_FILES);
  const maxTotalBytes = positiveNumberFromEnv("AGENTARENA_MAX_SNAPSHOT_TOTAL_BYTES", DEFAULT_MAX_SNAPSHOT_TOTAL_BYTES);
  let seenFiles = 0;
  let seenBytes = 0;
  let truncated = false;

  // Phase 1: Walk directory and collect file metadata using a single
  // work-queue instead of recursive mapWithConcurrency at each level.
  interface DirTask {
    dirPath: string;
    depth: number;
  }

  const queue: DirTask[] = [{ dirPath: rootPath, depth: 0 }];

  async function processDir(task: DirTask): Promise<DirTask[]> {
    const { dirPath, depth } = task;
    if (truncated) return [];

    if (depth > maxDepth) {
      truncated = true;
      logger.warn("core", "snapshot.max_depth", `Snapshot: max depth ${maxDepth} reached at ${dirPath}; remaining files skipped.`);
      return [];
    }

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (_error) {
      logger.warn("core", "snapshot.skip_dir", `Snapshot: skipped directory due to error: ${dirPath}`, { error: _error });
      return [];
    }

    const childDirs: DirTask[] = [];

    for (const entry of entries) {
      if (truncated) break;

      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = normalizePath(path.relative(rootPath, absolutePath));

      if (entry.isDirectory()) {
        if (INTERNAL_IGNORED_NAMES.has(entry.name)) continue;
        childDirs.push({ dirPath: absolutePath, depth: depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;

      try {
        const stat = await fs.stat(absolutePath);
        seenFiles += 1;
        seenBytes += stat.size;
        if (seenFiles > maxFiles || seenBytes > maxTotalBytes) {
          truncated = true;
          logger.warn("core", "snapshot.budget_exceeded", `Snapshot: scan budget exceeded (${seenFiles} files, ${seenBytes} bytes); remaining files skipped.`);
          break;
        }
        if (stat.size > maxFileSize) {
          const hexDigest = createHash("sha256")
            .update(`${relativePath}:${stat.size}:${stat.mtimeMs}:${stat.ino}`)
            .digest("hex");
          const hash = `huge-file:${hexDigest}`;
          snapshots.set(relativePath, { relativePath, hash });
          continue;
        }
        filesToHash.push({ absolutePath, relativePath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (_error) {
        logger.warn("core", "snapshot.skip_file", `Snapshot: skipped file due to error: ${relativePath}`, { error: _error });
      }
    }

    return childDirs;
  }

  const concurrency = Math.max(1, cpus().length);

  // Process directories level by level with a single concurrency pool.
  // Each batch of results feeds the next iteration until the queue is empty.
  while (queue.length > 0 && !truncated) {
    const batch = queue.splice(0);
    const childResults = await mapWithConcurrency(batch, concurrency, processDir);
    for (const children of childResults) {
      queue.push(...children);
    }
  }

  // Phase 2: Hash files in parallel with concurrency limit
  const hashes = await mapWithConcurrency(filesToHash, concurrency, async (file) => {
    try {
      const hash = await hashFileStream(file.absolutePath);
      return { relativePath: file.relativePath, hash };
    } catch (_error) {
      logger.warn("core", "snapshot.skip_file", `Snapshot: skipped file due to error: ${file.relativePath}`, { error: _error });
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
  after: Map<string, FileSnapshotEntry>,
  options: { reliable?: boolean; unreliableReason?: string } = {}
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

  const summary: DiffSummary = {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
    skippedLargeFiles: skippedLargeFiles.sort()
  };
  if (options.reliable === false) {
    summary.reliable = false;
    if (options.unreliableReason) {
      summary.unreliableReason = options.unreliableReason;
    }
  }
  return summary;
}
