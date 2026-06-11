/**
 * Adapter-related route handlers: listing adapters, agent detection, install guides.
 */

import {
  detectInstalledAgents,
  listAvailableAdapters,
  listInstallGuides,
} from "@agentarena/adapters";
import { logger } from "@agentarena/core";
import { jsonResponse } from "../../server/index.js";
import type { ApiResponse } from "./types.js";

export async function handleAdaptersList(): Promise<ApiResponse> {
  const adapters = listAvailableAdapters().map((adapter) => ({
    id: adapter.id,
    title: adapter.title,
    kind: adapter.kind,
    capability: adapter.capability
  }));
  return jsonResponse(adapters);
}

/**
 * GET /api/agent-detection
 *
 * Returns detection results for all registered adapters: whether each CLI
 * is installed, its version, config file status, and install instructions.
 * Uses the EchoBird-inspired `detectInstalledAgents()` function.
 */
export async function handleAgentDetection(): Promise<ApiResponse> {
  try {
    const results = await detectInstalledAgents();
    return jsonResponse(results);
  } catch (error) {
    logger.error("server", "agent_detection.error", "Agent detection failed", { error });
    return jsonResponse({ error: "Agent detection failed." }, 500);
  }
}

/**
 * GET /api/install-guides
 *
 * Returns all install guide definitions so the frontend can render
 * install instructions for uninstalled agents without additional requests.
 */
export async function handleInstallGuides(): Promise<ApiResponse> {
  return jsonResponse(listInstallGuides());
}
