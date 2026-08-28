import type { CostQuality } from "./types/agent.js";

export interface CostQualityRecord {
  costQuality?: CostQuality;
  costKnown?: boolean;
  estimatedCostUsd?: number;
}

export function resolveCostQuality(value: CostQualityRecord): CostQuality {
  if (value.costQuality === "known" || value.costQuality === "estimated" || value.costQuality === "unavailable") {
    return value.costQuality;
  }
  return value.costKnown === true ? "known" : "unavailable";
}

export function isKnownCost(value: CostQualityRecord): boolean {
  return resolveCostQuality(value) === "known";
}

export function isEstimatedCost(value: CostQualityRecord): boolean {
  return resolveCostQuality(value) === "estimated";
}
