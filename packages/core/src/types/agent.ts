import type { TraceEvent } from "./benchmark.js";
import type { TaskPack } from "./task-pack.js";

export interface AgentRequestedConfig {
  model?: string;
  reasoningEffort?: string;
  providerProfileId?: string;
}

export interface AgentSelection {
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  config: AgentRequestedConfig;
  configSource?: "ui" | "cli";
}

export type AgentRuntimeSource =
  | "ui"
  | "cli"
  | "env"
  | "codex-config"
  | "cli-default"
  | "event-stream"
  | "profile-config"
  | "official-login"
  | "unknown";

export type AgentRuntimeVerification = "confirmed" | "inferred" | "unknown";
export type AgentVersionSource = "version-command" | "package-file" | "builtin" | "unknown";

export interface AgentResolvedRuntime {
  effectiveModel?: string;
  effectiveReasoningEffort?: string;
  effectiveAgentVersion?: string;
  agentVersionSource?: AgentVersionSource;
  providerProfileId?: string;
  providerProfileName?: string;
  providerKind?: ClaudeProviderProfileKind;
  providerSource?: "official-login" | "profile-config" | "env" | "unknown";
  source: AgentRuntimeSource;
  verification: AgentRuntimeVerification;
  notes?: string[];
}

export type ClaudeProviderProfileKind = "official" | "anthropic-compatible" | "openai-proxy";
export type ClaudeProviderApiFormat = "anthropic-messages" | "openai-chat-via-proxy";
export type ClaudeProviderRiskFlag =
  | "third-party-provider"
  | "compatibility-mode"
  | "user-managed-secret"
  | "baseUrl-redirects-traffic";

export interface ClaudeProviderProfile {
  id: string;
  name: string;
  kind: ClaudeProviderProfileKind;
  homepage?: string;
  baseUrl?: string;
  apiFormat: ClaudeProviderApiFormat;
  primaryModel?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  extraEnv: Record<string, string>;
  writeCommonConfig: boolean;
  notes?: string;
  riskFlags: ClaudeProviderRiskFlag[];
  isBuiltIn?: boolean;
  secretStored?: boolean;
}

export interface AdapterExecutionContext {
  agentId: string;
  selection: AgentSelection;
  repoPath: string;
  workspacePath: string;
  environment: NodeJS.ProcessEnv;
  task: TaskPack;
  signal?: AbortSignal;
  trace: (event: Omit<TraceEvent, "agentId" | "timestamp">) => Promise<void>;
  sandbox?: {
    validate: (targetPath: string, context: string) => Promise<boolean>;
    validateOrThrow: (targetPath: string, context: string) => Promise<void>;
  };
}

export interface AdapterExecutionResult {
  status: "success" | "failed";
  summary: string;
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  changedFilesHint: string[];
  resolvedRuntime?: AgentResolvedRuntime;
  tokenUsageBreakdown?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

export type AdapterPreflightStatus = "ready" | "unverified" | "blocked" | "missing";
export type AdapterSupportTier = "supported" | "experimental" | "blocked";
export type AdapterMetricAvailability = "available" | "estimated" | "unavailable";
export type AdapterTraceRichness = "full" | "partial" | "minimal";

export interface AdapterCapability {
  supportTier: AdapterSupportTier;
  invocationMethod: string;
  authPrerequisites: string[];
  tokenAvailability: AdapterMetricAvailability;
  costAvailability: AdapterMetricAvailability;
  traceRichness: AdapterTraceRichness;
  knownLimitations: string[];
  configurableRuntime?: {
    model: boolean;
    reasoningEffort: boolean;
    providerProfile?: boolean;
  };
}

export interface AdapterPreflightOptions {
  probeAuth?: boolean;
  selection?: AgentSelection;
}

export interface AdapterPreflightResult {
  agentId: string;
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  requestedConfig: AgentRequestedConfig;
  resolvedRuntime?: AgentResolvedRuntime;
  agentTitle: string;
  adapterKind: "demo" | "external";
  status: AdapterPreflightStatus;
  summary: string;
  capability: AdapterCapability;
  command?: string;
  details?: string[];
}

export interface AgentAdapter {
  id: string;
  title: string;
  kind: "demo" | "external";
  capability: AdapterCapability;
  preflight(options?: AdapterPreflightOptions): Promise<AdapterPreflightResult>;
  execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;
}
