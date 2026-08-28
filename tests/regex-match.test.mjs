import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRegexMatchJudge } from "../packages/judges/dist/judges/regex-match.js";
import { hasReDoSRisk, runRegexTestWithTimeout } from "../packages/judges/dist/shared.js";

/**
 * Coverage for regex-match judge + the hasReDoSRisk heuristic.
 *
 * Prior to this file, both surfaces had zero direct tests:
 *   - hasReDoSRisk was never exercised by name, so the heuristic could be
 *     silently broken without anyone noticing.
 *   - The regex-match judge's edge cases (length cap, flag whitelist, shouldNotMatch,
 *     minMatches/maxMatches, MAX_MATCH_COUNT cap, ReDoS detection) had no tests.
 *
 * A malicious taskpack could supply `(a+)+$` and lock up the judge process
 * indefinitely without these guards holding. We assert the heuristic catches
 * known catastrophic patterns and lets safe patterns through.
 */

async function withTempFile(content, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-regex-"));
  const filePath = path.join(dir, "target.txt");
  await fs.writeFile(filePath, content, "utf8");
  try {
    return await fn(dir, "target.txt");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const baseJudge = (overrides) => ({
  id: "regex-test",
  label: "regex test",
  type: "regex-match",
  path: "target.txt",
  pattern: "hello",
  ...overrides
});

// --- hasReDoSRisk heuristic ---

test("hasReDoSRisk detects nested + quantifier", () => {
  assert.equal(hasReDoSRisk("(a+)+"), true);
});

test("hasReDoSRisk detects nested * quantifier", () => {
  assert.equal(hasReDoSRisk("(a+)*"), true);
});

test("hasReDoSRisk detects nested ? quantifier", () => {
  assert.equal(hasReDoSRisk("(a*)+"), true);
});

test("hasReDoSRisk allows safe alternation patterns", () => {
  assert.equal(hasReDoSRisk("foo|bar|baz"), false);
});

test("hasReDoSRisk allows simple literal", () => {
  assert.equal(hasReDoSRisk("hello world"), false);
});

test("hasReDoSRisk allows character class with quantifier", () => {
  assert.equal(hasReDoSRisk("[a-z]+"), false);
});

test("hasReDoSRisk allows non-nested grouping", () => {
  assert.equal(hasReDoSRisk("(abc)def"), false);
});

test("runRegexTestWithTimeout terminates a stuck regex in a worker", { timeout: 2_000 }, async () => {
  await assert.rejects(
    () => runRegexTestWithTimeout("(a+)+$", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", 50),
    /timed out/i
  );
});

// --- runRegexMatchJudge: positive matches ---

test("runRegexMatchJudge succeeds when literal matches", async () => {
  await withTempFile("hello world", async (workspace, file) => {
    const result = await runRegexMatchJudge(baseJudge({ path: file, pattern: "hello" }), workspace);
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /1 match/);
  });
});

test("runRegexMatchJudge succeeds when minMatches is met", async () => {
  await withTempFile("foo foo foo", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "foo", flags: "g", minMatches: 3 }),
      workspace
    );
    assert.equal(result.success, true);
  });
});

test("runRegexMatchJudge fails when minMatches is unmet", async () => {
  await withTempFile("foo foo", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "foo", flags: "g", minMatches: 5 }),
      workspace
    );
    assert.equal(result.success, false);
  });
});

test("runRegexMatchJudge enforces maxMatches", async () => {
  await withTempFile("foo foo foo foo foo", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "foo", flags: "g", maxMatches: 2 }),
      workspace
    );
    assert.equal(result.success, false);
  });
});

test("runRegexMatchJudge enforces maxMatches even without the g flag", async () => {
  // Regression: without `g` the count capped at 1, so a maxMatches ceiling
  // silently passed on files with more matches. The judge must add `g` itself.
  await withTempFile("foo foo foo foo foo", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "foo", maxMatches: 2 }),
      workspace
    );
    assert.equal(result.success, false);
  });
});

// --- shouldNotMatch ---

test("runRegexMatchJudge with shouldNotMatch succeeds when absent", async () => {
  await withTempFile("hello world", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "FORBIDDEN", shouldNotMatch: true }),
      workspace
    );
    assert.equal(result.success, true);
    assert.match(result.stdout, /should NOT match/);
  });
});

