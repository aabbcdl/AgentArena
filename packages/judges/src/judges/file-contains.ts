import type { FileContainsJudge, JudgeResult } from "@agentarena/core";
import {
  hasReDoSRisk,
  readTextFileSafe,
  resolveWorkspacePath,
} from "../shared.js";

export async function runFileContainsJudge(judge: FileContainsJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = await resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    const content = await readTextFileSafe(targetPath, `Judge "${judge.id}"`);

    const validFlags = /^[gimsuy]*$/;
    const flags = judge.flags ?? "";
    if (!validFlags.test(flags)) {
      throw new Error(`Invalid regex flags: "${flags}". Only g, i, m, s, u, y are allowed.`);
    }

    if (judge.pattern.length > 1000) {
      throw new Error(
        `File-contains judge pattern too long: ${judge.pattern.length} chars (max 1000). ` +
        `Large patterns can cause performance issues.`
      );
    }

    if (judge.regex && hasReDoSRisk(judge.pattern)) {
      throw new Error(
        `Regex pattern may cause catastrophic backtracking: /${judge.pattern}/. ` +
        `Nested quantifiers detected.`
      );
    }

    const matched = judge.regex
      ? new RegExp(judge.pattern, flags).test(content)
      : content.includes(judge.pattern);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-contains",
      target: judge.path,
      expectation: judge.regex
        ? `regex:${judge.pattern}${judge.flags ? `/${judge.flags}` : ""}`
        : judge.pattern,
      exitCode: matched ? 0 : 1,
      success: matched,
      stdout: matched ? `Matched content in ${judge.path}.` : "",
      stderr: matched
        ? ""
        : `Expected file "${judge.path}" to contain ${judge.regex ? "a regex match" : "the target string"}.`,
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "file-contains",
      target: judge.path,
      expectation: judge.pattern,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
