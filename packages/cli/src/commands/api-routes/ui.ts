/**
 * UI info and preflight route handlers.
 */

import path from "node:path";
import {
  listClaudeProviderProfiles,
  listPublicRuntimeProfiles,
  preflightAdapters,
  probeAuthConfig,
} from "@agentarena/adapters";
import {
  createAgentSelection,
  isTelemetryEnabled,
  logger,
  metrics,
  readTelemetrySummary,
  recordTelemetryEvent,
  type TelemetryEventName,
} from "@agentarena/core";
import { jsonResponse } from "../../server/index.js";
import { readVersionInfo } from "../../server/version.js";
import { DEMO_TASKPACK_PATH, OFFICIAL_TASKPACK_ROOT } from "../shared.js";
import { type UiAuthMode, type UiAuthTokenSource, uiAuthTokenFilePath } from "../ui-auth.js";
import type { ApiResponse } from "./types.js";

export async function handleUiInfo(
  codexDefaults: unknown,
  host: string,
  port: number,
  isLocalhost: boolean,
  authTokenFilePath?: string,
  authTokenSource: UiAuthTokenSource = "unknown",
  workspaceRoot = process.cwd(),
  authMode: UiAuthMode = "token",
  authSetupRequired = false
): Promise<ApiResponse> {
  const [providerProfiles, runtimeProfiles] = await Promise.all([
    listClaudeProviderProfiles(),
    listPublicRuntimeProfiles()
  ]);
  let versionInfo = null;
  try {
    versionInfo = readVersionInfo();
  } catch (e) {
    logger.warn("server", "version.read_failed", `Failed to read version info: ${e instanceof Error ? e.message : String(e)}`);
  }
  return jsonResponse({
    mode: "local-service",
    repoPath: workspaceRoot,
    workspaceRoot,
    defaultTaskPath: path.join(OFFICIAL_TASKPACK_ROOT, "repo-health.yaml"),
    demoTaskPath: DEMO_TASKPACK_PATH,
    defaultOutputPath: path.join(workspaceRoot, ".agentarena", "ui-runs"),
    codexDefaults,
    runtimeProfiles,
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
    version: versionInfo ?? null,
    host,
    port,
    authRequired: !isLocalhost,
    authTokenFilePath: authTokenFilePath ?? uiAuthTokenFilePath(workspaceRoot, port),
    authTokenSource,
    authMode,
    authSetupRequired,
    telemetryEnabled: isTelemetryEnabled(),
    nodeMajor: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10),
    platform: process.platform
  });
}


export async function handleTelemetrySummary(): Promise<ApiResponse> {
  return jsonResponse(await readTelemetrySummary());
}

const ALLOWED_TELEMETRY_EVENTS = new Set<TelemetryEventName>([
  "app_opened",
  "run_started",
  "run_completed",
  "result_viewed",
  "preflight_completed",
  "evidence_opened",
]);

const LOW_CARDINALITY_TELEMETRY_KEYS = new Set([
  "entryPoint",
  "language",
  "hasRuns",
  "resultIntegrity",
  "sourceKind",
  "agentCount",
  "scoreMode",
  "hasInlineDiff",
  "blocked",
  "selectedCount",
  "taskSource",
  "hasExpectedChangedPaths",
  "compatibilityStatus",
  "readinessStatus",
  "failureReasonCode",
  "outcome",
]);

function lowCardinalityTelemetryProps(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!LOW_CARDINALITY_TELEMETRY_KEYS.has(key)) continue;
    if (typeof raw === "boolean") {
      output[key] = raw;
      continue;
    }
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 100) {
      output[key] = raw;
      continue;
    }
    if (typeof raw === "string" && /^[a-z][a-z0-9-]{0,39}$/iu.test(raw)) {
      output[key] = raw.toLowerCase();
    }
  }
  return output;
}

/**
 * POST /api/telemetry — accepts a UI-emitted product event and appends it to
 * the local telemetry log. A no-op (returns ok) when telemetry is disabled
 * server-side, so the UI never needs to distinguish enabled/disabled beyond
 * reading `telemetryEnabled` from /api/ui-info.
 */
export async function handleTelemetry(rawBody: string): Promise<ApiResponse> {
  let body: { event?: string; props?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, 400);
  }
  const eventName = body.event as string;
  if (!eventName || !ALLOWED_TELEMETRY_EVENTS.has(eventName as TelemetryEventName)) {
    return jsonResponse({ error: `Unknown telemetry event: ${eventName ?? "(missing)"}` }, 400);
  }
  // Always fire-and-forget; recordTelemetryEvent no-ops when disabled.
  void recordTelemetryEvent(eventName as TelemetryEventName, lowCardinalityTelemetryProps(body.props));
  return jsonResponse({ ok: true });
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
    const isThirdPartyClaude =
      body.baseAgentId === "claude-code" &&
      preflight?.resolvedRuntime?.providerKind != null &&
      preflight.resolvedRuntime.providerKind !== "official";
    const thirdPartyReady = preflight?.status === "ready";
    const authResult = isThirdPartyClaude
      ? {
          configured: thirdPartyReady,
          hint: thirdPartyReady
            ? "An isolated Provider secret is stored; network authentication was not probed."
            : preflight?.status === "unverified"
              ? "An isolated Provider secret is stored, but Claude readiness/authentication is unverified."
              : preflight?.summary
        }
      : await probeAuthConfig({
          command,
          argsPrefix: [],
          displayCommand: command
        });

    let overallStatus: "ready" | "warning" | "blocked" = "ready";
    if (!preflight || preflight.status !== "ready") {
      overallStatus = preflight?.status === "unverified" ? "warning" : "blocked";
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
