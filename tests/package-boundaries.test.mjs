import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readPackage(relativePath) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), "utf8"));
}

test("core exposes scoring weights through a public package subpath", async () => {
  const core = await readPackage("packages/core/package.json");
  assert.deepEqual(core.exports["./scoring-weights"], {
    types: "./dist/scoring-weights.d.ts",
    import: "./dist/scoring-weights.js"
  });

  const scoringWeights = await import(
    pathToFileURL(path.join(REPO_ROOT, "packages", "core", "dist", "scoring-weights.js")).href
  );
  assert.equal(scoringWeights.isScoreMode("practical"), true);
  assert.equal(scoringWeights.isScoreMode("not-a-mode"), false);
});

test("workbench declares its package dependency while CLI ships bundled UI assets", async () => {
  const webReport = await readPackage("apps/web-report/package.json");
  const cli = await readPackage("packages/cli/package.json");

  assert.equal(webReport.dependencies["@agentarena/core"], "workspace:*");
  assert.equal(cli.dependencies["@agentarena/web-report"], undefined);
  assert.ok(cli.files.includes("assets"));
});

test("workbench imports core contracts through the public package boundary", async () => {
  const scoreMode = await readFile(
    path.join(REPO_ROOT, "apps/web-report/workbench/src/domain/score-mode.ts"),
    "utf8"
  );
  const run = await readFile(path.join(REPO_ROOT, "apps/web-report/workbench/src/domain/run.ts"), "utf8");

  assert.match(scoreMode, /from ["']@agentarena\/core\/scoring-weights["']/);
  assert.match(run, /from ["']@agentarena\/core\/artifact-contract["']/);
  assert.doesNotMatch(scoreMode, /packages\/core\/src/);
  assert.doesNotMatch(run, /packages\/core\/src/);
});

test("CLI asset copying consumes the dependency-built web-report output", async () => {
  const script = await readFile(path.join(REPO_ROOT, "scripts/copy-cli-assets.mjs"), "utf8");

  assert.ok(script.includes('path.join(repoRoot, "apps", "web-report", "dist")'));
  assert.doesNotMatch(script, /webReportBuildScript/);
  assert.doesNotMatch(script, /import\(pathToFileURL\(webReport/);
});
