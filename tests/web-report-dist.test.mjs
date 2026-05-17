import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(REPO_ROOT, "apps", "web-report", "dist");

test("web-report dist directory exists", async () => {
  const s = await stat(DIST);
  assert.ok(s.isDirectory());
});

test("index.html exists and contains app entry point", async () => {
  const html = await readFile(path.join(DIST, "index.html"), "utf8");
  assert.ok(html.includes("<title>AgentArena Web Report</title>"), "missing title");
  assert.ok(html.includes("app.js"), "missing app.js script reference");
  assert.ok(html.includes("styles.css"), "missing styles.css link");
});

test("critical JS files exist in dist", async () => {
  const required = [
    "app.js",
    "i18n.js",
    "sw.js",
    "view-model.js",
    "styles.css",
    "manifest.json",
    "icon.svg",
  ];
  for (const file of required) {
    const s = await stat(path.join(DIST, file));
    assert.ok(s.isFile(), `${file} should exist in dist`);
  }
});

test("manifest.json is valid JSON with required fields", async () => {
  const raw = await readFile(path.join(DIST, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw);
  assert.ok(manifest.name, "manifest should have a name");
  assert.ok(manifest.start_url, "manifest should have start_url");
});

test("service worker references app shell files", async () => {
  const sw = await readFile(path.join(DIST, "sw.js"), "utf8");
  assert.ok(sw.includes("cache") || sw.includes("Cache"), "sw.js should reference caching");
});
