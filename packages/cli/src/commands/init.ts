import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildCiWorkflow,
  TASKPACK_TEMPLATES,
} from "../templates.js";
import { type ParsedTaskPackMetadataFile, WORKSPACE_ROOT } from "./shared.js";

const OFFICIAL_TASKPACK_ROOT = path.join(
  WORKSPACE_ROOT,
  "examples",
  "taskpacks",
  "official",
);

type OfficialTaskPackSummary = {
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
  repoSource?: string;
  i18n?: unknown;
};

export async function runInitTaskpack(parsed: {
  templateName?: string;
  outputPath?: string;
  force?: boolean;
  format?: string;
}): Promise<void> {
  const templateName = parsed.templateName ?? "repo-health";
  const template = TASKPACK_TEMPLATES[templateName];
  if (!template) {
    console.error(`❌ Unknown template: "${templateName}"`);
    console.error(`   未知的任务包模板："${templateName}"`);
    console.error(`   Available templates: ${Object.keys(TASKPACK_TEMPLATES).join(", ")}`);
    console.error(`   Usage: agentarena init-taskpack --template repo-health`);
    process.exit(1);
  }

  const outputPath = path.resolve(parsed.outputPath ?? "agentarena.taskpack.yaml");
  const parentPath = path.dirname(outputPath);

  try {
    await fs.access(outputPath);
    if (!parsed.force) {
      console.error(`❌ File already exists: ${outputPath}`);
      console.error(`   文件已存在：${outputPath}`);
      console.error(`   Use a different name or add --force to overwrite.`);
      process.exit(1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(parentPath, { recursive: true });
  await fs.writeFile(outputPath, template, "utf8");

  if (parsed.format === "json") {
    console.log(
      JSON.stringify({ template: templateName, outputPath }, null, 2),
    );
    return;
  }

  console.log(`\nAgentArena task pack created`);
  console.log(`template=${templateName}`);
  console.log(`path=${outputPath}`);
}

export async function runInitCi(parsed: {
  workflowPath?: string;
  outputPath?: string;
  taskPath?: string;
  agentIds: string[];
  ciTemplate?: string;
  ciOutputDir?: string;
  force?: boolean;
  format?: string;
}): Promise<void> {
  const workflowPath = path.resolve(
    parsed.workflowPath ??
      parsed.outputPath ??
      ".github/workflows/agentarena-benchmark.yml",
  );
  const taskPath = parsed.taskPath ?? "agentarena.taskpack.yaml";
  const agentIds =
    parsed.agentIds.length > 0 ? parsed.agentIds : ["demo-fast"];
  const ciTemplate = (parsed.ciTemplate ?? "pull-request") as
    | "pull-request"
    | "smoke"
    | "nightly";
  if (!["pull-request", "smoke", "nightly"].includes(ciTemplate)) {
    console.error(`❌ Unknown CI template: "${ciTemplate}"`);
    console.error(`   未知的 CI 模板："${ciTemplate}"`);
    console.error(`   Available templates: pull-request, smoke, nightly`);
    console.error(`   Usage: agentarena init-ci --ci-template=pull-request`);
    process.exit(1);
  }
  const ciOutputDir = parsed.ciOutputDir ?? ".agentarena/ci-benchmark";
  const parentPath = path.dirname(workflowPath);

  try {
    await fs.access(workflowPath);
    if (!parsed.force) {
      console.error(`❌ File already exists: ${workflowPath}`);
      console.error(`   文件已存在：${workflowPath}`);
      console.error(`   Use a different path or add --force to overwrite.`);
      process.exit(1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(parentPath, { recursive: true });
  await fs.writeFile(
    workflowPath,
    buildCiWorkflow({
      taskPath,
      agentIds,
      template: ciTemplate,
      outputDir: ciOutputDir,
    }),
    "utf8",
  );

  if (parsed.format === "json") {
    console.log(
      JSON.stringify(
        { workflowPath, taskPath, agentIds, ciTemplate, ciOutputDir },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\nAgentArena CI workflow created`);
  console.log(`path=${workflowPath}`);
  console.log(`task=${taskPath}`);
  console.log(`agents=${agentIds.join(",")}`);
  console.log(`template=${ciTemplate}`);
  console.log(`output=${ciOutputDir}`);
}

export async function runInit(parsed: {
  repoPath?: string;
  outputPath?: string;
  agentIds: string[];
  force?: boolean;
}): Promise<void> {
  const repoPath = parsed.repoPath
    ? path.resolve(parsed.repoPath)
    : process.cwd();
  const taskPackPath = parsed.outputPath
    ? path.resolve(parsed.outputPath)
    : path.join(repoPath, "agentarena.taskpack.yaml");

  try {
    await fs.access(taskPackPath);
    if (!parsed.force) {
      console.log(`Task pack already exists at: ${taskPackPath}`);
      console.log("Use --force to overwrite, or run with an existing task pack.");
      return;
    }
  } catch {
    // File doesn't exist, proceed
  }

  const demoTaskPack = {
    id: "demo-repo-health",
    title: "Demo Repository Health Check",
    prompt:
      "Analyze this repository and create a comprehensive health report covering code quality, documentation, and project structure. Create a HEALTH.md file summarizing your findings with actionable recommendations.",
    difficulty: "easy",
    repoTypes: ["generic"],
    judges: [
      { type: "file-exists", path: "HEALTH.md" },
      {
        type: "file-contains",
        path: "HEALTH.md",
        pattern: "recommendation",
        regex: true,
        flags: "i",
      },
      { type: "file-count", pattern: "**/*.md", min: 1 },
    ],
  };

  const { stringify: stringifyYaml } = await import("yaml");
  const yamlContent = stringifyYaml(demoTaskPack);
  await fs.writeFile(taskPackPath, yamlContent, "utf8");
  console.log(`\n✓ Generated demo task pack: ${taskPackPath}`);

  const { listAvailableAdapters } = await import("@agentarena/adapters");

  const allAdapters = listAvailableAdapters().filter((a) => a.kind !== "demo");
  const detectedAgents: string[] = [];

  for (const adapter of allAdapters) {
    try {
      const preflight = await adapter.preflight({ probeAuth: false });
      if (preflight.status !== "missing") {
        detectedAgents.push(adapter.id);
      }
    } catch {
      // Agent not available
    }
  }

  const requestedAgents =
    parsed.agentIds.length > 0 ? parsed.agentIds : detectedAgents;

  if (requestedAgents.length === 0) {
    console.log(
      "\n⚠ No agents detected. Install at least one agent CLI to run benchmarks.",
    );
    console.log("\nSupported agents:");
    for (const adapter of allAdapters) {
      console.log(`  - ${adapter.id}: ${adapter.title}`);
    }
    console.log("\nAfter installing an agent, run: agentarena init");
    return;
  }

  if (parsed.agentIds.length > 0) {
    console.log(`\n✓ Using requested agents: ${requestedAgents.join(", ")}`);
    console.log(
      `  (${detectedAgents.length} agent(s) detected on this machine)`,
    );
  } else {
    console.log(
      `\n✓ Detected ${detectedAgents.length} available agent(s): ${detectedAgents.join(", ")}`,
    );
  }

  console.log(`\n▶ Ready to run! Execute:`);
  console.log(
    `  agentarena run --repo ${repoPath} --task ${taskPackPath} --agents ${requestedAgents.join(",")}`,
  );
}

export async function listOfficialTaskPacks(): Promise<OfficialTaskPackSummary[]> {
  try {
    const { parse: parseYaml } = await import("yaml");
    const { loadTaskPack } = await import("@agentarena/taskpacks");

    const entries = await fs.readdir(OFFICIAL_TASKPACK_ROOT, {
      withFileTypes: true,
    });
    const files = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          [".yaml", ".yml", ".json"].includes(
            path.extname(entry.name).toLowerCase(),
          ),
      )
      .map((entry) => path.join(OFFICIAL_TASKPACK_ROOT, entry.name))
      .sort();

    const taskPackResults = await Promise.allSettled(
      files.map(async (filePath) => {
        const raw = await fs.readFile(filePath, "utf8");
        const taskPack = await loadTaskPack(filePath);
        let i18n: unknown;
        try {
          const parsed = (
            filePath.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw)
          ) as ParsedTaskPackMetadataFile;
          i18n = parsed.metadata?.i18n ?? undefined;
        } catch {
          /* i18n extraction is best-effort */
        }

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
          judges: taskPack.judges.map((j) => ({
            id: j.id,
            type: j.type,
            label: j.label,
          })),
          difficulty: taskPack.metadata?.difficulty,
          differentiator: taskPack.metadata?.differentiator,
          repoSource: taskPack.repoSource,
          i18n,
        };
      }),
    );

    const taskPacks: OfficialTaskPackSummary[] = taskPackResults
      .filter((r) => {
        if (r.status === "rejected") {
          console.warn(`[agentarena] Task pack load failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
        return r.status === "fulfilled";
      })
      .map((r) => (r as PromiseFulfilledResult<OfficialTaskPackSummary>).value);

    const difficultyOrder: Record<string, number> = {
      easy: 0,
      medium: 1,
      hard: 2,
    };
    taskPacks.sort(
      (a, b) =>
        (difficultyOrder[a.difficulty ?? ""] ?? 9) -
        (difficultyOrder[b.difficulty ?? ""] ?? 9),
    );

    return taskPacks;
  } catch (error) {
    console.warn(`[agentarena] Failed to list official task packs: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
