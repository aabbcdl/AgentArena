# RepoArena

> The local-first arena for AI coding agents in real repositories.

RepoArena lets you run Claude Code, Codex, Cursor, Devin, and open source agents against the same real repository tasks, then compare success rate, speed, cost, diffs, and replay traces in one report.

## Current Prototype

The repository now includes a runnable vertical slice with:
- a local `repoarena run` CLI
- a local `repoarena doctor` CLI
- repository workspace copying
- built-in demo adapters
- a working `codex` external adapter
- a `claude-code` external adapter with auth-aware failure reporting
- a `cursor` external adapter wired through Cursor's bundled internal CLI
- success-command judges
- diff detection
- JSON and HTML report output

Try it locally:

```bash
pnpm install
pnpm demo
```

That command writes a timestamped run under `.repoarena/runs/` and generates a shareable `report.html`.

To inspect adapter readiness before running a benchmark:

```bash
pnpm doctor
```

To run the real Codex adapter:

```bash
pnpm demo:codex
```

To run the full local arena pass:

```bash
pnpm demo:arena
```

The `claude-code` adapter is also wired in, but it depends on your local Claude Code authentication being valid.

The `cursor` adapter is also wired in. On this machine it relies on Cursor's bundled internal `claude-agent-sdk` CLI rather than the public `cursor agent` command, and it also depends on local authentication being valid.

## Why It Exists

Everyone has opinions about which coding agent is "best".
Very few teams have a fair way to test that claim inside their own codebase.

RepoArena is built to be:
- repo-native
- replayable
- adapter-driven
- shareable

Instead of building yet another agent, RepoArena acts as the referee, the flight recorder, and the benchmark layer for all of them.

## What You Get

- Run multiple coding agents on the same task pack
- Record what happened step by step
- Judge outcomes with tests, lint, diffs, and cost
- Export a local HTML report you can actually share
- Build your own adapters, judges, and task packs

## Planned Workflow

```bash
repoarena run \
  --repo . \
  --task examples/taskpacks/demo-repo-health.json \
  --agents codex,claude-code,cursor
```

Then inspect the generated report from `.repoarena/runs/`.

## MVP Scope

The first release is focused on one thing:

Run a fair, local benchmark across multiple coding agents in a real repository and produce a replayable report.

### Included In V0
- local CLI runner
- isolated workspace per run
- adapter interface plus built-in demo adapters
- task pack format
- judge plugin system
- JSON plus HTML report output
- cost and token tracking
- adapter preflight checks

### Explicitly Not In V0
- cloud-only hosted execution
- enterprise governance features
- giant synthetic benchmark suite
- another general-purpose coding agent

## Project Shape

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
  founder-blueprint.md
```

## Design Principles

### Fair By Default
Each agent should run against the same repo snapshot, the same task definition, and the same evaluation rules.

### Real Repos, Not Toy Tasks
The benchmark should matter to maintainers, not just look good in a demo.

### Replay Over Hype
If a result is surprising, you should be able to inspect the trace and see exactly why it happened.

### Local First
The most valuable workflow is benchmarking agents inside your own repository without shipping source code to a third-party platform.

### Diagnose Before You Compare
If an adapter is blocked by missing auth or missing binaries, RepoArena should say that clearly before the benchmark starts.

## Extensibility

RepoArena is designed for community expansion:

- write a new adapter for an agent
- publish a task pack for a framework or language
- add a judge for snapshots, human rubric, or custom CI rules
- create benchmark suites and share public results

## Current Status

This repository is in runnable foundation mode.
The product direction, MVP scope, and architecture are defined in [docs/founder-blueprint.md](/D:/project/AgentArena/docs/founder-blueprint.md).

## Why This Can Matter

The winning project in agent infrastructure may not be the next agent.
It may be the neutral layer every team uses to decide which agent to trust.

RepoArena is built for that role.
