import type { CommandExecutionSpec, TaskJudge } from "./judge.js";

export const TASK_PACK_SCHEMA_V1 = "agentarena.taskpack/v1";

export interface TaskPackMetadata {
  source: "official" | "community";
  owner: string;
  /** Release channel used by the built-in catalog. Unmarked historical packs are legacy. */
  lifecycle?: "core" | "legacy" | "experimental";
  difficulty?: "easy" | "medium" | "hard";
  objective?: string;
  repoTypes: string[];
  tags: string[];
  dependencies: string[];
  judgeRationale?: string;
  differentiator?: string;

  githubIssue?: {
    owner: string;
    repo: string;
    issueNumber: number;
    baseCommit: string;
    testCommit: string;
    patchPath?: string;
  };
  failToPassTests?: string[];
  passToPassTests?: string[];

  tokenBudget?: number;
  efficiencyTarget?: number;
  interactionModel?: "single-turn" | "multi-turn";
  requirementClarity?: "precise" | "fuzzy" | "ambiguous";

  taskCategories?: string[];
  antiContamination?: {
    rotationId: string;
    createdAt: string;
    expiresAt?: string;
    sourceTimestamp?: string;
  };
  difficultyEvolution?: {
    generation: number;
    predecessorTaskId?: string;
  };
}

export interface TaskChangePolicy {
  /** Require at least one real agent-authored file change. */
  requireAgentChange?: boolean;
  /** Every real changed file must match one of these patterns when provided. */
  allowedPaths?: string[];
  /** Any matching real changed file makes the task fail. */
  forbiddenPaths?: string[];
  /** Optional lower bound for the number of real changed files. */
  minChangedFiles?: number;
  /** Optional upper bound for the number of real changed files. */
  maxChangedFiles?: number;
}

export type RepoSource = "user" | `builtin://${string}`;

export interface TaskPack {
  schemaVersion: typeof TASK_PACK_SCHEMA_V1;
  id: string;
  title: string;
  description?: string;
  prompt: string;
  metadata?: TaskPackMetadata;
  repoSource?: RepoSource;
  expectedChangedPaths?: string[];
  changePolicy?: TaskChangePolicy;
  envAllowList: string[];
  setupCommands: CommandExecutionSpec[];
  judges: TaskJudge[];
  teardownCommands: CommandExecutionSpec[];
}
