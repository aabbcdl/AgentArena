import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type AgentSelection,
  type HarnessSnapshot,
  isVerificationReceiptValid,
  JOB_MANIFEST_SCHEMA_V1,
  type JobManifest,
  type ResolvedLaunchSpec,
  type RuntimeInstallation,
  type RuntimeProfile,
  type RuntimeSecretValues,
  type VerificationReceipt,
  writeJsonAtomic
} from "@agentarena/core";

const JOB_MANIFEST_FILE_NAME = "job-manifest.json";
const TERMINAL_STATUSES = new Set<JobManifest["status"]>([
  "completed",
  "failed",
  "cancelled",
  "interrupted"
]);

export interface RuntimeExecutionBinding {
  profile?: RuntimeProfile;
  installation?: RuntimeInstallation;
  harnessSnapshot?: HarnessSnapshot;
  launchSpec: ResolvedLaunchSpec;
  verificationReceipt: VerificationReceipt;
  runtimeSecretValues: RuntimeSecretValues;
  harnessRiskFlags: string[];
  hostEnvironment: NodeJS.ProcessEnv;
  /** True when the Profile can be re-resolved from AgentArena's persistent registry. */
  registryBacked?: boolean;
}

export type RuntimeExecutionBindings = Readonly<Record<string, RuntimeExecutionBinding>>;

export interface JobManifestHarnessDriftRecord {
  variantId: string;
  evidence: NonNullable<JobManifest["variants"][number]["harnessDrift"]>;
}

export interface CreateJobManifestOptions {
  runId: string;
  status?: JobManifest["status"];
  repositoryBaselineIdentity: string;
  taskIdentity: string;
  judgeIdentity: string;
  scoreMode: string;
  selections: AgentSelection[];
  runtimeBindings: RuntimeExecutionBindings;
  now?: () => string;
}

export function runtimeBindingForSelection(
  selection: AgentSelection,
  bindings: RuntimeExecutionBindings | undefined
): RuntimeExecutionBinding | undefined {
  if (!bindings) return undefined;
  return bindings[selection.variantId]
    ?? (selection.runtimeProfileId ? bindings[selection.runtimeProfileId] : undefined);
}

export function assertFrozenRuntimeSelection(
  selection: AgentSelection,
  binding: RuntimeExecutionBinding | undefined,
  repositoryBaselineIdentity: string
): asserts binding is RuntimeExecutionBinding {
  if (!selection.runtimeProfileId) {
    throw new Error(`Selection "${selection.variantId}" does not identify a RuntimeProfile.`);
  }
  if (!binding) {
    throw new Error(`Selection "${selection.variantId}" has no frozen runtime binding.`);
  }
  const spec = binding.launchSpec;
  const receipt = binding.verificationReceipt;
  const expectedAgentKind = selection.baseAgentId === "claude-code" ? "claude-code" : selection.baseAgentId;
  if (expectedAgentKind !== spec.agentKind) {
    throw new Error(`Selection "${selection.variantId}" does not match its frozen ${spec.agentKind} LaunchSpec.`);
  }
  if (selection.runtimeProfileId !== spec.profile.id) {
    throw new Error(`Selection "${selection.variantId}" RuntimeProfile does not match its frozen LaunchSpec.`);
  }
  if (selection.launchSpecHash !== spec.launchSpecHash) {
    throw new Error(`Selection "${selection.variantId}" LaunchSpec hash does not match the frozen runtime.`);
  }
  if (selection.verificationReceiptId !== receipt.receiptId) {
    throw new Error(`Selection "${selection.variantId}" verification Receipt ID does not match the frozen runtime.`);
  }
  if (spec.repositoryBaselineIdentity !== repositoryBaselineIdentity) {
    throw new Error(`Selection "${selection.variantId}" was verified against a different repository baseline.`);
  }
  if (!isVerificationReceiptValid(receipt, spec)) {
    throw new Error(`Selection "${selection.variantId}" does not have an exact Task-ready verification Receipt.`);
  }
  for (const secretBinding of spec.environment.secretBindings) {
    if (!binding.runtimeSecretValues[secretBinding.secretRef]) {
      throw new Error(
        `Selection "${selection.variantId}" is missing the in-memory Secret required by its frozen LaunchSpec.`
      );
    }
  }
}

