export interface LeaderboardEntry {
  agentId: string;
  displayLabel: string;
  totalScore: number;
  taskCount: number;
  avgTokenEfficiency: number;
  avgResolutionRate: number;
  avgDurationMs: number;
  categories: Record<string, number>;
  lastUpdated: string;
}

export interface TaskRotation {
  rotationId: string;
  createdAt: string;
  expiresAt?: string;
  taskIds: string[];
  isActive: boolean;
}

export interface Leaderboard {
  version: "agentarena.leaderboard/v1";
  updatedAt: string;
  scoreMode: string;
  entries: LeaderboardEntry[];
  rotations: TaskRotation[];
  categories: string[];
}

export interface CommunityAgentResult {
  agentId: string;
  baseAgentId: string;
  variantId: string;
  displayLabel: string;
  model: string;
  provider: string;
  version: string;
  status: "success" | "failed" | "cancelled";
  compositeScore: number;
  durationMs: number;
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  judgePassRate: number;
}

export interface CommunityRunEntry {
  schemaVersion: "agentarena.community-run/v1";
  runId: string;
  publishedAt: string;
  publishedBy: string;
  taskPackId: string;
  taskTitle: string;
  scoreMode: string;
  agentResults: CommunityAgentResult[];
}

export interface CommunityLeaderboardEntry {
  agentId: string;
  baseAgentId: string;
  displayLabel: string;
  model: string;
  provider: string;
  version: string;
  runCount: number;
  avgScore: number;
  bestScore: number;
  winRate: number;
  successRate: number;
  medianDurationMs: number;
  medianCostUsd: number | null;
  lastPublishedAt: string;
}

export interface CommunityLeaderboardIndex {
  schemaVersion: "agentarena.community-leaderboard/v1";
  taskPackId: string;
  taskTitle: string;
  updatedAt: string;
  totalRuns: number;
  entries: CommunityLeaderboardEntry[];
}
