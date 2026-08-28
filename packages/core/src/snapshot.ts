import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { logger } from "./logging.js";
import { normalizePath } from "./paths.js";
import type { DiffSummary, FileSnapshotEntry } from "./types/index.js";

export const AGENTARENA_ADAPTER_METADATA_DIRECTORY_NAMES = new Set([
  "agentarena-claude",
  "agentarena-codex",
  "agentarena-copilot",
  "agentarena-qwen"
]);

export const AGENTARENA_GENERATED_DIRECTORY_NAMES = new Set([
  ".aa-evidence",
  ".agentarena",
  ...AGENTARENA_ADAPTER_METADATA_DIRECTORY_NAMES,
  "agentarena-demo"
]);

export const INTERNAL_IGNORED_NAMES = new Set([
  ...AGENTARENA_GENERATED_DIRECTORY_NAMES,
  ".git",
  "node_modules"
]);
const INTERNAL_IGNORED_FILES = new Set(["agent-stderr.log", "agent-stdout.jsonl", "prompt.txt"]);

const execFileAsync = promisify(execFile);

const DEFAULT_SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/,
  /^credentials(?:\..*)?$/i,
  /^credentials\.json$/i,
  /^service-account(?:\..*)?\.json$/i,
  /^.*\.(?:pem|key|p12|pfx)$/
];

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

export function isAgentArenaGeneratedPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath).replace(/^\.\/+/, "");
  const parts = normalized.split("/");
  return (
    parts.some((part) => AGENTARENA_GENERATED_DIRECTORY_NAMES.has(part)) ||
    (parts.length === 1 && INTERNAL_IGNORED_FILES.has(parts[0]))
  );
}

export function isAgentArenaAdapterMetadataPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath).replace(/^\.\/+/, "");
  return normalized
    .split("/")
    .some((part) => AGENTARENA_ADAPTER_METADATA_DIRECTORY_NAMES.has(part));
}

function isInternalPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath).replace(/^\.\/+/, "");
  const parts = normalized.split("/");
  return (
    isAgentArenaGeneratedPath(normalized) ||
    parts.some((part) => INTERNAL_IGNORED_NAMES.has(part))
  );
}

function isDefaultSecretPath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((part) => DEFAULT_SECRET_FILE_PATTERNS.some((pattern) => pattern.test(part)));
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function gitignorePatternMatches(relativePath: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern.trim()).replace(/^\/+/, "");
  if (!normalizedPattern) return false;

  const directoryOnly = normalizedPattern.endsWith("/");
  const patternBody = directoryOnly ? normalizedPattern.slice(0, -1) : normalizedPattern;
  if (!patternBody) return false;

  if (patternBody.includes("/")) {
    const matcher = globToRegExp(patternBody);
    return (
      matcher.test(relativePath) ||
      (directoryOnly && (relativePath === patternBody || relativePath.startsWith(`${patternBody}/`)))
    );
  }

  const segments = relativePath.split("/");
  const matcher = globToRegExp(patternBody);
  return segments.some((segment, index) => {
    if (!matcher.test(segment)) return false;
    return !directoryOnly || index < segments.length - 1;
  });
}

async function loadRootGitignoreRules(sourcePath: string): Promise<Array<{ pattern: string; negated: boolean }>> {
  try {
    const content = await fs.readFile(path.join(sourcePath, ".gitignore"), "utf8");
    return content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => ({
        pattern: line.startsWith("!") ? line.slice(1) : line,
        negated: line.startsWith("!")
      }));
  } catch {
    return [];
  }
}

function isIgnoredByRules(relativePath: string, rules: Array<{ pattern: string; negated: boolean }>): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (gitignorePatternMatches(relativePath, rule.pattern)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

async function gitListCopyableFiles(sourcePath: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", sourcePath, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
      timeout: 30_000
    });
    const files = stdout.split("\0").filter(Boolean).map(normalizePath);
    if (files.length === 0) {
      try {
        await execFileAsync("git", ["-C", sourcePath, "check-ignore", "-q", "."], {
          encoding: "utf8",
          timeout: 30_000
        });
        // Packaged builtin repositories can live inside a generated directory
        // ignored by the parent checkout. In that case Git reports zero files
        // even though the source directory is populated, so use the guarded
        // filesystem copy below instead of producing an empty workspace.
        return null;
      } catch {
        // Exit code 1 means the source directory itself is not ignored.
      }
    }
    return files;
  } catch {
    return null;
  }
}

