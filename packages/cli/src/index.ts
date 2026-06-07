#!/usr/bin/env node
import { type ParsedArgs, parseArgs, printHelp } from "./args.js";
import { validateCommandArgs } from "./args-validators.js";
import { runCleanup } from "./commands/cleanup.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit, runInitCi, runInitTaskpack } from "./commands/init.js";
import { runListAdapters } from "./commands/list-adapters.js";
import { runBenchmarkCommand } from "./commands/run.js";
import { hasAvailableAdapters, showWelcomeMessage } from "./commands/shared.js";
import { runUi } from "./commands/ui.js";
import { runValidate } from "./commands/validate.js";
import { loadDotEnv } from "./dotenv.js";
import { runPublish } from "./publish.js";

async function main(): Promise<void> {
  // Load .env file from project root before anything else.
  // Does NOT override already-set environment variables.
  loadDotEnv();

  let parsed: ParsedArgs | undefined;

  try {
    parsed = parseArgs(process.argv.slice(2));

    const shouldShowWelcome =
      parsed.welcome || (!parsed.command && !(await hasAvailableAdapters()));

    if (shouldShowWelcome) {
      showWelcomeMessage();
      if (!parsed.command) {
        return;
      }
    }

    if (!parsed.command) {
      printHelp();
      return;
    }

    // Validate command-specific arguments
    const validation = validateCommandArgs(parsed);
    if (!validation.ok) {
      console.error(`❌ ${validation.error}`);
      process.exit(1);
    }

    switch (parsed.command) {
      case "doctor":
        await runDoctor(parsed);
        break;
      case "init":
        await runInit(parsed);
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
      case "publish":
        await runPublish(parsed);
        break;
      case "clean":
        await runCleanup(parsed);
        break;
      case "validate":
        await runValidate(parsed);
        break;
      case "ui":
        await runUi(parsed);
        break;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;
      case "version":
      case "--version":
      case "-V": {
        const path = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const { promises: fs } = await import("node:fs");
        const cliPkgPath = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "package.json",
        );
        try {
          const pkg = JSON.parse(await fs.readFile(cliPkgPath, "utf8"));
          console.log(pkg.version ?? "unknown");
        } catch {
          console.log("unknown");
        }
        break;
      }
      default:
        console.error(`❌ Unknown command: ${parsed.command}`);
        console.error(`   This command does not exist.`);
        console.error(`   Run "agentarena --help" to see available commands.`);
        process.exit(1);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (parsed?.verbose && error instanceof Error) {
      console.error(`\n❌ Error: ${message}`);
      console.error(`\nStack trace:`);
      console.error(error.stack);
    } else {
      console.error(`\n❌ Error: ${message}`);
    }

    if (message.includes("ENOENT") || message.includes("does not exist")) {
      console.error("\n💡 Hint: check if the file path is correct.");
    } else if (message.includes("Unknown agent")) {
      console.error('\n💡 Hint: run "agentarena list-adapters" to see available agents.');
    } else if (message.includes("Missing required")) {
      console.error('\n💡 Hint: run "agentarena --help" for usage information.');
    } else if (message.includes("EADDRINUSE") || message.includes("already in use")) {
      // Already handled by ui.ts with specific port suggestion
    } else if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      console.error("\n💡 Hint: check your network connection and API endpoint.");
    } else if (message.includes("401") || message.includes("Unauthorized") || message.includes("authentication")) {
      console.error("\n💡 Hint: check your API key. Run 'agentarena doctor --probe-auth' to diagnose.");
    } else if (message.includes("403") || message.includes("Forbidden")) {
      console.error("\n💡 Hint: your API key may lack required permissions.");
    } else if (message.includes("429") || message.includes("rate limit")) {
      console.error("\n💡 Hint: rate limited. Wait a moment and try again.");
    }

    if (!parsed?.verbose) {
      console.error(
        '\n💡 Use --verbose for detailed error information.',
      );
    }

    process.exitCode = 1;
  }
}

main().catch(() => { process.exitCode ??= 1; });
