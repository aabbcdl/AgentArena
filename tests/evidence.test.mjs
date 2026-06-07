import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  collectEvidence,
  writeChangedFiles,
  writeExecutionEvidence,
  writeExecutionMeta,
  writeExitCode,
  writeProcessOutput,
  writeToolCall,
} from "../packages/core/dist/evidence.js";

describe("Evidence Module", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should write and read tool calls", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeToolCall(options, {
      timestamp: new Date().toISOString(),
      name: "read_file",
      input: { path: "/test.ts" },
      success: true,
    });

    await writeToolCall(options, {
      timestamp: new Date().toISOString(),
      name: "write_file",
      input: { path: "/test.ts" },
      success: true,
    });

    const evidence = await collectEvidence(tempDir);
    assert.equal(evidence.toolCalls.length, 2);
    assert.equal(evidence.toolCalls[0].name, "read_file");
    assert.equal(evidence.toolCalls[1].name, "write_file");
    assert.equal(evidence.source, "partial");
  });

  it("should write and read changed files", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeChangedFiles(options, ["src/a.ts", "src/b.ts"]);

    const evidence = await collectEvidence(tempDir);
    assert.deepEqual(evidence.changedFiles, ["src/a.ts", "src/b.ts"]);
    assert.equal(evidence.source, "partial");
  });

  it("should write and read exit code", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeExitCode(options, 0);

    const evidence = await collectEvidence(tempDir);
    assert.equal(evidence.exitCode, 0);
  });

  it("should write and read process output", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeProcessOutput(options, "stdout content", "stderr content");

    const evidence = await collectEvidence(tempDir);
    assert.equal(evidence.stdout, "stdout content");
    assert.equal(evidence.stderr, "stderr content");
  });

  it("should write and read execution metadata", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeExecutionMeta(options, {
      adapterId: "test",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 1000,
      tokenUsage: 100,
      status: "success",
    });

    const evidence = await collectEvidence(tempDir);
    assert.notEqual(evidence.meta, undefined);
    assert.equal(evidence.meta.adapterId, "test");
    assert.equal(evidence.meta.tokenUsage, 100);
  });

  it("should mark as reported when all evidence is present", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeToolCall(options, {
      timestamp: new Date().toISOString(),
      name: "test_tool",
    });
    await writeChangedFiles(options, ["file.ts"]);
    await writeExitCode(options, 0);
    await writeExecutionMeta(options, {
      adapterId: "test",
      startTime: new Date().toISOString(),
    });

    const evidence = await collectEvidence(tempDir);
    assert.equal(evidence.source, "reported");
    assert.equal(evidence.complete, true);
  });

  it("should write all evidence at once with writeExecutionEvidence", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeExecutionEvidence(options, {
      toolCalls: [
        { timestamp: new Date().toISOString(), name: "tool1" },
        { timestamp: new Date().toISOString(), name: "tool2" },
      ],
      changedFiles: ["a.ts", "b.ts"],
      exitCode: 0,
      stdout: "output",
      stderr: "",
      meta: {
        tokenUsage: 200,
        status: "success",
      },
    });

    const evidence = await collectEvidence(tempDir);
    assert.equal(evidence.toolCalls.length, 2);
    assert.deepEqual(evidence.changedFiles, ["a.ts", "b.ts"]);
    assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.stdout, "output");
    assert.equal(evidence.meta.tokenUsage, 200);
    assert.equal(evidence.source, "reported");
  });

  it("should return inferred when no evidence exists", async () => {
    const evidence = await collectEvidence(tempDir);
    assert.equal(evidence.source, "inferred");
    assert.equal(evidence.complete, false);
    assert.equal(evidence.toolCalls.length, 0);
  });
});
