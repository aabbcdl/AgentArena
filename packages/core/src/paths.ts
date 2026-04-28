import { promises as fs } from "node:fs";
import path from "node:path";

export function normalizePath(inputPath: string): string {
  return inputPath.split(path.sep).join("/").replace(/\\/g, "/");
}

export function isWindowsLikePath(inputPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(inputPath) || inputPath.includes("\\");
}

export function portableRelativePath(fromPath: string, toPath: string): string {
  if (isWindowsLikePath(fromPath) || isWindowsLikePath(toPath)) {
    return path.win32.relative(fromPath, toPath).replace(/\\/g, "/");
  }

  return path.posix.relative(fromPath, toPath).replace(/\\/g, "/");
}

export function portableBasename(inputPath: string): string {
  return isWindowsLikePath(inputPath) ? path.win32.basename(inputPath) : path.posix.basename(inputPath);
}

export async function isPathInsideWorkspace(workspacePath: string, targetPath: string): Promise<boolean> {
  // Step 1: Use resolve to normalize and get absolute paths
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedTarget = path.resolve(targetPath);

  // Step 2: Basic path traversal check (handles `..` and absolute paths)
  const relativePath = path.relative(resolvedWorkspace, resolvedTarget);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }

  // Step 3: If target exists, verify no symlink escape (for symlink path traversal prevention)
  try {
    const realTarget = await fs.realpath(resolvedTarget);
    const realWorkspace = await fs.realpath(resolvedWorkspace);
    const realRelativePath = path.relative(realWorkspace, realTarget);
    return !realRelativePath.startsWith("..") && !path.isAbsolute(realRelativePath);
  } catch {
    // If path doesn't exist or can't be resolved, fall back to basic check
    return true;
  }
}

export async function safePathJoin(basePath: string, ...segments: string[]): Promise<string> {
  const joined = path.join(basePath, ...segments);
  if (!(await isPathInsideWorkspace(basePath, joined))) {
    throw new Error(`Path traversal detected: attempted to access "${joined}" outside workspace "${basePath}"`);
  }
  return joined;
}
