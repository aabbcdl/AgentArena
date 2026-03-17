import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AdapterCapability,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  ClaudeProviderProfile,
  AgentResolvedRuntime,
  AgentAdapter,
  ensureDirectory,
  normalizePath,
  portableRelativePath,
  uniqueSorted
} from "@repoarena/core";
import {
  buildClaudeProviderEnvironment,
  getClaudeProviderProfile,
  getClaudeProviderProfileSecret,
  listClaudeProviderProfiles,
  saveClaudeProviderProfile,
  deleteClaudeProviderProfile,
  setClaudeProviderProfileSecret,
  writeClaudeWorkspaceSettings
} from "./claude-provider-profiles.js";

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

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal?: NodeJS.Signals;
  error?: string;
}

interface ProcessError extends Error {
  code?: string;
  signal?: NodeJS.Signals;
  exitCode?: number | null;
}

interface CodexUsageEvent {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

interface CodexJsonEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    changes?: Array<{
      path?: string;
    }>;
  };
  usage?: CodexUsageEvent;
  thread_id?: string;
}

interface CodexConfigDefaults {
  model?: string;
  reasoningEffort?: string;
}

interface ClaudeUsageEvent {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeJsonEvent {
  type?: string;
  session_id?: string;
  is_error?: boolean;
  error?: string;
  total_cost_usd?: number;
  result?: string;
  usage?: ClaudeUsageEvent;
  message?: {
    usage?: ClaudeUsageEvent;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
}

const demoProfiles: Record<string, DemoProfile> = {
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

const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60 * 1_000;
const DEMO_CAPABILITY: AdapterCapability = {
  supportTier: "supported",
  invocationMethod: "Built-in RepoArena demo adapter",
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
const CODEX_CAPABILITY: AdapterCapability = {
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
const CLAUDE_CODE_CAPABILITY: AdapterCapability = {
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
const CURSOR_CAPABILITY: AdapterCapability = {
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

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

function computeTokenUsage(prompt: string, profile: DemoProfile): number {
  return Math.round(profile.tokenBase + prompt.length * profile.tokenMultiplier);
}

function buildDemoSummary(context: AdapterExecutionContext, profile: DemoProfile): string {
  return `${profile.title} processed task "${context.task.id}" in ${profile.delayMs}ms using the demo adapter path.`;
}

function buildAgentPrompt(context: AdapterExecutionContext): string {
  return [
    `You are running inside RepoArena as adapter "${context.selection.baseAgentId}" and variant "${context.selection.variantId}".`,
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

async function readCodexConfigDefaults(): Promise<CodexConfigDefaults> {
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

async function resolveCodexRuntime(context: {
  requestedConfig?: AdapterExecutionContext["selection"]["config"];
  configSource?: AdapterExecutionContext["selection"]["configSource"];
}): Promise<AgentResolvedRuntime> {
  const requestedConfig = context.requestedConfig ?? {};
  if (requestedConfig.model || requestedConfig.reasoningEffort) {
    return {
      effectiveModel: requestedConfig.model,
      effectiveReasoningEffort: requestedConfig.reasoningEffort,
      source: context.configSource ?? "ui",
      verification: "inferred",
      notes: ["Using explicit RepoArena Codex configuration."]
    };
  }

  if (process.env.REPOARENA_CODEX_MODEL?.trim() || process.env.REPOARENA_CODEX_REASONING_EFFORT?.trim()) {
    return {
      effectiveModel: process.env.REPOARENA_CODEX_MODEL?.trim() || undefined,
      effectiveReasoningEffort: process.env.REPOARENA_CODEX_REASONING_EFFORT?.trim() || undefined,
      source: "env",
      verification: "inferred",
      notes: ["Using REPOARENA_CODEX_* environment overrides."]
    };
  }

  const configDefaults = await readCodexConfigDefaults();
  if (configDefaults.model || configDefaults.reasoningEffort) {
    return {
      effectiveModel: configDefaults.model,
      effectiveReasoningEffort: configDefaults.reasoningEffort,
      source: "codex-config",
      verification: "inferred",
      notes: ["Using defaults from ~/.codex/config.toml."]
    };
  }

  return {
    source: "cli-default",
    verification: "unknown",
    notes: ["Codex CLI default runtime could not be resolved from RepoArena, environment, or ~/.codex/config.toml."]
  };
}

async function resolveClaudeRuntime(context: {
  requestedConfig?: AdapterExecutionContext["selection"]["config"];
}): Promise<{
  runtime: AgentResolvedRuntime;
  profile: ClaudeProviderProfile;
}> {
  const requestedConfig = context.requestedConfig ?? {};
  const profile = await getClaudeProviderProfile(requestedConfig.providerProfileId);
  const runtime: AgentResolvedRuntime = {
    effectiveModel: requestedConfig.model?.trim() || profile.primaryModel?.trim() || undefined,
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

function safeNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function agentTimeoutMs(): number {
  return resolveTimeoutMs(process.env.REPOARENA_AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS);
}

function formatTimeoutMessage(timeoutMs: number): string {
  return `Process timed out after ${timeoutMs}ms.`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findExecutableOnPath(names: string[]): Promise<string | undefined> {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function cursorAgentCliFromBinary(binaryPath: string): string {
  const binaryDir = path.dirname(binaryPath);
  return path.resolve(
    binaryDir,
    "..",
    "extensions",
    "cursor-agent",
    "dist",
    "claude-agent-sdk",
    "cli.js"
  );
}

async function resolveCursorAgentCliPath(): Promise<string | undefined> {
  if (process.env.REPOARENA_CURSOR_AGENT_CLI?.trim()) {
    const explicitPath = process.env.REPOARENA_CURSOR_AGENT_CLI.trim();
    if (await pathExists(explicitPath)) {
      return explicitPath;
    }
  }

  const pathBinary = await findExecutableOnPath(
    process.platform === "win32" ? ["cursor.cmd", "cursor.exe", "cursor"] : ["cursor"]
  );
  if (pathBinary) {
    const derivedCliPath = cursorAgentCliFromBinary(pathBinary);
    if (await pathExists(derivedCliPath)) {
      return derivedCliPath;
    }
  }

  const installRoots = process.platform === "win32"
    ? [
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Cursor", "resources", "app", "bin", "cursor.cmd"),
        path.join(process.env.ProgramFiles ?? "", "Cursor", "resources", "app", "bin", "cursor.exe")
      ]
    : [
        "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        path.join(process.env.HOME ?? "", ".local", "bin", "cursor")
      ];

  for (const candidate of installRoots) {
    if (!(await pathExists(candidate))) {
      continue;
    }

    const derivedCliPath = cursorAgentCliFromBinary(candidate);
    if (await pathExists(derivedCliPath)) {
      return derivedCliPath;
    }
  }

  return undefined;
}

async function writeDemoArtifacts(
  context: AdapterExecutionContext,
  profile: DemoProfile
): Promise<string[]> {
  const demoDir = path.join(context.workspacePath, "repoarena-demo");
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
    "This file was created by the built-in demo adapter to validate the RepoArena execution pipeline."
  ].join("\n");

  await fs.writeFile(primaryFilePath, fileBody, "utf8");
  changedFiles.push("repoarena-demo/" + path.basename(primaryFilePath));

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
    changedFiles.push("repoarena-demo/" + path.basename(jsonPath));
  }

  return changedFiles;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = agentTimeoutMs(),
  environment?: NodeJS.ProcessEnv
): Promise<ProcessResult> {
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;
    let signal: NodeJS.Signals | undefined;
    let processError: string | undefined;

    const cleanup = () => {
      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
          // Give process time to terminate gracefully
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill("SIGKILL");
            }
          }, 2000);
        } catch {
          // Ignore kill errors
        }
      }
    };

    const finish = (result: ProcessResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      cleanup();
      // Wait a bit for the process to actually terminate
      setTimeout(() => {
        finish({
          exitCode: null,
          stdout,
          stderr: `${stderr}\n${formatTimeoutMessage(timeoutMs)}`.trim(),
          timedOut: true,
          signal: "SIGTERM"
        });
      }, 1000);
    }, timeoutMs);

    try {
      child = spawn(command, args, {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32", // Use shell on Windows for better compatibility
        windowsHide: true
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      const errorMessage = error instanceof Error ? error.message : String(error);
      finish({
        exitCode: -1,
        stdout: "",
        stderr: `Failed to spawn process: ${errorMessage}`,
        timedOut: false,
        error: errorMessage
      });
      return;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: ProcessError) => {
      clearTimeout(timeoutHandle);
      processError = error.message;
      finish({
        exitCode: error.exitCode ?? -1,
        stdout,
        stderr: `${stderr}\nProcess error: ${error.message}`.trim(),
        timedOut: false,
        signal: error.signal,
        error: error.message
      });
    });

    child.on("close", (exitCode, closeSignal) => {
      clearTimeout(timeoutHandle);
      signal = closeSignal ?? undefined;
      const timeoutSuffix = timedOut ? `\n${formatTimeoutMessage(timeoutMs)}` : "";
      const errorSuffix = processError ? `\nProcess error: ${processError}` : "";
      finish({
        exitCode,
        stdout,
        stderr: `${stderr}${timeoutSuffix}${errorSuffix}`.trim(),
        timedOut,
        signal
      });
    });

    // Handle process not responding
    child.on("disconnect", () => {
      if (!resolved) {
        stderr += "\nProcess disconnected unexpectedly.";
      }
    });
  });
}

function createPreflightResult(
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

function extractNestedStringValues(value: unknown, collector: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      extractNestedStringValues(entry, collector);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (typeof childValue === "string" && childValue.trim()) {
      collector.set(normalizedKey, childValue.trim());
    }
    extractNestedStringValues(childValue, collector);
  }
}

function parseCodexEvents(stdout: string, workspacePath: string): {
  changedFilesHint: string[];
  tokenUsage: number;
  summaryFromEvents?: string;
  threadId?: string;
  resolvedRuntime?: AgentResolvedRuntime;
} {
  const changedFiles = new Set<string>();
  let tokenUsage = 0;
  let summaryFromEvents: string | undefined;
  let threadId: string | undefined;
  let eventModel: string | undefined;
  let eventReasoningEffort: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let parsed: CodexJsonEvent;
    try {
      parsed = JSON.parse(trimmed) as CodexJsonEvent;
    } catch {
      continue;
    }

    if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
      threadId = parsed.thread_id;
    }

    if (parsed.type === "item.completed" && parsed.item?.type === "agent_message" && parsed.item.text) {
      summaryFromEvents = parsed.item.text;
    }

    if (parsed.type === "item.completed" && parsed.item?.type === "file_change" && parsed.item.changes) {
      for (const change of parsed.item.changes) {
        if (!change.path) {
          continue;
        }

        const relativePath = normalizePath(portableRelativePath(workspacePath, change.path));
        if (relativePath && !relativePath.startsWith("..") && !/^[a-zA-Z]:/.test(relativePath)) {
          changedFiles.add(relativePath);
        }
      }
    }

    if (parsed.type === "turn.completed" && parsed.usage) {
      tokenUsage +=
        safeNumber(parsed.usage.input_tokens) +
        safeNumber(parsed.usage.cached_input_tokens) +
        safeNumber(parsed.usage.output_tokens);
    }

    const stringValues = new Map<string, string>();
    extractNestedStringValues(parsed, stringValues);
    eventModel =
      stringValues.get("modelname") ??
      stringValues.get("modelslug") ??
      stringValues.get("model") ??
      eventModel;
    eventReasoningEffort =
      stringValues.get("modelreasoningeffort") ??
      stringValues.get("reasoningeffort") ??
      stringValues.get("reasoninglevel") ??
      eventReasoningEffort;
  }

  return {
    changedFilesHint: uniqueSorted(Array.from(changedFiles)),
    tokenUsage,
    summaryFromEvents,
    threadId,
    resolvedRuntime:
      eventModel || eventReasoningEffort
        ? {
            effectiveModel: eventModel,
            effectiveReasoningEffort: eventReasoningEffort,
            source: "event-stream",
            verification: "confirmed"
          }
        : undefined
  };
}

function parseClaudeEvents(stdout: string): {
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  summaryFromEvents?: string;
  sessionId?: string;
  error?: string;
} {
  let tokenUsage = 0;
  let estimatedCostUsd = 0;
  let costKnown = false;
  let summaryFromEvents: string | undefined;
  let sessionId: string | undefined;
  let error: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let parsed: ClaudeJsonEvent;
    try {
      parsed = JSON.parse(trimmed) as ClaudeJsonEvent;
    } catch {
      continue;
    }

    if (parsed.session_id) {
      sessionId = parsed.session_id;
    }

    if (parsed.message?.content) {
      const text = parsed.message.content
        .filter((value) => value.type === "text" && typeof value.text === "string")
        .map((value) => value.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n");

      if (text) {
        summaryFromEvents = text;
      }

      const usage = parsed.message.usage;
      if (usage) {
        tokenUsage +=
          safeNumber(usage.input_tokens) +
          safeNumber(usage.output_tokens) +
          safeNumber(usage.cache_creation_input_tokens) +
          safeNumber(usage.cache_read_input_tokens);
      }
    }

    if (parsed.type === "result") {
      const usage = parsed.usage;
      if (usage) {
        tokenUsage +=
          safeNumber(usage.input_tokens) +
          safeNumber(usage.output_tokens) +
          safeNumber(usage.cache_creation_input_tokens) +
          safeNumber(usage.cache_read_input_tokens);
      }

      if (typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd)) {
        estimatedCostUsd = parsed.total_cost_usd;
        costKnown = !parsed.is_error;
      }

      if (typeof parsed.result === "string" && parsed.result.trim()) {
        summaryFromEvents = parsed.result.trim();
      }

      if (parsed.is_error) {
        error = parsed.error ?? parsed.result ?? "The adapter reported an error.";
      }
    }
  }

  return {
    tokenUsage,
    estimatedCostUsd,
    costKnown,
    summaryFromEvents,
    sessionId,
    error
  };
}

async function resolveCodexInvocation(): Promise<InvocationSpec> {
  if (process.env.REPOARENA_CODEX_BIN?.trim()) {
    const command = process.env.REPOARENA_CODEX_BIN.trim();
    return { command, argsPrefix: [], displayCommand: command };
  }

  if (process.platform === "win32") {
    const scriptPath = path.join(
      process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Roaming"),
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js"
    );

    try {
      await fs.access(scriptPath);
      return {
        command: process.execPath,
        argsPrefix: [scriptPath],
        displayCommand: `${process.execPath} ${scriptPath}`
      };
    } catch {
      return {
        command: "codex.cmd",
        argsPrefix: [],
        displayCommand: "codex.cmd"
      };
    }
  }

  return {
    command: "codex",
    argsPrefix: [],
    displayCommand: "codex"
  };
}

async function resolveCursorInvocation(): Promise<InvocationSpec> {
  if (process.env.REPOARENA_CURSOR_BIN?.trim()) {
    const command = process.env.REPOARENA_CURSOR_BIN.trim();
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

async function resolveClaudeInvocation(): Promise<InvocationSpec> {
  const command = process.env.REPOARENA_CLAUDE_BIN?.trim() || "claude";
  return {
    command,
    argsPrefix: [],
    displayCommand: command
  };
}

async function probeHelp(invocation: InvocationSpec, cwd: string): Promise<ProcessResult> {
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

async function probeClaudeLikeAuth(
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

async function probeClaudeProfileAuth(
  invocation: InvocationSpec,
  profileId: string | undefined,
  requestedModel?: string
): Promise<{
  status: AdapterPreflightResult["status"];
  summary: string;
  details?: string[];
}> {
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repoarena-claude-probe-"));
  try {
    const workspacePath = path.join(probeRoot, "workspace");
    await ensureDirectory(workspacePath);
    const providerRuntime = await writeClaudeWorkspaceSettings(workspacePath, profileId, requestedModel);
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

class DemoAdapter implements AgentAdapter {
  readonly kind = "demo" as const;
  readonly capability = DEMO_CAPABILITY;

  constructor(readonly id: string, readonly title: string, private readonly profile: DemoProfile) {}

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    return createPreflightResult(
      options?.selection,
      this.id,
      this.title,
      this.kind,
      this.capability,
      "ready",
      "Built-in demo adapter is always available."
    );
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    await context.trace({
      type: "adapter.start",
      message: `Starting ${this.title}`,
      metadata: {
        repoPath: context.repoPath,
        workspacePath: context.workspacePath
      }
    });

    await sleep(this.profile.delayMs);

    const changedFilesHint = await writeDemoArtifacts(context, this.profile);
    const summary = buildDemoSummary(context, this.profile);
    const tokenUsage = computeTokenUsage(context.task.prompt, this.profile);

    await context.trace({
      type: "adapter.write",
      message: `Created ${changedFilesHint.length} demo artifact(s)`,
      metadata: {
        changedFilesHint
      }
    });

    await context.trace({
      type: "adapter.finish",
      message: summary,
      metadata: {
        tokenUsage,
        estimatedCostUsd: this.profile.estimatedCostUsd
      }
    });

    return {
      status: "success",
      summary,
      tokenUsage,
      estimatedCostUsd: this.profile.estimatedCostUsd,
      costKnown: true,
      changedFilesHint,
      resolvedRuntime: {
        source: "ui",
        verification: "inferred",
        notes: ["Built-in demo adapter does not execute a real model."]
      }
    };
  }
}

class CodexCliAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "codex";
  readonly title = "Codex CLI";
  readonly capability = CODEX_CAPABILITY;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await resolveCodexInvocation();
    const resolvedRuntime = await resolveCodexRuntime({
      requestedConfig: options?.selection?.config,
      configSource: options?.selection?.configSource
    });
    
    try {
      const result = await probeHelp(invocation, process.cwd());
      
      if (result.timedOut) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "blocked",
          "CLI help probe timed out.",
          resolvedRuntime,
          invocation.displayCommand,
          [result.stderr.trim()].filter(Boolean)
        );
      }
      
      if (result.error) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "missing",
          "CLI could not be launched.",
          resolvedRuntime,
          invocation.displayCommand,
          [result.error]
        );
      }
      
      if (result.exitCode === 0) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "ready",
          "CLI is installed and responds to --help.",
          resolvedRuntime,
          invocation.displayCommand
        );
      }
      
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "unverified",
        "CLI was found, but readiness could not be fully confirmed.",
        resolvedRuntime,
        invocation.displayCommand,
        [result.stderr.trim()].filter(Boolean)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "missing",
        "CLI could not be launched.",
        resolvedRuntime,
        invocation.displayCommand,
        [message]
      );
    }
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const metadataDir = path.join(context.workspacePath, "repoarena-demo");
    const outputLastMessagePath = path.join(metadataDir, "codex-last-message.txt");
    await ensureDirectory(metadataDir);

    const prompt = buildAgentPrompt(context);
    const invocation = await resolveCodexInvocation();
    const args = [
      ...invocation.argsPrefix,
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--cd",
      context.workspacePath,
      "--output-last-message",
      outputLastMessagePath,
      "--json",
      prompt
    ];
    const resolvedRuntime = await resolveCodexRuntime({
      requestedConfig: context.selection.config,
      configSource: context.selection.configSource
    });
    if (resolvedRuntime.effectiveReasoningEffort) {
      args.splice(
        invocation.argsPrefix.length + 1,
        0,
        "-c",
        `model_reasoning_effort="${resolvedRuntime.effectiveReasoningEffort}"`
      );
    }
    if (resolvedRuntime.effectiveModel) {
      args.splice(invocation.argsPrefix.length + 1, 0, "--model", resolvedRuntime.effectiveModel);
    }

    await context.trace({
      type: "adapter.start",
      message: "Starting Codex CLI adapter",
      metadata: {
        command: invocation.displayCommand,
        args,
        requestedConfig: context.selection.config,
        resolvedRuntime
      }
    });

    let execution: ProcessResult;
    try {
      execution = await runProcess(
        invocation.command,
        args,
        context.workspacePath,
        agentTimeoutMs(),
        context.environment
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await context.trace({
        type: "adapter.error",
        message: "Failed to execute Codex CLI",
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `Codex CLI execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime
      };
    }

    const parsed = parseCodexEvents(execution.stdout, context.workspacePath);
    const lastMessage = await fs.readFile(outputLastMessagePath, "utf8").catch(() => "");
    
    let summary: string;
    if (execution.error) {
      summary = `Codex CLI process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = "Codex CLI timed out before producing a final message.";
    } else if (lastMessage.trim()) {
      summary = lastMessage.trim();
    } else if (parsed.summaryFromEvents) {
      summary = parsed.summaryFromEvents;
    } else if (execution.exitCode === 0) {
      summary = "Codex CLI completed without a final message.";
    } else {
      summary = `Codex CLI failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: "adapter.codex.result",
      message: execution.exitCode === 0 ? "Codex CLI finished successfully" : "Codex CLI failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        signal: execution.signal,
        error: execution.error,
        threadId: parsed.threadId,
        tokenUsage: parsed.tokenUsage,
        changedFilesHint: parsed.changedFilesHint,
        resolvedRuntime: parsed.resolvedRuntime ?? resolvedRuntime,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint: parsed.changedFilesHint,
      resolvedRuntime: parsed.resolvedRuntime
        ? {
            effectiveModel: parsed.resolvedRuntime.effectiveModel ?? resolvedRuntime.effectiveModel,
            effectiveReasoningEffort:
              parsed.resolvedRuntime.effectiveReasoningEffort ?? resolvedRuntime.effectiveReasoningEffort,
            source: "event-stream",
            verification: "confirmed",
            notes: resolvedRuntime.notes
          }
        : resolvedRuntime
    };
  }
}

abstract class ClaudeLikeAdapter implements AgentAdapter {
  abstract readonly id: string;
  abstract readonly title: string;
  abstract readonly kind: "external";
  abstract readonly capability: AdapterCapability;
  protected abstract resolveInvocation(): Promise<InvocationSpec>;
  abstract execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await this.resolveInvocation();

    try {
      const help = await probeHelp(invocation, process.cwd());
      if (help.exitCode !== 0) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "missing",
          "CLI did not respond successfully to --help.",
          undefined,
          invocation.displayCommand,
          [help.stderr.trim()].filter(Boolean)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "missing",
        "CLI could not be launched.",
        undefined,
        invocation.displayCommand,
        [message]
      );
    }

    if (options?.probeAuth) {
      const authProbe = await probeClaudeLikeAuth(invocation, process.cwd());
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        authProbe.status,
        authProbe.summary,
        undefined,
        invocation.displayCommand,
        authProbe.details
      );
    }

    return createPreflightResult(
      options?.selection,
      this.id,
      this.title,
      this.kind,
      this.capability,
      "unverified",
      "CLI is installed. Authentication was not probed in this run.",
      undefined,
      invocation.displayCommand
    );
  }

  protected async executeClaudeLike(
    context: AdapterExecutionContext,
    eventType: string,
    finishLabel: string,
    options?: {
      extraArgs?: string[];
      extraEnvironment?: NodeJS.ProcessEnv;
      resolvedRuntime?: AgentResolvedRuntime;
    }
  ): Promise<AdapterExecutionResult> {
    const prompt = buildAgentPrompt(context);
    const invocation = await this.resolveInvocation();
    const args = [
      ...invocation.argsPrefix,
      ...(options?.extraArgs ?? []),
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--no-session-persistence",
      prompt
    ];

    await context.trace({
      type: "adapter.start",
      message: `Starting ${this.title} adapter`,
      metadata: {
        command: invocation.displayCommand,
        args,
        resolvedRuntime: options?.resolvedRuntime
      }
    });

    let execution: ProcessResult;
    try {
      execution = await runProcess(
        invocation.command,
        args,
        context.workspacePath,
        agentTimeoutMs(),
        {
          ...context.environment,
          ...options?.extraEnvironment
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await context.trace({
        type: "adapter.error",
        message: `Failed to execute ${this.title}`,
        metadata: { error: errorMessage }
      });
      return {
        status: "failed",
        summary: `${this.title} execution failed: ${errorMessage}`,
        tokenUsage: 0,
        estimatedCostUsd: 0,
        costKnown: false,
        changedFilesHint: [],
        resolvedRuntime: options?.resolvedRuntime
      };
    }

    const parsed = parseClaudeEvents(execution.stdout);
    
    let summary: string;
    if (execution.error) {
      summary = `${this.title} process error: ${execution.error}`;
    } else if (execution.timedOut) {
      summary = `${this.title} timed out before producing a final message.`;
    } else if (parsed.summaryFromEvents) {
      summary = parsed.summaryFromEvents;
    } else if (execution.exitCode === 0) {
      summary = `${this.title} completed without a final message.`;
    } else {
      summary = `${this.title} failed with exit code ${execution.exitCode}.`;
    }

    await context.trace({
      type: eventType,
      message: execution.exitCode === 0 ? `${finishLabel} finished` : `${finishLabel} failed`,
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        signal: execution.signal,
        error: execution.error,
        sessionId: parsed.sessionId,
        tokenUsage: parsed.tokenUsage,
        estimatedCostUsd: parsed.estimatedCostUsd,
        costKnown: parsed.costKnown,
        resolvedRuntime: options?.resolvedRuntime,
        parsedError: parsed.error,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 && !execution.error ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: parsed.estimatedCostUsd,
      costKnown: parsed.costKnown,
      changedFilesHint: [],
      resolvedRuntime: options?.resolvedRuntime
    };
  }
}

class ClaudeCodeAdapter extends ClaudeLikeAdapter {
  readonly kind = "external" as const;
  readonly id = "claude-code";
  readonly title = "Claude Code";
  readonly capability = CLAUDE_CODE_CAPABILITY;

  protected async resolveInvocation(): Promise<InvocationSpec> {
    return await resolveClaudeInvocation();
  }

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await this.resolveInvocation();
    const resolved = await resolveClaudeRuntime({
      requestedConfig: options?.selection?.config
    });

    try {
      const help = await probeHelp(invocation, process.cwd());
      if (help.exitCode !== 0) {
        return createPreflightResult(
          options?.selection,
          this.id,
          this.title,
          this.kind,
          this.capability,
          "missing",
          "CLI did not respond successfully to --help.",
          resolved.runtime,
          invocation.displayCommand,
          [help.stderr.trim()].filter(Boolean)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "missing",
        "CLI could not be launched.",
        resolved.runtime,
        invocation.displayCommand,
        [message]
      );
    }

    if (resolved.profile.kind !== "official" && !(await getClaudeProviderProfileSecret(resolved.profile.id))) {
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        "blocked",
        `Provider profile "${resolved.profile.name}" does not have a stored secret.`,
        resolved.runtime,
        invocation.displayCommand,
        ["Store a secret for this profile before running Claude Code against a third-party provider."]
      );
    }

    if (options?.probeAuth) {
      const authProbe =
        resolved.profile.kind === "official"
          ? await probeClaudeLikeAuth(invocation, process.cwd())
          : await probeClaudeProfileAuth(
              invocation,
              resolved.profile.id,
              options?.selection?.config.model ?? resolved.profile.primaryModel
            );
      return createPreflightResult(
        options?.selection,
        this.id,
        this.title,
        this.kind,
        this.capability,
        authProbe.status,
        authProbe.summary,
        resolved.runtime,
        invocation.displayCommand,
        authProbe.details
      );
    }

    return createPreflightResult(
      options?.selection,
      this.id,
      this.title,
      this.kind,
      this.capability,
      "unverified",
      "CLI is installed. Authentication was not probed in this run.",
      resolved.runtime,
      invocation.displayCommand
    );
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const { runtime, profile } = await resolveClaudeRuntime({
      requestedConfig: context.selection.config
    });
    const providerRuntime = await writeClaudeWorkspaceSettings(
      context.workspacePath,
      profile.id,
      context.selection.config.model ?? profile.primaryModel
    );
    const extraArgs = runtime.effectiveModel ? ["--model", runtime.effectiveModel] : [];
    const profileRiskNote =
      profile.kind === "official"
        ? "Using Claude Code official profile without a third-party provider override."
        : "This result was produced through a provider-switched Claude Code configuration.";

    await context.trace({
      type: "adapter.claude.profile",
      message: profileRiskNote,
      metadata: {
        providerProfileId: profile.id,
        providerProfileName: profile.name,
        providerKind: profile.kind,
        settingsPath: providerRuntime.settingsPath,
        effectiveModel: runtime.effectiveModel
      }
    });

    const result = await this.executeClaudeLike(context, "adapter.claude.result", "Claude Code", {
      extraArgs,
      extraEnvironment: providerRuntime.environment,
      resolvedRuntime: runtime
    });

    return {
      ...result,
      summary:
        profile.kind === "official"
          ? result.summary
          : `${result.summary}\n\nThis result was produced through a provider-switched Claude Code configuration.`,
      resolvedRuntime: runtime
    };
  }
}

class CursorAdapter extends ClaudeLikeAdapter {
  readonly kind = "external" as const;
  readonly id = "cursor";
  readonly title = "Cursor Agent";
  readonly capability = CURSOR_CAPABILITY;

  protected async resolveInvocation(): Promise<InvocationSpec> {
    return await resolveCursorInvocation();
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    return await this.executeClaudeLike(context, "adapter.cursor.result", "Cursor");
  }
}

const adapterEntries: Array<[string, AgentAdapter]> = [
  ...Object.entries(demoProfiles).map(
    ([id, profile]) => [id, new DemoAdapter(id, profile.title, profile)] as [string, AgentAdapter]
  ),
  ["codex", new CodexCliAdapter()],
  ["claude-code", new ClaudeCodeAdapter()],
  ["cursor", new CursorAdapter()]
];

const adapters = new Map<string, AgentAdapter>(adapterEntries);

export function listAvailableAdapters(): AgentAdapter[] {
  return Array.from(adapters.values());
}

export function getAdapter(agentId: string): AgentAdapter {
  const adapter = adapters.get(agentId);

  if (!adapter) {
    throw new Error(
      `Unknown adapter "${agentId}". Available adapters: ${listAvailableAdapters()
        .map((value) => value.id)
        .join(", ")}`
    );
  }

  return adapter;
}

export async function preflightAdapters(
  selections: AdapterPreflightOptions["selection"][],
  options?: AdapterPreflightOptions
): Promise<AdapterPreflightResult[]> {
  return await Promise.all(
    selections.map(async (selection) => {
      if (!selection) {
        throw new Error("Missing agent selection.");
      }

      const adapter = getAdapter(selection.baseAgentId);
      return await adapter.preflight({
        ...options,
        selection
      });
    })
  );
}

export async function getCodexDefaultResolvedRuntime(): Promise<AgentResolvedRuntime> {
  return await resolveCodexRuntime({});
}

export {
  listClaudeProviderProfiles,
  getClaudeProviderProfile,
  saveClaudeProviderProfile,
  deleteClaudeProviderProfile,
  setClaudeProviderProfileSecret
};

export const __testUtils = {
  parseCodexEvents,
  parseClaudeEvents,
  resolveCodexRuntime,
  readCodexConfigDefaults,
  resolveClaudeRuntime
};
