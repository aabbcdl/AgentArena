# Benchmark Fairness

RepoArena compares AI coding agents under a shared local execution model, but it does not pretend every adapter exposes identical capabilities.

## Fairness Rules

- All agents run from the same repository snapshot copied into isolated workspaces.
- All agents receive the same task pack prompt and the same task-level environment allowlist.
- Setup, judges, and teardown are shared across agents.
- Preflight results are part of the benchmark context and must be displayed with every comparison.
- Token and cost metrics are reported as `known`, `estimated`, or `unavailable`; missing values must not be treated as exact.
- Snapshot updates are opt-in via `--update-snapshots` and should only be used for fixture refresh workflows, not normal competitive comparisons.

## What Fairness Does Not Mean

- It does not mean every agent has the same local authentication state.
- It does not mean every CLI exposes the same event stream richness.
- It does not mean cost data is always available.

RepoArena aims for transparent fairness: identical repo inputs where possible, explicit capability differences where not.
