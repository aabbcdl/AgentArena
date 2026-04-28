import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AdapterCapability,
  type AdapterExecutionContext,
  type AdapterPreflightOptions,
  type AdapterPreflightResult,
  type AgentResolvedRuntime,
  type ClaudeProviderProfile,
  ensureDirectory
} from "@agentarena/core";
import { getClaudeProviderProfile, writeClaudeWorkspaceSettings } from "./claude-provider-profiles.js";
import { parseClaudeEvents } from "./event-parsers.js";
import type { ProcessResult } from "./process-utils.js";
import { runProcess } from "./process-utils.js";

interface DemoProfile {
  title: string;
  delayMs: number;
  tokenBase: number;
  tokenMultiplier: number;
  estimatedCostUsd: number;
  extraFiles: number;
}

interface InvocationSpec {
  command: string;
  argsPrefix: string[];
  displayCommand: string;
}

interface CodexConfigDefaults {
  model?: string;
  reasoningEffort?: string;
}

export const demoProfiles: Record<string, DemoProfile> = {
  "demo-fast": {
    title: "Demo Fast",
    delayMs: 250,
    tokenBase: 110,
    tokenMultiplier: 1.4,
    estimatedCostUsd: 0.08,
    extraFiles: 1
  },
  "demo-thorough": {
    title: "Demo Thorough",
    delayMs: 450,
    tokenBase: 190,
    tokenMultiplier: 1.9,
    estimatedCostUsd: 0.16,
    extraFiles: 2
  },
  "demo-budget": {
    title: "Demo Budget",
    delayMs: 180,
    tokenBase: 80,
    tokenMultiplier: 1.1,
    estimatedCostUsd: 0.05,
    extraFiles: 1
  }
};

export const DEMO_CAPABILITY: AdapterCapability = {
  supportTier: "supported",
  invocationMethod: "Built-in AgentArena demo adapter",
  authPrerequisites: [],
  tokenAvailability: "estimated",
  costAvailability: "estimated",
  traceRichness: "partial",
  configurableRuntime: {
    model: false,
    reasoningEffort: false
  },
  knownLimitations: [
    "Does not execute a real coding agent.",
    "Token usage and cost are synthetic."
  ]
};

export const CODEX_CAPABILITY: AdapterCapability = {
  supportTier: "supported",
  invocationMethod: "Codex CLI JSON event stream",
  authPrerequisites: ["Codex CLI installed and authenticated locally."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "full",
  configurableRuntime: {
    model: true,
    reasoningEffort: true
  },
  knownLimitations: [
    "Cost is not reported by the CLI and remains unknown.",
    "Output parsing depends on Codex CLI JSON event compatibility."
  ]
};

export const CLAUDE_CODE_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Claude Code CLI stream-json mode",
  authPrerequisites: ["Claude Code CLI installed and authenticated locally."],
  tokenAvailability: "available",
  costAvailability: "available",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false,
    providerProfile: true
  },
  knownLimitations: [
    "Changed files are inferred from workspace diff, not emitted directly by the adapter.",
    "Authentication and CLI flags may vary by local install.",
    "Third-party provider profiles rely on Claude-compatible behavior and may diverge from official results."
  ]
};

export const CURSOR_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Cursor internal claude-agent-sdk CLI bridge",
  authPrerequisites: ["Cursor installed locally.", "Cursor authentication available for agent runs."],
  tokenAvailability: "available",
  costAvailability: "available",
  traceRichness: "partial",
  configurableRuntime: {
    model: false,
    reasoningEffort: false
  },
  knownLimitations: [
    "Uses an internal Cursor CLI bridge that may change across releases.",
    "Portable detection depends on local installation layout."
  ]
};

export type { CodexConfigDefaults, DemoProfile, InvocationSpec };

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

