import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { copyRepository, diffSnapshots } from "../packages/core/dist/snapshot.js";
import { buildDiffPrecision, evaluateChangePolicy } from "../packages/runner/dist/snapshot.js";

describe("snapshot", () => {
  describe("buildDiffPrecision", () => {
    it("returns undefined when expectedChangedPaths is empty", () => {
      const result = buildDiffPrecision([], ["file1.js"]);
      assert.equal(result, undefined);
    });

    it("returns undefined when expectedChangedPaths is undefined", () => {
      const result = buildDiffPrecision(undefined, ["file1.js"]);
      assert.equal(result, undefined);
    });

    it("calculates precision with matching files", () => {
      const result = buildDiffPrecision(["src/*.js"], ["src/file1.js", "src/file2.js", "test/file.js"]);
      assert.ok(result);
      assert.equal(result.score, 2 / 3);
      assert.equal(result.expectedScopeCount, 1);
      assert.equal(result.totalChangedFiles, 3);
      assert.deepEqual(result.matchedFiles, ["src/file1.js", "src/file2.js"]);
      assert.deepEqual(result.unexpectedFiles, ["test/file.js"]);
    });

    it("handles no changed files", () => {
      const result = buildDiffPrecision(["src/*.js"], []);
      assert.ok(result);
      assert.equal(result.score, 0);
      assert.equal(result.totalChangedFiles, 0);
    });

    it("handles all files matching pattern", () => {
      const result = buildDiffPrecision(["*.js"], ["file1.js", "file2.js"]);
      assert.ok(result);
      assert.equal(result.score, 1);
      assert.equal(result.matchedFiles.length, 2);
      assert.equal(result.unexpectedFiles.length, 0);
    });

    it("handles dot files with dot option", () => {
      const result = buildDiffPrecision([".env"], [".env", "src/file.js"]);
      assert.ok(result);
      assert.equal(result.matchedFiles.length, 1);
      assert.deepEqual(result.matchedFiles, [".env"]);
    });
  });

  describe("evaluateChangePolicy", () => {
    it("rejects an empty submission when a change is required", () => {
      const result = evaluateChangePolicy(
        { requireAgentChange: true, allowedPaths: ["src/**/*.js"] },
        []
      );
      assert.equal(result?.success, false);
      assert.match(result?.reason ?? "", /No agent-authored file change/);
    });

    it("accepts changes inside the declared scope", () => {
      const result = evaluateChangePolicy(
        { requireAgentChange: true, allowedPaths: ["src/**/*.js"], minChangedFiles: 1, maxChangedFiles: 2 },
        ["src/utils.js"]
      );
      assert.equal(result?.success, true);
      assert.deepEqual(result?.changedFiles, ["src/utils.js"]);
    });

    it("rejects forbidden and out-of-scope files", () => {
      const result = evaluateChangePolicy(
        { requireAgentChange: true, allowedPaths: ["src/**/*.js"], forbiddenPaths: ["test/**"] },
        ["src/utils.js", "test/utils.test.js", "README.md"]
      );
      assert.equal(result?.success, false);
      assert.deepEqual(result?.unexpectedFiles, ["README.md", "test/utils.test.js"]);
      assert.deepEqual(result?.forbiddenFiles, ["test/utils.test.js"]);
    });

    it("fails closed when snapshots are unreliable", () => {
      const result = evaluateChangePolicy(
        { requireAgentChange: true, allowedPaths: ["src/**/*.js"] },
        ["src/utils.js"],
        { reliable: false }
      );
      assert.equal(result?.success, false);
      assert.equal(result?.reliable, false);
    });

    it("enforces minimum and maximum changed-file counts", () => {
      const tooFew = evaluateChangePolicy({ minChangedFiles: 2 }, ["src/a.js"]);
      const tooMany = evaluateChangePolicy({ maxChangedFiles: 1 }, ["src/a.js", "src/b.js"]);
      assert.equal(tooFew?.success, false);
      assert.equal(tooMany?.success, false);
    });

    it("ignores AgentArena-generated paths", () => {
      const result = evaluateChangePolicy(
        { requireAgentChange: true, allowedPaths: ["src/**/*.js"] },
        [".agentarena/log.json", "src/utils.js"]
      );
      assert.equal(result?.success, true);
      assert.deepEqual(result?.changedFiles, ["src/utils.js"]);
    });
  });

  describe("diffSnapshots", () => {
    it("identifies large files skipped in after snapshot", () => {
      const before = new Map([
        ["small.txt", { relativePath: "small.txt", hash: "abc123" }],
      ]);
      const after = new Map([
        ["small.txt", { relativePath: "small.txt", hash: "abc123" }],
        ["big.bin", { relativePath: "big.bin", hash: "huge-file:deadbeef" }],
      ]);
      const result = diffSnapshots(before, after);
      assert.deepEqual(result.skippedLargeFiles, ["big.bin"]);
      assert.deepEqual(result.added, []);
      assert.deepEqual(result.changed, []);
      assert.deepEqual(result.removed, []);
    });

    it("identifies large files skipped in before snapshot", () => {
      const before = new Map([
        ["big.bin", { relativePath: "big.bin", hash: "huge-file:deadbeef" }],
      ]);
      const after = new Map([
        ["big.bin", { relativePath: "big.bin", hash: "abc123" }],
      ]);
      const result = diffSnapshots(before, after);
      assert.deepEqual(result.skippedLargeFiles, ["big.bin"]);
      assert.deepEqual(result.added, []);
      assert.deepEqual(result.changed, []);
      assert.deepEqual(result.removed, []);
    });

    it("identifies removed large files as skipped", () => {
      const before = new Map([
        ["big.bin", { relativePath: "big.bin", hash: "huge-file:deadbeef" }],
      ]);
      const after = new Map([]);
      const result = diffSnapshots(before, after);
      assert.deepEqual(result.skippedLargeFiles, ["big.bin"]);
      assert.deepEqual(result.removed, []);
    });

    it("does not skip normal files", () => {
      const before = new Map([
        ["a.txt", { relativePath: "a.txt", hash: "hash1" }],
      ]);
      const after = new Map([
        ["a.txt", { relativePath: "a.txt", hash: "hash2" }],
        ["b.txt", { relativePath: "b.txt", hash: "hash3" }],
      ]);
      const result = diffSnapshots(before, after);
      assert.deepEqual(result.skippedLargeFiles, []);
      assert.deepEqual(result.changed, ["a.txt"]);
      assert.deepEqual(result.added, ["b.txt"]);
    });

    it("handles both large and normal files together", () => {
      const before = new Map([
        ["keep.txt", { relativePath: "keep.txt", hash: "h1" }],
        ["mod.txt", { relativePath: "mod.txt", hash: "h2" }],
        ["big1.bin", { relativePath: "big1.bin", hash: "huge-file:aa" }],
        ["big2.bin", { relativePath: "big2.bin", hash: "huge-file:bb" }],
      ]);
      const after = new Map([
        ["keep.txt", { relativePath: "keep.txt", hash: "h1" }],
        ["mod.txt", { relativePath: "mod.txt", hash: "h3" }],
        ["big1.bin", { relativePath: "big1.bin", hash: "huge-file:aa" }],
        ["new.txt", { relativePath: "new.txt", hash: "h4" }],
      ]);
      const result = diffSnapshots(before, after);
      assert.deepEqual(result.skippedLargeFiles.sort(), ["big1.bin", "big2.bin"]);
      assert.deepEqual(result.changed, ["mod.txt"]);
      assert.deepEqual(result.added, ["new.txt"]);
      assert.deepEqual(result.removed, []);
    });
  });

  describe("copyRepository", () => {
    it("copies a repo that has a staged (uncommitted) deletion without crashing", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-copy-"));
      const source = path.join(root, "src");
      const dest = path.join(root, "dest");
      await fs.mkdir(source, { recursive: true });
      const git = (...args) => execFileSync("git", ["-C", source, ...args], { stdio: "pipe" });
      try {
        git("init", "-q");
        git("config", "user.email", "t@t.t");
        git("config", "user.name", "t");
        await fs.writeFile(path.join(source, "keep.txt"), "keep", "utf8");
        await fs.writeFile(path.join(source, "gone.txt"), "gone", "utf8");
        git("add", ".");
        git("commit", "-q", "-m", "init");
        // Delete a tracked file from the worktree but do NOT stage the deletion:
        // `git ls-files --cached` still lists gone.txt though it no longer exists.
        await fs.rm(path.join(source, "gone.txt"));

        await copyRepository(source, dest);

        // The present file is copied; the deleted one is skipped, not fatal.
        assert.equal(await fs.readFile(path.join(dest, "keep.txt"), "utf8"), "keep");
        await assert.rejects(() => fs.access(path.join(dest, "gone.txt")));
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });
});
