import { promises as fs } from "node:fs";
import path from "node:path";
import {
  deleteRuntimeProfile,
  findLatestVerificationReceipt,
  findMatchingVerificationReceipt,
  listPublicRuntimeProfiles,
  type RuntimeProfileInput,
  resolveRuntimeProfileLaunch,
  saveRuntimeProfile,
  saveVerificationReceipt,
  setRuntimeProfileSecret,
  verifyRuntimeLaunch
} from "@agentarena/adapters";
import {
  isPathInsideWorkspace,
  type PublicRuntimeProfile,
  type RuntimeReadiness,
  type RuntimeVerificationErrorCategory,
  redactSensitiveText,
  toPublicResolvedLaunchSpec,
  type VerificationReceipt,
  type VerificationStageResult
} from "@agentarena/core";
import { repositoryIdentity, resolveAndValidateRepo } from "@agentarena/runner";
import { jsonResponse } from "../../server/index.js";
import {
  completeRuntimeVerificationProgress,
  failRuntimeVerificationProgress,
  getRuntimeVerificationProgress,
  markRuntimeVerificationStageComplete,
  markRuntimeVerificationStageStarted,
  startRuntimeVerificationProgress
} from "../runtime-verification-progress.js";
import { BUILTIN_REPOS_ROOT, OFFICIAL_TASKPACK_ROOT } from "../shared.js";
import type { ApiResponse } from "./types.js";

interface RuntimeProfilePayload extends RuntimeProfileInput {
  secret?: string;
}

