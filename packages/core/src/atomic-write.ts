/**
 * @module atomic-write
 *
 * Atomic file writes with fsync + Windows rename fallback.
 *
 * Pattern: write to a temp file in the SAME directory as the target, fsync,
 * then rename. If an existing destination cannot be replaced directly, move
 * the old file to a recoverable backup, install the new file, then remove the
 * backup. A later write restores the backup if a previous process stopped in
 * the middle of that fallback.
 *
 * The temp file is named with PID + monotonic counter to avoid collisions
 * when multiple processes write the same target concurrently.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

let monotonicCounter = 0;

function backupPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.bak`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "EINVAL" && code !== "EPERM" && code !== "EACCES" && code !== "EISDIR") {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function recoverInterruptedReplacement(filePath: string, backupPath: string): Promise<void> {
  if (!(await pathExists(backupPath))) {
    return;
  }
  if (await pathExists(filePath)) {
    await fs.rm(backupPath, { force: true });
    return;
  }
  await fs.rename(backupPath, filePath);
  await syncDirectory(path.dirname(filePath));
}

export async function recoverAtomicFile(filePath: string): Promise<void> {
  await recoverInterruptedReplacement(filePath, backupPathFor(filePath));
}

function isReplaceConflict(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EEXIST" || code === "EPERM" || code === "EACCES";
}

export async function writeAtomic(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  const backupPath = backupPathFor(filePath);
  await recoverInterruptedReplacement(filePath, backupPath);

  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}.${monotonicCounter++}`
  );

  let fileHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    fileHandle = await fs.open(tmp, "w");
    await fileHandle.write(data, null, "utf8");
    await fileHandle.sync();
  } catch (error) {
    await fileHandle?.close().catch(() => {});
    fileHandle = undefined;
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fileHandle?.close().catch(() => {});
  }

  try {
    await fs.rename(tmp, filePath);
    await syncDirectory(dir);
    return;
  } catch (error) {
    if (!isReplaceConflict(error) || !(await pathExists(filePath))) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }

  await fs.rm(backupPath, { force: true });
  try {
    await fs.rename(filePath, backupPath);
    await syncDirectory(dir);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }

  try {
    await fs.rename(tmp, filePath);
    await syncDirectory(dir);
  } catch (replacementError) {
    let restoreError: unknown;
    try {
      if (!(await pathExists(filePath)) && await pathExists(backupPath)) {
        await fs.rename(backupPath, filePath);
        await syncDirectory(dir);
      }
    } catch (error) {
      restoreError = error;
    }
    await fs.rm(tmp, { force: true }).catch(() => {});
    if (restoreError) {
      throw new AggregateError(
        [replacementError, restoreError],
        `Atomic replacement failed for "${filePath}" and the previous file could not be restored.`
      );
    }
    throw replacementError;
  }

  await fs.rm(backupPath, { force: true });
  await syncDirectory(dir);
}

/**
 * Write JSON with atomic semantics. Convenience wrapper that serializes
 * and formats with 2-space indentation.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeAtomic(filePath, JSON.stringify(value, null, 2));
}
