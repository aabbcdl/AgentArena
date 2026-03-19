# Changelog

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
- 8 judge types: command, file-exists, file-contains, glob, file-count, snapshot, json-value, json-schema
- 9 official task packs across 3 difficulty tiers (easy, medium, hard)
- Interactive web report with agent comparison, inline detail expansion, cross-run comparison, and trend tracking
- Real-time benchmark progress with live log streaming
- Report outputs: summary.json, summary.md, pr-comment.md, report.html, badge.json
- Bilingual UI (English / 中文)
- PWA offline support
- Keyboard accessibility for comparison tables and bar charts
- GitHub Actions CI with smoke benchmark and PR commenting
