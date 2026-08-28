# Adapter Development Guide

This guide explains how to add a new AI coding agent adapter to AgentArena. It covers the two adapter patterns, the event-stream parsing contract, transport fallback, and testing requirements.

## Architecture Overview

```
packages/adapters/src/
├── adapter-registry.ts      ← Central registry — all adapters are registered here
├── adapter-capabilities.ts   ← Capability metadata and support tiers
├── base-cli-adapter.ts       ← Factory for CLI-based adapters (createCliAdapter)
├── event-parsers.ts          ← JSON event stream parsers (Codex, Claude, Gemini)
├── transport.ts              ← Transport abstraction with fallback chain
├── install-guides.ts         ← Declarative install/detection guides
├── codex-adapter.ts          ← Custom adapter (rich event parsing)
├── claude-adapter.ts         ← Custom adapter (transport chain)
├── kilo-adapter.ts           ← Simple adapter (via createCliAdapter)
├── ...
```

Every adapter implements the `AgentAdapter` interface:

```typescript
interface AgentAdapter {
  id: string;                              // Unique identifier (e.g. "kilo-cli")
  title: string;                           // Display name (e.g. "Kilo CLI")
  kind: "demo" | "external";               // Built-in demo or external CLI
  capability: AdapterCapability;           // Metadata matrix
  preflight(options?): Promise<AdapterPreflightResult>;  // Readiness check
  execute(context): Promise<AdapterExecutionResult>;     // Run the agent
}
```

## Two Adapter Patterns

### Pattern A: Simple CLI Adapter (recommended for most new adapters)

Use `createCliAdapter()` from `base-cli-adapter.ts`. This factory handles preflight probing, process spawning, prompt piping, and git-based changed-file detection. You only provide configuration.

**Example** (`kilo-adapter.ts` — 37 lines total):

```typescript
import type { AdapterCapability, AgentAdapter, AgentResolvedRuntime } from "@agentarena/core";
import { createCliAdapter } from "./base-cli-adapter.js";

export const KILO_CAPABILITY: AdapterCapability = {
  supportTier: "experimental",
  invocationMethod: "Kilo CLI headless mode",
  authPrerequisites: ["Kilo CLI installed and authenticated with an API key."],
  tokenAvailability: "available",
  costAvailability: "unavailable",
  traceRichness: "partial",
  configurableRuntime: { model: true, reasoningEffort: false },
  knownLimitations: ["Token usage and cost are not reported by the CLI."]
};

export function createKiloAdapter(): AgentAdapter {
  return createCliAdapter({
    id: "kilo-cli",
    title: "Kilo CLI",
    command: "kilo",
    commandArgs: ["-p"],
    capability: KILO_CAPABILITY,
    binEnvVar: "AGENTARENA_KILO_BIN",  // Optional: custom binary path override
    extraArgs: (runtime: AgentResolvedRuntime) =>
      runtime.effectiveModel ? ["--model", runtime.effectiveModel] : []
  });
}
```

#### `CliAdapterConfig` options

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique adapter ID (kebab-case) |
| `title` | Yes | Human-readable display name |
| `command` | Yes | CLI command name (e.g. `"kilo"`) |
| `commandArgs` | Yes | Arguments for headless execution |
| `capability` | Yes | `AdapterCapability` metadata |
| `binEnvVar` | No | Environment variable for custom binary path (e.g. `"AGENTARENA_KILO_BIN"`) |
| `parseTokenUsage` | No | Callback to extract token count from stdout |
| `parseSummary` | No | Callback to extract summary from stdout/stderr/exitCode |
| `parseDataQualityWarning` | No | Callback to detect output format mismatches |
| `extraArgs` | No | Callback to append runtime-dependent args (model selection, etc.) |
| `beforeExecute` | No | Hook to run before CLI starts (e.g. `git init` for aider) |
| `resolveRuntime` | No | Hook to override runtime resolution in preflight and execute |

The factory automatically:
- Probes `--help` to verify the CLI is installed (preflight)
- Resolves the binary path (checks `binEnvVar`, appends `.cmd` on Windows)
- Pipes the prompt via stdin
- Captures stdout/stderr/exitCode
- Runs `git diff --name-only HEAD` for changed-file detection
- Returns an `AdapterExecutionResult` with all fields populated

### Pattern B: Custom Adapter (for complex CLIs with rich event streams)

Implement `AgentAdapter` directly when you need:
- Structured JSON event stream parsing (token usage, tool calls, cost)
- Multi-transport fallback (e.g. stream-json → text)
- Custom preflight logic (auth probing, config validation)

**Examples**: `codex-adapter.ts`, `claude-adapter.ts`

A custom adapter typically:
1. Resolves the CLI invocation (binary path, args)
2. Spawns the process with appropriate flags
3. Parses stdout as a JSON event stream (using `parseCodexEvents` or `parseStreamJsonEvents`)
4. Extracts token usage, cost, summary, changed files, and runtime info
5. Detects data quality issues (format mismatch, suspicious zero tokens)

See `codex-adapter.ts` and `claude-adapter.ts` for complete reference implementations.

## Capability Metadata

