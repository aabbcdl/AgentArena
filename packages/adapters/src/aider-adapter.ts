import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AdapterCapability,
  AdapterExecutionContext,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { adapterWarn } from "./adapter-diagnostics.js";
import { createCliAdapter } from "./base-cli-adapter.js";
import { runProcess } from "./process-utils.js";

export const AIDER_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Aider CLI --yes mode",
  authPrerequisites: ["Aider installed and configured with an LLM provider API key."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false
  },
  knownLimitations: [
    "Aider does not report token usage or cost natively.",
    "Changed files are inferred from workspace diff, not emitted directly by the adapter.",
    "Aider relies on git for change tracking; non-git workspaces may have incomplete results."
  ]
};

async function ensureGitRepo(context: AdapterExecutionContext): Promise<void> {
  const gitDir = path.join(context.workspacePath, ".git");
  try {
    const stat = await fs.stat(gitDir);
    if (!stat.isDirectory()) {
      throw new Error(".git exists but is not a directory");
    }
  } catch {
    const gitResult = await runProcess("git", ["init"], context.workspacePath, 30_000, context.environment);
    if (gitResult.exitCode !== 0) {
      adapterWarn("Could not initialize git in workspace. Aider may not work correctly", { stderr: gitResult.stderr });
    }
  }
}

export function createAiderAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "aider",
    title: "Aider",
    command: "aider",
    commandArgs: ["--yes", "--no-auto-commits", "--message"],
    capability: AIDER_CAPABILITY,
    binEnvVar: "AGENTARENA_AIDER_BIN",
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : [],
    beforeExecute: ensureGitRepo
  });
}