function normalizeModelName(model: string | null | undefined): string | undefined {
  if (model == null) {
    return undefined;
  }
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveEffectiveModel(...candidates: (string | null | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeModelName(candidate);
    if (normalized != null) {
      return normalized;
    }
  }
  return undefined;
}

async function readPackageVersion(startPath: string): Promise<string | undefined> {
  let currentPath = path.resolve(startPath);
  const { root } = path.parse(currentPath);

  while (currentPath !== root) {
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

let adaptersPackageVersionPromise: Promise<string | undefined> | null = null;

export async function getAdaptersPackageVersion(): Promise<string | undefined> {
  if (!adaptersPackageVersionPromise) {
    adaptersPackageVersionPromise = readPackageVersion(path.join(import.meta.dirname, "..")).catch((error) => {
      // Reset the promise on failure so subsequent calls can retry
      adaptersPackageVersionPromise = null;
      console.warn(`Warning: Failed to read adapters package version: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
  }

  return await adaptersPackageVersionPromise;
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
  } catch {
    // Fall through to package lookup or unknown result.
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

export function buildAgentPrompt(context: AdapterExecutionContext): string {
  return [
    `You are running inside AgentArena as adapter "${context.selection.baseAgentId}" and variant "${context.selection.variantId}".`,
    "Work only inside the current workspace.",
    "Complete the task using the existing repository files.",
    "Keep changes minimal and directly relevant.",
    "Do not ask follow-up questions.",
    "Stop after the work is complete.",
    "",
    `Task ID: ${context.task.id}`,
    `Task Title: ${context.task.title}`,
    `Variant Label: ${context.selection.displayLabel}`,
    ...(context.selection.config.model ? [`Requested Model: ${context.selection.config.model}`] : []),
    ...(context.selection.config.reasoningEffort
      ? [`Requested Reasoning Effort: ${context.selection.config.reasoningEffort}`]
      : []),
    "",
    "Task Prompt:",
    context.task.prompt
  ].join("\n");
}

export function computeTokenUsage(prompt: string, profile: DemoProfile): number {
  return Math.round(profile.tokenBase + prompt.length * profile.tokenMultiplier);
}

export function buildDemoSummary(context: AdapterExecutionContext, profile: DemoProfile): string {
  return `${profile.title} processed task "${context.task.id}" in ${profile.delayMs}ms using the demo adapter path.`;
}

export async function writeDemoArtifacts(
  context: AdapterExecutionContext,
  profile: DemoProfile
): Promise<string[]> {
  const demoDir = path.join(context.workspacePath, "agentarena-demo");
  await ensureDirectory(demoDir);

  const changedFiles: string[] = [];
  const primaryFilePath = path.join(demoDir, `${context.agentId}.md`);

  const fileBody = [
    `# ${profile.title}`,
    "",
    `Task: ${context.task.title}`,
    "",
    "Prompt:",
    context.task.prompt,
    "",
    "This file was created by the built-in demo adapter to validate the AgentArena execution pipeline."
  ].join("\n");

  await fs.writeFile(primaryFilePath, fileBody, "utf8");
  changedFiles.push("agentarena-demo/" + path.basename(primaryFilePath));

  for (let index = 1; index < profile.extraFiles; index += 1) {
    const jsonPath = path.join(demoDir, `${context.agentId}-${index}.json`);
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          agentId: context.agentId,
          taskId: context.task.id,
          note: "Extra artifact for diff and report output."
        },
        null,
        2
      ),
      "utf8"
    );
    changedFiles.push("agentarena-demo/" + path.basename(jsonPath));
  }

  return changedFiles;
}

export function createPreflightResult(
  selection: AdapterPreflightOptions["selection"] | undefined,
  agentId: string,
  agentTitle: string,
  adapterKind: "demo" | "external",
  capability: AdapterCapability,
  status: AdapterPreflightResult["status"],
  summary: string,
  resolvedRuntime?: AgentResolvedRuntime,
  command?: string,
  details?: string[]
): AdapterPreflightResult {
  return {
    agentId: selection?.variantId ?? agentId,
    baseAgentId: agentId,
    variantId: selection?.variantId ?? agentId,
    displayLabel: selection?.displayLabel ?? agentTitle,
    requestedConfig: selection?.config ?? {},
    resolvedRuntime,
    agentTitle,
    adapterKind,
    capability,
    status,
    summary,
    command,
    details
  };
}

export async function readCodexConfigDefaults(): Promise<CodexConfigDefaults> {
  const configPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? os.homedir(), ".codex", "config.toml");
  try {
    const contents = await fs.readFile(configPath, "utf8");
    const model = contents.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1]?.trim();
    const reasoningEffort = contents
      .match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1]
      ?.trim();
    return {
      model: model || undefined,
      reasoningEffort: reasoningEffort || undefined
    };
  } catch {
    return {};
  }
}

