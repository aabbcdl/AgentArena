import type { NormalizedAgentResult, NormalizedRun } from "./run.ts";
import { normalizeScoreMode } from "./score-mode.ts";

export type StrictHarnessKind = "codex" | "claude-code";
export type StrictHarnessExclusionReason =
  | "missing-job-manifest"
  | "invalid-job-manifest"
  | "manifest-not-completed"
  | "requires-two-harnesses"
  | "different-harness-required"
  | "unknown-model-identity"
  | "different-model"
  | "different-provider-policy"
  | "different-model-parameters"
  | "harness-drift"
  | "missing-result"
  | "damaged-result"
  | "different-task"
  | "different-repo-baseline"
  | "different-judge-logic"
  | "different-score-mode";

interface StrictManifestVariant {
  variantId: string;
  agentKind: StrictHarnessKind;
  profileId: string;
  canonicalModelIdentity: string;
  modelIdentitySource: string;
  providerPolicyIdentity: string;
  modelParametersIdentity: string;
  harnessDriftStatus: string;
}

interface StrictManifest {
  runId: string;
  status: string;
  taskIdentity: string;
  repositoryBaselineIdentity: string;
  judgeIdentity: string;
  scoreMode: string;
  variants: StrictManifestVariant[];
}

export interface StrictHarnessSampleResult {
  agentKind: StrictHarnessKind;
  profileId: string;
  variantId: string;
  displayLabel: string;
  result: NormalizedAgentResult;
}

export interface StrictHarnessSampleDecision {
  decision: "winner" | "tie";
  winnerAgentKind: StrictHarnessKind | null;
  reason: "qualified-status" | "composite-score" | "equal-evidence";
}

export interface StrictHarnessSample {
  run: NormalizedRun;
  taskIdentity: string;
  repositoryBaselineIdentity: string;
  judgeIdentity: string;
  scoreMode: string;
  canonicalModelIdentity: string;
  modelIdentityEvidence: "confirmed" | "declared";
  providerPolicyIdentity: string;
  modelParametersIdentity: string;
  results: [StrictHarnessSampleResult, StrictHarnessSampleResult];
  decision: StrictHarnessSampleDecision;
}

export interface PlannedHarnessIdentity {
  agentKind?: string;
  canonicalModelIdentity?: string;
  modelIdentitySource?: string;
  providerPolicyIdentity?: string;
  modelParametersIdentity?: string;
}

export interface PlannedHarnessInspection {
  eligible: boolean;
  modelIdentityEvidence: "confirmed" | "declared" | "unknown";
  reasons: StrictHarnessExclusionReason[];
}

export interface StrictHarnessInspection {
  sample: StrictHarnessSample | null;
  reasons: StrictHarnessExclusionReason[];
}

export interface StrictHarnessComparisonRow {
  agentKind: StrictHarnessKind;
  displayLabel: string;
  samples: number;
  wins: number;
  ties: number;
  successCount: number;
  averageScore: number | null;
  averageDurationMs: number | null;
  averageTokens: number | null;
  averageCostUsd: number | null;
  costKnownCount: number;
}

export interface StrictHarnessConclusion {
  scope: "no-valid-samples" | "single-run" | "repeated-samples";
  decision: "winner" | "tie" | "no-valid-samples";
  winnerAgentKind: StrictHarnessKind | null;
  stability: "not-applicable" | "consistent" | "mixed" | "inconclusive";
  sampleCount: number;
}

