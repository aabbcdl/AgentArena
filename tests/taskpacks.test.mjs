import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadTaskPack } from "../packages/taskpacks/dist/index.js";

test("loadTaskPack parses schema v1 judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "repoarena.taskpack/v1",
        id: "demo",
        title: "Demo Task",
        prompt: "Do the thing",
        envAllowList: ["CI", "REPOARENA_TOKEN"],
        judges: [
          {
            id: "lint",
            type: "command",
            label: "Lint passes",
            command: "npm run lint",
            cwd: "app",
            timeoutMs: 15000
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.schemaVersion, "repoarena.taskpack/v1");
  assert.deepEqual(taskPack.envAllowList, ["CI", "REPOARENA_TOKEN"]);
  assert.equal(taskPack.judges[0].id, "lint");
  assert.equal(taskPack.judges[0].cwd, "app");
  assert.equal(taskPack.judges[0].timeoutMs, 15000);
  assert.deepEqual(taskPack.setupCommands, []);
  assert.deepEqual(taskPack.teardownCommands, []);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack keeps backward compatibility with successCommands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        id: "legacy",
        title: "Legacy Task",
        prompt: "Legacy prompt",
        successCommands: [
          {
            label: "README exists",
            command: "test -f README.md"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.schemaVersion, "repoarena.taskpack/v1");
  assert.deepEqual(taskPack.envAllowList, []);
  assert.equal(taskPack.judges[0].id, "legacy-1");
  assert.equal(taskPack.judges[0].type, "command");
  assert.equal(taskPack.judges[0].label, "README exists");
  assert.deepEqual(taskPack.setupCommands, []);
  assert.deepEqual(taskPack.teardownCommands, []);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses setup and teardown commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "repoarena.taskpack/v1",
        id: "with-hooks",
        title: "Hooked Task",
        prompt: "Run setup and teardown",
        envAllowList: ["REPOARENA_TOKEN"],
        setupCommands: [
          {
            label: "Prepare fixtures",
            command: "node prepare.js",
            cwd: "scripts"
          }
        ],
        judges: [],
        teardownCommands: [
          {
            label: "Clean temp files",
            command: "node cleanup.js",
            timeoutMs: 5000
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.deepEqual(taskPack.envAllowList, ["REPOARENA_TOKEN"]);
  assert.equal(taskPack.setupCommands[0].id, "with-hooks-setup-1");
  assert.equal(taskPack.setupCommands[0].cwd, "scripts");
  assert.equal(taskPack.teardownCommands[0].id, "with-hooks-teardown-1");
  assert.equal(taskPack.teardownCommands[0].timeoutMs, 5000);

  await rm(tempDir, { recursive: true, force: true });
});
