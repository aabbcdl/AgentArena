import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeReport } from "../packages/report/dist/index.js";
import { runBenchmark } from "../packages/runner/dist/index.js";

test("runBenchmark output is directly consumable by writeReport", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-contract-"));
  try {
    const repoPath = path.join(tempDir, "repo");
    const outputPath = path.join(tempDir, "output");
    const taskPath = path.join(tempDir, "task.json");

    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, "README.md"), "# Contract Test\n", "utf8");
    await writeFile(taskPath, JSON.stringify({
      schemaVersion: "agentarena.taskpack/v1",
      id: "contract-runner-report",
      title: "Runner-Report Contract",
      prompt: "Verify runner output feeds into report without errors.",
      judges: [
        { id: "pass", type: "command", label: "Always pass", command: "node -e \"process.exit(0)\"" }
      ]
    }), "utf8");

    const benchmark = await runBenchmark({
      repoPath,
      taskPath,
      agentIds: ["demo-fast"],
      outputPath
    });

    assert.equal(benchmark.results.length, 1);
    assert.equal(benchmark.results[0].status, "success");

    const report = await writeReport(benchmark);

    assert.ok(report.jsonPath.endsWith("summary.json"));
    assert.ok(report.markdownPath.endsWith("summary.md"));
    assert.ok(report.badgePath.endsWith("badge.json"));
    assert.ok(report.prCommentPath.endsWith("pr-comment.md"));
    assert.ok(report.htmlPath.endsWith("report.html"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
