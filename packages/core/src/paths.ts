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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace absolute references to a run workspace with repository-relative text. */
export function relativizeWorkspacePathsInText(value: string, workspacePath: string): string {
  if (!value || !workspacePath) return value;

  const normalizedWorkspace = normalizePath(workspacePath).replace(/\/+$/u, "");
  if (!normalizedWorkspace) return value;

  const candidates = Array.from(new Set([
    normalizedWorkspace,
    normalizedWorkspace.replace(/\//g, "\\")
  ])).sort((left, right) => right.length - left.length);

  let result = value;
  for (const candidate of candidates) {
    const flags = isWindowsLikePath(candidate) ? "giu" : "gu";
    const escaped = escapeRegExp(candidate);
    result = result.replace(new RegExp(`${escaped}[\\\\/]`, flags), "");
    result = result.replace(new RegExp(`${escaped}(?=$|[^A-Za-z0-9._-])`, flags), ".");
  }
  return result;
}

/**
 * Check if targetPath is inside workspacePath.
 *
 * @security
 * SECURITY NOTE (TOCTOU): This function uses fs.realpath to resolve symlinks,
 * but the target path could be modified between the realpath check and actual
 * file access. For critical security boundaries, use fs.open() + fstat()
 * on the opened file descriptor instead. This function provides best-effort
 * protection suitable for the advisory sandbox model.
 */
export async function isPathInsideWorkspace(workspacePath: string, targetPath: string): Promise<boolean> {
  const resolveForComparison = async (inputPath: string): Promise<string> => {
    const fallback = path.resolve(inputPath);
    let candidate = fallback;
    const suffix: string[] = [];

    // Resolve the existing ancestor as well as the target. This preserves the
    // symlink boundary check for missing paths and handles macOS aliases such
    // as /var -> /private/var before comparing the two paths.
    while (true) {
      try {
        return path.join(await fs.realpath(candidate), ...suffix);
      } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== "ENOENT") {
          return fallback;
        }
        const parent = path.dirname(candidate);
        if (parent === candidate) return fallback;
        suffix.unshift(path.basename(candidate));
        candidate = parent;
      }
    }
  };

  const [resolvedWorkspace, resolvedTarget] = await Promise.all([
    resolveForComparison(workspacePath),
    resolveForComparison(targetPath)
  ]);

  // Compare canonicalized paths so lexical aliases cannot bypass or trigger
  // the boundary check (for example /var and /private/var on macOS).
  const relativePath = path.relative(resolvedWorkspace, resolvedTarget);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }
  return true;
}

export async function safePathJoin(basePath: string, ...segments: string[]): Promise<string> {
  const joined = path.join(basePath, ...segments);
  if (!(await isPathInsideWorkspace(basePath, joined))) {
    throw new Error(`Path traversal detected: attempted to access "${joined}" outside workspace "${basePath}"`);
  }
  return joined;
}
