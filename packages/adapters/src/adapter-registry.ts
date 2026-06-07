import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AdapterPreflightOptions,
  AdapterPreflightResult,
  AgentAdapter,
  AgentResolvedRuntime
} from "@agentarena/core";
import { demoProfiles } from "./adapter-capabilities.js";
import { adapterWarn } from "./adapter-diagnostics.js";
import { createAiderAdapter } from "./aider-adapter.js";
import { createAugmentAdapter } from "./augment-adapter.js";
import { ClaudeCodeAdapter } from "./claude-adapter.js";
import { CodexCliAdapter } from "./codex-adapter.js";
import { createCopilotAdapter } from "./copilot-adapter.js";
import { CursorAdapter } from "./cursor-adapter.js";
import { DemoAdapter } from "./demo-adapter.js";
import { createGeminiAdapter } from "./gemini-adapter.js";
import { getInstallGuide, type InstallGuide } from "./install-guides.js";
import { createKiloAdapter } from "./kilo-adapter.js";
import { createOpencodeAdapter } from "./opencode-adapter.js";
import { loadAdapterPlugins, registerExternalAdapters } from "./plugin-registry.js";
import { QwenCodeAdapter } from "./qwen-adapter.js";
import { resolveCodexRuntime } from "./runtime-resolution.js";
import { createTraeAdapter } from "./trae-adapter.js";
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
  registerAdapter(createGeminiAdapter()),
  registerAdapter(createAiderAdapter()),
  registerAdapter(createCopilotAdapter()),
  registerAdapter(createKiloAdapter()),
  registerAdapter(createOpencodeAdapter()),
  registerAdapter(new QwenCodeAdapter()),
  registerAdapter(createTraeAdapter()),
  registerAdapter(createAugmentAdapter()),
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

const PREFLIGHT_TIMEOUT_MS = 120_000;

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
              () => reject(new Error(`Preflight for "${selection.baseAgentId}" timed out after ${PREFLIGHT_TIMEOUT_MS}ms. The agent CLI may not be installed, or it is hanging. Try running "${selection.displayLabel || selection.baseAgentId}" manually in your terminal to check.`)),
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

// ─── Agent Detection (EchoBird-inspired) ───

export interface AgentDetectionResult {
  /** Adapter ID */
  id: string;
  /** Display name */
  displayName: string;
  /** Whether the CLI binary was found and responds to --version */
  installed: boolean;
  /** Detected version string, or empty if not installed */
  version: string;
  /** Whether any expected config file exists */
  configExists: boolean;
  /** Paths of config files that were found */
  configFilesFound: string[];
  /** Paths of config files that were expected but missing */
  configFilesMissing: string[];
  /** Install guide for this agent (if available) */
  installGuide?: InstallGuide;
  /** Diagnostic message (e.g. "not found", "version mismatch") */
  detail?: string;
}

/**
 * Check if any of the given config file paths (relative to HOME) exist.
 */
async function checkConfigFiles(relativePaths: string[]): Promise<{ found: string[]; missing: string[] }> {
  const home = os.homedir();
  const found: string[] = [];
  const missing: string[] = [];
  for (const relPath of relativePaths) {
    const absPath = path.join(home, relPath);
    try {
      await fs.access(absPath);
      found.push(relPath);
    } catch {
      missing.push(relPath); /* intentional: file may not exist */
    }
  }
  return { found, missing };
}

/**
 * Try running `<binary> --version` and parse a semver-like token from stdout.
 * Returns the version string or undefined if the command fails or produces no version.
 */
async function probeVersion(binaryName: string, versionArgs: string[], timeoutMs = 10_000): Promise<string | undefined> {
  const { runProcess } = await import("./process-utils.js");
  const cmd = process.platform === "win32" && !binaryName.endsWith(".cmd") && !binaryName.endsWith(".bat") && !binaryName.endsWith(".exe")
    ? `${binaryName}.cmd`
    : binaryName;

  try {
    const result = await runProcess(cmd, versionArgs, process.cwd(), timeoutMs);
    if (result.exitCode !== 0 || result.error) {
      return undefined;
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    // Extract semver-like token: 1.2.3 or 1.2 or 1.2.3-beta.1
    const semverMatch = output.match(/\b(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/);
    if (semverMatch) return semverMatch[1];
    const looseMatch = output.match(/\b(\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/);
    return looseMatch?.[1];
  } catch {
    return undefined; /* intentional: CLI not found */
  }
}

/**
 * Detect all registered agents using install guide data.
 *
 * Detection logic (per adapter):
 *   1. If no install guide exists → skip (demo adapters, etc.)
 *   2. Try running `<binary> --version` for each declared binary name
 *   3. If version is obtained → binary is installed
 *   4. If config files are declared → check if any exist
 *   5. installed = version found AND (no configFiles declared OR at least one config exists)
 *
 * This fixes the Augment Code false positive: the old preflight only ran
 * `--help` which can succeed for similarly-named binaries. Now we require
 * `--version` to produce a valid version AND check that config files exist.
 */
export async function detectInstalledAgents(): Promise<AgentDetectionResult[]> {
  const results: AgentDetectionResult[] = [];

  for (const adapter of adapters.values()) {
    // Skip demo adapters — they are always "available"
    if (adapter.kind === "demo") continue;

    const guide = getInstallGuide(adapter.id);
    if (!guide) {
      // No install guide → report as unknown
      results.push({
        id: adapter.id,
        displayName: adapter.title,
        installed: false,
        version: "",
        configExists: false,
        configFilesFound: [],
        configFilesMissing: [],
        detail: "No install guide configured for this adapter.",
      });
      continue;
    }

    // Step 1: Try --version for each declared binary name
    let version: string | undefined;
    const versionArgs = guide.detection.versionCommand ?? ["--version"];
    for (const binaryName of guide.detection.binaryNames) {
      version = await probeVersion(binaryName, versionArgs);
      if (version) break; // First successful binary wins
    }

    // Step 2: Check config files (if declared)
    const configCheck = guide.detection.configFiles?.length
      ? await checkConfigFiles(guide.detection.configFiles)
      : { found: [], missing: [] };

    // Step 3: Determine installed status
    // installed = version found AND (no config required OR at least one config exists)
    const configRequired = (guide.detection.configFiles?.length ?? 0) > 0;
    const installed = !!version && (!configRequired || configCheck.found.length > 0);

    let detail: string | undefined;
    if (!version) {
      detail = `CLI binary not found. Tried: ${guide.detection.binaryNames.join(", ")}`;
    } else if (configRequired && configCheck.found.length === 0) {
      detail = `CLI found (v${version}) but no config files detected. Expected one of: ${guide.detection.configFiles?.join(", ")}`;
    }

    results.push({
      id: adapter.id,
      displayName: guide.displayName,
      installed,
      version: version ?? "",
      configExists: configCheck.found.length > 0,
      configFilesFound: configCheck.found,
      configFilesMissing: configCheck.missing,
      installGuide: guide,
      detail,
    });
  }

  return results;
}
