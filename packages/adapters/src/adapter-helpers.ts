import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  type AdapterCapability,
  type AdapterExecutionContext,
  type AdapterPreflightOptions,
  type AdapterPreflightResult,
  type AgentResolvedRuntime,
  logger
} from "@agentarena/core";

const execFileAsync = promisify(execFile);

/**
 * Tagged result mirroring runner/snapshot.ts ChangedFilesResult, but adapter-local
 * to avoid a cross-package import. When `reliable === false`, callers (adapters
 * that build `changedFilesHint`) must NOT treat empty `files` as "agent changed
 * nothing" — the data is missing, not empty.
 *
 * @see {@link ChangedFilesResult} in packages/runner/src/snapshot.ts — identical shape, kept separate to avoid cross-package import.
 */
export interface ChangedFilesHintResult {
  files: string[];
  reliable: boolean;
  reason?: string;
}

/**
 * Build the prompt sent to every agent.
 *
 * FAIRNESS NOTE: The CRITICAL RULES below constrain agent behavior and directly
 * affect benchmark results. Task pack authors should be aware that agents are
 * pre-instructed to:
 * - Not install software or download files
 * - Not use plan mode (EnterPlanMode)
 * - Work only inside the workspace directory
 * - Stop after completing the task (no exploratory side-quests)
 *
 * These constraints ensure reproducibility and prevent agents from modifying
 * the benchmark environment, but they also limit what agents can do. If a
 * task requires npm install, it must be in the task's setup commands, not
 * left to the agent.
 */
export function buildAgentPrompt(context: AdapterExecutionContext): string {
  return [
    `You are running inside AgentArena as adapter "${context.selection.baseAgentId}" and variant "${context.selection.variantId}".`,
    "",
    "CRITICAL RULES:",
    "- Work ONLY inside the current workspace directory.",
    "- Do NOT install software, packages, or tools (no npm install, pip install, apt, winget, scoop, etc.).",
    "- Do NOT download files from the internet.",
    "- Do NOT run system commands unrelated to the task (no system upgrades, no environment setup).",
    "- ONLY modify source code files (.ts, .js, .json, .yaml, .md, etc.) that are part of the task.",
    "- If you need a dependency, check if it already exists before considering installation.",
    "- Keep changes minimal and directly relevant to the task.",
    "- Do not ask follow-up questions.",
    "- Do NOT use EnterPlanMode or plan mode — execute the task directly by reading and editing files.",
    "- Stop after completing the specific task described below.",
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

/**
 * Save the assembled prompt to disk and emit a trace event.
 * Call this after buildAgentPrompt() in every adapter.
 */
export async function savePromptArtifact(
  prompt: string,
  workspacePath: string,
  context: AdapterExecutionContext
): Promise<void> {
  // Save to file (best-effort)
  try {
    const promptPath = path.join(workspacePath, "prompt.txt");
    await fs.writeFile(promptPath, prompt, "utf8");
  } catch {
    // Best effort — don't fail the run
  }

  // Emit trace event
  await context.trace({
    type: "adapter.prompt",
    message: "Assembled prompt sent to agent",
    metadata: { promptLength: prompt.length, promptPreview: prompt.slice(0, 500) }
  });
}

export async function getChangedFilesFromGit(workspacePath: string): Promise<ChangedFilesHintResult> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD"], {
      cwd: workspacePath,
      encoding: "utf8"
    });
    return { files: stdout.trim().split("\n").filter(Boolean), reliable: true };
  } catch (error: unknown) {
    const stderr = (error instanceof Error && "stderr" in error) ? String((error as NodeJS.ErrnoException & { stderr?: string }).stderr ?? "") : "";
    const rawCode = (error instanceof Error && "code" in error) ? (error as Record<string, unknown>).code : undefined;
    if (stderr.includes("not a git repository") || rawCode === 128 || rawCode === "128") {
      return { files: [], reliable: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("adapter", "git.diff_failed", `getChangedFilesFromGit failed in ${workspacePath}: ${message}`);
    return { files: [], reliable: false, reason: message };
  }
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