export function createJobManifest(options: CreateJobManifestOptions): JobManifest {
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const variants = options.selections.map((selection, order) => {
    const binding = runtimeBindingForSelection(selection, options.runtimeBindings);
    assertFrozenRuntimeSelection(selection, binding, options.repositoryBaselineIdentity);
    const spec = binding.launchSpec;
    return {
      order,
      variantId: selection.variantId,
      agentKind: spec.agentKind,
      profileId: spec.profile.id,
      profileRevision: spec.profile.revision,
      secretRevision: spec.profile.secretRevision,
      launchSpecHash: spec.launchSpecHash,
      verificationReceiptId: binding.verificationReceipt.receiptId,
      installationFingerprint: spec.installation.fingerprint,
      installationVersion: spec.installation.version,
      harnessSnapshotId: spec.harnessSnapshotId,
      providerKind: spec.runtime.providerKind,
      requestedModel: spec.runtime.requestedModel,
      canonicalModelIdentity: spec.runtime.canonicalModelIdentity,
      modelIdentitySource: spec.runtime.modelIdentitySource,
      reasoningEffort: spec.runtime.reasoningEffort,
      providerPolicyIdentity: spec.runtime.providerPolicyIdentity,
      modelParametersIdentity: spec.runtime.modelParametersIdentity,
      permissionMode: spec.permissions.mode,
      fullPermissionBypass: spec.permissions.fullBypass,
      riskFlags: [...new Set(binding.harnessRiskFlags)].sort()
    };
  });
  const status = options.status ?? "queued";
  return {
    schemaVersion: JOB_MANIFEST_SCHEMA_V1,
    runId: options.runId,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: status === "running" ? timestamp : undefined,
    repositoryBaselineIdentity: options.repositoryBaselineIdentity,
    taskIdentity: options.taskIdentity,
    judgeIdentity: options.judgeIdentity,
    scoreMode: options.scoreMode,
    variants
  };
}

export function jobManifestPath(outputPath: string): string {
  return path.join(outputPath, JOB_MANIFEST_FILE_NAME);
}

function isJobManifest(value: unknown): value is JobManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Partial<JobManifest>;
  return manifest.schemaVersion === JOB_MANIFEST_SCHEMA_V1
    && typeof manifest.runId === "string"
    && typeof manifest.status === "string"
    && typeof manifest.createdAt === "string"
    && typeof manifest.updatedAt === "string"
    && typeof manifest.repositoryBaselineIdentity === "string"
    && typeof manifest.taskIdentity === "string"
    && typeof manifest.judgeIdentity === "string"
    && typeof manifest.scoreMode === "string"
    && Array.isArray(manifest.variants);
}

export async function writeJobManifest(outputPath: string, manifest: JobManifest): Promise<void> {
  if (!isJobManifest(manifest)) throw new Error("Cannot persist an invalid JobManifest.");
  await fs.mkdir(outputPath, { recursive: true });
  await writeJsonAtomic(jobManifestPath(outputPath), manifest);
}

export async function readJobManifest(outputPath: string): Promise<JobManifest> {
  const filePath = jobManifestPath(outputPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No JobManifest exists at ${filePath}.`);
    }
    throw error;
  }
  if (!isJobManifest(parsed)) throw new Error(`JobManifest at ${filePath} is invalid.`);
  return parsed;
}

export async function updateJobManifestStatus(
  outputPath: string,
  status: JobManifest["status"],
  now: () => string = () => new Date().toISOString(),
  failureSummary?: string
): Promise<JobManifest> {
  const manifest = await readJobManifest(outputPath);
  const timestamp = now();
  const updated: JobManifest = {
    ...manifest,
    status,
    updatedAt: timestamp,
    startedAt: manifest.startedAt ?? (status === "running" ? timestamp : undefined),
    finishedAt: TERMINAL_STATUSES.has(status) ? timestamp : undefined,
    failureSummary: failureSummary?.trim() || undefined
  };
  await writeJobManifest(outputPath, updated);
  return updated;
}

export async function updateJobManifestHarnessDrift(
  outputPath: string,
  records: readonly JobManifestHarnessDriftRecord[],
  now: () => string = () => new Date().toISOString()
): Promise<JobManifest> {
  const manifest = await readJobManifest(outputPath);
  const evidence = new Map(records.map((record) => [record.variantId, record.evidence]));
  const updated: JobManifest = {
    ...manifest,
    updatedAt: now(),
    variants: manifest.variants.map((variant) => ({
      ...variant,
      ...(evidence.has(variant.variantId)
        ? { harnessDrift: evidence.get(variant.variantId) }
        : {})
    }))
  };
  await writeJobManifest(outputPath, updated);
  return updated;
}

export async function markJobManifestInterrupted(
  outputPath: string,
  now: () => string = () => new Date().toISOString()
): Promise<JobManifest | undefined> {
  let manifest: JobManifest;
  try {
    manifest = await readJobManifest(outputPath);
  } catch (error) {
    if (/No JobManifest exists/.test(error instanceof Error ? error.message : String(error))) return undefined;
    throw error;
  }
  if (manifest.status !== "running" && manifest.status !== "queued") return manifest;
  return await updateJobManifestStatus(
    outputPath,
    "interrupted",
    now,
    "AgentArena stopped while this job was active; the partial attempt was not resumed automatically."
  );
}
