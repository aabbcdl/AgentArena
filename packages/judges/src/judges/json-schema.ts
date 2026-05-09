import type { JsonSchemaJudge, JudgeResult } from "@agentarena/core";
import {
  createAjv,
  readTextFileSafe,
  resolveWorkspacePath,
} from "../shared.js";

export async function runJsonSchemaJudge(judge: JsonSchemaJudge, workspacePath: string): Promise<JudgeResult> {
  const startedAt = Date.now();
  const targetPath = await resolveWorkspacePath(workspacePath, judge.path, `Judge "${judge.id}" path`);

  try {
    if (judge.schema === undefined && !judge.schemaPath) {
      return {
        judgeId: judge.id,
        label: judge.label,
        type: "json-schema",
        target: judge.path,
        expectation: "inline-schema",
        exitCode: 1,
        success: false,
        stdout: "",
        stderr: `Judge "${judge.id}" requires either a schema or schemaPath.`,
        durationMs: Date.now() - startedAt,
        critical: judge.critical ?? false
      };
    }

    let schema: Record<string, unknown>;
    if (judge.schema) {
      schema = judge.schema;
    } else if (judge.schemaPath) {
      const schemaText = await readTextFileSafe(
        await resolveWorkspacePath(workspacePath, judge.schemaPath, `Judge "${judge.id}" schemaPath`),
        `Judge "${judge.id}" schemaPath`
      );
      const parsedSchema = JSON.parse(schemaText);
      if (typeof parsedSchema !== "object" || parsedSchema === null) {
        throw new Error(`Judge "${judge.id}" schemaPath: expected JSON object, got ${typeof parsedSchema}`);
      }
      schema = parsedSchema as Record<string, unknown>;
    } else {
      throw new Error(`Judge "${judge.id}": either "schema" or "schemaPath" must be provided.`);
    }
    const rawPayload = await readTextFileSafe(targetPath, `Judge "${judge.id}"`);
    const parsedPayload = JSON.parse(rawPayload);
    if (typeof parsedPayload !== "object" || parsedPayload === null) {
      throw new Error(`Judge "${judge.id}": expected JSON object or array, got ${typeof parsedPayload}`);
    }
    const payload = parsedPayload;
    const ajv = createAjv();
    const validate = ajv.compile(schema);
    const success = Boolean(validate(payload));
    const validationErrors =
      validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`) ?? [];

    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-schema",
      target: judge.path,
      expectation: judge.schemaPath ? `schemaPath=${judge.schemaPath}` : "inline-schema",
      exitCode: success ? 0 : 1,
      success,
      stdout: success ? `JSON schema validation passed for ${judge.path}.` : "",
      stderr: success ? "" : validationErrors.join("; "),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  } catch (error) {
    return {
      judgeId: judge.id,
      label: judge.label,
      type: "json-schema",
      target: judge.path,
      expectation: judge.schemaPath ? `schemaPath=${judge.schemaPath}` : "inline-schema",
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      critical: judge.critical ?? false
    };
  }
}
