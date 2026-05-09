import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type DiffPrecisionSummary, uniqueSorted } from "@agentarena/core";
import picomatch from "picomatch";

const execFileAsync = promisify(execFile);

export function buildDiffPrecision(
  expectedChangedPaths: string[] | undefined,
  changedFiles: string[]
): DiffPrecisionSummary | undefined {
  if (!expectedChangedPaths || expectedChangedPaths.length === 0) {
    return undefined;
  }

  const matchers = expectedChangedPaths.map((pattern) => picomatch(pattern, { dot: true }));
  const matchedFiles = changedFiles.filter((filePath) => matchers.some((isMatch) => isMatch(filePath)));
  const unexpectedFiles = changedFiles.filter((filePath) => !matchers.some((isMatch) => isMatch(filePath)));

  return {
    score: changedFiles.length > 0 ? matchedFiles.length / changedFiles.length : 0,
    expectedScopeCount: expectedChangedPaths.length,
    totalChangedFiles: changedFiles.length,
    matchedFiles: uniqueSorted(matchedFiles),
    unexpectedFiles: uniqueSorted(unexpectedFiles)
  };
}

export async function collectChangedFiles(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD"], {
      cwd: workspacePath,
      timeout: 10000
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
