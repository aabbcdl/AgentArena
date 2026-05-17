import path from "node:path";
import type { AdapterPreflightResult, AgentRunResult } from "@agentarena/core";
import { createBaseResult } from "./result-builder.js";

export function collectResults(
  rawResults: (AgentRunResult | Error | undefined)[],
  preflights: AdapterPreflightResult[],
  outputPath: string,
  workspaceRootPath: string
): AgentRunResult[] {
  const results: AgentRunResult[] = [];
  const processedVariantIds = new Set<string>();
  for (let i = 0; i < preflights.length; i++) {
    const raw = i < rawResults.length ? rawResults[i] : undefined;
    if (raw === undefined) {
      const preflight = preflights[i];
      const fallbackPath = path.join(outputPath, "agents", preflight.variantId, "trace.jsonl");
      results.push(createBaseResult({
        preflight,
        tracePath: fallbackPath,
        workspacePath: path.join(workspaceRootPath, preflight.variantId),
        status: "cancelled",
        summary: "Cancelled due to concurrent execution abort."
      }));
      processedVariantIds.add(preflight.variantId);
    } else if (raw instanceof Error) {
      const preflight = preflights[i];
      const fallbackPath = path.join(outputPath, "agents", preflight.variantId, "trace.jsonl");
      results.push(createBaseResult({
        preflight,
        tracePath: fallbackPath,
        workspacePath: path.join(workspaceRootPath, preflight.variantId),
        status: "failed",
        summary: `Agent execution error: ${raw.message}`
      }));
      processedVariantIds.add(preflight.variantId);
    } else {
      results.push(raw);
      processedVariantIds.add(raw.variantId);
    }
  }
  for (const preflight of preflights) {
    if (!processedVariantIds.has(preflight.variantId)) {
      const fallbackPath = path.join(outputPath, "agents", preflight.variantId, "trace.jsonl");
      results.push(createBaseResult({
        preflight,
        tracePath: fallbackPath,
        workspacePath: path.join(workspaceRootPath, preflight.variantId),
        status: "failed",
        summary: "Agent was not executed due to a concurrent execution error."
      }));
    }
  }
  return results;
}
