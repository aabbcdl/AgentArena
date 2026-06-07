import { promises as fs } from "node:fs";
import path from "node:path";
import { listAvailableAdapters } from "@agentarena/adapters";
import { type BenchmarkRun, createCancellation, formatDuration } from "@agentarena/core";
import {
  aggregateMultiRuns,
  computeVarianceAnalysis,
  enrichRunWithScores,
  formatDecisionReport,
  formatMultiRunReport,
  formatVarianceReport,
  generateDecisionReport,
  getReportCopy,
  writeReport,
} from "@agentarena/report";
import { type BenchmarkProgressEvent, runBenchmark } from "@agentarena/runner";
import type { ParsedArgs } from "../args.js";
import { buildBenchmarkOutputSummary } from "../output.js";
import {
  normalizeCliSelections,
  resolveReportLocale,
} from "./shared.js";

export async function runBenchmarkCommand(
  parsed: ParsedArgs,
): Promise<void> {
  const reportLocale = resolveReportLocale(
    parsed.locale ?? process.env.AGENTARENA_LOCALE,
  );

  if (!parsed.repoPath) {
    throw new Error(
      "Missing required argument: --repo\n" +
        "Example: agentarena run --repo . --task taskpack.yaml --agents demo-fast\n" +
        'Run "agentarena --help" for more information.',
    );
  }

  if (!parsed.taskPath) {
    throw new Error(
      "Missing required argument: --task\n" +
        "A task pack file path is required\n" +
        "Example: agentarena run --repo . --task taskpack.yaml --agents demo-fast",
    );
  }

  if (parsed.agentIds.length === 0) {
    throw new Error(
      "Missing required argument: --agents\n" +
        "At least one agent is required\n" +
        "Example: agentarena run --repo . --task taskpack.yaml --agents demo-fast\n" +
        'List available: agentarena list-adapters',
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
      throw new Error(
        `--repo path not found: ${parsed.repoPath}\n` +
          "The specified repository path does not exist\n" +
          "Check the path or create the directory",
      );
    }
    throw error;
  }

  // Validate task path exists
  try {
    await fs.access(parsed.taskPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `--task file not found: ${parsed.taskPath}\n` +
          "The specified task pack file does not exist\n" +
          "Check the file path or run agentarena init-taskpack to create one",
      );
    }
    throw error;
  }

  // Validate agent IDs
  const availableIds = listAvailableAdapters().map((a) => a.id);
  const invalidAgents = parsed.agentIds.filter(
    (id) => !availableIds.includes(id),
  );
  if (invalidAgents.length > 0) {
    throw new Error(
      `Unknown agents: ${invalidAgents.join(", ")}\n` +
        "These agents are not installed or do not exist\n" +
        `Available: ${availableIds.join(", ")}\n` +
        'Details: agentarena list-adapters',
    );
  }

  const selections = normalizeCliSelections(parsed);

  // --probe-timeout is a doctor-only option (it tunes the auth-probe timeout in
  // `agentarena doctor`). The run preflight does not consume it, so warn rather
  // than silently ignore it.
  if (parsed.probeTimeout !== undefined) {
    console.warn(
      "[agentarena] --probe-timeout is only used by 'agentarena doctor'; it has no effect on 'run' and will be ignored.",
    );
  }

  // The adapter- and runner-level execution timeouts are read from the
  // environment at run time, so map the per-run --agent-timeout flag onto them
  // here. The runner wrapper must stay above the adapter timeout, so add a grace
  // margin. (Previously a timeout could only be set via an undocumented env var.)
  if (parsed.agentTimeout !== undefined) {
    process.env.AGENTARENA_AGENT_TIMEOUT_MS = String(parsed.agentTimeout);
    process.env.AGENTARENA_AGENT_EXECUTE_TIMEOUT_MS = String(parsed.agentTimeout + 60_000);
    if (parsed.format !== "json") {
      console.log(`Per-agent timeout: ${parsed.agentTimeout}ms`);
    }
  }

  const runStartMs = Date.now();

  if (parsed.format !== "json") {
    console.log(`\nStarting AgentArena benchmark...`);
    console.log(`Repository: ${parsed.repoPath}`);
    console.log(`Task: ${parsed.taskPath}`);
    console.log(`Agents: ${parsed.agentIds.join(", ")}`);
    if (parsed.probeAuth) {
      console.log(`Authentication probe: enabled`);
    }
    console.log("");
  }

  if (parsed.dryRun) {
    const resolvedOutput = parsed.outputPath
      ? path.resolve(parsed.outputPath)
      : "(default: <repo>/.agentarena/runs)";
    if (parsed.format === "json") {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            repoPath: parsed.repoPath,
            taskPath: parsed.taskPath,
            outputPath: resolvedOutput,
            scoreMode: parsed.scoreMode ?? "practical",
            tokenBudget: parsed.tokenBudget ?? null,
            maxConcurrency: parsed.maxConcurrency ?? null,
            probeAuth: parsed.probeAuth,
            agents: selections.map((selection) => ({
              baseAgentId: selection.baseAgentId,
              variantId: selection.variantId,
              displayLabel: selection.displayLabel,
              model: selection.config?.model ?? null,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      console.log("Dry run — resolved plan (no agents executed):");
      console.log(`  Output:       ${resolvedOutput}`);
      console.log(`  Score mode:   ${parsed.scoreMode ?? "practical"}`);
      console.log(`  Token budget: ${parsed.tokenBudget ?? "(task default)"}`);
      console.log(`  Concurrency:  ${parsed.maxConcurrency ?? "(default)"}`);
      console.log(`  Probe auth:   ${parsed.probeAuth ? "yes" : "no"}`);
      console.log("  Agents:");
      for (const selection of selections) {
        const model = selection.config?.model
          ? ` (model: ${selection.config.model})`
          : "";
        console.log(`    - ${selection.displayLabel}${model}`);
      }
      console.log("\nRe-run without --dry-run to execute.");
    }
    return;
  }

  function elapsed(): string {
    const sec = Math.floor((Date.now() - runStartMs) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  let cancelled = false;
  const cancellationController = new AbortController();
  const cancellation = createCancellation(cancellationController.signal);
  const sigintHandler = () => {
    if (cancelled) {
      process.exit(1);
    }
    cancelled = true;
    cancellationController.abort();
    console.error(
      "\nCancelling benchmark... (press Ctrl+C again to force quit)",
    );
  };
  process.on("SIGINT", sigintHandler);

  let benchmark: BenchmarkRun;
  try {
    benchmark = await runBenchmark({
      repoPath: parsed.repoPath,
      taskPath: parsed.taskPath,
      agentIds: selections.map((selection) => selection.baseAgentId),
      agents: selections,
      outputPath: parsed.outputPath
        ? path.resolve(parsed.outputPath)
        : undefined,
      probeAuth: parsed.probeAuth,
      updateSnapshots: parsed.updateSnapshots,
      cleanupWorkspaces: parsed.cleanupWorkspaces,
      maxConcurrency: parsed.maxConcurrency,
      scoreMode: parsed.scoreMode,
      tokenBudget: parsed.tokenBudget,
      debug: parsed.debug,
      cancellation,
      onProgress:
        parsed.format === "json"
          ? undefined
          : (event: BenchmarkProgressEvent) => {
              const prefix = event.displayLabel
                ? `[${event.displayLabel}] `
                : "";
              process.stderr.write(`  [${elapsed()}] ${prefix}${event.message}\n`);
            },
    });
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }

  const report = await writeReport(benchmark, { locale: reportLocale });
  const scoredBenchmark = enrichRunWithScores(benchmark);

  // Generate CSV export
  const { generateCsv } = await import("@agentarena/report");
  const csvPath = path.join(benchmark.outputPath, "results.csv");
  await fs.writeFile(csvPath, generateCsv(benchmark), "utf8");

  // Generate decision report
  // TODO: expose as CLI flags (--team-size, --daily-runs)
  // These defaults represent a typical small team scenario for cost projection.
  // teamSize=10: average dev team size for ROI calculations
  // dailyRuns=5: conservative estimate of benchmark runs per day
  const DEFAULT_TEAM_SIZE = 10;
  const DEFAULT_DAILY_RUNS = 5;
  const decisionReport = generateDecisionReport(benchmark, {
    teamSize: DEFAULT_TEAM_SIZE,
    dailyRuns: DEFAULT_DAILY_RUNS,
  });
  const decisionReportPath = path.join(
    benchmark.outputPath,
    "decision-report.md",
  );
  await fs.writeFile(
    decisionReportPath,
    formatDecisionReport(decisionReport, reportLocale),
    "utf8",
  );

  // Variance analysis: check for previous runs with the same task
  const runsDir = path.dirname(benchmark.outputPath);
  let varianceReportText: string | null = null;
  let trendReportPath: string | null = null;
  try {
    const allRunFiles = await fs.readdir(runsDir);
    const jsonFiles = allRunFiles.filter((f) => f.endsWith(".json")).slice(-50);
    const previousRuns: (BenchmarkRun | null)[] = [];
    let totalBytesRead = 0;
    const MAX_VARIANCE_BYTES = 50 * 1024 * 1024; // 50MB limit for variance analysis

    for (const f of jsonFiles) {
      try {
        const content = await fs.readFile(
          path.join(runsDir, f),
          "utf8",
        );
        totalBytesRead += content.length;
        if (totalBytesRead > MAX_VARIANCE_BYTES) {
          console.warn(`[agentarena] Variance analysis stopped: exceeded ${Math.round(MAX_VARIANCE_BYTES / (1024 * 1024))}MB memory limit`);
          break;
        }
        previousRuns.push(JSON.parse(content) as BenchmarkRun);
      } catch {
        previousRuns.push(null);
      }
    }

    const comparableRuns = previousRuns.filter(
      (r): r is BenchmarkRun =>
        r !== null && r.task?.id === benchmark.task?.id,
    );
    if (comparableRuns.length > 1) {
      const varianceReport = computeVarianceAnalysis(comparableRuns);
      varianceReportText = formatVarianceReport(varianceReport);

      // Multi-run trend: aggregate the prior comparable runs together with the
      // current run (already in memory — no extra scan) and write a trend.md
      // artifact summarizing per-agent performance across runs.
      try {
        const trendComparison = aggregateMultiRuns([...comparableRuns, benchmark]);
        const trendReport = formatMultiRunReport(trendComparison);
        trendReportPath = path.join(benchmark.outputPath, "trend.md");
        await fs.writeFile(trendReportPath, trendReport, "utf8");
      } catch (trendError) {
        trendReportPath = null;
        console.warn(`[agentarena] Trend report skipped: ${trendError instanceof Error ? trendError.message : String(trendError)}`);
      }
    }
  } catch (varianceError) {
    console.warn(`[agentarena] Variance analysis skipped: ${varianceError instanceof Error ? varianceError.message : String(varianceError)}`);
  }

  if (parsed.format === "json") {
    console.log(
      JSON.stringify(
        buildBenchmarkOutputSummary(benchmark, report),
        null,
        2,
      ),
    );
  } else {
    console.log(`\nAgentArena run complete: ${scoredBenchmark.runId}`);
    console.log(
      `Score scope: ${scoredBenchmark.scoreScope ?? "run-local"}`,
    );
    console.log(
      `Score note: ${scoredBenchmark.scoreValidityNote ?? "Scores only compare variants inside this run."}`,
    );
    console.log(`\nPreflight Results:`);
    for (const preflight of scoredBenchmark.preflights) {
      const statusIcon =
        preflight.status === "ready"
          ? "✓"
          : preflight.status === "unverified"
            ? "?"
            : "✗";
      console.log(
        `  ${statusIcon} ${preflight.displayLabel}: ${preflight.status} - ${preflight.summary}`,
      );
      if (preflight.resolvedRuntime?.effectiveModel) {
        console.log(`    Model: ${preflight.resolvedRuntime.effectiveModel}`);
      }
      if (preflight.resolvedRuntime?.effectiveAgentVersion) {
        console.log(
          `    Version: ${preflight.resolvedRuntime.effectiveAgentVersion}`,
        );
      }
    }

    console.log(`\nBenchmark Results:`);
    for (const result of scoredBenchmark.results) {
      const statusIcon = result.status === "success" ? "✓" : "✗";
      console.log(
        `  ${statusIcon} ${result.displayLabel}: ${result.status} (${formatDuration(result.durationMs)})`,
      );
      console.log(`    status=${result.status}`);
      console.log(`    Score: ${(result.compositeScore ?? 0).toFixed(1)}`);
      if (result.resolvedRuntime?.effectiveModel) {
        console.log(`    Model: ${result.resolvedRuntime.effectiveModel}`);
      }
      if (result.resolvedRuntime?.effectiveReasoningEffort) {
        console.log(
          `    Reasoning: ${result.resolvedRuntime.effectiveReasoningEffort}`,
        );
      }
      if (result.resolvedRuntime?.effectiveAgentVersion) {
        console.log(
          `    Version: ${result.resolvedRuntime.effectiveAgentVersion}`,
        );
      }
      console.log(
        `    Tokens: ${result.tokenUsage} | Cost: ${result.costKnown ? `$${result.estimatedCostUsd.toFixed(2)}` : "n/a"} | Files changed: ${result.changedFiles.length}`,
      );

      const passedJudges = result.judgeResults.filter(
        (j) => j.success,
      ).length;
      const totalJudges = result.judgeResults.length;
      if (totalJudges > 0) {
        console.log(`    Judges: ${passedJudges}/${totalJudges} passed`);
      }
    }

    const successCount = scoredBenchmark.results.filter(
      (r) => r.status === "success",
    ).length;
    const totalCount = scoredBenchmark.results.length;
    console.log(`\nSummary: ${successCount}/${totalCount} agents succeeded`);

    // Run-level totals so the first question after a run ("what did this cost
    // me?") is answered without mentally summing per-agent lines.
    const totalTokens = scoredBenchmark.results.reduce(
      (sum, r) => sum + (r.tokenUsage ?? 0),
      0,
    );
    const costResults = scoredBenchmark.results.filter((r) => r.costKnown);
    const totalCost = costResults.reduce(
      (sum, r) => sum + (r.estimatedCostUsd ?? 0),
      0,
    );
    const costCoverage =
      costResults.length === totalCount
        ? ""
        : ` (cost known for ${costResults.length}/${totalCount})`;
    console.log(
      `Total: ${totalTokens} tokens | $${totalCost.toFixed(2)}${costCoverage}`,
    );

    const topRec = decisionReport.recommendations.find(
      (r) => r.recommendation === "recommended",
    );
    if (topRec) {
      const copy = getReportCopy(reportLocale);
      console.log(`\n${"═".repeat(60)}`);
      console.log(`📋 ${copy.decisionReportTitle}`);
      console.log(`${"═".repeat(60)}`);
      console.log(``);
      console.log(`🏆 ${copy.recommendationLabel}: ${topRec.displayLabel}`);
      console.log(`   - ${copy.successRateLabel}: ${(topRec.successRate * 100).toFixed(0)}%`);
      console.log(`   - ${copy.averageCostLabel}: $${topRec.avgCostPerRun.toFixed(2)}/${copy.perRun}`);
      console.log(`   - ${copy.confidenceLabel}: ${topRec.confidence}`);
      console.log(``);
      console.log(`📄 ${copy.fullReportLabel}: ${decisionReportPath}`);
      console.log(`${"═".repeat(60)}`);
    }

    console.log(`\nOutput Files:`);
    console.log(`  JSON summary:       ${report.jsonPath}`);
    console.log(`  Markdown:           ${report.markdownPath}`);
    console.log(`  HTML report:        ${report.htmlPath}`);
    console.log(`  Badge:              ${report.badgePath}`);
    console.log(`  PR comment:         ${report.prCommentPath}`);
    console.log(`  Decision report:    ${decisionReportPath}`);
    console.log(`  CSV export:         ${csvPath}`);
    if (trendReportPath) {
      console.log(`  Trend report:       ${trendReportPath}`);
    }

    if (varianceReportText) {
      console.log(`\n${varianceReportText}`);
    }
  }

  if (benchmark.results.some((result) => result.status !== "success")) {
    process.exitCode = 1;
  }

  // Auto-cleanup old runs (keep most recent 50 by default)
  try {
    const { runCleanup } = await import("./cleanup.js");
    await runCleanup({ ...parsed, maxRuns: parsed.maxRuns ?? 50 });
  } catch (cleanupError) {
    console.warn(`[agentarena] Auto-cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
  }
}
