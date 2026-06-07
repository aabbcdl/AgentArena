# ADR-001: Adapter-to-External-CLI Contract

**Status:** Accepted
**Date:** 2026-06-07
**Deciders:** Original author (undocumented, reconstructed from code)

## Context

AgentArena benchmarks AI coding agents by invoking their CLIs as subprocesses and parsing stdout. The parsers in `packages/adapters/src/event-parsers.ts` depend on undocumented, vendor-controlled JSON output formats from:

- **Claude Code** (`claude` CLI) — stream-json mode
- **Codex** (`codex` CLI) — JSON event stream
- **Gemini** (`gemini` CLI) — stream-json mode

This creates a fragile coupling: if any CLI changes field names or event types, the parser **silently returns zero results** (tokenUsage: 0, empty changedFiles) with no warning.

## Decision

### 1. Event Schema Dependencies

#### Codex CLI (`parseCodexEvents`)

Expected JSON-per-line events:

| Event Type | Key Fields | Purpose |
|------------|-----------|---------|
| `thread.started` | `thread_id` (string) | Session tracking |
| `item.completed` | `item.type === "agent_message"`, `item.text` | Summary extraction |
| `item.completed` | `item.type === "file_change"`, `item.changes[].path` | Changed files |
| `turn.completed` | `usage.input_tokens`, `usage.cached_input_tokens`, `usage.output_tokens` | Token counting |

Additionally, `extractNestedStringValues` recursively walks the JSON tree looking for normalized keys:
- `modelname`, `modelslug`, `model` → effective model
- `modelreasoningeffort`, `reasoningeffort`, `reasoninglevel` → reasoning effort

#### Claude Code / Gemini CLI (`parseStreamJsonEvents`)

Expected JSON-per-line events:

| Event Type | Key Fields | Purpose |
|------------|-----------|---------|
| _(any)_ | `session_id` | Session tracking |
| _(any)_ | `message.content[]` with `type: "text"` | Summary extraction |
| _(any)_ | `message.content[]` with `type: "tool_use"`, `name`, `input` | Tool call tracking |
| _(any)_ | `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` | Per-message token counting |
| `result` | `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` | **Final cumulative** token count (replaces running total) |
| `result` | `total_cost_usd` (number), `is_error` (boolean) | Cost and error tracking |
| `result` | `result` (string) | Final summary |

**Critical semantic:** When `type === "result"` arrives, the token count **replaces** the running total (not adds to it) to avoid double-counting. If the `result` event is missing (some CLI versions), the per-message running total is used as fallback.

### 2. CLI Flag Sequence

The `StreamJsonTransport` in `packages/adapters/src/transport.ts` uses these flags:

```
-p --output-format stream-json --verbose --permission-mode bypassPermissions --no-session-persistence
```

| Flag | Why | Documented? |
|------|-----|------------|
| `-p` | Pipe prompt from stdin | Yes |
| `--output-format stream-json` | Structured JSON output | Yes |
| `--verbose` | Required for full structured output | **No** — undocumented requirement |
| `--permission-mode bypassPermissions` | Skip interactive permission prompts | **No** — internal flag |
| `--no-session-persistence` | Don't save session state | Yes |

### 3. Transport Fallback Thresholds

`StreamJsonTransport.shouldFallback()` triggers fallback to `TextTransport` when:

- Timeout + < 100 bytes of stdout → likely provider incompatibility
- Exit code other than 0 or 1 → unexpected failure mode

These thresholds are empirical, based on observed Claude Code behavior with third-party providers.

### 4. `changedFilesHint` Semantics

Different adapters populate `changedFilesHint` differently:

| Adapter | Source | Rationale |
|---------|--------|-----------|
| Claude Code | Always returns `[]` | Uses runner's snapshot-based diff instead |
| Codex | Parsed from `item.completed` events with `type === "file_change"` | Events provide real-time file changes |
| Base CLI adapter | `git diff --name-only HEAD` | Git-based detection |

The runner's `buildChangedFiles()` merges `changedFilesHint` with the snapshot diff. If `diffReliable` is false (snapshot failed), the hint becomes the primary source.

### 5. Model/Runtime Resolution

The `extractNestedStringValues` function normalizes JSON keys by stripping non-alphanumeric characters and lowercasing. This means:
- `"modelName"` → `"modelname"`
- `"model_slug"` → `"modelslug"`
- `"Model Reasoning Effort"` → `"modelreasoningeffort"`

The normalized keys are looked up against hardcoded strings. There is no schema validation.

## Consequences

- Any CLI version update can silently break token counting and cost tracking
- The `result` event's "replace vs add" semantic is critical but fragile
- `--verbose` and `--permission-mode bypassPermissions` are undocumented flags that could be removed
- The 100-byte threshold for fallback is a magic number based on empirical observation
- No contract tests exist against real CLI output samples

## Mitigations

1. Store sample CLI output fixtures in `tests/fixtures/` for each supported CLI version
2. Add contract tests that validate parsers against fixtures
3. Log warnings when expected fields are missing (not just silently return 0)
4. Pin CLI version expectations in adapter config
