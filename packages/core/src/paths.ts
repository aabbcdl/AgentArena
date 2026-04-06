import path from "node:path";

export function normalizePath(inputPath: string): string {
  return inputPath
    .split(path.sep)
    .join("/")
    .replace(/\\/g, "/");
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

export function isPathInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedTarget = path.resolve(targetPath);
  const relativePath = path.relative(resolvedWorkspace, resolvedTarget);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function safePathJoin(basePath: string, ...segments: string[]): string {
  const joined = path.join(basePath, ...segments);
  if (!isPathInsideWorkspace(basePath, joined)) {
    throw new Error(`Path traversal detected: attempted to access "${joined}" outside workspace "${basePath}"`);
  }
  return joined;
}
