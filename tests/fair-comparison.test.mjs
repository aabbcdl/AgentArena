import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createFairComparisonMetadata } from "../packages/core/dist/index.js";
import { repositoryIdentity } from "../packages/runner/dist/resume.js";

const execFileAsync = promisify(execFile);

function task(overrides = {}) {
  return {
    schemaVersion: "agentarena.taskpack/v1",
    id: "task-a",
    title: "Task A",
    prompt: "Fix the issue.",
    envAllowList: [],
    setupCommands: [],
    judges: [
      {
        id: "tests",
        type: "command",
        label: "Tests",
        command: "pnpm test",
        critical: true
      }
    ],
    teardownCommands: [],
    ...overrides
  };
}

test("createFairComparisonMetadata separates task, judge, and repository identities", () => {
  const base = createFairComparisonMetadata(task(), "repo-head-a\nclean");
  const same = createFairComparisonMetadata(task(), "repo-head-a\nclean");
  const changedPrompt = createFairComparisonMetadata(
    task({ prompt: "Fix the issue without changing public APIs." }),
    "repo-head-a\nclean"
  );
  const changedJudge = createFairComparisonMetadata(
    task({
      judges: [
        {
          id: "tests",
          type: "command",
          label: "Tests",
          command: "pnpm test:quick",
          critical: true
        }
      ]
    }),
    "repo-head-a\nclean"
  );
  const changedRepository = createFairComparisonMetadata(task(), "repo-head-b\nclean");

  assert.deepEqual(base, same);
  assert.notEqual(base.taskIdentity, changedPrompt.taskIdentity);
  assert.equal(base.judgeIdentity, changedPrompt.judgeIdentity);
  assert.equal(base.taskIdentity, changedJudge.taskIdentity);
  assert.notEqual(base.judgeIdentity, changedJudge.judgeIdentity);
  assert.notEqual(base.repoBaselineIdentity, changedRepository.repoBaselineIdentity);
  assert.match(base.taskIdentity, /^task:[a-f0-9]{64}$/);
  assert.match(base.judgeIdentity, /^judge:[a-f0-9]{64}$/);
  assert.match(base.repoBaselineIdentity, /^repo:[a-f0-9]{64}$/);
});

test("repositoryIdentity distinguishes dirty repositories by file content", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "agentarena-fair-repo-"));

  try {
    await mkdir(repoPath, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.email", "agentarena@example.test"], { cwd: repoPath });
    await execFileAsync("git", ["config", "user.name", "AgentArena Test"], { cwd: repoPath });
    await writeFile(path.join(repoPath, "tracked.txt"), "baseline\n", "utf8");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: repoPath });

    await writeFile(path.join(repoPath, "tracked.txt"), "first tracked value\n", "utf8");
    const firstTrackedIdentity = repositoryIdentity(repoPath);
    await writeFile(path.join(repoPath, "tracked.txt"), "second tracked value\n", "utf8");
    const secondTrackedIdentity = repositoryIdentity(repoPath);
    assert.notEqual(firstTrackedIdentity, secondTrackedIdentity);

    await writeFile(path.join(repoPath, "untracked.txt"), "first untracked value\n", "utf8");
    const firstUntrackedIdentity = repositoryIdentity(repoPath);
    await writeFile(path.join(repoPath, "untracked.txt"), "second untracked value\n", "utf8");
    const secondUntrackedIdentity = repositoryIdentity(repoPath);
    assert.notEqual(firstUntrackedIdentity, secondUntrackedIdentity);
  } finally {
    await rm(repoPath, { recursive: true, force: true });
  }
});

test("repositoryIdentity scopes Git dirty state to a selected monorepo subdirectory", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agentarena-fair-monorepo-"));
  const selectedPath = path.join(repoRoot, "packages", "selected");
  const siblingPath = path.join(repoRoot, "packages", "sibling");
  try {
    await mkdir(selectedPath, { recursive: true });
    await mkdir(siblingPath, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "user.email", "agentarena@example.test"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "user.name", "AgentArena Test"], { cwd: repoRoot });
    await writeFile(path.join(selectedPath, "tracked.txt"), "selected baseline\n", "utf8");
    await writeFile(path.join(siblingPath, "tracked.txt"), "sibling baseline\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: repoRoot });
    await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: repoRoot });

    const baseline = repositoryIdentity(selectedPath);
    await writeFile(path.join(siblingPath, "tracked.txt"), "sibling changed\n", "utf8");
    await writeFile(path.join(siblingPath, "untracked.txt"), "outside selected scope\n", "utf8");
    assert.equal(repositoryIdentity(selectedPath), baseline);

    await writeFile(path.join(selectedPath, "tracked.txt"), "selected changed\n", "utf8");
    const trackedChange = repositoryIdentity(selectedPath);
    assert.notEqual(trackedChange, baseline);
    await writeFile(path.join(selectedPath, "untracked.txt"), "inside selected scope\n", "utf8");
    assert.notEqual(repositoryIdentity(selectedPath), trackedChange);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("repositoryIdentity hashes non-Git content and ignores AgentArena outputs", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "agentarena-non-git-repo-"));
  try {
    await writeFile(path.join(repoPath, "README.md"), "first\n", "utf8");
    const first = repositoryIdentity(repoPath);
    await writeFile(path.join(repoPath, "README.md"), "second\n", "utf8");
    const second = repositoryIdentity(repoPath);
    assert.match(first, /^non-git-sha256:/);
    assert.notEqual(first, second);

    await mkdir(path.join(repoPath, ".agentarena"), { recursive: true });
    await writeFile(path.join(repoPath, ".agentarena", "run.json"), "changing output\n", "utf8");
    assert.equal(repositoryIdentity(repoPath), second);
  } finally {
    await rm(repoPath, { recursive: true, force: true });
  }
});