function normalizeReasoningEffort(effort: string | null | undefined): string | undefined {
  if (effort == null) {
    return undefined;
  }
  const trimmed = effort.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function resolveCodexRuntime(context: {
  requestedConfig?: AdapterExecutionContext["selection"]["config"];
  configSource?: AdapterExecutionContext["selection"]["configSource"];
}): Promise<AgentResolvedRuntime> {
  const requestedConfig = context.requestedConfig ?? {};
  const normalizedRequestedModel = normalizeModelName(requestedConfig.model);
  const normalizedRequestedEffort = normalizeReasoningEffort(requestedConfig.reasoningEffort);
  if (normalizedRequestedModel || normalizedRequestedEffort) {
    return {
      effectiveModel: normalizedRequestedModel,
      effectiveReasoningEffort: normalizedRequestedEffort,
      source: context.configSource ?? "ui",
      verification: "inferred",
      notes: ["Using explicit AgentArena Codex configuration."]
    };
  }

  const normalizedEnvModel = normalizeModelName(process.env.AGENTARENA_CODEX_MODEL);
  const normalizedEnvEffort = normalizeReasoningEffort(process.env.AGENTARENA_CODEX_REASONING_EFFORT);
  if (normalizedEnvModel || normalizedEnvEffort) {
    return {
      effectiveModel: normalizedEnvModel,
      effectiveReasoningEffort: normalizedEnvEffort,
      source: "env",
      verification: "inferred",
      notes: ["Using AGENTARENA_CODEX_* environment overrides."]
    };
  }

  const configDefaults = await readCodexConfigDefaults();
  const normalizedConfigModel = normalizeModelName(configDefaults.model);
  const normalizedConfigEffort = normalizeReasoningEffort(configDefaults.reasoningEffort);
  if (normalizedConfigModel || normalizedConfigEffort) {
    return {
      effectiveModel: normalizedConfigModel,
      effectiveReasoningEffort: normalizedConfigEffort,
      source: "codex-config",
      verification: "inferred",
      notes: ["Using defaults from ~/.codex/config.toml."]
    };
  }

  return {
    source: "cli-default",
    verification: "unknown",
    notes: ["Codex CLI default runtime could not be resolved from AgentArena, environment, or ~/.codex/config.toml."]
  };
}

export async function resolveClaudeRuntime(context: {
  requestedConfig?: AdapterExecutionContext["selection"]["config"];
}): Promise<{
  runtime: AgentResolvedRuntime;
  profile: ClaudeProviderProfile;
}> {
  const requestedConfig = context.requestedConfig ?? {};
  const profile = await getClaudeProviderProfile(requestedConfig.providerProfileId);
  const runtime: AgentResolvedRuntime = {
    effectiveModel: resolveEffectiveModel(requestedConfig.model, profile.primaryModel),
    effectiveReasoningEffort: undefined,
    providerProfileId: profile.id,
    providerProfileName: profile.name,
    providerKind: profile.kind,
    providerSource: profile.kind === "official" ? "official-login" : "profile-config",
    source: profile.kind === "official" ? "official-login" : "profile-config",
    verification: "inferred",
    notes: [
      profile.kind === "official"
        ? "Using built-in official Claude Code profile."
        : "Using a provider-switched Claude Code profile."
    ]
  };

  return {
    runtime,
    profile
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
      60_000, // Shorter timeout for auth probe
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

  // Check for errors in the parsed events even if exit code is 0
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
