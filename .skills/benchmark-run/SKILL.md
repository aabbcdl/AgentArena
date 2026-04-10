---
name: benchmark-run
description: Run, monitor, and troubleshoot a benchmark execution. Use when executing benchmarks, checking results, debugging failed runs, or comparing agent performance.
---

# Benchmark Run

Execute and troubleshoot benchmark runs.

## When to Use

- Running a benchmark against one or more agents.
- Debugging a failed benchmark run.
- Interpreting or comparing results.
- Investigating unexpected scores or judge failures.

## Before Running

- `pnpm build` — 0 errors.
- `pnpm test` — 0 failures.
- `agentarena doctor` — target agents are available.

## Running

```
agentarena run --repo <path> --task <task.yaml> --agents <agent1,agent2,...> [options]
```

| Option | Values | Purpose |
|--------|--------|---------|
| `--score-mode` | `practical`, `balanced`, `issue-resolution`, `efficiency-first`, `rotating-tasks`, `comprehensive` | Scoring weight preset |
| `--token-budget` | number | Token budget limit for efficiency scoring |
| `--max-concurrency` | number | Parallel agent execution |
| `--output` | path | Custom output directory |
| `--json` | flag | Output results as JSON to stdout |

## Output

Results land in `.agentarena/runs/<run-id>/`:

| File | Content |
|------|---------|
| `summary.json` | Full benchmark results |
| `report.html` | Interactive web report |
| `decision-report.md` | Decision recommendation |

## Troubleshooting

| Symptom | Likely Cause |
|---------|-------------|
| Agent status "missing" | CLI not installed or not in PATH |
| Judge fails | Wrong command, missing deps, or timeout |
| Score is 0 | Agent run failed or all critical judges failed |
| Token usage is 0 | Agent adapter doesn't report token usage |

## Stop Conditions

- The benchmark runs but the user doesn't know where results are.
- A judge failure is reported without explaining which command failed.
- The output directory is empty after the run completes.
