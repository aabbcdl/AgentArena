import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionEnvironment,
  createAgentSelection,
  diffSnapshots,
  formatDuration,
  isPathInsideWorkspace,
  isWindowsLikePath,
  normalizePath,
  portableBasename,
  portableRelativePath,
  resolveRepoSource,
  safePathJoin,
  uniqueSorted,
  validateTaskPackId
} from "../packages/core/dist/index.js";

test("uniqueSorted removes duplicates and sorts values", () => {
  assert.deepEqual(uniqueSorted(["b", "a", "b"]), ["a", "b"]);
});

test("diffSnapshots reports added, changed, and removed files", () => {
  const before = new Map([
    ["README.md", { relativePath: "README.md", hash: "old" }],
    ["src/app.ts", { relativePath: "src/app.ts", hash: "same" }]
  ]);
  const after = new Map([
    ["README.md", { relativePath: "README.md", hash: "new" }],
    ["src/app.ts", { relativePath: "src/app.ts", hash: "same" }],
    ["src/new.ts", { relativePath: "src/new.ts", hash: "added" }]
  ]);

  assert.deepEqual(diffSnapshots(before, after), {
    added: ["src/new.ts"],
    changed: ["README.md"],
    removed: []
  });
});

test("buildExecutionEnvironment includes only baseline and allowlisted variables", () => {
  process.env.REPOARENA_ALLOWED_TEST = "visible";
  process.env.REPOARENA_BLOCKED_TEST = "hidden";

  try {
    const environment = buildExecutionEnvironment(["REPOARENA_ALLOWED_TEST"]);

    assert.equal(environment.REPOARENA_ALLOWED_TEST, "visible");
    assert.equal(environment.REPOARENA_BLOCKED_TEST, undefined);
    assert.ok(environment.PATH || environment.Path);
  } finally {
    delete process.env.REPOARENA_ALLOWED_TEST;
    delete process.env.REPOARENA_BLOCKED_TEST;
  }
});

test("buildExecutionEnvironment applies inline overrides", () => {
  process.env.REPOARENA_ALLOWED_TEST = "visible";

  try {
    const environment = buildExecutionEnvironment(["REPOARENA_ALLOWED_TEST"], {
      REPOARENA_ALLOWED_TEST: "overridden",
      REPOARENA_INLINE_ONLY: "inline"
    });

    assert.equal(environment.REPOARENA_ALLOWED_TEST, "overridden");
    assert.equal(environment.REPOARENA_INLINE_ONLY, "inline");
  } finally {
    delete process.env.REPOARENA_ALLOWED_TEST;
  }
});

test("createAgentSelection derives a stable variant id from model config", () => {
  const selection = createAgentSelection({
    baseAgentId: "codex",
    displayLabel: "Codex CLI",
    config: {
      model: "gpt-5.4",
      reasoningEffort: "high"
    },
    configSource: "ui"
  });

  assert.equal(selection.baseAgentId, "codex");
  assert.equal(selection.variantId, "codex-gpt-5-4-high");
  assert.equal(selection.displayLabel, "Codex CLI");
  assert.equal(selection.config.model, "gpt-5.4");
  assert.equal(selection.config.reasoningEffort, "high");
});

test("formatDuration formats milliseconds, seconds, and minutes", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(500), "500ms");
  assert.equal(formatDuration(1500), "1.50s");
  assert.equal(formatDuration(65000), "1m 5.0s");
  assert.equal(formatDuration(-1), "0ms");
  assert.equal(formatDuration(Infinity), "0ms");
});

test("validateTaskPackId accepts valid IDs and rejects invalid ones", () => {
  assert.equal(validateTaskPackId("repo-health"), true);
  assert.equal(validateTaskPackId("a"), true);
  assert.equal(validateTaskPackId("abc"), true);
  assert.equal(validateTaskPackId("a-b-c"), true);
  assert.equal(validateTaskPackId(""), false);
  assert.equal(validateTaskPackId("-bad"), false);
  assert.equal(validateTaskPackId("BAD"), false);
});

