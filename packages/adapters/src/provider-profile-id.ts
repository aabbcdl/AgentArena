const PROVIDER_PROFILE_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])?$/;

export function validateClaudeProviderProfileId(profileId: unknown): string | null {
  if (typeof profileId !== "string" || profileId.length === 0) {
    return "Profile ID is required.";
  }
  if (profileId.length > 64) {
    return "Profile ID is too long (maximum 64 characters).";
  }
  if (!PROVIDER_PROFILE_ID_PATTERN.test(profileId)) {
    return "Profile ID must start and end with an alphanumeric character and contain only alphanumeric characters or hyphens.";
  }
  return null;
}

export function assertClaudeProviderProfileId(profileId: unknown): asserts profileId is string {
  const error = validateClaudeProviderProfileId(profileId);
  if (error) {
    throw new Error(`Invalid profile ID: "${String(profileId)}". ${error}`);
  }
}
