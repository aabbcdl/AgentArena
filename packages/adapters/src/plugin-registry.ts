/**
 * Plugin registry for external adapters.
 *
 * Allows loading adapter plugins from external files without modifying
 * the core adapter-registry.ts. Each plugin is a JS/TS file that exports
 * a `createAdapter()` function returning an AgentAdapter instance.
 *
 * SECURITY CONTRACT:
 * - Plugin paths MUST be absolute. Relative paths are rejected to prevent
 *   path-traversal attacks (e.g. `../../etc/passwd` or `./malicious.js`).
 * - Paths containing `..` segments are rejected.
 * - Paths under `node_modules` are rejected to prevent accidental or
 *   malicious loading of arbitrary npm packages.
 * - Only `file://` or plain filesystem paths are accepted; `http://`,
 *   `https://`, and other schemes are rejected.
 */

import type { AgentAdapter } from "@agentarena/core";
import { logger } from "@agentarena/core";

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

function isAbsoluteFilePath(pluginPath: string): boolean {
  if (pluginPath.startsWith("file://")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(pluginPath)) return true;
  if (pluginPath.startsWith("/")) return true;
  return false;
}

function containsTraversalSegment(pluginPath: string): boolean {
  const normalized = pluginPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments.some((s) => s === "..");
}

function isUnderNodeModules(pluginPath: string): boolean {
  const normalized = pluginPath.replace(/\\/g, "/");
  return /\/node_modules[/\\]/.test(normalized) || normalized.includes("/node_modules");
}

function hasBlockedScheme(pluginPath: string): boolean {
  const colonIndex = pluginPath.indexOf(":");
  if (colonIndex <= 0) return false;
  const scheme = pluginPath.slice(0, colonIndex).toLowerCase();
  return scheme !== "file" && /^[a-z][a-z0-9+\-.]*$/.test(scheme);
}

function validatePluginPath(pluginPath: string): string | null {
  if (!isAbsoluteFilePath(pluginPath)) {
    return `Plugin path must be absolute: "${pluginPath}". Relative paths are not allowed for security reasons.`;
  }
  if (containsTraversalSegment(pluginPath)) {
    return `Plugin path contains ".." traversal segment: "${pluginPath}". This is not allowed for security reasons.`;
  }
  if (isUnderNodeModules(pluginPath)) {
    return `Plugin path is under node_modules: "${pluginPath}". Direct node_modules imports are not allowed — use a package path outside node_modules instead.`;
  }
  if (hasBlockedScheme(pluginPath)) {
    return `Plugin path uses a blocked scheme (only file:// is allowed): "${pluginPath}".`;
  }
  return null;
}

/**
 * Load adapter plugins from the specified file paths.
 * Each file must export a `createAdapter` function.
 *
 * SECURITY: Only absolute filesystem paths are accepted. Relative paths,
 * paths with ".." traversal, paths under node_modules, and non-file://
 * URLs are rejected. See module-level SECURITY CONTRACT for details.
 *
 * @param pluginPaths - Array of absolute paths to plugin files
 * @returns Loaded adapters plus diagnostics for skipped or failed plugins
 */
export async function loadAdapterPlugins(pluginPaths: string[]): Promise<AdapterPluginLoadResult> {
  const adapters: AgentAdapter[] = [];
  const diagnostics: AdapterPluginDiagnostic[] = [];

  for (const pluginPath of pluginPaths) {
    const validationError = validatePluginPath(pluginPath);
    if (validationError) {
      diagnostics.push({
        pluginPath,
        level: "error",
        message: validationError
      });
      logger.warn("adapter", "plugin.path_rejected", `Plugin path rejected: ${validationError}`);
      continue;
    }

    logger.info("adapter", "plugin.loading", `Loading adapter plugin: ${pluginPath}`);

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
