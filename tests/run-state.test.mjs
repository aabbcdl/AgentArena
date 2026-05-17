import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { clearRunState, loadRunState, saveRunState } from "../packages/core/dist/run-state.js";

describe("run-state", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp("agentarena-test-");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true });
  });

  describe("saveRunState", () => {
    it("saves state to disk", async () => {
      const state = {
        state: "running",
        phase: "benchmark",
        logs: [],
        updatedAt: "2024-01-01T00:00:00Z",
        runId: "test-run"
      };

      await saveRunState(tempDir, state);

      const statePath = path.join(tempDir, ".agentarena", "ui", "run-state.json");
      const exists = await fs.access(statePath).then(() => true).catch(() => false);
      assert.ok(exists);
    });

    it("truncates logs to 50 entries", async () => {
      const logs = Array.from({ length: 60 }, (_, i) => ({
        timestamp: "2024-01-01T00:00:00Z",
        phase: "benchmark",
        message: `log ${i}`
      }));

      const state = {
        state: "running",
        phase: "benchmark",
        logs,
        updatedAt: "2024-01-01T00:00:00Z"
      };

      await saveRunState(tempDir, state);
      const loaded = await loadRunState(tempDir);

      assert.equal(loaded?.logs.length, 50);
    });
  });

  describe("loadRunState", () => {
    it("loads state from disk", async () => {
      const state = {
        state: "done",
        phase: "report",
        logs: [],
        updatedAt: "2024-01-01T00:00:00Z",
        runId: "test-run"
      };

      await saveRunState(tempDir, state);
      const loaded = await loadRunState(tempDir);

      assert.ok(loaded);
      assert.equal(loaded.state, "done");
      assert.equal(loaded.runId, "test-run");
    });

    it("returns null for non-existent file", async () => {
      const loaded = await loadRunState(tempDir);
      assert.equal(loaded, null);
    });

    it("returns null for invalid JSON", async () => {
      const statePath = path.join(tempDir, ".agentarena", "ui");
      await fs.mkdir(statePath, { recursive: true });
      await fs.writeFile(path.join(statePath, "run-state.json"), "invalid json");

      const loaded = await loadRunState(tempDir);
      assert.equal(loaded, null);
    });
  });

  describe("clearRunState", () => {
    it("deletes state file", async () => {
      const state = {
        state: "running",
        phase: "benchmark",
        logs: [],
        updatedAt: "2024-01-01T00:00:00Z"
      };

      await saveRunState(tempDir, state);
      await clearRunState(tempDir);

      const loaded = await loadRunState(tempDir);
      assert.equal(loaded, null);
    });

    it("does not throw for non-existent file", async () => {
      await clearRunState(tempDir);
    });
  });
});