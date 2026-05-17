---
name: test-patterns
description: Write and run tests using Node.js built-in test runner (node:test) with .mjs files. Use when creating new tests, debugging test failures, or understanding test infrastructure.
---

# Test Patterns

This project uses **Node.js built-in test runner** (`node:test`), not vitest or jest. Tests are `.mjs` files in `tests/` at the project root.

## When to Use

- Writing a new test for any package.
- Debugging a failing test.
- Adding integration tests for a new feature.
- Understanding the test infrastructure patterns.

## Test Runner API

```js
import test from "node:test";
import assert from "node:assert/strict";

test("description", async (t) => {
  assert.equal(actual, expected);
  assert.ok(condition);
  assert.deepEqual(actual, expected);  // deep comparison
});
```

### Subtests

```js
test("parent", async (t) => {
  await t.test("child A", () => { ... });
  await t.test("child B", () => { ... });
});
```

### Hooks (before/after per test file)

```js
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tmpDir;
test.before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-test-"));
});
test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
```

## Project Test Patterns

### Test file location and naming

- All tests live in `tests/` at repository root (not inside packages).
- File names use kebab-case: `adapters.test.mjs`, `agent-lifecycle.test.mjs`.
- Integration tests follow the same naming convention.

### Imports

Tests import from **dist** (compiled output), not source:

```js
// CORRECT: imports from dist
import { getAdapter } from "../packages/adapters/dist/index.js";

// WRONG: never import from src/ — no TypeScript loader at runtime
import { getAdapter } from "../packages/adapters/src/index.ts";
```

### Mocking patterns

Use temporary directories and real filesystem operations instead of mocking:

```js
const tmpDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-"));
try {
  await writeFile(path.join(tmpDir, "test.txt"), "content");
  // ... test logic
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}
```

For CLIs and processes, use `spawn()` from `node:child_process` with real arguments rather than mocking the module.

### What makes a good test

| Pattern | Accept |
|---------|--------|
| Imports from dist | ✅ Required |
| Uses temp directories | ✅ Required |
| Uses real filesystem | ✅ Preferred |
| Mocks entire modules | ❌ Avoid if possible |
| Skips tests without reason | ❌ Never |

## Running Tests

```bash
# Run all tests
pnpm test

# Run a specific test file
node --test tests/adapters.test.mjs

# Run with coverage
pnpm test:coverage

# Run with a filter pattern
node --test --test-name-pattern="adapter" tests/adapters.test.mjs
```

## What to Check Before Committing

- Test imports from `dist/`, not `src/`.
- The test can be run standalone: `node --test tests/<your-test>.mjs`.
- Temporary directories are cleaned up in `test.after()` or `finally` block.
- No `test.skip` without a comment explaining why.
- Coverage doesn't regress for the affected packages.
