import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AdapterPreflightResult,
  AgentRunResult,
  CommandStepResult,
} from "@agentarena/core";
import {
  copyRepository,
  ensureDirectory,
  isAbortError,
} from "@agentarena/core";
import { runCommandSteps } from "@agentarena/judges";
import {
  createBaseResult,
  createCancelledRunResult,
  createSkippedRunResult,
  summarizeCommandStepFailure,
} from "./result-builder.js";
import type { AgentRunContext } from "./types.js";
import { formatErrorDetails, formatErrorMessage } from "./workspace.js";

const execFileAsync = promisify(execFile);
const THIRD_PARTY_CLAUDE_TOOL_CONFIG_PATHS = [".claude", ".codex", ".mcp.json"] as const;

function requiresThirdPartyClaudeWorkspaceIsolation(preflight: AdapterPreflightResult): boolean {
  return (
    preflight.baseAgentId === "claude-code" &&
    preflight.resolvedRuntime?.providerKind != null &&
    preflight.resolvedRuntime.providerKind !== "official"
  );
}

async function isolateThirdPartyClaudeWorkspace(workspacePath: string): Promise<void> {
  for (const relativePath of THIRD_PARTY_CLAUDE_TOOL_CONFIG_PATHS) {
    await fs.rm(path.join(workspacePath, relativePath), { recursive: true, force: true });
  }
}

export async function setupWorkspaceAndPrechecks(
  repoPath: string,
  preflight: AdapterPreflightResult,
  context: AgentRunContext
): Promise<AgentRunResult | undefined> {
  const { agentOutputPath, workspacePath, traceRecorder, throwIfCancelled } = context;

  if (preflight.status === "missing" || preflight.status === "blocked") {
    await ensureDirectory(agentOutputPath);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "preflight.result",
      message: preflight.summary,
      metadata: {
        status: preflight.status,
        command: preflight.command,
        details: preflight.details
      }
    });
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "agent.skipped",
      message: `Skipped ${preflight.agentId} because preflight status is ${preflight.status}.`,
      metadata: {
        status: preflight.status
      }
    });
    return createSkippedRunResult(preflight, context.tracePath, workspacePath);
  }

  await ensureDirectory(agentOutputPath);

  throwIfCancelled("workspace setup");

  try {
    await copyRepository(repoPath, workspacePath);
  } catch (error) {
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "agent.copy_failed",
      message: "Failed to copy repository to workspace.",
      metadata: errorDetails
    });
    return {
      ...createSkippedRunResult(preflight, context.tracePath, workspacePath),
      summary: `Failed to copy repository: ${errorDetails.message}`
    };
  }

  if (requiresThirdPartyClaudeWorkspaceIsolation(preflight)) {
    try {
      await isolateThirdPartyClaudeWorkspace(workspacePath);
    } catch (error) {
      const errorDetails = formatErrorDetails(error);
      await traceRecorder.record({
        agentId: preflight.agentId,
        timestamp: new Date().toISOString(),
        type: "setup.error",
        message: "Failed to isolate third-party Claude tool configuration.",
        metadata: errorDetails
      });
      return {
        ...createSkippedRunResult(preflight, context.tracePath, workspacePath),
        summary: `Failed to isolate third-party Claude tool configuration: ${errorDetails.message}`
      };
    }
  }

  // Initialize git in workspace so command judges relying on `git diff`
  // (e.g. regex-match on diff output, patch-validation scope checks) work.
  // Failure is non-fatal for most judges — but silently swallowing it makes
  // diff-scope misreporting impossible to diagnose. Record a trace warning so
  // the failure is visible in the run's diagnostic trail.
  try {
    await execFileAsync("git", ["init"], { cwd: workspacePath, timeout: 10_000 });
    await execFileAsync("git", ["add", "-A"], { cwd: workspacePath, timeout: 30_000 });
    await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: workspacePath, timeout: 30_000 });
  } catch (gitError) {
    const reason = gitError instanceof Error ? gitError.message : String(gitError);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "setup.git_unavailable",
      message: `Workspace git baseline unavailable: ${reason}. Diff-scope judges may misreport changes.`,
      metadata: { workspacePath, reason }
    });
  }

  await traceRecorder.record({
    agentId: preflight.agentId,
    timestamp: new Date().toISOString(),
    type: "preflight.result",
    message: preflight.summary,
    metadata: {
      status: preflight.status,
      command: preflight.command,
      details: preflight.details
    }
  });

  return undefined;
}

