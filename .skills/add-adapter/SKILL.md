---
name: add-adapter
description: Add a new AI coding agent adapter so it can participate in benchmarks. Use when integrating any new CLI-based coding tool (Cursor-like, Copilot alternative, open-source agent, etc.) into the adapter system.
---

# Add Agent Adapter

Integrate a new coding agent into the benchmark adapter ecosystem.

## When to Use

- A new AI coding tool has a CLI that can run non-interactively.
- Users want to compare this tool against existing agents.
- The tool can accept a prompt, modify files, and optionally report token/cost usage.

## Steps

1. Research the target CLI:
   - How to invoke non-interactively (headless / exec / prompt mode)?
   - How to pass the task prompt?
   - How to set the working directory?
   - Does it output token usage in JSON or structured format?
   - How to detect installation and version (`--version`, `--help`)?

2. Create `packages/adapters/src/<agent>-adapter.ts`:
   - Implement the `AgentAdapter` interface with: `id`, `title`, `kind: "external"`, `capability`, `preflight()`, `execute()`.
   - In `capability`, set `supportTier` (`"supported"`, `"experimental"`, or `"blocked"`), `tokenAvailability` (`"available"`, `"estimated"`, or `"unavailable"`), and list `knownLimitations`.
   - Use `buildAgentPrompt(context)` for prompt formatting.
   - Use `runProcess()` for CLI execution with timeout and cancellation support.
   - Use `probeHelp()` and `probeInvocationVersion()` for preflight checks.
   - Support `AGENTARENA_<AGENT>_BIN` environment variable for custom binary path.
   - If the CLI reports token usage, parse it; otherwise estimate or mark as unknown.
   - If the CLI does not support headless mode, return `"blocked"` status with a clear explanation.

3. Register in `packages/adapters/src/adapter-registry.ts`:
   - Import the adapter class.
   - Add to `adapterEntries`: `["<agent-id>", new <Agent>Adapter()]`.

4. If the agent supports model selection, add `--<agent>-model` to `packages/cli/src/args.ts` and handle it in `normalizeCliSelections()` in `packages/cli/src/index.ts`.

5. Verify:
   - `pnpm --filter @agentarena/adapters build`
   - `pnpm --filter @agentarena/cli build`
   - `pnpm test` — existing tests must still pass.

## What to Check Before Committing

- Adapter is registered and `preflight()` returns a meaningful status (not always "blocked" without explanation).
- Token usage reporting method is documented in `knownLimitations` if estimated or unavailable.
- No secrets, API keys, or user data logged to console or trace.
- At least one registration test exists in `tests/adapters-new.test.mjs`.
