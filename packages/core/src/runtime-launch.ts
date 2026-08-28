import { createHash } from "node:crypto";
import type { RuntimeAgentKind, RuntimeModelIdentitySource } from "./runtime-profile.js";
import type { AgentRuntimeSource } from "./types/agent.js";

export const INSTALLATION_SCHEMA_V1 = "agentarena.installation/v1" as const;
export const HARNESS_SNAPSHOT_SCHEMA_V1 = "agentarena.harness-snapshot/v1" as const;
export const RESOLVED_LAUNCH_SPEC_SCHEMA_V1 = "agentarena.resolved-launch-spec/v1" as const;
export const VERIFICATION_RECEIPT_SCHEMA_V1 = "agentarena.verification-receipt/v1" as const;
export const JOB_MANIFEST_SCHEMA_V1 = "agentarena.job-manifest/v1" as const;

export type RuntimeReadiness =
  | "not-installed"
  | "installed"
  | "conversation-ready"
  | "task-ready"
  | "blocked"
  | "changed";

export type RuntimeVerificationErrorCategory =
  | "installation-missing"
  | "installation-changed"
  | "profile-invalid"
  | "secret-missing"
  | "authentication-rejected"
  | "provider-unreachable"
  | "provider-overloaded"
  | "quota-exhausted"
  | "model-unavailable"
  | "protocol-mismatch"
  | "harness-startup-failed"
  | "harness-config-drift"
  | "permission-blocked"
  | "background-incompatible"
  | "tooling-startup-failed"
  | "probe-timeout"
  | "task-timeout"
  | "process-crashed"
  | "output-format-changed"
  | "unexpected-workspace-change";

export interface RuntimeInstallation {
  schemaVersion: typeof INSTALLATION_SCHEMA_V1;
  id: string;
  agentKind: RuntimeAgentKind;
  executable: string;
  argsPrefix: string[];
  displayCommand: string;
  source: "explicit" | "path" | "package" | "fallback";
  version?: string;
  capabilities: Record<string, boolean>;
  fingerprint: string;
  discoveredAt: string;
}

export interface HarnessSnapshotEntry {
  scope: "user" | "project" | "environment" | "installation" | "external";
  kind: "instruction" | "settings" | "skill" | "mcp" | "hook" | "rule" | "plugin" | "environment" | "executable";
  path?: string;
  identity: string;
  optional?: boolean;
}

export interface HarnessSnapshot {
  schemaVersion: typeof HARNESS_SNAPSHOT_SCHEMA_V1;
  snapshotId: string;
  agentKind: RuntimeAgentKind;
  installationFingerprint: string;
  hostEnvironmentSnapshotId: string;
  repositoryBaselineIdentity: string;
  entries: HarnessSnapshotEntry[];
  riskFlags: string[];
  createdAt: string;
}

export type RuntimeMutableBinding = "workspacePath" | "prompt" | "outputPath" | "sessionId";

export interface ResolvedLaunchSpec {
  schemaVersion: typeof RESOLVED_LAUNCH_SPEC_SCHEMA_V1;
  specId: string;
  createdAt: string;
  launchSpecHash: string;
  agentKind: RuntimeAgentKind;
  profile: {
    id: string;
    revision: number;
    secretRevision: number;
  };
  installation: {
    id: string;
    fingerprint: string;
    version?: string;
  };
  harnessSnapshotId: string;
  repositoryBaselineIdentity: string;
  command: {
    executable: string;
    argsPrefix: string[];
    argsTemplate: string[];
  };
  environment: {
    inheritHost: boolean;
    overrides: Record<string, string>;
    unset: string[];
    secretBindings: Array<{
      environmentVariable: string;
      secretRef: string;
      secretRevision: number;
    }>;
  };
  runtime: {
    providerKind?: string;
    /** Where the frozen model/reasoning identity was resolved from. */
    source?: AgentRuntimeSource;
    requestedModel?: string;
    canonicalModelIdentity?: string;
    modelIdentitySource: RuntimeModelIdentitySource;
    reasoningEffort?: string;
    /** Hash of the non-secret Provider routing policy used for this launch. */
    providerPolicyIdentity: string;
    /** Hash of model-affecting parameters after Harness-specific normalization. */
    modelParametersIdentity: string;
  };
  permissions: {
    mode: string;
    unattended: boolean;
    fullBypass: boolean;
  };
  timeouts: {
    startupMs: number;
    idleMs: number;
    totalMs: number;
  };
  mutableBindings: RuntimeMutableBinding[];
}

export type ResolvedLaunchSpecInput = Omit<ResolvedLaunchSpec, "launchSpecHash"> & {
  launchSpecHash?: never;
};

export interface PublicResolvedLaunchSpec
  extends Omit<ResolvedLaunchSpec, "environment"> {
  environment: Omit<ResolvedLaunchSpec["environment"], "overrides" | "secretBindings"> & {
    overrideKeys: string[];
    secretBindings: Array<{
      environmentVariable: string;
      secretRevision: number;
      configured: true;
    }>;
  };
}

