export const SUMMARY_ARTIFACT_SCHEMA = "agentarena.summary/v1" as const;
export const RESULT_ARTIFACT_SCHEMA = "agentarena.result/v1" as const;
export const TRACE_ARTIFACT_SCHEMA = "agentarena.trace/v1" as const;

export type ArtifactSchema =
  | typeof SUMMARY_ARTIFACT_SCHEMA
  | typeof RESULT_ARTIFACT_SCHEMA
  | typeof TRACE_ARTIFACT_SCHEMA;

export interface ArtifactValidation {
  ok: boolean;
  legacy: boolean;
  schemaVersion?: string;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateSummaryArtifact(value: unknown): ArtifactValidation {
  if (!isRecord(value)) {
    return { ok: false, legacy: false, errors: ["summary must be an object"] };
  }
  const schemaVersion = typeof value.artifactSchemaVersion === "string" ? value.artifactSchemaVersion : undefined;
  const legacy = schemaVersion === undefined;
  const errors: string[] = [];
  if (schemaVersion !== undefined && schemaVersion !== SUMMARY_ARTIFACT_SCHEMA) {
    errors.push(`unsupported summary schema: ${schemaVersion}`);
  }
  if (typeof value.runId !== "string" && typeof value.id !== "string") errors.push("runId is missing");
  if (!Array.isArray(value.results)) errors.push("results must be an array");
  return { ok: errors.length === 0, legacy, schemaVersion, errors };
}

export function validateResultArtifact(value: unknown): ArtifactValidation {
  if (!isRecord(value)) return { ok: false, legacy: false, errors: ["result must be an object"] };
  const schemaVersion = typeof value.artifactSchemaVersion === "string" ? value.artifactSchemaVersion : undefined;
  const legacy = schemaVersion === undefined;
  const errors: string[] = [];
  if (schemaVersion !== undefined && schemaVersion !== RESULT_ARTIFACT_SCHEMA) errors.push(`unsupported result schema: ${schemaVersion}`);
  if (typeof value.agentId !== "string" || typeof value.variantId !== "string") errors.push("agent identity is missing");
  if (!["success", "failed", "cancelled"].includes(String(value.status))) errors.push("invalid result status");
  return { ok: errors.length === 0, legacy, schemaVersion, errors };
}

export function validateTraceEvent(value: unknown): ArtifactValidation {
  if (!isRecord(value)) return { ok: false, legacy: false, errors: ["trace event must be an object"] };
  const schemaVersion = typeof value.schemaVersion === "string" ? value.schemaVersion : undefined;
  const legacy = schemaVersion === undefined;
  const errors: string[] = [];
  if (schemaVersion !== undefined && schemaVersion !== TRACE_ARTIFACT_SCHEMA) errors.push(`unsupported trace schema: ${schemaVersion}`);
  for (const field of ["timestamp", "agentId", "type", "message"]) {
    if (typeof value[field] !== "string") errors.push(`${field} is missing`);
  }
  return { ok: errors.length === 0, legacy, schemaVersion, errors };
}
