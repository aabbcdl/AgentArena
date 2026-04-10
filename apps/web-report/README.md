# Web Report App

Local browser UI for AgentArena.

## What It Does

- launches benchmarks directly from the browser when opened through `agentarena ui`
- loads `summary.json` files or whole run folders with automatic `summary.md` linking
- compares multiple runs in one place
- shows agent results in sortable tables with inline detail
- highlights the best result, fastest result, lowest known cost, and strongest judge performance
- shows task pack details, live progress, and recent logs while a run is active
- lets you copy summaries, PR tables, and download an SVG share card
- supports English and Chinese
- works on desktop and mobile layouts
- includes offline support through a service worker

## Recommended Usage

### Main path: launch through `agentarena ui`

```bash
pnpm build
node packages/cli/dist/index.js ui
```

Then open the local address shown in the terminal.

In this mode the page can:

- prefill the current repository path
- list official task packs
- list available adapters
- run a benchmark directly from the browser
- switch straight into the report view when the run finishes

This is the main manual workflow. The page is meant to be both the launcher and the report viewer.

### Fallback: open built reports directly

```bash
pnpm --filter @agentarena/web-report build
```

Then open `apps/web-report/dist/index.html` and either:

- load a single `summary.json`
- load a matching `summary.md`
- load the whole `.agentarena/runs/` folder to browse multiple runs

Direct file loading is mainly a fallback path for browsing results that already exist.
