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
