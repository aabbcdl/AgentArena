import type {
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime
} from "@repoarena/core";
import { AiderAdapter } from "./aider-adapter.js";
import { ClaudeCodeAdapter } from "./claude-adapter.js";
import { CodexCliAdapter } from "./codex-adapter.js";
import { CopilotAdapter } from "./copilot-adapter.js";
import { CursorAdapter } from "./cursor-adapter.js";
import { DemoAdapter } from "./demo-adapter.js";
import { GeminiCliAdapter } from "./gemini-adapter.js";
import { KiloCliAdapter } from "./kilo-adapter.js";
import { OpencodeAdapter } from "./opencode-adapter.js";
import { QwenCodeAdapter } from "./qwen-adapter.js";
import { WindsurfAdapter } from "./windsurf-adapter.js";
import { demoProfiles, resolveCodexRuntime } from "./shared.js";

const adapterEntries: Array<[string, AgentAdapter]> = [
  ...Object.entries(demoProfiles).map(
    ([id, profile]) => [id, new DemoAdapter(id, profile.title, profile)] as [string, AgentAdapter]
  ),
  ["codex", new CodexCliAdapter()],
  ["claude-code", new ClaudeCodeAdapter()],
  ["cursor", new CursorAdapter()],
  ["gemini-cli", new GeminiCliAdapter()],
  ["aider", new AiderAdapter()],
  ["copilot", new CopilotAdapter()],
  ["kilo-cli", new KiloCliAdapter()],
  ["opencode", new OpencodeAdapter()],
  ["qwen-code", new QwenCodeAdapter()],
  ["windsurf", new WindsurfAdapter()]
];

const adapters = new Map<string, AgentAdapter>(adapterEntries);

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
      return await adapter.preflight({
        ...options,
        selection
      });
    })
  );
}

export async function getCodexDefaultResolvedRuntime(): Promise<AgentResolvedRuntime> {
  return await resolveCodexRuntime({});
}
