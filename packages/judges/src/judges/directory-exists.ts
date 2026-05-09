import { promises as fs } from "node:fs";
import type { DirectoryExistsJudge, JudgeResult } from "@agentarena/core";
import { resolveWorkspacePath } from "../shared.js";

export async function runDirectoryExistsJudge(
  judge: DirectoryExistsJudge,
  workspacePath: string
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = await resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    const stat = await fs.stat(targetPath);
    const exists = stat.isDirectory();

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "directory-exists",
      target: judge.path,
      expectation: "directory exists",
      exitCode: exists ? 0 : 1,
      success: exists,
      stdout: exists ? `Found directory "${judge.path}".` : "",
      stderr: exists ? "" : `Expected directory "${judge.path}" does not exist or is not a directory.`,
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "directory-exists",
      target: judge.path,
      expectation: "directory exists",
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: `Failed to check directory "${judge.path}": ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
