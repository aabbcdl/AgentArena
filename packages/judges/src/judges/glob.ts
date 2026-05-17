import type { GlobJudge, JudgeResult } from "@agentarena/core";
import {
  createGlobMatcher,
  listWorkspaceFiles,
} from "../shared.js";

export async function runGlobJudge(judge: GlobJudge, workspacePath: string, fileList?: string[]): Promise<JudgeResult> {
  const startedAt = Date.now();
  const matcher = createGlobMatcher(judge.pattern);

  try {
    const allFiles = fileList ?? await listWorkspaceFiles(workspacePath);
    const matches = allFiles.filter((filePath) => matcher(filePath));
    const minMatches = judge.minMatches ?? 1;
    const maxMatches = judge.maxMatches;
    const success = matches.length >= minMatches && (maxMatches === undefined || matches.length <= maxMatches);

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "glob",
      target: judge.pattern,
      expectation:
        maxMatches === undefined
          ? `matches>=${minMatches}`
          : `matches>=${minMatches} && matches<=${maxMatches}`,
      exitCode: success ? 0 : 1,
      success,
      stdout: matches.length > 0 ? `Matched files: ${matches.join(", ")}` : "",
      stderr: success
        ? ""
        : `Expected glob "${judge.pattern}" to match within configured bounds, actual matches=${matches.length}.`,
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "glob",
      target: judge.pattern,
      expectation:
        judge.maxMatches === undefined
          ? `matches>=${judge.minMatches ?? 1}`
          : `matches>=${judge.minMatches ?? 1} && matches<=${judge.maxMatches}`,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
