import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdapterPreflightResult } from "@agentarena/core";
import { ensureDirectory } from "@agentarena/core";
import type { InvocationSpec } from "./adapter-capabilities.js";
import { adapterWarn } from "./adapter-diagnostics.js";
import { writeClaudeWorkspaceSettings } from "./claude-provider-profiles.js";
import { parseClaudeEvents } from "./event-parsers.js";
import type { ProcessResult } from "./process-utils.js";
import { runProcess } from "./process-utils.js";

interface VersionProbeResult {
  version?: string;
  source: "version-command" | "package-file" | "unknown";
  note?: string;
}

function extractVersionToken(value: string): string | undefined {
  const semverMatch = value.match(/\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/);
  if (semverMatch?.[0]) {
    return semverMatch[0];
  }

  const looseMatch = value.match(/\b\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/);
  return looseMatch?.[0];
}

const MAX_PACKAGE_TRAVERSE_DEPTH = 10;

async function readPackageVersion(startPath: string): Promise<string | undefined> {
  let currentPath = path.resolve(startPath);
  const { root } = path.parse(currentPath);

  for (let depth = 0; depth < MAX_PACKAGE_TRAVERSE_DEPTH && currentPath !== root; depth++) {
    const packagePath = path.join(currentPath, "package.json");
    try {
      const contents = await fs.readFile(packagePath, "utf8");
      const parsed = JSON.parse(contents) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Ignore package lookup failures while walking upward.
    }

    currentPath = path.dirname(currentPath);
  }

  return undefined;
}

let adaptersPackageVersionCache: { value: Promise<string | undefined> } | null = null;

export async function getAdaptersPackageVersion(): Promise<string | undefined> {
  if (!adaptersPackageVersionCache) {
    const promise = readPackageVersion(path.join(import.meta.dirname, "..")).catch((error) => {
      adaptersPackageVersionCache = null;
      // biome-ignore lint/suspicious/noConsole: startup diagnostic
      console.warn(`Warning: Failed to read adapters package version: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    adaptersPackageVersionCache = { value: promise };
  }

  return await adaptersPackageVersionCache.value;
}

export async function probeInvocationVersion(
  invocation: InvocationSpec,
  cwd: string,
  environment?: NodeJS.ProcessEnv
): Promise<VersionProbeResult> {
  try {
    const result = await runProcess(
      invocation.command,
      [...invocation.argsPrefix, "--version"],
      cwd,
      15_000,
      environment
    );

    const output = [result.stdout, result.stderr]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    const version = output ? extractVersionToken(output) ?? output : undefined;

    if (result.exitCode === 0 && version) {
      return {
        version,
        source: "version-command"
      };
    }
  } catch (e) {
    adapterWarn("version probe failed", { command: invocation.displayCommand, error: e instanceof Error ? e.message : String(e) });
  }

  const invocationTarget =
    invocation.argsPrefix.length > 0
      ? invocation.argsPrefix[invocation.argsPrefix.length - 1]
      : invocation.command;
  const packageVersion = await readPackageVersion(
    path.extname(invocationTarget) ? path.dirname(invocationTarget) : invocationTarget
  );
  if (packageVersion) {
    return {
      version: packageVersion,
      source: "package-file"
    };
  }

  return {
    source: "unknown"
  };
}

export async function probeHelp(invocation: InvocationSpec, cwd: string): Promise<ProcessResult> {
  try {
    return await runProcess(invocation.command, [...invocation.argsPrefix, "--help"], cwd, 30_000);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      exitCode: -1,
      stdout: "",
      stderr: `Failed to probe help: ${errorMessage}`,
      timedOut: false,
      error: errorMessage
    };
  }
}

export async function probeClaudeLikeAuth(
  invocation: InvocationSpec,
  cwd: string,
  environment?: NodeJS.ProcessEnv
): Promise<{
  status: AdapterPreflightResult["status"];
  summary: string;
  details?: string[];
}> {
  const prompt = "Reply with the single word READY and stop.";
  let execution: ProcessResult;

  try {
    execution = await runProcess(
      invocation.command,
      [
        ...invocation.argsPrefix,
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--no-session-persistence",
        prompt
      ],
      cwd,
      60_000,
      environment
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      status: "blocked",
      summary: "Failed to execute authentication probe.",
      details: [errorMessage]
    };
  }

  const parsed = parseClaudeEvents(execution.stdout);

  if (execution.timedOut) {
    return {
      status: "blocked",
      summary: "Authenticated probe timed out before the CLI produced a result.",
      details: [execution.stderr.trim()].filter(Boolean)
    };
  }

  if (execution.error) {
    return {
      status: "blocked",
      summary: "Process execution failed.",
      details: [execution.error, execution.stderr.trim()].filter(Boolean)
    };
  }

  if (parsed.error) {
    return {
      status: "blocked",
      summary: `CLI exited successfully but reported an error: ${parsed.error}`,
      details: [execution.stderr.trim()].filter(Boolean)
    };
  }

  if (execution.exitCode === 0) {
    return {
      status: "ready",
      summary: "CLI and authentication look healthy."
    };
  }

  const details = [parsed.error ?? execution.stderr.trim()].filter(Boolean);
  return {
    status: "blocked",
    summary: parsed.error ?? "CLI is installed but could not complete an authenticated probe.",
    details
  };
}

export async function probeClaudeProfileAuth(
  invocation: InvocationSpec,
  profileId: string | undefined,
  requestedModel?: string
): Promise<{
  status: AdapterPreflightResult["status"];
  summary: string;
  details?: string[];
}> {
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarena-claude-probe-"));
  try {
    const workspacePath = path.join(probeRoot, "workspace");
    await ensureDirectory(workspacePath);
    let providerRuntime: Awaited<ReturnType<typeof writeClaudeWorkspaceSettings>>;
    try {
      providerRuntime = await writeClaudeWorkspaceSettings(workspacePath, profileId, requestedModel);
    } catch (error) {
      return {
        status: "blocked",
        summary: "Failed to write workspace settings for auth probe.",
        details: [error instanceof Error ? error.message : String(error)]
      };
    }
    return await probeClaudeLikeAuth(
      invocation,
      workspacePath,
      {
        ...process.env,
        ...providerRuntime.environment
      }
    );
  } finally {
    await fs.rm(probeRoot, { recursive: true, force: true }).catch(() => {});
  }
}
