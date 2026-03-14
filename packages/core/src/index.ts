import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
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

export type TaskJudge = CommandJudge | FileExistsJudge | FileContainsJudge | JsonValueJudge;

export interface TaskPack {
  schemaVersion: typeof TASK_PACK_SCHEMA_V1;
  id: string;
  title: string;
  description?: string;
  prompt: string;
  envAllowList: string[];
  setupCommands: CommandExecutionSpec[];
  judges: TaskJudge[];
  teardownCommands: CommandExecutionSpec[];
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
}

export type AdapterPreflightStatus = "ready" | "unverified" | "blocked" | "missing";

export interface AdapterPreflightOptions {
  probeAuth?: boolean;
}

export interface AdapterPreflightResult {
  agentId: string;
  agentTitle: string;
  adapterKind: "demo" | "external";
  status: AdapterPreflightStatus;
  summary: string;
  command?: string;
  details?: string[];
}

export interface AgentAdapter {
  id: string;
  title: string;
  kind: "demo" | "external";
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
  return inputPath.split(path.sep).join("/");
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
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

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

      const fileBuffer = await fs.readFile(absolutePath);
      const hash = createHash("sha1").update(fileBuffer).digest("hex");
      snapshots.set(relativePath, { relativePath, hash });
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
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1_000).toFixed(2)}s`;
}
