# RepoArena

> The local-first arena for evaluating AI coding agents in real repositories.

[中文说明](./README.zh-CN.md)

RepoArena lets you run Claude Code, Codex, Cursor, Devin, and open source agents against the same repository tasks, then compare success rate, duration, cost, diffs, and replay traces in one report.

The primary manual entry point is `repoarena ui`: a local service mode that lets you choose a repository, task pack, and agents from the browser, run the benchmark, and inspect the result in the same UI. Opening `summary.json` files directly is now a fallback path for existing results, not the main workflow.

Task packs use a versioned schema. The current format is `repoarena.taskpack/v1`, with structured `judges` definitions for command, file, glob, snapshot, and JSON evaluation. Both JSON and YAML task packs are supported.

## What It Does

- Runs multiple coding agents against the same task pack
- Records traces and file changes in isolated workspaces
- Evaluates outcomes with shared checks
- Exports JSON, Markdown, and HTML reports
- Exports a dedicated `pr-comment.md` summary for CI comments
- Exports a `badge.json` endpoint for report artifacts and status badges
- Surfaces environment and authentication blockers before a benchmark starts

## Current Status

This repository already contains a runnable prototype with:
- a local `repoarena ui` entry point for launching and viewing benchmarks
- a local `repoarena run` CLI
- a local `repoarena doctor` CLI
- a local `repoarena init-taskpack` CLI
- a local `repoarena init-ci` CLI
- built-in demo adapters
- a working `codex` adapter
- `claude-code` and `cursor` adapters with auth-aware failure reporting
- static HTML and JSON report generation
- Markdown summaries for CI, PR comments, and sharing
- an interactive `apps/web-report` UI that can either run local benchmarks through `repoarena ui` or open existing reports
- real-time benchmark progress feedback with live log streaming in the UI
- task pack detail display including difficulty, differentiator, and judge checks
- GitHub Actions smoke benchmarks that can comment results on pull requests
- GitHub Actions CI with a smoke benchmark run
- a browser-level web-report smoke test in CI
- an optional Docker runner image for more reproducible local execution

## Quick Start

### Recommended: local UI mode

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js ui
```

Then open the local address printed in the terminal, usually:

```text
http://127.0.0.1:4317
```

First run:
1. start `repoarena ui`
2. choose the repository, task pack, and one or more real agents or Codex variants
3. run the benchmark and inspect the result in the same page

### Fallback: CLI-first workflow

If you want to script runs directly:

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --output .repoarena/manual-run
```

That command writes a run directory and generates:
- `summary.json`
- `summary.md`
- `pr-comment.md`
- `report.html`
- `badge.json`

Check adapter readiness:

```bash
pnpm doctor
```

List all available adapters:

```bash
node packages/cli/dist/index.js list-adapters --json
```

Fail fast when any requested adapter is not fully ready:

```bash
node packages/cli/dist/index.js doctor --agents codex,claude-code,cursor --probe-auth --strict
```

Update snapshot fixtures during a benchmark run:

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --update-snapshots
```

Return a machine-readable run summary:

```bash
node packages/cli/dist/index.js run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --json
```

Generate a starter YAML task pack:

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output repoarena.taskpack.yaml
```

Generate a benchmark workflow for GitHub Actions:

```bash
node packages/cli/dist/index.js init-ci --task repoarena.taskpack.yaml --agents demo-fast,codex
```

Run the Codex adapter:

```bash
pnpm demo:codex
```

Run the full local arena pass:

```bash
pnpm demo:arena
```

Run the browser-level web-report smoke test (after installing Playwright Chromium):

```bash
npx playwright install --with-deps chromium
REPOARENA_RUN_BROWSER_SMOKE=1 pnpm test:web-report:e2e
```

## Badge

Each run generates a `badge.json` in the output directory. Publish it to any static host and use a Shields endpoint badge:

```markdown
![RepoArena](https://img.shields.io/endpoint?url=https://your-host.example/repoarena/badge.json)
```

## Task Pack Schema

RepoArena currently supports `repoarena.taskpack/v1`.

Supported task pack file formats:
- `.json`
- `.yaml`
- `.yml`

Built-in starter templates:
- `repo-health`
- `json-api`
- `snapshot`

Official task pack library:

**Easy:**
- `examples/taskpacks/official/repo-health.yaml`
- `examples/taskpacks/official/config-repair.yaml`
- `examples/taskpacks/official/snapshot-fix.yaml`

**Medium:**
- `examples/taskpacks/official/failing-test-fix.yaml`
- `examples/taskpacks/official/json-contract-repair.yaml`
- `examples/taskpacks/official/small-refactor.yaml`

**Hard:**
- `examples/taskpacks/official/multi-file-rename.yaml`
- `examples/taskpacks/official/cross-module-refactor.yaml`
- `examples/taskpacks/official/performance-optimize.yaml`

Each task pack defines:
- repository task metadata
- a single benchmark prompt
- an optional task-level `envAllowList`
- optional `setupCommands`
- a list of structured `judges`
- optional `teardownCommands`

Built-in judge types:
- `command`
- `test-result`
- `lint-check`
- `file-exists`
- `file-contains`
- `glob`
- `file-count`
- `snapshot`
- `json-value`
- `json-schema`

Command judges can define:
- `id`
- `label`
- `type: "command"`
- `command`
- optional `cwd`
- optional `timeoutMs`
- optional step-level `envAllowList`
- optional inline `env`

Structured quality judges can define:
- `type: "test-result"` with `command`, optional `format`, optional `reportFile`, optional `passOnNoTests`
- `type: "lint-check"` with `command`, optional `format`, optional `reportFile`, optional `maxWarnings`

File judges can define:
- `type: "file-exists"` with `path`
- `type: "file-contains"` with `path`, `pattern`, optional `regex`, optional `flags`
- `type: "glob"` with `pattern`, optional `minMatches`, optional `maxMatches`
- `type: "file-count"` with `pattern` and one or more of `equals`, `min`, `max`
- `type: "snapshot"` with `path` and `snapshotPath`

JSON judges can define:
- `type: "json-value"` with `path`, `pointer`, and `expected`
- `type: "json-schema"` with `path` and either inline `schema` or `schemaPath`

Environment handling is allowlist-based. Task packs can expose specific host variables through `envAllowList`, and each setup/judge/teardown step can further extend that allowlist or inject inline `env` overrides. Agent execution still receives the task-level filtered environment.

Task packs can also define optional `expectedChangedPaths` globs. RepoArena uses these to compute a `diffPrecision` signal so reports can distinguish targeted edits from scope creep.

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
  web-report/          Interactive benchmark UI (vanilla JS, PWA)
packages/
  cli/                 CLI entry point (ui, run, doctor, init-taskpack, init-ci)
  core/                Shared types and utilities
  runner/              Benchmark orchestrator
  adapters/            Agent adapters (demo, codex, claude-code, cursor)
  judges/              Judge implementations (command, file, glob, snapshot, json)
  taskpacks/           Task pack loader and validator
  trace/               Execution trace recorder
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
- [Task pack modes](./docs/taskpack-modes.md) - Standard vs User repository
- [Web report app](./apps/web-report/README.md)
- [Runner Docker](./docs/runner-docker.md)
- [Official task packs](./examples/taskpacks/official/README.md)
- [YAML task pack example](./examples/taskpacks/demo-repo-health.yaml)
- [Standard test repository](./fixtures/nodejs-monorepo/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
