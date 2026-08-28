import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isVerificationReceiptIdentityMatch,
  isVerificationReceiptValid,
  type ResolvedLaunchSpec,
  recoverAtomicFile,
  VERIFICATION_RECEIPT_SCHEMA_V1,
  type VerificationReceipt,
  writeJsonAtomic
} from "@agentarena/core";

const VERIFICATION_RECEIPT_REGISTRY_SCHEMA_V1 = "agentarena.verification-receipt-registry/v1" as const;

interface VerificationReceiptRegistry {
  schemaVersion: typeof VERIFICATION_RECEIPT_REGISTRY_SCHEMA_V1;
  receipts: VerificationReceipt[];
}

let receiptMutationTail: Promise<void> = Promise.resolve();

function verificationRoot(): string {
  if (process.env.AGENTARENA_VERIFICATION_ROOT?.trim()) {
    return process.env.AGENTARENA_VERIFICATION_ROOT.trim();
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "AgentArena");
  }
  return path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "agentarena");
}

function receiptRegistryPath(): string {
  return process.env.AGENTARENA_VERIFICATION_RECEIPTS_FILE?.trim()
    || path.join(verificationRoot(), "verification-receipts.json");
}

function isReceipt(value: unknown): value is VerificationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<VerificationReceipt>;
  return (
    receipt.schemaVersion === VERIFICATION_RECEIPT_SCHEMA_V1 &&
    typeof receipt.receiptId === "string" &&
    typeof receipt.createdAt === "string" &&
    typeof receipt.launchSpecHash === "string" &&
    typeof receipt.profileId === "string" &&
    Number.isInteger(receipt.profileRevision) &&
    Number.isInteger(receipt.secretRevision) &&
    typeof receipt.installationFingerprint === "string" &&
    typeof receipt.harnessSnapshotId === "string" &&
    typeof receipt.repositoryBaselineIdentity === "string" &&
    Array.isArray(receipt.stages)
  );
}

async function readReceiptRegistry(): Promise<VerificationReceiptRegistry> {
  const filePath = receiptRegistryPath();
  await recoverAtomicFile(filePath);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<VerificationReceiptRegistry>;
    if (parsed.schemaVersion !== VERIFICATION_RECEIPT_REGISTRY_SCHEMA_V1 || !Array.isArray(parsed.receipts)) {
      throw new Error(`Verification receipt registry at ${filePath} has an unsupported schema.`);
    }
    return {
      schemaVersion: VERIFICATION_RECEIPT_REGISTRY_SCHEMA_V1,
      receipts: parsed.receipts.filter(isReceipt)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: VERIFICATION_RECEIPT_REGISTRY_SCHEMA_V1, receipts: [] };
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Verification receipt registry at ${filePath} is malformed JSON.`);
    }
    throw error;
  }
}

async function withReceiptMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = receiptMutationTail;
  let release: () => void = () => {};
  receiptMutationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function saveVerificationReceipt(receipt: VerificationReceipt): Promise<void> {
  if (!isReceipt(receipt)) throw new Error("Cannot persist an invalid verification receipt.");
  await withReceiptMutation(async () => {
    const registry = await readReceiptRegistry();
    registry.receipts = [
      ...registry.receipts.filter((entry) => entry.receiptId !== receipt.receiptId),
      structuredClone(receipt)
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    await fs.mkdir(path.dirname(receiptRegistryPath()), { recursive: true });
    await writeJsonAtomic(receiptRegistryPath(), registry);
  });
}

export async function listVerificationReceipts(): Promise<VerificationReceipt[]> {
  const registry = await withReceiptMutation(readReceiptRegistry);
  return registry.receipts.map((receipt) => structuredClone(receipt));
}

export async function getVerificationReceipt(receiptId: string): Promise<VerificationReceipt> {
  const receipt = (await listVerificationReceipts()).find((entry) => entry.receiptId === receiptId);
  if (!receipt) throw new Error(`Unknown verification receipt "${receiptId}".`);
  return receipt;
}

export async function findValidVerificationReceipt(
  launchSpec: ResolvedLaunchSpec
): Promise<VerificationReceipt | undefined> {
  return (await listVerificationReceipts())
    .filter((receipt) => isVerificationReceiptValid(receipt, launchSpec))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export async function findMatchingVerificationReceipt(
  launchSpec: ResolvedLaunchSpec
): Promise<VerificationReceipt | undefined> {
  return (await listVerificationReceipts())
    .filter((receipt) => isVerificationReceiptIdentityMatch(receipt, launchSpec))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export async function findLatestVerificationReceipt(
  profileId: string
): Promise<VerificationReceipt | undefined> {
  return (await listVerificationReceipts())
    .filter((receipt) => receipt.profileId === profileId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export const __verificationReceiptTestUtils = {
  verificationRoot,
  receiptRegistryPath
};
