import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFFICIAL = path.join(REPO_ROOT, "examples", "taskpacks", "official");
const require = createRequire(path.join(REPO_ROOT, "packages", "taskpacks", "package.json"));
const { parse: parseYaml } = require("yaml");

async function readOfficialPacks() {
  const files = (await fs.readdir(OFFICIAL)).filter((name) => /\.ya?ml$/i.test(name)).sort();
  return Promise.all(files.map(async (name) => ({ name, data: parseYaml(await fs.readFile(path.join(OFFICIAL, name), "utf8")) })));
}

test("official task pack catalog has 30 localized packs and generated README markers", async () => {
  const packs = await readOfficialPacks();
  assert.equal(packs.length, 30);
  for (const { name, data } of packs) {
    const zh = data?.metadata?.i18n?.["zh-CN"];
    assert.ok(zh?.title, `${name} missing zh-CN title`);
    assert.ok(zh?.description, `${name} missing zh-CN description`);
    assert.ok(zh?.objective, `${name} missing zh-CN objective`);
    assert.ok(zh?.judgeRationale, `${name} missing zh-CN judgeRationale`);
  }

  for (const readmeName of ["README.md", "README.zh-CN.md"]) {
    const readme = await fs.readFile(path.join(REPO_ROOT, readmeName), "utf8");
    assert.match(readme, /<!-- official-taskpacks:start -->/);
    assert.match(readme, /<!-- official-taskpacks:end -->/);
    assert.match(readme, /\b30\b/);
    for (const { data } of packs) assert.ok(readme.includes("`" + data.id + "`"), `${readmeName} missing ${data.id}`);
  }
});
