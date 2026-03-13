# RepoArena Overview

## What RepoArena Is
RepoArena is a local-first evaluation and replay tool for AI coding agents.

It lets you run multiple agents against the same repository task, inspect what they changed, compare outcomes, and export a shareable report.

## Core Use Case
Most teams evaluating coding agents still rely on anecdotes, screenshots, or one-off experiments.

RepoArena is built to answer a more useful question:

Which agent performs best on real tasks inside my repository, under the same constraints?

## Current Scope
The current version focuses on a runnable local benchmark loop:
- adapter preflight checks
- isolated workspaces per run
- versioned task pack loading
- task-level environment allowlists
- diff detection
- JSON, static HTML, and interactive web report generation
- support for demo adapters plus external CLI-based adapters

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
- expand task pack schema beyond command-based judges
- add richer judges
- improve report UX
- add CI-friendly execution entrypoints
- expand stable real-agent support
