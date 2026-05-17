import type {
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { demoProfiles } from "./adapter-capabilities.js";
import { adapterWarn } from "./adapter-diagnostics.js";
import { createAiderAdapter } from "./aider-adapter.js";
import { AugmentAdapter } from "./augment-adapter.js";
import { ClaudeCodeAdapter } from "./claude-adapter.js";
import { CodexCliAdapter } from "./codex-adapter.js";
import { createCopilotAdapter } from "./copilot-adapter.js";
import { CursorAdapter } from "./cursor-adapter.js";
import { DemoAdapter } from "./demo-adapter.js";
import { GeminiCliAdapter } from "./gemini-adapter.js";
import { createKiloAdapter } from "./kilo-adapter.js";
import { createOpencodeAdapter } from "./opencode-adapter.js";
import { loadAdapterPlugins, registerExternalAdapters } from "./plugin-registry.js";
import { QwenCodeAdapter } from "./qwen-adapter.js";
import { resolveCodexRuntime } from "./runtime-resolution.js";
import { TraeAdapter } from "./trae-adapter.js";
import { WindsurfAdapter } from "./windsurf-adapter.js";

function registerAdapter(adapter: AgentAdapter): [string, AgentAdapter] {
  return [adapter.id, adapter];
}

const adapterEntries: Array<[string, AgentAdapter]> = [
  ...Object.entries(demoProfiles).map(
    ([id, profile]) => registerAdapter(new DemoAdapter(id, profile.title, profile))
  ),
  registerAdapter(new CodexCliAdapter()),
  registerAdapter(new ClaudeCodeAdapter()),
  registerAdapter(new CursorAdapter()),
  registerAdapter(new GeminiCliAdapter()),
  registerAdapter(createAiderAdapter()),
  registerAdapter(createCopilotAdapter()),
  registerAdapter(createKiloAdapter()),
  registerAdapter(createOpencodeAdapter()),
  registerAdapter(new QwenCodeAdapter()),
  registerAdapter(new TraeAdapter()),
  registerAdapter(new AugmentAdapter()),
  registerAdapter(new WindsurfAdapter())
];

const adapters = new Map<string, AgentAdapter>(adapterEntries);

const duplicateIds = adapterEntries
  .map(([id]) => id)
  .filter((id, index, arr) => arr.indexOf(id) !== index);
if (duplicateIds.length > 0) {
  throw new Error(`Duplicate adapter IDs detected: ${duplicateIds.join(", ")}. Each adapter must have a unique ID.`);
}

export function listAvailableAdapters(): AgentAdapter[] {
  return Array.from(adapters.values());
}

export function getAdapter(agentId: string): AgentAdapter {
  const adapter = adapters.get(agentId);

  if (!adapter) {
    throw new Error(
      `Unknown adapter "${agentId}". Available adapters: ${listAvailableAdapters()
        .map((value) => value.id)
        .join(", ")}`
    );
  }

  return adapter;
}

const PREFLIGHT_TIMEOUT_MS = 30_000;

export async function preflightAdapters(
  selections: AdapterPreflightOptions["selection"][],
  options?: AdapterPreflightOptions
): Promise<AdapterPreflightResult[]> {
  return await Promise.all(
    selections.map(async (selection) => {
      if (!selection) {
        throw new Error("Missing agent selection.");
      }

      const adapter = getAdapter(selection.baseAgentId);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          adapter.preflight({
            ...options,
            selection
          }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error(`Preflight for "${selection.baseAgentId}" timed out after ${PREFLIGHT_TIMEOUT_MS}ms.`)),
              PREFLIGHT_TIMEOUT_MS
            );
          })
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    })
  );
}

export async function getCodexDefaultResolvedRuntime(): Promise<AgentResolvedRuntime> {
  return await resolveCodexRuntime({});
}

/**
 * Load and register external adapter plugins from file paths.
 * Each plugin file must export a `createAdapter()` function.
 *
 * @param pluginPaths - Array of absolute paths to plugin files
 */
export async function loadAndRegisterPlugins(pluginPaths: string[]): Promise<void> {
  const { adapters: externalAdapters, diagnostics } = await loadAdapterPlugins(pluginPaths);
  for (const diagnostic of diagnostics) {
    adapterWarn(`Adapter plugin "${diagnostic.pluginPath}" was ${diagnostic.level}: ${diagnostic.message}`);
  }
  registerExternalAdapters(externalAdapters, adapters);
}
