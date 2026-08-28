# AgentArena

> Run the coding agents you already use against the same repository, task, and judges—and inspect the evidence behind the result.

[中文说明](./README.zh-CN.md) · [npm package](https://www.npmjs.com/package/@agentarena/cli) · [Getting Started](./docs/getting-started.md)

![AgentArena Workbench](./docs/images/web-report-launcher.jpg)
![AgentArena report](./docs/images/web-report-report.jpg)

AgentArena is a local-first benchmark and replay tool for real coding-agent work. It is built for the question that comes after “how do I install an agent?”:

> Which local agent, model, and runtime setup actually performs better on the repository tasks I care about?

AgentArena gives each run the same repository snapshot, task definition, setup commands, and judges. It then records the diff, judge evidence, trace, runtime identity, and report so a result can be inspected instead of trusted on appearance alone.

The current public release is **0.2.1**, aimed at a local pilot. It is not a hosted service or a universal leaderboard.

## Install and start

Requirements:

- Node.js **22 or newer**
- A target repository and whatever toolchain that repository needs
- An external agent CLI only when you want to benchmark a real external agent

Install the published CLI:

```bash
npm install --global @agentarena/cli@0.2.1
agentarena ui
```

Open the local address printed by the command, normally `http://127.0.0.1:4320`.

On the first startup, Workbench asks you to choose a local service password. Pick your own password (at least four characters). Only a salted password hash is saved under the workspace’s `.agentarena/` directory; you do not need to find or paste a Bearer Token during normal use. Later browser sessions may ask for the same password again. The password is local to that workspace—there is no shared default password.

For scripts or an intentionally managed local setup, `--auth-token`, `AGENTARENA_LOCAL_AUTH_TOKEN`, and `AGENTARENA_AUTH_TOKEN` remain available. Keep the UI bound to loopback unless you have deliberately designed a stronger network boundary.

## First run without external authentication

You can verify the complete product flow with the built-in demo agents:

```bash
agentarena init-taskpack --template repo-health --output agentarena-task.yaml
agentarena run \
  --repo . \
  --task agentarena-task.yaml \
  --agents demo-fast,demo-thorough
agentarena ui
```

This uses no API key and no external provider. In Workbench, you can also use the Safe Demo action to confirm the launch, live status, result, diff, and evidence pages before connecting a real agent.

## Benchmark a real local agent

Install and log in to only the agent CLI you intend to test. Then check readiness:

```bash
agentarena doctor --agents codex --probe-auth
```

From Workbench:

1. Choose the target repository and task pack.
2. Select a Harness that is installed, logged in, and marked ready.
3. For Codex, review the detected CLI model and reasoning effort, or enter them manually before saving the run configuration.
4. Start the run and follow the live status.
5. Inspect the conclusion, judge breakdown, changed files, trace, and evidence.

The UI does not silently connect a provider, change a global CLI configuration, or switch your model. Codex model discovery is intentionally conservative: the CLI does not provide a stable portable model-enumeration contract, so AgentArena reads the active local default when available and also accepts a manually entered model name.

The equivalent CLI flow is:

```bash
agentarena run \
  --repo /path/to/your/project \
  --task /path/to/your/task.yaml \
  --agents codex \
  --probe-auth
```

## Create a custom task in Workbench

Open **Plan → Create custom task** and enter:

- a natural-language goal;
- the target repository;
- optional expected changed paths.

AgentArena saves a local draft, checks task/repository compatibility, and shows a preview before the task is selected. The generated build/test/lint checks are **basic repository-health evidence**. They do not prove that a natural-language task is functionally correct. If expected paths are omitted, the UI explicitly marks the change scope as unconstrained. Arbitrary shell commands are not accepted in the first version.

## Read results correctly

A run can finish successfully without proving that the requested product behavior is correct. AgentArena separates three kinds of evidence:

- **Runtime readiness** — whether the selected Harness can perform a controlled edit in the current repository context.
- **Task compatibility** — whether the task pack and repository have known structural conflicts.
- **Task result evidence** — judges, tests, diff scope, trace, and the final report for this run.

The report also shows whether model identity, receipt, and result evidence are confirmed, declared, missing, or stale. Unknown token or cost data remains unknown; it is not displayed as zero or free.

One agent is enough to establish a repeatable baseline. Multiple agents do not automatically make a weak task more meaningful: a comparison is useful only when the task, repository baseline, judges, model parameters, and evidence quality are comparable. A single run normally produces a baseline, not a winner.

## Current product surface

### Main commands

```bash
agentarena ui                         # local Workbench and report viewer
agentarena run --repo . --task task.yaml --agents demo-fast
agentarena doctor --agents codex --probe-auth
agentarena list-adapters --json
agentarena init-taskpack --template repo-health --output task.yaml
agentarena init-ci --task task.yaml --agents codex
```

When a UI workspace must be explicit:

```bash
agentarena ui --workspace-root /path/to/workspace
```

Without this option, the current working directory remains the workspace boundary.

### Adapter tiers

The default Workbench surface focuses on the integrations that have a defined local pilot path:

| Adapter | Tier | Notes |
| --- | --- | --- |
| `demo-fast` / `demo-thorough` / `demo-budget` | supported | Built in; no external login required |
| `codex` | supported | Codex CLI stream, configurable model and reasoning effort |
| `claude-code` | experimental | Requires a compatible local CLI and login |

Additional adapters remain available for explicit CLI experiments, but are not presented as first-version stable integrations:

| Adapter | Tier |
| --- | --- |
| `cursor`, `gemini-cli`, `aider`, `copilot` | experimental |
| `kilo-cli`, `opencode`, `qwen-code`, `trae`, `augment` | experimental |
| `windsurf` | blocked |

See the [adapter capability matrix](./docs/adapter-capabilities.md) for invocation, token, cost, and trace details.

### Judges and artifacts

Built-in judge types include `command`, `test-result`, `lint-check`, `file-exists`, `file-contains`, `regex-match`, `directory-exists`, `compilation`, `glob`, `file-count`, `snapshot`, `json-value`, `json-schema`, `patch-validation`, and `token-efficiency`.

Runs can produce:

- `summary.json` — machine-readable results;
- `summary.md` — human-readable summary;
- `report.html` — interactive report;
- `pr-comment.md` — ready-to-paste PR comment;
- `badge.json` — badge data.

## Official task pack library

<!-- official-taskpacks:start -->

The first-release comparison catalog contains **10** core task packs. 20 historical/experimental packs remain in the repository but are excluded from first-release comparison.

| Task pack | Name | Purpose |
| --- | --- | --- |
| `add-feature-with-tests` | Add a Memoization Helper | Add a small reusable memoization feature and cover its observable contract. |
| `config-repair` | Repair Typed Configuration | Correct a small JSON configuration while preserving unrelated values. |
| `cross-file-refactor` | Extract the Slugify Module | Move a shared string helper into its own module without changing callers. |
| `failing-test-fix` | Fix the Failing Arithmetic Test | Correct one calculator operation while preserving the rest of the arithmetic API. |
| `input-validation` | Restore Input Validation Boundaries | Block script injection and path traversal while preserving useful input errors. |
| `json-contract-repair` | Repair a JSON Response Contract | Restore a deterministic response fixture to its documented shape. |
| `logging-improvement` | Improve Structured Logging | Restore log levels, context propagation, and child logger behavior. |
| `repo-health` | Repair Word Capitalization | Restore word-level capitalization without disturbing neighboring helpers. |
| `snapshot-fix` | Restore Deterministic Snapshot Output | Fix a generator so its stable text output matches the fixture contract. |
| `test-coverage` | Add Focused Validator and Logger Tests | Add meaningful tests for two previously uncovered modules and prove they catch a mutation. |

<!-- official-taskpacks:end -->

## Source checkout and development

The npm package is the fastest path for users. To work on AgentArena itself:

```bash
git clone https://github.com/aabbcdl/AgentArena.git
cd AgentArena
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

The source checkout requires the repository’s declared `pnpm` version. It does not require Android Studio, Docker, Xcode, or Playwright Chromium for the core local pilot. Chromium is only needed for browser E2E validation.

Useful checks:

```bash
pnpm typecheck
pnpm lint
pnpm taskpacks:check
pnpm test:web-report:e2e
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [UI and adapter behavior](./docs/ui-and-adapters.md)
- [Adapter capabilities](./docs/adapter-capabilities.md)
- [Benchmark fairness](./docs/fairness.md)
- [Task pack modes](./docs/taskpack-modes.md)
- [Scoring](./docs/scoring.md)
- [HTTP API](./docs/http-api.md)
- [Official task packs](./examples/taskpacks/official/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
