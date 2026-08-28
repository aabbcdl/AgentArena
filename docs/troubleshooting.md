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

### "Claude Code cannot run safely in the background"

AgentArena 需要 Claude Code 支持 `--permission-mode dontAsk` 和 `--no-session-persistence`。这个模式会拒绝无法无提示授权的工具调用，不会跳过全部权限检查。

**处理：**升级 Claude Code，确认 `claude --help` 同时包含这两个参数，然后在 Environment 页重新执行三阶段验证。不要设置旧的 `AGENTARENA_SKIP_PERMISSIONS`；AgentArena 已忽略该变量，也不会追加 `--dangerously-skip-permissions`。

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

### "This Claude Code version cannot guarantee isolated third-party Provider execution"

这条信息只来自旧 launcher 的 Claude-only Provider 兼容路径，该路径仍使用临时隔离配置。

**处理：**优先在新 Workbench Environment 页创建 managed RuntimeProfile；它继承正常 Harness，不要求 strict MCP 隔离。若必须使用旧兼容路径，则升级 Claude Code，确认 `claude --help` 中包含 `--setting-sources`、`--strict-mcp-config` 和 `--no-session-persistence`。

### "extraEnv cannot override reserved runtime fields"

Provider 的附加环境中包含保留的运行控制字段，例如 `CLAUDE_CONFIG_DIR`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、系统路径或主目录字段。

**处理：**删除错误信息列出的字段。地址、模型和密钥使用 RuntimeProfile 的专用输入项填写；AgentArena 会在任务子进程中注入，不会写入用户全局 CLI 配置。

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

By design the UI only binds to local addresses (`127.0.0.1`, `localhost`, `::1`, `::ffff:127.0.0.1`). Remote / LAN access via `--host 0.0.0.0` is **not supported**.

**Fix:** Run the UI on the same machine as the browser:

```bash
agentarena ui --host 127.0.0.1
```

Open `http://127.0.0.1:4320`. For multi-machine use, run AgentArena on each machine or use SSH port forwarding to localhost.

### "Authentication failed" when accessing UI

敏感 API 路径仍由 Bearer Token 保护，但普通用户不需要手动查找它。首次打开 Workbench 的“运行环境”页时，直接设置一个本地服务密码；之后输入这个密码即可登录。密码只保存在本机 `.agentarena/ui-auth.json` 的哈希中。

**Fix:** 在“运行环境”页设置或输入密码。当前这台本地 Pilot 使用的密码是 `admin`。

如果需要脚本或兼容旧流程，仍可显式指定 Bearer Token：
```bash
agentarena ui --auth-token my-secret
```

也可以使用本地开发变量：
```powershell
$env:AGENTARENA_LOCAL_AUTH_TOKEN = "admin"
agentarena ui
```
该变量只对本机启动生效；如果未设置变量，首次启动会让 Workbench 设置密码。自动打开浏览器时仍会使用一次性 bootstrap，手动打开时不再要求用户读取 token 文件。

然后打开 `http://127.0.0.1:4320`。

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
