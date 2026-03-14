import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrTable,
  buildShareCard,
  findPreviousComparableRun,
  getCompareResults,
  getRunCompareRows,
  getRunToRunAgentDiff,
  getRunVerdict
} from "../apps/web-report/src/view-model.js";

function createRun(runId, taskTitle, overrides = {}) {
  return {
    runId,
    createdAt: overrides.createdAt ?? "2026-03-14T00:00:00.000Z",
    task: {
      title: taskTitle
    },
    results: overrides.results ?? []
  };
}

function createResult(agentId, overrides = {}) {
  return {
    agentId,
    agentTitle: overrides.agentTitle ?? agentId,
    status: overrides.status ?? "success",
    durationMs: overrides.durationMs ?? 1000,
    tokenUsage: overrides.tokenUsage ?? 100,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0,
    costKnown: overrides.costKnown ?? false,
    changedFiles: overrides.changedFiles ?? [],
    judgeResults: overrides.judgeResults ?? []
  };
}

test("getRunCompareRows filters to the selected task title and sorts by success", () => {
  const runs = [
    createRun("run-a", "Task A", {
      createdAt: "2026-03-14T10:00:00.000Z",
      results: [createResult("demo-fast"), createResult("codex", { status: "failed" })]
    }),
    createRun("run-b", "Task A", {
      createdAt: "2026-03-14T11:00:00.000Z",
      results: [createResult("demo-fast"), createResult("codex")]
    }),
    createRun("run-c", "Task B", {
      createdAt: "2026-03-14T12:00:00.000Z",
      results: [createResult("demo-fast", { status: "failed" })]
    })
  ];

  const rows = getRunCompareRows(runs, {
    taskTitle: "Task A",
    sort: "success",
    markdownByRunId: new Map([["run-b", "summary"]])
  });

  assert.deepEqual(rows.map((row) => row.run.runId), ["run-b", "run-a"]);
  assert.equal(rows[0].hasMarkdown, true);
});

test("getCompareResults filters failed agents and sorts by changed files", () => {
  const run = createRun("run-1", "Task A", {
    results: [
      createResult("a", { status: "failed", changedFiles: ["a", "b"], judgeResults: [{ success: false }] }),
      createResult("b", { status: "failed", changedFiles: ["a"], judgeResults: [{ success: false }] }),
      createResult("c", { status: "success", changedFiles: ["a", "b", "c"], judgeResults: [{ success: true }] })
    ]
  });

  const rows = getCompareResults(run, { status: "failed", sort: "changed" });
  assert.deepEqual(rows.map((row) => row.agentId), ["a", "b"]);
});

test("getRunVerdict returns best and fastest agents", () => {
  const run = createRun("run-1", "Task A", {
    results: [
      createResult("slow-success", {
        durationMs: 3000,
        costKnown: true,
        estimatedCostUsd: 0.3,
        judgeResults: [{ success: true }, { success: true }]
      }),
      createResult("fast-success", {
        durationMs: 1000,
        costKnown: true,
        estimatedCostUsd: 0.2,
        judgeResults: [{ success: true }, { success: false }]
      }),
      createResult("failed", {
        status: "failed",
        durationMs: 500,
        judgeResults: [{ success: false }]
      })
    ]
  });

  const verdict = getRunVerdict(run);
  assert.equal(verdict.bestAgent.agentId, "slow-success");
  assert.equal(verdict.fastest.agentId, "fast-success");
  assert.equal(verdict.lowestKnownCost.agentId, "fast-success");
});

test("share helpers produce shareable summary text and PR tables", () => {
  const run = createRun("run-1", "Task A", {
    results: [
      createResult("demo-fast", {
        costKnown: true,
        estimatedCostUsd: 0.1,
        judgeResults: [{ success: true }, { success: true }],
        changedFiles: ["README.md"]
      })
    ]
  });

  const shareCard = buildShareCard(run);
  const prTable = buildPrTable(run);

  assert.match(shareCard, /RepoArena \| Task A/);
  assert.match(shareCard, /Best agent: demo-fast/);
  assert.match(prTable, /\| Agent \| Status \| Duration \| Tokens \| Cost \| Judges \| Files \|/);
  assert.match(prTable, /\| demo-fast \| success \| 1000ms \| 100 \| \$0\.10 \| 2\/2 \| 1 \|/);
});

test("findPreviousComparableRun returns the previous run with the same task title", () => {
  const runs = [
    createRun("run-old", "Task A", { createdAt: "2026-03-14T09:00:00.000Z" }),
    createRun("run-current", "Task A", { createdAt: "2026-03-14T10:00:00.000Z" }),
    createRun("run-other", "Task B", { createdAt: "2026-03-14T11:00:00.000Z" })
  ];

  const previousRun = findPreviousComparableRun(runs, runs[1]);
  assert.equal(previousRun.runId, "run-old");
});

test("getRunToRunAgentDiff computes deltas against the previous comparable run", () => {
  const previousRun = createRun("run-old", "Task A", {
    createdAt: "2026-03-14T09:00:00.000Z",
    results: [
      createResult("demo-fast", {
        durationMs: 2000,
        tokenUsage: 120,
        costKnown: true,
        estimatedCostUsd: 0.3,
        judgeResults: [{ success: true }]
      }),
      createResult("codex", {
        status: "failed",
        durationMs: 3000,
        judgeResults: [{ success: false }]
      })
    ]
  });
  const currentRun = createRun("run-current", "Task A", {
    createdAt: "2026-03-14T10:00:00.000Z",
    results: [
      createResult("demo-fast", {
        durationMs: 1500,
        tokenUsage: 140,
        costKnown: true,
        estimatedCostUsd: 0.25,
        judgeResults: [{ success: true }, { success: true }]
      }),
      createResult("codex", {
        status: "success",
        durationMs: 2800,
        judgeResults: [{ success: true }]
      })
    ]
  });

  const diff = getRunToRunAgentDiff([currentRun, previousRun], currentRun);
  assert.equal(diff.previousRun.runId, "run-old");
  assert.equal(diff.rows.length, 2);
  const demoFastRow = diff.rows.find((row) => row.agentId === "demo-fast");
  assert.equal(demoFastRow.statusChange, "success -> success");
  assert.equal(demoFastRow.durationDeltaMs, -500);
  assert.equal(demoFastRow.tokenDelta, 20);
  assert.ok(Math.abs(demoFastRow.costDelta + 0.05) < 1e-9);
  assert.equal(demoFastRow.judgeDelta, 1);

  const codexRow = diff.rows.find((row) => row.agentId === "codex");
  assert.equal(codexRow.statusChange, "failed -> success");
});
