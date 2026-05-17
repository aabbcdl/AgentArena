/**
 * Workspace path boundary validation for agent execution.
 *
 * IMPORTANT: Advisory Isolation Only
 *
 * This sandbox validates that file paths stay within the workspace directory.
 * It does NOT provide:
 * - Process-level isolation (no containers, no namespaces)
 * - Network isolation
 * - Filesystem mount restrictions
 * - Privilege separation
 *
 * An adapter can bypass this sandbox entirely by not calling validate().
 * The sandbox catches accidental path escapes in well-behaved adapters,
 * not malicious code.
 *
 * Modes:
 * - "off": no validation (returns true always)
 * - "warn": logs violation + trace event, returns false, does not throw
 * - "strict" (default): throws Error on violation
 */

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
  mode: SandboxMode = "strict"
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
      }).catch((err: unknown) => {
        console.error("[sandbox] trace write failed:", err instanceof Error ? err.message : String(err));
      });
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
  mode: SandboxMode = "strict"
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
