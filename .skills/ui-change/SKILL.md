---
name: ui-change
description: Modify the web report UI. Use when adding/changing dashboard views, scoring selectors, share buttons, code review panels, cost calculators, i18n strings, or any visual element.
---

# Web UI Change

Modify the single-page web report UI. This is a vanilla JS SPA with no framework dependency.

## When to Use

- Adding a new dashboard section (e.g. a new visualization or control panel).
- Changing score-related UI (presets, sliders, weight displays).
- Adding or modifying i18n strings.
- Styling adjustments or responsive fixes.
- Adding export/share functionality.

## Architecture

| File | Role |
|------|------|
| `apps/web-report/src/index.html` | Static HTML skeleton |
| `apps/web-report/src/styles.css` | All styles (uses CSS custom properties: `--space-*`, `--border`, `--surface`, `--accent`, etc.) |
| `apps/web-report/src/app.js` | Main entry: state management, event binding, i18n, navigation |
| `apps/web-report/src/view-model.js` | Data transformations, score calculations, weight presets |
| `apps/web-report/src/report/dashboard.js` | Dashboard module orchestration |
| `apps/web-report/src/report/detail-fragments.js` | Individual detail section renderers |
| `apps/web-report/src/i18n.js` | Translation dictionaries (`en` + `zh-CN`) |
| `apps/web-report/src/results/loaders.js` | Result loading logic |

## Steps

1. When adding a new UI section:
   - Add HTML to `index.html` in the appropriate section.
   - Add styles to `styles.css` using existing design tokens (no hardcoded colors/spacing).
   - Add a renderer in `detail-fragments.js` and call it from `dashboard.js`.
   - Wire up state and events in `app.js`.
   - Add i18n keys to BOTH `en` and `zh-CN` in `i18n.js`.

2. When modifying score-related UI:
   - **Critical**: `DEFAULT_SCORE_WEIGHTS` and `SCORE_WEIGHT_PRESETS` in `view-model.js` MUST match `packages/report/src/scoring.ts` exactly.
   - When adding a new score mode, update: `view-model.js` presets, launcher dropdown, preset buttons, `i18n.js` labels.

3. Build: `cd apps/web-report && node scripts/build.mjs` or `pnpm build` from root.

4. Verify by opening `apps/web-report/dist/index.html` in a browser and loading a `summary.json`.

## What to Check Before Committing

- Scoring weights in `view-model.js` match `scoring.ts` exactly.
- Every i18n key exists in both `en` and `zh-CN`.
- No hardcoded colors or spacing values — use CSS custom properties.
- Build succeeds and the dist HTML loads a local `summary.json` without errors.
