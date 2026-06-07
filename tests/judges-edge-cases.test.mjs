// Allow inline node -e in test fixture task packs. Production task packs
// should use script files; tests use inline scripts for brevity.
process.env.AGENTARENA_ALLOW_EVAL_IN_JUDGES = "1";

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runJudge, runJudges } from "../packages/judges/dist/index.js";

// Helper to create a temporary workspace
async function createTempWorkspace() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "judge-test-"));
  return tmpDir;
}

// Helper to clean up temp workspace
async function cleanupTempWorkspace(tmpDir) {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort: cleanup */ }
}

// Test file-exists judge
test("file-exists judge: passes when file exists", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "content");
    const result = await runJudge(
      { type: "file-exists", id: "test", label: "Test", path: "test.txt" },
      tmpDir,
      []
    );
    assert.equal(result.success, true);
    assert.equal(result.type, "file-exists");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("file-exists judge: fails when file does not exist", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    const result = await runJudge(
      { type: "file-exists", id: "test", label: "Test", path: "nonexistent.txt" },
      tmpDir,
      []
    );
    assert.equal(result.success, false);
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test directory-exists judge
test("directory-exists judge: passes when directory exists", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.mkdir(path.join(tmpDir, "subdir"));
    const result = await runJudge(
      { type: "directory-exists", id: "test", label: "Test", path: "subdir" },
      tmpDir,
      []
    );
    assert.equal(result.success, true);
    assert.equal(result.type, "directory-exists");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("directory-exists judge: fails when directory does not exist", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    const result = await runJudge(
      { type: "directory-exists", id: "test", label: "Test", path: "nonexistent" },
      tmpDir,
      []
    );
    assert.equal(result.success, false);
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test file-contains judge
test("file-contains judge: passes when pattern matches", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "hello world\nfoo bar\nbaz");
    const result = await runJudge(
      { type: "file-contains", id: "test", label: "Test", path: "test.txt", pattern: "foo bar", regex: false },
      tmpDir,
      []
    );
    assert.equal(result.success, true);
    assert.equal(result.type, "file-contains");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("file-contains judge: passes when regex pattern matches", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "hello world\nfoo bar\nbaz");
    const result = await runJudge(
      { type: "file-contains", id: "test", label: "Test", path: "test.txt", pattern: "foo.*bar", regex: true },
      tmpDir,
      []
    );
    assert.equal(result.success, true);
    assert.equal(result.type, "file-contains");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("file-contains judge: fails when pattern does not match", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "hello world");
    const result = await runJudge(
      { type: "file-contains", id: "test", label: "Test", path: "test.txt", pattern: "foo bar", regex: false },
      tmpDir,
      []
    );
    assert.equal(result.success, false);
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test glob judge
test("glob judge: passes when pattern matches files", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "test.js"), "content");
    await fs.writeFile(path.join(tmpDir, "test2.js"), "content");
    const result = await runJudge(
      { type: "glob", id: "test", label: "Test", pattern: "*.js", minMatches: 1 },
      tmpDir,
      []
    );
    assert.equal(result.success, true);
    assert.equal(result.type, "glob");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("glob judge: fails when no files match", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "content");
    const result = await runJudge(
      { type: "glob", id: "test", label: "Test", pattern: "*.js", minMatches: 1 },
      tmpDir,
      []
    );
    assert.equal(result.success, false);
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test file-count judge
test("file-count judge: passes when count is within range", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "a.js"), "content");
    await fs.writeFile(path.join(tmpDir, "b.js"), "content");
    const result = await runJudge(
      { type: "file-count", id: "test", label: "Test", pattern: "*.js", min: 1, max: 5 },
      tmpDir,
      []
    );
    assert.equal(result.success, true);
    assert.equal(result.type, "file-count");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("file-count judge: fails when count is below minimum", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "a.js"), "content");
    const result = await runJudge(
      { type: "file-count", id: "test", label: "Test", pattern: "*.js", min: 5 },
      tmpDir,
      []
    );
    assert.equal(result.success, false);
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test token-efficiency judge
test("token-efficiency judge: passes when under budget", async () => {
  const result = await runJudge(
    { type: "token-efficiency", id: "test", label: "Test", tokenBudget: 10000 },
    "/tmp",
    [],
    { tokenUsage: 5000 }
  );
  assert.equal(result.success, true);
  assert.equal(result.type, "token-efficiency");
});

