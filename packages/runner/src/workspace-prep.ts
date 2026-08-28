import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRunId, ensureDirectory, logger } from "@agentarena/core";
import { formatErrorDetails } from "./workspace.js";

const MIN_FREE_SPACE_BYTES = 500 * 1024 * 1024;

export interface WorkspacePrepOptions {
  runId?: string;
  outputPath?: string;
  repoPath: string;
}

export interface WorkspacePrep {
  runId: string;
  outputPath: string;
  outputRootPath: string;
  workspaceRootPath: string;
}

export async function prepareWorkspace(options: WorkspacePrepOptions): Promise<WorkspacePrep> {
  const runId = options.runId ?? createRunId();
  const outputRootPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(path.resolve(options.repoPath), ".agentarena", "runs");
  const outputPath = path.join(outputRootPath, runId);

  // Check disk space before creating temp directory (need at least 500MB free)
  try {
    const stats = await fs.statfs(tmpdir());
    const freeBytes = stats.bavail * stats.bsize;
    if (freeBytes < MIN_FREE_SPACE_BYTES) {
      const freeMB = Math.round(freeBytes / (1024 * 1024));
      throw new Error(
        `Insufficient disk space in temp directory "${tmpdir()}": ` +
        `need at least 500MB free, found ${freeMB}MB. ` +
        `Free up disk space and try again.`
      );
    }
  } catch (error) {
    // The explicit "Insufficient disk space" error must always propagate.
    if (error instanceof Error && error.message.startsWith("Insufficient disk space")) {
      throw error;
    }
    // statfs may be unsupported on some platforms/filesystems (ENOSYS/ENOTSUP).
    // In that case the guard is simply skipped. Any OTHER filesystem error is
    // unexpected and is surfaced (not silently swallowed) so the guard's
    // failure is visible rather than masking a real disk problem.
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOSYS" || code === "ENOTSUP" || code === "EOPNOTSUPP") {
      logger.debug(
        "runner",
        "workspace_prep.disk_check_unsupported",
        `Disk space precheck skipped because statfs is unsupported: ${code}`
      );
    } else {
      logger.warn(
        "runner",
        "workspace_prep.disk_check_skipped",
        `Disk space precheck skipped due to unexpected error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  let workspaceRootPath: string;
  try {
    workspaceRootPath = await fs.mkdtemp(
      path.join(tmpdir(), `agentarena-workspaces-${runId.replace(/[^a-zA-Z0-9_-]+/g, "-")}-`)
    );
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    const isEnospc = (error as NodeJS.ErrnoException).code === "ENOSPC";
    const message = isEnospc
      ? `Disk full: failed to create workspace directory in "${tmpdir()}". Free up disk space and try again.`
      : `Failed to create workspace directory in "${tmpdir()}": ${errorDetails.message}. Check available disk space and permissions.`;
    throw new Error(message);
  }

  try {
    await ensureDirectory(outputRootPath);
    await ensureDirectory(outputPath);
  } catch (error) {
    try {
      await fs.rm(workspaceRootPath, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn(
        "runner",
        "workspace_prep.cleanup_failed",
        `Failed to clean workspace root after output initialization failed: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`
      );
    }
    throw error;
  }

  return { runId, outputPath, outputRootPath, workspaceRootPath };
}
