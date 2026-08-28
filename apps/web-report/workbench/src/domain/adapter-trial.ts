import { type CopyKey, copy } from "../i18n.ts";
import type {
  AdapterInfo,
  AdapterTrialStatus,
  AgentDetectionResult,
  Locale,
  RuntimeReadinessProjection
} from "../types.ts";

export interface AdapterTrialProjection {
  adapter: AdapterInfo;
  detection?: AgentDetectionResult;
  readiness?: RuntimeReadinessProjection;
  status: AdapterTrialStatus;
  supportTier: "supported" | "experimental" | "blocked" | "unknown";
  reason?: string;
}

function supportTier(adapter: AdapterInfo): AdapterTrialProjection["supportTier"] {
  const value = adapter.capability?.supportTier;
  return value === "supported" || value === "experimental" || value === "blocked" ? value : "unknown";
}

function readinessForAdapter(
  adapterId: string,
  runtimeReadiness: RuntimeReadinessProjection[]
): RuntimeReadinessProjection | undefined {
  const agentKind = adapterId === "codex" ? "codex" : adapterId === "claude-code" ? "claude-code" : undefined;
  return agentKind ? runtimeReadiness.find((entry) => entry.profile.agentKind === agentKind) : undefined;
}

export function deriveAdapterTrialStatus(
  adapter: AdapterInfo,
  detection: AgentDetectionResult | undefined,
  runtimeReadiness: RuntimeReadinessProjection[] = []
): AdapterTrialProjection {
  const tier = supportTier(adapter);
  const readiness = readinessForAdapter(adapter.id, runtimeReadiness);
  if (tier === "blocked") {
    return { adapter, detection, readiness, status: "blocked", supportTier: tier, reason: "The adapter is marked blocked by its capability contract." };
  }
  if (readiness?.readiness === "task-ready" && readiness.receiptMatch === true) {
    return { adapter, detection, readiness, status: "task-ready", supportTier: tier };
  }
  if (readiness?.readiness === "blocked" || readiness?.readiness === "changed") {
    return { adapter, detection, readiness, status: "blocked", supportTier: tier, reason: readiness.failure?.summary ?? "Runtime verification is not current." };
  }
  if (detection?.status && detection.status !== "ready") {
    return { adapter, detection, readiness, status: detection.status, supportTier: tier, reason: detection.detail };
  }
  if (detection && !detection.installed) {
    return { adapter, detection, readiness, status: "missing", supportTier: tier, reason: detection.detail };
  }
  if (detection?.installed) {
    return { adapter, detection, readiness, status: "installed", supportTier: tier, reason: "CLI detected; complete three-stage verification for task use." };
  }
  const fallbackStatus: AdapterTrialStatus = tier === "experimental" ? "experimental" : tier === "supported" ? "supported" : "unverified";
  return { adapter, detection, readiness, status: fallbackStatus, supportTier: tier, reason: "Readiness has not been verified yet." };
}

export function adapterTrialStatusTone(status: AdapterTrialStatus): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "task-ready" || status === "supported") return "success";
  if (status === "installed") return "info";
  if (status === "experimental" || status === "unverified") return "warning";
  if (status === "blocked" || status === "missing") return "danger";
  return "neutral";
}

const statusCopy: Record<AdapterTrialStatus, CopyKey> = {
  supported: "trialSupported",
  experimental: "trialExperimental",
  blocked: "trialBlocked",
  installed: "trialInstalled",
  "task-ready": "trialTaskReady",
  unverified: "trialUnverified",
  missing: "trialMissing"
};

export function adapterTrialStatusLabel(locale: Locale, status: AdapterTrialStatus): string {
  return copy[locale][statusCopy[status]];
}