async function lstatExists(targetPath: string): Promise<boolean> {
  try {
    // lstat (not stat) so a present-but-broken symlink still counts as existing
    // and is copied verbatim; only a truly absent path returns false.
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyListedFiles(sourcePath: string, destinationPath: string, files: string[]): Promise<void> {
  await ensureDirectory(destinationPath);
  for (const relativePath of files) {
    const normalized = normalizePath(relativePath);
    if (isInternalPath(normalized) || isDefaultSecretPath(normalized)) continue;
    const sourceFile = path.join(sourcePath, normalized);
    // `git ls-files --cached` lists tracked files that have been deleted from
    // the worktree but not yet committed. Those sources no longer exist, so
    // skip them rather than letting a single ENOENT abort the whole copy and
    // strand every agent with "Failed to copy repository".
    if (!(await lstatExists(sourceFile))) continue;
    const destinationFile = path.join(destinationPath, normalized);
    await ensureDirectory(path.dirname(destinationFile));
    await fs.cp(sourceFile, destinationFile, {
      force: true,
      recursive: false,
      verbatimSymlinks: true
    });
  }
}

export async function copyRepository(sourcePath: string, destinationPath: string): Promise<void> {
  const gitFiles = await gitListCopyableFiles(sourcePath);
  if (gitFiles) {
    await copyListedFiles(sourcePath, destinationPath, gitFiles);
    return;
  }

  const rootGitignoreRules = await loadRootGitignoreRules(sourcePath);
  await fs.cp(sourcePath, destinationPath, {
      force: true,
      recursive: true,
      verbatimSymlinks: true,
      filter: (itemPath) => {
        const relativePath = normalizePath(path.relative(sourcePath, itemPath));
        if (!relativePath) return true;
        if (isInternalPath(relativePath) || isDefaultSecretPath(relativePath)) return false;
        return !isIgnoredByRules(relativePath, rootGitignoreRules);
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
  ino: number;
}

/**
 * Incremental hash cache: avoids re-hashing files whose (size, mtime) haven't
 * changed since the last snapshot within the same process. This is especially
 * useful for the before/after snapshot pair in a benchmark run, where the vast
 * majority of files are unchanged. The cache is bounded to prevent unbounded
 * memory growth across many runs.
 */
interface CachedHash {
  size: number;
  mtimeMs: number;
  ino: number;
  hash: string;
}
const hashCache = new Map<string, CachedHash>();
const HASH_CACHE_MAX_SIZE = 50_000;

function getCachedHash(absolutePath: string, size: number, mtimeMs: number, ino: number): string | undefined {
  const cached = hashCache.get(absolutePath);
  // Include the inode in the key: a file that is replaced (e.g. write+rename)
  // keeps the same path but gets a new inode, so even an identical size+mtime
  // must be re-hashed to avoid reusing a stale hash for different content.
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs && cached.ino === ino) {
    return cached.hash;
  }
  return undefined;
}

function setCachedHash(absolutePath: string, size: number, mtimeMs: number, ino: number, hash: string): void {
  if (hashCache.size >= HASH_CACHE_MAX_SIZE) {
    // Evict oldest entry (first inserted) — Map preserves insertion order
    const firstKey = hashCache.keys().next().value;
    if (firstKey !== undefined) {
      hashCache.delete(firstKey);
    }
  }
  hashCache.set(absolutePath, { size, mtimeMs, ino, hash });
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
      if (isInternalPath(relativePath)) continue;

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
        filesToHash.push({ absolutePath, relativePath, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino });
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

  // Phase 2: Hash files in parallel with concurrency limit.
  // Uses an incremental hash cache: files whose (size, mtime) haven't changed
  // since the last snapshot in this process reuse the cached hash.
  let cacheHits = 0;
  const hashes = await mapWithConcurrency(filesToHash, concurrency, async (file) => {
    try {
      const cached = getCachedHash(file.absolutePath, file.size, file.mtimeMs, file.ino);
      if (cached) {
        cacheHits += 1;
        return { relativePath: file.relativePath, hash: cached };
      }
      const hash = await hashFileStream(file.absolutePath);
      setCachedHash(file.absolutePath, file.size, file.mtimeMs, file.ino, hash);
      return { relativePath: file.relativePath, hash };
    } catch (_error) {
      logger.warn("core", "snapshot.skip_file", `Snapshot: skipped file due to error: ${file.relativePath}`, { error: _error });
      return null;
    }
  });

  if (cacheHits > 0) {
    logger.debug("core", "snapshot.cache_hits", `Snapshot: ${cacheHits}/${filesToHash.length} files reused cached hash`);
  }

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
