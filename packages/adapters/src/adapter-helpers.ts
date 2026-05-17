import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AdapterCapability,
  AdapterExecutionContext,
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentResolvedRuntime
} from "@agentarena/core";

const execFileAsync = promisify(execFile);

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

export async function getChangedFilesFromGit(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD"], {
      cwd: workspacePath,
      encoding: "utf8"
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
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
