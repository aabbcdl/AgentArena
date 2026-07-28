/**
 * Shared types and validation helpers for API route handlers.
 */

import { validateClaudeProviderProfileId } from "@agentarena/adapters";
import type { ClaudeProviderProfile } from "@agentarena/core";

// ─── Types ───

export interface ApiResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export interface ProviderProfilePayload {
  id?: string;
  name: string;
  kind: ClaudeProviderProfile["kind"];
  homepage?: string;
  baseUrl?: string;
  apiFormat: ClaudeProviderProfile["apiFormat"];
  primaryModel?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  extraEnv?: Record<string, string>;
  writeCommonConfig?: boolean;
  notes?: string;
  secret?: string;
  _confirmBaseUrlRisk?: boolean;
}

// ─── Helpers ───

export function validateProviderProfilePayload(payload: ProviderProfilePayload): string | null {
  if (payload.id !== undefined) {
    const profileIdError = validateClaudeProviderProfileId(payload.id);
    if (profileIdError) return profileIdError;
  }
  if (!payload.name?.trim()) return "name is required.";
  if (!payload.kind?.trim()) return "kind is required (e.g. 'official', 'anthropic-compatible', 'openai-proxy').";
  if (!payload.apiFormat?.trim()) return "apiFormat is required (e.g. 'anthropic-messages', 'openai-chat-via-proxy').";
  return null;
}

export function validateProfileId(profileId: string): string | null {
  return validateClaudeProviderProfileId(profileId);
}

/**
 * Mask sensitive extraEnv values in profile list responses.
 */
export function maskProfileExtraEnv(profiles: ClaudeProviderProfile[]): ClaudeProviderProfile[] {
  return profiles.map(({ extraEnv, ...rest }: ClaudeProviderProfile) => ({
    ...rest,
    extraEnv: extraEnv ? Object.fromEntries(Object.keys(extraEnv as Record<string, unknown>).map(k => [k, "***"])) : undefined
  } as ClaudeProviderProfile));
}
