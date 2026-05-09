import { promises as fs } from "node:fs";

const WORKSPACE_CLEANUP_MAX_RETRIES = 3;
const WORKSPACE_CLEANUP_RETRY_DELAY_MS = 1000;

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

export function debugLog(enabled: boolean, ...args: unknown[]): void {
  if (enabled) {
    console.error("[debug]", ...args);
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
      if (attempt < retries) {
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
