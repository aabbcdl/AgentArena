# Stability Declaration

AgentArena has entered stabilization. The core feature set is complete and the focus shifts to reliability, test coverage, and documentation.

## What is frozen

- **Adapters**: New adapter work is paused while the current set is stabilized. Existing adapters remain available; none are removed by this policy.
- **Judge types**: No new judge types. The 15 current types cover the validation surface.
- **Scoring formula**: The 6 score modes and their weight presets are locked. No changes to `computeCompositeScore` behavior.
- **CLI commands**: The command set (run, doctor, ui, init-taskpack, init-ci, list-adapters, clean) is final.

## What is stable (public API)

These interfaces are committed and will not break without a major version bump:

- `@agentarena/core` exported types: `BenchmarkRun`, `TaskPack`, `AgentAdapter`, `AdapterExecutionResult`, `JudgeResult`, `TaskJudge`
- CLI flags and exit codes
- HTTP API shape (as tested by `tests/contracts-http-api.test.mjs`)
- TaskPack schema version `agentarena.taskpack/v1`
- Trace event JSONL format
- Report output files: `summary.json`, `summary.md`, `report.html`, `badge.json`, `pr-comment.md`

## Allowed changes

- Bug fixes
- Documentation improvements
- Test additions and hardening
- Dependency updates (security patches, minor bumps)
- Performance improvements that don't change behavior
- Accessibility improvements in web-report

## Not allowed without discussion

- New features or commands
- New adapters or judge types
- Changes to scoring formulas or weight presets
- Breaking changes to any stable API surface
- New package dependencies (prefer using what's already available)

## Adapter stabilization policy

The adapter freeze is a reliability decision, not a claim that the current set is permanently complete. External CLIs change authentication, output formats, commands, and installation layouts outside AgentArena's control. Adding more integrations before the existing paths are measurable would increase catalog size without increasing trustworthy coverage.

New adapter proposals reopen only when:

- supported adapters have repeatable doctor, authentication, and controlled-task verification;
- output format changes and missing data are surfaced instead of silently scored;
- the default Demo journey completes reliably;
- critical paths have Windows, macOS, and Linux evidence or an explicit platform limitation;
- the proposed adapter has demonstrated user demand and a maintenance owner.

The following adapters remain experimental and may depend on local login state or upstream behavior:

claude-code, cursor, aider, augment, copilot, gemini-cli, kilo-cli, opencode, qwen-code, trae, windsurf (blocked)

See [Product direction](./docs/product-direction.md) for the reopening and legacy-exit gates.