test("token-efficiency judge: fails when over budget", async () => {
  const result = await runJudge(
    { type: "token-efficiency", id: "test", label: "Test", tokenBudget: 1000 },
    "/tmp",
    [],
    { tokenUsage: 5000 }
  );
  assert.equal(result.success, false);
});

// Test command judge with non-UTF-8 output
test("command judge: handles non-UTF-8 stdout gracefully", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    // Create a script that outputs binary data
    const scriptContent = process.platform === "win32"
      ? '@echo off\necho hello'
      : '#!/bin/sh\necho hello';
    const scriptPath = path.join(tmpDir, process.platform === "win32" ? "test.bat" : "test.sh");
    await fs.writeFile(scriptPath, scriptContent);
    if (process.platform !== "win32") {
      await fs.chmod(scriptPath, 0o755);
    }

    const command = process.platform === "win32"
      ? `node -e "process.stdout.write(Buffer.from([0x80, 0x81, 0x82]))"`
      : `node -e "process.stdout.write(Buffer.from([0x80, 0x81, 0x82]))"`;

    const result = await runJudge(
      { type: "command", id: "test", label: "Test", command, timeoutMs: 5000 },
      tmpDir,
      []
    );
    // Should complete without throwing
    assert.ok(typeof result.success === "boolean");
    assert.ok(typeof result.exitCode === "number");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test command judge with timeout
test("command judge: handles timeout correctly", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    // Cross-platform sleep via node -e (avoids OS-specific `sleep`/`timeout` commands
    // that are not in the judge command allowlist).
    const command = 'node -e "setTimeout(()=>process.exit(0), 10000)"';

    const result = await runJudge(
      { type: "command", id: "test", label: "Test", command, timeoutMs: 100 },
      tmpDir,
      []
    );
    // Should complete (either success or failure, but not hang)
    assert.ok(typeof result.success === "boolean");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test command judge with crash (exit code -1)
test("command judge: handles process crash gracefully", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    const command = 'node -e "process.exit(1)"';

    const result = await runJudge(
      { type: "command", id: "test", label: "Test", command, timeoutMs: 5000 },
      tmpDir,
      []
    );
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test snapshot judge with non-git workspace
test("snapshot judge: handles non-git workspace gracefully", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    // Create a snapshot file
    const snapshotPath = path.join(tmpDir, "snapshot.json");
    await fs.writeFile(snapshotPath, JSON.stringify({ files: [] }));

    const result = await runJudge(
      { type: "snapshot", id: "test", label: "Test", path: ".", snapshotPath: "snapshot.json" },
      tmpDir,
      []
    );
    // Should complete without throwing
    assert.ok(typeof result.success === "boolean");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

// Test runJudges with multiple judges
test("runJudges: runs multiple judges in correct order", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "content");

    const judges = [
      { type: "file-exists", id: "fe", label: "File Exists", path: "test.txt" },
      { type: "directory-exists", id: "de", label: "Dir Exists", path: "." },
    ];

    const results = await runJudges(judges, tmpDir, []);
    assert.equal(results.length, 2);
    assert.equal(results[0].type, "file-exists");
    assert.equal(results[1].type, "directory-exists");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("directory-exists rejects path traversal", async () => {
  const tmpDir = await createTempWorkspace();
  try {
    const judge = {
      type: "directory-exists",
      id: "de-traversal",
      label: "Dir Traversal",
      path: "../../../etc",
    };

    const result = await runJudge(judge, tmpDir, []);
    assert.equal(result.success, false, "path traversal should be rejected");
    assert.ok(result.stderr.includes("outside") || result.stderr.includes("traversal") || result.stderr.includes("Path"), `Error should mention path issue: ${result.stderr}`);
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});

test("compilation judge type is registered", async () => {
  // Verify the compilation judge can be invoked (even if it fails due to missing setup)
  const tmpDir = await createTempWorkspace();
  try {
    const judge = {
      type: "compilation",
      id: "compile-test",
      label: "Compile Check",
      command: "node --check nonexistent.js",
    };

    const result = await runJudge(judge, tmpDir, []);
    assert.equal(result.type, "compilation");
    assert.equal(typeof result.success, "boolean");
  } finally {
    await cleanupTempWorkspace(tmpDir);
  }
});
