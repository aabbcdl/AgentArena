import type { AdapterCapability } from "@agentarena/core";

interface DemoProfile {
  title: string;
  delayMs: number;
  tokenBase: number;
  tokenMultiplier: number;
  estimatedCostUsd: number;
  extraFiles: number;
}

interface InvocationSpec {
  command: string;
  argsPrefix: string[];
  displayCommand: string;
}

interface CodexConfigDefaults {
  model?: string;
  reasoningEffort?: string;
}

export type { CodexConfigDefaults, DemoProfile, InvocationSpec };

export const DEMO_CAPABILITY: AdapterCapability = {
  supportTier: "supported",
  invocationMethod: "Built-in AgentArena demo adapter",
  authPrerequisites: [],
  tokenAvailability: "estimated",
  costAvailability: "estimated",
  traceRichness: "partial",
  configurableRuntime: {
    model: false,
    reasoningEffort: false
  },
  knownLimitations: [
    "Does not execute a real coding agent.",
    "Token usage and cost are synthetic."
  ]
};

export const CODEX_CAPABILITY: AdapterCapability = {
  supportTier: "supported",
  invocationMethod: "Codex CLI JSON event stream",
  authPrerequisites: ["Codex CLI installed and authenticated locally."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "full",
  configurableRuntime: {
    model: true,
    reasoningEffort: true
  },
  knownLimitations: [
    "Cost is not reported by the CLI and remains unknown.",
    "Output parsing depends on Codex CLI JSON event compatibility."
  ]
};

export const CLAUDE_CODE_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Claude Code CLI stream-json mode",
  authPrerequisites: ["Claude Code CLI installed and authenticated locally."],
  tokenAvailability: "available",
  costAvailability: "available",
  traceRichness: "partial",
  configurableRuntime: {
    model: true,
    reasoningEffort: false,
    providerProfile: true
  },
  knownLimitations: [
    "Changed files are inferred from workspace diff, not emitted directly by the adapter.",
    "Authentication and CLI flags may vary by local install.",
    "Third-party provider profiles rely on Claude-compatible behavior and may diverge from official results."
  ]
};

export const CURSOR_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Cursor internal claude-agent-sdk CLI bridge",
  authPrerequisites: ["Cursor installed locally.", "Cursor authentication available for agent runs."],
  tokenAvailability: "available",
  costAvailability: "available",
  traceRichness: "partial",
  configurableRuntime: {
    model: false,
    reasoningEffort: false
  },
  knownLimitations: [
    "Uses an internal Cursor CLI bridge that may change across releases.",
    "Portable detection depends on local installation layout."
  ]
};

export const demoProfiles: Record<string, DemoProfile> = {
  "demo-fast": {
    title: "Demo Fast",
    delayMs: 250,
    tokenBase: 110,
    tokenMultiplier: 1.4,
    estimatedCostUsd: 0.08,
    extraFiles: 1
  },
  "demo-thorough": {
    title: "Demo Thorough",
    delayMs: 450,
    tokenBase: 190,
    tokenMultiplier: 1.9,
    estimatedCostUsd: 0.16,
    extraFiles: 2
  },
  "demo-budget": {
    title: "Demo Budget",
    delayMs: 180,
    tokenBase: 80,
    tokenMultiplier: 1.1,
    estimatedCostUsd: 0.05,
    extraFiles: 1
  }
};
