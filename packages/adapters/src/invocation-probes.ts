import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdapterPreflightResult, PreflightResult } from "@agentarena/core";
import { ensureDirectory, getHealthCache } from "@agentarena/core";
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
    const promise = readPackageVersion(path.join(import.meta.dirname, ".."))
      .then((version) => {
        // Cache successful result
        return version;
      })
      .catch((error) => {
        // Don't cache failures — next call will retry
        adaptersPackageVersionCache = null;
        // biome-ignore lint/suspicious/noConsole: startup diagnostic before logger is available
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
    return await runProcess(invocation.command, [...invocation.argsPrefix, "--help"], cwd, 45_000);
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

/**
 * Fast CLI existence check — just runs `--version` with a short timeout.
 * Returns in ~2 seconds. No network call, no auth check.
 */
export async function probeCliExists(
  invocation: InvocationSpec,
  cwd: string,
  environment?: NodeJS.ProcessEnv
): Promise<{
  found: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const result = await runProcess(
      invocation.command,
      [...invocation.argsPrefix, "--version"],
      cwd,
      5_000,
      environment
    );
    const output = [result.stdout, result.stderr].join("\n").trim();
    const version = extractVersionToken(output);
    return {
      found: result.exitCode === 0 || output.length > 0,
      version
    };
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Lightweight auth config check — verifies API key exists without making a network call.
 * Returns in milliseconds. Only checks local configuration.
 */
export async function probeAuthConfig(
  invocation: InvocationSpec,
  environment?: NodeJS.ProcessEnv
): Promise<{
  configured: boolean;
  hint?: string;
}> {
  const env = environment ?? process.env;
  const command = invocation.command.toLowerCase();

  // Claude Code: check ANTHROPIC_API_KEY or config file
  if (command.includes("claude")) {
    const hasKey = !!(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY);
    if (hasKey) return { configured: true };
    // Check if there's a stored credential file
    const homeDir = os.homedir();
    const claudeConfigPath = path.join(homeDir, ".claude", "credentials.json");
    try {
      await fs.access(claudeConfigPath);
      return { configured: true };
    } catch {
      return { configured: false, hint: "No ANTHROPIC_API_KEY set and no ~/.claude/credentials.json found" };
    }
  }

  // Codex: check OPENAI_API_KEY
  if (command.includes("codex")) {
    return {
      configured: !!env.OPENAI_API_KEY,
      hint: env.OPENAI_API_KEY ? undefined : "No OPENAI_API_KEY set"
    };
  }

  // Gemini: check GEMINI_API_KEY or GOOGLE_API_KEY
  if (command.includes("gemini")) {
    const hasKey = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
    return {
      configured: hasKey,
      hint: hasKey ? undefined : "No GEMINI_API_KEY or GOOGLE_API_KEY set"
    };
  }

  // Aider: check OPENAI_API_KEY or ANTHROPIC_API_KEY
  if (command.includes("aider")) {
    const hasKey = !!(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
    return {
      configured: hasKey,
      hint: hasKey ? undefined : "No OPENAI_API_KEY or ANTHROPIC_API_KEY set"
    };
  }

  // Generic: assume configured if we can't determine
  return { configured: true };
}

/**
 * Three-stage preflight: CLI exists → Auth configured → Full auth probe (optional).
 * Stages 1+2 are fast (~2s total), stage 3 is slow (~60s) and only runs when explicitly requested.
 */
export async function probeQuickPreflight(
  invocation: InvocationSpec,
  cwd: string,
  environment?: NodeJS.ProcessEnv
): Promise<{
  cliExists: boolean;
  cliVersion?: string;
  authConfigured: boolean;
  authHint?: string;
  overallStatus: "ready" | "warning" | "blocked";
}> {
  const [cliResult, authResult] = await Promise.all([
    probeCliExists(invocation, cwd, environment),
    probeAuthConfig(invocation, environment)
  ]);

  let overallStatus: "ready" | "warning" | "blocked" = "ready";
  if (!cliResult.found) {
    overallStatus = "blocked";
  } else if (!authResult.configured) {
    overallStatus = "warning";
  }

  return {
    cliExists: cliResult.found,
    cliVersion: cliResult.version,
    authConfigured: authResult.configured,
    authHint: authResult.hint,
    overallStatus
  };
}

export async function probeClaudeLikeAuth(
  invocation: InvocationSpec,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  timeoutMs: number = 60_000
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
      ],
      cwd,
      timeoutMs,
      environment,
      undefined,
      prompt
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
      summary: `Authenticated probe timed out (${Math.round(timeoutMs / 1000)}s). The API endpoint may be slow or unreachable.`,
      details: [
        execution.stderr.trim(),
        `Tip: If using a third-party provider, the API server may be slow. Try again or check your network connection.`
      ].filter(Boolean)
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

/**
 * Fast auth probe with health cache integration.
 * Returns in ≤15s (configurable) with structured failure reasons.
 * Uses HealthCache to avoid redundant probes within TTL.
 */
export async function probeClaudeLikeAuthFast(
  invocation: InvocationSpec,
  cwd: string,
  adapterId: string,
  providerId: string,
  environment?: NodeJS.ProcessEnv,
  timeoutMs: number = 15_000,
  options?: {
    endpoint?: string;
    useCache?: boolean;
    forceProbe?: boolean;
  }
): Promise<PreflightResult> {
  const useCache = options?.useCache !== false;
  const forceProbe = options?.forceProbe === true;
  const cache = getHealthCache();

  // Check cache first (unless forced)
  if (useCache && !forceProbe) {
    const cached = await cache.get(adapterId, providerId, options?.endpoint);
    if (cached) {
      return {
        adapter: cached.adapterId,
        provider: cached.providerId,
        status: cached.status,
        summary: cached.summary,
        reason: cached.reason,
        suggestedAction: cached.suggestedAction,
        details: cached.details,
        fromCache: true,
        timestamp: cached.timestamp,
      };
    }
  }

  // Run the actual probe with short timeout
  const result = await probeClaudeLikeAuth(invocation, cwd, environment, timeoutMs);

  // Build structured result - map unverified to unverified, keep others as-is
  const status = result.status;
  const preflightResult: PreflightResult = {
    adapter: adapterId,
    provider: providerId,
    status,
    summary: result.summary,
    details: result.details,
    fromCache: false,
    timestamp: Date.now(),
  };

  // Add structured failure info for blocked status
  if (result.status === "blocked") {
    preflightResult.reason = result.summary;
    preflightResult.suggestedAction = [];

    // Analyze failure reason and suggest actions
    const summaryLower = result.summary.toLowerCase();
    const detailsStr = result.details?.join(" ").toLowerCase() ?? "";

    if (summaryLower.includes("timed out") || detailsStr.includes("timed out")) {
      preflightResult.suggestedAction.push(
        "Check network connectivity",
        "Verify API endpoint is reachable",
        "Increase probe timeout with --probe-timeout"
      );
    } else if (summaryLower.includes("auth") || detailsStr.includes("api key") || detailsStr.includes("unauthorized")) {
      preflightResult.suggestedAction.push(
        "Verify API key is correct",
        "Check ANTHROPIC_API_KEY environment variable",
        "Run 'agentarena doctor --probe-auth' to test authentication"
      );
    } else if (summaryLower.includes("not found") || summaryLower.includes("command not found")) {
      preflightResult.suggestedAction.push(
        "Install the required CLI tool",
        "Check PATH environment variable"
      );
    } else {
      preflightResult.suggestedAction.push(
        "Check CLI installation",
        "Verify authentication credentials",
        "Run 'agentarena doctor' for detailed diagnostics"
      );
    }
  }

  // Cache the result (even failures, to avoid repeated slow probes)
  if (useCache) {
    await cache.set(adapterId, providerId, preflightResult.status, preflightResult.summary, {
      endpoint: options?.endpoint,
      reason: preflightResult.reason,
      suggestedAction: preflightResult.suggestedAction,
      details: preflightResult.details,
      // Cache failures for shorter duration (1 min vs 5 min for success)
      ttlMs: preflightResult.status === "ready" ? undefined : 60_000,
    });
  }

  return preflightResult;
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
