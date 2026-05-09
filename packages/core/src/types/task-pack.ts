import type { CommandExecutionSpec, TaskJudge } from "./judge.js";

export const TASK_PACK_SCHEMA_V1 = "agentarena.taskpack/v1";

export interface TaskPackMetadata {
  source: "official" | "community";
  owner: string;
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

export type RepoSource = string;

export interface TaskPack {
  schemaVersion: typeof TASK_PACK_SCHEMA_V1;
  id: string;
  title: string;
  description?: string;
  prompt: string;
  metadata?: TaskPackMetadata;
  repoSource?: RepoSource;
  expectedChangedPaths?: string[];
  envAllowList: string[];
  setupCommands: CommandExecutionSpec[];
  judges: TaskJudge[];
  teardownCommands: CommandExecutionSpec[];
}
