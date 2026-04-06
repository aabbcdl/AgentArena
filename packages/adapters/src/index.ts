export { getAdapter, getCodexDefaultResolvedRuntime, listAvailableAdapters, preflightAdapters } from "./adapter-registry.js";
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

import { parseClaudeEvents, parseCodexEvents, parseGeminiEvents } from "./event-parsers.js";
import { readCodexConfigDefaults, resolveClaudeRuntime, resolveCodexRuntime } from "./shared.js";

export const __testUtils = {
  parseCodexEvents,
  parseClaudeEvents,
  parseGeminiEvents,
  resolveCodexRuntime,
  readCodexConfigDefaults,
  resolveClaudeRuntime
};
