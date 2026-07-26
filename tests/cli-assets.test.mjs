import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PACKAGE_ROOT = path.join(REPO_ROOT, "packages", "cli");
const CLI_ASSETS_ROOT = path.join(CLI_PACKAGE_ROOT, "assets");

async function exists(filePath) {
  await access(filePath);
  return true;
}

test("CLI package includes runtime assets needed after npm install", async () => {
  const pkg = JSON.parse(await readFile(path.join(CLI_PACKAGE_ROOT, "package.json"), "utf8"));

  assert.ok(pkg.files.includes("dist"));
  assert.ok(pkg.files.includes("assets"));
  assert.equal(await exists(path.join(CLI_ASSETS_ROOT, "web-report", "index.html")), true);
  assert.equal(await exists(path.join(CLI_ASSETS_ROOT, "taskpacks", "official", "repo-health.yaml")), true);
  assert.equal(await exists(path.join(CLI_ASSETS_ROOT, "taskpacks", "demo", "demo-ui-tour.yaml")), true);
  assert.equal(await exists(path.join(CLI_ASSETS_ROOT, "taskpacks", "repos", "nodejs-monorepo", "package.json")), true);
});

test("CLI runtime resolves UI and official task packs from packaged assets", async () => {
  const shared = await import("../packages/cli/dist/commands/shared.js");
  const uiRoutes = await import("../packages/cli/dist/commands/ui-routes.js");

  assert.equal(shared.OFFICIAL_TASKPACK_ROOT, path.join(CLI_ASSETS_ROOT, "taskpacks", "official"));
  assert.equal(shared.BUILTIN_REPOS_ROOT, path.join(CLI_ASSETS_ROOT, "taskpacks", "repos"));
  assert.equal(uiRoutes.WEB_REPORT_DIST_ROOT, path.join(CLI_ASSETS_ROOT, "web-report"));
});


test("CLI trust check accepts workspace built-ins but rejects external task paths", async () => {
  const shared = await import("../packages/cli/dist/commands/shared.js");

  assert.equal(
    shared.isTrustedBuiltinTaskPack(path.join(REPO_ROOT, "examples", "taskpacks", "official", "input-validation.yaml")),
    true
  );
  assert.equal(
    shared.isTrustedBuiltinTaskPack(path.join(REPO_ROOT, "examples", "taskpacks", "demo", "demo-ui-tour.yaml")),
    true
  );
  assert.equal(
    shared.isTrustedBuiltinTaskPack(path.join(REPO_ROOT, "examples", "taskpacks", "demo-repo-health.json")),
    true
  );
  assert.equal(
    shared.isTrustedBuiltinTaskPack(path.join(REPO_ROOT, ".agentarena", "external-task.json")),
    false
  );
});
