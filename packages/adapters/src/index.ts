export type { AdapterEvent, AdapterEventType, ParsedAdapterOutput } from "./adapter-events.js";
export { emitEvent, parseAdapterEvents } from "./adapter-events.js";
export type { AgentDetectionResult } from "./adapter-registry.js";
export { detectInstalledAgents, getAdapter, getCodexDefaultResolvedRuntime, listAvailableAdapters, loadAndRegisterPlugins, preflightAdapters } from "./adapter-registry.js";
export type { ClaudeProviderProfileInput } from "./claude-provider-profiles.js";
export {
  __providerProfileTestUtils,
  buildClaudeProviderEnvironment,
  deleteClaudeProviderProfile,
  getClaudeProviderProfile,
  getClaudeProviderProfileSecret,
  listClaudeProviderProfiles,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret,
  supportsWindowsCredentialManager,
  writeClaudeWorkspaceSettings
} from "./claude-provider-profiles.js";
export type { InstallGuide } from "./install-guides.js";
export { getInstallGuide, INSTALL_GUIDES, listInstallGuides } from "./install-guides.js";
export { probeAuthConfig, probeClaudeLikeAuthFast, probeCliExists, probeQuickPreflight } from "./invocation-probes.js";
export { loadAdapterPlugins, registerExternalAdapters } from "./plugin-registry.js";
export type { Transport, TransportChainOptions, TransportChainResult, TransportResult } from "./transport.js";
export { createClaudeTransportChain, RawTransport, StreamJsonTransport, TextTransport, TransportChain } from "./transport.js";

import { getChangedFilesFromGit } from "./adapter-helpers.js";
import { resolveCodexSandboxMode } from "./codex-adapter.js";
import { parseClaudeEvents, parseCodexEvents, parseGeminiEvents } from "./event-parsers.js";
import { agentTimeoutMs, formatTimeoutMessage, runProcess, terminateProcessTree } from "./process-utils.js";
import { readCodexConfigDefaults, resolveClaudeRuntime, resolveCodexRuntime } from "./runtime-resolution.js";

export const __testUtils = {
  parseCodexEvents,
  parseClaudeEvents,
  parseGeminiEvents,
  resolveCodexRuntime,
  resolveCodexSandboxMode,
  readCodexConfigDefaults,
  resolveClaudeRuntime,
  runProcessForTest: runProcess,
  terminateProcessTree,
  agentTimeoutMs,
  formatTimeoutMessage,
  getChangedFilesFromGit
};
