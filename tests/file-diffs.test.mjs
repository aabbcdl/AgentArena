import assert from "node:assert/strict";
import test from "node:test";

import { parseUnifiedDiffByFile } from "../packages/runner/dist/file-diffs.js";

test("parseUnifiedDiffByFile splits multi-file unified diffs", () => {
  const text = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/src/b.ts b/src/b.ts",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    ""
  ].join("\n");

  const artifacts = parseUnifiedDiffByFile(text);
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0].path, "src/a.ts");
  assert.ok(artifacts[0].text.includes("+new"));
  assert.equal(artifacts[1].path, "src/b.ts");
  assert.ok(artifacts[1].text.includes("+y"));
});

test("parseUnifiedDiffByFile returns empty for blank input", () => {
  assert.deepEqual(parseUnifiedDiffByFile(""), []);
  assert.deepEqual(parseUnifiedDiffByFile("   \n"), []);
});
