
import { isPathInsideWorkspace } from "./paths.js";

export type SandboxMode = "off" | "warn" | "strict";

/**
 * Validate that a target path is within the workspace boundary.
 * Logs violations via the trace function.
 *
 * @returns true if the path is inside the workspace, false otherwise
 */
export async function validateWorkspacePath(
  workspacePath: string,
  targetPath: string,
  context: string,
  trace: ((event: { type: string; message: string; metadata?: Record<string, unknown> }) => Promise<void>) | undefined,
  mode: SandboxMode = "warn"
): Promise<boolean> {
  if (mode === "off") return true;

  const inside = await isPathInsideWorkspace(workspacePath, targetPath);
  if (!inside) {
    const message = `[sandbox] Path access outside workspace blocked: ${context} attempted to access "${targetPath}" (workspace: "${workspacePath}")`;
    if (trace) {
      await trace({
        type: "sandbox.violation",
        message,
        metadata: { context, targetPath, workspacePath, mode }
      }).catch(() => {});
    }
    if (mode === "strict") {
      throw new Error(message);
    }
    console.warn(message);
    return false;
  }
  return true;
}

/**
 * Create a sandboxed file access helper bound to a specific workspace.
 */
export function createWorkspaceSandbox(
  workspacePath: string,
  trace: ((event: { type: string; message: string; metadata?: Record<string, unknown> }) => Promise<void>) | undefined,
  mode: SandboxMode = "warn"
) {
  return {
    async validate(targetPath: string, context: string): Promise<boolean> {
      return validateWorkspacePath(workspacePath, targetPath, context, trace, mode);
    },
    async validateOrThrow(targetPath: string, context: string): Promise<void> {
      await validateWorkspacePath(workspacePath, targetPath, context, trace, "strict");
    }
  };
}
