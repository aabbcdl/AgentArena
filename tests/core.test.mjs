import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionEnvironment, diffSnapshots, uniqueSorted } from "../packages/core/dist/index.js";

test("uniqueSorted removes duplicates and sorts values", () => {
  assert.deepEqual(uniqueSorted(["b", "a", "b"]), ["a", "b"]);
});

test("diffSnapshots reports added, changed, and removed files", () => {
  const before = new Map([
    ["README.md", { relativePath: "README.md", hash: "old" }],
    ["src/app.ts", { relativePath: "src/app.ts", hash: "same" }]
  ]);
  const after = new Map([
    ["README.md", { relativePath: "README.md", hash: "new" }],
    ["src/app.ts", { relativePath: "src/app.ts", hash: "same" }],
    ["src/new.ts", { relativePath: "src/new.ts", hash: "added" }]
  ]);

  assert.deepEqual(diffSnapshots(before, after), {
    added: ["src/new.ts"],
    changed: ["README.md"],
    removed: []
  });
});

test("buildExecutionEnvironment includes only baseline and allowlisted variables", () => {
  process.env.REPOARENA_ALLOWED_TEST = "visible";
  process.env.REPOARENA_BLOCKED_TEST = "hidden";

  const environment = buildExecutionEnvironment(["REPOARENA_ALLOWED_TEST"]);

  assert.equal(environment.REPOARENA_ALLOWED_TEST, "visible");
  assert.equal(environment.REPOARENA_BLOCKED_TEST, undefined);
  assert.ok(environment.PATH || environment.Path);
});
