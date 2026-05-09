import { isDeepStrictEqual } from "node:util";
import type { JsonValueJudge, JudgeResult } from "@agentarena/core";
import {
  readTextFileSafe,
  resolveJsonPointer,
  resolveWorkspacePath,
  stringifyExpectation,
} from "../shared.js";

export async function runJsonValueJudge(judge: JsonValueJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = await resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);
  const expectation = stringifyExpectation(judge.expected);

  try {
    const rawText = await readTextFileSafe(targetPath, `Judge "${judge.id}"`);
    const parsed = JSON.parse(rawText);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`Judge "${judge.id}": expected JSON object or array, got ${typeof parsed}`);
    }
    const actual = resolveJsonPointer(parsed, judge.pointer);
    const matched = isDeepStrictEqual(actual, judge.expected);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-value",
      target: `${judge.path}#${judge.pointer}`,
      expectation,
      exitCode: matched ? 0 : 1,
      success: matched,
      stdout: matched ? `Matched JSON value at ${judge.pointer}.` : `Actual: ${stringifyExpectation(actual)}`,
      stderr: matched
        ? ""
        : `Expected ${judge.path} at "${judge.pointer}" to equal ${expectation}.`,
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-value",
      target: `${judge.path}#${judge.pointer}`,
      expectation,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
