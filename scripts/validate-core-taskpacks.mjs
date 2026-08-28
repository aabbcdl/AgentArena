import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runJudges, runCommandSteps } from "../packages/judges/dist/index.js";
import { diffSnapshots, snapshotDirectory } from "../packages/core/dist/snapshot.js";
import { loadTaskPack } from "../packages/taskpacks/dist/index.js";
import { evaluateChangePolicy } from "../packages/runner/dist/snapshot.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtureRoot = path.join(repoRoot, "examples", "taskpacks", "repos", "nodejs-core");
const taskRoot = path.join(repoRoot, "examples", "taskpacks", "official");
const taskFiles = (await readdir(taskRoot))
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();
const coreTasks = (await Promise.all(
  taskFiles.map((name) => loadTaskPack(path.join(taskRoot, name)))
)).filter((task) => task.metadata?.lifecycle === "core");

assert.equal(coreTasks.length, 10, "The first-release catalog must contain exactly 10 core task packs");

async function copyFixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "agentarena-core-task-"));
  await cp(fixtureRoot, workspace, {
    recursive: true,
    force: true,
    filter: (source) => ![".git", "node_modules"].includes(path.basename(source))
  });
  return workspace;
}

async function runSetup(task, workspace) {
  const results = await runCommandSteps(task.setupCommands, workspace, task.envAllowList, undefined, { allowEval: true });
  assert.equal(results.every((result) => result.success), true, `${task.id}: setup failed: ${JSON.stringify(results)}`);
}

async function criticalJudges(task, workspace) {
  return runJudges(task.judges, workspace, task.envAllowList, { allowEval: true });
}

async function realChangedFiles(before, after) {
  const diff = diffSnapshots(before, after);
  return {
    diff,
    files: [...diff.added, ...diff.changed, ...diff.removed].sort()
  };
}

async function writeReference(taskId, workspace) {
  const fixture = async (relativePath) => readFile(path.join(fixtureRoot, relativePath), "utf8");
  const write = async (relativePath, content) => {
    await mkdir(path.dirname(path.join(workspace, relativePath)), { recursive: true });
    await writeFile(path.join(workspace, relativePath), content, "utf8");
  };

  switch (taskId) {
    case "repo-health":
      await write("src/utils.js", (await fixture("src/utils.js")).replace(
        "return value.replace(/\\b\\w/g, (character) => character.toUpperCase());",
        "return value.replace(/\\b\\w/g, (character) => character.toUpperCase());"
      ));
      break;
    case "config-repair":
      await write("fixtures/config.json", `${JSON.stringify({
        server: { host: "127.0.0.1", port: 3000 },
        database: { url: "file:arena.db", poolSize: 4 },
        mode: "production",
        version: "1.0.0"
      }, null, 2)}\n`);
      break;
    case "json-contract-repair":
      await write("fixtures/response.json", `${JSON.stringify({
        status: "ready",
        items: [{ id: "alpha", value: 1 }, { id: "beta", value: 2 }],
        requestId: "req-001"
      }, null, 2)}\n`);
      break;
    case "snapshot-fix":
      await write("src/generator.js", (await fixture("src/generator.js")).replace("Report:", "Report:"));
      break;
    case "failing-test-fix":
      await write("src/calculator.js", (await fixture("src/calculator.js")).replace("return a - b;", "return a - b;"));
      break;
    case "add-feature-with-tests":
      await write("src/memoize.js", `function memoize(fn) {
  if (typeof fn !== "function") throw new TypeError("fn must be a function");
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const value = fn(...args);
    cache.set(key, value);
    return value;
  };
}

module.exports = { memoize };
`);
      await write("test/memoize.test.js", `const test = require("node:test");
const assert = require("node:assert/strict");
const { memoize } = require("../src/memoize");

test("memoize caches each primitive argument tuple", () => {
  let calls = 0;
  const add = memoize((a, b) => { calls += 1; return a + b; });
  assert.equal(add(1, 2), 3);
  assert.equal(add(1, 2), 3);
  assert.equal(add(2, 1), 3);
  assert.equal(calls, 2);
});
`);
      break;
    case "logging-improvement":
      await write("src/logger.js", await fixture("src/logger.js"));
      break;
    case "input-validation":
      await write("src/validator.js", await fixture("src/validator.js"));
      break;
    case "cross-file-refactor":
      await write("src/slugify.js", await fixture("src/slugify.js"));
      await write("src/utils.js", await fixture("src/utils.js"));
      await write("src/index.js", await fixture("src/index.js"));
      break;
    case "test-coverage":
      await write("test/logger.test.js", `const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger } = require("../src/logger");

test("logger filters levels and merges child context", () => {
  const lines = [];
  const logger = createLogger("coverage", { level: "info", context: { requestId: "r-2" }, sink: (line) => lines.push(line) });
  logger.debug("hidden");
  logger.info("visible", { operation: "read" });
  logger.child({ jobId: "j-2" }).warn("retry");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /requestId/);
  assert.match(lines[0], /operation/);
  assert.match(lines[1], /jobId/);
});
`);
      await write("test/validator.test.js", `const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeHtml, isSafePath, requireNonEmptyString } = require("../src/validator");

test("validator rejects markup, traversal, and empty values", () => {
  assert.equal(sanitizeHtml("<p>ok</p><script>bad()</script>"), "ok");
  assert.equal(isSafePath("reports/out.txt", "D:/workspace"), true);
  assert.equal(isSafePath("../secret.txt", "D:/workspace"), false);
  assert.throws(() => requireNonEmptyString("  ", "name"), TypeError);
});
`);
      break;
    default:
      throw new Error(`No reference implementation for ${taskId}`);
  }
}

