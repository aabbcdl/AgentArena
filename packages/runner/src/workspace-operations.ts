import { execFile } from "node:child_process";
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

  // Initialize git in workspace so command judges using `git diff` work
  try {
    await execFileAsync("git", ["init"], { cwd: workspacePath, timeout: 10_000 });
    await execFileAsync("git", ["add", "-A"], { cwd: workspacePath, timeout: 30_000 });
    await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: workspacePath, timeout: 30_000 });
  } catch {
    // Non-fatal: workspace without git still works for most judges
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
    setupResults = await runCommandSteps(task.setupCommands, workspacePath, task.envAllowList, cancellation?.signal, { allowEval: true });
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
        summary: `⚠️ Task pack setup failed (not an agent/model issue): ${errorDetails.message}`,
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
        setupResults
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
      { allowEval: true }
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
