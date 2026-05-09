export interface CommandExecutionSpec {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envAllowList?: string[];
  env?: Record<string, string>;
}

export interface CommandJudge extends CommandExecutionSpec {
  type: "command";
  critical?: boolean;
}

export interface TestResultJudge extends CommandExecutionSpec {
  type: "test-result";
  format?: "auto" | "jest" | "vitest";
  reportFile?: string;
  passOnNoTests?: boolean;
  critical?: boolean;
}

export interface LintCheckJudge extends CommandExecutionSpec {
  type: "lint-check";
  format?: "auto" | "eslint" | "biome";
  reportFile?: string;
  maxWarnings?: number;
  critical?: boolean;
}

export interface FileExistsJudge {
  id: string;
  label: string;
  type: "file-exists";
  path: string;
  critical?: boolean;
}

export interface FileContainsJudge {
  id: string;
  label: string;
  type: "file-contains";
  path: string;
  pattern: string;
  regex?: boolean;
  flags?: string;
  critical?: boolean;
}

export interface JsonValueJudge {
  id: string;
  label: string;
  type: "json-value";
  path: string;
  pointer: string;
  expected: unknown;
  critical?: boolean;
}

export interface GlobJudge {
  id: string;
  label: string;
  type: "glob";
  pattern: string;
  minMatches?: number;
  maxMatches?: number;
  critical?: boolean;
}

export interface FileCountJudge {
  id: string;
  label: string;
  type: "file-count";
  pattern: string;
  equals?: number;
  min?: number;
  max?: number;
  critical?: boolean;
}

export interface SnapshotJudge {
  id: string;
  label: string;
  type: "snapshot";
  path: string;
  snapshotPath: string;
  critical?: boolean;
}

export interface JsonSchemaJudge {
  id: string;
  label: string;
  type: "json-schema";
  path: string;
  schema?: Record<string, unknown>;
  schemaPath?: string;
  critical?: boolean;
}

export interface PatchValidationJudge extends CommandExecutionSpec {
  type: "patch-validation";
  testSuite: string;
  failToPassTests?: string[];
  passToPassTests?: string[];
  critical?: boolean;
}

export interface TokenEfficiencyJudge {
  id: string;
  label: string;
  type: "token-efficiency";
  tokenBudget?: number;
  critical?: boolean;
}

export interface DirectoryExistsJudge {
  id: string;
  label: string;
  type: "directory-exists";
  path: string;
  critical?: boolean;
}

export interface RegexMatchJudge {
  id: string;
  label: string;
  type: "regex-match";
  path: string;
  pattern: string;
  flags?: string;
  shouldNotMatch?: boolean;
  minMatches?: number;
  maxMatches?: number;
  critical?: boolean;
}

export interface CompilationJudge {
  id: string;
  label: string;
  type: "compilation";
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  envAllowList?: string[];
  env?: Record<string, string>;
  tool?: "auto" | "npm" | "pnpm" | "yarn" | "cargo" | "go" | "make" | "gradle" | "maven";
  buildArgs?: string[];
  critical?: boolean;
}

export type TaskJudge =
  | CommandJudge
  | TestResultJudge
  | LintCheckJudge
  | FileExistsJudge
  | FileContainsJudge
  | JsonValueJudge
  | GlobJudge
  | FileCountJudge
  | SnapshotJudge
  | JsonSchemaJudge
  | PatchValidationJudge
  | TokenEfficiencyJudge
  | DirectoryExistsJudge
  | RegexMatchJudge
  | CompilationJudge;

export interface JudgeTypeDescriptor {
  type: string;
  allowedFields: Set<string>;
  isCriticalByDefault: boolean;
}

export class JudgeTypeRegistry {
  private descriptors = new Map<string, JudgeTypeDescriptor>();

  register(descriptor: JudgeTypeDescriptor): void {
    this.descriptors.set(descriptor.type, descriptor);
  }

  get(type: string): JudgeTypeDescriptor | undefined {
    return this.descriptors.get(type);
  }

  getAllTypes(): string[] {
    return Array.from(this.descriptors.keys());
  }

  has(type: string): boolean {
    return this.descriptors.has(type);
  }
}

export const judgeTypeRegistry = new JudgeTypeRegistry();
