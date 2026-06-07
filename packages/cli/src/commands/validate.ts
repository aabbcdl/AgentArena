import { loadTaskPack } from "@agentarena/taskpacks";
import type { ParsedArgs } from "../args.js";

export async function runValidate(parsed: ParsedArgs): Promise<void> {
  const taskPath = parsed.taskPath;
  if (!taskPath) {
    console.error("❌ Missing required argument: <taskpack-path>");
    console.error("   Usage: agentarena validate <taskpack-path>");
    console.error("   Example: agentarena validate my-task.yaml");
    process.exit(1);
  }

  try {
    const task = await loadTaskPack(taskPath);

    console.log(`\n✅ Task pack is valid: ${taskPath}\n`);
    console.log(`   ID: ${task.id}`);
    console.log(`   Title: ${task.title}`);
    console.log(`   Schema: ${task.schemaVersion}`);
    console.log(`   Judges: ${task.judges.length}`);
    for (const judge of task.judges) {
      const critical = judge.critical ? " (critical)" : "";
      console.log(`     • ${judge.type}: ${judge.label}${critical}`);
    }
    if (task.setupCommands.length > 0) {
      console.log(`   Setup commands: ${task.setupCommands.length}`);
    }
    if (task.teardownCommands.length > 0) {
      console.log(`   Teardown commands: ${task.teardownCommands.length}`);
    }
    if (task.metadata?.difficulty) {
      console.log(`   Difficulty: ${task.metadata.difficulty}`);
    }
    console.log("");
  } catch (error) {
    console.error(`\n❌ Task pack validation failed: ${taskPath}\n`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    console.error("");
    process.exitCode = 1;
  }
}
