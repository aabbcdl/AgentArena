# Troubleshooting

Common issues and how to fix them.

## Installation

### "agentarena: command not found"

After `npm install -g @agentarena/cli`, the binary may not be in your PATH.

**Fix:**
```bash
# Check where npm installed it
npm list -g @agentarena/cli

# If it's installed but not found, add npm's global bin to your PATH
npm config get prefix
# Add the <prefix>/bin directory to your PATH environment variable
```

On Windows, npm's global bin is typically `%APPDATA%\npm`.

### "Unsupported engine" or Node version errors

AgentArena requires Node.js 22 or later.

**Fix:**
```bash
node --version
# If below 22, update Node from https://nodejs.org
# Or use nvm:
nvm install 22
nvm use 22
```

### pnpm install fails with peer dependency errors

If you're building from source:

```bash
pnpm install --no-strict-peer-dependencies
```

## Agent Authentication

### "Agent not ready" or "Authentication failed"

This is the most common issue. Each agent CLI has its own authentication method.

**Diagnose:**
```bash
agentarena doctor --agents codex,claude-code --probe-auth
```

This checks each agent's auth status and tells you exactly what's wrong.

**Common fixes by agent:**

| Agent | Auth method | Fix |
|-------|-------------|-----|
| `codex` | OpenAI API key | `export OPENAI_API_KEY=sk-...` |
| `claude-code` | Anthropic API key or OAuth | `export ANTHROPIC_API_KEY=sk-ant-...` or run `claude` once to complete OAuth |
| `cursor` | Cursor desktop app | Open Cursor desktop app, sign in, then retry |
| `gemini-cli` | Google OAuth | Run `gemini` once to complete OAuth flow |
| `aider` | Model-specific keys | Set the appropriate key for your model (e.g., `OPENAI_API_KEY` for GPT) |
| `copilot` | GitHub Copilot subscription | Run `gh auth login` with a Copilot-enabled account |

### "probeAuth timed out"

The auth probe took too long. This usually means the agent CLI is hanging on an interactive prompt.

**Fix:** Run the agent CLI manually first to complete any pending auth flows:
```bash
codex --help
claude --help
```

## Benchmark Runs

### "Task pack validation failed"

Your task pack YAML/JSON has a schema error.

**Fix:** Check the error message for the specific field. Common issues:
- Missing required `id` field
- Missing `judges` array
- Invalid judge type (must be one of: `command`, `test-result`, `lint-check`, `file-exists`, etc.)

Validate manually:
```bash
agentarena run --repo . --task your-task.yaml --agents demo-fast --json 2>&1 | head -5
```

### "Repository path does not exist"

The `--repo` path is wrong.

**Fix:**
```bash
# Use absolute path
agentarena run --repo /full/path/to/repo --task my-task.yaml --agents demo-fast

# Or use . for current directory
agentarena run --repo . --task my-task.yaml --agents demo-fast
```

### Run hangs or takes forever

Possible causes:
1. Agent CLI is waiting for interactive input (shouldn't happen with `shell: false`)
2. Agent is making many API calls for a complex task
3. Network issues with the agent's API provider

**Fix:**
- Check if the agent CLI works standalone: `codex "say hello"`
- Use `--debug` flag to see detailed adapter communication
- Set a token budget: `--token-budget 10000`

### "Unknown agent" error

The agent ID you specified isn't registered.

**Fix:**
```bash
agentarena list-adapters
```

Use the exact IDs from this list. Common mistakes:
- `Claude-Code` → should be `claude-code` (lowercase)
- `gpt4` → should be `codex` (the adapter name, not the model)

## Windows-Specific Issues

### "EPERM" or permission errors

Windows file locking can cause issues when agents write to files.

**Fix:**
- Close any editors that have the benchmark repo open
- Run PowerShell as Administrator if needed
- Add `--cleanup-workspaces` to clean up after runs

### Path separator issues

AgentArena handles `/` and `\` correctly, but if you see path errors:

**Fix:** Use forward slashes even on Windows:
```bash
agentarena run --repo D:/projects/myrepo --task my-task.yaml --agents demo-fast
```

### "spawn UNKNOWN" errors

Some agent CLIs may not be in the Windows PATH.

**Fix:**
```bash
# Check if the agent is in PATH
where codex
where claude

# If not found, add the agent's install directory to PATH
```

## UI Server

### Port already in use

```
Error: listen EADDRINUSE: address already in use 127.0.0.1:4320
```

**Fix:**
```bash
# Use a different port
agentarena ui --port 4321
```

### Can't access UI from another machine

By default, the UI binds to `127.0.0.1` (localhost only).

**Fix:**
```bash
agentarena ui --host 0.0.0.0 --auth-token my-secret-password
```

> **Security note**: Always set `--auth-token` when binding to a non-localhost address.

### "Authentication failed" when accessing UI

The UI requires an auth token for non-localhost access.

**Fix:** Check the terminal output for `auth_token_file=...`, read that file, or set your own:
```bash
agentarena ui --auth-token my-secret
```

Then open `http://127.0.0.1:4320` and paste the token if the UI asks for it.

## Scoring

### Scores seem wrong or unexpected

1. Check which scoring mode is being used:
   ```bash
   agentarena run --repo . --task my-task.yaml --agents demo-fast --score-mode practical
   ```

2. Review the score breakdown in `summary.json` under `results[].scoreDetails`

3. See [Scoring Deep Dive](./scoring.md) for how each component is computed

### "No applicable weights" warning

Some scoring components were skipped because the data wasn't available (e.g., no token usage data, no SWE-bench resolution rate).

**This is normal.** The remaining weights are redistributed. The score is still valid.

## Still Stuck?

1. Run with `--debug` for detailed output:
   ```bash
   agentarena run --repo . --task my-task.yaml --agents demo-fast --debug
   ```

2. Run with `--verbose` for stack traces on errors:
   ```bash
   agentarena run --repo . --task my-task.yaml --agents demo-fast --verbose
   ```

3. Check the [GitHub Issues](https://github.com/aabbcdl/AgentArena/issues) for known problems

4. File a new issue with:
   - Your OS and Node version (`node --version`)
   - The command you ran
   - The full error output (use `--verbose`)
