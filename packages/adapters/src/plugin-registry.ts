/**
 * Plugin registry for external adapters.
 *
 * Allows loading adapter plugins from external files without modifying
 * the core adapter-registry.ts. Each plugin is a JS/TS file that exports
 * a `createAdapter()` function returning an AgentAdapter instance.
 */

import type { AgentAdapter } from "@agentarena/core";

export interface AdapterPlugin {
  createAdapter(): AgentAdapter;
}

export interface AdapterPluginDiagnostic {
  pluginPath: string;
  level: "warning" | "error";
  message: string;
}

export interface AdapterPluginLoadResult {
  adapters: AgentAdapter[];
  diagnostics: AdapterPluginDiagnostic[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Load adapter plugins from the specified file paths.
 * Each file must export a `createAdapter` function.
 *
 * @param pluginPaths - Array of absolute paths to plugin files
 * @returns Loaded adapters plus diagnostics for skipped or failed plugins
 */
export async function loadAdapterPlugins(pluginPaths: string[]): Promise<AdapterPluginLoadResult> {
  const adapters: AgentAdapter[] = [];
  const diagnostics: AdapterPluginDiagnostic[] = [];

  for (const pluginPath of pluginPaths) {
    try {
      const plugin = (await import(pluginPath)) as AdapterPlugin;

      if (typeof plugin.createAdapter !== "function") {
        diagnostics.push({
          pluginPath,
          level: "warning",
          message: "Plugin does not export a createAdapter() function."
        });
        continue;
      }

      const adapter = plugin.createAdapter();

      if (!adapter || typeof adapter !== "object" || !adapter.id) {
        diagnostics.push({
          pluginPath,
          level: "warning",
          message: "Plugin createAdapter() returned an invalid adapter object."
        });
        continue;
      }

      adapters.push(adapter);
    } catch (error) {
      diagnostics.push({
        pluginPath,
        level: "error",
        message: `Failed to load plugin: ${errorMessage(error)}`
      });
    }
  }

  return { adapters, diagnostics };
}

/**
 * Register external adapters with the main registry.
 * Throws if any external adapter ID conflicts with an existing one.
 *
 * @param externalAdapters - Array of adapters to register
 * @param existingAdapters - Map of currently registered adapters
 */
export function registerExternalAdapters(
  externalAdapters: AgentAdapter[],
  existingAdapters: Map<string, AgentAdapter>
): void {
  for (const adapter of externalAdapters) {
    if (existingAdapters.has(adapter.id)) {
      throw new Error(
        `Cannot register external adapter "${adapter.id}": an adapter with this ID already exists. ` +
        `External adapter IDs must be unique.`
      );
    }
    existingAdapters.set(adapter.id, adapter);
  }
}
