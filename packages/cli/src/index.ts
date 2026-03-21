#!/usr/bin/env node
import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteClaudeProviderProfile,
  getCodexDefaultResolvedRuntime,
  listAvailableAdapters,
  listClaudeProviderProfiles,
  preflightAdapters,
  saveClaudeProviderProfile,
  setClaudeProviderProfileSecret
} from "@repoarena/adapters";
import {
  type AdapterPreflightResult,
  type AgentSelection,
  type BenchmarkRun,
  type ClaudeProviderProfile,
  createAgentSelection,
  formatDuration
} from "@repoarena/core";
import { writeReport } from "@repoarena/report";
import { runBenchmark } from "@repoarena/runner";
import { loadTaskPack } from "@repoarena/taskpacks";
import { parse as parseYaml } from "yaml";

interface ParsedArgs {
  command?: string;
  repoPath?: string;
  taskPath?: string;
  agentIds: string[];
  codexModel?: string;
  codexReasoning?: string;
  claudeProfile?: string;
  claudeModel?: string;
  outputPath?: string;
  probeAuth: boolean;
  strict: boolean;
  updateSnapshots: boolean;
  cleanupWorkspaces: boolean;
  maxConcurrency?: number;
  json: boolean;
  templateName?: string;
  ciTemplate?: string;
  force: boolean;
  workflowPath?: string;
  ciOutputDir?: string;
  host?: string;
  port?: number;
  noOpen?: boolean;
}

interface UiRunPayload {
  repoPath: string;
  taskPath: string;
  agents?: Array<{
    baseAgentId: string;
    variantId?: string;
    displayLabel?: string;
    config?: {
      model?: string;
      reasoningEffort?: string;
      providerProfileId?: string;
    };
    configSource?: "ui" | "cli";
  }>;
  agentIds?: string[];
  outputPath?: string;
  probeAuth?: boolean;
  updateSnapshots?: boolean;
  cleanupWorkspaces?: boolean;
  maxConcurrency?: number;
}

interface UiProviderProfilePayload {
  id?: string;
  name: string;
  kind: ClaudeProviderProfile["kind"];
  homepage?: string;
  baseUrl?: string;
  apiFormat: ClaudeProviderProfile["apiFormat"];
  primaryModel?: string;
  thinkingModel?: string;
  defaultHaikuModel?: string;
  defaultSonnetModel?: string;
  defaultOpusModel?: string;
  extraEnv?: Record<string, string>;
  writeCommonConfig?: boolean;
  notes?: string;
  secret?: string;
}

type UiRunPhase = "idle" | "starting" | "preflight" | "benchmark" | "report";

interface UiRunLogEntry {
  timestamp: string;
  phase: UiRunPhase;
  message: string;
  agentId?: string;
  variantId?: string;
  displayLabel?: string;
}

interface UiRunStatus {
  state: "idle" | "running" | "done" | "error";
  phase: UiRunPhase;
  startedAt?: string;
  repoPath?: string;
  taskPath?: string;
  outputPath?: string;
  currentAgentId?: string;
  currentVariantId?: string;
  currentDisplayLabel?: string;
  logs: UiRunLogEntry[];
  updatedAt: string;
  result?: unknown;
  error?: string;
}

const CLI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(CLI_PACKAGE_ROOT, "..", "..");
const WEB_REPORT_DIST_ROOT = path.join(WORKSPACE_ROOT, "apps", "web-report", "dist");
const OFFICIAL_TASKPACK_ROOT = path.join(WORKSPACE_ROOT, "examples", "taskpacks", "official");
const DEFAULT_UI_PORT = 4320;
const MAX_REQUEST_BODY_BYTES = 1_048_576;

function createNodeEvalCommand(source: string): string {
  return `node -e ${JSON.stringify(source)}`;
}

function createPackageScriptCommand(scriptName: string): string {
  return createNodeEvalCommand(`
const { existsSync, readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const pkgPath = "package.json";
if (!existsSync(pkgPath)) {
  console.error("Missing package.json");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!pkg.scripts || !pkg.scripts[${JSON.stringify(scriptName)}]) {
  console.error(${JSON.stringify(`Missing ${scriptName} script in package.json`)});
  process.exit(1);
}
for (const [cmd, args] of [["pnpm", [${JSON.stringify(scriptName)}]], ["npm", ["run", ${JSON.stringify(scriptName)}]]]) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (!result.error) {
    process.exit(result.status ?? 1);
  }
}
console.error(${JSON.stringify(`Unable to execute ${scriptName} script with pnpm or npm`)});
process.exit(1);
`.trim());
}

function createAdhocTestCommand(reportFile: string): string {
  return createNodeEvalCommand(`
const { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const pkgPath = "package.json";
if (!existsSync(pkgPath)) {
  console.error("Missing package.json");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!pkg.scripts || !pkg.scripts.test) {
  console.error("Missing test script in package.json");
  process.exit(1);
}
const reportFileValue = ${JSON.stringify(reportFile)};
mkdirSync(dirname(reportFileValue), { recursive: true });
const candidates = [
  ["pnpm", ["test", "--", "--runInBand", "--json", "--outputFile", reportFileValue]],
  ["pnpm", ["test", "--", "--runInBand", "--reporter=json", "--outputFile", reportFileValue]],
  ["npm", ["run", "test", "--", "--runInBand", "--json", "--outputFile", reportFileValue]],
  ["npm", ["run", "test", "--", "--runInBand", "--reporter=json", "--outputFile", reportFileValue]]
];
let lastStatus = 1;
for (const [cmd, args] of candidates) {
  rmSync(reportFileValue, { force: true });
  const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.error && existsSync(reportFileValue) && statSync(reportFileValue).size > 0) {
    process.exit(result.status ?? 1);
  }
  lastStatus = result.status ?? 1;
}
writeFileSync(reportFileValue, "");
console.error("Unable to capture Jest/Vitest JSON output from the test script");
process.exit(lastStatus || 1);
`.trim());
}

function createTemplateTestCommand(reportFile: string): string {
  return createNodeEvalCommand(`
const { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const pkgPath = "package.json";
const reportFileValue = ${JSON.stringify(reportFile)};
mkdirSync(dirname(reportFileValue), { recursive: true });
if (!existsSync(pkgPath)) {
  writeFileSync(reportFileValue, JSON.stringify({ success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 }, null, 2));
  process.exit(0);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!pkg.scripts || !pkg.scripts.test) {
  writeFileSync(reportFileValue, JSON.stringify({ success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 }, null, 2));
  process.exit(0);
}
const candidates = [
  ["pnpm", ["test", "--", "--runInBand", "--json", "--outputFile", reportFileValue]],
  ["pnpm", ["test", "--", "--runInBand", "--reporter=json", "--outputFile", reportFileValue]],
  ["npm", ["run", "test", "--", "--runInBand", "--json", "--outputFile", reportFileValue]],
  ["npm", ["run", "test", "--", "--runInBand", "--reporter=json", "--outputFile", reportFileValue]]
];
let lastStatus = 1;
for (const [cmd, args] of candidates) {
  rmSync(reportFileValue, { force: true });
  const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.error && existsSync(reportFileValue) && statSync(reportFileValue).size > 0) {
    process.exit(result.status ?? 1);
  }
  lastStatus = result.status ?? 1;
}
console.error("Unable to capture Jest/Vitest JSON output from the test script");
process.exit(lastStatus || 1);
`.trim());
}

