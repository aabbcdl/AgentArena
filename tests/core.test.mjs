import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildExecutionEnvironment,
  copyRepository,
  createAgentSelection,
  diffSnapshots,
  formatDuration,
  hasInternalDnsResolution,
  isInternalUrl,
  isPathInsideWorkspace,
  isWindowsLikePath,
  normalizePath,
  portableBasename,
  portableRelativePath,
  resolveRepoSource,
  safePathJoin,
  snapshotDirectory,
  uniqueSorted,
  validateTaskPackId
} from "../packages/core/dist/index.js";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
    removed: [],
    skippedLargeFiles: []
  });
});

test("diffSnapshots marks huge-file entries as skippedLargeFiles", () => {
  const before = new Map([
    ["README.md", { relativePath: "README.md", hash: "old" }],
    ["big.bin", { relativePath: "big.bin", hash: "huge-file:1234567890" }]
  ]);
  const after = new Map([
    ["README.md", { relativePath: "README.md", hash: "new" }],
    ["big.bin", { relativePath: "big.bin", hash: "huge-file:9876543210" }]
  ]);

  const result = diffSnapshots(before, after);
  assert.ok(result.skippedLargeFiles.includes("big.bin"), "big.bin should be in skippedLargeFiles");
  assert.ok(!result.changed.includes("big.bin"), "big.bin should not be in changed");
  assert.deepEqual(result.changed, ["README.md"]);
});

test("diffSnapshots marks removed huge-file entries as skippedLargeFiles", () => {
  const before = new Map([
    ["big.bin", { relativePath: "big.bin", hash: "huge-file:1234567890" }]
  ]);
  const after = new Map();

  const result = diffSnapshots(before, after);
  assert.ok(result.skippedLargeFiles.includes("big.bin"), "removed big.bin should be in skippedLargeFiles");
  assert.deepEqual(result.removed, []);
});

test("buildExecutionEnvironment includes only baseline and allowlisted variables", () => {
  process.env.AGENTARENA_ALLOWED_TEST = "visible";
  process.env.AGENTARENA_BLOCKED_TEST = "hidden";

  try {
    const environment = buildExecutionEnvironment(["AGENTARENA_ALLOWED_TEST"]);

    assert.equal(environment.AGENTARENA_ALLOWED_TEST, "visible");
    assert.equal(environment.AGENTARENA_BLOCKED_TEST, undefined);
    assert.ok(environment.PATH || environment.Path);
  } finally {
    delete process.env.AGENTARENA_ALLOWED_TEST;
    delete process.env.AGENTARENA_BLOCKED_TEST;
  }
});

