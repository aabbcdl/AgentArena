import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRunId, ensureDirectory } from "@agentarena/core";
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
    // If statfs is not available (older Node), continue anyway
    if (error instanceof Error && error.message.startsWith("Insufficient disk space")) {
      throw error;
    }
    // statfs may not be available on all platforms, skip the check
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

  await ensureDirectory(outputRootPath);
  await ensureDirectory(outputPath);

  return { runId, outputPath, outputRootPath, workspaceRootPath };
}
