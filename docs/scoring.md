# Scoring and Leaderboards

AgentArena has two different comparison layers:

- the run score, which only ranks variants inside one run
- the historical leaderboard, which aggregates comparable runs over time

Those two layers are intentionally separate.

## Run Score

The default score mode is `practical`.

Its goal is not to estimate raw model intelligence. Its goal is to answer a more practical question:

Which variant completed this repository task best under the current benchmark setup?

The default weighting favors correctness first, then efficiency:

- `status`: 24%
- `tests`: 26%
- `criticalJudges`: 20%
- `nonCriticalJudges`: 8%
- `precision`: 5%
- `lint`: 3%
- `duration`: 8%
- `cost`: 6%

The score also uses guardrails:

- a failed run is capped into a low score band
- a run that passes overall but fails a critical judge is capped into a middle score band
- speed and cost only create real separation after the task is basically completed

This means a fast-but-wrong result should not outrank a slower correct result.

## What the Score Does Not Claim

The score is not:

- a universal model benchmark
- a cross-task absolute ranking
- a vendor-quality claim
- a replacement for reading the judges, diff, and summary

It is a local ranking for the current run and current task.

## Historical Leaderboard

The historical leaderboard is stricter than the run score.

It only groups results that share the same:

- task identity
- score mode
- base agent
- provider profile
- model
- agent version

If any of those change, AgentArena starts a new historical record instead of merging the results.

That is why version changes do not inherit old scores.

## Historical Metrics

Each leaderboard row tracks:

- `averageScore`
- `winRate`
- `successRate`
- `firstPassRate`
- `medianDurationMs`
- `medianCostUsd`
- sample size

`firstPassRate` is useful because it answers a different question from average score:

How often does this exact setup get the task done cleanly without depending on lucky retries?

## How to Use It Well

If you want to compare agents for real work:

- keep the task pack fixed
- keep the score mode fixed
- compare enough runs to avoid one-off noise
- inspect failed judges before trusting the leaderboard

If you want to compare models rather than toolchains:

- keep the base agent fixed
- keep provider routing fixed
- change only the model
- treat version changes as a new line of history

## Recommended Reading Order

When a run finishes, read results in this order:

1. verdict and compare table
2. failed judges or risk notes
3. changed files and summary
4. historical leaderboard

That order keeps the benchmark honest: first check whether the task was actually completed, then look at score and history.
