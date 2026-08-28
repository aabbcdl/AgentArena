# Getting Started

This guide walks you through the current local-pilot path for AgentArena.

## Prerequisites

- **Node.js 22+** — check with `node --version`
- A target repository and the language tools that repository itself needs
- An agent CLI only if you want to run a real external agent

The core AgentArena pilot does not require Android Studio, Docker, Xcode, or a
Playwright browser. Chromium is only needed for browser E2E validation.

> **Windows users**: Use PowerShell or Git Bash. The default `cmd.exe` also works but PowerShell is recommended.

## Install the published CLI

For normal use, install the public CLI package:

```bash
npm install --global @agentarena/cli@0.2.1
agentarena ui
```

Open the local URL printed by the command, normally `http://127.0.0.1:4320`.
On the first startup, Workbench asks you to set a local service password. The
password is saved as a salted hash in the workspace’s `.agentarena/` directory;
you do not need to find a Bearer Token. Later sessions can use the same password
to reconnect.

The published CLI includes the Workbench assets and built-in task packs. You do
not need pnpm, a source build, Android Studio, Docker, Xcode, or Playwright
Chromium for the normal local pilot.

## Install from a source checkout

```bash
pnpm install --frozen-lockfile
pnpm build
```

The source checkout requires the repository’s declared pnpm version. Use this
path when developing AgentArena itself or when you need unbuilt repository
files.

Verify the checkout:

```bash
node packages/cli/dist/index.js doctor --agents demo-fast
```

Start the local-only UI:

```bash
node packages/cli/dist/index.js ui --no-open
```

## Your First Benchmark (No Auth Required)

AgentArena includes built-in demo agents that need no API keys or external setup. This is the fastest way to see it in action.

### 1. Create a demo task pack

```bash
node packages/cli/dist/index.js init-taskpack --template repo-health --output my-task.yaml
```

### 2. Run the benchmark

```bash
node packages/cli/dist/index.js run --repo . --task my-task.yaml --agents demo-fast,demo-thorough
```

This runs two demo agents against the current directory. You'll see live progress in the terminal.

### 3. View the results

```bash
node packages/cli/dist/index.js ui --no-open
```

Open `http://127.0.0.1:4320` in your browser. The UI lets you explore scores, diffs, judge results, and traces.

## Benchmarking Real Agents

Once you've verified the flow works, you can benchmark real coding agents.

### Step 1: Check which agents are available

```bash
node packages/cli/dist/index.js doctor
```

This shows which agent CLIs are installed and whether authentication is working.

### Step 2: Run with real agents

```bash
node packages/cli/dist/index.js run \
  --repo /path/to/your/project \
  --task my-task.yaml \
  --agents codex,claude-code \
  --probe-auth
```

The `--probe-auth` flag checks authentication before running, so you don't waste time on agents that can't connect.

### Step 3: Compare results

After the run, open the UI:

```bash
node packages/cli/dist/index.js ui --no-open
```

Or check the generated files in `.agentarena/runs/<run-id>/`:
- `summary.json` — machine-readable results
- `summary.md` — human-readable report
- `report.html` — interactive HTML report

## Common Workflows

### Create a custom task in Workbench

Open **Plan** and choose **Create custom task**. Enter a natural-language goal,
the target repository, and optionally one or more expected changed paths. The
wizard saves a local draft, runs compatibility checks, and shows a preview
before the task is selected.

The generated build/test/lint checks are only **basic repository-health
evidence**. They do not prove that the natural-language task is correct. A
missing expected-path list is shown as an unconstrained change scope, and a
compatibility failure blocks starting the run. The wizard does not accept
arbitrary shell commands or change the selected provider, model, or Harness.

### Compare multiple agents on one task

```bash
node packages/cli/dist/index.js run \
  --repo . \
  --task my-task.yaml \
  --agents codex,claude-code,cursor,gemini-cli \
  --probe-auth
```

### Use the UI as a launcher

```bash
node packages/cli/dist/index.js ui --no-open
```

The browser UI lets you pick the repo, task pack, and agents interactively. No need to remember CLI flags.

### Generate a CI workflow

```bash
node packages/cli/dist/index.js init-ci --task my-task.yaml --agents codex,claude-code
```

This creates a GitHub Actions workflow that runs benchmarks on every PR.

### Run with JSON output (for scripting)

```bash
node packages/cli/dist/index.js run --repo . --task my-task.yaml --agents demo-fast --json
```

## Understanding the Output

Each benchmark run produces:

| Output | Description |
|--------|-------------|
| `summary.json` | Full results with scores, judge outcomes, and metadata |
| `summary.md` | Human-readable Markdown report |
| `report.html` | Interactive HTML report with charts and diffs |
| `pr-comment.md` | Ready-to-paste PR comment with score table |
| `badge.json` | Shields.io-compatible badge data |

### Scoring

AgentArena computes a composite score (0-100) based on:

- **Test results** — did the agent's changes pass the tests?
- **Judge outcomes** — did custom judges (lint, file checks, etc.) pass?
- **Efficiency** — how fast and cost-effective was the agent?
- **Precision** — how targeted were the changes?

You can adjust the scoring weights with `--score-mode`:
- `practical` (default) — balanced for real-world tasks
- `balanced` — equal emphasis on all dimensions
- `issue-resolution` — SWE-bench style, focused on test passing
- `efficiency-first` — rewards faster, cheaper runs
- `rotating-tasks` — category-aware scoring for diverse task sets
- `comprehensive` — all weight keys enabled, thorough evaluation

## Future release work: publishing to the Community Leaderboard

Community publishing is not part of the current local pilot. The following
section documents a future release gate and should not be used as a setup
requirement.

### Prerequisites

1. A GitHub account
2. A GitHub personal access token with `repo` scope, OR the [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)

### Future publish workflow

After completing a benchmark, publish the results:

```bash
# Publish the most recent run
agentarena publish --last

# Or publish a specific result file
agentarena publish .agentarena/runs/<run-id>/summary.json
```

### Authentication options

The publish command resolves your GitHub token in this order:

1. `--token <token>` flag
2. `GITHUB_TOKEN` environment variable
3. `gh auth token` (GitHub CLI, if installed)

```bash
# Using a token flag
agentarena publish --last --token ghp_your_token_here

# Using an environment variable
GITHUB_TOKEN=ghp_your_token_here agentarena publish --last
```

### What gets published

The publish command uploads a **sanitized** version of your run to the community leaderboard repository. Sensitive data (file paths, environment variables, full diffs) is stripped. Only the following is shared:

- Task pack ID and title
- Agent display labels, model names, and provider names
- Composite scores, pass rates, durations, token usage, and costs
- Score mode and run timestamp
- Your GitHub username (as publisher)

### Custom leaderboard repository

By default, results are published to the `agentarena/leaderboard-data` repository. You can override this for private leaderboards:

```bash
AGENTARENA_COMMUNITY_OWNER=your-org AGENTARENA_COMMUNITY_REPO=your-leaderboard agentarena publish --last
```

### Future community leaderboard

Open the web UI and switch to the **Community** tab to see aggregated results from all published runs:

```bash
node packages/cli/dist/index.js ui --no-open
```

## Next Steps

- [Troubleshooting](./troubleshooting.md) — common issues and fixes
- [Task Pack Reference](./taskpack-modes.md) — how to write custom task packs
- [Adapter Capabilities](./adapter-capabilities.md) — what each agent adapter supports
- [Scoring Deep Dive](./scoring.md) — how scores are computed
- [HTTP API](./http-api.md) — programmatic access to the UI server
