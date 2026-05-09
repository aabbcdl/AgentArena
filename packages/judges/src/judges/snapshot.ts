import { promises as fs } from "node:fs";
import type { JudgeResult, SnapshotJudge } from "@agentarena/core";
import {
  type JudgeExecutionOptions,
  readTextFileSafe,
  resolveWorkspacePath,
} from "../shared.js";

export async function runSnapshotJudgeWithOptions(
  judge: SnapshotJudge,
  workspacePath: string,
  options: JudgeExecutionOptions
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = await resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);
  const snapshotPath = await resolveWorkspacePath(
    workspacePath,
    judge.snapshotPath,
    `Judge "${judge.id}" snapshotPath`
  );

  try {
    const [actual, expected] = await Promise.all([
      readTextFileSafe(targetPath, `Judge "${judge.id}"`),
      readTextFileSafe(snapshotPath, `Judge "${judge.id}" snapshotPath`)
    ]);
    const normalizedActual = actual.replaceAll("\r\n", "\n");
    const normalizedExpected = expected.replaceAll("\r\n", "\n");
    let success = normalizedActual === normalizedExpected;

    if (!success && options.updateSnapshots) {
      await fs.writeFile(snapshotPath, actual, "utf8");
      success = true;
    }

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "snapshot",
      target: judge.path,
      expectation: `matches ${judge.snapshotPath}`,
      exitCode: success ? 0 : 1,
      success,
      stdout: success
        ? normalizedActual === normalizedExpected
          ? `Snapshot matched ${judge.snapshotPath}.`
          : `Updated snapshot ${judge.snapshotPath} from ${judge.path}.`
        : "",
      stderr: success ? "" : `Snapshot mismatch for "${judge.path}" against "${judge.snapshotPath}".`,
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "snapshot",
      target: judge.path,
      expectation: `matches ${judge.snapshotPath}`,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
