---
name: web-report-architecture
description: Understand the vanilla JS web-report app structure, patterns, and contribution guidelines. Use when modifying the UI, adding new views, or fixing frontend bugs.
---

# Web Report Architecture

The web-report app (`apps/web-report/`) is a **vanilla JavaScript PWA** — no Angular, React, or framework. It uses native web components and a simple MVVM-like pattern.

## When to Use

- Adding a new page or view to the benchmark UI.
- Modifying existing UI components.
- Fixing a frontend bug.
- Understanding how the UI communicates with the backend.

## Directory Structure

```
apps/web-report/src/
├── index.html              # Entry point shell
├── app.js                  # App initialization and routing
├── components/             # Reusable UI widgets
│   ├── charts.js           # Chart rendering
│   └── task-pack-market.js # Task pack browsing component
├── view-model/             # Data transformation for UI display
│   ├── community.js        # Community runs view logic
│   └── scoring.js          # Scoring display logic
├── core/                   # Core application services
│   ├── router.js           # Client-side routing
│   ├── state.js            # Application state management
│   ├── judge-registry.js   # Judge type definitions for display
├── utils/
│   └── storage.js          # Local storage helpers
```

## Key Patterns

### Components

Components are plain JS modules that export functions or classes. They manipulate the DOM directly:

```js
// components/example.js
export function renderExample(container, data) {
  container.innerHTML = `
    <div class="example-card">
      <h3>${data.title}</h3>
      <p>${data.description}</p>
    </div>
  `;
}
```

### View-Models

View-models transform raw benchmark data for display. They handle formatting, filtering, and sorting:

```js
// view-model/scoring.js
export function formatScoreTable(runs) {
  return runs
    .sort((a, b) => b.score - a.score)
    .map(run => ({
      rank: ...,
      agent: run.agentId,
      score: run.score.toFixed(1),
      duration: formatDuration(run.durationMs)
    }));
}
```

### Routing

The router at `core/router.js` maps URL hash fragments to view renderers:

```js
// Pattern: hash-based routing
// #runs → runs list view
// #run/<id> → single run detail
// #compare → comparison view
```

### State Management

The state module at `core/state.js` holds the current application state and notifies components of changes via a simple pub/sub pattern.

## Design Guidelines

| Rule | Reason |
|------|--------|
| No framework dependencies | Keeps bundle minimal, no build step for the UI |
| Direct DOM manipulation | Simple and debuggable for this scale of app |
| CSS in `index.html` or inline | No CSS preprocessor — keep it simple |
| Data flows down via function params | No complex state management libraries |
| Events bubble up via callbacks | Components call provided handlers, not global events |

## Adding a New View

1. Create the render function in `components/` or a new file.
2. Add the route in `core/router.js`.
3. If data transformation is needed, add a view-model function.
4. If the view needs persistent state, use `utils/storage.js`.

## Communication with Backend

The web-report loads benchmark result data from the filesystem (via the CLI server at `packages/cli/src/server.ts`). It reads `.agentarena/runs/` directories and `summary.json` files. There is no database — it's file-based.

## What to Check Before Committing

- The new view works with real benchmark data (run `pnpm demo` first to generate data).
- No hardcoded strings in UI — use the existing i18n pattern (if adding text).
- The page loads with JavaScript disabled? Not required — it's an app, not a docs site.
- Component function signatures match how they're called from router/state.
