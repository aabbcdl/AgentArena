import type { FileCountJudge, JudgeResult } from "@agentarena/core";
import {
  createGlobMatcher,
  listWorkspaceFiles,
  stringifyExpectation,
} from "../shared.js";

export async function runFileCountJudge(judge: FileCountJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const matcher = createGlobMatcher(judge.pattern);

  try {
    const matches = (await listWorkspaceFiles(workspacePath)).filter((filePath) => matcher(filePath));
    const actual = matches.length;
    const success =
      (judge.equals === undefined || actual === judge.equals) &&
      (judge.min === undefined || actual >= judge.min) &&
      (judge.max === undefined || actual <= judge.max);

    const expectationParts = [
      judge.equals !== undefined ? `equals=${judge.equals}` : "",
      judge.min !== undefined ? `min=${judge.min}` : "",
      judge.max !== undefined ? `max=${judge.max}` : ""
    ].filter(Boolean);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-count",
      target: judge.pattern,
      expectation: expectationParts.join(", "),
      exitCode: success ? 0 : 1,
      success,
      stdout: `Actual count=${actual}${matches.length > 0 ? `; matches: ${matches.join(", ")}` : ""}`,
      stderr: success ? "" : `File count assertion failed for pattern "${judge.pattern}".`,
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-count",
      target: judge.pattern,
      expectation: stringifyExpectation({
        equals: judge.equals,
        min: judge.min,
        max: judge.max
      }),
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