function createAdhocLintCommand(reportFile: string): string {
  return createNodeEvalCommand(`
const { existsSync, mkdirSync, statSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const reportFileValue = ${JSON.stringify(reportFile)};
mkdirSync(dirname(reportFileValue), { recursive: true });
const hasBiome = existsSync("biome.json");
const eslintConfigs = ["eslint.config.js", "eslint.config.mjs", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json"];
const hasEslint = eslintConfigs.some((file) => existsSync(file));
let candidates = [];
if (hasBiome) {
  candidates = [
    ["pnpm", ["exec", "biome", "check", ".", "--reporter=json"]],
    ["npx", ["@biomejs/biome", "check", ".", "--reporter=json"]]
  ];
} else if (hasEslint) {
  candidates = [
    ["pnpm", ["exec", "eslint", ".", "--format", "json"]],
    ["npx", ["eslint", ".", "--format", "json"]]
  ];
} else {
  console.error("Missing biome/eslint configuration for lint-check judge");
  process.exit(1);
}
let lastStatus = 1;
for (const [cmd, args] of candidates) {
  const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  if (!result.error) {
    writeFileSync(reportFileValue, result.stdout || "");
    if (result.stderr) process.stderr.write(result.stderr);
    if (statSync(reportFileValue).size > 0 || result.status === 0) {
      process.exit(result.status ?? 1);
    }
  }
  lastStatus = result.status ?? 1;
}
console.error("Unable to execute structured lint check with Biome or ESLint");
process.exit(lastStatus || 1);
`.trim());
}

function createTemplateLintCommand(reportFile: string): string {
  return createNodeEvalCommand(`
const { existsSync, mkdirSync, statSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { spawnSync } = require("node:child_process");
const reportFileValue = ${JSON.stringify(reportFile)};
mkdirSync(dirname(reportFileValue), { recursive: true });
const hasBiome = existsSync("biome.json");
const eslintConfigs = ["eslint.config.js", "eslint.config.mjs", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json"];
const hasEslint = eslintConfigs.some((file) => existsSync(file));
if (!hasBiome && !hasEslint) {
  writeFileSync(reportFileValue, JSON.stringify([], null, 2));
  process.exit(0);
}
const candidates = hasBiome
  ? [["pnpm", ["exec", "biome", "check", ".", "--reporter=json"]], ["npx", ["@biomejs/biome", "check", ".", "--reporter=json"]]]
  : [["pnpm", ["exec", "eslint", ".", "--format", "json"]], ["npx", ["eslint", ".", "--format", "json"]]];
let lastStatus = 1;
for (const [cmd, args] of candidates) {
  const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });
  if (!result.error) {
    writeFileSync(reportFileValue, result.stdout || "[]");
    if (result.stderr) process.stderr.write(result.stderr);
    if (statSync(reportFileValue).size > 0 || result.status === 0) {
      process.exit(result.status ?? 1);
    }
  }
  lastStatus = result.status ?? 1;
}
console.error("Unable to execute structured lint check with Biome or ESLint");
process.exit(lastStatus || 1);
`.trim());
}

const TASKPACK_TEMPLATES: Record<string, string> = {
  "repo-health": `schemaVersion: repoarena.taskpack/v1
id: repo-health
title: Repository Health
description: Checks that a repository stays structurally healthy after an agent task.
metadata:
  source: official
  owner: RepoArena
  objective: Validate that an agent can make a minimal repository-safe improvement.
  repoTypes:
    - node
    - generic
  tags:
    - repo-health
    - maintenance
  dependencies: []
  judgeRationale: README and package manifest presence are baseline repository health signals.
prompt: |
  Review the repository and make the smallest useful change that improves correctness,
  reliability, or maintainability. Keep changes scoped and preserve existing behavior
  unless a test or fixture shows otherwise.
expectedChangedPaths:
  - src/**/*.{js,mjs,ts,tsx}
  - packages/**/src/**/*.{js,mjs,ts,tsx}
  - lib/**/*.{js,mjs,ts,tsx}
  - README.md
envAllowList: []
judges:
  - id: readme-exists
    type: file-exists
    label: README exists
    path: README.md
  - id: package-json-exists
    type: file-exists
    label: package.json exists
    path: package.json
  - id: tests-pass
    type: test-result
    label: Tests still pass when available
    command: ${JSON.stringify(createTemplateTestCommand(".repoarena/repo-health-tests.json"))}
    format: auto
    reportFile: .repoarena/repo-health-tests.json
    passOnNoTests: true
    timeoutMs: 120000
  - id: lint-clean
    type: lint-check
    label: Lint stays clean when configured
    command: ${JSON.stringify(createTemplateLintCommand(".repoarena/repo-health-lint.json"))}
    format: auto
    reportFile: .repoarena/repo-health-lint.json
    maxWarnings: 0
    timeoutMs: 120000
`,
  "json-api": `schemaVersion: repoarena.taskpack/v1
id: json-api-contract
title: JSON API Contract
description: Validates a JSON fixture against value assertions and schema expectations.
metadata:
  source: official
  owner: RepoArena
  objective: Verify that an agent can repair a JSON contract without breaking the payload shape.
  repoTypes:
    - node
    - api
    - backend
  tags:
    - json
    - api
    - contract
  dependencies: []
  judgeRationale: JSON value and schema judges capture correctness more reliably than string matching.
prompt: |
  Update the implementation so the generated JSON output matches the expected contract
  and values described by the task pack.
expectedChangedPaths:
  - fixtures/response.json
judges:
  - id: api-schema
    type: json-schema
    label: API payload matches schema
    path: fixtures/response.json
    schemaPath: fixtures/response.schema.json
  - id: api-status
    type: json-value
    label: Status stays ready
    path: fixtures/response.json
    pointer: /status
    expected: ready
`,
  snapshot: `schemaVersion: repoarena.taskpack/v1
id: snapshot-regression
title: Snapshot Regression
description: Exercises snapshot-based regression repair workflows.
metadata:
  source: official
  owner: RepoArena
  objective: Verify that an agent can bring generated output back in sync with a stored fixture.
  repoTypes:
    - node
    - frontend
    - test
  tags:
    - snapshot
    - regression
  dependencies:
    - node
  judgeRationale: Snapshot parity is a strong proxy for fixture repair tasks when exact output matters.
prompt: |
  Update the implementation so the generated output matches the stored snapshot fixture.
expectedChangedPaths:
  - scripts/**/*.{js,mjs,ts,tsx}
  - src/**/*.{js,mjs,ts,tsx}
  - packages/**/src/**/*.{js,mjs,ts,tsx}
setupCommands:
  - id: prepare-output
    label: Prepare output fixture
    command: node scripts/generate-output.js
judges:
  - id: output-snapshot
    type: snapshot
    label: Output matches snapshot
    path: fixtures/actual.txt
    snapshotPath: fixtures/expected.txt
`
};

function normalizeCliSelections(parsed: ParsedArgs): AgentSelection[] {
  return parsed.agentIds.map((agentId) => {
    const adapter = listAvailableAdapters().find((entry) => entry.id === agentId);
    const config =
      agentId === "codex"
        ? {
            model: parsed.codexModel?.trim() || undefined,
            reasoningEffort: parsed.codexReasoning?.trim() || undefined
          }
        : agentId === "claude-code"
          ? {
              model: parsed.claudeModel?.trim() || undefined,
              providerProfileId: parsed.claudeProfile?.trim() || undefined
            }
        : {};

    return createAgentSelection({
      baseAgentId: agentId,
      displayLabel: adapter?.title ?? agentId,
      config,
      configSource:
        (agentId === "codex" && (config.model || config.reasoningEffort)) ||
        (agentId === "claude-code" && (config.model || config.providerProfileId))
          ? "cli"
          : undefined
    });
  });
}

