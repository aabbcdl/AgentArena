# RepoArena Founder Blueprint

## One-line Positioning
RepoArena is the local-first evaluation and replay platform for AI coding agents, built to compare how Claude Code, Codex, Cursor, Devin, and open source agents perform on real tasks inside your own repository.

## Why This Wins
- It rides the coding-agent wave without competing head-on with model vendors.
- It is cross-camp by design, so users of every agent have a reason to care.
- It produces highly shareable artifacts: scorecards, diff replays, and controversial rankings.
- It is naturally extensible through adapters, task packs, judges, and public benchmark datasets.

## Product Thesis
The market does not need one more agent. It needs trusted infrastructure that answers:
- Which agent actually works best in my repo?
- Which one is fastest, cheapest, and most reliable for my task mix?
- What exactly happened during the run?
- Can I replay, audit, and compare the result with confidence?

RepoArena should become the default system of record for repo-native agent evaluation.

## ICP
- Staff and senior engineers evaluating coding agents before wider rollout
- AI tooling teams building or tuning their own agents
- OSS maintainers comparing agent behavior on real issue backlogs
- Content creators, researchers, and developer tool companies publishing benchmark results

## Sharp Wedge
Run multiple coding agents against the same task pack in the same repo, under the same constraints, then export a replayable report that people can trust and share.

## Non-goals For V1
- Building a new general-purpose coding agent
- Becoming a cloud-only benchmark service
- Supporting every IDE and workflow from day one
- Solving enterprise policy, RBAC, or hosted governance in the first release

## MVP

### User Flow
1. Point RepoArena at a local or GitHub repository.
2. Select a task pack.
3. Choose agents to run.
4. Run `repoarena doctor` to inspect adapter readiness.
5. Execute runs in isolated workspaces.
6. Inspect a generated report with outcomes, traces, diffs, cost, and preflight state.

### Must-have Features
- Multi-agent orchestration with a unified runner contract
- Adapter layer for Claude Code, Codex CLI, Cursor CLI, Devin API, and one open source agent
- Task pack format for bug fixes, test repairs, refactors, and small feature work
- Judge plugins for test pass rate, lint status, command success, diff size, and optional human rubric
- Trace recording for prompts, tool calls, patch steps, test runs, and timestamps
- Local HTML report plus machine-readable JSON export
- Cost and token normalization per run
- Adapter preflight checks for missing binaries, auth blockers, and local readiness

### MVP Success Criteria
- A developer can benchmark at least three agents on the same repo within 10 minutes of setup.
- Results are reproducible enough that repeated runs are comparable.
- Report output is shareable without manual editing.
- Community members can add a new adapter or judge without touching the core runner.

## Version 1 Feature Set

### Core Platform
- `repoarena run` CLI
- `repoarena doctor` CLI
- isolated repo workspaces per run
- event-sourced trace log
- results normalization
- static HTML report generator

### First-party Adapters
- Claude Code
- Codex CLI
- Cursor CLI
- Devin API
- OpenHands or equivalent OSS baseline

### First Task Packs
- `bugfix-smoke`
- `fix-failing-tests`
- `small-feature`
- `safe-refactor`

### First Judges
- command exit code
- test suite pass rate
- lint pass rate
- changed files summary
- wall-clock time
- token usage
- estimated dollar cost

### Stretch But Worth It
- PR-style visual diff replay
- benchmark badge for GitHub README usage
- "best value" leaderboard view

## Technical Stack

### Monorepo Choice
- `pnpm` workspace
- TypeScript across CLI, runner, adapters, and report generation
- Node.js 22 LTS

### Suggested Package Layout
```text
apps/
  web-report/          local report UI and static export
packages/
  cli/                 command entrypoint
  core/                run models, contracts, scoring types
  runner/              workspace isolation, process orchestration
  adapters/            built-in and external agent adapters
  judges/              judge plugins
  taskpacks/           canonical tasks and schemas
  trace/               event model, JSONL writer, replay loader
  report/              HTML/JSON/Markdown export
```

### Runtime Architecture
- Use a temp clone or copied workspace per run.
- Apply the same task instructions and repo snapshot to each agent.
- Record all run events to JSONL for deterministic replay.
- Store normalized summary rows in JSON now, SQLite later.
- Render the report from trace plus summary data, not from transient runtime state.
- Run adapter preflight before full execution so blocked environments are explicit.

### Implementation Choices
- `zod` later for schema validation
- simple native-args CLI now, richer parser later
- Node child-process orchestration for external CLIs
- static HTML report first, richer web app second

### Isolation Strategy
- V0: temp directory plus process timeout controls
- V1: optional Docker execution mode for stronger fairness and reproducibility
- Later: hosted runners or remote execution pools

## Scoring Model

### Primary Metrics
- task success
- test pass delta
- wall-clock duration
- token usage
- estimated cost
- files changed
- patch churn
- environment readiness

### Composite Views
- best accuracy
- best value
- fastest successful run
- lowest-cost passing run

### Philosophy
Do not collapse everything into one magic score by default. Show clear primary metrics first, then let users apply weighted views.

## Open Source Design

### What The Community Can Extend
- adapters
- judge plugins
- task packs
- public benchmark suites
- UI renderers
- report themes

### Contribution Strategy
- publish adapter interface early
- include "build your first adapter" guide
- accept community-maintained task packs as separate packages
- keep benchmark results reproducible with trace artifacts

## First Public Story
RepoArena helps developers stop arguing in the abstract about which coding agent is best. Run them in your own repo, under the same conditions, and inspect the exact trace, diff, cost, readiness, and outcome.

That is useful, easy to explain, and built for the internet.
