import { promises as fs } from "node:fs";
import path from "node:path";
import type { AdapterExecutionContext } from "@agentarena/core";
import { ensureDirectory } from "@agentarena/core";
import type { DemoProfile } from "./adapter-capabilities.js";

export function computeTokenUsage(prompt: string, profile: DemoProfile): number {
  return Math.round(profile.tokenBase + prompt.length * profile.tokenMultiplier);
}

export function buildDemoSummary(context: AdapterExecutionContext, profile: DemoProfile): string {
  return `${profile.title} processed task "${context.task.id}" in ${profile.delayMs}ms using the demo adapter path.`;
}

export async function writeDemoArtifacts(
  context: AdapterExecutionContext,
  profile: DemoProfile
): Promise<string[]> {
  const demoDir = path.join(context.workspacePath, "agentarena-demo");
  await ensureDirectory(demoDir);

  const changedFiles: string[] = [];
  const primaryFilePath = path.join(demoDir, `${context.agentId}.md`);

  const fileBody = [
    `# ${profile.title}`,
    "",
    `Task: ${context.task.title}`,
    "",
    "Prompt:",
    context.task.prompt,
    "",
    "This file was created by the built-in demo adapter to validate the AgentArena execution pipeline."
  ].join("\n");

  await fs.writeFile(primaryFilePath, fileBody, "utf8");
  changedFiles.push("agentarena-demo/" + path.basename(primaryFilePath));

  for (let index = 1; index < profile.extraFiles; index += 1) {
    const jsonPath = path.join(demoDir, `${context.agentId}-${index}.json`);
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          agentId: context.agentId,
          taskId: context.task.id,
          note: "Extra artifact for diff and report output."
        },
        null,
        2
      ),
      "utf8"
    );
    changedFiles.push("agentarena-demo/" + path.basename(jsonPath));
  }

  return changedFiles;
}
