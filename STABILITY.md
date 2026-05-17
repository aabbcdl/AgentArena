# Stability Declaration

AgentArena has entered stabilization. The core feature set is complete and the focus shifts to reliability, test coverage, and documentation.

## What is frozen

- **Adapters**: No new adapters will be accepted. The current set (demo-fast, demo-thorough, demo-budget, codex, claude-code, cursor, gemini-cli, aider, copilot, kilo-cli, opencode, qwen-code, trae, augment, windsurf) is final.
- **Judge types**: No new judge types. The 15 current types cover the validation surface.
- **Scoring formula**: The 6 score modes and their weight presets are locked. No changes to `computeCompositeScore` behavior.
- **CLI commands**: The command set (run, doctor, ui, init-taskpack, init-ci, list-adapters) is final.

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

## Experimental adapters

The following adapters have `supportTier: "experimental"` and may have incomplete functionality. They are frozen as-is — no further development, but also no removal:

claude-code, cursor, aider, augment, copilot, gemini-cli, kilo-cli, opencode, qwen-code, trae, windsurf (blocked)
