import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  ensureDirectory,
  normalizePath,
  uniqueSorted
} from "@repoarena/core";

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
    `You are running inside RepoArena as adapter "${context.agentId}".`,
    "Work only inside the current workspace.",
    "Complete the task using the existing repository files.",
    "Keep changes minimal and directly relevant.",
    "Do not ask follow-up questions.",
    "Stop after the work is complete.",
    "",
    `Task ID: ${context.task.id}`,
    `Task Title: ${context.task.title}`,
    "",
    "Task Prompt:",
    context.task.prompt
  ].join("\n");
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
        path.join(process.env.ProgramFiles ?? "", "Cursor", "resources", "app", "bin", "cursor.exe"),
        path.join("D:", "soft", "cursor", "resources", "app", "bin", "cursor.cmd")
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
  timeoutMs = agentTimeoutMs()
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      const timeoutSuffix = timedOut ? `\n${formatTimeoutMessage(timeoutMs)}` : "";
      resolve({
        exitCode,
        stdout,
        stderr: `${stderr}${timeoutSuffix}`.trim(),
        timedOut
      });
    });
  });
}

function createPreflightResult(
  agentId: string,
  agentTitle: string,
  adapterKind: "demo" | "external",
  status: AdapterPreflightResult["status"],
  summary: string,
  command?: string,
  details?: string[]
): AdapterPreflightResult {
  return {
    agentId,
    agentTitle,
    adapterKind,
    status,
    summary,
    command,
    details
  };
}

