/**
 * UI info and preflight route handlers.
 */

import path from "node:path";
import {
  listClaudeProviderProfiles,
  preflightAdapters,
  probeAuthConfig,
} from "@agentarena/adapters";
import {
  createAgentSelection,
  logger,
  metrics,
} from "@agentarena/core";
import { jsonResponse } from "../../server/index.js";
import { OFFICIAL_TASKPACK_ROOT } from "../shared.js";
import type { ApiResponse } from "./types.js";

export async function handleUiInfo(codexDefaults: unknown, host: string, port: number, isLocalhost: boolean): Promise<ApiResponse> {
  const providerProfiles = await listClaudeProviderProfiles();
  return jsonResponse({
    mode: "local-service",
    repoPath: process.cwd(),
    defaultTaskPath: path.join(OFFICIAL_TASKPACK_ROOT, "repo-health.yaml"),
    defaultOutputPath: path.join(process.cwd(), ".agentarena", "ui-runs"),
    codexDefaults,
    claudeProviderProfiles: providerProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      kind: profile.kind,
      apiFormat: profile.apiFormat,
      primaryModel: profile.primaryModel,
      secretStored: profile.secretStored,
      isBuiltIn: profile.isBuiltIn
    })),
    riskNotice: providerProfiles.some((p) => p.kind !== "official")
      ? "Provider-switched Claude Code variants use compatibility settings and may behave differently from official Claude Code."
      : null,
    host,
    port,
    authRequired: !isLocalhost
  });
}

export async function handlePreflight(rawBody: string): Promise<ApiResponse> {
  let body: { baseAgentId?: string; displayLabel?: string; config?: { model?: string; reasoningEffort?: string; providerProfileId?: string } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, 400);
  }
  if (!body.baseAgentId) {
    return jsonResponse({ error: "Missing baseAgentId." }, 400);
  }
  try {
    const selection = createAgentSelection({
      baseAgentId: body.baseAgentId,
      displayLabel: body.displayLabel,
      config: body.config,
      configSource: "ui"
    });
    const results = await preflightAdapters([selection], { probeAuth: true });
    const result = results[0];

    metrics.preflightTotal.inc({ status: result.status, agentId: body.baseAgentId });
    logger.info("server", "preflight.check", `Preflight check completed for ${body.baseAgentId}`, {
      metadata: { status: result.status, agentId: body.baseAgentId }
    });

    return jsonResponse(result);
  } catch (err: unknown) {
    metrics.preflightTotal.inc({ status: "error", agentId: body.baseAgentId });
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("server", "preflight.error", "Preflight check failed", {
      metadata: { agentId: body.baseAgentId },
      error: err
    });
    return jsonResponse({ status: "error", error: errorMessage }, 500);
  }
}

/**
 * Quick preflight -- fast CLI + auth config check without network calls.
 * Returns in ~2 seconds instead of ~60 seconds.
 */
export async function handleQuickPreflight(rawBody: string): Promise<ApiResponse> {
  let body: { baseAgentId?: string; displayLabel?: string; config?: { model?: string; reasoningEffort?: string; providerProfileId?: string } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, 400);
  }
  if (!body.baseAgentId) {
    return jsonResponse({ error: "Missing baseAgentId." }, 400);
  }
  try {
    const selection = createAgentSelection({
      baseAgentId: body.baseAgentId,
      displayLabel: body.displayLabel,
      config: body.config,
      configSource: "ui"
    });
    const [preflight] = await preflightAdapters([selection], { probeAuth: false });
    const command = preflight?.command ?? body.baseAgentId;
    const authResult = await probeAuthConfig({
      command,
      argsPrefix: [],
      displayCommand: command
    });

    let overallStatus: "ready" | "warning" | "blocked" = "ready";
    if (!preflight || preflight.status === "missing") {
      overallStatus = "blocked";
    } else if (!authResult.configured) {
      overallStatus = "warning";
    }

    const result = {
      cliExists: !!preflight && preflight.status !== "missing",
      cliVersion: preflight?.resolvedRuntime?.effectiveAgentVersion,
      authConfigured: authResult.configured,
      authHint: authResult.hint,
      overallStatus,
      command,
      summary: preflight?.summary
    };

    logger.info("server", "quick-preflight.check", `Quick preflight for ${body.baseAgentId}`, {
      metadata: { ...result, agentId: body.baseAgentId }
    });
    return jsonResponse(result);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("server", "quick-preflight.error", "Quick preflight failed", {
      metadata: { agentId: body.baseAgentId },
      error: err
    });
    return jsonResponse({ error: errorMessage }, 500);
  }
}
