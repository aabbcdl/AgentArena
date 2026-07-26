import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Import the real implementation that ships with the CLI. Previously this file
// duplicated the function in-tree; that "mirror" silently diverged from the
// shipped code. Now any drift between the test expectations and the production
// path produces a real test failure.
import { validateRunPayload, validateRunPayloadPaths } from "../packages/cli/dist/commands/run-payload-validator.js";

const CWD = process.cwd();

// --- Path validation ---

test("rejects missing repoPath", () => {
  assert.ok(validateRunPayload({ taskPath: "task.yaml" }));
});

test("rejects empty repoPath", () => {
  assert.ok(validateRunPayload({ repoPath: "", taskPath: "task.yaml" }));
});

test("rejects missing taskPath", () => {
  assert.ok(validateRunPayload({ repoPath: CWD }));
});

test("rejects repoPath outside cwd", () => {
  assert.ok(validateRunPayload({
    repoPath: "/tmp/evil",
    taskPath: path.join(CWD, "task.yaml"),
  }));
});

test("rejects taskPath outside cwd", () => {
  assert.ok(validateRunPayload({
    repoPath: CWD,
    taskPath: "/tmp/evil.yaml",
  }));
});

test("accepts paths within cwd", () => {
  assert.equal(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
  }), null);
});

test("accepts cwd itself as repoPath", () => {
  assert.equal(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
  }), null);
});

test("rejects path-traversal attempt via ../ segments resolving outside cwd", () => {
  assert.ok(validateRunPayload({
    repoPath: path.join(CWD, "..", "evil"),
    taskPath: path.join(CWD, "task.yaml"),
  }));
});

// --- Numeric validation ---

test("rejects maxConcurrency < 1", () => {
  assert.ok(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
    maxConcurrency: 0,
  }));
});

test("rejects maxConcurrency NaN", () => {
  assert.ok(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
    maxConcurrency: "abc",
  }));
});

test("accepts valid maxConcurrency", () => {
  assert.equal(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
    maxConcurrency: 4,
  }), null);
});

test("rejects invalid scoreMode from Workbench-style phantom modes", () => {
  const error = validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
    scoreMode: "speed",
  });
  assert.ok(error);
  assert.match(error, /scoreMode must be one of/);
});

test("accepts every canonical ScoreMode", () => {
  for (const scoreMode of [
    "practical",
    "balanced",
    "issue-resolution",
    "efficiency-first",
    "rotating-tasks",
    "comprehensive",
  ]) {
    assert.equal(validateRunPayload({
      repoPath: CWD,
      taskPath: path.join(CWD, "task.yaml"),
      scoreMode,
    }), null, scoreMode);
  }
});

test("accepts omitted scoreMode", () => {
  assert.equal(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
  }), null);
});

test("rejects tokenBudget <= 0", () => {
  assert.ok(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
    tokenBudget: 0,
  }));
});

test("rejects tokenBudget NaN", () => {
  assert.ok(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
    tokenBudget: "abc",
  }));
});

test("accepts valid tokenBudget", () => {
  assert.equal(validateRunPayload({
    repoPath: CWD,
    taskPath: path.join(CWD, "task.yaml"),
    tokenBudget: 10000,
  }), null);
});

// --- Edge cases ---

test("rejects undefined repoPath", () => {
  assert.ok(validateRunPayload({ repoPath: undefined, taskPath: "task.yaml" }));
});

test("rejects null repoPath", () => {
  assert.ok(validateRunPayload({ repoPath: null, taskPath: "task.yaml" }));
});

test("explicit cwd parameter is honored for path containment", () => {
  const altCwd = path.join(CWD, "subdir");
  // Repo path that is inside altCwd but outside CWD's parent
  assert.equal(validateRunPayload({
    repoPath: path.join(altCwd, "nested"),
    taskPath: path.join(altCwd, "task.yaml"),
  }, altCwd), null);
});

// --- Prefix-match bypass tests ---

test("rejects repoPath that is a sibling prefix of cwd (not a child)", () => {
  // If CWD is /home/user/project, /home/user/project-evil should NOT be accepted
  // because it shares the prefix string but is not actually inside CWD.
  const parent = path.dirname(CWD);
  const sibling = path.join(parent, path.basename(CWD) + "-evil");
  assert.ok(validateRunPayload({
    repoPath: sibling,
    taskPath: path.join(CWD, "task.yaml"),
  }), "should reject sibling path that shares prefix string");
});

test("rejects taskPath that is a sibling prefix of cwd (not a child)", () => {
  const parent = path.dirname(CWD);
  const sibling = path.join(parent, path.basename(CWD) + "-evil");
  assert.ok(validateRunPayload({
    repoPath: CWD,
    taskPath: sibling,
  }), "should reject sibling taskPath that shares prefix string");
});

test("accepts deeply nested subdirectory of cwd", () => {
  assert.equal(validateRunPayload({
    repoPath: path.join(CWD, "a", "b", "c"),
    taskPath: path.join(CWD, "x", "y", "task.yaml"),
  }), null);
});


test("rejects repository and task paths that escape through directory links", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-payload-paths-"));
  const workspace = path.join(tempDir, "workspace");
  const outside = path.join(tempDir, "outside");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "task.yaml"), "schemaVersion: agentarena.taskpack/v1", "utf8");
    await symlink(outside, path.join(workspace, "repo-link"), linkType);
    await symlink(outside, path.join(workspace, "task-link"), linkType);

    assert.match(
      await validateRunPayloadPaths({ repoPath: path.join(workspace, "repo-link"), taskPath: path.join(workspace, "task.yaml") }, { cwd: workspace, taskRoots: [workspace] }),
      /repoPath.*symbolic link|repoPath.*current working directory/i
    );
    assert.match(
      await validateRunPayloadPaths({ repoPath: workspace, taskPath: path.join(workspace, "task-link", "task.yaml") }, { cwd: workspace, taskRoots: [workspace] }),
      /taskPath.*allowed task directory/i
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("accepts an official task path outside cwd when its trusted root is explicit", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-payload-paths-"));
  const workspace = path.join(tempDir, "workspace");
  const officialRoot = path.join(tempDir, "official-taskpacks");
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(officialRoot, { recursive: true });
    const taskPath = path.join(officialRoot, "task.yaml");
    await writeFile(taskPath, "schemaVersion: agentarena.taskpack/v1", "utf8");

    assert.equal(
      await validateRunPayloadPaths({ repoPath: workspace, taskPath }, { cwd: workspace, taskRoots: [workspace, officialRoot] }),
      null
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects an output path that escapes through a directory link", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-payload-paths-"));
  const workspace = path.join(tempDir, "workspace");
  const outside = path.join(tempDir, "outside");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(workspace, "task.yaml"), "schemaVersion: agentarena.taskpack/v1", "utf8");
    await symlink(outside, path.join(workspace, "output-link"), linkType);

    assert.match(
      await validateRunPayloadPaths({ repoPath: workspace, taskPath: path.join(workspace, "task.yaml"), outputPath: path.join(workspace, "output-link", "run") }, { cwd: workspace, taskRoots: [workspace] }),
      /outputPath.*current working directory/i
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
