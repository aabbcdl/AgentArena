import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  EVIDENCE_DIR,
  EVIDENCE_FILES,
  writeToolCall,
  writeChangedFiles,
  writeExitCode,
  writeProcessOutput,
  writeExecutionMeta,
  collectEvidence,
  writeExecutionEvidence,
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
    expect(evidence.toolCalls).toHaveLength(2);
    expect(evidence.toolCalls[0].name).toBe("read_file");
    expect(evidence.toolCalls[1].name).toBe("write_file");
    expect(evidence.source).toBe("partial");
  });

  it("should write and read changed files", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeChangedFiles(options, ["src/a.ts", "src/b.ts"]);

    const evidence = await collectEvidence(tempDir);
    expect(evidence.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(evidence.source).toBe("partial");
  });

  it("should write and read exit code", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeExitCode(options, 0);

    const evidence = await collectEvidence(tempDir);
    expect(evidence.exitCode).toBe(0);
  });

  it("should write and read process output", async () => {
    const options = { adapterId: "test", workspacePath: tempDir };

    await writeProcessOutput(options, "stdout content", "stderr content");

    const evidence = await collectEvidence(tempDir);
    expect(evidence.stdout).toBe("stdout content");
    expect(evidence.stderr).toBe("stderr content");
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
    expect(evidence.meta).toBeDefined();
    expect(evidence.meta.adapterId).toBe("test");
    expect(evidence.meta.tokenUsage).toBe(100);
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
    expect(evidence.source).toBe("reported");
    expect(evidence.complete).toBe(true);
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
    expect(evidence.toolCalls).toHaveLength(2);
    expect(evidence.changedFiles).toEqual(["a.ts", "b.ts"]);
    expect(evidence.exitCode).toBe(0);
    expect(evidence.stdout).toBe("output");
    expect(evidence.meta.tokenUsage).toBe(200);
    expect(evidence.source).toBe("reported");
  });

  it("should return inferred when no evidence exists", async () => {
    const evidence = await collectEvidence(tempDir);
    expect(evidence.source).toBe("inferred");
    expect(evidence.complete).toBe(false);
    expect(evidence.toolCalls).toHaveLength(0);
  });
});
