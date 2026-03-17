import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const TASK_PACK_SCHEMA_V1 = "repoarena.taskpack/v1";

export interface CommandExecutionSpec {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envAllowList?: string[];
  env?: Record<string, string>;
}

export interface CommandJudge extends CommandExecutionSpec {
  type: "command";
}

export interface FileExistsJudge {
  id: string;
  label: string;
  type: "file-exists";
  path: string;
}

export interface FileContainsJudge {
  id: string;
  label: string;
  type: "file-contains";
  path: string;
  pattern: string;
  regex?: boolean;
  flags?: string;
}

export interface JsonValueJudge {
  id: string;
  label: string;
  type: "json-value";
  path: string;
  pointer: string;
  expected: unknown;
}

export interface GlobJudge {
  id: string;
  label: string;
  type: "glob";
  pattern: string;
  minMatches?: number;
  maxMatches?: number;
}

export interface FileCountJudge {
  id: string;
  label: string;
  type: "file-count";
  pattern: string;
  equals?: number;
  min?: number;
  max?: number;
}

export interface SnapshotJudge {
  id: string;
  label: string;
  type: "snapshot";
  path: string;
  snapshotPath: string;
}

export interface JsonSchemaJudge {
  id: string;
  label: string;
  type: "json-schema";
  path: string;
  schema?: Record<string, unknown>;
  schemaPath?: string;
}

export type TaskJudge =
  | CommandJudge
  | FileExistsJudge
  | FileContainsJudge
  | JsonValueJudge
  | GlobJudge
  | FileCountJudge
  | SnapshotJudge
  | JsonSchemaJudge;

export interface TaskPackMetadata {
  source: "official" | "community";
  owner: string;
  objective?: string;
  repoTypes: string[];
  tags: string[];
  dependencies: string[];
  judgeRationale?: string;
}

export interface TaskPack {
  schemaVersion: typeof TASK_PACK_SCHEMA_V1;
  id: string;
  title: string;
  description?: string;
  prompt: string;
  metadata?: TaskPackMetadata;
  envAllowList: string[];
  setupCommands: CommandExecutionSpec[];
  judges: TaskJudge[];
  teardownCommands: CommandExecutionSpec[];
}

export interface AgentRequestedConfig {
  model?: string;
  reasoningEffort?: string;
  providerProfileId?: string;
}

export interface AgentSelection {
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  config: AgentRequestedConfig;
  configSource?: "ui" | "cli";
}

export type AgentRuntimeSource =
  | "ui"
  | "cli"
  | "env"
  | "codex-config"
  | "cli-default"
  | "event-stream"
  | "profile-config"
  | "official-login"
  | "unknown";

export type AgentRuntimeVerification = "confirmed" | "inferred" | "unknown";

export interface AgentResolvedRuntime {
  effectiveModel?: string;
  effectiveReasoningEffort?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  providerKind?: ClaudeProviderProfileKind;
  providerSource?: "official-login" | "profile-config" | "env" | "unknown";
  source: AgentRuntimeSource;
  verification: AgentRuntimeVerification;
  notes?: string[];
}

export type ClaudeProviderProfileKind = "official" | "anthropic-compatible" | "openai-proxy";
export type ClaudeProviderApiFormat = "anthropic-messages" | "openai-chat-via-proxy";
export type ClaudeProviderRiskFlag =
  | "third-party-provider"
  | "compatibility-mode"
  | "user-managed-secret";

export interface ClaudeProviderProfile {
  id: string;
  name: string;
  kind: ClaudeProviderProfileKind;
  homepage?: string;
  baseUrl?: string;
  apiFormat: ClaudeProviderApiFormat;
  primaryModel?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  extraEnv: Record<string, string>;
  writeCommonConfig: boolean;
  notes?: string;
  riskFlags: ClaudeProviderRiskFlag[];
  isBuiltIn?: boolean;
  secretStored?: boolean;
}

