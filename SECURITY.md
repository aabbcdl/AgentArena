# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in RepoArena, please report it responsibly.

**Email**: Open a private security advisory via [GitHub Security Advisories](https://github.com/aabbcdl/RepoArena/security/advisories/new).

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Scope

RepoArena is a local-first CLI tool. The primary attack surface is:

- The local HTTP server started by `repoarena ui` (binds to `127.0.0.1` by default)
- Task pack files (YAML/JSON) that define shell commands executed during benchmarks
- Agent adapter processes spawned during benchmark runs

## Trust Model

- **Task packs are trusted code.** They can define arbitrary shell commands that execute in the workspace. Only use task packs from sources you trust.
- **The UI server is local-only.** It binds to `127.0.0.1` and includes CORS protection, but is not designed for network-exposed deployment.
- **Provider secrets** are stored locally using the OS credential manager (Windows) or file-based storage with restricted permissions (Linux/macOS).

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