export interface StrictHarnessComparison {
  baseRun: NormalizedRun | null;
  samples: StrictHarnessSample[];
  excluded: Array<{ run: NormalizedRun; reasons: StrictHarnessExclusionReason[] }>;
  rows: StrictHarnessComparisonRow[];
  conclusion: StrictHarnessConclusion;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function uniqueReasons(reasons: StrictHarnessExclusionReason[]): StrictHarnessExclusionReason[] {
  return [...new Set(reasons)];
}

export function inspectPlannedHarnessComparison(
  identities: readonly PlannedHarnessIdentity[]
): PlannedHarnessInspection {
  const reasons: StrictHarnessExclusionReason[] = [];
  if (identities.length !== 2) reasons.push("requires-two-harnesses");

  if (identities.length === 2) {
    const harnesses = new Set(identities.map((identity) => requiredText(identity.agentKind)));
    if (
      harnesses.size !== 2
      || !harnesses.has("codex")
      || !harnesses.has("claude-code")
    ) {
      reasons.push("different-harness-required");
    }
  }

  const canonicalModels = identities.map((identity) => requiredText(identity.canonicalModelIdentity));
  const identitySources = identities.map((identity) => requiredText(identity.modelIdentitySource));
  const acceptedSources = identitySources.every((source) => source === "confirmed" || source === "declared");
  if (identities.length !== 2 || canonicalModels.some((identity) => !identity) || !acceptedSources) {
    reasons.push("unknown-model-identity");
  } else if (new Set(canonicalModels).size !== 1) {
    reasons.push("different-model");
  }

  const providerPolicies = identities.map((identity) => requiredText(identity.providerPolicyIdentity));
  if (
    identities.length !== 2
    || providerPolicies.some((identity) => !identity)
    || new Set(providerPolicies).size !== 1
  ) {
    reasons.push("different-provider-policy");
  }

  const modelParameters = identities.map((identity) => requiredText(identity.modelParametersIdentity));
  if (
    identities.length !== 2
    || modelParameters.some((identity) => !identity)
    || new Set(modelParameters).size !== 1
  ) {
    reasons.push("different-model-parameters");
  }

  const unique = uniqueReasons(reasons);
  return {
    eligible: unique.length === 0,
    modelIdentityEvidence: !acceptedSources
      ? "unknown"
      : identitySources.every((source) => source === "confirmed") ? "confirmed" : "declared",
    reasons: unique
  };
}

function parseManifest(run: NormalizedRun): { manifest: StrictManifest | null; reasons: StrictHarnessExclusionReason[] } {
  const rawManifest = run.raw.jobManifest;
  if (rawManifest === undefined || rawManifest === null) {
    return { manifest: null, reasons: ["missing-job-manifest"] };
  }
  const source = record(rawManifest);
  const rawVariants = source.variants;
  if (
    source.schemaVersion !== "agentarena.job-manifest/v1"
    || !requiredText(source.runId)
    || !requiredText(source.status)
    || !requiredText(source.taskIdentity)
    || !requiredText(source.repositoryBaselineIdentity)
    || !requiredText(source.judgeIdentity)
    || !requiredText(source.scoreMode)
    || !Array.isArray(rawVariants)
  ) {
    return { manifest: null, reasons: ["invalid-job-manifest"] };
  }

  const variants = rawVariants.map((value) => {
    const variant = record(value);
    const drift = record(variant.harnessDrift);
    const agentKind = variant.agentKind === "codex" || variant.agentKind === "claude-code"
      ? variant.agentKind
      : null;
    if (!agentKind) return null;
    return {
      variantId: requiredText(variant.variantId),
      agentKind,
      profileId: requiredText(variant.profileId),
      canonicalModelIdentity: requiredText(variant.canonicalModelIdentity),
      modelIdentitySource: requiredText(variant.modelIdentitySource),
      providerPolicyIdentity: requiredText(variant.providerPolicyIdentity),
      modelParametersIdentity: requiredText(variant.modelParametersIdentity),
      harnessDriftStatus: requiredText(drift.status)
    } satisfies StrictManifestVariant;
  });
  if (variants.some((variant) => variant === null)) {
    return { manifest: null, reasons: ["invalid-job-manifest"] };
  }

  return {
    manifest: {
      runId: requiredText(source.runId),
      status: requiredText(source.status),
      taskIdentity: requiredText(source.taskIdentity),
      repositoryBaselineIdentity: requiredText(source.repositoryBaselineIdentity),
      judgeIdentity: requiredText(source.judgeIdentity),
      scoreMode: normalizeScoreMode(requiredText(source.scoreMode)),
      variants: variants as StrictManifestVariant[]
    },
    reasons: []
  };
}

function isQualified(result: NormalizedAgentResult): boolean {
  return result.status === "success" && !result.scoreExcluded;
}

function decideSample(results: [StrictHarnessSampleResult, StrictHarnessSampleResult]): StrictHarnessSampleDecision {
  const [left, right] = results;
  const leftQualified = isQualified(left.result);
  const rightQualified = isQualified(right.result);
  if (leftQualified !== rightQualified) {
    return {
      decision: "winner",
      winnerAgentKind: leftQualified ? left.agentKind : right.agentKind,
      reason: "qualified-status"
    };
  }

  const leftScore = left.result.compositeScore;
  const rightScore = right.result.compositeScore;
  if (
    leftQualified
    && rightQualified
    && leftScore !== null
    && rightScore !== null
    && Math.abs(leftScore - rightScore) > Number.EPSILON
  ) {
    return {
      decision: "winner",
      winnerAgentKind: leftScore > rightScore ? left.agentKind : right.agentKind,
      reason: "composite-score"
    };
  }

  return { decision: "tie", winnerAgentKind: null, reason: "equal-evidence" };
}

export function inspectStrictHarnessSample(run: NormalizedRun): StrictHarnessInspection {
  const parsed = parseManifest(run);
  if (!parsed.manifest) return { sample: null, reasons: parsed.reasons };
  const manifest = parsed.manifest;
  const reasons: StrictHarnessExclusionReason[] = [];

  if (manifest.status !== "completed") reasons.push("manifest-not-completed");
  if (run.integrity === "damaged") reasons.push("damaged-result");
  if (manifest.variants.length !== 2) reasons.push("requires-two-harnesses");

  const identityInspection = inspectPlannedHarnessComparison(manifest.variants);
  reasons.push(...identityInspection.reasons.filter((reason) => reason !== "requires-two-harnesses"));
  if (manifest.variants.some((variant) => variant.harnessDriftStatus !== "unchanged")) {
    reasons.push("harness-drift");
  }

  const matchedResults = manifest.variants.map((variant) => {
    const result = run.results.find((entry) => entry.variantId === variant.variantId);
    return result ? {
      agentKind: variant.agentKind,
      profileId: variant.profileId,
      variantId: variant.variantId,
      displayLabel: result.displayLabel,
      result
    } satisfies StrictHarnessSampleResult : null;
  });
  if (matchedResults.some((result) => result === null)) reasons.push("missing-result");

  const exclusions = uniqueReasons(reasons);
  if (exclusions.length > 0 || matchedResults.length !== 2 || matchedResults.some((result) => result === null)) {
    return { sample: null, reasons: exclusions };
  }

  const results = matchedResults as [StrictHarnessSampleResult, StrictHarnessSampleResult];
  return {
    sample: {
      run,
      taskIdentity: manifest.taskIdentity,
      repositoryBaselineIdentity: manifest.repositoryBaselineIdentity,
      judgeIdentity: manifest.judgeIdentity,
      scoreMode: manifest.scoreMode,
      canonicalModelIdentity: manifest.variants[0].canonicalModelIdentity,
      modelIdentityEvidence: identityInspection.modelIdentityEvidence === "confirmed" ? "confirmed" : "declared",
      providerPolicyIdentity: manifest.variants[0].providerPolicyIdentity,
      modelParametersIdentity: manifest.variants[0].modelParametersIdentity,
      results,
      decision: decideSample(results)
    },
    reasons: []
  };
}

function cohortDifferences(base: StrictHarnessSample, candidate: StrictHarnessSample): StrictHarnessExclusionReason[] {
  const reasons: StrictHarnessExclusionReason[] = [];
  if (base.taskIdentity !== candidate.taskIdentity) reasons.push("different-task");
  if (base.repositoryBaselineIdentity !== candidate.repositoryBaselineIdentity) reasons.push("different-repo-baseline");
  if (base.judgeIdentity !== candidate.judgeIdentity) reasons.push("different-judge-logic");
  if (base.scoreMode !== candidate.scoreMode) reasons.push("different-score-mode");
  if (base.canonicalModelIdentity !== candidate.canonicalModelIdentity) reasons.push("different-model");
  if (base.providerPolicyIdentity !== candidate.providerPolicyIdentity) reasons.push("different-provider-policy");
  if (base.modelParametersIdentity !== candidate.modelParametersIdentity) reasons.push("different-model-parameters");
  return reasons;
}

function buildRows(samples: StrictHarnessSample[]): StrictHarnessComparisonRow[] {
  const kinds: StrictHarnessKind[] = ["codex", "claude-code"];
  return kinds.map((agentKind) => {
    const entries = samples.flatMap((sample) => {
      const result = sample.results.find((entry) => entry.agentKind === agentKind);
      return result ? [{ sample, result }] : [];
    });
    const scores = entries.flatMap(({ result }) => result.result.compositeScore === null ? [] : [result.result.compositeScore]);
    const durations = entries.flatMap(({ result }) => result.result.durationMs === null ? [] : [result.result.durationMs]);
    const tokens = entries.flatMap(({ result }) => result.result.tokenUsage === null ? [] : [result.result.tokenUsage]);
    const costs = entries.flatMap(({ result }) => result.result.costKnown && result.result.estimatedCostUsd !== null ? [result.result.estimatedCostUsd] : []);
    const average = (values: number[]): number | null => values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
    return {
      agentKind,
      displayLabel: entries[0]?.result.displayLabel ?? (agentKind === "codex" ? "Codex CLI" : "Claude Code"),
      samples: entries.length,
      wins: entries.filter(({ sample }) => sample.decision.winnerAgentKind === agentKind).length,
      ties: entries.filter(({ sample }) => sample.decision.decision === "tie").length,
      successCount: entries.filter(({ result }) => isQualified(result.result)).length,
      averageScore: average(scores),
      averageDurationMs: average(durations),
      averageTokens: average(tokens),
      averageCostUsd: average(costs),
      costKnownCount: costs.length
    };
  });
}

function buildConclusion(samples: StrictHarnessSample[], rows: StrictHarnessComparisonRow[]): StrictHarnessConclusion {
  if (samples.length === 0) {
    return { scope: "no-valid-samples", decision: "no-valid-samples", winnerAgentKind: null, stability: "not-applicable", sampleCount: 0 };
  }
  if (samples.length === 1) {
    return {
      scope: "single-run",
      decision: samples[0].decision.decision,
      winnerAgentKind: samples[0].decision.winnerAgentKind,
      stability: "not-applicable",
      sampleCount: 1
    };
  }

  const decidedWinners = samples.flatMap((sample) => sample.decision.winnerAgentKind ? [sample.decision.winnerAgentKind] : []);
  const uniqueWinners = new Set(decidedWinners);
  const stability = decidedWinners.length === samples.length && uniqueWinners.size === 1
    ? "consistent"
    : uniqueWinners.size > 1
      ? "mixed"
      : "inconclusive";
  const [codex, claude] = rows;
  const winnerAgentKind = codex.wins === claude.wins
    ? null
    : codex.wins > claude.wins ? "codex" : "claude-code";
  return {
    scope: "repeated-samples",
    decision: winnerAgentKind ? "winner" : "tie",
    winnerAgentKind,
    stability,
    sampleCount: samples.length
  };
}

export function buildStrictHarnessComparison(
  runs: NormalizedRun[],
  baseRunId?: string
): StrictHarnessComparison {
  const inspections = runs.map((run) => ({ run, ...inspectStrictHarnessSample(run) }));
  const requested = baseRunId ? inspections.find((entry) => entry.run.runId === baseRunId) : undefined;
  const baseInspection = requested ?? inspections.find((entry) => entry.sample !== null);
  const baseSample = baseInspection?.sample ?? null;

  const samples: StrictHarnessSample[] = [];
  const excluded: StrictHarnessComparison["excluded"] = [];
  for (const inspection of inspections) {
    if (!inspection.sample) {
      excluded.push({ run: inspection.run, reasons: inspection.reasons });
      continue;
    }
    if (!baseSample) {
      excluded.push({ run: inspection.run, reasons: ["invalid-job-manifest"] });
      continue;
    }
    const differences = cohortDifferences(baseSample, inspection.sample);
    if (differences.length > 0) excluded.push({ run: inspection.run, reasons: differences });
    else samples.push(inspection.sample);
  }

  samples.sort((left, right) => String(left.run.createdAt).localeCompare(String(right.run.createdAt)));
  const rows = buildRows(samples);
  return {
    baseRun: baseSample?.run ?? baseInspection?.run ?? null,
    samples,
    excluded,
    rows,
    conclusion: buildConclusion(samples, rows)
  };
}
