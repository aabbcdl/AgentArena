import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDirectory } from "./snapshot.js";
import { logger } from "./logging.js";

/**
 * Evidence directory name within workspace.
 * Adapters write evidence here during execution.
 */
export const EVIDENCE_DIR = ".aa-evidence";

/**
 * Evidence file names
 */
export const EVIDENCE_FILES = {
  TOOL_CALLS: "tool-calls.jsonl",
  CHANGED_FILES: "changed-files.json",
  EXIT_CODE: "exit-code",
  STDOUT_LOG: "stdout.log",
  STDERR_LOG: "stderr.log",
  EXECUTION_META: "execution-meta.json",
} as const;

/**
 * Tool call record written to tool-calls.jsonl
 */
export interface ToolCallRecord {
  /** ISO timestamp */
  timestamp: string;
  /** Tool name */
  name: string;
  /** Tool input (optional, for privacy) */
  input?: unknown;
  /** Tool output summary (optional) */
  outputSummary?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Whether the tool call succeeded */
  success?: boolean;
}

/**
 * Execution metadata written to execution-meta.json
 */
export interface ExecutionMeta {
  /** Adapter ID */
  adapterId: string;
  /** Start time (ISO) */
  startTime: string;
  /** End time (ISO) */
  endTime?: string;
  /** Total duration in milliseconds */
  durationMs?: number;
  /** Token usage reported by adapter */
  tokenUsage?: number;
  /** Estimated cost in USD */
  estimatedCostUsd?: number;
  /** Whether cost is known precisely */
  costKnown?: boolean;
  /** Session ID (if available) */
  sessionId?: string;
  /** Transport used (if available) */
  transportUsed?: string;
  /** Whether fallback transport was used */
  usedFallback?: boolean;
  /** Adapter status */
  status?: "success" | "failed" | "cancelled";
  /** Adapter summary */
  summary?: string;
}

/**
 * Evidence data collected from a workspace after execution.
 */
export interface CollectedEvidence {
  /** Tool calls made during execution */
  toolCalls: ToolCallRecord[];
  /** Files changed (reported by adapter) */
  changedFiles: string[];
  /** Exit code (0 = success) */
  exitCode: number | null;
  /** Standard output log */
  stdout: string;
  /** Standard error log */
  stderr: string;
  /** Execution metadata */
  meta: ExecutionMeta | null;
  /** Source of the evidence */
  source: "reported" | "inferred" | "partial";
  /** Whether evidence was complete */
  complete: boolean;
}

/**
 * Options for writing evidence
 */
export interface WriteEvidenceOptions {
  /** Adapter ID */
  adapterId: string;
  /** Workspace path */
  workspacePath: string;
}

/**
 * Write a tool call record to the evidence directory.
 */
