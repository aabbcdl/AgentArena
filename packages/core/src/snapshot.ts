import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizePath } from "./paths.js";
import type { DiffSummary, FileSnapshotEntry } from "./types.js";

const INTERNAL_IGNORED_NAMES = new Set([".agentarena", ".git", "node_modules"]);

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

export async function snapshotDirectory(rootPath: string): Promise<Map<string, FileSnapshotEntry>> {
  const snapshots = new Map<string, FileSnapshotEntry>();

  async function walk(currentPath: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (_error) {
      // Skip directories that cannot be read (e.g., permission issues)
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
        const fileBuffer = await fs.readFile(absolutePath);
        // Use SHA-256 for better security (SHA-1 is sufficient for file comparison but SHA-256 is more future-proof)
        const hash = createHash("sha256").update(fileBuffer).digest("hex");
        snapshots.set(relativePath, { relativePath, hash });
      } catch (_error) {
        // Skip files that cannot be read (e.g., permission issues, broken symlinks).
        // This is intentional — snapshot comparison should not fail due to inaccessible files.
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
