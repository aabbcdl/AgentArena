import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { normalizePath } from "./paths.js";
import type { DiffSummary, FileSnapshotEntry } from "./types.js";

const INTERNAL_IGNORED_NAMES = new Set([".agentarena", ".git", "node_modules"]);
const MAX_SNAPSHOT_FILE_SIZE = 100 * 1024 * 1024; // 100 MB - skip larger files

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

export async function snapshotDirectory(rootPath: string): Promise<Map<string, FileSnapshotEntry>> {
  const snapshots = new Map<string, FileSnapshotEntry>();

  async function walk(currentPath: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (_error) {
      // Skip directories that cannot be read (e.g., permission issues)
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
        // Check file size first to avoid loading huge files into memory
        const stat = await fs.stat(absolutePath);
        if (stat.size > MAX_SNAPSHOT_FILE_SIZE) {
          // Create a synthetic hash based on metadata for huge files
          const hash = createHash("sha256")
            .update(`huge-file:${relativePath}:${stat.size}:${stat.mtimeMs}`)
            .digest("hex");
          snapshots.set(relativePath, { relativePath, hash });
          continue;
        }

        const hash = await hashFileStream(absolutePath);
        snapshots.set(relativePath, { relativePath, hash });
      } catch (_error) {
        // Skip files that cannot be read (e.g., permission issues, broken symlinks).
        // This is intentional — snapshot comparison should not fail due to inaccessible files.
        console.warn(`Snapshot: skipped file due to error: ${relativePath}`, _error instanceof Error ? _error.message : String(_error));
      }
    }
  }

  await walk(rootPath);
  return snapshots;
}

export function diffSnapshots(
  before: Map<string, FileSnapshotEntry>,
  after: Map<string, FileSnapshotEntry>
): DiffSummary {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [relativePath, afterEntry] of after.entries()) {
    const beforeEntry = before.get(relativePath);

    if (!beforeEntry) {
      added.push(relativePath);
      continue;
    }

    if (beforeEntry.hash !== afterEntry.hash) {
      changed.push(relativePath);
    }
  }

  for (const relativePath of before.keys()) {
    if (!after.has(relativePath)) {
      removed.push(relativePath);
    }
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort()
  };
}
