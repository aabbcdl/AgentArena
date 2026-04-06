export interface ParsedArgs {
  command?: string;
  repoPath?: string;
  taskPath?: string;
  agentIds: string[];
  codexModel?: string;
  codexReasoning?: string;
  claudeProfile?: string;
  claudeModel?: string;
  geminiModel?: string;
  aiderModel?: string;
  kiloModel?: string;
  opencodeModel?: string;
  qwenModel?: string;
  copilotModel?: string;
  outputPath?: string;
  locale?: string;
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
  scoreMode?: string;
  tokenBudget?: number;
  categories?: string[];
  rotationId?: string;
}

export function printHelp(): void {
  console.log(`RepoArena CLI - AI Agent Benchmarking Framework

Usage:
  repoarena <command> [options]

Commands:
  run              Run a benchmark against a repository
  doctor           Check adapter availability and authentication
  list-adapters    List all available adapters and their capabilities
  init             Quick start: detect agents, generate demo taskpack, and run
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

  Scoring Options:
    --score-mode <mode>        Scoring mode (practical, balanced, issue-resolution, efficiency-first, rotating-tasks, comprehensive)
    --token-budget <n>         Token budget limit for efficiency scoring
    --categories <list>        Comma-separated task categories to include

  Scoring Mode Descriptions:
    practical                  Focus on practical correctness (default)
    balanced                   Balanced scoring for general use
    issue-resolution           SWE-Bench inspired: focus on issue resolution
    efficiency-first           CursorBench inspired: focus on token efficiency
    rotating-tasks             LiveBench inspired: balanced across categories
    comprehensive              Unified mode combining all signals

  Codex Options:
    --codex-model <model>      Override the Codex model (e.g., gpt-5.4)
    --codex-reasoning <value>  Set reasoning effort (low, medium, high)

  Claude Code Options:
    --claude-profile <id>      Use a specific Claude provider profile
    --claude-model <model>     Override the Claude model

  Other Agent Model Options:
    --gemini-model <model>     Override the Gemini CLI model (e.g., gemini-2.5-pro)
    --aider-model <model>      Override the Aider model (e.g., claude-sonnet-4-20250514)
    --kilo-model <model>       Override the Kilo CLI model (e.g., gpt-5.4)
    --opencode-model <model>   Override the OpenCode model (e.g., gpt-5.4)
    --qwen-model <model>       Override the Qwen Code model (e.g., qwen-max)
    --copilot-model <model>    Override the Copilot CLI model (if supported)

Doctor Command:
  repoarena doctor [options]

  Options:
    --agents <list>            Comma-separated list of agents to check (default: all)
    --probe-auth               Test authentication for each adapter
    --strict                   Exit with error if any adapter is not ready
    --json                     Output results as JSON

List Adapters Command:
  repoarena list-adapters [--json]

Init Command:
  repoarena init [options]

  Options:
    --repo <path>              Path to the repository (default: current directory)
    --output <path>            Task pack output path (default: repoarena.taskpack.yaml)
    --agents <list>            Comma-separated list of agents to benchmark (default: detected)
    --force                    Overwrite existing task pack

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
    --port <port>              Server port (default: 4320)
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
  repoarena ui --host 127.0.0.1 --port 4320

For more information, visit: https://github.com/aabbcdl/RepoArena
`);
}

export function parseArgs(argv: string[]): ParsedArgs {
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
      case "--locale": {
        const locale = args.shift();
        if (!locale) {
          throw new Error("--locale requires a language tag. Example: --locale zh-CN");
        }
        if (!["en", "zh-CN"].includes(locale)) {
          throw new Error(`--locale must be one of: en, zh-CN. Got: ${locale}`);
        }
        parsed.locale = locale;
        break;
      }
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
      case "--gemini-model":
        parsed.geminiModel = args.shift();
        if (!parsed.geminiModel) {
          throw new Error("--gemini-model requires a model name. Example: --gemini-model gemini-2.5-pro");
        }
        break;
      case "--aider-model":
        parsed.aiderModel = args.shift();
        if (!parsed.aiderModel) {
          throw new Error("--aider-model requires a model name. Example: --aider-model claude-sonnet-4-20250514");
        }
        break;
      case "--kilo-model":
        parsed.kiloModel = args.shift();
        if (!parsed.kiloModel) {
          throw new Error("--kilo-model requires a model name. Example: --kilo-model gpt-5.4");
        }
        break;
      case "--opencode-model":
        parsed.opencodeModel = args.shift();
        if (!parsed.opencodeModel) {
          throw new Error("--opencode-model requires a model name. Example: --opencode-model gpt-5.4");
        }
        break;
      case "--qwen-model":
        parsed.qwenModel = args.shift();
        if (!parsed.qwenModel) {
          throw new Error("--qwen-model requires a model name. Example: --qwen-model qwen-max");
        }
        break;
      case "--copilot-model":
        parsed.copilotModel = args.shift();
        if (!parsed.copilotModel) {
          throw new Error("--copilot-model requires a model name. Example: --copilot-model copilot");
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
          throw new Error("--port requires a port number. Example: --port 4320");
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
      case "--score-mode": {
        parsed.scoreMode = args.shift();
        if (!parsed.scoreMode) {
          throw new Error("--score-mode requires a mode. Options: practical, balanced, issue-resolution, efficiency-first, rotating-tasks, comprehensive");
        }
        // Valid modes matching scoring.ts definitions
        const validModes = ["practical", "balanced", "issue-resolution", "efficiency-first", "rotating-tasks", "comprehensive"];
        if (!validModes.includes(parsed.scoreMode)) {
          throw new Error(`--score-mode must be one of: ${validModes.join(", ")}. Got: ${parsed.scoreMode}`);
        }
        break;
      }
      case "--token-budget": {
        const budgetValue = args.shift();
        if (!budgetValue) {
          throw new Error("--token-budget requires a number. Example: --token-budget 50000");
        }
        const value = Number.parseInt(budgetValue, 10);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`--token-budget must be a positive integer. Got: ${budgetValue}`);
        }
        parsed.tokenBudget = value;
        break;
      }
      case "--categories": {
        const categoriesValue = args.shift();
        if (!categoriesValue) {
          throw new Error("--categories requires a comma-separated list. Example: --categories coding,math,reasoning");
        }
        parsed.categories = categoriesValue
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        if (parsed.categories.length === 0) {
          throw new Error("--categories list cannot be empty. Example: --categories coding,math,reasoning");
        }
        break;
      }
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break; // eslint-disable-line no-fallthrough
      case "--version":
      case "-v":
        parsed.command = "version";
        return parsed;
      default:
        throw new Error(
          `Unknown argument: ${token}\n` +
          `Run "repoarena --help" for usage information.`
        );
    }
  }

  return parsed;
}
