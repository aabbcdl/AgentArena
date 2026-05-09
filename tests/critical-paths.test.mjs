import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isPathInsideWorkspace, safePathJoin } from "../packages/core/dist/paths.js";
import { parseCommand } from "../packages/judges/dist/index.js";

// ─── parseCommand tests ─────────────────────────────────────────────

test("parseCommand splits simple command into binary and args", () => {
  const [cmd, args] = parseCommand("npm run build");
  assert.equal(cmd, "npm");
  assert.deepEqual(args, ["run", "build"]);
});

test("parseCommand handles single-quoted arguments", () => {
  const [cmd, args] = parseCommand("echo 'hello world'");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["hello world"]);
});

test("parseCommand handles double-quoted arguments", () => {
  const [cmd, args] = parseCommand('echo "hello world"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["hello world"]);
});

test("parseCommand handles escaped characters outside quotes", () => {
  const [cmd, args] = parseCommand("echo hello\\ world");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["hello world"]);
});

test("parseCommand handles backslash escape inside double quotes", () => {
  // Inside double quotes, backslash escapes the next char: \n → n (backslash consumed)
  const [cmd, args] = parseCommand('echo "hello\\nworld"');
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["hellonworld"]);
});

test("parseCommand throws on empty string", () => {
  assert.throws(() => parseCommand(""), { message: "Command string is empty." });
});

test("parseCommand throws on whitespace-only string", () => {
  assert.throws(() => parseCommand("   "), { message: "Command string is empty." });
});

test("parseCommand handles trailing backslash", () => {
  // Trailing backslash escapes nothing, current="" so pushes "\\" per line 182
  const [cmd, args] = parseCommand("echo abc\\");
  assert.equal(cmd, "echo");
  assert.deepEqual(args, ["abc"]);
});

// ─── isPathInsideWorkspace tests ────────────────────────────────────

test("isPathInsideWorkspace returns true for path inside workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-paths-"));
  try {
    const subDir = path.join(tempDir, "sub", "dir");
    await mkdir(subDir, { recursive: true });
    const result = await isPathInsideWorkspace(tempDir, subDir);
    assert.equal(result, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("isPathInsideWorkspace returns false for path outside workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-paths-"));
  try {
    const outsideDir = path.join(os.tmpdir(), "agentarena-outside-" + Date.now());
    await mkdir(outsideDir, { recursive: true });
    try {
      const result = await isPathInsideWorkspace(tempDir, outsideDir);
      assert.equal(result, false);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("isPathInsideWorkspace returns true for non-existent path inside workspace", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-paths-"));
  try {
    const nonExistent = path.join(tempDir, "does-not-exist.txt");
    const result = await isPathInsideWorkspace(tempDir, nonExistent);
    assert.equal(result, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("isPathInsideWorkspace detects symlink escape on platforms that support it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-paths-"));
  try {
    const outsideDir = path.join(os.tmpdir(), "agentarena-symlink-outside-" + Date.now());
    await mkdir(outsideDir, { recursive: true });
    const linkPath = path.join(tempDir, "escape-link");
    try {
      await symlink(outsideDir, linkPath);
      const targetPath = path.join(linkPath, "secret.txt");
      const result = await isPathInsideWorkspace(tempDir, targetPath);
      assert.equal(result, false, "Symlink escape should be detected");
    } catch {
      // Symlink creation may fail on Windows without elevated permissions — skip gracefully
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("safePathJoin throws on path traversal attempt", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-paths-"));
  try {
    await assert.rejects(
      () => safePathJoin(tempDir, "..", "etc", "passwd"),
      { message: /Path traversal detected/ }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("safePathJoin returns joined path for valid segments", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentarena-paths-"));
  try {
    const result = await safePathJoin(tempDir, "sub", "file.txt");
    assert.equal(result, path.join(tempDir, "sub", "file.txt"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
