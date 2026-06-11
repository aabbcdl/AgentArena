/**
 * Provider profile route handlers (CRUD + secret management).
 */

import {
  deleteClaudeProviderProfile,
  listClaudeProviderProfiles,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret,
} from "@agentarena/adapters";
import { jsonResponse } from "../../server/index.js";
import type { ApiResponse, ProviderProfilePayload } from "./types.js";
import {
  maskProfileExtraEnv,
  validateProfileId,
  validateProviderProfilePayload,
} from "./types.js";

export async function handleProviderProfilesGet(): Promise<ApiResponse> {
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse(maskProfileExtraEnv(profiles));
}

export async function handleProviderProfileCreate(rawBody: string): Promise<ApiResponse> {
  let payload: ProviderProfilePayload;
  try {
    payload = JSON.parse(rawBody) as ProviderProfilePayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  const validationError = validateProviderProfilePayload(payload);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }
  const profile = await saveClaudeProviderProfile(payload);
  if (payload.secret?.trim()) {
    try {
      await setClaudeProviderProfileSecret(profile.id, payload.secret);
    } catch (secretError) {
      await deleteClaudeProviderProfile(profile.id).catch(() => {});
      return jsonResponse({ error: `Profile created but secret storage failed: ${secretError instanceof Error ? secretError.message : String(secretError)}` }, 500);
    }
  }
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({
    profile: profiles.find((entry) => entry.id === profile.id),
    profiles
  });
}

export async function handleProviderProfileUpdate(profileId: string, rawBody: string): Promise<ApiResponse> {
  const profileIdError = validateProfileId(profileId);
  if (profileIdError) return jsonResponse({ error: profileIdError }, 400);

  let payload: ProviderProfilePayload;
  try {
    payload = JSON.parse(rawBody) as ProviderProfilePayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  const validationError = validateProviderProfilePayload(payload);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }
  const profile = await saveClaudeProviderProfile({
    ...payload,
    id: profileId
  });
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({
    profile: profiles.find((entry) => entry.id === profile.id),
    profiles
  });
}

export async function handleProviderProfileDelete(profileId: string): Promise<ApiResponse> {
  const profileIdError = validateProfileId(profileId);
  if (profileIdError) return jsonResponse({ error: profileIdError }, 400);
  try {
    await deleteClaudeProviderProfile(profileId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /cannot be deleted/i.test(message) ? 403 : 400;
    return jsonResponse({ error: message }, status);
  }
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({ profiles });
}

export async function handleProviderProfileSecret(profileId: string, rawBody: string): Promise<ApiResponse> {
  const profileIdError = validateProfileId(profileId);
  if (profileIdError) return jsonResponse({ error: profileIdError }, 400);

  let payload: { secret?: string };
  try {
    payload = JSON.parse(rawBody) as { secret?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON in request body." }, 400);
  }
  if (payload.secret && payload.secret.length > 10000) {
    return jsonResponse({ error: "secret must be less than 10,000 characters." }, 400);
  }
  await setClaudeProviderProfileSecret(profileId, payload.secret ?? "");
  const profiles = await listClaudeProviderProfiles();
  return jsonResponse({
    profile: profiles.find((entry) => entry.id === profileId),
    profiles
  });
}