const RUNTIME_PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RUNTIME_VERIFICATION_PROGRESS_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function parseRuntimeProfilePayload(rawBody: string): RuntimeProfilePayload | ApiResponse {
  let payload: RuntimeProfilePayload;
  try {
    payload = JSON.parse(rawBody) as RuntimeProfilePayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  if (!payload.name?.trim()) return jsonResponse({ error: "name is required." }, 400);
  if (payload.agentKind !== "codex" && payload.agentKind !== "claude-code") {
    return jsonResponse({ error: "agentKind must be codex or claude-code." }, 400);
  }
  if (payload.mode !== "inherit-local" && payload.mode !== "managed-provider") {
    return jsonResponse({ error: "mode must be inherit-local or managed-provider." }, 400);
  }
  if (payload.secret !== undefined && (typeof payload.secret !== "string" || payload.secret.length > 10_000)) {
    return jsonResponse({ error: "secret must be a string shorter than 10,000 characters." }, 400);
  }
  return payload;
}

function runtimeProfileIdError(profileId: string): ApiResponse | undefined {
  if (!RUNTIME_PROFILE_ID_PATTERN.test(profileId)) {
    return jsonResponse({ error: `Invalid runtime profile ID "${profileId}".` }, 400);
  }
  return undefined;
}

function isApiResponse(value: RuntimeProfilePayload | ApiResponse): value is ApiResponse {
  return "statusCode" in value;
}

async function publicProfile(profileId: string): Promise<PublicRuntimeProfile | undefined> {
  return (await listPublicRuntimeProfiles()).find((profile) => profile.id === profileId);
}

function publicProfilesResponse(
  profiles: PublicRuntimeProfile[],
  profile?: PublicRuntimeProfile
): ApiResponse {
  return jsonResponse(profile ? { profile, profiles } : { profiles });
}

interface RuntimeRepositoryBinding {
  requestedPath: string;
  resolvedPath: string;
  baselineIdentity: string;
  kind: "user" | "builtin";
}

async function resolveRuntimeRepository(
  repositoryPath: string,
  taskPath: string | undefined,
  workspaceRoot: string
): Promise<RuntimeRepositoryBinding> {
  const requestedPath = repositoryPath.trim();
  if (!requestedPath) throw new Error("repositoryPath is required and must be a string.");
  if (!(await isPathInsideWorkspace(workspaceRoot, requestedPath))) {
    throw new Error("repositoryPath must resolve within the current workspace.");
  }

  let resolvedPath = requestedPath;
  let kind: RuntimeRepositoryBinding["kind"] = "user";
  if (taskPath?.trim()) {
    const normalizedTaskPath = taskPath.trim();
    const taskAllowed = await isPathInsideWorkspace(workspaceRoot, normalizedTaskPath)
      || await isPathInsideWorkspace(OFFICIAL_TASKPACK_ROOT, normalizedTaskPath);
    if (!taskAllowed) throw new Error("taskPath must resolve within an allowed task directory.");
    const resolved = await resolveAndValidateRepo({
      repoPath: requestedPath,
      taskPath: normalizedTaskPath,
      builtinReposRoot: BUILTIN_REPOS_ROOT,
      userRepoRoot: workspaceRoot
    });
    resolvedPath = resolved.repoPath;
    kind = path.resolve(resolved.repoPath) === path.resolve(requestedPath) ? "user" : "builtin";
  } else if (!(await fs.stat(requestedPath).catch(() => undefined))?.isDirectory()) {
    throw new Error("repositoryPath must be an existing directory.");
  }

  return {
    requestedPath,
    resolvedPath,
    baselineIdentity: repositoryIdentity(resolvedPath),
    kind
  };
}

function projectedStages(
  discoveredAt: string,
  version: string | undefined,
  secretMissing: boolean
): VerificationStageResult[] {
  const installation: VerificationStageResult = {
    stage: "installation",
    status: "passed",
    startedAt: discoveredAt,
    durationMs: 0,
    summary: version ? `CLI ${version} is installed.` : "The CLI is installed."
  };
  if (!secretMissing) return [
    installation,
    {
      stage: "conversation",
      status: "skipped",
      startedAt: discoveredAt,
      durationMs: 0,
      summary: "Run explicit verification to test a real Provider conversation."
    },
    {
      stage: "task",
      status: "skipped",
      startedAt: discoveredAt,
      durationMs: 0,
      summary: "Run explicit verification to test an exact edit in a disposable repository copy."
    }
  ];
  return [
    installation,
    {
      stage: "conversation",
      status: "failed",
      startedAt: discoveredAt,
      durationMs: 0,
      errorCategory: "secret-missing",
      summary: "This managed Provider profile needs a task-scoped Secret."
    },
    {
      stage: "task",
      status: "skipped",
      startedAt: discoveredAt,
      durationMs: 0,
      summary: "Skipped until the Provider Secret is saved."
    }
  ];
}

function resolutionFailure(message: string): {
  readiness: RuntimeReadiness;
  errorCategory: RuntimeVerificationErrorCategory;
} {
  return /could not be launched|not found|ENOENT/i.test(message)
    ? { readiness: "not-installed", errorCategory: "installation-missing" }
    : { readiness: "blocked", errorCategory: "harness-startup-failed" };
}

function verificationReceiptFailure(
  receipt: VerificationReceipt | undefined
): { errorCategory: RuntimeVerificationErrorCategory; summary: string } | undefined {
  const failedStage = receipt?.stages.find((stage) => stage.status === "failed");
  if (!failedStage) return undefined;
  return {
    errorCategory: failedStage.errorCategory ?? "process-crashed",
    summary: failedStage.summary
  };
}

export async function handleRuntimeProfilesGet(
  queryParams?: URLSearchParams,
  workspaceRoot: string = process.cwd()
): Promise<ApiResponse> {
  const profiles = await listPublicRuntimeProfiles();
  const repositoryPath = queryParams?.get("repositoryPath")?.trim();
  if (!repositoryPath) return publicProfilesResponse(profiles);

  let repository: RuntimeRepositoryBinding;
  try {
    repository = await resolveRuntimeRepository(
      repositoryPath,
      queryParams?.get("taskPath")?.trim() || undefined,
      workspaceRoot
    );
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  const readiness = [];
  for (const profile of profiles) {
    try {
      const resolved = await resolveRuntimeProfileLaunch({
        profileId: profile.id,
        repositoryPath: repository.resolvedPath,
        repositoryBaselineIdentity: repository.baselineIdentity,
        resolveSecrets: false
      });
      const matchingReceipt = await findMatchingVerificationReceipt(resolved.launchSpec);
      const latestReceipt = matchingReceipt ?? await findLatestVerificationReceipt(profile.id);
      const matchingFailure = verificationReceiptFailure(matchingReceipt);
      const secretMissing = profile.mode === "managed-provider" && !profile.secretStored;
      const projectedReadiness: RuntimeReadiness = matchingReceipt
        ? matchingReceipt.readiness
        : secretMissing
            ? "blocked"
          : latestReceipt
            ? "changed"
            : "installed";
      readiness.push({
        profile,
        readiness: projectedReadiness,
        receiptMatch: Boolean(matchingReceipt),
        installation: resolved.installation,
        harness: {
          snapshotId: resolved.harnessSnapshot.snapshotId,
          repositoryBaselineIdentity: resolved.harnessSnapshot.repositoryBaselineIdentity,
          riskFlags: resolved.harnessSnapshot.riskFlags,
          entries: resolved.harnessSnapshot.entries
        },
        launchSpec: toPublicResolvedLaunchSpec(resolved.launchSpec),
        receipt: matchingReceipt ?? latestReceipt,
        stages: matchingReceipt?.stages ?? projectedStages(
          resolved.installation.discoveredAt,
          resolved.installation.version,
          secretMissing
        ),
        ...(secretMissing
          ? { failure: { errorCategory: "secret-missing", summary: "Save a Provider Secret, then verify this profile." } }
          : matchingFailure
            ? { failure: matchingFailure }
          : latestReceipt && !matchingReceipt
            ? { failure: { errorCategory: "harness-config-drift", summary: "The Profile, repository, installation, environment, or Harness changed after verification." } }
            : {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = resolutionFailure(message);
      readiness.push({
        profile,
        readiness: failure.readiness,
        receiptMatch: false,
        stages: [],
        failure: { errorCategory: failure.errorCategory, summary: message }
      });
    }
  }
  return jsonResponse({ profiles, repository, readiness });
}

export async function handleRuntimeProfileCreate(rawBody: string): Promise<ApiResponse> {
  const parsed = parseRuntimeProfilePayload(rawBody);
  if (isApiResponse(parsed)) return parsed;
  const { secret, ...input } = parsed;
  let saved: Awaited<ReturnType<typeof saveRuntimeProfile>>;
  try {
    saved = await saveRuntimeProfile(input);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
  if (secret?.trim()) {
    try {
      saved = await setRuntimeProfileSecret(saved.id, secret);
    } catch (error) {
      await deleteRuntimeProfile(saved.id).catch(() => {});
      return jsonResponse({
        error: `Profile created but Secret storage failed: ${error instanceof Error ? error.message : String(error)}`
      }, 500);
    }
  }
  const profiles = await listPublicRuntimeProfiles();
  return publicProfilesResponse(profiles, profiles.find((profile) => profile.id === saved.id));
}

export async function handleRuntimeProfileUpdate(
  profileId: string,
  rawBody: string
): Promise<ApiResponse> {
  const idError = runtimeProfileIdError(profileId);
  if (idError) return idError;
  const parsed = parseRuntimeProfilePayload(rawBody);
  if (isApiResponse(parsed)) return parsed;
  const { secret, ...input } = parsed;
  try {
    let saved = await saveRuntimeProfile({ ...input, id: profileId });
    if (secret !== undefined) saved = await setRuntimeProfileSecret(profileId, secret);
    const profiles = await listPublicRuntimeProfiles();
    return publicProfilesResponse(profiles, profiles.find((profile) => profile.id === saved.id));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

export async function handleRuntimeProfileSecret(
  profileId: string,
  rawBody: string
): Promise<ApiResponse> {
  const idError = runtimeProfileIdError(profileId);
  if (idError) return idError;
  let payload: { secret?: unknown };
  try {
    payload = JSON.parse(rawBody) as { secret?: unknown };
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  if (typeof payload.secret !== "string" || payload.secret.length > 10_000) {
    return jsonResponse({ error: "secret must be a string shorter than 10,000 characters." }, 400);
  }
  try {
    await setRuntimeProfileSecret(profileId, payload.secret);
    const profiles = await listPublicRuntimeProfiles();
    return publicProfilesResponse(profiles, profiles.find((profile) => profile.id === profileId));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

export async function handleRuntimeProfileDelete(profileId: string): Promise<ApiResponse> {
  const idError = runtimeProfileIdError(profileId);
  if (idError) return idError;
  try {
    await deleteRuntimeProfile(profileId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, /cannot be deleted/i.test(message) ? 403 : 400);
  }
  return publicProfilesResponse(await listPublicRuntimeProfiles());
}

export async function handleRuntimeProfileVerify(
  profileId: string,
  rawBody: string,
  workspaceRoot: string = process.cwd()
): Promise<ApiResponse> {
  const idError = runtimeProfileIdError(profileId);
  if (idError) return idError;
  let payload: { repositoryPath?: unknown; taskPath?: unknown; progressId?: unknown };
  try {
    payload = JSON.parse(rawBody) as { repositoryPath?: unknown; taskPath?: unknown };
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  if (typeof payload.repositoryPath !== "string" || !payload.repositoryPath.trim()) {
    return jsonResponse({ error: "repositoryPath is required and must be a string." }, 400);
  }
  if (payload.taskPath !== undefined && typeof payload.taskPath !== "string") {
    return jsonResponse({ error: "taskPath must be a string when provided." }, 400);
  }
  const progressId = typeof payload.progressId === "string" ? payload.progressId.trim() : undefined;
  if (payload.progressId !== undefined && (!progressId || !RUNTIME_VERIFICATION_PROGRESS_ID_PATTERN.test(progressId))) {
    return jsonResponse({ error: "progressId must contain 8-128 letters, numbers, underscores, or hyphens." }, 400);
  }
  let repository: RuntimeRepositoryBinding;
  try {
    repository = await resolveRuntimeRepository(
      payload.repositoryPath.trim(),
      typeof payload.taskPath === "string" ? payload.taskPath : undefined,
      workspaceRoot
    );
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  if (progressId) startRuntimeVerificationProgress(profileId, progressId);
  try {
    const resolved = await resolveRuntimeProfileLaunch({
      profileId,
      repositoryPath: repository.resolvedPath,
      repositoryBaselineIdentity: repository.baselineIdentity
    });
    const receipt = await verifyRuntimeLaunch({
      launchSpec: resolved.launchSpec,
      repositoryPath: repository.resolvedPath,
      runtimeSecretValues: resolved.runtimeSecretValues,
      onStageStart: (stage, startedAt) => {
        if (progressId) markRuntimeVerificationStageStarted(profileId, progressId, stage, startedAt);
      },
      onStageComplete: (stage) => {
        if (progressId) markRuntimeVerificationStageComplete(profileId, progressId, stage);
      }
    });
    await saveVerificationReceipt(receipt);
    if (progressId) completeRuntimeVerificationProgress(profileId, progressId, receipt);
    return jsonResponse({
      profile: await publicProfile(profileId),
      installation: resolved.installation,
      harness: {
        snapshotId: resolved.harnessSnapshot.snapshotId,
        repositoryBaselineIdentity: resolved.harnessSnapshot.repositoryBaselineIdentity,
        riskFlags: resolved.harnessSnapshot.riskFlags,
        entries: resolved.harnessSnapshot.entries
      },
      launchSpec: toPublicResolvedLaunchSpec(resolved.launchSpec),
      receipt
    });
  } catch (error) {
    if (progressId) {
      const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
      failRuntimeVerificationProgress(profileId, progressId, message);
    }
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 422);
  }
}

export async function handleRuntimeProfileVerifyProgress(
  profileId: string,
  progressId: string
): Promise<ApiResponse> {
  const idError = runtimeProfileIdError(profileId);
  if (idError) return idError;
  if (!RUNTIME_VERIFICATION_PROGRESS_ID_PATTERN.test(progressId)) {
    return jsonResponse({ error: "Invalid verification progress ID." }, 400);
  }
  const progress = getRuntimeVerificationProgress(profileId, progressId);
  return progress
    ? jsonResponse(progress)
    : jsonResponse({ error: "Verification progress was not found or has expired." }, 404);
}
