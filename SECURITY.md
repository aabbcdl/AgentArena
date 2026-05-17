# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AgentArena, please report it responsibly.

**Email**: Open a private security advisory via [GitHub Security Advisories](https://github.com/aabbcdl/AgentArena/security/advisories/new).

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Scope

AgentArena is a local-first CLI tool. The primary attack surface is:

- The local HTTP server started by `agentarena ui` (binds to `127.0.0.1` by default)
- Task pack files (YAML/JSON) that define shell commands executed during benchmarks
- Agent adapter processes spawned during benchmark runs

## Trust Model

- **Task packs are trusted code.** They can define arbitrary shell commands that execute in the workspace. Only use task packs from sources you trust.
- **Agent CLIs are trusted local programs.** During a benchmark, AgentArena spawns local agent adapters and lets them operate on a copied workspace. Those processes run with the privileges of the current OS user unless you place AgentArena inside a stronger isolation boundary such as a container, VM, or dedicated low-privilege account.
- **The built-in sandbox is an advisory path guard, not a security boundary.** Adapter-facing sandbox helpers validate paths for cooperative adapters, but they do not provide process isolation, network isolation, filesystem mount restrictions, or privilege separation. A local CLI process can bypass those helpers if it does not use them.
- **The UI server is local-only by default.** It binds to `127.0.0.1`, includes token auth for sensitive APIs, CORS protection, and rate limiting, but is not designed for unauthenticated or internet-exposed deployment.
- **Provider secrets** are stored locally using the OS credential manager (Windows) or file-based storage with restricted permissions (Linux/macOS).

## Running Untrusted Inputs

Treat untrusted task packs, adapter plugins, and agent CLIs as untrusted code execution. If you need to evaluate them, run AgentArena inside a container, VM, or disposable account with a minimal workspace mount, no sensitive environment variables, and network access limited to the minimum required for the benchmark.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
