import assert from "node:assert";
import { describe, it } from "node:test";
import { parseArgs } from "../packages/cli/dist/args.js";
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

    it("fails with a non-local host", () => {
      const result = validateUiCommand({ host: "0.0.0.0", port: 3000 });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /local/i);
    });

    it("fails with negative port", () => {
      const result = validateUiCommand({ port: -1 });
      assert.equal(result.ok, false);
    });
  });

  describe("parseArgs", () => {
    it("parses the optional workspace root", () => {
      const result = parseArgs(["ui", "--workspace-root", "/tmp/agentarena-workspace"]);
      assert.equal(result.command, "ui");
      assert.equal(result.workspaceRoot, "/tmp/agentarena-workspace");
    });

    it("rejects a missing workspace root value", () => {
      assert.throws(
        () => parseArgs(["ui", "--workspace-root"]),
        /--workspace-root requires a directory path/
      );
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

    it("rejects a non-local UI host through command validation", () => {
      const result = validateCommandArgs({ command: "ui", host: "0.0.0.0", port: 3000 });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /local/i);
    });

    it("passes for unknown command", () => {
      const result = validateCommandArgs({ command: "unknown" });
      assert.equal(result.ok, true);
    });
  });
});
