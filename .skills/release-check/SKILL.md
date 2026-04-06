---
name: release-check
description: Run release-readiness checks and return a go/no-go verdict. Use when preparing a new version, asking whether the project can ship, or checking for blockers.
---

# Release Check

Run release gates and return a **READY** or **HOLD** verdict with concrete blockers and unverified risk.

## When to Use

- Preparing a new version tag or release.
- Asking whether the current state is safe to ship.
- Checking for blockers before merging a large change set.

## Steps

1. Inspect changed files: `git status --short`.
2. Run automated gates:
   - `pnpm build` — must succeed with 0 errors.
   - `pnpm test` — must pass with 0 failures.
3. Run project-specific gates (use `$code-review` for detailed checks):
   - Scoring consistency: all weight presets sum to 1.0, single source of truth.
   - Judge system: all types return `critical` with a boolean default.
   - CLI: `--score-mode` validation matches scoring modes exactly.
   - Web report: builds, i18n keys complete in both languages.
4. Check for common release pitfalls:
   - No sensitive data in console output.
   - No dead exported functions.
   - No accumulated `test.skip` entries.
5. Report in decision form:
   - Start with **READY** or **HOLD**.
   - List blockers with evidence, what was verified, and what remains unverified.
   - Do not claim READY if build or tests were not actually run.

## Stop Conditions

- Build or tests fail.
- Any weight preset sums to != 1.0.
- Web report doesn't build.
- CLI accepts a score mode that scoring doesn't handle.
