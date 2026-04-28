import path from "node:path";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult
} from "@agentarena/core";
import { ClaudeLikeAdapter } from "./claude-adapter.js";
import { findExecutableOnPath, pathExists } from "./process-utils.js";
import { CURSOR_CAPABILITY, type InvocationSpec } from "./shared.js";

/**
 * Try to derive the cursor-agent CLI path from a Cursor binary path.
 * Multiple path patterns are attempted for version compatibility.
 */
async function cursorAgentCliFromBinary(binaryPath: string): Promise<string | undefined> {
  const binaryDir = path.dirname(binaryPath);

  // Pattern 1: Current known structure
  const pattern1 = path.resolve(
    binaryDir,
    "..",
    "extensions",
    "cursor-agent",
    "dist",
    "claude-agent-sdk",
    "cli.js"
  );
  // Pattern 2: Alternative structure (older/newer versions)
  const pattern2 = path.resolve(
    binaryDir,
    "..",
    "resources",
    "app",
    "extensions",
    "cursor-agent",
    "dist",
    "claude-agent-sdk",
    "cli.js"
  );
  // Pattern 3: Flat structure
  const pattern3 = path.resolve(
    binaryDir,
    "..",
    "extensions",
    "cursor-agent",
    "cli.js"
  );

  // Return the first existing path, or undefined if none exist
  const patterns = [pattern1, pattern2, pattern3];
  for (const p of patterns) {
    if (await pathExists(p)) {
      return p;
    }
  }
  return undefined;
}

async function resolveCursorAgentCliPath(): Promise<string | undefined> {
  if (process.env.AGENTARENA_CURSOR_AGENT_CLI?.trim()) {
    const explicitPath = process.env.AGENTARENA_CURSOR_AGENT_CLI.trim();
    if (await pathExists(explicitPath)) {
      return explicitPath;
    }
  }

  const pathBinary = await findExecutableOnPath(
    process.platform === "win32" ? ["cursor.cmd", "cursor.exe", "cursor"] : ["cursor"]
  );
  if (pathBinary) {
    const derivedCliPath = await cursorAgentCliFromBinary(pathBinary);
    if (derivedCliPath && await pathExists(derivedCliPath)) {
      return derivedCliPath;
    }
  }

  const installRoots = process.platform === "win32"
    ? [
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Cursor", "resources", "app", "bin", "cursor.cmd"),
        path.join(process.env.ProgramFiles ?? "", "Cursor", "resources", "app", "bin", "cursor.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Cursor", "bin", "cursor.cmd")
      ]
    : [
        "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        path.join(process.env.HOME ?? "", ".local", "bin", "cursor"),
        path.join(process.env.HOME ?? "", ".cursor", "bin", "cursor")
      ];

  for (const candidate of installRoots) {
    if (!(await pathExists(candidate))) {
      continue;
    }

    const derivedCliPath = await cursorAgentCliFromBinary(candidate);
    if (derivedCliPath && await pathExists(derivedCliPath)) {
      return derivedCliPath;
    }
  }

  return undefined;
}

async function resolveCursorInvocation(): Promise<InvocationSpec> {
  if (process.env.AGENTARENA_CURSOR_BIN?.trim()) {
    const command = process.env.AGENTARENA_CURSOR_BIN.trim();
    return { command, argsPrefix: [], displayCommand: command };
  }

  const cursorAgentCliPath = await resolveCursorAgentCliPath();
  if (cursorAgentCliPath) {
    return {
      command: process.execPath,
      argsPrefix: [cursorAgentCliPath],
      displayCommand: `${process.execPath} ${cursorAgentCliPath}`
    };
  }

  return {
    command: "cursor",
    argsPrefix: [],
    displayCommand: "cursor"
  };
}

export { cursorAgentCliFromBinary, resolveCursorAgentCliPath, resolveCursorInvocation };

export class CursorAdapter extends ClaudeLikeAdapter {
  readonly kind = "external" as const;
  readonly id = "cursor";
  readonly title = "Cursor Agent";
  readonly capability = CURSOR_CAPABILITY;

  protected async resolveInvocation(): Promise<InvocationSpec> {
    return await resolveCursorInvocation();
  }

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    return await super.preflight(options);
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    return await this.executeClaudeLike(context, "adapter.cursor.result", "Cursor");
  }
}
