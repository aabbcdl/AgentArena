import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";

const LOCK_SCHEMA_VERSION = 1;

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLock(lockPath) {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8"));
    return value?.schemaVersion === LOCK_SCHEMA_VERSION
      && Number.isInteger(value.pid)
      && typeof value.token === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

async function reclaimStaleLock(lockPath, expectedToken) {
  const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) return false;
    throw error;
  }

  const moved = await readLock(stalePath);
  if (expectedToken && moved?.token !== expectedToken) {
    await rename(stalePath, lockPath).catch(() => {});
    return false;
  }
  await rm(stalePath, { force: true });
  return true;
}

export async function acquireFileLock(lockPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 250;
  const invalidLockGraceMs = options.invalidLockGraceMs ?? 1_000;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const token = randomUUID();
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({
          schemaVersion: LOCK_SCHEMA_VERSION,
          pid: process.pid,
          token,
          createdAt: new Date().toISOString()
        }), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }

      return {
        release: async () => {
          const current = await readLock(lockPath);
          if (current?.token === token) await rm(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const current = await readLock(lockPath);
      let stale = current ? !isProcessAlive(current.pid) : false;
      if (!current) {
        const lockStat = await stat(lockPath).catch(() => null);
        stale = Boolean(lockStat && Date.now() - lockStat.mtimeMs >= invalidLockGraceMs);
      }
      if (stale && await reclaimStaleLock(lockPath, current?.token)) continue;

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for web-report build lock at ${lockPath}.`);
      }
      await sleep(Math.min(retryMs, Math.max(1, deadline - Date.now())));
    }
  }
}
