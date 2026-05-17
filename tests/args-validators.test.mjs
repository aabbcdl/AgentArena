import assert from "node:assert";
import { describe, it } from "node:test";
import { validateCommandArgs, validateInitCiCommand, validatePublishCommand, validateRunCommand, validateUiCommand } from "../packages/cli/dist/args-validators.js";

describe("args-validators", () => {
  describe("validateRunCommand", () => {
    it("passes with required args", () => {
      const result = validateRunCommand({
        command: "run",
        repoPath: ".",
        taskPath: "taskpack.yaml",
        agentIds: ["demo-fast"]
      });
      assert.equal(result.ok, true);
    });

    it("fails without repoPath", () => {
      const result = validateRunCommand({
        command: "run",
        taskPath: "taskpack.yaml",
        agentIds: ["demo-fast"]
      });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes("--repo"));
    });

    it("fails without taskPath", () => {
      const result = validateRunCommand({
        command: "run",
        repoPath: ".",
        agentIds: ["demo-fast"]
      });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes("--task"));
    });

    it("fails without agentIds", () => {
      const result = validateRunCommand({
        command: "run",
        repoPath: ".",
        taskPath: "taskpack.yaml",
        agentIds: []
      });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes("--agents"));
    });

    it("fails with invalid maxConcurrency", () => {
      const result = validateRunCommand({
        command: "run",
        repoPath: ".",
        taskPath: "taskpack.yaml",
        agentIds: ["demo-fast"],
        maxConcurrency: 0
      });
      assert.equal(result.ok, false);
    });

    it("fails with negative tokenBudget", () => {
      const result = validateRunCommand({
        command: "run",
        repoPath: ".",
        taskPath: "taskpack.yaml",
        agentIds: ["demo-fast"],
        tokenBudget: -100
      });
      assert.equal(result.ok, false);
    });
  });

  describe("validateUiCommand", () => {
    it("passes with valid port", () => {
      const result = validateUiCommand({ port: 3000 });
      assert.equal(result.ok, true);
    });

    it("fails with invalid port", () => {
      const result = validateUiCommand({ port: 70000 });
      assert.equal(result.ok, false);
    });

    it("fails with negative port", () => {
      const result = validateUiCommand({ port: -1 });
      assert.equal(result.ok, false);
    });
  });

  describe("validateInitCiCommand", () => {
    it("passes with required args", () => {
      const result = validateInitCiCommand({
        command: "init-ci",
        taskPath: "taskpack.yaml",
        agentIds: ["demo-fast"]
      });
      assert.equal(result.ok, true);
    });

    it("fails without taskPath", () => {
      const result = validateInitCiCommand({
        command: "init-ci",
        agentIds: ["demo-fast"]
      });
      assert.equal(result.ok, false);
    });

    it("fails without agentIds", () => {
      const result = validateInitCiCommand({
        command: "init-ci",
        taskPath: "taskpack.yaml",
        agentIds: []
      });
      assert.equal(result.ok, false);
    });
  });

  describe("validatePublishCommand", () => {
    it("passes with resultFile", () => {
      const result = validatePublishCommand({
        command: "publish",
        resultFile: "results.json"
      });
      assert.equal(result.ok, true);
    });

    it("fails without resultFile", () => {
      const result = validatePublishCommand({ command: "publish" });
      assert.equal(result.ok, false);
    });
  });

  describe("validateCommandArgs", () => {
    it("dispatches to run validator", () => {
      const result = validateCommandArgs({
        command: "run",
        repoPath: ".",
        taskPath: "task.yaml",
        agentIds: ["demo"]
      });
      assert.equal(result.ok, true);
    });

    it("dispatches to ui validator", () => {
      const result = validateCommandArgs({ command: "ui", port: 3000 });
      assert.equal(result.ok, true);
    });

    it("passes for unknown command", () => {
      const result = validateCommandArgs({ command: "unknown" });
      assert.equal(result.ok, true);
    });
  });
});