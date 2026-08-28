# Product Telemetry

AgentArena includes minimal product measurement for activation and run completion. It is **opt-in, local-only, and off by default**. Nothing is uploaded.

## Enable or disable

`AGENTARENA_TELEMETRY=1 agentarena ui` enables local recording. Without that value, the runner and both interfaces do not write telemetry events.

Events are appended to `.agentarena/telemetry.jsonl`. A random installation id is kept in `.agentarena/telemetry-installation-id`; it is never transmitted.

To stop recording, unset `AGENTARENA_TELEMETRY` or set it to `0`. To clear history, delete those two local files.

## Events

| Event | Meaning | Decision fields |
| --- | --- | --- |
| `app_opened` | Legacy or Workbench became usable | `entryPoint`, language, coarse availability |
| `run_started` | A benchmark actually began | `entryPoint`, agent count, task id, score mode, auth probe |
| `run_completed` | A run completed, failed, cancelled, or was incompatible | `entryPoint`, outcome, success count, total count, `resultIntegrity` |
| `result_viewed` | A result was opened | `entryPoint`, agent count, score mode, `resultIntegrity`, `hasInlineDiff` |
| `preflight_completed` | Workbench preflight finished | `entryPoint`, `blocked`, `selectedCount` |
| `evidence_opened` | Workbench Evidence page opened for a run | `entryPoint`, `resultIntegrity`, `hasInlineDiff` |

Entry points are intentionally low-cardinality: `cli`, `legacy-launcher`, `legacy-quick-demo`, `workbench-plan`, `legacy`, and `workbench`.

Result integrity is a coarse label such as `complete`, `partial`, or `unavailable`. It describes whether the saved result has the fields needed for interpretation; it is not a score.

## Local summary

`GET /api/telemetry-summary` returns aggregate counts only:

- the four funnel event counts;
- counts by entry point;
- counts by result integrity;
- counts by completion outcome.

Workbench Settings displays the same aggregate. It never returns raw event properties, task content, repository paths, or secrets.

## What is not recorded

- repository paths or source code;
- prompts or task content;
- credentials, tokens, or secrets;
- model or provider names;
- personal identifiers.

All properties pass through key-based redaction before the local JSON line is written. UI events are deduplicated per page lifecycle for `app_opened` and per run id for `result_viewed`.

## Verification

Automated tests cover default-off behavior, file creation only after opt-in, event order, sensitive-key redaction, aggregate summaries, and write failures that must not break a run. The Settings page provides the human-readable debug path.
