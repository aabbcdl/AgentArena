#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { listAvailableAdapters, preflightAdapters } from "@repoarena/adapters";
import { BenchmarkRun, formatDuration } from "@repoarena/core";
import { writeReport } from "@repoarena/report";
import { runBenchmark } from "@repoarena/runner";

interface ParsedArgs {
  command?: string;
  repoPath?: string;
  taskPath?: string;
  agentIds: string[];
  outputPath?: string;
  probeAuth: boolean;
  strict: boolean;
  updateSnapshots: boolean;
  maxConcurrency?: number;
  json: boolean;
  templateName?: string;
  force: boolean;
}

const TASKPACK_TEMPLATES: Record<string, string> = {
  "repo-health": `schemaVersion: repoarena.taskpack/v1
id: repo-health
title: Repository Health
prompt: |
  Review the repository and make the smallest useful change that improves correctness,
  reliability, or maintainability. Keep changes scoped and preserve existing behavior
  unless a test or fixture shows otherwise.
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
`,
  "json-api": `schemaVersion: repoarena.taskpack/v1
id: json-api-contract
title: JSON API Contract
prompt: |
  Update the implementation so the generated JSON output matches the expected contract
  and values described by the task pack.
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
prompt: |
  Update the implementation so the generated output matches the stored snapshot fixture.
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

function printHelp(): void {
  console.log(`RepoArena CLI

Usage:
  repoarena run --repo <path> --task <task.json> --agents <comma,separated> [--probe-auth] [--update-snapshots] [--max-concurrency <n>] [--json]
  repoarena doctor [--agents <comma,separated>] [--probe-auth] [--strict] [--json]
  repoarena list-adapters [--json]
  repoarena init-taskpack [--template <name>] [--output <path>] [--force]

Examples:
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.json --agents demo-fast,demo-thorough
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.json --agents codex,claude-code --probe-auth
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --update-snapshots
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.yaml --agents demo-fast --json
  repoarena doctor --agents codex,claude-code,cursor --probe-auth
  repoarena doctor --agents codex,claude-code,cursor --probe-auth --strict
  repoarena doctor --agents codex,demo-fast --json
  repoarena list-adapters --json
  repoarena init-taskpack --template repo-health --output repoarena.taskpack.yaml
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    agentIds: [],
    probeAuth: false,
    strict: false,
    updateSnapshots: false,
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
        break;
      case "--task":
        parsed.taskPath = args.shift();
        break;
      case "--agents":
        parsed.agentIds = (args.shift() ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--output":
        parsed.outputPath = args.shift();
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
      case "--json":
        parsed.json = true;
        break;
      case "--template":
        parsed.templateName = args.shift();
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--max-concurrency": {
        const value = Number.parseInt(args.shift() ?? "", 10);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error("--max-concurrency must be a positive integer.");
        }

        parsed.maxConcurrency = value;
        break;
      }
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

async function runDoctor(parsed: ParsedArgs): Promise<void> {
  const agentIds =
    parsed.agentIds.length > 0
      ? parsed.agentIds
      : listAvailableAdapters()
          .map((adapter) => adapter.id)
          .sort();

  const preflights = await preflightAdapters(agentIds, { probeAuth: parsed.probeAuth });
  if (parsed.json) {
    console.log(JSON.stringify(preflights, null, 2));
  } else {
    console.log("\nRepoArena doctor\n");
    for (const preflight of preflights) {
      console.log(
        [
          `- ${preflight.agentId}`,
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
    }
  }

  if (parsed.strict && preflights.some((preflight) => preflight.status !== "ready")) {
    process.exitCode = 1;
  }
}

async function runListAdapters(parsed: ParsedArgs): Promise<void> {
  const adapters = listAvailableAdapters()
    .map((adapter) => ({ id: adapter.id, title: adapter.title, kind: adapter.kind }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (parsed.json) {
    console.log(JSON.stringify(adapters, null, 2));
    return;
  }

  console.log("\nRepoArena adapters\n");
  for (const adapter of adapters) {
    console.log(`- ${adapter.id} | kind=${adapter.kind} | title=${adapter.title}`);
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

async function runBenchmarkCommand(parsed: ParsedArgs): Promise<void> {
  if (!parsed.repoPath || !parsed.taskPath || parsed.agentIds.length === 0) {
    throw new Error("Missing required arguments. Use --repo, --task, and --agents.");
  }

  const benchmark = await runBenchmark({
    repoPath: parsed.repoPath,
    taskPath: parsed.taskPath,
    agentIds: parsed.agentIds,
    outputPath: parsed.outputPath ? path.resolve(parsed.outputPath) : undefined,
    probeAuth: parsed.probeAuth,
    updateSnapshots: parsed.updateSnapshots,
    maxConcurrency: parsed.maxConcurrency
  });

  const report = await writeReport(benchmark);

  if (parsed.json) {
    console.log(JSON.stringify(buildBenchmarkOutputSummary(benchmark, report), null, 2));
  } else {
    console.log(`\nRepoArena run complete: ${benchmark.runId}`);
    for (const preflight of benchmark.preflights) {
      console.log(
        [`preflight ${preflight.agentId}`, `status=${preflight.status}`, `summary=${preflight.summary}`].join(
          " | "
        )
      );
    }

    console.log("");
    for (const result of benchmark.results) {
      console.log(
        [
          `- ${result.agentId}`,
          `status=${result.status}`,
          `duration=${formatDuration(result.durationMs)}`,
          `tokens=${result.tokenUsage}`,
          `cost=${result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"}`,
          `changed=${result.changedFiles.length}`
        ].join(" | ")
      );
    }

    console.log(`\nJSON summary: ${report.jsonPath}`);
    console.log(`Markdown:      ${report.markdownPath}`);
    console.log(`HTML report:  ${report.htmlPath}`);
  }

  if (benchmark.results.some((result) => result.status !== "success")) {
    process.exitCode = 1;
  }
}

function buildBenchmarkOutputSummary(
  benchmark: BenchmarkRun,
  report: { jsonPath: string; markdownPath: string; htmlPath: string }
) {
  return {
    runId: benchmark.runId,
    createdAt: benchmark.createdAt,
    repoPath: benchmark.repoPath,
    outputPath: benchmark.outputPath,
    task: {
      id: benchmark.task.id,
      title: benchmark.task.title,
      schemaVersion: benchmark.task.schemaVersion
    },
    preflights: benchmark.preflights,
    results: benchmark.results.map((result) => ({
      agentId: result.agentId,
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
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === "doctor") {
    await runDoctor(parsed);
    return;
  }

  if (parsed.command === "run") {
    await runBenchmarkCommand(parsed);
    return;
  }

  if (parsed.command === "list-adapters") {
    await runListAdapters(parsed);
    return;
  }

  if (parsed.command === "init-taskpack") {
    await runInitTaskpack(parsed);
    return;
  }

  printHelp();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`RepoArena failed: ${message}`);
  process.exitCode = 1;
});
