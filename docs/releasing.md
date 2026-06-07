# Releasing

How to cut a release of AgentArena packages to npm.

## Prerequisites

- npm account with publish access to the `@agentarena` scope
- pnpm installed globally
- Clean working tree on `main`

## Branch Strategy

All releases ship from `main`. Feature work happens on short-lived branches merged via PR.

```
main ← feature-branch (squash merge)
main ← release commit (changeset version + publish)
```

## Changeset Flow

We use [changesets](https://github.com/changesets/changesets) to manage versioning.

### 1. Add a changeset during development

```bash
pnpm changeset
```

Select affected packages, choose semver bump level, write a summary. This creates a markdown file in `.changeset/`.

### 2. Version packages

When ready to release, consume all pending changesets:

```bash
pnpm changeset version
```

This updates `package.json` versions and writes `CHANGELOG.md` entries. Review the diff.

### 3. Commit the version bump

```bash
git add .
git commit -m "chore: version packages"
```

## Publishing

### Dry run first

```bash
pnpm changeset status --verbose
pnpm -r publish --dry-run --access public --no-git-checks
```

Verify the package list, versions, and tarball contents look correct. `changeset publish`
does not support a dry-run flag; use `changeset status` for the release plan and
`pnpm publish --dry-run` for package packing validation.

### Publish for real

```bash
pnpm build
pnpm changeset publish
```

This publishes all changed packages to npm with public access.

### Tag and push

```bash
git push origin main --follow-tags
```

Changesets creates git tags automatically during `publish`.

## Linked Packages

All packages in the monorepo are linked (see `.changeset/config.json`). A bump to any package bumps all of them to the same version. This keeps consumers from hitting cross-package version mismatches.

## Rollback

If a bad version is published:

1. Deprecate (preferred over unpublish):
   ```bash
   npm deprecate @agentarena/core@1.2.3 "broken release, use 1.2.4"
   ```

2. Publish a patch fix immediately on `main`.

3. If within 72 hours and truly broken, unpublish is an option:
   ```bash
   npm unpublish @agentarena/core@1.2.3
   ```
   Note: unpublish is only available within 72h and only if no dependents exist.

## Checklist

Before publishing, verify:

- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes (all 400+ tests)
- [ ] `pnpm lint` clean
- [ ] `pnpm changeset status --verbose` shows expected packages
- [ ] `pnpm -r publish --dry-run --access public --no-git-checks` succeeds
- [ ] Working tree is clean
- [ ] You are on `main` at the latest commit
