import { promises as fs } from "node:fs";
import { logger } from "@agentarena/core";

const WORKSPACE_CLEANUP_MAX_RETRIES = 3;
const WORKSPACE_CLEANUP_RETRY_DELAY_MS = 1000;

/** Error codes that are safe to retry (transient file-lock issues). */
const TRANSIENT_ERROR_CODES = new Set(["EBUSY", "ETXTBSY", "ENOTEMPTY"]);

/** Error codes that should never be retried (permanent failures). */
const PERMANENT_ERROR_CODES = new Set(["EPERM", "EACCES", "ENOSPC", "ENOENT"]);

export interface WorkspaceCleanupResult {
  success: boolean;
  path: string;
  error?: string;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export function debugLog(enabled: boolean, message: string, metadata?: Record<string, unknown>): void {
  if (enabled) {
    logger.debug("runner", "workspace.debug", message, metadata ? { metadata } : undefined);
  }
}

export function formatErrorDetails(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      code: (error as NodeJS.ErrnoException).code
    };
  }
  return { message: String(error) };
}

export async function cleanupWorkspace(workspacePath: string, retries = WORKSPACE_CLEANUP_MAX_RETRIES): Promise<WorkspaceCleanupResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      return { success: true, path: workspacePath };
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      // Skip retries for permanent errors — they will never resolve with a delay.
      if (code && PERMANENT_ERROR_CODES.has(code)) {
        const errorDetails = formatErrorDetails(error);
        return {
          success: false,
          path: workspacePath,
          error: `Unrecoverable error (${code}): ${errorDetails.message}`
        };
      }
      // Only retry for known transient errors or unknown codes.
      if (attempt < retries && (!code || TRANSIENT_ERROR_CODES.has(code))) {
        await new Promise(resolve => setTimeout(resolve, WORKSPACE_CLEANUP_RETRY_DELAY_MS));
      } else if (attempt < retries) {
        // Unknown error code — still retry but log it.
        logger.debug("runner", "workspace.cleanup", `Retrying after unknown error code: ${code}`);
        await new Promise(resolve => setTimeout(resolve, WORKSPACE_CLEANUP_RETRY_DELAY_MS));
      }
    }
  }
  const errorDetails = formatErrorDetails(lastError);
  return {
    success: false,
    path: workspacePath,
    error: `Failed after ${retries} attempts: ${errorDetails.message}`
  };
}
