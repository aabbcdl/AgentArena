import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTaskPack } from "../packages/taskpacks/dist/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFFICIAL_TASKPACK_DIR = path.join(REPO_ROOT, "examples", "taskpacks", "official");

test("all official taskpack templates pass loadTaskPack validation", async () => {
  const entries = await readdir(OFFICIAL_TASKPACK_DIR);
  const yamlFiles = entries.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  assert.ok(yamlFiles.length > 0, "Expected at least one official taskpack template");

  for (const file of yamlFiles) {
    const taskPath = path.join(OFFICIAL_TASKPACK_DIR, file);
    const taskPack = await loadTaskPack(taskPath);
    assert.ok(taskPack.id, `${file}: missing id`);
    assert.ok(taskPack.title, `${file}: missing title`);
    assert.ok(taskPack.prompt, `${file}: missing prompt`);
    assert.ok(Array.isArray(taskPack.judges), `${file}: judges should be an array`);
    assert.ok(taskPack.judges.length > 0, `${file}: should have at least one judge`);
  }
});

test("demo taskpack JSON files pass loadTaskPack validation", async () => {
  const demoDir = path.join(REPO_ROOT, "examples", "taskpacks");
  const entries = await readdir(demoDir);
  const jsonFiles = entries.filter((f) => f.endsWith(".json") && f !== "task-packs.json");

  for (const file of jsonFiles) {
    const taskPath = path.join(demoDir, file);
    const taskPack = await loadTaskPack(taskPath);
    assert.ok(taskPack.id, `${file}: missing id`);
    assert.ok(taskPack.title, `${file}: missing title`);
    assert.ok(taskPack.prompt, `${file}: missing prompt`);
  }
});