export interface VerificationStageResult {
  stage: "installation" | "conversation" | "task";
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  durationMs: number;
  exitCode?: number | null;
  errorCategory?: RuntimeVerificationErrorCategory;
  summary: string;
  details?: string[];
}

export interface VerificationReceipt {
  schemaVersion: typeof VERIFICATION_RECEIPT_SCHEMA_V1;
  receiptId: string;
  createdAt: string;
  launchSpecHash: string;
  profileId: string;
  profileRevision: number;
  secretRevision: number;
  installationFingerprint: string;
  harnessSnapshotId: string;
  repositoryBaselineIdentity: string;
  readiness: RuntimeReadiness;
  stages: VerificationStageResult[];
}

export interface JobManifestVariant {
  order: number;
  variantId: string;
  agentKind: RuntimeAgentKind;
  profileId: string;
  profileRevision: number;
  secretRevision: number;
  launchSpecHash: string;
  verificationReceiptId: string;
  installationFingerprint: string;
  installationVersion?: string;
  harnessSnapshotId: string;
  providerKind?: string;
  requestedModel?: string;
  canonicalModelIdentity?: string;
  modelIdentitySource: RuntimeModelIdentitySource;
  reasoningEffort?: string;
  providerPolicyIdentity: string;
  modelParametersIdentity: string;
  permissionMode: string;
  fullPermissionBypass: boolean;
  riskFlags: string[];
  harnessDrift?: {
    status: "unchanged" | "changed" | "check-failed";
    checkedAt: string;
    postRunSnapshotId?: string;
    summary: string;
  };
}

export interface JobManifest {
  schemaVersion: typeof JOB_MANIFEST_SCHEMA_V1;
  runId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  failureSummary?: string;
  repositoryBaselineIdentity: string;
  taskIdentity: string;
  judgeIdentity: string;
  scoreMode: string;
  variants: JobManifestVariant[];
}

function canonicalSerialize(value: unknown, arrayPosition = false): string | undefined {
  if (value === undefined) {
    return arrayPosition ? "null" : undefined;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Runtime identity values must contain only finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalSerialize(entry, true) ?? "null").join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) => {
        const serialized = canonicalSerialize(record[key]);
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${fields.join(",")}}`;
  }
  throw new TypeError(`Runtime identity values cannot contain ${typeof value}.`);
}

export function canonicalRuntimeJson(value: unknown): string {
  return canonicalSerialize(value) ?? "null";
}

export function hashRuntimeIdentity(prefix: string, value: unknown): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(prefix)) {
    throw new Error("Runtime identity prefix must contain only letters, numbers, or hyphens.");
  }
  return `${prefix}:${createHash("sha256").update(canonicalRuntimeJson(value)).digest("hex")}`;
}

function cloneRuntimeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneRuntimeValue(entry)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneRuntimeValue(entry)])
    ) as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function launchBehaviorIdentity(input: ResolvedLaunchSpecInput): unknown {
  const { specId: _specId, createdAt: _createdAt, ...behavior } = input;
  return behavior;
}

export function createResolvedLaunchSpec(input: ResolvedLaunchSpecInput): ResolvedLaunchSpec {
  const launchSpecHash = hashRuntimeIdentity("launch-spec", launchBehaviorIdentity(input));
  return deepFreeze({
    ...cloneRuntimeValue(input),
    launchSpecHash
  });
}

export function toPublicResolvedLaunchSpec(spec: ResolvedLaunchSpec): PublicResolvedLaunchSpec {
  const { environment, ...rest } = spec;
  return {
    ...cloneRuntimeValue(rest),
    environment: {
      inheritHost: environment.inheritHost,
      overrideKeys: Object.keys(environment.overrides).sort((left, right) => left.localeCompare(right)),
      unset: [...environment.unset],
      secretBindings: environment.secretBindings.map((binding) => ({
        environmentVariable: binding.environmentVariable,
        secretRevision: binding.secretRevision,
        configured: true
      }))
    }
  };
}

export function isVerificationReceiptIdentityMatch(
  receipt: VerificationReceipt,
  launchSpec: ResolvedLaunchSpec
): boolean {
  return (
    receipt.schemaVersion === VERIFICATION_RECEIPT_SCHEMA_V1 &&
    receipt.launchSpecHash === launchSpec.launchSpecHash &&
    receipt.profileId === launchSpec.profile.id &&
    receipt.profileRevision === launchSpec.profile.revision &&
    receipt.secretRevision === launchSpec.profile.secretRevision &&
    receipt.installationFingerprint === launchSpec.installation.fingerprint &&
    receipt.harnessSnapshotId === launchSpec.harnessSnapshotId &&
    receipt.repositoryBaselineIdentity === launchSpec.repositoryBaselineIdentity
  );
}

export function isVerificationReceiptValid(
  receipt: VerificationReceipt,
  launchSpec: ResolvedLaunchSpec
): boolean {
  return receipt.readiness === "task-ready" && isVerificationReceiptIdentityMatch(receipt, launchSpec);
}
