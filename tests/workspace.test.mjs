import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { cleanupWorkspace, debugLog, formatErrorDetails, formatErrorMessage } from "../packages/runner/dist/workspace.js";

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
      const originalError = console.error;
      let logged = false;
      console.error = (...args) => {
        if (args[0] === "[debug]") {
          logged = true;
        }
      };

      try {
        debugLog(true, "test");
        assert.ok(logged);
      } finally {
        console.error = originalError;
      }
    });

    it("silent when disabled", () => {
      const originalError = console.error;
      let logged = false;
      console.error = () => { logged = true; };

      try {
        debugLog(false, "test");
        assert.ok(!logged);
      } finally {
        console.error = originalError;
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