# Repository Working Rules

## Primary objective

Work efficiently in this repository with high signal and low waste:
- minimize unnecessary token-heavy exploration
- preserve correctness over convenience
- prefer structural discovery before broad file reading
- verify implementation details in source before making strong claims

## Core tool policy

Use GitNexus first for:
- understanding unfamiliar modules
- discovering symbol relationships
- tracing callers, callees, and execution flow
- estimating blast radius before edits
- analyzing cross-file impact
- multi-file refactors or renames
- diff-to-impact analysis after larger edits

Use grep/read first for:
- exact string matches
- regex searches
- quick lookup in a known file
- line-level verification
- checking a tiny local detail after the relevant file is already known
- cases where GitNexus is unavailable, stale, or inconclusive

## Preferred exploration workflow

When the task involves codebase understanding or non-trivial edits, use this order:

1. Use GitNexus `query` to find the most relevant symbols, files, or modules.
2. Use GitNexus `context` to inspect callers, callees, related symbols, and nearby structure.
3. Before significant edits, use GitNexus `impact` to estimate blast radius.
4. Only then open the minimum necessary files and read the minimum necessary code.
5. Use grep only for exact text confirmation, regex, or very local verification.
6. After broader edits, use `detect_changes` or an equivalent diff-aware check.

## Quality guardrails

- Do not start with broad repo-wide grep if GitNexus can narrow the search first.
- Do not claim runtime behavior from a graph path alone.
- Treat GitNexus relationship paths as structural hints until source code confirms them.
- If GitNexus suggests a call chain, verify critical links in actual code before presenting them as fact.
- If GitNexus results are thin or ambiguous, escalate to targeted source reading rather than broad searching.
- If multiple repositories are indexed, specify the repo explicitly instead of retrying ambiguous commands.
- Before multi-file changes, always estimate impact first.
- After edits, validate with the smallest relevant test or verification command.

## Decision rules: when to use which

Choose GitNexus first when:
- the code is unfamiliar
- the question is “who calls this”, “what does this affect”, “where is the entry point”
- the task spans multiple files
- the task involves architecture, dependencies, or relationships
- you need a fast structural map before deeper reading

Choose grep/read first when:
- the user gave an exact file
- the user gave an exact string or regex target
- the task is a tiny local check
- you already know the relevant file and only need confirmation
- you need exact implementation details, edge cases, or behavioral nuance

## How to combine them

Best practice is not GitNexus-only or grep-only.

Use GitNexus to narrow the search area quickly.
Then use targeted grep/read to confirm semantics, edge cases, and exact behavior.
Summaries should clearly separate:
- graph-indicated structure
- code-verified behavior

## Editing behavior

Before editing:
- identify target symbols and likely affected files
- estimate impact for non-trivial changes

During editing:
- avoid unrelated churn
- keep changes scoped and consistent with repository style

After editing:
- inspect diff impact
- run the smallest relevant validation
- summarize affected files, risks, and any unverified assumptions

## Output style

For exploration tasks:
- first provide a concise structural summary
- then deepen only where the task requires

For implementation tasks:
- summarize what changed
- summarize why those files were chosen
- summarize impact, validation, and remaining risk

## Project-specific skills

This repo already keeps several project skills under `.skills/`. Add the following Codex repo skills for current gaps:

- `agentarena-adapter-readiness`: 外部 agent 可用性、登录态、doctor 和 adapter 列表问题
- `agentarena-report-replay-triage`: 报告页、回放、trace 和结果渲染排查

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **RepoArena** (6666 symbols, 11746 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/RepoArena/context` | Codebase overview, check index freshness |
| `gitnexus://repo/RepoArena/clusters` | All functional areas |
| `gitnexus://repo/RepoArena/processes` | All execution flows |
| `gitnexus://repo/RepoArena/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
