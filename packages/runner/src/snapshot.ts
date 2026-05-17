import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type DiffPrecisionSummary, metrics, uniqueSorted } from "@agentarena/core";
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
  const startTime = Date.now();
  let status = "success";
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD"], {
      cwd: workspacePath,
      timeout: 10000
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch (error: unknown) {
    status = "failure";
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const code = (error as { code?: number }).code;
    if (stderr.includes("not a git repository") || code === 128) {
      return [];
    }
    console.warn(`[agentarena] git diff failed in ${workspacePath}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  } finally {
    const durationSeconds = (Date.now() - startTime) / 1000;
    metrics.gitOperationTotal.inc({ operation: "diff", status });
    metrics.gitOperationDurationSeconds.observe({ operation: "diff" }, durationSeconds);
  }
}
