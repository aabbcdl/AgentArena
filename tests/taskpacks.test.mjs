import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTaskPack } from "../packages/taskpacks/dist/index.js";

test("loadTaskPack parses schema v1 judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "agentarena.taskpack/v1",
        id: "demo",
        title: "Demo Task",
        prompt: "Do the thing",
        metadata: {
          source: "official",
          owner: "AgentArena",
          objective: "Demo objective",
          repoTypes: ["node"],
          tags: ["demo"],
          dependencies: [],
          judgeRationale: "Demo rationale"
        },
        envAllowList: ["CI", "AGENTARENA_TOKEN"],
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
            label: "Package name is agentarena",
            path: "package.json",
            pointer: "/name",
            expected: "agentarena"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.schemaVersion, "agentarena.taskpack/v1");
  assert.equal(taskPack.metadata?.source, "official");
  assert.equal(taskPack.metadata?.owner, "AgentArena");
  assert.deepEqual(taskPack.metadata?.repoTypes, ["node"]);
  assert.deepEqual(taskPack.envAllowList, ["CI", "AGENTARENA_TOKEN"]);
  assert.equal(taskPack.judges[0].id, "lint");
  assert.equal(taskPack.judges[0].cwd, "app");
  assert.equal(taskPack.judges[0].timeoutMs, 15000);
  assert.equal(taskPack.judges[1].type, "file-exists");
  assert.equal(taskPack.judges[1].path, "README.md");
  assert.equal(taskPack.judges[2].type, "json-value");
  assert.equal(taskPack.judges[2].pointer, "/name");
  assert.equal(taskPack.judges[2].expected, "agentarena");
  assert.deepEqual(taskPack.setupCommands, []);
  assert.deepEqual(taskPack.teardownCommands, []);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses structured quality judges and expectedChangedPaths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "agentarena.taskpack/v1",
        id: "quality-demo",
        title: "Quality Demo",
        prompt: "Run structured quality checks",
        expectedChangedPaths: ["src/**/*.ts", "README.md"],
        judges: [
          {
            id: "tests-json",
            type: "test-result",
            label: "Tests emit JSON",
            command: "node test-runner.js",
            format: "vitest",
            reportFile: ".agentarena/tests.json",
            passOnNoTests: true
          },
          {
            id: "lint-json",
            type: "lint-check",
            label: "Lint emits JSON",
            command: "node lint-runner.js",
            format: "eslint",
            reportFile: ".agentarena/lint.json",
            maxWarnings: 2
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.deepEqual(taskPack.expectedChangedPaths, ["src/**/*.ts", "README.md"]);
  assert.equal(taskPack.judges[0].type, "test-result");
  assert.equal(taskPack.judges[0].format, "vitest");
  assert.equal(taskPack.judges[0].reportFile, ".agentarena/tests.json");
  assert.equal(taskPack.judges[0].passOnNoTests, true);
  assert.equal(taskPack.judges[1].type, "lint-check");
  assert.equal(taskPack.judges[1].format, "eslint");
  assert.equal(taskPack.judges[1].reportFile, ".agentarena/lint.json");
  assert.equal(taskPack.judges[1].maxWarnings, 2);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack keeps backward compatibility with successCommands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
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

  assert.equal(taskPack.schemaVersion, "agentarena.taskpack/v1");
  assert.deepEqual(taskPack.envAllowList, []);
  assert.equal(taskPack.judges[0].id, "legacy-1");
  assert.equal(taskPack.judges[0].type, "command");
  assert.equal(taskPack.judges[0].label, "README exists");
  assert.deepEqual(taskPack.setupCommands, []);
  assert.deepEqual(taskPack.teardownCommands, []);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses setup and teardown commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "agentarena.taskpack/v1",
        id: "with-hooks",
        title: "Hooked Task",
        prompt: "Run setup and teardown",
        envAllowList: ["AGENTARENA_TOKEN"],
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

  assert.deepEqual(taskPack.envAllowList, ["AGENTARENA_TOKEN"]);
  assert.equal(taskPack.setupCommands[0].id, "with-hooks-setup-1");
  assert.equal(taskPack.setupCommands[0].cwd, "scripts");
  assert.equal(taskPack.teardownCommands[0].id, "with-hooks-teardown-1");
  assert.equal(taskPack.teardownCommands[0].timeoutMs, 5000);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses step-level env allowlists and overrides", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "agentarena.taskpack/v1",
        id: "with-step-env",
        title: "Step Env Task",
        prompt: "Run step-level env configuration",
        setupCommands: [
          {
            label: "Prepare fixtures",
            command: "node prepare.js",
            envAllowList: ["AGENTARENA_SETUP_TOKEN"],
            env: {
              AGENTARENA_INLINE_SETUP: "enabled"
            }
          }
        ],
        judges: [
          {
            id: "judge-env",
            type: "command",
            label: "Judge sees extra env",
            command: "node judge.js",
            envAllowList: ["AGENTARENA_JUDGE_TOKEN"],
            env: {
              AGENTARENA_INLINE_JUDGE: "enabled"
            }
          }
        ],
        teardownCommands: [
          {
            label: "Cleanup fixtures",
            command: "node cleanup.js",
            envAllowList: ["AGENTARENA_TEARDOWN_TOKEN"],
            env: {
              AGENTARENA_INLINE_TEARDOWN: "enabled"
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

  assert.deepEqual(taskPack.setupCommands[0].envAllowList, ["AGENTARENA_SETUP_TOKEN"]);
  assert.deepEqual(taskPack.setupCommands[0].env, { AGENTARENA_INLINE_SETUP: "enabled" });
  assert.deepEqual(taskPack.judges[0].envAllowList, ["AGENTARENA_JUDGE_TOKEN"]);
  assert.deepEqual(taskPack.judges[0].env, { AGENTARENA_INLINE_JUDGE: "enabled" });
  assert.deepEqual(taskPack.teardownCommands[0].envAllowList, ["AGENTARENA_TEARDOWN_TOKEN"]);
  assert.deepEqual(taskPack.teardownCommands[0].env, { AGENTARENA_INLINE_TEARDOWN: "enabled" });

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses file-contains judges with regex options", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "agentarena.taskpack/v1",
        id: "file-contains-demo",
        title: "File Contains Demo",
        prompt: "Check file content",
        judges: [
          {
            id: "brand-check",
            type: "file-contains",
            label: "README contains brand",
            path: "README.md",
            pattern: "^# AgentArena$",
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
  assert.equal(taskPack.judges[0].pattern, "^# AgentArena$");
  assert.equal(taskPack.judges[0].regex, true);
  assert.equal(taskPack.judges[0].flags, "m");

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack supports YAML task packs with glob and file-count judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
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

test("loadTaskPack parses snapshot and json-schema judges", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify(
      {
        schemaVersion: "agentarena.taskpack/v1",
        id: "advanced-judges",
        title: "Advanced Judges",
        prompt: "Parse snapshot and schema judges",
        judges: [
          {
            id: "snapshot-check",
            type: "snapshot",
            label: "Generated file matches snapshot",
            path: "actual.txt",
            snapshotPath: "expected.txt"
          },
          {
            id: "schema-check",
            type: "json-schema",
            label: "Config matches schema",
            path: "config.json",
            schemaPath: "schema.json"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.judges[0].type, "snapshot");
  assert.equal(taskPack.judges[0].path, "actual.txt");
  assert.equal(taskPack.judges[0].snapshotPath, "expected.txt");
  assert.equal(taskPack.judges[1].type, "json-schema");
  assert.equal(taskPack.judges[1].path, "config.json");
  assert.equal(taskPack.judges[1].schemaPath, "schema.json");

  await rm(tempDir, { recursive: true, force: true });
});

test("official task pack library files all load with metadata", async () => {
  const officialDir = path.resolve("examples", "taskpacks", "official");
  const files = (await readdir(officialDir))
    .filter((fileName) => fileName.endsWith(".yaml"))
    .sort();

  assert.equal(files.length >= 6, true);

  for (const fileName of files) {
    const taskPack = await loadTaskPack(path.join(officialDir, fileName));
    assert.equal(taskPack.metadata?.source, "official");
    assert.equal(taskPack.metadata?.owner, "AgentArena");
    assert.equal(taskPack.metadata?.repoTypes.length > 0, true);
    assert.equal(taskPack.metadata?.tags.length > 0, true);
    assert.equal(taskPack.judges.length > 0, true);
  }
});

test("loadTaskPack parses repoSource field", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify({
      schemaVersion: "agentarena.taskpack/v1",
      id: "repo-source-demo",
      title: "Repo Source Demo",
      prompt: "Test repoSource parsing",
      repoSource: "builtin://node-starter",
      judges: []
    }),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);
  assert.equal(taskPack.repoSource, "builtin://node-starter");

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses difficulty metadata field", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify({
      schemaVersion: "agentarena.taskpack/v1",
      id: "difficulty-demo",
      title: "Difficulty Demo",
      prompt: "Test difficulty parsing",
      metadata: {
        source: "official",
        owner: "AgentArena",
        difficulty: "hard",
        repoTypes: ["node"],
        tags: ["test"],
        dependencies: []
      },
      judges: []
    }),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);
  assert.equal(taskPack.metadata?.difficulty, "hard");

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack rejects unsupported file extensions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.txt");

  await writeFile(taskPath, "id: bad", "utf8");

  await assert.rejects(() => loadTaskPack(taskPath), /must use .json, .yaml, or .yml/);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack rejects unsupported schema versions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify({
      schemaVersion: "agentarena.taskpack/v99",
      id: "bad-version",
      title: "Bad Version",
      prompt: "Test"
    }),
    "utf8"
  );

  await assert.rejects(() => loadTaskPack(taskPath), /Unsupported task pack schema version/);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack rejects invalid difficulty values", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.json");

  await writeFile(
    taskPath,
    JSON.stringify({
      schemaVersion: "agentarena.taskpack/v1",
      id: "bad-difficulty",
      title: "Bad Difficulty",
      prompt: "Test",
      metadata: {
        source: "official",
        owner: "AgentArena",
        difficulty: "extreme",
        repoTypes: [],
        tags: [],
        dependencies: []
      },
      judges: []
    }),
    "utf8"
  );

  await assert.rejects(() => loadTaskPack(taskPath), /must be "easy", "medium", or "hard"/);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses patch-validation judge", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
      "id: test-patch-validation",
      "title: Test",
      "prompt: Test task",
      "judges:",
      "  - type: patch-validation",
      "    label: \"Issue resolved\"",
      "    testSuite: \"npm test\"",
      "    failToPassTests:",
      "      - \"test/bug-fix.test.js\"",
      "    passToPassTests:",
      "      - \"test/**/*.test.js\"",
      "    critical: true",
      "metadata:",
      "  source: official",
      "  owner: Test",
      "  repoTypes: [node]",
      "  tags: []",
      "  dependencies: []",
      "envAllowList: []",
      "setupCommands: []",
      "teardownCommands: []"
    ].join("\n"),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.judges.length, 1);
  assert.equal(taskPack.judges[0].type, "patch-validation");
  assert.equal(taskPack.judges[0].testSuite, "npm test");
  assert.deepEqual(taskPack.judges[0].failToPassTests, ["test/bug-fix.test.js"]);
  assert.deepEqual(taskPack.judges[0].passToPassTests, ["test/**/*.test.js"]);
  assert.equal(taskPack.judges[0].critical, true);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses token-efficiency judge", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
      "id: test-token-efficiency",
      "title: Test",
      "prompt: Test task",
      "judges:",
      "  - type: token-efficiency",
      "    label: \"Token budget check\"",
      "    tokenBudget: 50000",
      "    critical: false",
      "metadata:",
      "  source: official",
      "  owner: Test",
      "  repoTypes: [node]",
      "  tags: []",
      "  dependencies: []",
      "envAllowList: []",
      "setupCommands: []",
      "teardownCommands: []"
    ].join("\n"),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.equal(taskPack.judges.length, 1);
  assert.equal(taskPack.judges[0].type, "token-efficiency");
  assert.equal(taskPack.judges[0].tokenBudget, 50000);
  assert.equal(taskPack.judges[0].critical, false);

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack validates interactionModel enum", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
      "id: test-valid-interaction",
      "title: Test",
      "prompt: Test",
      "metadata:",
      "  source: official",
      "  owner: Test",
      "  repoTypes: [node]",
      "  tags: []",
      "  dependencies: []",
      "  interactionModel: multi-turn",
      "envAllowList: []",
      "setupCommands: []",
      "judges: []",
      "teardownCommands: []"
    ].join("\n"),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);
  assert.equal(taskPack.metadata.interactionModel, "multi-turn");

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack rejects invalid interactionModel", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
      "id: test-invalid-interaction",
      "title: Test",
      "prompt: Test",
      "metadata:",
      "  source: official",
      "  owner: Test",
      "  repoTypes: [node]",
      "  tags: []",
      "  dependencies: []",
      "  interactionModel: invalid-value",
      "envAllowList: []",
      "setupCommands: []",
      "judges: []",
      "teardownCommands: []"
    ].join("\n"),
    "utf8"
  );

  await assert.rejects(
    async () => await loadTaskPack(taskPath),
    /interactionModel/,
    "Should reject invalid interactionModel"
  );

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses antiContamination metadata", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
      "id: test-anti-contam",
      "title: Test",
      "prompt: Test",
      "metadata:",
      "  source: official",
      "  owner: Test",
      "  repoTypes: [node]",
      "  tags: []",
      "  dependencies: []",
      "  taskCategories: [coding, math]",
      "  antiContamination:",
      "    rotationId: \"2026-04\"",
      "    createdAt: \"2026-04-01T00:00:00Z\"",
      "    expiresAt: \"2026-05-01T00:00:00Z\"",
      "envAllowList: []",
      "setupCommands: []",
      "judges: []",
      "teardownCommands: []"
    ].join("\n"),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);

  assert.deepEqual(taskPack.metadata.taskCategories, ["coding", "math"]);
  assert.equal(taskPack.metadata.antiContamination.rotationId, "2026-04");
  assert.equal(taskPack.metadata.antiContamination.createdAt, "2026-04-01T00:00:00Z");
  assert.equal(taskPack.metadata.antiContamination.expiresAt, "2026-05-01T00:00:00Z");

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack parses requirementClarity enum", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
      "id: test-requirement-clarity",
      "title: Test",
      "prompt: Test",
      "metadata:",
      "  source: official",
      "  owner: Test",
      "  repoTypes: [node]",
      "  tags: []",
      "  dependencies: []",
      "  requirementClarity: precise",
      "envAllowList: []",
      "setupCommands: []",
      "judges: []",
      "teardownCommands: []"
    ].join("\n"),
    "utf8"
  );

  const taskPack = await loadTaskPack(taskPath);
  assert.equal(taskPack.metadata.requirementClarity, "precise");

  await rm(tempDir, { recursive: true, force: true });
});

test("loadTaskPack rejects invalid requirementClarity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-taskpack-"));
  const taskPath = path.join(tempDir, "task.yaml");

  await writeFile(
    taskPath,
    [
      "schemaVersion: agentarena.taskpack/v1",
      "id: test-invalid-clarity",
      "title: Test",
      "prompt: Test",
      "metadata:",
      "  source: official",
      "  owner: Test",
      "  repoTypes: [node]",
      "  tags: []",
      "  dependencies: []",
      "  requirementClarity: unclear",
      "envAllowList: []",
      "setupCommands: []",
      "judges: []",
      "teardownCommands: []"
    ].join("\n"),
    "utf8"
  );

  await assert.rejects(
    async () => await loadTaskPack(taskPath),
    /requirementClarity/,
    "Should reject invalid requirementClarity"
  );

  await rm(tempDir, { recursive: true, force: true });
});
