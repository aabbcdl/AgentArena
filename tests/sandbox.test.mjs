import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createWorkspaceSandbox, isPathInsideWorkspace, safePathJoin, validateWorkspacePath } from "../packages/core/dist/index.js";

describe("sandbox", () => {
  describe("isPathInsideWorkspace", () => {
    let tempDir;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-sandbox-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("returns true for paths inside workspace", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "file.txt")), true);
      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "subdir", "file.txt")), true);
    });

    it("returns false for absolute paths outside workspace", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      assert.equal(await isPathInsideWorkspace(workspace, path.join(tempDir, "outside.txt")), false);
      assert.equal(await isPathInsideWorkspace(workspace, "/etc/passwd"), false);
    });

    it("detects path traversal with ..", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "..", "outside.txt")), false);
      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "../..", "etc", "passwd")), false);
      assert.equal(await isPathInsideWorkspace(workspace, "../../etc/passwd"), false);
    });

    it("detects path traversal with multiple dots", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "...", "file.txt")), false);
      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "....", "file.txt")), false);
    });

    it("detects symlink escape attacks", async () => {
      const workspace = path.join(tempDir, "workspace");
      const outside = path.join(tempDir, "outside.txt");
      const symlinkPath = path.join(workspace, "evil-link");

      await fs.mkdir(workspace, { recursive: true });
      await fs.writeFile(outside, "sensitive data");
      
      try {
        await fs.symlink(outside, symlinkPath);
        assert.equal(await isPathInsideWorkspace(workspace, symlinkPath), false);
      } catch (err) {
        if (err.code === "EPERM") {
          console.warn("Skipping symlink test on Windows (EPERM restriction)");
        } else {
          throw err;
        }
      }
    });

    it("returns false when target doesn't exist but path traversal is detected", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "../nonexistent.txt")), false);
    });

    it("returns true for non-existent files inside workspace", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      assert.equal(await isPathInsideWorkspace(workspace, path.join(workspace, "newfile.txt")), true);
    });
  });

  describe("safePathJoin", () => {
    let tempDir;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-sandbox-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("joins paths safely inside workspace", async () => {
      const base = path.join(tempDir, "workspace");
      await fs.mkdir(base, { recursive: true });

      const result = await safePathJoin(base, "subdir", "file.txt");
      assert.equal(result, path.join(base, "subdir", "file.txt"));
    });

    it("throws on path traversal", async () => {
      const base = path.join(tempDir, "workspace");
      await fs.mkdir(base, { recursive: true });

      await assert.rejects(
        safePathJoin(base, "..", "outside.txt"),
        /Path traversal detected/
      );

      await assert.rejects(
        safePathJoin(base, "../../etc/passwd"),
        /Path traversal detected/
      );
    });
  });

  describe("validateWorkspacePath", () => {
    let tempDir;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-sandbox-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("returns true in off mode regardless of path", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      assert.equal(
        await validateWorkspacePath(workspace, "/etc/passwd", "test", undefined, "off"),
        true
      );
      assert.equal(
        await validateWorkspacePath(workspace, path.join(workspace, "..", "bad.txt"), "test", undefined, "off"),
        true
      );
    });

    it("returns false and logs in warn mode for invalid paths", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });
      const logs = [];
      const originalWarn = console.warn;
      console.warn = (...args) => logs.push(args.join(" "));

      try {
        const result = await validateWorkspacePath(
          workspace,
          path.join(workspace, "..", "bad.txt"),
          "test",
          undefined,
          "warn"
        );
        assert.equal(result, false);
        assert.ok(logs.some(log => log.includes("Path access outside workspace blocked")));
      } finally {
        console.warn = originalWarn;
      }
    });

    it("throws in strict mode for invalid paths", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });

      await assert.rejects(
        validateWorkspacePath(workspace, path.join(workspace, "..", "bad.txt"), "test", undefined, "strict"),
        /Path access outside workspace blocked/
      );
    });

    it("calls trace function on violation", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });
      const traceEvents = [];
      const traceFn = async (event) => {
        traceEvents.push(event);
      };

      try {
        await validateWorkspacePath(
          workspace,
          "/etc/passwd",
          "test",
          traceFn,
          "strict"
        );
      } catch {
      }

      assert.equal(traceEvents.length, 1);
      assert.equal(traceEvents[0].type, "sandbox.violation");
      assert.equal(traceEvents[0].metadata.context, "test");
      assert.equal(traceEvents[0].metadata.mode, "strict");
    });
  });

  describe("createWorkspaceSandbox", () => {
    let tempDir;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-sandbox-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("creates sandbox with validate method", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });
      const sandbox = createWorkspaceSandbox(workspace, undefined);

      assert.equal(await sandbox.validate(path.join(workspace, "file.txt"), "test"), true);
      await assert.rejects(
        sandbox.validate(path.join(workspace, "..", "bad.txt"), "test"),
        /Path access outside workspace blocked/
      );
    });

    it("creates sandbox with validateOrThrow method", async () => {
      const workspace = path.join(tempDir, "workspace");
      await fs.mkdir(workspace, { recursive: true });
      const sandbox = createWorkspaceSandbox(workspace, undefined);

      await sandbox.validateOrThrow(path.join(workspace, "file.txt"), "test");
      await assert.rejects(
        sandbox.validateOrThrow(path.join(workspace, "..", "bad.txt"), "test"),
        /Path access outside workspace blocked/
      );
    });
  });
});