# Web Report App

Local launcher and report cockpit for people who already run coding agents locally.

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

## Who It Is For

This page is designed for users who already have one or more coding agents installed locally and want to:

- benchmark their current agent / model setup on a real repo task
- compare multiple local agents side by side
- inspect why a run failed instead of trusting a single score
- keep historical baselines for the same task over time

## Current Page Structure

The page is now organized around the actual benchmark workflow instead of a flat dashboard:

- launcher first: repository, task pack, selected agents, and the primary run action
- open existing results second: file and folder loading as a secondary entry point
- summary third: verdict hero and the headline outcome of the current run
- compare fourth: agent ranking, sort/filter tools, and comparison bars
- diagnostics fifth: judge-driven detail, selected agent breakdown, trace replay, and code review
- history last: run-to-run comparison, cross-run analysis, trends, leaderboard, and supporting context

This keeps the default experience focused on "start a run with your local agents" and "understand this run" before exposing deeper analysis.

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
- keep advanced launch settings collapsed until they are needed
- preserve the selected run, agent, and language across refreshes

This is the main manual workflow. The page is meant to be both the launcher and the report viewer for advanced local-agent users.

### Fallback: open built reports directly

```bash
pnpm --filter @agentarena/web-report build
```

Then open `apps/web-report/dist/index.html` and either:

- load a single `summary.json`
- load a matching `summary.md`
- load the whole `.agentarena/runs/` folder to browse multiple runs

Direct file loading is mainly a fallback path for browsing results that already exist.
