export type { AdapterEvent, AdapterEventType, ParsedAdapterOutput } from "./adapter-events.js";
export { emitEvent, parseAdapterEvents } from "./adapter-events.js";
export type { AgentDetectionResult } from "./adapter-registry.js";
export { detectInstalledAgents, getAdapter, getCodexDefaultResolvedRuntime, listAvailableAdapters, listProductAdapters, loadAndRegisterPlugins, preflightAdapters } from "./adapter-registry.js";
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
export type {
  ClaudeRuntimeMode,
  PrepareClaudeRuntimeEnvironmentOptions,
  PreparedClaudeRuntimeEnvironment
} from "./claude-runtime-environment.js";
export {
  CLAUDE_ISOLATION_ARGS,
  CLAUDE_SAFE_UNATTENDED_ARGS,
  claudeIsolationArgsSupported,
  claudeSafeUnattendedArgsSupported,
  prepareClaudeRuntimeEnvironment
} from "./claude-runtime-environment.js";
export type { CaptureHarnessSnapshotOptions } from "./harness-snapshot.js";
export { captureHarnessSnapshot } from "./harness-snapshot.js";
export type { InstallGuide } from "./install-guides.js";
export { getInstallGuide, INSTALL_GUIDES, listInstallGuides } from "./install-guides.js";
export type {
  DiscoverRuntimeInstallationOptions,
  RuntimeInstallationInvocation,
  RuntimeInstallationProbeResult
} from "./installation-discovery.js";
export { discoverRuntimeInstallation } from "./installation-discovery.js";
export { probeAuthConfig, probeClaudeLikeAuthFast, probeCliExists, probeQuickPreflight } from "./invocation-probes.js";
export type {
  ResolveRuntimeLaunchSpecOptions,
  RuntimeLaunchBindingValues,
  RuntimeSecretResolver
} from "./launch-resolver.js";
export {
  materializeRuntimeLaunchArguments,
  materializeRuntimeLaunchEnvironment,
  resolvedAgentRuntimeFromLaunchSpec,
  resolveRuntimeLaunchSpec
} from "./launch-resolver.js";
export { loadAdapterPlugins, registerExternalAdapters } from "./plugin-registry.js";
export {
  assertClaudeProviderProfileId,
  validateClaudeProviderProfileId
} from "./provider-profile-id.js";
export type {
  ResolvedRuntimeProfileLaunch,
  ResolveRuntimeProfileLaunchOptions
} from "./runtime-control.js";
export { resolveRuntimeProfileLaunch } from "./runtime-control.js";
export type { RuntimeProfileInput } from "./runtime-profile-registry.js";
export {
  __runtimeProfileRegistryTestUtils,
  deleteRuntimeProfile,
  getDefaultRuntimeProfile,
  getRuntimeProfile,
  getRuntimeProfileSecret,
  listPublicRuntimeProfiles,
  listRuntimeProfiles,
  saveRuntimeProfile,
  setRuntimeProfileSecret
} from "./runtime-profile-registry.js";
export type {
  ClassifyRuntimeVerificationFailureOptions,
  VerifyRuntimeLaunchOptions
} from "./runtime-verification.js";
export {
  classifyRuntimeVerificationFailure,
  verifyRuntimeLaunch
} from "./runtime-verification.js";
export type { Transport, TransportChainOptions, TransportChainResult, TransportFallbackThresholds, TransportResult } from "./transport.js";
export { createClaudeTransportChain, DEFAULT_FALLBACK_THRESHOLDS, RawTransport, resolveFallbackThresholds, StreamJsonTransport, TextTransport, TransportChain } from "./transport.js";
export {
  __verificationReceiptTestUtils,
  findLatestVerificationReceipt,
  findMatchingVerificationReceipt,
  findValidVerificationReceipt,
  getVerificationReceipt,
  listVerificationReceipts,
  saveVerificationReceipt
} from "./verification-receipts.js";

import { getChangedFilesFromGit } from "./adapter-helpers.js";
import { resolveClaudeInvocation } from "./claude-adapter.js";
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
  resolveClaudeInvocation,
  resolveClaudeRuntime,
  runProcessForTest: runProcess,
  terminateProcessTree,
  agentTimeoutMs,
  formatTimeoutMessage,
  getChangedFilesFromGit
};
