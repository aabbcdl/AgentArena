# Scoring and Fair Comparison

How AgentArena scores agent results and determines which runs are comparable.

## Score Modes

Six weight presets defined in `packages/core/src/scoring-weights.ts`:

- `practical` (default) — correctness-first: tests 26%, status 24%, criticalJudges 20%
- `balanced` — even spread: status 30%, tests 25%, lint/precision 10% each
- `issue-resolution` — SWE-Bench inspired: resolutionRate 45%, failToPass 20%, passToPass 15%
- `efficiency-first` — cost-conscious: tokenEfficiency 25%, status 20%, tests 15%
- `rotating-tasks` — LiveBench inspired: even 20% across status/tests/criticalJudges/categoryScore
- `comprehensive` — all signals: duration/cost 15% each, tests 15%, status/resolutionRate 12%

## Single Source of Truth

`packages/core/src/scoring-weights.ts` is canonical. The frontend (`apps/web-report/src/view-model/scoring.js`) mirrors these presets for client-side re-scoring. Consistency is enforced by `tests/scoring.test.mjs`.

If you change a weight preset, update the backend file. The test will fail if the frontend copy drifts.

## Score Bands

- Failed agents: score clamped to 10-40 band (proportional to partial progress)
- Critical judge failure: score clamped to 50-70 band (task completed but critical check failed)
- Success: weighted sum of all applicable score components, normalized to 0-100

## Fair Comparison Identity

Three identity fields determine whether two runs are comparable:

- `taskIdentity` — `task:<id>` or `task-title:<title>`. Same task pack = same identity.
- `judgeIdentity` — SHA-256 of the judge array `[{id, type, label, critical}]`. Any judge config change = different identity.
- `repoBaselineIdentity` — `repo-base:<baseCommit>` for SWE-bench tasks. Different base commit = different identity.

## Where Fair Comparison Lives

| Concern | File | What it does |
|---------|------|-------------|
| Identity generation | `packages/cli/src/output.ts` | Computes the 3 identity fields at run output time |
| Comparison filtering | `apps/web-report/src/view-model/comparison.js` | `getFairComparisonExclusionReasons()` gates cross-run comparison |
| Leaderboard aggregation | `packages/cli/src/publish.ts` | Does NOT use fairComparison; groups by agent identity instead |

## Exclusion Reasons

`getFairComparisonExclusionReasons(candidateRun, anchorRun)` returns:
- `"different-task-pack"` — taskIdentity mismatch
- `"different-judge-logic"` — judgeIdentity mismatch (only when both runs have metadata)
- `"different-repo-baseline"` — repoBaselineIdentity mismatch (only when both runs have metadata)
- `"missing-core-data"` — candidate run lacks status/judgeResults/durationMs/tokenUsage

Legacy runs (without `fairComparison` metadata) are only excluded by task identity mismatch. This provides backward compatibility.

## What This Does Not Claim

- Scores are NOT absolute quality measurements. They are relative rankings within a run.
- Fair comparison does NOT guarantee identical environments. Network latency, API rate limits, and model version updates can still differ between runs.
- The leaderboard does NOT enforce fairness. It aggregates all runs for an agent identity regardless of task comparability. Use the web report's cross-run comparison for controlled comparisons.