Every adapter declares an `AdapterCapability` object. This drives the `doctor` command, `list-adapters`, reports, and the web UI.

```typescript
interface AdapterCapability {
  supportTier: "supported" | "experimental" | "blocked";
  invocationMethod: string;               // e.g. "Codex CLI JSON event stream"
  authPrerequisites: string[];            // e.g. ["Codex CLI installed and authenticated."]
  tokenAvailability: "available" | "estimated" | "unavailable";
  costAvailability: "available" | "unavailable";
  traceRichness: "full" | "partial" | "minimal";
  knownLimitations: string[];
  configurableRuntime?: {
    model: boolean;
    reasoningEffort: boolean;
    providerProfile?: boolean;
  };
}
```

### Support Tiers

- **`supported`**: Verified standard integration. Stable enough for automated runs.
- **`experimental`**: Usable but sensitive to local auth, CLI flag changes, or install layout. May break without warning.
- **`blocked`**: Intentionally not treated as stable automation (e.g. auth stability issues).

Be honest about limitations — `knownLimitations` helps users interpret results correctly.

## Registration

After creating your adapter file, register it in `adapter-registry.ts`:

```typescript
import { createMyAdapter } from "./my-adapter.js";

// Add to the adapterEntries array:
const adapterEntries: Array<[string, AgentAdapter]> = [
  // ...existing adapters...
  registerAdapter(createMyAdapter()),
];
```

The registry checks for duplicate IDs at startup and throws if collisions are found.

## Install Guides

Add a declarative install guide in `install-guides.ts` so `doctor` and the web UI can detect and help users install your agent:

```typescript
const myGuide: InstallGuide = {
  id: "my-agent",
  displayName: "My Agent",
  homepage: "https://example.com",
  detection: {
    binaryNames: ["my-agent"],
    versionCommand: ["--version"],
    configFiles: [".config/my-agent/config.json"],
  },
  install: {
    // Per-platform install commands
  },
};
```

If no install guide is provided, `detectInstalledAgents()` will report the adapter as "unknown" and users won't get install guidance.

## Event Stream Parsing

### The Contract Problem

AgentArena parses undocumented JSON output from external CLIs. If a CLI changes its field names or event types, the parser **silently returns zero results** — token usage drops to 0, changed files come back empty, and nobody knows why.

This is documented in [ADR-001](adr/ADR-001-adapter-cli-contract.md).

### Format Mismatch Detection

To combat silent data loss, the parsers (`parseCodexEvents` and `parseStreamJsonEvents`) now track whether typed JSON events were recognized:

```typescript
// In event-parsers.ts
const formatMismatch =
  totalTypedEvents > 0 && unrecognizedTypedEvents / totalTypedEvents >= 0.5;
```

When `formatMismatch` is `true`:
- The adapter sets `dataQualityWarning` to a human-readable message
- The adapter sets `tokenUsageReliable: false`
- The runner propagates both to `AgentRunResult`
- The scoring system excludes token-efficiency from the composite score

### What to parse

#### Codex-style event streams (`parseCodexEvents`)

| Event Type | Key Fields | Purpose |
|------------|-----------|---------|
| `thread.started` | `thread_id` | Session tracking |
| `item.completed` | `item.type: "agent_message"`, `item.text` | Summary |
| `item.completed` | `item.type: "file_change"`, `item.changes[].path` | Changed files |
| `turn.completed` | `usage.input_tokens`, `usage.cached_input_tokens`, `usage.output_tokens` | Token counting |

#### Claude/Gemini-style event streams (`parseStreamJsonEvents`)

| Event Type | Key Fields | Purpose |
|------------|-----------|---------|
| _(any)_ | `session_id` | Session tracking |
| _(any)_ | `message.content[]` with `type: "text"` | Summary |
| _(any)_ | `message.content[]` with `type: "tool_use"`, `name` | Tool calls |
| `result` | `usage.{input_tokens, output_tokens, ...}` | **Final cumulative** token count |
| `result` | `total_cost_usd`, `is_error` | Cost and error tracking |

**Critical**: The `result` event's token count **replaces** the running total (not adds to it) to avoid double-counting cache-read tokens across turns.

### Adding a new parser

If your CLI has a unique event format, add a new parser function in `event-parsers.ts` that returns the same shape:

```typescript
{
  tokenUsage: number;
  estimatedCostUsd: number;
  costKnown: boolean;
  summaryFromEvents?: string;
  sessionId?: string;
  toolCalls: ToolCallEvent[];
  tokenCountSuspicious: boolean;      // result event seen but 0 tokens
  tokenUsageFromResultEvent: boolean; // authoritative total was present
  formatMismatch: boolean;            // majority of events unrecognized
}
```

Always implement format mismatch detection — it's the only safety net against silent data loss when the CLI updates.

## Transport Fallback