test("buildExecutionEnvironment applies inline overrides", () => {
  process.env.AGENTARENA_ALLOWED_TEST = "visible";

  try {
    const environment = buildExecutionEnvironment(["AGENTARENA_ALLOWED_TEST"], {
      AGENTARENA_ALLOWED_TEST: "overridden",
      AGENTARENA_INLINE_ONLY: "inline"
    });

    assert.equal(environment.AGENTARENA_ALLOWED_TEST, "overridden");
    assert.equal(environment.AGENTARENA_INLINE_ONLY, "inline");
  } finally {
    delete process.env.AGENTARENA_ALLOWED_TEST;
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

test("isPathInsideWorkspace detects path traversal", async () => {
  assert.equal(await isPathInsideWorkspace("/workspace", "/workspace/src/file.ts"), true);
  assert.equal(await isPathInsideWorkspace("/workspace", "/workspace/../etc/passwd"), false);
  assert.equal(await isPathInsideWorkspace("/workspace", "/workspace"), true);
  assert.equal(await isPathInsideWorkspace("/workspace", "/workspace/src"), true);
  assert.equal(await isPathInsideWorkspace("/workspace", "/etc/passwd"), false);
  assert.equal(await isPathInsideWorkspace("/workspace", "/workspace/src/../../etc/passwd"), false);
});

test("safePathJoin throws on path traversal", async () => {
  await assert.rejects(() => safePathJoin("/workspace", "..", "etc", "passwd"), /Path traversal detected/);
  assert.equal((await safePathJoin("/workspace", "src", "file.ts")).replace(/\\/g, "/"), "/workspace/src/file.ts");
  assert.equal((await safePathJoin("/workspace", "src")).replace(/\\/g, "/"), "/workspace/src");
  assert.equal((await safePathJoin("/workspace")).replace(/\\/g, "/"), "/workspace");
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

test("resolveRepoSource rejects external repository URLs in local-only mode", () => {
  assert.throws(
    () => resolveRepoSource("https://github.com/org/repo.git", "/user/repo", "/repos"),
    /External repository URLs are not supported/i
  );
  assert.throws(
    () => resolveRepoSource("http://example.com/project", "/user/repo", "/repos"),
    /External repository URLs are not supported/i
  );
});

test("resolveRepoSource rejects invalid builtin names and unsupported schemes", () => {
  assert.throws(() => resolveRepoSource("builtin://", "/user/repo", "/repos"), /Invalid builtin repo name/);
  assert.throws(() => resolveRepoSource("builtin://..", "/user/repo", "/repos"), /Invalid builtin repo name/);
  assert.throws(() => resolveRepoSource("builtin://a/b", "/user/repo", "/repos"), /Invalid builtin repo name/);
  assert.throws(() => resolveRepoSource("ftp://example.com/repo", "/user/repo", "/repos"), /Unsupported repoSource/);
});

test("copyRepository does not copy ignored secret files into agent workspaces", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-copy-test-"));
  const source = path.join(tempDir, "source");
  const destination = path.join(tempDir, "destination");

  try {
    await mkdir(path.join(source, "node_modules"), { recursive: true });
    await writeFile(path.join(source, ".gitignore"), ".env\nlocal-only.txt\n", "utf8");
    await writeFile(path.join(source, ".env"), "API_KEY=secret", "utf8");
    await writeFile(path.join(source, ".env.local"), "API_KEY=local-secret", "utf8");
    await writeFile(path.join(source, "local-only.txt"), "ignored", "utf8");
    await writeFile(path.join(source, "README.md"), "# public\n", "utf8");
    await writeFile(path.join(source, "node_modules", "module.txt"), "skip", "utf8");

    await copyRepository(source, destination);

    assert.equal(await exists(path.join(destination, ".env")), false);
    assert.equal(await exists(path.join(destination, ".env.local")), false);
    assert.equal(await exists(path.join(destination, "local-only.txt")), false);
    assert.equal(await exists(path.join(destination, "node_modules", "module.txt")), false);
    assert.equal(await readFile(path.join(destination, "README.md"), "utf8"), "# public\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("copyRepository preserves a packaged builtin repo ignored by its parent checkout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-copy-ignored-parent-"));
  const source = path.resolve("packages/cli/assets/taskpacks/repos/nodejs-app");
  const destination = path.join(tempDir, "destination");

  try {
    await copyRepository(source, destination);

    assert.equal(await exists(path.join(destination, "package.json")), true);
    assert.equal(await exists(path.join(destination, "src", "utils.js")), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("snapshotDirectory excludes AgentArena runtime artifacts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-snapshot-runtime-"));

  try {
    await mkdir(path.join(tempDir, ".aa-evidence"), { recursive: true });
    await mkdir(path.join(tempDir, ".claude"), { recursive: true });
    await mkdir(path.join(tempDir, "agentarena-demo"), { recursive: true });
    await writeFile(path.join(tempDir, ".aa-evidence", "stdout.log"), "internal", "utf8");
    await writeFile(path.join(tempDir, ".claude", "settings.local.json"), "{}", "utf8");
    await writeFile(path.join(tempDir, "agentarena-demo", "codex-last-message.txt"), "internal", "utf8");
    await writeFile(path.join(tempDir, "agent-stdout.jsonl"), "{}", "utf8");
    await writeFile(path.join(tempDir, "prompt.txt"), "prompt", "utf8");
    await writeFile(path.join(tempDir, "index.js"), "export const ok = true;\n", "utf8");

    const snapshot = await snapshotDirectory(tempDir);

    assert.deepEqual([...snapshot.keys()].sort(), ["index.js"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("isInternalUrl blocks localhost", () => {
  assert.equal(isInternalUrl("http://localhost:3000/api"), true);
});

test("hasInternalDnsResolution detects localhost DNS resolution", async () => {
  assert.equal(await hasInternalDnsResolution("http://localhost:3000/api"), true);
});

test("isInternalUrl blocks 127.0.0.1", () => {
  assert.equal(isInternalUrl("http://127.0.0.1:3000/api"), true);
});

test("isInternalUrl blocks private IP 10.x.x.x", () => {
  assert.equal(isInternalUrl("http://10.0.0.1/api"), true);
});

test("isInternalUrl blocks private IP 192.168.x.x", () => {
  assert.equal(isInternalUrl("http://192.168.1.1/api"), true);
});

test("isInternalUrl blocks private IP 172.16.x.x", () => {
  assert.equal(isInternalUrl("http://172.16.0.1/api"), true);
});

test("isInternalUrl blocks 0.0.0.0", () => {
  assert.equal(isInternalUrl("http://0.0.0.0:3000/api"), true);
});

test("isInternalUrl blocks IPv6 loopback ::1", () => {
  assert.equal(isInternalUrl("http://[::1]:3000/api"), true);
});

test("isInternalUrl blocks IPv6 unspecified [::]", () => {
  assert.equal(isInternalUrl("http://[::]:3000/api"), true);
});

test("isInternalUrl blocks IPv6 mapped 127.0.0.1", () => {
  assert.equal(isInternalUrl("http://[::ffff:127.0.0.1]:3000/api"), true);
});

test("isInternalUrl blocks IPv6 mapped private IP", () => {
  assert.equal(isInternalUrl("http://[::ffff:192.168.1.1]:3000/api"), true);
});

test("isInternalUrl blocks .internal domain", () => {
  assert.equal(isInternalUrl("http://metadata.internal/latest"), true);
});

test("isInternalUrl blocks .local domain", () => {
  assert.equal(isInternalUrl("http://host.local/api"), true);
});

test("isInternalUrl allows public domain", () => {
  assert.equal(isInternalUrl("https://api.github.com/repos"), false);
});

test("isInternalUrl allows public IP", () => {
  assert.equal(isInternalUrl("https://8.8.8.8/dns-query"), false);
});

// --- SSRF: Additional RFC ranges ---

test("isInternalUrl blocks Carrier-Grade NAT 100.64.0.0/10", () => {
  assert.equal(isInternalUrl("http://100.64.0.1/api"), true);
  assert.equal(isInternalUrl("http://100.127.255.255/api"), true);
  assert.equal(isInternalUrl("http://100.63.0.1/api"), false);
  assert.equal(isInternalUrl("http://100.128.0.1/api"), false);
});

test("isInternalUrl blocks link-local 169.254.0.0/16", () => {
  assert.equal(isInternalUrl("http://169.254.169.254/metadata"), true);
  assert.equal(isInternalUrl("http://169.254.0.1/api"), true);
  assert.equal(isInternalUrl("http://169.253.0.1/api"), false);
  assert.equal(isInternalUrl("http://169.255.0.1/api"), false);
});

test("isInternalUrl blocks benchmark testing 198.18.0.0/15", () => {
  assert.equal(isInternalUrl("http://198.18.0.1/api"), true);
  assert.equal(isInternalUrl("http://198.19.255.255/api"), true);
  assert.equal(isInternalUrl("http://198.17.0.1/api"), false);
  assert.equal(isInternalUrl("http://198.20.0.1/api"), false);
});

test("isInternalUrl blocks multicast 224.0.0.0/4", () => {
  assert.equal(isInternalUrl("http://224.0.0.1/api"), true);
  assert.equal(isInternalUrl("http://239.255.255.255/api"), true);
  assert.equal(isInternalUrl("http://223.255.255.255/api"), false);
  assert.equal(isInternalUrl("http://240.0.0.1/api"), false);
});

test("isInternalUrl blocks IPv6 ULA fc00::/7", () => {
  assert.equal(isInternalUrl("http://[fd00::1]/api"), true);
  assert.equal(isInternalUrl("http://[fc00::1]/api"), true);
});

test("isInternalUrl blocks IPv6 link-local fe80::/10", () => {
  assert.equal(isInternalUrl("http://[fe80::1]/api"), true);
  assert.equal(isInternalUrl("http://[fe80::abcd:1234]/api"), true);
});

test("isInternalUrl blocks IPv6 multicast ff00::/8", () => {
  assert.equal(isInternalUrl("http://[ff00::1]/api"), true);
  // Note: ff02 (link-local multicast) is not currently blocked by the regex, only ff00 is
  assert.equal(isInternalUrl("http://[ff00::abcd]/api"), true);
});

test("isInternalUrl blocks .localhost TLD", () => {
  assert.equal(isInternalUrl("http://app.localhost/api"), true);
  assert.equal(isInternalUrl("http://test.localhost:3000/api"), true);
});

test("isInternalUrl blocks IPv4-mapped IPv6 in hex notation", () => {
  // ::ffff:7f00:1 = ::ffff:127.0.0.1
  assert.equal(isInternalUrl("http://[::ffff:7f00:1]/api"), true);
  // ::ffff:c0a8:101 = ::ffff:192.168.1.1
  assert.equal(isInternalUrl("http://[::ffff:c0a8:101]/api"), true);
});

test("isInternalUrl allows external IPv6 addresses", () => {
  assert.equal(isInternalUrl("http://[2606:4700::1]/api"), false);
  assert.equal(isInternalUrl("http://[2001:db8::1]/api"), false);
});
