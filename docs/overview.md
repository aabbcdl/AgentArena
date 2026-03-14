# RepoArena Overview

## What RepoArena Is
RepoArena is a local-first evaluation and replay tool for AI coding agents.

It lets you run multiple agents against the same repository task, inspect what they changed, compare outcomes, and export a shareable report.

The intended manual entry point is `repoarena ui`, which starts a local service and gives you a browser-based launcher plus report view in one place. Opening existing result files is a fallback path, not the primary workflow.

## Core Use Case
Most teams evaluating coding agents still rely on anecdotes, screenshots, or one-off experiments.

RepoArena is built to answer a more useful question:

Which agent performs best on real tasks inside my repository, under the same constraints?

## Current Scope
The current version focuses on a runnable local benchmark loop:
- a browser-based local launcher through `repoarena ui`
- adapter preflight checks
- adapter capability matrix with support tiers
- isolated workspaces per run
- versioned task pack loading
- JSON and YAML task pack support
- task pack metadata and an official task pack library
- task-level environment allowlists
- step-level environment overrides for setup, judges, and teardown
- built-in command, file, glob, snapshot, and JSON judges
- diff detection
- JSON, Markdown, PR comment, badge, static HTML, and interactive web report generation
- support for demo adapters plus external CLI-based adapters

## Recommended Workflow

For manual use:
- run `repoarena ui`
- choose a repository path
- choose an official task pack or provide your own
- select one or more agents or Codex variants
- run the benchmark
- inspect the result in the same page

For CI or scripts:
- use `repoarena doctor`
- use `repoarena run`
- publish `summary.md`, `pr-comment.md`, `badge.json`, or `report.html`

## Design Principles

### Repo-native
The benchmark should run against a real codebase, not a toy prompt.

### Replayable
If a result looks surprising, you should be able to inspect the trace and understand why it happened.

### Adapter-driven
Different coding agents should plug into the same execution and reporting model.

### Honest About Readiness
If an agent is blocked by missing authentication or local setup, RepoArena should report that clearly instead of pretending the benchmark was fair.

## Near-term Priorities
- expand stable real-agent support
- improve capability transparency and fairness documentation
- improve the `repoarena ui` launch flow and progress feedback
- add stronger CI bootstrap and task-pack onboarding paths
