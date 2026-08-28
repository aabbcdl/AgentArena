import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireFileLock } from "../apps/web-report/scripts/build-lock.mjs";

test("web-report build lock recovers a lock owned by a dead process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarena-build-lock-"));
  const lockPath = path.join(root, ".build.lock");
  try {
    await writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      pid: 424242,
      token: "orphaned",
      createdAt: new Date().toISOString()
    }), "utf8");

    const lock = await acquireFileLock(lockPath, {
      timeoutMs: 100,
      retryMs: 5,
      isProcessAlive: () => false
    });
    const current = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(current.pid, process.pid);
    assert.notEqual(current.token, "orphaned");
    await lock.release();
    await assert.rejects(() => readFile(lockPath, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("web-report build lock never steals a lock from a live process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarena-build-lock-live-"));
  const lockPath = path.join(root, ".build.lock");
  const contents = JSON.stringify({
    schemaVersion: 1,
    pid: 7,
    token: "active",
    createdAt: new Date().toISOString()
  });
  try {
    await writeFile(lockPath, contents, "utf8");
    await assert.rejects(
      () => acquireFileLock(lockPath, {
        timeoutMs: 20,
        retryMs: 5,
        isProcessAlive: () => true
      }),
      /Timed out waiting/
    );
    assert.equal(await readFile(lockPath, "utf8"), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
