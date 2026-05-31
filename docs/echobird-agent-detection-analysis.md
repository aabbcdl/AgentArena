# EchoBird Agent 检测和安装机制分析

## 📋 核心设计理念

EchoBird 采用了一套完整的 **agent 生命周期管理系统**，包括：
1. **检测** - 判断 agent 是否已安装
2. **安装** - 辅助用户安装 agent
3. **配置** - 自动生成配置文件
4. **验证** - 安装后验证是否可用

---

## 🔍 1. Agent 检测机制

### 1.1 检测方式

EchoBird 使用 **声明式配置 + 后端验证** 的方式：

```json
// docs/api/tools/install/claudecode.json
{
  "id": "claudecode",
  "displayName": "Claude Code (CLI)",
  "install": {
    "curl (macOS / Linux — recommended)": "curl -fsSL https://claude.ai/install.sh | bash",
    "powershell (Windows — recommended)": "irm https://claude.ai/install.ps1 | iex",
    "winget (Windows)": "winget install Anthropic.ClaudeCode"
  },
  "first_run": {
    "description": "Claude Code requires TWO config files...",
    "setup_script": "python3 -c \"...自动配置脚本...\""
  }
}
```

### 1.2 检测流程

1. **前端调用** `getLocalEngineStatus(runtime)` (Tauri API)
2. **后端执行**：
   - 尝试运行 `claude --version` / `codex --version` 等命令
   - 检查配置文件是否存在（如 `~/.claude.json`）
   - 返回状态：`installed: true/false`, `version: "x.y.z"`

3. **返回结果**：
```typescript
interface LocalEngineEntry {
  name: string;
  installed: boolean;      // ✅ 关键：是否已安装
  version: string;         // 当前版本
  latestVersion?: string;  // 最新版本
  installDir?: string;     // 安装目录
  binaryNames?: string[];  // 可执行文件名
}
```

---

## 🛠️ 2. Agent 安装辅助

### 2.1 安装指令库

每个 agent 都有一个 JSON 配置文件，包含：

```json
{
  "install": {
    "curl (macOS / Linux — recommended)": "curl -fsSL https://claude.ai/install.sh | bash",
    "powershell (Windows — recommended)": "irm https://claude.ai/install.ps1 | iex",
    "winget (Windows)": "winget install Anthropic.ClaudeCode",
    "WARNING": "npm install is DEPRECATED. Do NOT use 'npm install -g @anthropic-ai/claude-code'.",
    "note": "After install, first-time setup MUST add allowedTools to settings..."
  }
}
```

### 2.2 安装流程

EchoBird 提供 **一键安装** 功能：

1. **用户点击"安装"按钮**
2. **前端调用** `installLocalEngine(runtime, overrides)`
3. **后端执行**：
   - 根据操作系统选择合适的安装命令
   - 执行安装脚本（如 `irm https://claude.ai/install.ps1 | iex`）
   - 监听安装进度（通过事件系统）
   - 安装完成后自动运行 `first_run.setup_script`

4. **自动配置**：
   - 创建 `~/.claude.json`（跳过 onboarding）
   - 创建 `~/.claude/settings.json`（设置 allowedTools）

---

## 🎯 3. 关键优势

### 3.1 准确的检测

EchoBird 的检测比 AgentArena 更准确，因为：

| 维度 | EchoBird | AgentArena (当前) |
|------|----------|-------------------|
| **检测方式** | 运行 `--version` 命令 + 检查配置文件 | 只运行 preflight API |
| **配置验证** | 检查 `~/.claude.json` 等配置是否存在 | 不检查配置 |
| **版本信息** | 返回具体版本号 | 只返回 ready/error |
| **安装目录** | 返回安装路径 | 不返回 |

### 3.2 辅助安装

EchoBird 提供：
- ✅ 多平台安装命令（Windows/macOS/Linux）
- ✅ 自动配置脚本（first_run.setup_script）
- ✅ 安装进度监听
- ✅ 安装后验证

AgentArena 当前：
- ❌ 只检测，不辅助安装
- ❌ 用户需要手动安装和配置
- ❌ 没有安装指南

### 3.3 配置管理

EchoBird 自动生成配置文件：

```python
# Claude Code 的 first_run.setup_script
import json, os

# Step 1: ~/.claude.json - skip onboarding
cpath = os.path.expanduser('~/.claude.json')
cc = {}
if os.path.exists(cpath):
    with open(cpath) as f: cc = json.load(f)
cc['hasCompletedOnboarding'] = True
with open(cpath, 'w') as f: json.dump(cc, f, indent=2)

# Step 2: ~/.claude/settings.json - tool permissions
spath = os.path.expanduser('~/.claude/settings.json')
os.makedirs(os.path.dirname(spath), exist_ok=True)
sc = {}
if os.path.exists(spath):
    with open(spath) as f: sc = json.load(f)
if 'allowedTools' not in sc:
    sc['allowedTools'] = ['Edit','Write','Bash','Read',...]
with open(spath, 'w') as f: json.dump(sc, f, indent=2)
```

