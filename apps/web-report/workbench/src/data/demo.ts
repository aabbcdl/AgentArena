export const demoRun = {
  runId: "demo-workbench-001",
  createdAt: "2026-07-15T08:00:00.000Z",
  isDemo: true,
  source: { kind: "demo", label: "Safe demo" },
  repository: { path: "examples/demo-repository", revision: "demo-a1b2c3" },
  task: {
    id: "repo-health",
    title: "Improve repository health",
    schemaVersion: "agentarena.taskpack/v1"
  },
  scoreMode: "practical",
  results: [
    {
      agentId: "demo-thorough",
      variantId: "demo-thorough",
      displayLabel: "Demo Thorough",
      status: "success",
      compositeScore: 91.4,
      durationMs: 84200,
      tokenUsage: 12840,
      estimatedCostUsd: 0.42,
      costKnown: false,
        costQuality: "estimated",
      changedFiles: ["src/validation.ts", "tests/validation.test.ts"],
      judgeResults: [
        { judgeId: "tests", label: "Tests", type: "test-result", success: true, message: "All tests passed." },
        { judgeId: "lint", label: "Lint", type: "lint-check", success: true, message: "No lint issues." },
        { judgeId: "scope", label: "Scope", type: "diff-check", success: true, message: "Changes stayed in scope." }
      ],
      tracePath: "agents/demo-thorough/trace.jsonl",
      summary: "Added validation and representative tests with a focused change set.",
      requestedConfig: { model: "demo-balanced" },
      resolvedRuntime: { providerKind: "official" }
    },
    {
      agentId: "demo-fast",
      variantId: "demo-fast",
      displayLabel: "Demo Fast",
      status: "success",
      compositeScore: 78.2,
      durationMs: 32100,
      tokenUsage: 6040,
      estimatedCostUsd: 0.17,
      costKnown: false,
        costQuality: "estimated",
      changedFiles: ["src/validation.ts"],
      judgeResults: [
        { judgeId: "tests", label: "Tests", type: "test-result", success: true },
        { judgeId: "lint", label: "Lint", type: "lint-check", success: true }
      ],
      tracePath: "agents/demo-fast/trace.jsonl",
      summary: "Implemented the core validation quickly with a small patch.",
      requestedConfig: { model: "demo-fast" },
      resolvedRuntime: { providerKind: "official" }
    },
    {
      agentId: "demo-budget",
      variantId: "demo-budget",
      displayLabel: "Demo Budget",
      status: "failed",
      durationMs: 22100,
      tokenUsage: 3100,
      costKnown: false,
      changedFiles: [],
      judgeResults: [
        { judgeId: "tests", label: "Tests", type: "test-result", success: false, message: "Expected validation tests were not added." }
      ],
      summary: "The run ended without a valid patch.",
      failureReason: "No accepted file changes were produced.",
      requestedConfig: { model: "demo-budget" },
      resolvedRuntime: { providerKind: "official" }
    }
  ]
};