function normalizeUiSelections(payload: UiRunPayload): AgentSelection[] {
  if (payload.agents && payload.agents.length > 0) {
    return payload.agents.map((agent) =>
      createAgentSelection({
        baseAgentId: agent.baseAgentId,
        displayLabel: agent.displayLabel,
        config: agent.config,
        configSource: agent.configSource ?? "ui"
      })
    );
  }

  return (payload.agentIds ?? []).map((agentId) =>
    createAgentSelection({
      baseAgentId: agentId,
      displayLabel: listAvailableAdapters().find((entry) => entry.id === agentId)?.title ?? agentId
    })
  );
}

function printHelp(): void {
  console.log(`RepoArena CLI - AI Agent Benchmarking Framework

Usage:
  repoarena <command> [options]

Commands:
  run              Run a benchmark against a repository
  doctor           Check adapter availability and authentication
  list-adapters    List all available adapters and their capabilities
  init-taskpack    Create a new task pack from a template
  init-ci          Create a CI workflow file for automated benchmarks
  ui               Start the web UI server

Run Command:
  repoarena run --repo <path> --task <path> --agents <list> [options]

  Required:
    --repo <path>              Path to the repository to benchmark
    --task <path>              Path to the task pack file (.json, .yaml, .yml)
    --agents <list>            Comma-separated list of agent IDs to benchmark

  Optional:
    --output <path>            Output directory for results (default: .repoarena/runs/<run-id>)
    --probe-auth               Test adapter authentication before running
    --update-snapshots         Update snapshot files if they differ
    --cleanup-workspaces       Remove agent workspace directories after run
    --max-concurrency <n>      Maximum number of agents to run in parallel (default: 1)
    --json                     Output results as JSON

  Codex Options:
    --codex-model <model>      Override the Codex model (e.g., gpt-5.4)
    --codex-reasoning <value>  Set reasoning effort (low, medium, high)

  Claude Code Options:
    --claude-profile <id>      Use a specific Claude provider profile
    --claude-model <model>     Override the Claude model

Doctor Command:
  repoarena doctor [options]

  Options:
    --agents <list>            Comma-separated list of agents to check (default: all)
    --probe-auth               Test authentication for each adapter
    --strict                   Exit with error if any adapter is not ready
    --json                     Output results as JSON

List Adapters Command:
  repoarena list-adapters [--json]

Init Taskpack Command:
  repoarena init-taskpack [options]

  Options:
    --template <name>          Template to use (repo-health, json-api, snapshot)
    --output <path>            Output file path (default: repoarena.taskpack.yaml)
    --force                    Overwrite existing file

Init CI Command:
  repoarena init-ci [options]

  Options:
    --task <path>              Path to the task pack file
    --agents <list>            Comma-separated list of agents
    --output <path>            Output workflow file path
    --ci-template <type>       Workflow template (pull-request, smoke, nightly)
    --ci-output-dir <path>     CI output directory (default: .repoarena/ci-benchmark)
    --force                    Overwrite existing file

UI Command:
  repoarena ui [options]

  Options:
    --host <host>              Server host (default: 127.0.0.1)
    --port <port>              Server port (default: 4317)
    --no-open                  Don't open browser automatically

Examples:
  # Run a basic benchmark with demo adapters
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.json --agents demo-fast,demo-thorough

  # Run with Codex and Claude Code, testing authentication
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.json --agents codex,claude-code --probe-auth

  # Run with specific Codex model and reasoning
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents codex --codex-model gpt-5.4 --codex-reasoning high

  # Run with Claude Code using a provider profile
  repoarena run --repo . --task examples/taskpacks/official/repo-health.yaml --agents claude-code --claude-profile claude-official --claude-model claude-3-7-sonnet-latest

  # Update snapshots during benchmark
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --update-snapshots

  # Output results as JSON
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --json

  # Check all adapters with authentication probe
  repoarena doctor --agents codex,claude-code,cursor --probe-auth

  # Strict doctor check (fails if any adapter not ready)
  repoarena doctor --agents codex,claude-code,cursor --probe-auth --strict

  # Create a new task pack from template
  repoarena init-taskpack --template repo-health --output my-task.yaml

  # Create a CI workflow for pull requests
  repoarena init-ci --task repoarena.taskpack.yaml --agents demo-fast,codex

  # Create a nightly CI workflow
  repoarena init-ci --ci-template nightly --task examples/taskpacks/official/repo-health.yaml --agents demo-fast

  # Start the web UI
  repoarena ui --host 127.0.0.1 --port 4317

For more information, visit: https://github.com/aabbcdl/RepoArena
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    agentIds: [],
    probeAuth: false,
    strict: false,
    updateSnapshots: false,
    cleanupWorkspaces: false,
    json: false,
    force: false
  };

  const args = [...argv];
  parsed.command = args.shift();

  while (args.length > 0) {
    const token = args.shift();

    if (!token) {
      continue;
    }

    switch (token) {
      case "--repo":
        parsed.repoPath = args.shift();
        if (!parsed.repoPath) {
          throw new Error("--repo requires a path argument. Example: --repo . or --repo /path/to/repo");
        }
        break;
      case "--task":
        parsed.taskPath = args.shift();
        if (!parsed.taskPath) {
          throw new Error("--task requires a path argument. Example: --task taskpack.yaml");
        }
        break;
      case "--agents": {
        const agentsValue = args.shift();
        if (!agentsValue) {
          throw new Error("--agents requires a comma-separated list. Example: --agents demo-fast,codex");
        }
        parsed.agentIds = agentsValue
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        if (parsed.agentIds.length === 0) {
          throw new Error("--agents list cannot be empty. Example: --agents demo-fast,codex");
        }
        break;
      }
      case "--output":
        parsed.outputPath = args.shift();
        if (!parsed.outputPath) {
          throw new Error("--output requires a path argument. Example: --output ./results");
        }
        break;
      case "--codex-model":
        parsed.codexModel = args.shift();
        if (!parsed.codexModel) {
          throw new Error("--codex-model requires a model name. Example: --codex-model gpt-5.4");
        }
        break;
      case "--codex-reasoning": {
        parsed.codexReasoning = args.shift();
        if (!parsed.codexReasoning) {
          throw new Error("--codex-reasoning requires a value. Example: --codex-reasoning high");
        }
        const validReasoning = ["low", "medium", "high"];
        if (!validReasoning.includes(parsed.codexReasoning.toLowerCase())) {
          throw new Error(`--codex-reasoning must be one of: ${validReasoning.join(", ")}. Got: ${parsed.codexReasoning}`);
        }
        break;
      }
      case "--claude-profile":
        parsed.claudeProfile = args.shift();
        if (!parsed.claudeProfile) {
          throw new Error("--claude-profile requires a profile ID. Example: --claude-profile claude-official");
        }
        break;
      case "--claude-model":
        parsed.claudeModel = args.shift();
        if (!parsed.claudeModel) {
          throw new Error("--claude-model requires a model name. Example: --claude-model claude-3-7-sonnet-latest");
        }
        break;
      case "--probe-auth":
        parsed.probeAuth = true;
        break;
      case "--strict":
        parsed.strict = true;
        break;
      case "--update-snapshots":
        parsed.updateSnapshots = true;
        break;
      case "--cleanup-workspaces":
        parsed.cleanupWorkspaces = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--template":
        parsed.templateName = args.shift();
        if (!parsed.templateName) {
          throw new Error("--template requires a template name. Available: repo-health, json-api, snapshot");
        }
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--ci-template": {
        parsed.ciTemplate = args.shift();
        if (!parsed.ciTemplate) {
          throw new Error("--ci-template requires a template type. Available: pull-request, smoke, nightly");
        }
        const validTemplates = ["pull-request", "smoke", "nightly"];
        if (!validTemplates.includes(parsed.ciTemplate)) {
          throw new Error(`--ci-template must be one of: ${validTemplates.join(", ")}. Got: ${parsed.ciTemplate}`);
        }
        break;
      }
      case "--ci-output-dir":
        parsed.ciOutputDir = args.shift();
        if (!parsed.ciOutputDir) {
          throw new Error("--ci-output-dir requires a path argument. Example: --ci-output-dir .repoarena/ci");
        }
        break;
      case "--workflow":
        parsed.workflowPath = args.shift();
        if (!parsed.workflowPath) {
          throw new Error("--workflow requires a path argument. Example: --workflow .github/workflows/benchmark.yml");
        }
        break;
      case "--host":
        parsed.host = args.shift();
        if (!parsed.host) {
          throw new Error("--host requires a hostname. Example: --host 127.0.0.1");
        }
        break;
      case "--port": {
        const portValue = args.shift();
        if (!portValue) {
          throw new Error("--port requires a port number. Example: --port 4317");
        }
        const value = Number.parseInt(portValue, 10);
        if (!Number.isInteger(value) || value <= 0 || value > 65535) {
          throw new Error(`--port must be a valid port number (1-65535). Got: ${portValue}`);
        }
        parsed.port = value;
        break;
      }
      case "--no-open":
        parsed.noOpen = true;
        break;
      case "--max-concurrency": {
        const concurrencyValue = args.shift();
        if (!concurrencyValue) {
          throw new Error("--max-concurrency requires a number. Example: --max-concurrency 4");
        }
        const value = Number.parseInt(concurrencyValue, 10);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`--max-concurrency must be a positive integer. Got: ${concurrencyValue}`);
        }
        parsed.maxConcurrency = value;
        break;
      }
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break; // eslint-disable-line no-fallthrough
      default:
        throw new Error(
          `Unknown argument: ${token}\n` +
          `Run "repoarena --help" for usage information.`
        );
    }
  }

  return parsed;
}

function formatCapabilitySummary(capability: AdapterPreflightResult["capability"]): string {
  return [
    `tier=${capability.supportTier}`,
    `tokens=${capability.tokenAvailability}`,
    `cost=${capability.costAvailability}`,
    `trace=${capability.traceRichness}`
  ].join(" | ");
}

async function runDoctor(parsed: ParsedArgs): Promise<void> {
  const selections =
    parsed.agentIds.length > 0
      ? normalizeCliSelections(parsed)
      : listAvailableAdapters()
          .map((adapter) =>
            createAgentSelection({
              baseAgentId: adapter.id,
              displayLabel: adapter.title
            })
          )
          .sort((left, right) => left.baseAgentId.localeCompare(right.baseAgentId));

  const preflights = await preflightAdapters(selections, { probeAuth: parsed.probeAuth });
  if (parsed.json) {
    console.log(JSON.stringify(preflights, null, 2));
  } else {
    console.log("\nRepoArena doctor\n");
    for (const preflight of preflights) {
      console.log(
        [
          `- ${preflight.agentId}`,
          `tier=${preflight.capability.supportTier}`,
          `status=${preflight.status}`,
          preflight.command ? `command=${preflight.command}` : "",
          `summary=${preflight.summary}`
        ]
          .filter(Boolean)
          .join(" | ")
      );
      for (const detail of preflight.details ?? []) {
        console.log(`  detail: ${detail}`);
      }
      console.log(`  capability: ${formatCapabilitySummary(preflight.capability)}`);
      console.log(`  invocation: ${preflight.capability.invocationMethod}`);
      if (preflight.capability.authPrerequisites.length > 0) {
        console.log(`  auth: ${preflight.capability.authPrerequisites.join("; ")}`);
      }
      for (const limitation of preflight.capability.knownLimitations) {
        console.log(`  limitation: ${limitation}`);
      }
    }
  }

  if (parsed.strict && preflights.some((preflight) => preflight.status !== "ready")) {
    process.exitCode = 1;
  }
}

async function runListAdapters(parsed: ParsedArgs): Promise<void> {
  const adapters = listAvailableAdapters()
    .map((adapter) => ({
      id: adapter.id,
      title: adapter.title,
      kind: adapter.kind,
      capability: adapter.capability
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (parsed.json) {
    console.log(JSON.stringify(adapters, null, 2));
    return;
  }

  console.log("\nRepoArena adapters\n");
  for (const adapter of adapters) {
    console.log(
      `- ${adapter.id} | kind=${adapter.kind} | title=${adapter.title} | ${formatCapabilitySummary(adapter.capability)}`
    );
    console.log(`  invocation: ${adapter.capability.invocationMethod}`);
    if (adapter.capability.authPrerequisites.length > 0) {
      console.log(`  auth: ${adapter.capability.authPrerequisites.join("; ")}`);
    }
    for (const limitation of adapter.capability.knownLimitations) {
      console.log(`  limitation: ${limitation}`);
    }
  }
}

async function runInitTaskpack(parsed: ParsedArgs): Promise<void> {
  const templateName = parsed.templateName ?? "repo-health";
  const template = TASKPACK_TEMPLATES[templateName];
  if (!template) {
    throw new Error(
      `Unknown task pack template "${templateName}". Available templates: ${Object.keys(TASKPACK_TEMPLATES).join(", ")}`
    );
  }

  const outputPath = path.resolve(parsed.outputPath ?? "repoarena.taskpack.yaml");
  const parentPath = path.dirname(outputPath);

  try {
    await fs.access(outputPath);
    if (!parsed.force) {
      throw new Error(`Refusing to overwrite existing file: ${outputPath}. Use --force to replace it.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(parentPath, { recursive: true });
  await fs.writeFile(outputPath, template, "utf8");

  if (parsed.json) {
    console.log(JSON.stringify({ template: templateName, outputPath }, null, 2));
    return;
  }

  console.log(`\nRepoArena task pack created`);
  console.log(`template=${templateName}`);
  console.log(`path=${outputPath}`);
}

function buildCiWorkflow(options: {
  taskPath: string;
  agentIds: string[];
  template: "pull-request" | "smoke" | "nightly";
  outputDir: string;
}): string {
  const { taskPath, agentIds, template, outputDir } = options;
  const normalizedTaskPath = taskPath.replaceAll("\\", "/");
  const normalizedAgents = agentIds.join(",");
  const normalizedOutputDir = outputDir.replaceAll("\\", "/");
  const workflowName =
    template === "nightly"
      ? "RepoArena Nightly Benchmark"
      : template === "smoke"
        ? "RepoArena Smoke Benchmark"
        : "RepoArena Benchmark";
  const permissionsBlock =
    template === "pull-request"
      ? `permissions:
  contents: read
  pull-requests: write`
      : `permissions:
  contents: read`;
  const onBlock =
    template === "nightly"
      ? `on:
  workflow_dispatch:
  schedule:
    - cron: "0 1 * * *"`
      : template === "smoke"
        ? `on:
  workflow_dispatch:
  push:
    branches:
      - main`
        : `on:
  pull_request:
  workflow_dispatch:`;
  const doctorCommand =
    template === "nightly"
      ? `node packages/cli/dist/index.js doctor --agents ${normalizedAgents} --probe-auth --strict --json > ${normalizedOutputDir}/doctor.json`
      : `node packages/cli/dist/index.js doctor --agents ${normalizedAgents} --probe-auth --json > ${normalizedOutputDir}/doctor.json`;
  const publishSummaryStep =
    template === "pull-request"
      ? `      - name: Publish benchmark summary
        run: cat ${normalizedOutputDir}/pr-comment.md >> "$GITHUB_STEP_SUMMARY"

      - name: Comment benchmark summary on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require("node:fs");
            const marker = "<!-- repoarena-benchmark-summary -->";
            const body = \`\${marker}\\n\${fs.readFileSync("${normalizedOutputDir}/pr-comment.md", "utf8")}\`;
            const issue_number = context.payload.pull_request.number;
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number
            });
            const existing = comments.find((comment) => comment.body && comment.body.includes(marker));

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number,
                body
              });
            }`
      : `      - name: Publish benchmark summary
        run: cat ${normalizedOutputDir}/summary.md >> "$GITHUB_STEP_SUMMARY"`;

  return `name: ${workflowName}

${permissionsBlock}

${onBlock}

jobs:
  benchmark:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.6.1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build workspace
        run: pnpm build

      - name: Prepare RepoArena output directories
        run: mkdir -p ${normalizedOutputDir}

      - name: Doctor adapters
        run: ${doctorCommand}

      - name: Run benchmark
        run: node packages/cli/dist/index.js run --repo . --task ${normalizedTaskPath} --agents ${normalizedAgents} --output ${normalizedOutputDir} --json > ${normalizedOutputDir}/run.json

${publishSummaryStep}

      - name: Upload benchmark artifacts
        uses: actions/upload-artifact@v4
        with:
          name: repoarena-benchmark
          path: |
            ${normalizedOutputDir}/doctor.json
            ${normalizedOutputDir}/run.json
            ${normalizedOutputDir}/summary.json
            ${normalizedOutputDir}/summary.md
            ${normalizedOutputDir}/pr-comment.md
            ${normalizedOutputDir}/report.html
            ${normalizedOutputDir}/badge.json
`;
}

async function runInitCi(parsed: ParsedArgs): Promise<void> {
  const workflowPath = path.resolve(parsed.workflowPath ?? parsed.outputPath ?? ".github/workflows/repoarena-benchmark.yml");
  const taskPath = parsed.taskPath ?? "repoarena.taskpack.yaml";
  const agentIds = parsed.agentIds.length > 0 ? parsed.agentIds : ["demo-fast"];
  const ciTemplate = (parsed.ciTemplate ?? "pull-request") as "pull-request" | "smoke" | "nightly";
  if (!["pull-request", "smoke", "nightly"].includes(ciTemplate)) {
    throw new Error('Unknown CI template. Use "pull-request", "smoke", or "nightly".');
  }
  const ciOutputDir = parsed.ciOutputDir ?? ".repoarena/ci-benchmark";
  const parentPath = path.dirname(workflowPath);

  try {
    await fs.access(workflowPath);
    if (!parsed.force) {
      throw new Error(`Refusing to overwrite existing file: ${workflowPath}. Use --force to replace it.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(parentPath, { recursive: true });
  await fs.writeFile(
    workflowPath,
    buildCiWorkflow({ taskPath, agentIds, template: ciTemplate, outputDir: ciOutputDir }),
    "utf8"
  );

  if (parsed.json) {
    console.log(JSON.stringify({ workflowPath, taskPath, agentIds, ciTemplate, ciOutputDir }, null, 2));
    return;
  }

  console.log(`\nRepoArena CI workflow created`);
  console.log(`path=${workflowPath}`);
  console.log(`task=${taskPath}`);
  console.log(`agents=${agentIds.join(",")}`);
  console.log(`template=${ciTemplate}`);
  console.log(`output=${ciOutputDir}`);
}

function jsonResponse(data: unknown, statusCode = 200): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body: JSON.stringify(data, null, 2),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  };
}

function textResponse(
  body: string,
  statusCode = 200,
  contentType = "text/plain; charset=utf-8"
): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode,
    body,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    }
  };
}

function createHttpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw createHttpError("Request body too large.", 413);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function listOfficialTaskPacks(): Promise<
  Array<{
    id: string;
    title: string;
    description?: string;
    path: string;
    source: string;
    objective?: string;
    judgeRationale?: string;
    repoTypes: string[];
    tags: string[];
    prompt: string;
    judges: Array<{ id: string; type: string; label: string }>;
    difficulty?: string;
    differentiator?: string;
  }>
> {
  try {
    const entries = await fs.readdir(OFFICIAL_TASKPACK_ROOT, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && [".yaml", ".yml", ".json"].includes(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(OFFICIAL_TASKPACK_ROOT, entry.name))
      .sort();

    const taskPacks = await Promise.all(
      files.map(async (filePath) => {
        const taskPack = await loadTaskPack(filePath);
        return {
          id: taskPack.id,
          title: taskPack.title,
          description: taskPack.description,
          path: filePath,
          source: taskPack.metadata?.source ?? "official",
          objective: taskPack.metadata?.objective,
          judgeRationale: taskPack.metadata?.judgeRationale,
          repoTypes: taskPack.metadata?.repoTypes ?? [],
          tags: taskPack.metadata?.tags ?? [],
          prompt: taskPack.prompt,
          judges: taskPack.judges.map((j) => ({ id: j.id, type: j.type, label: j.label })),
          difficulty: taskPack.metadata?.difficulty,
          differentiator: taskPack.metadata?.differentiator,
          i18n: await (async () => {
            try {
              const raw = await fs.readFile(filePath, "utf8");
              const parsed = (filePath.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw)) as any;
              return parsed?.metadata?.i18n ?? undefined;
            } catch { return undefined; }
          })()
        };
      })
    );

    const difficultyOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
    taskPacks.sort((a, b) => (difficultyOrder[a.difficulty ?? ""] ?? 9) - (difficultyOrder[b.difficulty ?? ""] ?? 9));

    return taskPacks;
  } catch {
    return [];
  }
}

function detectContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function maybeOpenBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  await new Promise<void>((resolve) => {
    exec(command, { shell: platform === "win32" ? "cmd.exe" : process.env.SHELL ?? "/bin/sh" }, () =>
      resolve()
    );
  });
}

async function runUi(parsed: ParsedArgs): Promise<void> {
  const host = parsed.host ?? "127.0.0.1";
  const port = parsed.port ?? DEFAULT_UI_PORT;
  let activeRun: Promise<unknown> | null = null;
  const codexDefaults = await getCodexDefaultResolvedRuntime();
  let activeRunStatus: UiRunStatus = {
    state: "idle",
    phase: "idle",
    logs: [],
    updatedAt: new Date().toISOString()
  };

  const setRunStatus = (status: Partial<UiRunStatus>): void => {
    activeRunStatus = {
      ...activeRunStatus,
      ...status,
      updatedAt: new Date().toISOString()
    };
  };

  const appendRunLog = (entry: Omit<UiRunLogEntry, "timestamp">): void => {
    const nextEntry: UiRunLogEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };
    activeRunStatus = {
      ...activeRunStatus,
      logs: [...activeRunStatus.logs, nextEntry].slice(-30),
      updatedAt: nextEntry.timestamp
    };
  };

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

      if (request.method === "GET" && requestUrl.pathname === "/api/ui-info") {
        const providerProfiles = await listClaudeProviderProfiles();
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(
          JSON.stringify(
            {
              mode: "local-service",
              repoPath: process.cwd(),
              defaultTaskPath: path.join(OFFICIAL_TASKPACK_ROOT, "repo-health.yaml"),
              defaultOutputPath: path.join(process.cwd(), ".repoarena", "ui-runs"),
              codexDefaults,
              claudeProviderProfiles: providerProfiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
                kind: profile.kind,
                apiFormat: profile.apiFormat,
                primaryModel: profile.primaryModel,
                secretStored: profile.secretStored,
                isBuiltIn: profile.isBuiltIn
              })),
              riskNotice:
                "Provider-switched Claude Code variants use compatibility settings and may behave differently from official Claude Code.",
              host,
              port
            },
            null,
            2
          )
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/adapters") {
        const adapters = listAvailableAdapters().map((adapter) => ({
          id: adapter.id,
          title: adapter.title,
          kind: adapter.kind,
          capability: adapter.capability
        }));
        const payload = jsonResponse(adapters);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/provider-profiles") {
        const profiles = await listClaudeProviderProfiles();
        const payload = jsonResponse(profiles);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/provider-profiles") {
        const rawBody = await readRequestBody(request);
        let payload: UiProviderProfilePayload;
        try {
          payload = JSON.parse(rawBody) as UiProviderProfilePayload;
        } catch {
          const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        const profile = await saveClaudeProviderProfile(payload);
        if (payload.secret?.trim()) {
          await setClaudeProviderProfileSecret(profile.id, payload.secret);
        }
        const profiles = await listClaudeProviderProfiles();
        const responsePayload = jsonResponse({
          profile: profiles.find((entry) => entry.id === profile.id),
          profiles
        });
        response.writeHead(responsePayload.statusCode, responsePayload.headers);
        response.end(responsePayload.body);
        return;
      }

      const providerProfileMatch = requestUrl.pathname.match(/^\/api\/provider-profiles\/([^/]+)(?:\/(secret))?$/);
      if (providerProfileMatch) {
        const profileId = decodeURIComponent(providerProfileMatch[1]);
        const action = providerProfileMatch[2];

        if (request.method === "PUT" && !action) {
          const rawBody = await readRequestBody(request);
          let payload: UiProviderProfilePayload;
          try {
            payload = JSON.parse(rawBody) as UiProviderProfilePayload;
          } catch {
            const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
            response.writeHead(invalid.statusCode, invalid.headers);
            response.end(invalid.body);
            return;
          }
          const profile = await saveClaudeProviderProfile({
            ...payload,
            id: profileId
          });
          const profiles = await listClaudeProviderProfiles();
          const responsePayload = jsonResponse({
            profile: profiles.find((entry) => entry.id === profile.id),
            profiles
          });
          response.writeHead(responsePayload.statusCode, responsePayload.headers);
          response.end(responsePayload.body);
          return;
        }

        if (request.method === "DELETE" && !action) {
          await deleteClaudeProviderProfile(profileId);
          const profiles = await listClaudeProviderProfiles();
          const responsePayload = jsonResponse({ profiles });
          response.writeHead(responsePayload.statusCode, responsePayload.headers);
          response.end(responsePayload.body);
          return;
        }

        if (request.method === "POST" && action === "secret") {
          const rawBody = await readRequestBody(request);
          let payload: { secret?: string };
          try {
            payload = JSON.parse(rawBody) as { secret?: string };
          } catch {
            const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
            response.writeHead(invalid.statusCode, invalid.headers);
            response.end(invalid.body);
            return;
          }
          await setClaudeProviderProfileSecret(profileId, payload.secret ?? "");
          const profiles = await listClaudeProviderProfiles();
          const responsePayload = jsonResponse({
            profile: profiles.find((entry) => entry.id === profileId),
            profiles
          });
          response.writeHead(responsePayload.statusCode, responsePayload.headers);
          response.end(responsePayload.body);
          return;
        }
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/create-adhoc-taskpack") {
        const rawBody = await readRequestBody(request);
        let body: { prompt: string; title?: string };
        try {
          body = JSON.parse(rawBody) as { prompt: string; title?: string };
        } catch {
          const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        if (!body.prompt?.trim()) {
          const invalid = jsonResponse({ error: "prompt is required." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        const adhocDir = path.join(process.cwd(), ".repoarena", "adhoc-taskpacks");
        await fs.mkdir(adhocDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const adhocTitle = body.title?.trim() || `Adhoc Task ${timestamp}`;
        const adhocId = `adhoc-${timestamp}`;
        const buildCommand = createPackageScriptCommand("build");
        const testReportFile = `.repoarena/${adhocId}-test-results.json`;
        const lintReportFile = `.repoarena/${adhocId}-lint-results.json`;
        const testCommand = createAdhocTestCommand(testReportFile);
        const lintCommand = createAdhocLintCommand(lintReportFile);
        const yamlContent = `schemaVersion: repoarena.taskpack/v1
id: ${adhocId}
title: "${adhocTitle.replace(/"/g, '\\"')}"
description: User-defined ad-hoc task from the web UI.
metadata:
  source: community
  owner: user
  difficulty: medium
  objective: Execute the user-provided prompt and verify the result.
  repoTypes:
    - generic
  tags:
    - adhoc
    - custom
  dependencies: []
  judgeRationale: Basic structural checks ensure the agent did not break the repository.
prompt: |
${body.prompt.split("\n").map((line: string) => `  ${line}`).join("\n")}
judges:
  - id: repo-not-broken
    type: file-exists
    label: Package manifest still exists
    path: package.json
  - id: readme-exists
    type: file-exists
    label: README still exists
    path: README.md
  - id: build-passes
    type: command
    label: Project still builds
    command: ${JSON.stringify(buildCommand)}
    timeoutMs: 120000
  - id: tests-pass
    type: test-result
    label: Tests still pass with structured results
    command: ${JSON.stringify(testCommand)}
    format: auto
    reportFile: ${JSON.stringify(testReportFile)}
    timeoutMs: 120000
  - id: lint-clean
    type: lint-check
    label: Lint stays clean
    command: ${JSON.stringify(lintCommand)}
    format: auto
    reportFile: ${JSON.stringify(lintReportFile)}
    maxWarnings: 0
    timeoutMs: 120000
`;
        const adhocPath = path.join(adhocDir, `${adhocId}.yaml`);
        await fs.writeFile(adhocPath, yamlContent, "utf8");
        const payload = jsonResponse({ path: adhocPath, id: adhocId, title: adhocTitle });
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/adhoc-taskpacks") {
        const adhocDir = path.join(process.cwd(), ".repoarena", "adhoc-taskpacks");
        try {
          const entries = await fs.readdir(adhocDir, { withFileTypes: true });
          const items = await Promise.all(
            entries
              .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
              .sort((a, b) => b.name.localeCompare(a.name))
              .map(async (e) => {
                const filePath = path.join(adhocDir, e.name);
                const stat = await fs.stat(filePath);
                const raw = await fs.readFile(filePath, "utf8");
                const parsed = parseYaml(raw) as any;
                return {
                  id: parsed?.id ?? e.name,
                  title: parsed?.title ?? e.name,
                  path: filePath,
                  createdAt: stat.birthtime.toISOString(),
                  promptPreview: String(parsed?.prompt ?? "").slice(0, 200)
                };
              })
          );
          const payload = jsonResponse(items);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        } catch {
          const payload = jsonResponse([]);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        }
        return;
      }

      if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/adhoc-taskpacks/")) {
        const adhocId = decodeURIComponent(requestUrl.pathname.slice("/api/adhoc-taskpacks/".length));
        const adhocDir = path.join(process.cwd(), ".repoarena", "adhoc-taskpacks");
        const filePath = path.join(adhocDir, `${adhocId}.yaml`);
        try {
          await fs.unlink(filePath);
          const payload = jsonResponse({ deleted: true, id: adhocId });
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        } catch {
          const payload = jsonResponse({ error: "Adhoc taskpack not found." }, 404);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/taskpacks") {
        const taskPacks = await listOfficialTaskPacks();
        const payload = jsonResponse(taskPacks);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/run-status") {
        const payload = jsonResponse(activeRunStatus);
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/run") {
        if (activeRun) {
          const payload = jsonResponse({ error: "A benchmark run is already in progress." }, 409);
          response.writeHead(payload.statusCode, payload.headers);
          response.end(payload.body);
          return;
        }

        const rawBody = await readRequestBody(request);
        let runPayload: UiRunPayload;
        try {
          runPayload = JSON.parse(rawBody) as UiRunPayload;
        } catch {
          const invalid = jsonResponse({ error: "Invalid JSON in request body." }, 400);
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }
        const selections = normalizeUiSelections(runPayload);
        if (!runPayload.repoPath || !runPayload.taskPath || selections.length === 0) {
          const invalid = jsonResponse(
            { error: "repoPath, taskPath, and at least one agent selection are required." },
            400
          );
          response.writeHead(invalid.statusCode, invalid.headers);
          response.end(invalid.body);
          return;
        }

        setRunStatus({
          state: "running",
          phase: "starting",
          startedAt: new Date().toISOString(),
          repoPath: runPayload.repoPath,
          taskPath: runPayload.taskPath,
          outputPath: runPayload.outputPath
        });
        appendRunLog({
          phase: "starting",
          message: `Starting benchmark for ${selections.length} selection(s).`
        });

        activeRun = (async () => {
          try {
            // Do NOT pass outputPath from the UI payload directly.
            // The runner generates a unique runId and creates a per-run
            // subdirectory under .repoarena/runs/{runId} automatically.
            // Passing a flat outputPath (e.g. .repoarena/ui-runs) caused
            // summary.json to be overwritten and trace.jsonl to accumulate
            // across runs, making later failed runs hide earlier successes.
            const benchmark = await runBenchmark({
              repoPath: runPayload.repoPath,
              taskPath: runPayload.taskPath,
              agentIds: selections.map((selection) => selection.baseAgentId),
              agents: selections,
              probeAuth: runPayload.probeAuth,
              updateSnapshots: runPayload.updateSnapshots,
              cleanupWorkspaces: runPayload.cleanupWorkspaces,
              maxConcurrency: runPayload.maxConcurrency,
              onProgress: (event) => {
                const phase =
                  event.phase === "starting" || event.phase === "preflight"
                    ? event.phase
                    : event.phase === "report"
                      ? "report"
                      : "benchmark";
                setRunStatus({
                  phase,
                  currentAgentId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.agentId
                      : activeRunStatus.currentAgentId,
                  currentVariantId:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.variantId
                      : activeRunStatus.currentVariantId,
                  currentDisplayLabel:
                    event.phase === "agent-start" || event.phase === "agent-finish"
                      ? event.displayLabel
                      : activeRunStatus.currentDisplayLabel
                });
                appendRunLog({
                  phase,
                  message: event.message,
                  agentId: event.agentId,
                  variantId: event.variantId,
                  displayLabel: event.displayLabel
                });
              }
            });
            setRunStatus({
              phase: "report",
              currentAgentId: undefined,
              currentVariantId: undefined,
              currentDisplayLabel: undefined
            });
            appendRunLog({
              phase: "report",
              message: "Writing report artifacts."
            });
            const report = await writeReport(benchmark);
            appendRunLog({
              phase: "report",
              message: "Report artifacts are ready."
            });
            const run = JSON.parse(await fs.readFile(report.jsonPath, "utf8"));
            const markdown = await fs.readFile(report.markdownPath, "utf8");
            setRunStatus({
              state: "done",
              phase: "idle",
              result: { run, markdown, report }
            });
          } catch (runError) {
            const errorMessage = runError instanceof Error ? runError.message : String(runError);
            appendRunLog({
              phase: activeRunStatus.phase,
              message: `Run failed: ${errorMessage}`
            });
            setRunStatus({
              state: "error",
              error: errorMessage
            });
          } finally {
            activeRun = null;
          }
        })();

        const accepted = jsonResponse({ accepted: true }, 202);
        response.writeHead(accepted.statusCode, accepted.headers);
        response.end(accepted.body);
        return;
      }

      if (request.method === "GET") {
        let filePath = requestUrl.pathname === "/" ? path.join(WEB_REPORT_DIST_ROOT, "index.html") : path.join(WEB_REPORT_DIST_ROOT, requestUrl.pathname.replace(/^\/+/, ""));
        filePath = path.normalize(filePath);
        if (!filePath.startsWith(WEB_REPORT_DIST_ROOT)) {
          const forbidden = textResponse("Forbidden", 403);
          response.writeHead(forbidden.statusCode, forbidden.headers);
          response.end(forbidden.body);
          return;
        }

        try {
          const body = await fs.readFile(filePath);
          response.writeHead(200, {
            "Content-Type": detectContentType(filePath),
            "Cache-Control": "no-store"
          });
          response.end(body);
          return;
        } catch {
          const notFound = textResponse("Not Found", 404);
          response.writeHead(notFound.statusCode, notFound.headers);
          response.end(notFound.body);
          return;
        }
      }

      const methodNotAllowed = textResponse("Method Not Allowed", 405);
      response.writeHead(methodNotAllowed.statusCode, methodNotAllowed.headers);
      response.end(methodNotAllowed.body);
    } catch (error) {
      const statusCode =
        typeof (error as { statusCode?: unknown })?.statusCode === "number"
          ? ((error as { statusCode: number }).statusCode ?? 500)
          : 500;
      const payload = jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        statusCode
      );
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const url = `http://${host}:${port}`;
  console.log(`\nRepoArena UI server running`);
  console.log(`url=${url}`);
  console.log(`repo=${process.cwd()}`);

  if (!parsed.noOpen) {
    await maybeOpenBrowser(url);
  }

  await new Promise<void>((resolve) => {
    const closeServer = () => {
      server.close(() => resolve());
    };

    process.once("SIGINT", closeServer);
    process.once("SIGTERM", closeServer);
  });
}

async function runBenchmarkCommand(parsed: ParsedArgs): Promise<void> {
  if (!parsed.repoPath) {
    throw new Error(
      "Missing required argument: --repo\n" +
      "Example: repoarena run --repo . --task taskpack.yaml --agents demo-fast\n" +
      'Run "repoarena --help" for more information.'
    );
  }

  if (!parsed.taskPath) {
    throw new Error(
      "Missing required argument: --task\n" +
      "Example: repoarena run --repo . --task taskpack.yaml --agents demo-fast\n" +
      'Run "repoarena --help" for more information.'
    );
  }

  if (parsed.agentIds.length === 0) {
    throw new Error(
      "Missing required argument: --agents\n" +
      "Example: repoarena run --repo . --task taskpack.yaml --agents demo-fast,codex\n" +
      'Run "repoarena --help" for more information.'
    );
  }

  // Validate repo path exists
  try {
    const repoStat = await fs.stat(parsed.repoPath);
    if (!repoStat.isDirectory()) {
      throw new Error(`--repo path is not a directory: ${parsed.repoPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`--repo path does not exist: ${parsed.repoPath}`);
    }
    throw error;
  }

  // Validate task path exists
  try {
    await fs.access(parsed.taskPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`--task file does not exist: ${parsed.taskPath}`);
    }
    throw error;
  }

  // Validate agent IDs
  const availableAdapters = listAvailableAdapters();
  const availableIds = availableAdapters.map((a) => a.id);
  const invalidAgents = parsed.agentIds.filter((id) => !availableIds.includes(id));
  if (invalidAgents.length > 0) {
    throw new Error(
      `Unknown agent(s): ${invalidAgents.join(", ")}\n` +
      `Available agents: ${availableIds.join(", ")}\n` +
      'Run "repoarena list-adapters" for more information.'
    );
  }

  const selections = normalizeCliSelections(parsed);

  if (!parsed.json) {
    console.log(`\nStarting RepoArena benchmark...`);
    console.log(`Repository: ${parsed.repoPath}`);
    console.log(`Task: ${parsed.taskPath}`);
    console.log(`Agents: ${parsed.agentIds.join(", ")}`);
    if (parsed.probeAuth) {
      console.log(`Authentication probe: enabled`);
    }
    console.log("");
  }

  const benchmark = await runBenchmark({
    repoPath: parsed.repoPath,
    taskPath: parsed.taskPath,
    agentIds: selections.map((selection) => selection.baseAgentId),
    agents: selections,
    outputPath: parsed.outputPath ? path.resolve(parsed.outputPath) : undefined,
    probeAuth: parsed.probeAuth,
    updateSnapshots: parsed.updateSnapshots,
    cleanupWorkspaces: parsed.cleanupWorkspaces,
    maxConcurrency: parsed.maxConcurrency
  });

  const report = await writeReport(benchmark);

  if (parsed.json) {
    console.log(JSON.stringify(buildBenchmarkOutputSummary(benchmark, report), null, 2));
  } else {
    console.log(`\nRepoArena run complete: ${benchmark.runId}`);
    console.log(`\nPreflight Results:`);
    for (const preflight of benchmark.preflights) {
      const statusIcon = preflight.status === "ready" ? "✓" : preflight.status === "unverified" ? "?" : "✗";
      console.log(
        `  ${statusIcon} ${preflight.displayLabel}: ${preflight.status} - ${preflight.summary}`
      );
      if (preflight.resolvedRuntime?.effectiveModel) {
        console.log(`    Model: ${preflight.resolvedRuntime.effectiveModel}`);
      }
    }

    console.log(`\nBenchmark Results:`);
    for (const result of benchmark.results) {
      const statusIcon = result.status === "success" ? "✓" : "✗";
      console.log(
        `  ${statusIcon} ${result.displayLabel}: ${result.status} (${formatDuration(result.durationMs)})`
      );
      console.log(`    status=${result.status}`);
      console.log(`    Tokens: ${result.tokenUsage} | Cost: ${result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"} | Files changed: ${result.changedFiles.length}`);

      const passedJudges = result.judgeResults.filter((j) => j.success).length;
      const totalJudges = result.judgeResults.length;
      if (totalJudges > 0) {
        console.log(`    Judges: ${passedJudges}/${totalJudges} passed`);
      }
    }

    const successCount = benchmark.results.filter((r) => r.status === "success").length;
    const totalCount = benchmark.results.length;
    console.log(`\nSummary: ${successCount}/${totalCount} agents succeeded`);

    console.log(`\nOutput Files:`);
    console.log(`  JSON summary: ${report.jsonPath}`);
    console.log(`  Markdown:     ${report.markdownPath}`);
    console.log(`  HTML report:  ${report.htmlPath}`);
    console.log(`  Badge:        ${report.badgePath}`);
    console.log(`  PR comment:   ${report.prCommentPath}`);
  }

  if (benchmark.results.some((result) => result.status !== "success")) {
    process.exitCode = 1;
  }
}

function buildBenchmarkOutputSummary(
  benchmark: BenchmarkRun,
  report: {
    jsonPath: string;
    markdownPath: string;
    htmlPath: string;
    badgePath: string;
    prCommentPath: string;
  }
) {
  return {
    runId: benchmark.runId,
    createdAt: benchmark.createdAt,
    repoPath: benchmark.repoPath,
    outputPath: benchmark.outputPath,
    task: {
      id: benchmark.task.id,
      title: benchmark.task.title,
      schemaVersion: benchmark.task.schemaVersion,
      metadata: benchmark.task.metadata
    },
    preflights: benchmark.preflights,
    results: benchmark.results.map((result) => ({
      agentId: result.agentId,
      baseAgentId: result.baseAgentId,
      variantId: result.variantId,
      displayLabel: result.displayLabel,
      requestedConfig: result.requestedConfig,
      resolvedRuntime: result.resolvedRuntime,
      agentTitle: result.agentTitle,
      adapterKind: result.adapterKind,
      status: result.status,
      summary: result.summary,
      durationMs: result.durationMs,
      tokenUsage: result.tokenUsage,
      estimatedCostUsd: result.estimatedCostUsd,
      costKnown: result.costKnown,
      changedFiles: result.changedFiles,
      changedFilesCount: result.changedFiles.length,
      tracePath: result.tracePath,
      workspacePath: result.workspacePath,
      judges: {
        passed: result.judgeResults.filter((judge) => judge.success).length,
        total: result.judgeResults.length
      }
    })),
    report
  };
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2));

    if (!parsed.command) {
      printHelp();
      return;
    }

    switch (parsed.command) {
      case "doctor":
        await runDoctor(parsed);
        break;
      case "run":
        await runBenchmarkCommand(parsed);
        break;
      case "list-adapters":
        await runListAdapters(parsed);
        break;
      case "init-taskpack":
        await runInitTaskpack(parsed);
        break;
      case "init-ci":
        await runInitCi(parsed);
        break;
      case "ui":
        await runUi(parsed);
        break;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;
      default:
        throw new Error(
          `Unknown command: ${parsed.command}\n` +
          `Available commands: run, doctor, list-adapters, init-taskpack, init-ci, ui\n` +
          'Run "repoarena --help" for usage information.'
        );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nError: ${message}`);

    // Provide helpful suggestions based on common errors
    if (message.includes("ENOENT") || message.includes("does not exist")) {
      console.error("\nTip: Check that the file path is correct and the file exists.");
    } else if (message.includes("Unknown agent")) {
      console.error('\nTip: Run "repoarena list-adapters" to see available agents.');
    } else if (message.includes("Missing required")) {
      console.error('\nTip: Run "repoarena --help" for usage information.');
    }

    process.exitCode = 1;
  }
}

void main();