export interface TraceEvent {
  timestamp: string;
  agentId: string;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AdapterExecutionContext {
  agentId: string;
  selection: AgentSelection;
  repoPath: string;
  workspacePath: string;
  environment: NodeJS.ProcessEnv;
  task: TaskPack;
  trace: (event: Omit<TraceEvent, "agentId" | "timestamp">) => Promise<void>;
}

export interface AdapterExecutionResult {
  status: "success" | "failed";
  summary: string;
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  changedFilesHint: string[];
  resolvedRuntime?: AgentResolvedRuntime;
}

export type AdapterPreflightStatus = "ready" | "unverified" | "blocked" | "missing";
export type AdapterSupportTier = "supported" | "experimental" | "blocked";
export type AdapterMetricAvailability = "available" | "estimated" | "unavailable";
export type AdapterTraceRichness = "full" | "partial" | "minimal";

export interface AdapterCapability {
  supportTier: AdapterSupportTier;
  invocationMethod: string;
  authPrerequisites: string[];
  tokenAvailability: AdapterMetricAvailability;
  costAvailability: AdapterMetricAvailability;
  traceRichness: AdapterTraceRichness;
  knownLimitations: string[];
  configurableRuntime?: {
    model: boolean;
    reasoningEffort: boolean;
    providerProfile?: boolean;
  };
}

export interface AdapterPreflightOptions {
  probeAuth?: boolean;
  selection?: AgentSelection;
}

export interface AdapterPreflightResult {
  agentId: string;
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  requestedConfig: AgentRequestedConfig;
  resolvedRuntime?: AgentResolvedRuntime;
  agentTitle: string;
  adapterKind: "demo" | "external";
  status: AdapterPreflightStatus;
  summary: string;
  capability: AdapterCapability;
  command?: string;
  details?: string[];
}

export interface AgentAdapter {
  id: string;
  title: string;
  kind: "demo" | "external";
  capability: AdapterCapability;
  preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult>;
  execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;
}

export interface JudgeResult {
  judgeId: string;
  label: string;
  type: TaskJudge["type"];
  command?: string;
  target?: string;
  expectation?: string;
  exitCode: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd?: string;
}

export interface CommandStepResult {
  stepId: string;
  label: string;
  command: string;
  exitCode: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd: string;
}

export interface DiffSummary {
  added: string[];
  changed: string[];
  removed: string[];
}

export interface AgentRunResult {
  agentId: string;
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  requestedConfig: AgentRequestedConfig;
  resolvedRuntime?: AgentResolvedRuntime;
  agentTitle: string;
  status: "success" | "failed";
  adapterKind: "demo" | "external";
  preflight: AdapterPreflightResult;
  summary: string;
  durationMs: number;
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  changedFiles: string[];
  changedFilesHint: string[];
  setupResults: CommandStepResult[];
  judgeResults: JudgeResult[];
  teardownResults: CommandStepResult[];
  tracePath: string;
  workspacePath: string;
  diff: DiffSummary;
}

export interface BenchmarkRun {
  runId: string;
  createdAt: string;
  repoPath: string;
  outputPath: string;
  task: TaskPack;
  preflights: AdapterPreflightResult[];
  results: AgentRunResult[];
}

export interface FileSnapshotEntry {
  relativePath: string;
  hash: string;
}

const INTERNAL_IGNORED_NAMES = new Set([".repoarena", ".git"]);
const BASELINE_ENV_NAMES = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "WINDIR",
  "HOME",
  "USERPROFILE",
  "TMP",
  "TEMP",
  "LANG",
  "TERM",
  "PWD"
];

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function normalizePath(inputPath: string): string {
  return inputPath
    .split(path.sep)
    .join("/")
    .replace(/\\/g, "/");
}

export function isWindowsLikePath(inputPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(inputPath) || inputPath.includes("\\");
}

export function portableRelativePath(fromPath: string, toPath: string): string {
  if (isWindowsLikePath(fromPath) || isWindowsLikePath(toPath)) {
    return path.win32.relative(fromPath, toPath).replace(/\\/g, "/");
  }

  return path.posix.relative(fromPath, toPath).replace(/\\/g, "/");
}

