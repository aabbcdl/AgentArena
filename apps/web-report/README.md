# Web Report App

Local browser UI for RepoArena.

## What It Does

- launches benchmarks directly from the browser when opened through `repoarena ui`
- loads `summary.json` files or whole run folders with automatic `summary.md` linking
- cross-run compare table for browsing multiple benchmark runs
- sortable agent compare table with inline detail expansion, structured test/lint metrics, and diff precision
- horizontal bar charts for visual agent comparison (click or keyboard to select)
- highlights best agent, fastest run, lowest known cost, highest judge pass rate, and diff precision
- task pack detail display with difficulty, differentiator, tags, and judge count
- real-time benchmark progress with live log streaming
- judge search plus type and pass/fail filters
- copy share summaries, PR tables, and download SVG share cards
- bilingual UI (English / 中文) with full i18n coverage
- keyboard accessible — comparison tables and bar charts support Tab/Enter/Space navigation
- responsive mobile layout with collapsible sidebar
- PWA with offline support via service worker

## Usage

### Recommended: launch through `repoarena ui`

```bash
pnpm build
node packages/cli/dist/index.js ui
```

Then open the local address shown in the terminal. In this mode the page can:
- prefill the current repository path
- list official task packs
- list available adapters
- run a benchmark directly from the browser
- switch straight into the report view when the run finishes

This is the main manual workflow. The page is intended to be used as a launcher plus result viewer in one place.

### Fallback: open a built report viewer directly

```bash
pnpm --filter @repoarena/web-report build
```

Then open `apps/web-report/dist/index.html` in a browser and either:
- load a single `summary.json` file from `.repoarena/runs/<run-id>/summary.json`
- load a matching `summary.md`
- load the whole `.repoarena/runs/` folder to browse multiple runs

Direct file loading is mainly a fallback path for browsing existing results or sharing the viewer without the local service mode.