For CLIs that support multiple output modes (e.g. Claude Code's `stream-json` and `text`), use the `TransportChain` to automatically fall back when the preferred mode fails.

```typescript
import { createClaudeTransportChain } from "./transport.js";

const chain = createClaudeTransportChain(
  invocation,
  isThirdPartyProvider,  // true → add TextTransport as fallback
  extraArgs,
  {
    transportTimeoutMs: 8_000,
    fallbackThresholds: {
      timedOutMinStdoutBytes: 100,    // Fall back if timeout + <100 bytes stdout
      acceptableExitCodes: [0, 1],    // 0=success, 1=task failure (normal)
    }
  }
);

const result = await chain.execute(prompt, cwd, env, signal, callbacks);
```

### Configurable Thresholds

Fallback thresholds are parameterized and can be overridden via environment variables:

| Env Var | Default | Description |
|---------|---------|-------------|
| `AGENTARENA_FALLBACK_MIN_STDOUT_BYTES` | `100` | Minimum stdout bytes when timed out before falling back |
| `AGENTARENA_FALLBACK_ACCEPTABLE_EXIT_CODES` | `0,1` | Comma-separated exit codes that don't trigger fallback |

Programmatic overrides take precedence over defaults but env vars take precedence over both.

## Data Quality and Token Reliability

Your adapter should set these fields when data quality is uncertain:

| Field | When to set | Effect |
|-------|-------------|--------|
| `tokenUsageReliable: false` | Fallback transport used, suspicious zero tokens, or format mismatch | Excludes token-efficiency from composite score |
| `dataQualityWarning: string` | Format mismatch detected | Surfaced in reports; warns users that metrics may be inaccurate |

Example from `codex-adapter.ts`:

```typescript
return {
  status,
  summary,
  tokenUsage: parsed.tokenUsage,
  // ...
  dataQualityWarning: parsed.formatMismatch
    ? "Codex CLI output format changed — token usage and changed-files data may be inaccurate."
    : undefined,
  tokenUsageReliable: parsed.formatMismatch ? false : undefined,
};
```

## Testing Your Adapter

### Unit tests

Add contract tests in `tests/` that validate your parser against sample CLI output:

1. **Save a sample output fixture**: `tests/fixtures/event-parsers/my-agent-sample.jsonl`
2. **Write contract tests**: Create or extend `tests/event-parser-contract.test.mjs`
3. **Test format mismatch detection**: Include test cases for both recognized and unrecognized event schemas
4. **Test data quality propagation**: Extend `tests/result-builder.test.mjs` if you add new result fields

### Quick test suite

Run `pnpm test:quick` for fast feedback (~13 seconds, 500+ tests). This runs pure-logic unit tests without spawning processes or servers. If your tests meet the criteria (under 1 second, no I/O), add them to `scripts/run-quick-tests.mjs`.

### Full test suite

Run `pnpm test` before committing. This runs all tests including integration and e2e.

### Manual verification

```bash
# Check that your adapter is listed
pnpm build && node packages/cli/dist/index.js list-adapters

# Run doctor to verify preflight works
pnpm build && node packages/cli/dist/index.js doctor --agents my-agent

# Run a smoke benchmark
pnpm build && node packages/cli/dist/index.js run \
  --repo . \
  --task examples/taskpacks/demo-repo-health.json \
  --agents my-agent
```

## Common Pitfalls

1. **Silent zero tokens**: If your CLI changes its output format, the parser returns 0 tokens without error. Always implement `formatMismatch` detection and set `tokenUsageReliable: false`.

2. **Windows binary resolution**: On Windows, CLI tools often install as `.cmd` files. The `createCliAdapter` factory handles this automatically (appends `.cmd`), but custom adapters must do it themselves. See `resolveClaudeInvocation()` in `claude-adapter.ts`.

3. **Changed files discrepancy**: Different adapters populate `changedFilesHint` differently. The runner's `buildChangedFiles()` merges hints with the snapshot diff. If your adapter emits file changes in its event stream, use those; otherwise, the base adapter's `git diff` fallback works.

4. **Permission prompts**: An adapter must define a bounded non-interactive mode and fail preflight when the installed CLI cannot support it. Claude Code uses `--permission-mode dontAsk`; never add `--dangerously-skip-permissions` or a host environment switch that enables it.

5. **Timeout handling**: The default transport timeout is 5 minutes (`AGENTARENA_TRANSPORT_TIMEOUT_MS`). Long-running agents may need a longer timeout. Set it via the environment variable.

6. **Duplicate adapter IDs**: The registry throws at startup if two adapters share the same ID. Always use unique kebab-case IDs.

## Checklist for a New Adapter

- [ ] Create `packages/adapters/src/my-agent-adapter.ts`
- [ ] Define `AdapterCapability` with honest metadata
- [ ] Implement adapter via `createCliAdapter()` (simple) or `AgentAdapter` (custom)
- [ ] If custom: implement event stream parsing with `formatMismatch` detection
- [ ] Register in `adapter-registry.ts`
- [ ] Add install guide in `install-guides.ts`
- [ ] Add sample output fixture in `tests/fixtures/event-parsers/`
- [ ] Add contract tests in `tests/event-parser-contract.test.mjs`
- [ ] Update `docs/adapter-capabilities.md` capability matrix
- [ ] Run `pnpm test:quick` — all tests pass
- [ ] Run `pnpm doctor --agents my-agent` — preflight works
- [ ] Run a smoke benchmark — agent executes successfully