test("normalizePath converts backslashes to forward slashes", () => {
  assert.equal(normalizePath("src\\index.ts"), "src/index.ts");
  assert.equal(normalizePath("src/index.ts"), "src/index.ts");
  assert.equal(normalizePath("a\\b\\c"), "a/b/c");
  assert.equal(normalizePath(""), "");
  assert.equal(normalizePath("/already/posix"), "/already/posix");
});

test("isPathInsideWorkspace detects path traversal", () => {
  assert.equal(isPathInsideWorkspace("/workspace", "/workspace/src/file.ts"), true);
  assert.equal(isPathInsideWorkspace("/workspace", "/workspace/../etc/passwd"), false);
  assert.equal(isPathInsideWorkspace("/workspace", "/workspace"), true);
  assert.equal(isPathInsideWorkspace("/workspace", "/workspace/src"), true);
  assert.equal(isPathInsideWorkspace("/workspace", "/etc/passwd"), false);
  assert.equal(isPathInsideWorkspace("/workspace", "/workspace/src/../../etc/passwd"), false);
});

test("safePathJoin throws on path traversal", () => {
  assert.throws(() => safePathJoin("/workspace", "..", "etc", "passwd"), /Path traversal detected/);
  assert.equal(safePathJoin("/workspace", "src", "file.ts").replace(/\\/g, "/"), "/workspace/src/file.ts");
  assert.equal(safePathJoin("/workspace", "src").replace(/\\/g, "/"), "/workspace/src");
  assert.equal(safePathJoin("/workspace").replace(/\\/g, "/"), "/workspace");
});

test("portableRelativePath returns relative paths with forward slashes", () => {
  assert.equal(portableRelativePath("/workspace", "/workspace/src/file.ts").replace(/\\/g, "/"), "src/file.ts");
  assert.equal(portableRelativePath("/workspace/src", "/workspace").replace(/\\/g, "/"), "..");
  assert.equal(portableRelativePath("/a/b", "/a/b/c/d").replace(/\\/g, "/"), "c/d");
});

test("portableBasename extracts the last path segment", () => {
  assert.equal(portableBasename("/workspace/src/file.ts"), "file.ts");
  assert.equal(portableBasename("/workspace"), "workspace");
  assert.equal(portableBasename("file.ts"), "file.ts");
});

test("isWindowsLikePath detects Windows-style paths", () => {
  assert.equal(isWindowsLikePath("C:\\Users\\test"), true);
  assert.equal(isWindowsLikePath("D:/Projects/file.ts"), true);
  assert.equal(isWindowsLikePath("/workspace/src"), false);
  assert.equal(isWindowsLikePath("relative/path"), false);
});

test("resolveRepoSource returns user repo for undefined or 'user'", () => {
  const result1 = resolveRepoSource(undefined, "/user/repo", "/builtin");
  assert.equal(result1.kind, "user");
  assert.equal(result1.repoPath, "/user/repo");

  const result2 = resolveRepoSource("user", "/user/repo", "/builtin");
  assert.equal(result2.kind, "user");
  assert.equal(result2.repoPath, "/user/repo");
});

test("resolveRepoSource resolves builtin:// to builtin repos root", () => {
  const result = resolveRepoSource("builtin://node-starter", "/user/repo", "/repos");
  assert.equal(result.kind, "builtin");
  assert.match(result.repoPath, /node-starter/);
});

test("resolveRepoSource rejects invalid builtin names and unsupported schemes", () => {
  assert.throws(() => resolveRepoSource("builtin://", "/user/repo", "/repos"), /Invalid builtin repo name/);
  assert.throws(() => resolveRepoSource("builtin://..", "/user/repo", "/repos"), /Invalid builtin repo name/);
  assert.throws(() => resolveRepoSource("builtin://a/b", "/user/repo", "/repos"), /Invalid builtin repo name/);
  assert.throws(() => resolveRepoSource("https://example.com/repo", "/user/repo", "/repos"), /Unsupported repoSource/);
});
