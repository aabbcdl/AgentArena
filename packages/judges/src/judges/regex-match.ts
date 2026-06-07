import type { JudgeResult, RegexMatchJudge } from "@agentarena/core";
import {
  hasReDoSRisk,
  readTextFileSafe,
  resolveWorkspacePath,
} from "../shared.js";

export async function runRegexMatchJudge(
  judge: RegexMatchJudge,
  workspacePath: string
): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = await resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    const content = await readTextFileSafe(targetPath, `Judge "${judge.id}"`);

    const validFlags = /^[gimsuy]*$/;
    const flags = judge.flags ?? "";
    if (!validFlags.test(flags)) {
      throw new Error(`Invalid regex flags: "${flags}". Only g, i, m, s, u, y are allowed.`);
    }

    const effectiveFlags = (judge.minMatches && judge.minMatches > 1 && !flags.includes("g"))
      ? flags + "g"
      : flags;

    if (judge.pattern.length > 2000) {
      throw new Error(
        `Regex pattern too long: ${judge.pattern.length} chars (max 2000). ` +
        `Large patterns can cause performance issues or ReDoS vulnerabilities.`
      );
    }

    if (hasReDoSRisk(judge.pattern)) {
      throw new Error(
        `Regex pattern may cause catastrophic backtracking: /${judge.pattern}/. ` +
        `Nested quantifiers detected.`
      );
    }

    let regex: RegExp;
    try {
      regex = new RegExp(judge.pattern, effectiveFlags);
    } catch (error) {
      throw new Error(`Invalid regex pattern "${judge.pattern}": ${error instanceof Error ? error.message : String(error)}`);
    }

    let matchCount: number;
    if (regex.global) {
      // Cap match counting to prevent memory exhaustion on large files
      const MAX_MATCH_COUNT = 100_000;
      let count = 0;
      for (const _match of content.matchAll(regex)) {
        count++;
        if (count >= MAX_MATCH_COUNT) break;
      }
      matchCount = count;
    } else {
      // Wrap in timeout to guard against ReDoS on non-global patterns
      const REGEX_TEST_TIMEOUT_MS = 5_000;
      matchCount = await Promise.race([
        Promise.resolve().then(() => regex.test(content) ? 1 : 0),
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error(`Regex test timed out after ${REGEX_TEST_TIMEOUT_MS}ms — possible ReDoS pattern: /${judge.pattern}/`)), REGEX_TEST_TIMEOUT_MS)
        ),
      ]);
    }
    const minMatches = judge.minMatches ?? 1;
    const shouldNotMatch = judge.shouldNotMatch ?? false;

    let success: boolean;
    if (shouldNotMatch) {
      success = matchCount === 0;
    } else {
      success = matchCount >= minMatches;
      if (judge.maxMatches && judge.maxMatches > 0) {
        success = success && matchCount <= judge.maxMatches;
      }
    }

    const matchDetail = shouldNotMatch
      ? `Pattern should NOT match (found ${matchCount} matches)`
      : `Found ${matchCount} match(es) (expected ${minMatches}${judge.maxMatches ? `-${judge.maxMatches}` : "+"})`;

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "regex-match",
      target: judge.path,
      expectation: shouldNotMatch ? `regex should not match: /${judge.pattern}/${effectiveFlags}` : `regex: /${judge.pattern}/${effectiveFlags}`,
      exitCode: success ? 0 : 1,
      success,
      stdout: success ? `${matchDetail}.` : `${matchDetail}.`,
      stderr: "",
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "regex-match",
      target: judge.path,
      expectation: `regex: /${judge.pattern}/${judge.flags ?? ""}`,
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