---

## 🔧 4. AgentArena 可以借鉴的地方

### 4.1 改进检测逻辑

**当前问题**：
- Augment Code 没装却显示已安装
- 检测不准确

**改进方案**：

```typescript
// packages/adapters/src/adapter-registry.ts
export async function detectInstalledAgents(): Promise<Map<string, AgentDetectionResult>> {
  const results = new Map();
  
  for (const adapter of listAvailableAdapters()) {
    try {
      // 1. 尝试运行 --version 命令
      const versionResult = await runCommand(`${adapter.command} --version`);
      
      // 2. 检查配置文件（如果需要）
      const configExists = await checkConfigFiles(adapter);
      
      // 3. 综合判断
      const installed = versionResult.success && configExists;
      
      results.set(adapter.id, {
        installed,
        version: parseVersion(versionResult.stdout),
        configValid: configExists,
        installPath: await findInstallPath(adapter)
      });
    } catch (error) {
      results.set(adapter.id, { installed: false, error: error.message });
    }
  }
  
  return results;
}
```

### 4.2 添加安装指南

在 `packages/adapters/src/` 下创建安装配置：

```json
// packages/adapters/src/install-guides/claude-code.json
{
  "id": "claude-code",
  "displayName": "Claude Code (CLI)",
  "install": {
    "windows": {
      "recommended": "irm https://claude.ai/install.ps1 | iex",
      "alternative": "winget install Anthropic.ClaudeCode"
    },
    "macos": {
      "recommended": "curl -fsSL https://claude.ai/install.sh | bash",
      "alternative": "brew install --cask claude-code"
    },
    "linux": {
      "recommended": "curl -fsSL https://claude.ai/install.sh | bash"
    }
  },
  "postInstall": {
    "description": "Create config files to skip onboarding",
    "script": "python3 -c \"import json, os; ...\""
  }
}
```

### 4.3 UI 改进

在前端显示：

```
┌─────────────────────────────────────────┐
│ Claude Code                             │
│ ❌ 未安装                               │
│                                         │
│ 安装方法：                              │
│ Windows: irm https://claude.ai/... | iex│
│ macOS:   curl -fsSL https://... | bash │
│                                         │
│ [📋 复制命令] [📖 查看文档]             │
└─────────────────────────────────────────┘
```

---

## 📊 5. 对比总结

| 功能 | EchoBird | AgentArena (当前) | 建议改进 |
|------|----------|-------------------|----------|
| **检测准确性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 添加 --version 检测 + 配置文件检查 |
| **安装辅助** | ⭐⭐⭐⭐⭐ | ❌ | 添加安装指南 JSON + UI 展示 |
| **配置管理** | ⭐⭐⭐⭐⭐ | ❌ | 提供 postInstall 脚本 |
| **版本信息** | ⭐⭐⭐⭐⭐ | ⭐⭐ | 返回具体版本号 |
| **错误提示** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 更详细的错误信息 |

---

## 🎯 6. 实施建议

### 短期（1-2 周）
1. ✅ 改进检测逻辑：添加 `--version` 命令检测
2. ✅ 修复 Augment Code 误报问题
3. ✅ 在 UI 中显示版本号

### 中期（1 个月）
1. 📝 创建安装指南 JSON 文件
2. 🎨 在 UI 中显示安装命令
3. 📋 添加"复制命令"按钮

### 长期（2-3 个月）
1. 🤖 实现一键安装功能（调用系统命令）
2. ⚙️ 自动生成配置文件（postInstall 脚本）
3. 📊 安装进度监听

---

## 💡 关键发现

### Augment Code 为什么被检测为已安装？

可能原因：
1. **Preflight 检查过于宽松** - 只要命令不报错就认为已安装
2. **没有验证配置文件** - 没有检查 Augment 的配置是否存在
3. **没有运行 --version** - 没有真正验证可执行文件

**解决方案**：
```typescript
// 改进 preflight 检查
async function preflightAugment() {
  // 1. 检查命令是否存在
  const commandExists = await checkCommand('augment');
  if (!commandExists) return { status: 'error', summary: 'Command not found' };
  
  // 2. 运行 --version
  const version = await runCommand('augment --version');
  if (!version.success) return { status: 'error', summary: 'Cannot get version' };
  
  // 3. 检查配置文件
  const configPath = path.join(os.homedir(), '.augment', 'config.json');
  const configExists = await fs.pathExists(configPath);
  
  return {
    status: configExists ? 'ready' : 'unverified',
    summary: `Augment ${version.stdout.trim()} ${configExists ? '(configured)' : '(needs config)'}`
  };
}
```

---

## 📚 参考资料

- EchoBird 源码：`C:\Users\cdl\Downloads\EchoBird-main`
- 安装配置：`docs/api/tools/install/*.json`
- Tauri API：`src/api/localServer.ts`
- 后端逻辑：`src-tauri/src/lib.rs` (调用 echobird_core)

---

生成时间：2026-05-31
