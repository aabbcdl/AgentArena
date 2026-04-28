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