async function assertPolicyFailure(task, workspace, before, extraPath) {
  await writeFile(path.join(workspace, extraPath), "out-of-scope\n", "utf8");
  const after = await snapshotDirectory(workspace);
  const { diff } = await realChangedFiles(before, after);
  const result = evaluateChangePolicy(task.changePolicy, [...diff.added, ...diff.changed, ...diff.removed]);
  assert.equal(result?.success, false, `${task.id}: out-of-scope mutation unexpectedly passed`);
}

const reports = [];
for (const task of coreTasks) {
  const taskId = task.id;
  assert.equal(task.repoSource, "builtin://nodejs-core", `${taskId}: core task must use the isolated nodejs-core fixture`);
  assert.ok(task.judges.length > 0, `${taskId}: core task must define at least one judge`);
  assert.equal(task.judges.every((judge) => judge.critical === true), true, `${taskId}: every core judge must be critical`);
  assert.equal(task.changePolicy?.requireAgentChange, true, `${taskId}: core task must reject no-op submissions`);
  assert.ok((task.changePolicy?.allowedPaths?.length ?? 0) > 0, `${taskId}: core task must declare allowed paths`);
  let workspace;
  try {
    workspace = await copyFixture();
    await runSetup(task, workspace);
    const before = await snapshotDirectory(workspace);

    const baseline = await criticalJudges(task, workspace);
    assert.equal(baseline.some((judge) => judge.critical === true && !judge.success), true, `${taskId}: baseline unexpectedly passed`);

    const noOp = evaluateChangePolicy(task.changePolicy, [], { reliable: true });
    assert.equal(noOp?.success, false, `${taskId}: empty submission passed change policy`);

    await writeReference(taskId, workspace);
    const after = await snapshotDirectory(workspace);
    const { diff, files } = await realChangedFiles(before, after);
    const policy = evaluateChangePolicy(task.changePolicy, files, { reliable: diff.skippedLargeFiles.length === 0 });
    assert.equal(policy?.success, true, `${taskId}: reference change policy failed: ${policy?.reason}`);

    const solved = await criticalJudges(task, workspace);
    assert.equal(solved.every((judge) => judge.critical !== true || judge.success), true, `${taskId}: reference judge failure: ${JSON.stringify(solved)}`);

    const negativeWorkspace = await copyFixture();
    try {
      await runSetup(task, negativeWorkspace);
      const negativeBefore = await snapshotDirectory(negativeWorkspace);
      await assertPolicyFailure(task, negativeWorkspace, negativeBefore, taskId === "test-coverage" ? "src/validator.js" : "README.md");
    } finally {
      await rm(negativeWorkspace, { recursive: true, force: true });
    }

    reports.push({ taskId, baselineFailed: true, referencePassed: true, changedFiles: files });
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ taskCount: reports.length, reports }, null, 2));
