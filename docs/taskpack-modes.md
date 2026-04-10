# Task Pack Modes | 任务包模式

[English](#english) | [中文](#中文)

---

## English

AgentArena supports two modes for running benchmarks, each serving different evaluation purposes.

### Mode 1: Standard Test Repository (Recommended for Comparison) | 模式一：标准测试仓库（推荐用于对比）

**Best for: Comparing different agents fairly | 最适合：公平对比不同 agent**

```bash
agentarena run --task official/multi-file-rename.yaml --agents codex,claude-code,cursor
# Automatically uses the standard test repository
# 自动使用标准测试仓库
```

**Advantages | 优点:**
- **Fair comparison**: All agents run against identical, controlled environments
- **Reproducible**: Same results across different runs and machines
- **Known difficulty**: Tasks are calibrated to reveal agent differences
- **No setup required**: Test fixtures are built-in

**How it works | 工作原理:**
1. Task pack specifies `repoSource: "builtin://test-repo-name"`
2. AgentArena clones or extracts the standard test repository
3. All agents work on identical copies
4. Results are directly comparable

### Mode 2: User Repository (For Real-World Testing) | 模式二：用户仓库（真实场景测试）

**Best for: Testing agents on your actual codebase | 最适合：在你的真实代码库上测试**

```bash
agentarena run --repo ./my-project --task official/repo-health.yaml --agents codex,claude-code
```

**Advantages | 优点:**
- **Real-world relevance**: Tests on your actual code
- **Practical value**: Results directly applicable to your project
- **Custom evaluation**: Tailored to your tech stack

**Caveats | 注意事项:**
- Results may not be comparable across different repositories
- Repository complexity affects difficulty
- Tech stack familiarity varies by agent
- **Recommendation**: Use multiple task packs and average results

### Fairness Considerations | 公平性考虑

When comparing agents, consider these factors:

| Factor | Standard Repo | User Repo |
|--------|--------------|-----------|
| Identical environment | ✅ Guaranteed | ⚠️ Varies |
| Difficulty known | ✅ Calibrated | ❌ Unknown |
| Tech stack balance | ✅ Balanced | ⚠️ May favor some agents |
| Reproducibility | ✅ High | ⚠️ Lower |
| Real-world relevance | ⚠️ Synthetic | ✅ Real |

### Recommended Evaluation Strategy | 推荐评估策略

```
Step 1: Standard Repository Benchmark
        → Get baseline agent ranking
        
Step 2: Your Repository + Multiple Task Packs
        → Validate performance on your stack
        
Step 3: Cross-Reference Results
        → Identify agents that perform well in both
```

### Avoiding False Conclusions | 避免错误结论

**❌ Wrong**: "Agent A is better because it scored 90% on my Python repo"

**✅ Correct**: "Agent A scored 90% on my Python repo, but only 60% on standard benchmarks. Agent B scored 80% on both. Agent B may be more reliable overall."

### Task Pack Configuration | 任务包配置

Task packs can specify their repository requirements:

```yaml
# Standard test repository (recommended)
repoSource: "builtin://nodejs-monorepo"
repoSource: "builtin://python-fastapi"
repoSource: "builtin://react-dashboard"

# User's repository (flexible)
repoSource: "user"  # default

# External repository (future)
repoSource: "https://github.com/example/test-repo"
```

---

## 中文

AgentArena 支持两种运行模式，各有不同的评估目的。

### 模式一：标准测试仓库（推荐用于对比）

**最适合：公平对比不同 agent**

```bash
agentarena run --task official/multi-file-rename.yaml --agents codex,claude-code,cursor
# 自动使用标准测试仓库
```

**优点：**
- **公平对比**：所有 agent 在相同、受控的环境中运行
- **可复现**：不同运行和机器上结果一致
- **已知难度**：任务经过校准，能揭示 agent 差异
- **无需设置**：测试 fixture 内置

**工作原理：**
1. 任务包指定 `repoSource: "builtin://test-repo-name"`
2. AgentArena 克隆或解压标准测试仓库
3. 所有 agent 在相同副本上工作
4. 结果可直接对比

### 模式二：用户仓库（真实场景测试）

**最适合：在你的真实代码库上测试**

```bash
agentarena run --repo ./my-project --task official/repo-health.yaml --agents codex,claude-code
```

**优点：**
- **真实相关性**：在真实代码上测试
- **实用价值**：结果直接适用于你的项目
- **定制评估**：针对你的技术栈

**注意事项：**
- 不同仓库的结果可能不可比
- 仓库复杂度影响难度
- 技术栈熟悉度因 agent 而异
- **建议**：使用多个任务包并取平均结果

### 公平性考虑

对比 agent 时，考虑这些因素：

| 因素 | 标准仓库 | 用户仓库 |
|------|---------|---------|
| 相同环境 | ✅ 保证 | ⚠️ 变化 |
| 已知难度 | ✅ 已校准 | ❌ 未知 |
| 技术栈平衡 | ✅ 平衡 | ⚠️ 可能偏向某些 agent |
| 可复现性 | ✅ 高 | ⚠️ 较低 |
| 真实相关性 | ⚠️ 合成 | ✅ 真实 |

### 推荐评估策略

```
第一步：标准仓库基准测试
       → 获得基线 agent 排名

第二步：你的仓库 + 多个任务包
       → 验证在你技术栈上的表现

第三步：交叉对比结果
       → 找出在两者上都表现好的 agent
```

### 避免错误结论

**❌ 错误**："Agent A 更好，因为在我的 Python 仓库上得了 90 分"

**✅ 正确**："Agent A 在我的 Python 仓库上得了 90 分，但在标准基准测试中只有 60 分。Agent B 在两者上都得了 80 分。Agent B 整体上可能更可靠。"

### 为什么会出现"强弱相反"？

| 场景 | Agent A 表现 | Agent B 表现 | 原因 |
|------|-------------|-------------|------|
| 仓库恰好是 A 擅长的技术栈 | 高分 | 低分 | 主场优势 |
| 仓库太简单 | 都高分 | 都高分 | 无法区分 |
| 任务恰好是 A 训练过的模式 | 高分 | 低分 | 数据泄露 |
| A 在用户仓库有上下文优势 | 高分 | 低分 | 不公平对比 |

**解决方案**：使用标准测试仓库 + 多个任务包 + 多种技术栈

### 任务包配置

任务包可以指定仓库需求：

```yaml
# 标准测试仓库（推荐）
repoSource: "builtin://nodejs-monorepo"
repoSource: "builtin://python-fastapi"
repoSource: "builtin://react-dashboard"

# 用户仓库（灵活）
repoSource: "user"  # 默认

# 外部仓库（未来支持）
repoSource: "https://github.com/example/test-repo"
```
