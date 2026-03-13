# RepoArena

> The local-first arena for evaluating AI coding agents in real repositories.

[中文说明](./README.zh-CN.md)

RepoArena lets you run Claude Code, Codex, Cursor, Devin, and open source agents against the same repository tasks, then compare success rate, duration, cost, diffs, and replay traces in one report.

Task packs use a versioned schema. The current format is `repoarena.taskpack/v1`, with structured `judges` definitions for command-based evaluation.

## What It Does

- Runs multiple coding agents against the same task pack
- Records traces and file changes in isolated workspaces
- Evaluates outcomes with shared checks
- Exports JSON and HTML reports
- Surfaces environment and authentication blockers before a benchmark starts

## Current Status

This repository already contains a runnable prototype with:
- a local `repoarena run` CLI
- a local `repoarena doctor` CLI
- built-in demo adapters
- a working `codex` adapter
- `claude-code` and `cursor` adapters with auth-aware failure reporting
- static HTML and JSON report generation
- an interactive `apps/web-report` viewer for `summary.json`

## Quick Start

```bash
pnpm install
pnpm demo
```

That command writes a timestamped run under `.repoarena/runs/` and generates a local `report.html`.

Check adapter readiness:

```bash
pnpm doctor
```

Run the Codex adapter:

```bash
pnpm demo:codex
```

Run the full local arena pass:

```bash
pnpm demo:arena
```

## Example Workflow

```bash
repoarena run \
  --repo . \
  --task examples/taskpacks/demo-repo-health.json \
  --agents codex,claude-code,cursor
```

Then inspect the generated report in `.repoarena/runs/`.

## Task Pack Schema

RepoArena currently supports `repoarena.taskpack/v1`.

Each task pack defines:
- repository task metadata
- a single benchmark prompt
- an optional task-level `envAllowList`
- optional `setupCommands`
- a list of structured `judges`
- optional `teardownCommands`

Each command judge can define:
- `id`
- `label`
- `type: "command"`
- `command`
- optional `cwd`
- optional `timeoutMs`

Environment handling is allowlist-based. Task packs can expose specific host variables through `envAllowList`, and RepoArena only passes that filtered environment to setup commands, judges, teardown commands, and agent execution.

## Design Principles

### Fair By Default
Each agent should run against the same repository snapshot, the same task definition, and the same evaluation rules.

### Real Repositories
The benchmark should matter to maintainers, not just look good in a demo.

### Replayable Results
If a result looks surprising, you should be able to inspect the trace and understand why it happened.

### Honest Readiness
If an adapter is blocked by missing auth or missing local setup, RepoArena should say that clearly before comparison starts.

## Repository Layout

```text
apps/
  web-report/
packages/
  cli/
  core/
  runner/
  adapters/
  judges/
  taskpacks/
  trace/
  report/
docs/
  overview.md
```

## Documentation

- [Project overview](./docs/overview.md)
- [Web report app](./apps/web-report/README.md)

## License

[MIT](./LICENSE)
