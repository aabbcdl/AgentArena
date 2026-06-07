# ADR-004: Web Report State Management Architecture

**Status:** Accepted
**Date:** 2026-06-07
**Deciders:** Original author

## Context

The web-report SPA (`apps/web-report/src/`) uses a vanilla JS architecture with no framework, no bundler, and no formal state management. A shared mutable `state` object is read and written by 15+ modules. This document explains the architecture so maintainers understand the implicit contracts.

## Decision

### 1. State Object

**File:** `apps/web-report/src/app-state.js`

The `state` object has 42+ fields and is the single source of truth for the entire SPA. It is a plain JavaScript object (not frozen, not observed, no change tracking).

Key fields:
- `run` — current loaded benchmark run data
- `runs` — array of all loaded runs
- `launcherExpanded` — launcher panel visibility
- `selectedAgentId` / `selectedRunId` — current selection
- `communityData` — community benchmark data
- `_communityRequestId` — staleness guard for community fetches

### 2. Module Communication Pattern

Modules communicate through **direct mutation of `state` + explicit `render()` calls**. There is no event bus, no pub/sub, no reactive system.

```
app.js ──state──> launcher/module.js
app.js ──state──> report/dashboard.js
app.js ──state──> selection-handlers.js
app.js ──state──> results/loaders.js
```

Each module receives `state` as a constructor dependency and can mutate any field at any time.

### 3. Render Order Dependency

**File:** `apps/web-report/src/app.js` → `render()` function

The `render()` function calls sub-renderers in a specific order:

1. `renderStaticText()` — i18n text for static elements
2. `renderLauncher()` — launcher panel
3. `renderRunList()` — run list sidebar
4. `renderDashboard()` — main dashboard
5. `renderCommunityView()` — community tab

**This order matters:** downstream renderers may read DOM elements created by upstream renderers. Reordering can cause null references or stale state.

### 4. DI Contract

Modules are created via factory functions with explicit dependency injection:

- `createDashboardModule(deps)` — 26 dependencies (JSDoc-documented, no runtime validation)
- `createLauncherModule(deps)` — 18 dependencies
- `createDetailFragments(deps)` — varies
- `createTraceReplayModule(deps)` — varies

**Fragility:** If any dependency is missing, rendering silently produces `undefined` in HTML. The construction site in `app.js` must manually match each module's expected deps.

### 5. Data Persistence Race

Two independent persistence paths exist:

1. **localStorage** — `saveLauncherConfig()` in launcher module, writes immediately
2. **IndexedDB** — `persistCachedRuns()` in `result-cache.js`, debounced writes

Both call `applyRuns()` → `render()` on restore. If IndexedDB restore is slow, it fires AFTER the initial render, causing a second render with potentially different data.

### 6. Dual Variant System

The launcher has two parallel variant rendering systems:

1. **Generic system** (`VARIANT_CONFIGS` array) — Codex, Gemini, Aider, Kilo, OpenCode
   - Array-driven, uses `renderGenericVariantSection()` / `renderGenericVariantCard()`
2. **Claude-specific system** — Claude Code variants
   - Separate rendering (`renderClaudeVariants`)
   - Separate sync (`syncClaudeVariantsWithProfiles`)
   - Separate provider editor

These systems share no common abstraction. `syncLauncherStateFromDom()` has dedicated Claude logic alongside a generic loop.

### 7. Element Cache

**File:** `apps/web-report/src/app-elements.js`

All DOM element references are captured at module load time via `document.querySelector()`. If any critical element is missing from the HTML (due to CSS class change, DOM restructuring), the reference is `null` and the entire app crashes at initialization with "Cannot read properties of null".

### 8. Global Window Exposure

On localhost, `window.state`, `window.applyRuns`, and `window.loadDemoData` are exposed for debugging. Direct mutation of `window.state` bypasses all state synchronization logic.

## Consequences

- Any module can break any other module by mutating state at the wrong time
- Render order is a hidden invariant — documented only in a comment
- The 42-field state object makes it impossible to trace which module owns which field
- DI contracts are documented in JSDoc but not validated at runtime
- IndexedDB and localStorage restores can race each other
- The dual variant system means adding a new adapter requires understanding both systems

## Recommendations for Future Maintainers

1. When changing render order, test all tabs/views thoroughly
2. When adding a new adapter variant, determine which variant system it belongs to
3. When modifying state fields, grep for all modules that read/write that field
4. Never assume `elements.*` is non-null — check or add guards
5. When debugging persistence issues, check both localStorage and IndexedDB
