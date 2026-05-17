import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
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
  const maxDepth = positiveNumberFromEnv("AGENTARENA_MAX_SNAPSHOT_DEPTH", DEFAULT_MAX_SNAPSHOT_DEPTH);
  const maxFiles = positiveNumberFromEnv("AGENTARENA_MAX_SNAPSHOT_FILES", DEFAULT_MAX_SNAPSHOT_FILES);
  const maxTotalBytes = positiveNumberFromEnv("AGENTARENA_MAX_SNAPSHOT_TOTAL_BYTES", DEFAULT_MAX_SNAPSHOT_TOTAL_BYTES);
  let seenFiles = 0;
  let seenBytes = 0;
  let truncated = false;

  // Phase 1: Walk directory and collect file metadata
  async function walk(currentPath: string, depth = 0): Promise<void> {
    if (truncated) {
      return;
    }
    if (depth > maxDepth) {
      truncated = true;
      console.warn(`Snapshot: max depth ${maxDepth} reached at ${currentPath}; remaining files skipped.`);
      return;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (_error) {
      console.warn(`Snapshot: skipped directory due to error: ${currentPath}`, _error instanceof Error ? _error.message : String(_error));
      return;
    }

    const subdirs: string[] = [];

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = normalizePath(path.relative(rootPath, absolutePath));

      if (entry.isDirectory()) {
        if (INTERNAL_IGNORED_NAMES.has(entry.name)) {
          continue;
        }
        subdirs.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        seenFiles += 1;
        seenBytes += stat.size;
        if (seenFiles > maxFiles || seenBytes > maxTotalBytes) {
          truncated = true;
          console.warn(`Snapshot: scan budget exceeded (${seenFiles} files, ${seenBytes} bytes); remaining files skipped.`);
          return;
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
        console.warn(`Snapshot: skipped file due to error: ${relativePath}`, _error instanceof Error ? _error.message : String(_error));
      }
    }

    if (subdirs.length > 0 && !truncated) {
      await mapWithConcurrency(subdirs, Math.max(1, cpus().length), (dir) => walk(dir, depth + 1));
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
