import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileDiffArtifact } from "@agentarena/core";

const execFileAsync = promisify(execFile);

/** Cap per-file unified diff size so summary.json stays usable in the UI. */
const MAX_DIFF_CHARS_PER_FILE = 80_000;
/** Cap how many files get line-level diffs in one result. */
const MAX_DIFF_FILES = 40;

const GIT_OPTS = {
  encoding: "utf8" as const,
  timeout: 30_000,
  maxBuffer: 4 * 1024 * 1024,
  windowsHide: true
};

/**
 * Split a multi-file `git diff` body into per-path artifacts.
 */
export function parseUnifiedDiffByFile(diffText: string): FileDiffArtifact[] {
  if (!diffText.trim()) return [];
  const chunks = diffText.split(/(?=^diff --git )/m).filter((chunk) => chunk.trim());
  const artifacts: FileDiffArtifact[] = [];
  for (const chunk of chunks) {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const pathFromB = header?.[2]?.trim();
    const pathFromPlus = chunk.match(/^\+\+\+ [ab]\/(.+)$/m)?.[1]?.trim();
    const filePath = pathFromB || pathFromPlus;
    if (!filePath || filePath === "/dev/null") continue;
    let text = chunk;
    if (text.length > MAX_DIFF_CHARS_PER_FILE) {
      text = `${text.slice(0, MAX_DIFF_CHARS_PER_FILE)}\n\n… [diff truncated for size]`;
    }
    artifacts.push({ path: filePath.replace(/\\/g, "/"), text });
  }
  return artifacts;
}

/**
 * Collect per-file unified diffs for changed paths in an agent workspace.
 *
 * Best-effort: stages selected paths with `git add` (including new files),
 * reads `git diff --cached`, then resets the index. Failures yield an empty
 * list rather than failing the run.
 */
export async function collectFileDiffs(
  workspacePath: string,
  changedFiles: string[]
): Promise<FileDiffArtifact[]> {
  if (changedFiles.length === 0) return [];

  const selected = changedFiles
    .map((file) => file.replace(/\\/g, "/"))
    .filter(Boolean)
    .slice(0, MAX_DIFF_FILES);

  if (selected.length === 0) return [];

  try {
    await execFileAsync("git", ["add", "-A", "--", ...selected], {
      cwd: workspacePath,
      ...GIT_OPTS
    });
  } catch {
    // If add fails, try unstaged diff only (modified tracked files).
    try {
      const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--", ...selected], {
        cwd: workspacePath,
        ...GIT_OPTS
      });
      return parseUnifiedDiffByFile(typeof stdout === "string" ? stdout : "").slice(0, MAX_DIFF_FILES);
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync("git", ["diff", "--cached", "--", ...selected], {
      cwd: workspacePath,
      ...GIT_OPTS
    });
    return parseUnifiedDiffByFile(typeof stdout === "string" ? stdout : "").slice(0, MAX_DIFF_FILES);
  } catch {
    return [];
  } finally {
    try {
      await execFileAsync("git", ["reset", "HEAD", "--", ...selected], {
        cwd: workspacePath,
        ...GIT_OPTS
      });
    } catch {
      // Best-effort index restore; workspace is temporary per agent run.
    }
  }
}