function parseCodexEvents(stdout: string, workspacePath: string): {
  changedFilesHint: string[];
  tokenUsage: number;
  summaryFromEvents?: string;
  threadId?: string;
} {
  const changedFiles = new Set<string>();
  let tokenUsage = 0;
  let summaryFromEvents: string | undefined;
  let threadId: string | undefined;

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

        const relativePath = normalizePath(path.relative(workspacePath, change.path));
        if (!relativePath.startsWith("..")) {
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
  }

  return {
    changedFilesHint: uniqueSorted(Array.from(changedFiles)),
    tokenUsage,
    summaryFromEvents,
    threadId
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
  return await runProcess(invocation.command, [...invocation.argsPrefix, "--help"], cwd);
}

async function probeClaudeLikeAuth(
  invocation: InvocationSpec,
  cwd: string
): Promise<{
  status: AdapterPreflightResult["status"];
  summary: string;
  details?: string[];
}> {
  const prompt = "Reply with the single word READY and stop.";
  const execution = await runProcess(
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
    cwd
  );

  const parsed = parseClaudeEvents(execution.stdout);

  if (execution.timedOut) {
    return {
      status: "blocked",
      summary: "Authenticated probe timed out before the CLI produced a result.",
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

class DemoAdapter implements AgentAdapter {
  readonly kind = "demo" as const;

  constructor(readonly id: string, readonly title: string, private readonly profile: DemoProfile) {}

  async preflight(): Promise<AdapterPreflightResult> {
    return createPreflightResult(
      this.id,
      this.title,
      this.kind,
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
      changedFilesHint
    };
  }
}

class CodexCliAdapter implements AgentAdapter {
  readonly kind = "external" as const;
  readonly id = "codex";
  readonly title = "Codex CLI";

  async preflight(): Promise<AdapterPreflightResult> {
    const invocation = await resolveCodexInvocation();
    try {
      const result = await probeHelp(invocation, process.cwd());
      if (result.exitCode === 0) {
        return createPreflightResult(
          this.id,
          this.title,
          this.kind,
          "ready",
          "CLI is installed and responds to --help.",
          invocation.displayCommand
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPreflightResult(
        this.id,
        this.title,
        this.kind,
        "missing",
        "CLI could not be launched.",
        invocation.displayCommand,
        [message]
      );
    }

    return createPreflightResult(
      this.id,
      this.title,
      this.kind,
      "unverified",
      "CLI was found, but readiness could not be fully confirmed.",
      invocation.displayCommand
    );
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

    const model = process.env.REPOARENA_CODEX_MODEL?.trim();
    if (model) {
      args.splice(invocation.argsPrefix.length + 1, 0, "--model", model);
    }

    await context.trace({
      type: "adapter.start",
      message: "Starting Codex CLI adapter",
      metadata: {
        command: invocation.displayCommand,
        args
      }
    });

    const execution = await runProcess(invocation.command, args, context.workspacePath);
    const parsed = parseCodexEvents(execution.stdout, context.workspacePath);
    const lastMessage = await fs.readFile(outputLastMessagePath, "utf8").catch(() => "");
    const summary =
      lastMessage.trim() ||
      parsed.summaryFromEvents ||
      (execution.timedOut
        ? "Codex CLI timed out before producing a final message."
        : execution.exitCode === 0
          ? "Codex CLI completed without a final message."
          : "Codex CLI failed before producing a final message.");

    await context.trace({
      type: "adapter.codex.result",
      message: execution.exitCode === 0 ? "Codex CLI finished successfully" : "Codex CLI failed",
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        threadId: parsed.threadId,
        tokenUsage: parsed.tokenUsage,
        changedFilesHint: parsed.changedFilesHint,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: 0,
      costKnown: false,
      changedFilesHint: parsed.changedFilesHint
    };
  }
}

abstract class ClaudeLikeAdapter implements AgentAdapter {
  abstract readonly id: string;
  abstract readonly title: string;
  abstract readonly kind: "external";
  protected abstract resolveInvocation(): Promise<InvocationSpec>;
  abstract execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;

  async preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult> {
    const invocation = await this.resolveInvocation();

    try {
      const help = await probeHelp(invocation, process.cwd());
      if (help.exitCode !== 0) {
        return createPreflightResult(
          this.id,
          this.title,
          this.kind,
          "missing",
          "CLI did not respond successfully to --help.",
          invocation.displayCommand,
          [help.stderr.trim()].filter(Boolean)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createPreflightResult(
        this.id,
        this.title,
        this.kind,
        "missing",
        "CLI could not be launched.",
        invocation.displayCommand,
        [message]
      );
    }

    if (options?.probeAuth) {
      const authProbe = await probeClaudeLikeAuth(invocation, process.cwd());
      return createPreflightResult(
        this.id,
        this.title,
        this.kind,
        authProbe.status,
        authProbe.summary,
        invocation.displayCommand,
        authProbe.details
      );
    }

    return createPreflightResult(
      this.id,
      this.title,
      this.kind,
      "unverified",
      "CLI is installed. Authentication was not probed in this run.",
      invocation.displayCommand
    );
  }

  protected async executeClaudeLike(
    context: AdapterExecutionContext,
    eventType: string,
    finishLabel: string
  ): Promise<AdapterExecutionResult> {
    const prompt = buildAgentPrompt(context);
    const invocation = await this.resolveInvocation();
    const args = [
      ...invocation.argsPrefix,
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
        args
      }
    });

    const execution = await runProcess(invocation.command, args, context.workspacePath);
    const parsed = parseClaudeEvents(execution.stdout);
    const summary =
      parsed.summaryFromEvents ||
      (execution.timedOut
        ? `${this.title} timed out before producing a final message.`
        : execution.exitCode === 0
          ? `${this.title} completed without a final message.`
          : `${this.title} failed before producing a final message.`);

    await context.trace({
      type: eventType,
      message: execution.exitCode === 0 ? `${finishLabel} finished` : `${finishLabel} failed`,
      metadata: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        sessionId: parsed.sessionId,
        tokenUsage: parsed.tokenUsage,
        estimatedCostUsd: parsed.estimatedCostUsd,
        costKnown: parsed.costKnown,
        error: parsed.error,
        stderr: execution.stderr.trim()
      }
    });

    return {
      status: execution.exitCode === 0 ? "success" : "failed",
      summary,
      tokenUsage: parsed.tokenUsage,
      estimatedCostUsd: parsed.estimatedCostUsd,
      costKnown: parsed.costKnown,
      changedFilesHint: []
    };
  }
}

class ClaudeCodeAdapter extends ClaudeLikeAdapter {
  readonly kind = "external" as const;
  readonly id = "claude-code";
  readonly title = "Claude Code";

  protected async resolveInvocation(): Promise<InvocationSpec> {
    return await resolveClaudeInvocation();
  }

  async execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    return await this.executeClaudeLike(context, "adapter.claude.result", "Claude Code");
  }
}

class CursorAdapter extends ClaudeLikeAdapter {
  readonly kind = "external" as const;
  readonly id = "cursor";
  readonly title = "Cursor Agent";

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
  agentIds: string[],
  options?: AdapterPreflightOptions
): Promise<AdapterPreflightResult[]> {
  const results: AdapterPreflightResult[] = [];
  for (const agentId of agentIds) {
    const adapter = getAdapter(agentId);
    results.push(await adapter.preflight(options));
  }
  return results;
}
