import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AgentRequestedConfig, AgentSelection, RepoSourceResolution } from "./types.js";

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function resolveTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
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

const BUILTIN_PREFIX = "builtin://";

export function resolveRepoSource(
  repoSource: string | undefined,
  userRepoPath: string,
  builtinReposRoot: string
): RepoSourceResolution {
  if (!repoSource || repoSource === "user") {
    return { kind: "user", repoPath: userRepoPath };
  }

  if (repoSource.startsWith(BUILTIN_PREFIX)) {
    const name = repoSource.slice(BUILTIN_PREFIX.length).trim();
    if (!name || /[/\\]/.test(name) || name === ".." || name === ".") {
      throw new Error(
        `Invalid builtin repo name in repoSource: "${repoSource}". ` +
        `Expected format: "builtin://repo-name".`
      );
    }
    return { kind: "builtin", repoPath: path.join(builtinReposRoot, name) };
  }

  throw new Error(
    `Unsupported repoSource: "${repoSource}". ` +
    `Supported values: "user", "builtin://repo-name".`
  );
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