export async function runSetupCommands(
  preflight: AdapterPreflightResult,
  context: AgentRunContext
): Promise<{ setupResults: CommandStepResult[]; earlyResult?: AgentRunResult }> {
  const { task, workspacePath, traceRecorder, throwIfCancelled, cancellation } = context;

  let setupResults: CommandStepResult[] = [];
  try {
    throwIfCancelled("setup");
    setupResults = await runCommandSteps(task.setupCommands, workspacePath, task.envAllowList, cancellation?.signal, { allowEval: context.allowEvalInTaskCommands });
  } catch (error) {
    if (isAbortError(error)) {
      return {
        setupResults: [],
        earlyResult: createCancelledRunResult(preflight, context.tracePath, workspacePath, formatErrorMessage(error))
      };
    }
    const errorDetails = formatErrorDetails(error);
    await traceRecorder.record({
      agentId: preflight.agentId,
      timestamp: new Date().toISOString(),
      type: "setup.error",
      message: "Setup commands execution failed.",
      metadata: errorDetails
    });
    return {
      setupResults: [],
      earlyResult: {
        ...createSkippedRunResult(preflight, context.tracePath, workspacePath),
        summary: `Task pack setup failed before the agent started: ${errorDetails.message}`,
        scoreExclusionReason: "Task setup failed before the agent started.",
        failureCategory: "task-pack",
        setupResults: []
      }
    };
  }

  await traceRecorder.record({
    agentId: preflight.agentId,
    timestamp: new Date().toISOString(),
    type: "setup.finish",
    message:
      setupResults.length === 0
        ? "No setup commands executed."
        : setupResults.every((value) => value.success)
          ? "All setup commands passed."
          : "One or more setup commands failed.",
    metadata: {
      setupResults: setupResults.map((value) => ({
        stepId: value.stepId,
        label: value.label,
        success: value.success,
        exitCode: value.exitCode
      }))
    }
  });

  if (setupResults.some((value) => !value.success)) {
    const failedStep = setupResults.find((value) => !value.success) ?? setupResults[0];
    return {
      setupResults,
      earlyResult: createBaseResult({
        preflight,
        tracePath: context.tracePath,
        workspacePath,
        status: "failed",
        summary: failedStep
          ? summarizeCommandStepFailure("setup", failedStep)
          : "Setup command failed but no result was captured.",
        setupResults,
        scoreExcluded: true,
        scoreExclusionReason: "Task setup failed before the agent started.",
        failureCategory: "task-pack"
      })
    };
  }

  return { setupResults, earlyResult: undefined };
}

export async function runTeardownCommands(
  preflight: AdapterPreflightResult,
  adapterError: unknown,
  judgeError: unknown,
  context: AgentRunContext,
  signal?: AbortSignal
): Promise<{ teardownResults: CommandStepResult[]; teardownError: unknown }> {
  const { task, workspacePath, traceRecorder, cancellation } = context;

  let teardownResults: CommandStepResult[] = [];
  let teardownError: unknown;
  const teardownShouldIgnoreCancellation =
    cancellation?.signal?.aborted === true || isAbortError(adapterError) || isAbortError(judgeError);

  try {
    const effectiveSignal = teardownShouldIgnoreCancellation
      ? signal
      : (signal ?? cancellation?.signal);
    teardownResults = await runCommandSteps(
      task.teardownCommands,
      workspacePath,
      task.envAllowList,
      effectiveSignal,
      { allowEval: context.allowEvalInTaskCommands }
    );
  } catch (error) {
    if (!isAbortError(error)) {
      teardownError = error;
      const errorDetails = formatErrorDetails(error);
      await traceRecorder.record({
        agentId: preflight.agentId,
        timestamp: new Date().toISOString(),
        type: "teardown.error",
        message: "Teardown commands execution failed.",
        metadata: errorDetails
      });
    }
  }

  return { teardownResults, teardownError };
}
