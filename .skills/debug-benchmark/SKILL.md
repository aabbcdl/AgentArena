---
name: debug-benchmark
description: Diagnose and fix failed benchmark runs. Use when a benchmark run fails, scores are unexpected, judges show errors, or traces are incomplete.
---

# Debug Benchmark

Diagnose failures across the benchmark execution chain.

## When to Use

- A benchmark run produced unexpected scores or errors.
- An agent shows as "missing" or "failed" in results.
- Judges failed with unclear error messages.
- The trace is incomplete or missing.
- Comparing two runs that should be similar but aren't.

## Execution Chain (read in order when debugging)

```
CLI args       → packages/cli/src/args.ts
  ↓
Runner setup   → packages/runner/src/index.ts
  ↓
Agent lifecycle → packages/runner/src/agent-lifecycle.ts   ← START HERE for agent failures
  ↓
Adapter exec   → packages/adapters/src/<adapter>-adapter.ts
  ↓
Judge eval     → packages/judges/src/index.ts              ← START HERE for judge failures
  ↓
Report gen     → packages/report/src/scoring.ts
  ↓
Output         → packages/report/src/decision-report.ts
```

## Common Failures by Layer

### 1. Agent not found / "missing"

| Check | File | What to look for |
|-------|------|------------------|
| CLI installed? | `agentarena doctor` | Check PATH |
| Adapter registered? | `packages/adapters/src/adapter-registry.ts` | Import + entry in `adapterEntries` |
| Preflight passes? | `<adapter>-adapter.ts` → `preflight()` | Returns `ready` or `blocked` with reason |
| Binary override? | Environment `AGENTARENA_<AGENT>_BIN` | Custom path support |

### 2. Agent ran but score is 0

The runner lifecycle at `packages/runner/src/agent-lifecycle.ts` (837 lines) has these phases:

```
prepareWorkspace() → setupSandbox() → executeAgent() → collectResults() → evaluateJudges()
```

| Phase | File | Debug tip |
|-------|------|-----------|
| prepareWorkspace | `agent-lifecycle.ts` | Check sandbox directory was created |
| setupSandbox | `agent-lifecycle.ts` | Check repo was copied to sandbox |
| executeAgent | `agent-lifecycle.ts` | Check agent process ran and produced output |
| collectResults | `agent-lifecycle.ts` | Check stdout/stderr were captured |
| evaluateJudges | `agent-lifecycle.ts` | Check judge results exist |

Add `console.log` or inspect trace at `.agentarena/runs/<run-id>/trace/`.

### 3. Judge failures

| Symptom | File | Likely cause |
|---------|------|-------------|
| `command` judge fails | `packages/judges/src/command-runner.ts` | Command not found or timeout |
| `file-exists` fails | `packages/judges/src/judges/` | Working directory wrong |
| `lint-check` fails | `packages/judges/src/shared.ts` | Linter not configured for the repo |
| All judges critical fail | `packages/judges/src/index.ts` → `runJudge()` | Agent produced no output at all |

Command runner at `packages/judges/src/command-runner.ts` handles process execution with:
- Working directory resolution (`resolveJudgeWorkingDirectory()`)
- Timeout handling
- Output capture

### 4. Scoring issues

| Check | File |
|-------|------|
| Weight presets sum to 1.0? | `packages/report/src/scoring.ts` |
| Token budget parsed? | `packages/report/src/scoring.ts` → `computeEfficiencyScore()` |
| Mode matches CLI? | `packages/cli/src/args.ts` vs scoring modes in `scoring.ts` |

### 5. Report/decision problems

| Issue | File |
|-------|------|
| HTML report wrong | `packages/report/src/html-template.ts` (502 lines) |
| Decision unclear | `packages/report/src/decision-report.ts` (383 lines) |
| Leaderboard missing | `packages/report/src/leaderboard.ts` (311 lines) |
| Markdown wrong | `packages/report/src/markdown-template.ts` (277 lines) |

## Trace Inspection

Trace files live in `.agentarena/runs/<run-id>/trace/`:

```bash
# List traces
ls .agentarena/runs/

# Read trace events
cat .agentarena/runs/<run-id>/trace/events.json

# Replay a trace programmatically
# See packages/trace/src/replay.ts (406 lines)
```

## Quick Diagnostic Commands

```bash
# Check agent availability
node packages/cli/dist/index.js doctor --probe-auth

# Run a single quick benchmark
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.json --agents demo-fast

# Run with JSON output for inspection
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.json --agents demo-fast --json

# Check trace
node --test tests/trace.test.mjs
```

## What to Check Before Committing

- The diagnosis identifies which layer the failure is in (adapter / runner / judge / report).
- `pnpm build && pnpm test` passes after the fix.
- The fix is tested with a real benchmark run (`--agents demo-fast`).