test("runRegexMatchJudge with shouldNotMatch fails when present", async () => {
  await withTempFile("hello world", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "hello", shouldNotMatch: true }),
      workspace
    );
    assert.equal(result.success, false);
  });
});

// --- ReDoS protection ---

test("runRegexMatchJudge rejects ReDoS-prone pattern", async () => {
  await withTempFile("aaaa", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "(a+)+" }),
      workspace
    );
    assert.equal(result.success, false);
    assert.match(result.stderr, /catastrophic backtracking|nested quantifier/i);
  });
});

// --- Pattern length cap ---

test("runRegexMatchJudge rejects patterns longer than 2000 chars", async () => {
  await withTempFile("anything", async (workspace, file) => {
    const longPattern = "a".repeat(2001);
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: longPattern }),
      workspace
    );
    assert.equal(result.success, false);
    assert.match(result.stderr, /too long|2000/i);
  });
});

test("runRegexMatchJudge accepts patterns at the 2000-char boundary", async () => {
  await withTempFile("a", async (workspace, file) => {
    // 2000-char pattern with no special operators — should be allowed.
    const boundary = "a".repeat(2000);
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: boundary }),
      workspace
    );
    // The judge runs; success depends on file content, but it shouldn't be
    // rejected for length.
    assert.doesNotMatch(result.stderr, /too long/i);
  });
});

// --- Flag validation ---

test("runRegexMatchJudge rejects invalid flags", async () => {
  await withTempFile("anything", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "x", flags: "xyz" }),
      workspace
    );
    assert.equal(result.success, false);
    assert.match(result.stderr, /Invalid regex flags/i);
  });
});

test("runRegexMatchJudge accepts all valid flags", async () => {
  await withTempFile("HELLO\nworld", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "hello", flags: "i" }),
      workspace
    );
    assert.equal(result.success, true);
  });
});

// --- Invalid regex pattern ---

test("runRegexMatchJudge reports invalid regex", async () => {
  await withTempFile("anything", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "[unclosed" }),
      workspace
    );
    assert.equal(result.success, false);
    assert.match(result.stderr, /Invalid regex|unterminated/i);
  });
});

// --- MAX_MATCH_COUNT cap ---

test("runRegexMatchJudge caps match counting at 100_000", async () => {
  // 200k single characters: matching every char with /./g would attempt 200k
  // matches; the judge caps at 100_000. Verify no timeout and the cap is honored
  // by setting maxMatches above the cap and expecting a successful count.
  const huge = "a".repeat(200_000);
  await withTempFile(huge, async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: ".", flags: "g", minMatches: 1 }),
      workspace
    );
    // The judge stops counting at 100_000; output should mention some match count
    // but not throw, and success holds (>= 1 minMatch).
    assert.equal(result.success, true);
    // Match count in stdout should be at most the cap.
    const match = /Found (\d+) match/.exec(result.stdout);
    assert.ok(match, `expected match count in stdout, got: ${result.stdout}`);
    const count = Number(match[1]);
    assert.ok(count <= 100_000, `expected count capped at 100_000, got ${count}`);
  });
});

// --- File reading errors ---

test("runRegexMatchJudge fails gracefully when target file is missing", async () => {
  await withTempFile("placeholder", async (workspace, _file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: "does-not-exist.txt", pattern: "x" }),
      workspace
    );
    assert.equal(result.success, false);
    assert.ok(result.stderr.length > 0);
  });
});

// --- minMatches auto-promotes to global ---

test("runRegexMatchJudge auto-promotes to global flag when minMatches > 1", async () => {
  // Without 'g' flag, regex.test() only sees the first match. The judge should
  // auto-add 'g' when minMatches > 1 so the count is accurate.
  await withTempFile("foo foo foo", async (workspace, file) => {
    const result = await runRegexMatchJudge(
      baseJudge({ path: file, pattern: "foo", minMatches: 3 }), // no 'g' flag
      workspace
    );
    assert.equal(result.success, true, `expected 3+ matches; got: ${result.stdout}/${result.stderr}`);
  });
});
