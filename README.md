# AgentArena

> Benchmark the coding agents you already run locally on the same repo, the same task, and the same judges.

[中文说明](./README.zh-CN.md)

![AgentArena launcher](./docs/images/web-report-launcher.jpg)
![AgentArena report](./docs/images/web-report-report.jpg)

AgentArena is for people who already use coding agents in real work and want something more trustworthy than vibes.

It helps answer questions like:

- How strong is my current `Codex CLI + model X` setup on real repository tasks?
- Is `Claude Code` actually better than `Cursor` for the kind of fixes I care about?
- If I only run one local agent, how do I turn that into a repeatable capability baseline instead of a gut feeling?
- When a run looks surprising, how do I inspect the diff, judge failures, and trace instead of trusting one score?

AgentArena is local-first by default. You point it at your own repository, task pack, and locally installed agent CLIs. AgentArena handles shared setup, execution, judges, traces, and reports.

## Why This Exists

Most agent users are already past "how do I install an agent?" and into "which setup actually performs better on my work?"

AgentArena is built for that stage.

It gives you:

- a shared benchmark harness for agents you already use locally
- repeatable task packs with structured judges
- comparable outputs across both single-agent and multi-agent runs
- a browser UI that works as both launcher and report viewer
- reports you can keep, compare, share, and attach to CI

## Best Use Cases

- compare multiple local coding agents on the same repository task
- track whether one agent / model / provider combo is getting better or worse over time
- benchmark one agent repeatedly to estimate its current capability ceiling on your workflow
- run local smoke benchmarks before rolling a new agent or model out to a team
- generate HTML / Markdown / PR-comment artifacts from the same benchmark run

## What You Get From One Run

Even if you only benchmark one local agent, AgentArena is still useful. A single run gives you:

- a shared score and judge pass/fail breakdown
- changed files and diff scope signals
- duration, token usage, and cost when available
- trace output for replay and diagnosis
- comparable history once you keep running the same task over time

That means a single-agent run is not "just one score". It becomes the baseline you compare future runs against.

## What Makes The Result Credible

AgentArena is opinionated about fairness:

- same repository snapshot
- same task definition
- same setup commands
- same judge logic
- readiness checks before execution
- isolated workspaces per run
- structured report outputs after execution

If an adapter is blocked by missing auth or broken local setup, `agentarena doctor` should tell you before you trust the result.

## Current Capabilities

### Core flows

- `agentarena ui` for browser-based launch + report viewing
- `agentarena run` for direct CLI execution
- `agentarena doctor` for readiness and auth-aware checks
- `agentarena list-adapters` for adapter capability listing
- `agentarena init-taskpack` for starter task packs
- `agentarena init-ci` for GitHub Actions benchmark workflows

### Report outputs

Every run can generate:

- `summary.json`
- `summary.md`
- `report.html`
- `pr-comment.md`
- `badge.json`

### Judge coverage

Current built-in judge types include:

- `command`
- `test-result`
- `lint-check`
- `file-exists`
- `file-contains`
- `regex-match`
- `directory-exists`
- `compilation`
- `glob`
- `file-count`
- `snapshot`
- `json-value`
- `json-schema`
- `patch-validation`
- `token-efficiency`

### Adapter coverage

| Adapter | Status | Notes |
| --- | --- | --- |
| `codex` | usable | configurable model + reasoning effort |
| `claude-code` | usable | auth-aware failure reporting |
| `cursor` | usable | local bridge, auth-sensitive |
| `gemini-cli` | usable | token and cost parsing |
| `aider` | usable | multi-model support |
| `copilot` | usable | token estimation |
| `qwen-code` | usable | JSON output parsing |
| `kilo-cli` | usable | OpenCode-based |
| `opencode` | usable | multi-provider open source CLI |
| `trae` | usable | event stream parsing |
| `augment` | usable | multi-model support |
| `windsurf` | blocked | auth stability issues |
| `demo-fast` / `demo-thorough` / `demo-budget` | built-in | no external setup required |

> **Note**: "usable" means the adapter can run normally, but may be sensitive to local auth state, CLI version changes, or install layout. See [Adapter Capabilities](./docs/adapter-capabilities.md) for detailed tier definitions.

## Quick Start

### Path A: benchmark the local agent you already use

```bash
pnpm install
pnpm build
pnpm doctor
node packages/cli/dist/index.js ui
```

Then open the local address printed in the terminal, usually:

```text
http://127.0.0.1:4320
```

From there:

1. choose the repository you want to benchmark
2. choose a task pack
3. choose one or more local agents you already use
4. run the benchmark
5. inspect the result in the same UI

### Path B: get a single-agent baseline from the CLI

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents codex --output .agentarena/manual-run
```

This is the simplest "how strong is my current local Codex setup?" path.

### Path C: compare multiple local agents on one task

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents codex,claude-code,cursor --output .agentarena/manual-run
```

### Path D: fast product tour without external auth

```bash
pnpm demo
node packages/cli/dist/index.js ui
```

Use the built-in demo adapters when you want to verify the product flow before benchmarking real agents.

## Common Commands

Check local adapter readiness:

```bash
pnpm doctor
```

List adapters and capability metadata:

```bash
node packages/cli/dist/index.js list-adapters --json
```

Fail fast when one requested adapter is not ready:

```bash
node packages/cli/dist/index.js doctor --agents codex,claude-code,cursor --probe-auth --strict
```

Return machine-readable benchmark output:

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents codex --json
```

Generate a starter YAML task pack:

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output agentarena.taskpack.yaml
```

Generate a benchmark workflow for GitHub Actions:

```bash
node packages/cli/dist/index.js init-ci --task agentarena.taskpack.yaml --agents codex,claude-code
```

Run the browser-level web-report smoke test:

```bash
npx playwright install --with-deps chromium
pnpm test:web-report:e2e
```

## Official Task Pack Library

Starter templates:

- `repo-health`
- `json-api`
- `snapshot`
- `compilation-check`
- `directory-structure`
- `full-e2e`

Official task packs live under [`examples/taskpacks/official/`](./examples/taskpacks/official/README.md).

## Repository Layout

```text
apps/
  web-report/          Interactive benchmark UI (vanilla JS, PWA)
packages/
  cli/                 CLI entry point (ui, run, doctor, init-taskpack, init-ci)
  core/                Shared types and utilities
  runner/              Benchmark orchestrator
  adapters/            Agent adapters and registry
  judges/              Judge implementations
  taskpacks/           Task pack loader and validator
  trace/               Execution trace recorder and replay helpers
  report/              Report generators (JSON, Markdown, HTML, badge)
examples/
  taskpacks/           Demo and official task packs
fixtures/
  nodejs-monorepo/     Standard test repository
docs/
```

## Documentation

- [Project overview](./docs/overview.md)
- [Benchmark fairness](./docs/fairness.md)
- [Adapter capabilities](./docs/adapter-capabilities.md)
- [Task pack modes](./docs/taskpack-modes.md)
- [Web report app](./apps/web-report/README.md)
- [Runner Docker](./docs/runner-docker.md)
- [Official task packs](./examples/taskpacks/official/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
