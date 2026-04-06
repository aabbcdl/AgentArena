# Changelog

## [Unreleased] - 2026-04-05

### Added
- 10 AI coding agent adapters: Cursor, Claude Code, GitHub Copilot, Qwen Code, Windsurf, Aider, Gemini CLI, Kilo CLI, OpenCode, Codex CLI
- 12 judge types: command, test-result, lint-check, file-exists, file-contains, json-value, json-schema, glob, file-count, snapshot, patch-validation, token-efficiency
- 6 scoring modes: practical, balanced, issue-resolution (SWE-Bench inspired), efficiency-first (industry best practices), rotating-tasks (LiveBench inspired), comprehensive
- Decision report generator with scenario-based recommendations and team cost calculator
- Variance analysis module for multi-run statistical reliability
- Web UI: code review view, share/export actions, weight sliders, theme toggle (dark/light), loading states, error recovery
- Run list search/filter and agent click-to-filter
- 8 project skills in .skills/ directory

### Changed
- Unified weight definitions to single source (getDefaultWeights in @repoarena/report)
- Simplified launcher: single Run button replacing Quick Start / Start Benchmark
- Improved light theme contrast for accessibility
- Refined extractTestDetails with unified Jest/Vitest format detection

### Fixed
- 37 code review issues including duplicate judge execution, regex injection protection, consistent critical field defaults, CLI validation alignment, sensitive data protection
- 4 audit findings: dead code documentation, theme contrast, auto-detection robustness, fallback completeness

### Security
- Regex injection protection (flags whitelist + 1000 char limit)
- Sensitive data protection in adapter console output

## Unreleased

### New Features

- `repoarena init` — quick start command: auto-generates demo task pack, detects installed agents, outputs a ready-to-run command
- `repoarena run` now supports `--gemini-model`, `--aider-model`, `--kilo-model`, `--opencode-model` for model configuration
- 4 new agent adapters:
  - **Gemini CLI** (`gemini-cli`) — Google's official terminal agent with JSON event parsing, token usage, and cost reporting
  - **Aider** (`aider`) — open-source pair programming tool with automatic git initialization and multi-model support
  - **Kilo CLI** (`kilo-cli`) — Kilo Code 1.0, built on OpenCode
  - **OpenCode** (`opencode`) — free, multi-provider open-source CLI agent
- Frontend launcher now supports full variant editors for all 4 new agents (model selection, enable/disable, add/remove variants)
- Web report cost comparison now clearly distinguishes agents that support cost reporting
- `biome.json` excludes `launcher/module.js` to avoid false positives with nested template literals

### Bug Fixes

- `isAbortError` now recognizes native `AbortError` in addition to custom `BenchmarkCancelledError`
- `throwIfCancelled` redundant catch block removed
- `createHttpError` replaced type assertion with explicit `HttpError` class
- `leaderboard.ts` eliminated `any` casts and non-null assertions
- `summarizeLauncherSelection` now includes all agent variants in count and preview

## 0.1.0 (2026-03-19)

Initial public release.

### Features

- `repoarena ui` — browser-based benchmark launcher and report viewer
- `repoarena run` — CLI benchmark runner
- `repoarena doctor` — adapter readiness checker with auth probing
- `repoarena init-taskpack` — starter task pack generator
- `repoarena init-ci` — GitHub Actions workflow generator
- `repoarena list-adapters` — adapter capability listing
- Agent adapters: demo-fast, demo-thorough, demo-budget, codex, claude-code, cursor
- 10 judge types: command, test-result, lint-check, file-exists, file-contains, glob, file-count, snapshot, json-value, json-schema
- 9 official task packs across 3 difficulty tiers (easy, medium, hard)
- Interactive web report with agent comparison, inline detail expansion, cross-run comparison, and trend tracking
- Real-time benchmark progress with live log streaming
- Report outputs: summary.json, summary.md, pr-comment.md, report.html, badge.json
- Bilingual UI (English / 中文)
- PWA offline support
- Keyboard accessibility for comparison tables and bar charts
- GitHub Actions CI with smoke benchmark and PR commenting
