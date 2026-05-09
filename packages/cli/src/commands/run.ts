import { promises as fs } from "node:fs";
import path from "node:path";
import { listAvailableAdapters } from "@agentarena/adapters";
import { type BenchmarkRun, createCancellation, formatDuration } from "@agentarena/core";
import {
  computeVarianceAnalysis,
  enrichRunWithScores,
  formatDecisionReport,
  formatVarianceReport,
  generateDecisionReport,
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
    console.error(
      `❌ 缺少必需参数：--task / Missing required argument: --task`,
    );
    console.error(
      `原因：需要指定任务包文件路径 / A task pack file path is required`,
    );
    console.error(
      `解决方法：agentarena run --repo . --task taskpack.yaml --agents demo-fast`,
    );
    process.exit(1);
  }

  if (parsed.agentIds.length === 0) {
    console.error(
      `❌ 缺少必需参数：--agents / Missing required argument: --agents`,
    );
    console.error(
      `原因：需要指定至少一个要测试的 AI 代理 / At least one agent is required`,
    );
    console.error(
      `解决方法：agentarena run --repo . --task taskpack.yaml --agents demo-fast`,
    );
    console.error(`查看可用代理 / List available: agentarena list-adapters`);
    process.exit(1);
  }

  // Validate repo path exists
  try {
    const repoStat = await fs.stat(parsed.repoPath);
    if (!repoStat.isDirectory()) {
      throw new Error(`--repo path is not a directory: ${parsed.repoPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        `❌ --repo 路径不存在：${parsed.repoPath} / --repo path not found: ${parsed.repoPath}`,
      );
      console.error(
        `原因：指定的代码仓库路径不存在 / The specified repository path does not exist`,
      );
      console.error(
        `解决方法：检查路径是否正确，或先创建该目录 / Check the path or create the directory`,
      );
      process.exit(1);
    }
    throw error;
  }

  // Validate task path exists
  try {
    await fs.access(parsed.taskPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        `❌ --task 文件不存在：${parsed.taskPath} / --task file not found: ${parsed.taskPath}`,
      );
      console.error(
        `原因：指定的任务包文件不存在 / The specified task pack file does not exist`,
      );
      console.error(
        `解决方法：检查文件路径，或运行 agentarena init-taskpack 创建新任务包`,
      );
      process.exit(1);
    }
    throw error;
  }

  // Validate agent IDs
  const availableIds = listAvailableAdapters().map((a) => a.id);
  const invalidAgents = parsed.agentIds.filter(
    (id) => !availableIds.includes(id),
  );
  if (invalidAgents.length > 0) {
    console.error(
      `❌ 未知的代理：${invalidAgents.join(", ")} / Unknown agents: ${invalidAgents.join(", ")}`,
    );
    console.error(
      `原因：这些代理未安装或不存在 / These agents are not installed or does not exist`,
    );
    console.error(`可用代理 / Available: ${availableIds.join(", ")}`);
    console.error(`查看详情 / Details: agentarena list-adapters`);
    process.exit(1);
  }

  const selections = normalizeCliSelections(parsed);

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
      categories: parsed.categories,
      debug: parsed.debug,
      cancellation,
      onProgress:
        parsed.format === "json"
          ? undefined
          : (event: BenchmarkProgressEvent) => {
              const prefix = event.displayLabel
                ? `[${event.displayLabel}] `
                : "";
              process.stderr.write(`  ${prefix}${event.message}\n`);
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
  const decisionReport = generateDecisionReport(benchmark, {
    teamSize: 10,
    dailyRuns: 5,
  });
  const decisionReportPath = path.join(
    benchmark.outputPath,
    "decision-report.md",
  );
  await fs.writeFile(
    decisionReportPath,
    formatDecisionReport(decisionReport),
    "utf8",
  );

  // Variance analysis: check for previous runs with the same task
  const runsDir = path.dirname(benchmark.outputPath);
  let varianceReportText: string | null = null;
  try {
    const allRunFiles = await fs.readdir(runsDir);
    const previousRuns = await Promise.all(
      allRunFiles
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          try {
            const content = await fs.readFile(
              path.join(runsDir, f),
              "utf8",
            );
            return JSON.parse(content) as BenchmarkRun;
          } catch {
            return null;
          }
        }),
    );
    const comparableRuns = previousRuns.filter(
      (r): r is BenchmarkRun =>
        r !== null && r.task?.id === benchmark.task?.id,
    );
    if (comparableRuns.length > 1) {
      const varianceReport = computeVarianceAnalysis(comparableRuns);
      varianceReportText = formatVarianceReport(varianceReport);
    }
  } catch {
    // Ignore variance analysis errors - not critical
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

    const topRec = decisionReport.recommendations.find(
      (r) => r.recommendation === "recommended",
    );
    if (topRec) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`📋 AGENTARENA DECISION REPORT`);
      console.log(`${"═".repeat(60)}`);
      console.log(``);
      console.log(`🏆 推荐: ${topRec.displayLabel}`);
      console.log(`   - 成功率: ${(topRec.successRate * 100).toFixed(0)}%`);
      console.log(`   - 平均成本: $${topRec.avgCostPerRun.toFixed(2)}/次`);
      console.log(`   - 置信度: ${topRec.confidence}`);
      console.log(``);
      console.log(`📄 完整报告: ${decisionReportPath}`);
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

    if (varianceReportText) {
      console.log(`\n${varianceReportText}`);
    }
  }

  if (benchmark.results.some((result) => result.status !== "success")) {
    process.exitCode = 1;
  }
}
