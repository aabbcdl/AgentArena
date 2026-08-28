import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const taskId = process.argv[2];
const require = createRequire(import.meta.url);

function load(relativePath) {
  return require(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)));
}

function run(relativePath, args = []) {
  return spawnSync(process.execPath, [relativePath, ...args], { encoding: "utf8" });
}

switch (taskId) {
  case "repo-health": {
    const utils = load("src/utils.js");
    assert.equal(utils.capitalizeWords("hello world"), "Hello World");
    assert.equal(utils.capitalizeWords("  multiple   spaces"), "  Multiple   Spaces");
    assert.equal(utils.reverse("arena"), "anera");
    break;
  }
  case "config-repair": {
    const config = JSON.parse(readFileSync("fixtures/config.json", "utf8"));
    assert.equal(typeof config.server.port, "number");
    assert.ok(config.server.port >= 1);
    assert.ok(Number.isInteger(config.database.poolSize) && config.database.poolSize >= 1);
    assert.equal(config.mode, "production");
    assert.equal(config.version, "1.0.0");
    break;
  }
  case "json-contract-repair": {
    const response = JSON.parse(readFileSync("fixtures/response.json", "utf8"));
    const contract = load("src/json-contract.js");
    assert.equal(contract.validateResponse(response), true);
    assert.deepEqual(Object.keys(response).sort(), ["items", "requestId", "status"]);
    break;
  }
  case "snapshot-fix": {
    const result = run("scripts/generate.mjs");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Report: AgentArena\nItems: 3\n");
    break;
  }
  case "failing-test-fix": {
    const calculator = load("src/calculator.js");
    assert.equal(calculator.subtract(9, 4), 5);
    assert.equal(calculator.subtract(-2, -5), 3);
    assert.equal(calculator.divide(8, 2), 4);
    assert.throws(() => calculator.divide(1, 0), RangeError);
    break;
  }
  case "add-feature-with-tests": {
    const index = load("src/index.js");
    assert.equal(typeof index.memoize, "function");
    let calls = 0;
    const memoized = index.memoize((value) => { calls += 1; return value * 2; });
    assert.equal(memoized(4), 8);
    assert.equal(memoized(4), 8);
    assert.equal(calls, 1);
    break;
  }
  case "logging-improvement": {
    const lines = [];
    const { createLogger } = load("src/logger.js");
    const logger = createLogger("worker", { level: "info", context: { requestId: "r-1" }, sink: (line) => lines.push(line) });
    logger.debug("hidden");
    logger.info("started", { jobId: "j-1" });
    logger.child({ jobId: "j-2" }).warn("retry");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\[INFO\] worker /);
    assert.match(lines[0], /requestId/);
    assert.match(lines[0], /jobId/);
    assert.match(lines[1], /\[WARN\]/);
    break;
  }
  case "input-validation": {
    const validator = load("src/validator.js");
    assert.equal(validator.sanitizeHtml("<b>Hello</b><script>alert(1)</script>"), "Hello");
    assert.equal(validator.isSafePath("reports/out.txt", "D:/workspace"), true);
    assert.equal(validator.isSafePath("../secret.txt", "D:/workspace"), false);
    assert.throws(() => validator.requireNonEmptyString("  ", "name"), TypeError);
    break;
  }
  case "cross-file-refactor": {
    assert.equal(existsSync("src/slugify.js"), true);
    const utils = load("src/utils.js");
    const slugify = load("src/slugify.js");
    const index = load("src/index.js");
    assert.equal(utils.slugify, slugify.slugify);
    assert.equal(index.slugify("Hello, World"), "hello-world");
    const source = readFileSync("src/utils.js", "utf8");
    assert.doesNotMatch(source, /function\s+slugify\s*\(/);
    break;
  }
  case "test-coverage": {
    assert.equal(existsSync("test/logger.test.js"), true);
    assert.equal(existsSync("test/validator.test.js"), true);
    break;
  }
  default:
    throw new Error(`Unknown core task verifier: ${taskId}`);
}

console.log(`PASS: ${taskId}`);
