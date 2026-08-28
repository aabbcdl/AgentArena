import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { loadTaskPack } from "../packages/taskpacks/dist/index.js";

const TEMP_DIR = join(import.meta.dirname, ".tmp-taskpacks-test");

function createTempTaskpack(content, filename = "test.yaml") {
  mkdirSync(TEMP_DIR, { recursive: true });
  const filePath = join(TEMP_DIR, filename);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

function cleanup() {
  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch { /* best-effort: cleanup */ }
}

it("parses a valid taskpack with all required fields", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: test-task
title: Test Task
prompt: Fix the bug in main.js
judges:
  - type: file-exists
    label: main.js exists
    path: main.js
`;
  const filePath = createTempTaskpack(yaml);
  try {
    const task = await loadTaskPack(filePath);
    assert.equal(task.id, "test-task");
    assert.equal(task.title, "Test Task");
    assert.equal(task.prompt, "Fix the bug in main.js");
    assert.ok(Array.isArray(task.judges));
    assert.equal(task.judges.length, 1);
  } finally {
    cleanup();
  }
});

it("parses a supported taskpack lifecycle", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: lifecycle-task
title: Lifecycle Task
prompt: Fix the scoped issue
metadata:
  source: official
  owner: AgentArena
  lifecycle: core
`;
  const filePath = createTempTaskpack(yaml);
  try {
    const task = await loadTaskPack(filePath);
    assert.equal(task.metadata?.lifecycle, "core");
  } finally {
    cleanup();
  }
});

it("rejects an unsupported taskpack lifecycle", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: invalid-lifecycle-task
title: Invalid Lifecycle Task
prompt: Fix the scoped issue
metadata:
  source: official
  owner: AgentArena
  lifecycle: archived
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(
      () => loadTaskPack(filePath),
      /metadata\.lifecycle.*core.*legacy.*experimental/i
    );
  } finally {
    cleanup();
  }
});

it("propagates judge weight from the taskpack through loadTaskPack", async () => {
  // Regression: `weight` passed field validation but was dropped by the
  // per-type normalizers, so every judge fell back to weight 1 and the
  // weighted pass ratio was dead end-to-end.
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: weight-task
title: Weight Task
prompt: Do the thing
judges:
  - type: file-exists
    label: weighted judge
    path: main.js
    weight: 5
  - type: file-exists
    label: default weight judge
    path: other.js
`;
  const filePath = createTempTaskpack(yaml);
  try {
    const task = await loadTaskPack(filePath);
    assert.equal(task.judges[0].weight, 5);
    assert.equal(task.judges[1].weight, undefined);
  } finally {
    cleanup();
  }
});

it("parses and normalizes a change policy", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: policy-task
title: Policy Task
prompt: Make a scoped change
changePolicy:
  requireAgentChange: true
  allowedPaths: ["src/**/*.js"]
  forbiddenPaths: ["test/**"]
  minChangedFiles: 1
  maxChangedFiles: 2
judges:
  - type: file-exists
    label: source exists
    path: src/main.js
`;
  const filePath = createTempTaskpack(yaml);
  try {
    const task = await loadTaskPack(filePath);
    assert.deepEqual(task.changePolicy, {
      requireAgentChange: true,
      allowedPaths: ["src/**/*.js"],
      forbiddenPaths: ["test/**"],
      minChangedFiles: 1,
      maxChangedFiles: 2
    });
  } finally {
    cleanup();
  }
});

it("rejects an empty or inverted change policy", async () => {
  const emptyPath = createTempTaskpack(`
schemaVersion: agentarena.taskpack/v1
id: empty-policy
title: Empty Policy
prompt: Make a change
changePolicy: {}
`, "empty-policy.yaml");
  const invertedPath = createTempTaskpack(`
schemaVersion: agentarena.taskpack/v1
id: inverted-policy
title: Inverted Policy
prompt: Make a change
changePolicy:
  minChangedFiles: 3
  maxChangedFiles: 1
`, "inverted-policy.yaml");
  try {
    await assert.rejects(() => loadTaskPack(emptyPath), /changePolicy.*constraint/i);
    await assert.rejects(() => loadTaskPack(invertedPath), /minChangedFiles.*maxChangedFiles/i);
  } finally {
    cleanup();
  }
});

it("rejects a non-positive judge weight", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: bad-weight-task
title: Bad Weight Task
prompt: Do the thing
judges:
  - type: file-exists
    label: bad weight judge
    path: main.js
    weight: 0
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(() => loadTaskPack(filePath), /weight.*positive/i);
  } finally {
    cleanup();
  }
});

it("rejects taskpack without id", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
title: Test Task
prompt: Fix the bug
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(() => loadTaskPack(filePath), /id/i);
  } finally {
    cleanup();
  }
});

it("rejects taskpack without title", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: test-task
prompt: Fix the bug
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(() => loadTaskPack(filePath), /title/i);
  } finally {
    cleanup();
  }
});

it("rejects taskpack without prompt", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: test-task
title: Test Task
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(() => loadTaskPack(filePath), /prompt/i);
  } finally {
    cleanup();
  }
});

it("rejects taskpack with unknown schema version", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v99
id: test-task
title: Test Task
prompt: Fix the bug
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(() => loadTaskPack(filePath), /schema.*version/i);
  } finally {
    cleanup();
  }
});

it("rejects taskpack with zero tokenBudget", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: test-task
title: Test Task
prompt: Fix the bug
metadata:
  source: official
  owner: AgentArena
  tokenBudget: 0
judges:
  - type: file-exists
    label: main.js exists
    path: main.js
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(() => loadTaskPack(filePath), /tokenBudget.*positive/i);
  } finally {
    cleanup();
  }
});

it("rejects taskpack with negative tokenBudget", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: test-task
title: Test Task
prompt: Fix the bug
metadata:
  source: official
  owner: AgentArena
  tokenBudget: -100
judges:
  - type: file-exists
    label: main.js exists
    path: main.js
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(() => loadTaskPack(filePath), /tokenBudget.*positive/i);
  } finally {
    cleanup();
  }
});

it("handles null judges field by falling back to successCommands", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: test-task
title: Test Task
prompt: Fix the bug
successCommands:
  - type: command
    label: Check success
    command: echo ok
`;
  const filePath = createTempTaskpack(yaml);
  try {
    const task = await loadTaskPack(filePath);
    assert.ok(Array.isArray(task.judges));
    assert.equal(task.judges.length, 1);
    assert.equal(task.judges[0].type, "command");
  } finally {
    cleanup();
  }
});

it("rejects external repository URLs while loading a local-only taskpack", async () => {
  const yaml = `
schemaVersion: agentarena.taskpack/v1
id: external-repo-task
title: External repository task
prompt: Fix the bug
repoSource: https://github.com/example/repo.git
judges:
  - type: file-exists
    label: main.js exists
    path: main.js
`;
  const filePath = createTempTaskpack(yaml);
  try {
    await assert.rejects(
      () => loadTaskPack(filePath),
      /External repository URLs are not supported in local-only mode/
    );
  } finally {
    cleanup();
  }
});
