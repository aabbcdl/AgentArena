import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
const DEFAULT_IGNORED_NAMES = new Set([
    ".agentarena",
    ".git",
    ".next",
    "coverage",
    "dist",
    "node_modules"
]);
export function createRunId(date = new Date()) {
    const stamp = date.toISOString().replace(/[:.]/g, "-");
    return `${stamp}-${randomUUID().slice(0, 8)}`;
}
export function normalizePath(inputPath) {
    return inputPath.split(path.sep).join("/");
}
export async function ensureDirectory(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}
export async function copyRepository(sourcePath, destinationPath) {
    await fs.cp(sourcePath, destinationPath, {
        force: true,
        recursive: true,
        filter: (itemPath) => {
            const name = path.basename(itemPath);
            return !DEFAULT_IGNORED_NAMES.has(name);
        }
    });
}
export async function snapshotDirectory(rootPath) {
    const snapshots = new Map();
    async function walk(currentPath) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = normalizePath(path.relative(rootPath, absolutePath));
            if (entry.isDirectory()) {
                if (DEFAULT_IGNORED_NAMES.has(entry.name)) {
                    continue;
                }
                await walk(absolutePath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const fileBuffer = await fs.readFile(absolutePath);
            const hash = createHash("sha1").update(fileBuffer).digest("hex");
            snapshots.set(relativePath, { relativePath, hash });
        }
    }
    await walk(rootPath);
    return snapshots;
}
export function diffSnapshots(before, after) {
    const added = [];
    const changed = [];
    const removed = [];
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
export function uniqueSorted(values) {
    return Array.from(new Set(values)).sort();
}
export function formatDuration(durationMs) {
    if (durationMs < 1_000) {
        return `${durationMs}ms`;
    }
    return `${(durationMs / 1_000).toFixed(2)}s`;
}
//# sourceMappingURL=index.js.map