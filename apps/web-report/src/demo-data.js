/**
 * Demo data module for AgentArena web report.
 * Generates a simulated benchmark run to showcase the UI without a real backend.
 */

/**
 * Build a demo benchmark run with sample agents and results.
 * @param {object} options
 * @param {Record<string, number>} options.defaultScoreWeights
 * @returns {object} A simulated BenchmarkRun object
 */
export function buildDemoRun({ defaultScoreWeights }) {
  return {
    runId: `demo-${Date.now()}`,
    createdAt: new Date().toISOString(),
    task: {
      id: "demo-task-fix-auth-bug",
      title: "Fix Authentication Bug",
      description: "Fix the authentication middleware to properly handle expired tokens and return appropriate error responses.",
      schemaVersion: "agentarena.taskpack/v1",
      metadata: {
        objective: "Fix the authentication bug where expired tokens are not properly rejected",
        judgeRationale: "The fix should properly validate token expiration and return 401 Unauthorized",
        repoTypes: ["node", "express"],
        difficulty: "medium"
      },
      judges: [
        {
          id: "test-auth",
          type: "test-result",
          label: "Auth Tests Pass",
          expectation: "all tests pass"
        },
        {
          id: "lint-check",
          type: "lint-check",
          label: "No Lint Errors",
          expectation: "no errors"
        },
        {
          id: "file-exists",
          type: "file-exists",
          label: "Auth Middleware Exists",
          target: "src/middleware/auth.js"
        }
      ]
    },
    scoreWeights: { ...defaultScoreWeights },
    scoreMode: "practical",
    results: [
      {
        agentId: "demo-fast",
        agentLabel: "Demo Fast",
        status: "success",
        durationMs: 45000,
        estimatedCostUsd: 0.15,
        costKnown: true,
        tokensUsed: 2500,
        filesChanged: 3,
        diffPrecision: 0.85,
        testPassRate: 0.95,
        lintPassRate: 1.0,
        judgeResults: [
          { judgeId: "test-auth", status: "pass", message: "All auth tests pass" },
          { judgeId: "lint-check", status: "pass", message: "No lint errors found" },
          { judgeId: "file-exists", status: "pass", message: "Auth middleware exists" }
        ],
        compositeScore: 0.92,
        baseAgent: "demo-fast",
        variant: "default",
        runtime: {
          verification: "local",
          source: "demo"
        }
      },
      {
        agentId: "demo-thorough",
        agentLabel: "Demo Thorough",
        status: "success",
        durationMs: 78000,
        estimatedCostUsd: 0.28,
        costKnown: true,
        tokensUsed: 4800,
        filesChanged: 5,
        diffPrecision: 0.92,
        testPassRate: 0.98,
        lintPassRate: 1.0,
        judgeResults: [
          { judgeId: "test-auth", status: "pass", message: "All auth tests pass" },
          { judgeId: "lint-check", status: "pass", message: "No lint errors found" },
          { judgeId: "file-exists", status: "pass", message: "Auth middleware exists" }
        ],
        compositeScore: 0.95,
        baseAgent: "demo-thorough",
        variant: "default",
        runtime: {
          verification: "local",
          source: "demo"
        }
      },
      {
        agentId: "demo-budget",
        agentLabel: "Demo Budget",
        status: "failed",
        durationMs: 32000,
        estimatedCostUsd: 0.08,
        costKnown: true,
        tokensUsed: 1200,
        filesChanged: 1,
        diffPrecision: 0.45,
        testPassRate: 0.65,
        lintPassRate: 0.85,
        judgeResults: [
          { judgeId: "test-auth", status: "fail", message: "2 auth tests failing" },
          { judgeId: "lint-check", status: "pass", message: "No lint errors found" },
          { judgeId: "file-exists", status: "pass", message: "Auth middleware exists" }
        ],
        compositeScore: 0.58,
        baseAgent: "demo-budget",
        variant: "default",
        runtime: {
          verification: "local",
          source: "demo"
        }
      }
    ]
  };
}
