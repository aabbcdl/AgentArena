#!/usr/bin/env node
/**
 * Run the "quick" test suite — a curated subset of fast, pure-logic unit tests
 * that complete in under ~15 seconds total (no build step required).
 *
 * Inclusion criteria for a test in this list:
 *   1. Completes in < 1 second individually
 *   2. No child-process spawning, no HTTP servers, no browser, no heavy I/O
 *   3. Tests core logic that changes frequently during development
 *
 * To add a test here:
 *   - Verify it meets the criteria above (measure with: `Measure-Command { node --test tests/NAME.test.mjs }`)
 *   - Add the filename to the QUICK_TESTS array below
 *
 * This script assumes `pnpm build` has already been run (dist/ is current).
 * If you've changed source code, run `pnpm build` first.
 */
import { spawn } from "node:child_process";

const QUICK_TESTS = [
  // Core parsing & data contracts
  "tests/event-parser-contract.test.mjs",
  "tests/trace-event-contract.test.mjs",
  "tests/taskpack-template-contract.test.mjs",
  "tests/publish-schema-contract.test.mjs",
  "tests/runner-report-contract.test.mjs",

  // Result building & assembly
  "tests/result-builder.test.mjs",

  // Transport layer
  "tests/transport-chain.test.mjs",

  // Scoring
  "tests/scoring.test.mjs",
  "tests/score-metrics.test.mjs",
  "tests/score-weights.test.mjs",
  "tests/scoring-viewmodel.test.mjs",

  // Core utilities
  "tests/core.test.mjs",
  "tests/ring-buffer.test.mjs",
  "tests/args-validators.test.mjs",
  "tests/env.test.mjs",
  "tests/normalize-cli-selections.test.mjs",
  "tests/metrics.test.mjs",
  "tests/logging.test.mjs",
  "tests/variance-analysis.test.mjs",
  "tests/validate-run-payload.test.mjs",

  // Task packs
  "tests/taskpacks.test.mjs",
  "tests/task-utils.test.mjs",

  // Trace
  "tests/trace.test.mjs",

  // Judges
  "tests/judge-registry-sync.test.mjs",
  "tests/judges-edge-cases.test.mjs",

  // Agent lifecycle (unit only — not integration)
  "tests/agent-lifecycle-unit.test.mjs",

  // Security & sandbox
  "tests/security.test.mjs",
  "tests/sandbox.test.mjs",

  // Reports
  "tests/conclusion.test.mjs",
  "tests/csv-export.test.mjs",
  "tests/report-rendering.test.mjs",

  // Run state
  "tests/run-state.test.mjs",
  "tests/ui-run-state.test.mjs",

  // Evidence & snapshots
  "tests/evidence.test.mjs",
  "tests/snapshot.test.mjs",

  // Workbench
  "tests/workbench-domain.test.mjs",
  "tests/workbench-compare.test.mjs",

  // Misc
  "tests/local-only.test.mjs",
];

const args = ["--test", "--test-concurrency=1", ...QUICK_TESTS];
const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
