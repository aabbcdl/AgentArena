import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { reapStaleTempWorkspaces, runCleanup } from "../packages/cli/dist/commands/cleanup.js";
import { cleanupWorkspace, debugLog, formatErrorDetails, formatErrorMessage } from "../packages/runner/dist/workspace.js";

describe("reapStaleTempWorkspaces", () => {
  it("removes stale temp workspaces but keeps recent ones", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-reap-base-"));
    try {
      const stale = path.join(base, "agentarena-workspaces-old-abc");
      const recent = path.join(base, "agentarena-workspaces-new-xyz");
      const unrelated = path.join(base, "some-other-dir");
      await fs.mkdir(stale);
      await fs.mkdir(recent);
      await fs.mkdir(unrelated);
      // Backdate the stale one well beyond the 24h reap threshold.
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await fs.utimes(stale, old, old);

      const removed = await reapStaleTempWorkspaces(Date.now(), base);

      assert.equal(removed, 1);
      await assert.rejects(() => fs.access(stale));
      await fs.access(recent); // recent workspace preserved
      await fs.access(unrelated); // non-workspace dir untouched
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});

describe("runCleanup", () => {
  it("uses a custom output root instead of the repository default runs directory", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-cleanup-output-"));
    const repoPath = path.join(base, "repo");
    const defaultRuns = path.join(repoPath, ".agentarena", "runs");
    const customRuns = path.join(base, "custom-runs");
    try {
      await fs.mkdir(path.join(defaultRuns, "default-run"), { recursive: true });
      await fs.mkdir(path.join(customRuns, "old-run"), { recursive: true });
      await fs.mkdir(path.join(customRuns, "new-run"), { recursive: true });
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(path.join(customRuns, "old-run"), old, old);

      await runCleanup({ repoPath, outputPath: customRuns, maxRuns: 1 });

      await assert.rejects(() => fs.access(path.join(customRuns, "old-run")));
      await fs.access(path.join(customRuns, "new-run"));
      await fs.access(path.join(defaultRuns, "default-run"));
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});

describe("workspace", () => {
  describe("formatErrorMessage", () => {
    it("formats Error object", () => {
      const err = new Error("test error");
      assert.equal(formatErrorMessage(err), "test error");
    });

    it("formats string error", () => {
      assert.equal(formatErrorMessage("string error"), "string error");
    });

    it("formats unknown error", () => {
      assert.equal(formatErrorMessage({ code: "E_TEST" }), "[object Object]");
    });
  });

  describe("formatErrorDetails", () => {
    it("extracts error details from Error object", () => {
      const err = new Error("test");
      err.stack = "stack trace";
      const details = formatErrorDetails(err);
      assert.equal(details.message, "test");
      assert.ok(details.stack);
    });

    it("handles unknown error types", () => {
      const details = formatErrorDetails("string error");
      assert.equal(details.message, "string error");
    });
  });

  describe("debugLog", () => {
    it("logs when enabled", () => {
      // debugLog delegates to the structured logger, which writes DEBUG entries
      // as JSON via console.log — and only when AGENTARENA_DEBUG is set. The old
      // test mocked console.error and looked for a "[debug]" prefix, neither of
      // which the current logger produces, so it always failed.
      const originalLog = console.log;
      const originalDebugEnv = process.env.AGENTARENA_DEBUG;
      process.env.AGENTARENA_DEBUG = "1";
      let logged = false;
      console.log = (...args) => {
        if (typeof args[0] === "string" && args[0].includes("test-debug-message")) {
          logged = true;
        }
      };

      try {
        debugLog(true, "test-debug-message");
        assert.ok(logged);
      } finally {
        console.log = originalLog;
        if (originalDebugEnv === undefined) {
          delete process.env.AGENTARENA_DEBUG;
        } else {
          process.env.AGENTARENA_DEBUG = originalDebugEnv;
        }
      }
    });

    it("silent when disabled", () => {
      // When the `enabled` flag is false, debugLog must not emit anything,
      // regardless of the AGENTARENA_DEBUG env var.
      const originalLog = console.log;
      const originalDebugEnv = process.env.AGENTARENA_DEBUG;
      process.env.AGENTARENA_DEBUG = "1";
      let logged = false;
      console.log = () => {
        logged = true;
      };

      try {
        debugLog(false, "test");
        assert.ok(!logged);
      } finally {
        console.log = originalLog;
        if (originalDebugEnv === undefined) {
          delete process.env.AGENTARENA_DEBUG;
        } else {
          process.env.AGENTARENA_DEBUG = originalDebugEnv;
        }
      }
    });
  });

  describe("cleanupWorkspace", () => {
    it("cleans up existing directory", async () => {
      const tempDir = await fs.mkdtemp("agentarena-test-");
      const workspacePath = path.join(tempDir, "workspace");
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.writeFile(path.join(workspacePath, "file.txt"), "content");

      const result = await cleanupWorkspace(workspacePath);
      assert.equal(result.success, true);
      assert.equal(result.path, workspacePath);

      const exists = await fs.access(workspacePath).then(() => true).catch(() => false);
      assert.equal(exists, false);

      await fs.rm(tempDir, { recursive: true });
    });

    it("returns success for non-existent path", async () => {
      const result = await cleanupWorkspace("/non/existent/path");
      assert.equal(result.success, true);
    });

    it("handles cleanup failures gracefully", async () => {
      const tempDir = await fs.mkdtemp("agentarena-test-");
      const workspacePath = path.join(tempDir, "workspace");
      await fs.mkdir(workspacePath, { recursive: true });

      const lockedFile = path.join(workspacePath, "locked.txt");
      await fs.writeFile(lockedFile, "content");

      const result = await cleanupWorkspace(workspacePath);
      assert.equal(result.success, true);

      await fs.rm(tempDir, { recursive: true, force: true });
    });
  });
});
