import type {
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
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
import { QwenCodeAdapter } from "./qwen-adapter.js";
import { demoProfiles, resolveCodexRuntime } from "./shared.js";
import { TraeAdapter } from "./trae-adapter.js";
import { WindsurfAdapter } from "./windsurf-adapter.js";

const adapterEntries: Array<[string, AgentAdapter]> = [
  ...Object.entries(demoProfiles).map(
    ([id, profile]) => [id, new DemoAdapter(id, profile.title, profile)] as [string, AgentAdapter]
  ),
  ["codex", new CodexCliAdapter()],
  ["claude-code", new ClaudeCodeAdapter()],
  ["cursor", new CursorAdapter()],
  ["gemini-cli", new GeminiCliAdapter()],
  ["aider", createAiderAdapter()],
  ["copilot", createCopilotAdapter()],
  ["kilo-cli", createKiloAdapter()],
  ["opencode", createOpencodeAdapter()],
  ["qwen-code", new QwenCodeAdapter()],
  ["trae", new TraeAdapter()],
  ["augment", new AugmentAdapter()],
  ["windsurf", new WindsurfAdapter()]
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

/** Safe variant that returns undefined instead of throwing for unknown agent IDs. */
export function tryGetAdapter(agentId: string): AgentAdapter | undefined {
  return adapters.get(agentId);
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
      const result = await Promise.race([
        adapter.preflight({
          ...options,
          selection
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Preflight for "${selection.baseAgentId}" timed out after ${PREFLIGHT_TIMEOUT_MS}ms.`)), PREFLIGHT_TIMEOUT_MS)
        )
      ]);
      return result;
    })
  );
}

export async function getCodexDefaultResolvedRuntime(): Promise<AgentResolvedRuntime> {
  return await resolveCodexRuntime({});
}
