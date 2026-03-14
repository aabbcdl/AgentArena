#!/usr/bin/env node
import path from "node:path";
import { listAvailableAdapters, preflightAdapters } from "@repoarena/adapters";
import { formatDuration } from "@repoarena/core";
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
  maxConcurrency?: number;
}

function printHelp(): void {
  console.log(`RepoArena CLI

Usage:
  repoarena run --repo <path> --task <task.json> --agents <comma,separated> [--probe-auth] [--max-concurrency <n>]
  repoarena doctor [--agents <comma,separated>] [--probe-auth] [--strict]

Examples:
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.json --agents demo-fast,demo-thorough
  repoarena run --repo . --task examples/taskpacks/demo-repo-health.json --agents codex,claude-code --probe-auth
  repoarena doctor --agents codex,claude-code,cursor --probe-auth
  repoarena doctor --agents codex,claude-code,cursor --probe-auth --strict
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    agentIds: [],
    probeAuth: false,
    strict: false
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

  if (parsed.strict && preflights.some((preflight) => preflight.status !== "ready")) {
    process.exitCode = 1;
  }
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
    maxConcurrency: parsed.maxConcurrency
  });

  const report = await writeReport(benchmark);

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

  if (benchmark.results.some((result) => result.status !== "success")) {
    process.exitCode = 1;
  }
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

  printHelp();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`RepoArena failed: ${message}`);
  process.exitCode = 1;
});
