/**
 * Validation of UI run payloads.
 *
 * Extracted to its own module so the test suite can import the exact
 * implementation that ships, rather than maintaining a hand-duplicated
 * mirror that silently drifts (see CRITICAL #13 in fix/stabilize-and-harden review).
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import { isPathInsideWorkspace, isScoreMode, SCORE_MODES } from "@agentarena/core";
import type { UiRunPayload } from "./shared.js";

function canonicalPathForComparison(inputPath: string): string {
  const fallback = path.resolve(inputPath);
  let candidate = fallback;
  const suffix: string[] = [];

  // macOS exposes /var and /tmp as symlinks into /private. Resolve the
  // existing ancestor as well as the target so a not-yet-created output path
  // is compared in the same namespace as the server's cwd.
  while (true) {
    try {
      return path.join(realpathSync.native(candidate), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return fallback;
      const parent = path.dirname(candidate);
      if (parent === candidate) return fallback;
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

function isPathInsideSync(basePath: string, targetPath: string): boolean {
  const resolvedBase = canonicalPathForComparison(basePath);
  const resolvedTarget = canonicalPathForComparison(targetPath);
  const relativePath = path.relative(resolvedBase, resolvedTarget);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/** Resolve user-facing relative paths against the configured UI workspace. */
export function resolveRunPayloadPaths(runPayload: UiRunPayload, cwd: string = process.cwd()): UiRunPayload {
  const resolvePath = (value: unknown): unknown =>
    typeof value === "string" && value.trim() ? path.resolve(cwd, value) : value;

  return {
    ...runPayload,
    repoPath: resolvePath(runPayload.repoPath) as string,
    taskPath: resolvePath(runPayload.taskPath) as string,
    ...(runPayload.outputPath !== undefined ? { outputPath: resolvePath(runPayload.outputPath) as string } : {})
  };
}

/**
 * Validate a run payload from the UI.
 * Returns null when valid, or an actionable error message string when invalid.
 *
 * Path checks intentionally take an explicit `cwd` rather than calling `process.cwd()`
 * directly, so unit tests can exercise the function deterministically and so the
 * same code path can be used from contexts that switch working directories.
 */
export function validateRunPayload(
  runPayload: UiRunPayload,
  cwd: string = process.cwd(),
  taskRoots: string[] = [cwd]
): string | null {
  if (!runPayload.repoPath || typeof runPayload.repoPath !== "string") {
    return "repoPath is required and must be a string.";
  }
  if (!runPayload.taskPath || typeof runPayload.taskPath !== "string") {
    return "taskPath is required and must be a string.";
  }
  if (runPayload.agents !== undefined) {
    if (!Array.isArray(runPayload.agents)) {
      return "agents must be an array when provided.";
    }
    for (const agent of runPayload.agents) {
      if (typeof agent === "string") {
        if (!agent.trim()) return "Every agent ID must be a non-empty string.";
        continue;
      }
      if (!agent || typeof agent !== "object" || typeof agent.baseAgentId !== "string" || !agent.baseAgentId.trim()) {
        return "Every agent selection must include a non-empty baseAgentId.";
      }
      if (agent.runtimeProfileId !== undefined) {
        if (typeof agent.runtimeProfileId !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(agent.runtimeProfileId)) {
          return "runtimeProfileId must be a valid RuntimeProfile ID.";
        }
        if (agent.baseAgentId !== "codex" && agent.baseAgentId !== "claude-code") {
          return "RuntimeProfile selections support only codex and claude-code.";
        }
        if (agent.launchSpecHash !== undefined && (typeof agent.launchSpecHash !== "string" || !agent.launchSpecHash.trim())) {
          return "launchSpecHash must be a non-empty string when provided.";
        }
        if (agent.verificationReceiptId !== undefined && (typeof agent.verificationReceiptId !== "string" || !agent.verificationReceiptId.trim())) {
          return "verificationReceiptId must be a non-empty string when provided.";
        }
      }
    }
  }
  const resolvedPayload = resolveRunPayloadPaths(runPayload, cwd);
  if (!isPathInsideSync(cwd, resolvedPayload.repoPath)) {
    return "repoPath must be within the current working directory.";
  }
  if (!taskRoots.some((root) => isPathInsideSync(root, resolvedPayload.taskPath))) {
    return "taskPath must be within an allowed task directory.";
  }
  if (resolvedPayload.outputPath !== undefined) {
    if (typeof resolvedPayload.outputPath !== "string" || !resolvedPayload.outputPath.trim()) {
      return "outputPath must be a non-empty string when provided.";
    }
    if (!isPathInsideSync(cwd, resolvedPayload.outputPath)) {
      return "outputPath must be within the current working directory.";
    }
  }
  if (runPayload.maxConcurrency !== undefined) {
    const parsed = Number(runPayload.maxConcurrency);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return "maxConcurrency must be a positive integer.";
    }
  }
  if (runPayload.tokenBudget !== undefined) {
    const parsed = Number(runPayload.tokenBudget);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return "tokenBudget must be a positive number.";
    }
  }
  if (runPayload.scoreMode !== undefined && runPayload.scoreMode !== null) {
    // Runtime payloads may carry dirty strings; isScoreMode is the boundary.
    if (!isScoreMode(runPayload.scoreMode as unknown)) {
      return `scoreMode must be one of: ${SCORE_MODES.join(", ")}.`;
    }
  }
  return null;
}


export interface RunPayloadPathOptions {
  cwd?: string;
  taskRoots?: string[];
}

/** Resolve existing path components so directory links cannot escape local UI roots. */
export async function validateRunPayloadPaths(
  runPayload: UiRunPayload,
  options: RunPayloadPathOptions = {}
): Promise<string | null> {
  const cwd = options.cwd ?? process.cwd();
  const taskRoots = options.taskRoots?.length ? options.taskRoots : [cwd];
  if (typeof runPayload.repoPath !== "string" || !runPayload.repoPath) {
    return "repoPath is required and must be a string.";
  }
  if (typeof runPayload.taskPath !== "string" || !runPayload.taskPath) {
    return "taskPath is required and must be a string.";
  }
  const resolvedPayload = resolveRunPayloadPaths(runPayload, cwd);

  if (!(await isPathInsideWorkspace(cwd, resolvedPayload.repoPath))) {
    return "repoPath resolves outside the current working directory through a symbolic link.";
  }

  let taskPathAllowed = false;
  for (const taskRoot of taskRoots) {
    if (await isPathInsideWorkspace(taskRoot, resolvedPayload.taskPath)) {
      taskPathAllowed = true;
      break;
    }
  }
  if (!taskPathAllowed) {
    return "taskPath resolves outside every allowed task directory.";
  }

  if (
    resolvedPayload.outputPath !== undefined &&
    !(await isPathInsideWorkspace(cwd, resolvedPayload.outputPath))
  ) {
    return "outputPath resolves outside the current working directory through a symbolic link.";
  }

  return null;
}
