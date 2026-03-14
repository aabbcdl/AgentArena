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
          },
          {
            id: "readme-exists",
            type: "file-exists",
            label: "README exists",
            path: "README.md"
          },
          {
            id: "package-name",
            type: "json-value",
            label: "Package name is repoarena",
            path: "package.json",
            pointer: "/name",
            expected: "repoarena"
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
  assert.equal(taskPack.judges[1].type, "file-exists");
  assert.equal(taskPack.judges[1].path, "README.md");
  assert.equal(taskPack.judges[2].type, "json-value");
  assert.equal(taskPack.judges[2].pointer, "/name");
  assert.equal(taskPack.judges[2].expected, "repoarena");
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

test("loadTaskPack parses step-level env allowlists and overrides", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "repoarena.taskpack/v1",
        id: "with-step-env",
        title: "Step Env Task",
        prompt: "Run step-level env configuration",
        setupCommands: [
          {
            label: "Prepare fixtures",
            command: "node prepare.js",
            envAllowList: ["REPOARENA_SETUP_TOKEN"],
            env: {
              REPOARENA_INLINE_SETUP: "enabled"
            }
          }
        ],
        judges: [
          {
            id: "judge-env",
            type: "command",
            label: "Judge sees extra env",
            command: "node judge.js",
            envAllowList: ["REPOARENA_JUDGE_TOKEN"],
            env: {
              REPOARENA_INLINE_JUDGE: "enabled"
            }
          }
        ],
        teardownCommands: [
          {
            label: "Cleanup fixtures",
            command: "node cleanup.js",
            envAllowList: ["REPOARENA_TEARDOWN_TOKEN"],
            env: {
              REPOARENA_INLINE_TEARDOWN: "enabled"
            }
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.deepEqual(taskPack.setupCommands[0].envAllowList, ["REPOARENA_SETUP_TOKEN"]);
  assert.deepEqual(taskPack.setupCommands[0].env, { REPOARENA_INLINE_SETUP: "enabled" });
  assert.deepEqual(taskPack.judges[0].envAllowList, ["REPOARENA_JUDGE_TOKEN"]);
  assert.deepEqual(taskPack.judges[0].env, { REPOARENA_INLINE_JUDGE: "enabled" });
  assert.deepEqual(taskPack.teardownCommands[0].envAllowList, ["REPOARENA_TEARDOWN_TOKEN"]);
  assert.deepEqual(taskPack.teardownCommands[0].env, { REPOARENA_INLINE_TEARDOWN: "enabled" });

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses file-contains judges with regex options", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "repoarena.taskpack/v1",
        id: "file-contains-demo",
        title: "File Contains Demo",
        prompt: "Check file content",
        judges: [
          {
            id: "brand-check",
            type: "file-contains",
            label: "README contains brand",
            path: "README.md",
            pattern: "^# RepoArena$",
            regex: true,
            flags: "m"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.judges[0].type, "file-contains");
  assert.equal(taskPack.judges[0].path, "README.md");
  assert.equal(taskPack.judges[0].pattern, "^# RepoArena$");
  assert.equal(taskPack.judges[0].regex, true);
  assert.equal(taskPack.judges[0].flags, "m");

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack supports YAML task packs with glob and file-count judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repoarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: repoarena.taskpack/v1",
      "id: yaml-demo",
      "title: YAML Demo",
      "prompt: Check YAML loading",
      "judges:",
      "  - id: glob-check",
      "    type: glob",
      "    label: Source files exist",
      "    pattern: packages/**/src/*.ts",
      "    minMatches: 1",
      "  - id: count-check",
      "    type: file-count",
      "    label: Example count",
      "    pattern: examples/taskpacks/*",
      "    min: 1"
    ].join("\n"),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.id, "yaml-demo");
  assert.equal(taskPack.judges[0].type, "glob");
  assert.equal(taskPack.judges[0].pattern, "packages/**/src/*.ts");
  assert.equal(taskPack.judges[0].minMatches, 1);
  assert.equal(taskPack.judges[1].type, "file-count");
  assert.equal(taskPack.judges[1].pattern, "examples/taskpacks/*");
  assert.equal(taskPack.judges[1].min, 1);

  await rm(tempDir, { recursive: true, force: true });
});
