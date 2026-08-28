// Browser-safe mirror of the summary contract used by packages/core.
// The legacy report is served as plain modules, so it cannot import TypeScript
// source outside apps/web-report/dist. Keep this validator behavior aligned.

export const SUMMARY_ARTIFACT_SCHEMA = "agentarena.summary/v1";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateSummaryArtifact(value) {
  if (!isRecord(value)) {
    return { ok: false, legacy: false, errors: ["summary must be an object"] };
  }

  const schemaVersion = typeof value.artifactSchemaVersion === "string"
    ? value.artifactSchemaVersion
    : undefined;
  const legacy = schemaVersion === undefined;
  const errors = [];

  if (schemaVersion !== undefined && schemaVersion !== SUMMARY_ARTIFACT_SCHEMA) {
    errors.push(`unsupported summary schema: ${schemaVersion}`);
  }
  if (typeof value.runId !== "string" && typeof value.id !== "string") {
    errors.push("runId is missing");
  }
  if (!Array.isArray(value.results)) {
    errors.push("results must be an array");
  }

  return { ok: errors.length === 0, legacy, schemaVersion, errors };
}