export async function writeToolCall(
  options: WriteEvidenceOptions,
  record: ToolCallRecord
): Promise<void> {
  const evidenceDir = path.join(options.workspacePath, EVIDENCE_DIR);
  await ensureDirectory(evidenceDir);

  const filePath = path.join(evidenceDir, EVIDENCE_FILES.TOOL_CALLS);
  const line = JSON.stringify(record) + "\n";

  try {
    await fs.appendFile(filePath, line, "utf8");
  } catch (error) {
    logger.warn("evidence", "write_failed", `Failed to write tool call evidence`, {
      agentId: options.adapterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Write changed files list to evidence directory.
 */
export async function writeChangedFiles(
  options: WriteEvidenceOptions,
  files: string[]
): Promise<void> {
  const evidenceDir = path.join(options.workspacePath, EVIDENCE_DIR);
  await ensureDirectory(evidenceDir);

  const filePath = path.join(evidenceDir, EVIDENCE_FILES.CHANGED_FILES);
  try {
    await fs.writeFile(filePath, JSON.stringify(files, null, 2), "utf8");
  } catch (error) {
    logger.warn("evidence", "write_failed", `Failed to write changed files evidence`, {
      agentId: options.adapterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Write exit code to evidence directory.
 */
export async function writeExitCode(
  options: WriteEvidenceOptions,
  exitCode: number
): Promise<void> {
  const evidenceDir = path.join(options.workspacePath, EVIDENCE_DIR);
  await ensureDirectory(evidenceDir);

  const filePath = path.join(evidenceDir, EVIDENCE_FILES.EXIT_CODE);
  try {
    await fs.writeFile(filePath, String(exitCode), "utf8");
  } catch (error) {
    logger.warn("evidence", "write_failed", `Failed to write exit code evidence`, {
      agentId: options.adapterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Write stdout/stderr logs to evidence directory.
 */
export async function writeProcessOutput(
  options: WriteEvidenceOptions,
  stdout: string,
  stderr: string
): Promise<void> {
  const evidenceDir = path.join(options.workspacePath, EVIDENCE_DIR);
  await ensureDirectory(evidenceDir);

  try {
    if (stdout) {
      await fs.writeFile(
        path.join(evidenceDir, EVIDENCE_FILES.STDOUT_LOG),
        stdout,
        "utf8"
      );
    }
    if (stderr) {
      await fs.writeFile(
        path.join(evidenceDir, EVIDENCE_FILES.STDERR_LOG),
        stderr,
        "utf8"
      );
    }
  } catch (error) {
    logger.warn("evidence", "write_failed", `Failed to write process output evidence`, {
      agentId: options.adapterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Write execution metadata to evidence directory.
 */
export async function writeExecutionMeta(
  options: WriteEvidenceOptions,
  meta: ExecutionMeta
): Promise<void> {
  const evidenceDir = path.join(options.workspacePath, EVIDENCE_DIR);
  await ensureDirectory(evidenceDir);

  const filePath = path.join(evidenceDir, EVIDENCE_FILES.EXECUTION_META);
  try {
    await fs.writeFile(filePath, JSON.stringify(meta, null, 2), "utf8");
  } catch (error) {
    logger.warn("evidence", "write_failed", `Failed to write execution metadata`, {
      agentId: options.adapterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Collect all evidence from a workspace after execution.
 * Returns null fields for evidence that couldn't be read.
 */
export async function collectEvidence(
  workspacePath: string
): Promise<CollectedEvidence> {
  const evidenceDir = path.join(workspacePath, EVIDENCE_DIR);

  const result: CollectedEvidence = {
    toolCalls: [],
    changedFiles: [],
    exitCode: null,
    stdout: "",
    stderr: "",
    meta: null,
    source: "inferred",
    complete: false,
  };

  // Check if evidence directory exists
  try {
    await fs.access(evidenceDir);
  } catch {
    // No evidence directory - return inferred
    return result;
  }

  // Read tool calls
  try {
    const toolCallsPath = path.join(evidenceDir, EVIDENCE_FILES.TOOL_CALLS);
    const content = await fs.readFile(toolCallsPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    result.toolCalls = lines.map((line) => JSON.parse(line) as ToolCallRecord);
  } catch {
    // File doesn't exist or invalid - skip
  }

  // Read changed files
  try {
    const changedFilesPath = path.join(evidenceDir, EVIDENCE_FILES.CHANGED_FILES);
    const content = await fs.readFile(changedFilesPath, "utf8");
    result.changedFiles = JSON.parse(content) as string[];
  } catch {
    // File doesn't exist or invalid - skip
  }

  // Read exit code
  try {
    const exitCodePath = path.join(evidenceDir, EVIDENCE_FILES.EXIT_CODE);
    const content = await fs.readFile(exitCodePath, "utf8");
    result.exitCode = parseInt(content.trim(), 10);
  } catch {
    // File doesn't exist - skip
  }

  // Read stdout
  try {
    const stdoutPath = path.join(evidenceDir, EVIDENCE_FILES.STDOUT_LOG);
    result.stdout = await fs.readFile(stdoutPath, "utf8");
  } catch {
    // File doesn't exist - skip
  }

  // Read stderr
  try {
    const stderrPath = path.join(evidenceDir, EVIDENCE_FILES.STDERR_LOG);
    result.stderr = await fs.readFile(stderrPath, "utf8");
  } catch {
    // File doesn't exist - skip
  }

  // Read execution metadata
  try {
    const metaPath = path.join(evidenceDir, EVIDENCE_FILES.EXECUTION_META);
    const content = await fs.readFile(metaPath, "utf8");
    result.meta = JSON.parse(content) as ExecutionMeta;
  } catch {
    // File doesn't exist or invalid - skip
  }

  // Determine source based on what we collected
  const hasToolCalls = result.toolCalls.length > 0;
  const hasChangedFiles = result.changedFiles.length > 0;
  const hasMeta = result.meta !== null;
  const hasExitCode = result.exitCode !== null;

  if (hasToolCalls && hasChangedFiles && hasMeta && hasExitCode) {
    result.source = "reported";
    result.complete = true;
  } else if (hasToolCalls || hasChangedFiles || hasMeta) {
    result.source = "partial";
    result.complete = false;
  }

  return result;
}

/**
 * Write all evidence for a completed execution.
 * This is a convenience function that writes all evidence at once.
 */
export async function writeExecutionEvidence(
  options: WriteEvidenceOptions,
  execution: {
    toolCalls?: ToolCallRecord[];
    changedFiles?: string[];
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    meta?: Partial<ExecutionMeta>;
  }
): Promise<void> {
  const promises: Promise<void>[] = [];

  if (execution.toolCalls) {
    for (const tc of execution.toolCalls) {
      promises.push(writeToolCall(options, tc));
    }
  }

  if (execution.changedFiles) {
    promises.push(writeChangedFiles(options, execution.changedFiles));
  }

  if (execution.exitCode !== undefined) {
    promises.push(writeExitCode(options, execution.exitCode));
  }

  if (execution.stdout !== undefined || execution.stderr !== undefined) {
    promises.push(
      writeProcessOutput(
        options,
        execution.stdout ?? "",
        execution.stderr ?? ""
      )
    );
  }

  if (execution.meta) {
    promises.push(
      writeExecutionMeta(options, {
        adapterId: options.adapterId,
        startTime: new Date().toISOString(),
        ...execution.meta,
      })
    );
  }

  await Promise.all(promises);
}