export function portableBasename(inputPath: string): string {
  return isWindowsLikePath(inputPath) ? path.win32.basename(inputPath) : path.posix.basename(inputPath);
}

export function isPathInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedTarget = path.resolve(targetPath);
  const relativePath = path.relative(resolvedWorkspace, resolvedTarget);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function safePathJoin(basePath: string, ...segments: string[]): string {
  const joined = path.join(basePath, ...segments);
  if (!isPathInsideWorkspace(basePath, joined)) {
    throw new Error(`Path traversal detected: attempted to access "${joined}" outside workspace "${basePath}"`);
  }
  return joined;
}

export function buildExecutionEnvironment(
  allowedNames: string[],
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const name of [...BASELINE_ENV_NAMES, ...allowedNames]) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }

  for (const [name, value] of Object.entries(overrides)) {
    env[name] = value;
  }

  return env;
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function copyRepository(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.cp(sourcePath, destinationPath, {
      force: true,
      recursive: true,
      filter: (itemPath) => {
        const name = path.basename(itemPath);
        return !INTERNAL_IGNORED_NAMES.has(name);
      }
    });
}

export async function snapshotDirectory(rootPath: string): Promise<Map<string, FileSnapshotEntry>> {
  const snapshots = new Map<string, FileSnapshotEntry>();

  async function walk(currentPath: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      // Skip directories that cannot be read (e.g., permission issues)
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = normalizePath(path.relative(rootPath, absolutePath));

      if (entry.isDirectory()) {
        if (INTERNAL_IGNORED_NAMES.has(entry.name)) {
          continue;
        }

        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const fileBuffer = await fs.readFile(absolutePath);
        // Use SHA-256 for better security (SHA-1 is sufficient for file comparison but SHA-256 is more future-proof)
        const hash = createHash("sha256").update(fileBuffer).digest("hex");
        snapshots.set(relativePath, { relativePath, hash });
      } catch (error) {
        // Skip files that cannot be read
        continue;
      }
    }
  }

  await walk(rootPath);
  return snapshots;
}

export function diffSnapshots(
  before: Map<string, FileSnapshotEntry>,
  after: Map<string, FileSnapshotEntry>
): DiffSummary {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [relativePath, afterEntry] of after.entries()) {
    const beforeEntry = before.get(relativePath);

    if (!beforeEntry) {
      added.push(relativePath);
      continue;
    }

    if (beforeEntry.hash !== afterEntry.hash) {
      changed.push(relativePath);
    }
  }

  for (const relativePath of before.keys()) {
    if (!after.has(relativePath)) {
      removed.push(relativePath);
    }
  }

  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort()
  };
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "0ms";
  }

  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = ((durationMs % 60_000) / 1_000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

export function getPlatformInfo(): { platform: string; arch: string; nodeVersion: string } {
  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version
  };
}

export function validateTaskPackId(id: string): boolean {
  // Task pack IDs should be alphanumeric with hyphens, 3-64 characters
  return /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(id) || /^[a-z0-9]{1,64}$/.test(id);
}

function slugifyVariantPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createAgentSelection(input: {
  baseAgentId: string;
  displayLabel?: string;
  config?: AgentRequestedConfig;
  configSource?: "ui" | "cli";
}): AgentSelection {
  const config = input.config ?? {};
  const variantParts = [input.baseAgentId];
  if (config.providerProfileId) {
    variantParts.push(slugifyVariantPart(config.providerProfileId) || "profile");
  }
  if (config.model) {
    variantParts.push(slugifyVariantPart(config.model) || "model");
  }
  if (config.reasoningEffort) {
    variantParts.push(slugifyVariantPart(config.reasoningEffort) || "reasoning");
  }

  return {
    baseAgentId: input.baseAgentId,
    variantId: variantParts.join("-"),
    displayLabel: input.displayLabel ?? input.baseAgentId,
    config,
    configSource: input.configSource
  };
}
