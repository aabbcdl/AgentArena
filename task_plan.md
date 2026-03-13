# RepoArena Task Plan

## Goal
Turn the RepoArena concept into a repo-ready foundation with:
- a founder-ready blueprint
- a launch-quality README draft
- a runnable vertical slice for local benchmarking
- the first published GitHub version

## Assumptions
- The repository started from zero and did not contain product code.
- The immediate need is an executable starting point, not a fake showcase.
- The first implementation should prove the repo-native benchmark loop before real vendor adapters become fully healthy on this machine.

## Phases
| Phase | Status | Notes |
|---|---|---|
| 1. Inspect repo and gather context | complete | Repo started empty and not yet a git repo. |
| 2. Capture plan and findings | complete | Planning files were created to keep execution grounded. |
| 3. Draft product blueprint | complete | Positioning, MVP, architecture, and launch docs are in place. |
| 4. Build runnable vertical slice | complete | Core packages, CLI, adapters, runner, preflight, and report output are implemented. |
| 5. Rename to RepoArena and publish | in_progress | Renaming is being applied across the codebase before the first push. |

## Deliverables
- `README.md`
- `docs/founder-blueprint.md`
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- runnable CLI and workspace packages
- `task_plan.md`
- `findings.md`
- `progress.md`

## Risks
- Over-scoping the MVP into a full hosted benchmark platform too early.
- Positioning the project as "just another benchmark" instead of "repo-native evaluation and replay".
- Letting naming or packaging stay half-renamed across docs and code.

## Guardrails
- Prioritize local-first and repo-native workflows.
- Make fairness and replayability core to the architecture.
- Use demo adapters honestly until more external adapters are fully healthy.
- Keep hosted leaderboard explicitly phase 2, not MVP.
