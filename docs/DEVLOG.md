# AgentArena 开发日志

> 按时间倒序。只记"当时花了时间想明白、且未来大概率会再遇到"的东西。
> 格式：现象/目标 → 根因/思路 → 解法 → 教训/可复用点。

---

## [2026-08-28] Settings 移动端操作区不能依赖字体宽度刚好放下

- 现象/目标：本地 Chromium 的 390px 页面通过，但 GitHub Chromium 在 Settings 页出现 16px 横向溢出。
- 根因/思路：Section 标题和诊断导出按钮共享一行，按钮组与英文描述的最小内容宽度受 runner 字体度量影响，偶发超过移动内容宽度。
- 解法：只对 `.settings-layout` 的窄屏标题区启用纵向布局，并让操作按钮组可换行；不修改全局 Section 组件，避免影响其他页面。
- 教训/可复用点：移动端布局不能依赖“当前字体下刚好放下”，必须让标题、描述和操作区具备明确的收缩与换行策略。

## [2026-08-28] pnpm 10 的安全 override 必须放在 workspace 配置

- 现象/目标：GitHub CI 的高危依赖审计因 `fast-uri`、`js-yaml` 和 `nanoid` 失败。
- 根因/思路：`pnpm audit --fix` 把 override 写入根 `package.json`，但 pnpm 10.6.1 已不读取 `pnpm.overrides`；仓库的 `pnpm-workspace.yaml` 还固定了旧的易受攻击版本。
- 解法：将最小安全版本统一放入 `pnpm-workspace.yaml` 并重新生成锁文件，`pnpm audit --audit-level=high` 现已通过。
- 教训/可复用点：pnpm CI 安全修复必须验证 override 实际被解析，不能只看 audit fix 修改了哪个文件。

## [2026-08-28] 浏览器 E2E 导航等待必须与测试目标解耦

- 现象/目标：完整浏览器命令在单独运行时通过，但并行启动多个服务时偶发卡在 `page.goto(..., waitUntil=load)`。
- 根因/思路：测试要验证页面可交互，却额外等待所有资源触发 `load`，并行时把资源调度抖动误判成页面失败。
- 解法：对无特殊需求的导航统一等待 `domcontentloaded`，后续断言继续等待具体 UI 元素和状态。
- 教训/可复用点：E2E 等待条件应匹配业务断言；不要用整页 `load` 替代对关键可交互状态的显式等待。

## [2026-08-28] npm 发布前必须验证公开依赖闭包

- 现象/目标：`@agentarena/cli@0.2.0` 能发布，但普通用户从 npm 安装时会尝试下载不存在的私有 `@agentarena/web-report`。
- 根因/思路：CLI 在构建时已经把 Web Report 复制到自身 assets，`workspace:*` 依赖却被 Changesets 改写成公开运行时依赖；本地 monorepo 安装掩盖了这个问题。
- 解法：移除无运行时用途的私有依赖，补充公开包依赖闭包测试，并将 CLI 发布修正版提升到 `0.2.1`。
- 教训/可复用点：npm 发布不能只看 tarball 是否生成；必须在全新目录检查 registry metadata、依赖闭包和全局 CLI 启动。

## [2026-08-28] 冻结的 LaunchSpec 必须携带本地 Codex 模型身份

- 现象/目标：本地 Codex 实际使用了配置文件中的模型和思考强度，但最新报告仍显示 `unknown/default`。
- 根因/思路：运行时 readiness 能读到本地默认值，真正启动前却重新使用了临时运行环境；原冻结 LaunchSpec 没有保存模型身份。
- 解法：在启动前解析并冻结模型、思考强度和来源，将其写入受控 CLI 参数、运行时身份和报告证据；界面允许任务级覆盖但不改 Provider 路由。
- 教训/可复用点：凡是会影响结果解释或公平比较的运行时参数，都必须在 admission 阶段冻结并贯穿 launch、receipt、trace、report，不能只在 UI 展示。

## [2026-08-28] 本地 UI 首次启动改用密码设置而不是查找 Bearer Token

- 现象/目标：Workbench 手动打开时要求用户查找 `auth_token_file`，首次配置本地服务密码的路径不清晰。
- 根因/思路：Bearer Token 是 API 内部会话凭据，不应成为普通用户必须理解的产品概念；但 API 鉴权和旧客户端仍需要保留。
- 解法：新增 loopback-only 的 `/api/auth/status`、`/api/auth/setup`、`/api/auth/login`，密码以 salted `scrypt` 哈希保存，前端只保存当前会话 token。
- 教训/可复用点：本地服务可以用易懂的密码做首次认证入口，同时继续用高熵、按进程轮换的 Bearer Token 保护 API。

## [2026-08-28] workspace-root 下的相对路径必须先统一解析

- 现象/目标：指定 `--workspace-root` 后，兼容性检查和 UI 运行对相对路径仍可能回落到进程启动目录。
- 根因/思路：路径 containment 接收了显式 root，但底层 `path.resolve(value)` 没有使用该 root，校验与实际读取的基准不一致。
- 解法：集中解析 `repoPath`、`taskPath`、`outputPath`，再执行同步/异步 containment 校验，并补充相对路径回归测试。
- 教训/可复用点：工作区边界不仅要传入校验函数，还要贯穿路径解析、读取和执行的每个入口。

## [2026-08-28] 固定生成检查必须绕开命令分词的多行脚本损坏

- 现象/目标：自定义任务的固定测试和 lint judge 在隔离运行中出现 eval 语法错误。
- 根因/思路：命令 tokenizer 会处理双引号内的反斜杠，JSON 转义后的多行源码被破坏；问题只在真实执行路径暴露。
- 解法：将固定 Node 检查源码先编码为 base64，再由受控的 `node -e` 解码执行，并只对完整模板形状放行。
- 教训/可复用点：命令模板要用 tokenizer 真实跑一遍；允许特殊执行能力时必须同时绑定不可变模板校验。

## [2026-08-28] 收口 macOS 运行链与 Workbench Demo 验收

- 现象/目标：Mac `/var` 临时路径被误判越界，Node 22 全量测试和 Workbench 验证无法稳定完成。
- 根因/思路：`/var` 与 `/private/var` 词法不同；shim/隔离参数跨平台不一致；Demo 异步接收会覆盖用户导航。
- 解法：统一真实路径比较，按平台生成 shim，探测隔离参数，并补齐 Demo API、summary-only Trace 降级和路由竞态保护。
- 教训/可复用点：路径安全校验先统一真实路径命名空间；摘要不能冒充完整能力证据；异步请求必须尊重用户导航。

## [2026-08-23] 首次体验的 Demo 必须与真实执行路径对齐

- 现象/目标：文档和 Workbench 都宣称可以无认证开始体验，但 CLI 默认任务会让内置 Demo 走向必失败的源码修复契约，Workbench 的“安全 Demo”只是载入静态结果。
- 根因/思路：产品导览任务、真实任务包和 Runtime Profile 是三条不同路径；入口没有明确区分“演示数据”“真实 Demo 执行”和“真实 Agent 验证”。
- 解法：本次先完成证据审计，确认专用 `demo-ui-tour` 才是可重复的 Demo 任务；未修改代码，待产品决定统一入口后再修文档或运行路径。
- 教训/可复用点：首次体验的验收必须证明运行真的开始且至少一个 Judge 通过；静态样例可以展示 UI，但不能替代产品的首个可执行成功路径。

## [2026-08-21] 未验证适配器不能进入内部试用就绪态

- 现象/目标：`init`、quick-preflight 和 Workbench Library 会把 CLI 已找到但尚未确认的适配器展示成可运行。
- 根因/思路：调用方各自用“不是 missing/blocked”的宽松条件判断，`unverified` 因而穿过了可运行边界；Library 还直接硬编码了 Harness 状态。
- 解法：共享 `ready` 谓词，CLI/API 仅把明确的 `ready` 视为可运行；Workbench 用 capability、检测结果和 Runtime Receipt 合并状态，并增加本地脱敏诊断 bundle。
- 教训/可复用点：readiness 必须 fail-closed；检测到安装、认证可用和任务级可执行是三个不同事实，不能用一个布尔值替代。

## [2026-08-19] UI token 文件必须按监听实例隔离

- 现象/目标：并发测试或第二个本地 UI 会把 `test-token-*` 写入共享 token 文件，Workbench 随后拿到不属于当前服务的令牌并返回 401。
- 根因/思路：服务实际使用的是进程内 token，但启动输出和 Workbench 仍指向固定 `.agentarena/last-auth-token`，文件内容没有服务实例身份。
- 解法：增加显式 `AGENTARENA_LOCAL_AUTH_TOKEN` 解析（不改变随机默认），按端口写入独立 token 文件，并在 `/api/ui-info` 返回脱敏来源和路径。
- 教训/可复用点：本地多进程凭据文件必须绑定监听实例；共享“last”文件只能作为历史提示，不能作为当前服务的权威凭据。

## [2026-08-16] 运行通过不等于模型能力证据充分

- 现象/目标：简单任务经常显示 100 分，但用户看不到实际模型、思考强度、token 分项和可比性边界。
- 根因/思路：CLI 事件流可能不返回模型名，旧结果页又把通过状态、合成分数和能力结论混在一起；未知成本还可能退化成数值零。
- 解法：贯通运行时身份证据、输入/输出/reasoning/cache token breakdown、日志语义分类和结果证据强度；未知字段明确显示未知，easy/单样本结果降级为有限证据。
- 教训/可复用点：评测产品必须同时呈现“任务是否完成”和“这次结果能支持多强的能力主张”，不能用单一分数代替证据质量。

## [2026-08-16] Unknown aggregate cost must not render as zero

- 现象/目标：A CLI run without reported cost rendered `$0.00` in the Markdown summary.
- 根因/思路：The aggregate kept a numeric zero for compatibility, but the template did not know whether any result had known cost data.
- 解法：Track `knownCostCount` separately and render `n/a` when the count is zero; keep per-result estimated/unavailable formatting unchanged.
- 教训/可复用点：Metrics with a numeric fallback need an explicit availability signal at every aggregate presentation boundary.

## [2026-08-16] 启动前必须刷新运行准入并丢弃过期进度

- 现象/目标：三阶段验证已经通过时，创建评测页仍可能显示失效，或验证完成后卡片继续显示等待中。
- 根因/思路：多个 readiness 请求并发返回，旧响应覆盖新投影；启动只读取 React 旧状态；验证 POST 完成后丢失最终进度轮询时，乐观的 running 快照持续遮住新 Receipt。
- 解法：为运行投影加入单调请求序号，启动前强制获取权威投影并提交 LaunchSpec/Receipt 指纹；终态清理仍在运行的旧进度快照，并在 Plan 页复用三阶段验证入口。
- 教训/可复用点：异步状态不能只靠布尔 ready；任何可执行准入都要在提交前重新绑定目标与指纹，进度 DTO 也必须有明确终态。

## [2026-08-16] Workbench 不能把本地 API 401 当成环境为空

- 现象/目标：手动打开本地 Workbench 时，运行配置接口返回 401，页面只显示加载失败，用户无法进入三阶段验证。
- 根因/思路：敏感 API 即使绑定 localhost 也要求 Bearer Token；自动打开流程有一次性 bootstrap，手动打开流程却没有 token 输入，且普通 `Error` 丢失 HTTP 状态码。
- 解法：Workbench API 错误保留状态码；环境页识别 401，提供当前会话级 token 输入并立即重试，后端鉴权边界保持不变。
- 教训/可复用点：本地桌面式服务也要覆盖“手动打开”和“自动打开”两条认证路径；敏感 token 不应写入持久化业务数据。

## [2026-08-16] Runtime verification exposes live stage progress

- 现象/目标：Workbench 只显示“验证中”，用户无法判断安装、对话和仓库任务当前卡在哪一步。
- 根因/思路：三阶段验证在后端串行执行，但旧 API 只在全部完成后返回 Receipt，没有中间状态通道。
- 解法：增加短时内存进度记录和查询接口；验证器在每个阶段开始/完成时更新，Workbench 轮询并展示当前阶段、完成数和安全摘要。
- 教训/可复用点：长耗时本地任务不能只返回最终结果；进度 DTO 应与 Receipt 分离，且只包含阶段状态，不传播密钥或原始模型输出。

## [2026-08-16] Windows 凭据保险库失败时必须回退加密文件后端

- 现象/目标：通过 pnpm/cmd 启动后台任务时，Windows `PasswordVault` 偶发无法打开，导致已保存的 Provider 凭据不可用。
- 根因/思路：包管理器注入的 `HOME`、`npm_*`、`pnpm_*` 环境会改变 PowerShell 凭据上下文；直接启动 Node 与包管理器启动表现不同。
- 解法：清理这些子进程环境变量，并在保险库读写失败时回退到已有 AES-256-GCM 文件后端；删除时同时清理两种后端。
- 教训/可复用点：凭据后端不可只按平台选择，必须覆盖真实启动方式并提供可恢复的后端回退。

## [2026-08-16] Windows Codex RuntimeProfile 不应强制调用 sandbox helper

- 现象/目标：Workbench 的三阶段验证反复弹出 `codex-windows-sandbox-setup.exe`“找不到指定的模块”，请求无法完成。
- 根因/思路：RuntimeProfile LaunchSpec 固定传入 `--sandbox workspace-write`，而当前 npm Codex Windows 包的原生 sandbox helper 在本机无法加载；旧 Codex adapter 使用 bypass 路径则正常。
- 解法：Windows RuntimeProfile 改用 `--dangerously-bypass-approvals-and-sandbox`，并把权限元数据冻结为 `danger-full-access/fullBypass=true`；Unix 保持 `workspace-write`。所有验证和任务仍使用影子 `CODEX_HOME` 与一次性工作区。
- 教训/可复用点：同一 CLI 的 legacy 和 frozen 启动契约必须共享平台默认；Windows 原生辅助程序失败时，优先复用已验证的非交互路径并明确记录权限语义。

## [2026-08-16] Codex CLI 失败必须区分 Provider 错误与协议噪声

- 现象/目标：真实 Codex 任务遇到 503/429 时，旧解析会把失败归因成输出格式变化，报告看不出是 Provider 不可用。
- 根因/思路：Codex 的 `error` 和 `turn.failed` 事件没有进入失败摘要，且失败运行仍可能沿用不完整的 token/cost 数据。
- 解法：解析并限制提取 CLI 失败原因，优先展示真实错误；失败运行的指标标记为不可用，并保留 `cliError` 到 trace。
- 教训/可复用点：外部 CLI 的协议兼容性告警只能描述解析质量；只要存在明确失败事件，结果层必须优先呈现 Provider/进程失败原因。

## [2026-08-14] 首发任务包必须由真实夹具和改动契约共同验收

- 现象/目标：任务包可以被加载并运行，不代表能稳定、客观地比较 Codex 与 Claude Code 的真实修复能力。
- 根因/思路：只看 prompt、提示性的 changed-files 或单个宽松 judge，会允许空提交、越界修改和预置答案通过。
- 解法：首发 10 包统一使用离线 `nodejs-core` 夹具；运行前注入可复现故障，冻结 before/after snapshot，并用 allowed/forbidden paths 与文件数量边界判定改动，再执行 critical judges。
- 教训/可复用点：新增任务包必须同时提供基线失败、参考实现通过、空改动拒绝和越界改动拒绝证据，不能只补一份 YAML。

## [2026-08-14] Codex 安装探测也必须使用影子 Home

- 现象/目标：任务验证和正式执行已隔离 `CODEX_HOME`，但安装发现阶段的 `--version`、`--help` 仍可能接触用户日常配置目录。
- 根因/思路：只读命令是 AgentArena 的意图，不是外部 CLI 的文件系统契约；CLI 初始化仍可能迁移或写入状态。
- 解法：Codex 安装、对话和任务验证共用一次性影子 Home，并按 Profile 模式决定是否复制本地认证，结束后统一清理。
- 教训/可复用点：[通用] 外部 CLI 的副作用隔离必须覆盖发现、探测、验证和执行全生命周期，不能从命令名称推断只读。

## [2026-08-13] 异步服务探测不能替换用户正在查看的报告 DOM

- 现象/目标：用户上传 `summary.json` 后，旧版报告的比较条或比较表偶发无法点击，浏览器提示元素已从 DOM 脱离。
- 根因/思路：页面启动时的安装/服务探测异步完成后再次调用全量 `render()`，而报告区域用 `innerHTML` 重绘，恰好替换了交互中的节点。
- 解法：已有报告时，服务探测只刷新 launcher；没有报告时才执行完整初始化渲染，并用浏览器 smoke 覆盖两种点击交互。
- 教训/可复用点：[通用] 异步 bootstrap 更新局部状态时不能无条件重建用户正在操作的视图；应按状态边界刷新，并用真实浏览器验证节点生命周期。

## [2026-08-13] Codex 无全局副作用需要影子 Home 而非临时会话参数

- 现象/目标：真实 Codex 探针带 `--ephemeral` 仍会把临时仓库 trust 写入用户 `config.toml`，失败回执还可能附带 Provider 路由和工具初始化元数据。
- 根因/思路：会话不持久化不等于配置只读；原始 stdout 也不是适合直接持久化的诊断契约。
- 解法：验证和正式任务使用短生命周期影子 `CODEX_HOME`，按模式复制所需配置与认证；Receipt 脱敏全部冻结覆盖值，并在结构化错误存在时省略原始事件流。
- 教训/可复用点：[通用] 第三方 CLI 的“临时/无历史”参数不能替代文件系统写隔离；持久化错误证据应最小化而不是保存完整运行流。

## [2026-08-13] 托管 Provider 隔离与 Harness 快照必须使用同一有效输入

- 现象/目标：托管 Profile 可能串用宿主 Provider 凭据，CLI 会话计数、令牌刷新或另一款 Harness 的配置变化又会频繁使 Receipt 失效。
- 根因/思路：LaunchSpec 只增加覆盖而未清除冲突路由变量；HarnessSnapshot 对环境和跨 Harness 状态文件做了过宽的整值哈希。
- 解法：托管模式显式清除宿主 Provider/云路由变量；快照按 Agent 和 Profile 模式枚举输入，并对认证状态和 `.claude.json` 做脱敏结构化投影。
- 教训/可复用点：[通用] 可复用验证的身份应覆盖实际生效输入，而不是宿主环境全集；既要让行为变化失效，也要排除运行计数和令牌刷新噪声。

## [2026-08-13] 公开启动规格只能暴露环境键名

- 现象/目标：readiness API 的公开 LaunchSpec 会返回普通 `extraEnv` 值，可能把用户误填的敏感信息带到浏览器和诊断产物。
- 根因/思路：内部执行契约和公开投影复用了同一 `environment.overrides` 结构，Secret binding 虽脱敏，普通覆盖值没有单独边界。
- 解法：内部 LaunchSpec 保留执行值，公开投影只返回排序后的 `overrideKeys`、`unset` 和不含 Secret 引用的绑定状态。
- 教训/可复用点：[通用] “字段声明为非敏感”不能替代输出脱敏；执行对象和浏览器/API DTO 必须是两个显式契约。

## [2026-08-13] 报告与排行榜必须消费同一评分对象

- 现象/目标：同一次运行的报告结果已有综合分，但排行榜当前行可能仍按未评分的原始对象聚合，页面出现自相矛盾的分数。
- 根因/思路：`writeReport` 只对公开报告调用评分 enrich，随后把另一份原始 `run` 交给 leaderboard，形成两个事实源。
- 解法：先生成唯一的 `scoredRun`，历史记录也通过同一评分流程，再共同用于公开报告和排行榜聚合。
- 教训/可复用点：[通用] 派生指标必须先形成单一规范对象，再分发给报告、榜单和导出，不能由每个消费者各自补算。

## [2026-08-13] Adapter 运行元数据不能计入任务改动

- 现象/目标：真实 Codex 只正确修改目标文件，diff precision 却被 Harness 自己写入工作区的最后消息和日志目录拉低。
- 根因/思路：Adapter 元数据目录在快照和 changed-files 汇总中被当作 Agent 产出，污染 Judge、报告和公平评分。
- 解法：集中定义 AgentArena 生成目录，在目录快照、Git diff precision 和 changed-files 组装中一致排除，同时继续跟踪真实项目 Harness 配置。
- 教训/可复用点：[通用] 评测工具写入被测工作区的证据必须有统一命名空间，并在所有评分入口一致排除。

## [2026-08-12] 本地 Harness 采用继承、任务覆盖与冻结执行

- 现象/目标：Codex 与 Claude 的配置测试和正式任务没有同一运行身份，已安装或已有登录也不能证明后台任务可运行。
- 根因/思路：Provider、环境、权限和 Harness 配置在多个阶段重复解析，Claude 第三方模式还隔离了用户真实配置，导致测试结论无法传递到执行。
- 解法：默认继承真实 Harness，以任务级参数和子进程环境覆盖 Provider，并用 HarnessSnapshot、ResolvedLaunchSpec、VerificationReceipt 和 JobManifest 冻结验证到执行的契约。
- 教训/可复用点：[通用] 外部 CLI 的可用性必须拆成安装、真实请求和真实修改；验证只有绑定不可变执行规格，才能成为后台任务的有效凭证。

## [2026-08-07] Workbench 启动确认与运行状态必须分开处理

- 现象/目标：启动评测后已收到成功提示，但实时页仍显示没有活动运行，重复启动还会短暂保留上次结果。
- 根因/思路：接口只确认请求已接收，前端却把确认消息当成完整运行状态合并，旧状态因此没有被正确替换。
- 解法：确认响应只负责进入全新的启动状态，后续状态由实时流和轮询更新，并覆盖启动、完成、重复运行与取消场景。
- 教训/可复用点：异步命令的接收确认不能代替状态机快照；每次新运行都应先清空上一次的瞬时状态。

## [2026-08-02] Workbench 桌面端评测流程与结果解释闭环

- 现象/目标：评测计划、环境、运行、结果和证据页各自可用，但用户需要在多个页面之间反复确认状态，失败后也缺少明确的恢复路径。
- 根因/思路：页面只展示数据，没有把“能否开跑、为什么可信、如何复用”作为同一条任务流组织起来；Agent 支持状态也没有分层表达。
- 解法：增加计划预设和开跑就绪度、按可用性分组 Agent、运行筛选和配置复用、结果解释与评测依据、证据聚焦筛选及失败后的重试入口。
- 教训/可复用点：评测产品的核心信息层级应围绕“是否可运行、结果是否可信、下一步做什么”组织，而不是只增加数据字段或导航入口。


## [2026-07-31] 回放读取上限与报告构建边界统一

- 现象/目标：大体量 trace 会一次性读入内存，指标标签和报告构建也缺少明确边界。
- 根因/思路：回放接口按整文件解析，指标序列无上限；Workbench 直接依赖 core 源文件，CLI 又重复触发报告构建。
- 解法：回放改为逐行读取并限制返回量，指标增加溢出序列，补齐 workspace 依赖、公开子入口和构建顺序。
- 教训/可复用点：共享包应通过发布入口使用；构建依赖交给 workspace 拓扑，脚本只消费已构建产物。


## [2026-07-28] [通用] 基线身份必须包含实际文件内容

- 现象/目标：同一文件的不同未提交内容会被误判为同一仓库基线。
- 根因/思路：身份只记录提交和变更路径，没有记录变更后的内容。
- 解法：保持干净仓库身份不变；仓库有改动时，对变更和未跟踪文件的实际内容生成摘要。
- 教训/可复用点：用于缓存、续跑或公平比较的快照身份，必须覆盖内容而不只是状态和路径。

## [2026-07-28] [通用] 本地网页自动登录不应把真实凭据写进页面

- 现象/目标：自动打开本地页面时需要免手工登录，但真实凭据出现在 HTML 响应中。
- 根因/思路：即使页面立即删除标签，原始响应、代理和诊断工具仍可能保留凭据。
- 解法：改用短时一次性交换码，页面先清理地址片段，再向本地服务换取真实凭据。
- 教训/可复用点：自动登录应传递一次性能力，而不是把长期凭据嵌入页面或地址。

## [2026-07-28] [通用] 超时和取消必须终止完整进程树

- 现象/目标：裁判命令结束后，命令启动的后代进程仍可能继续占用文件和端口。
- 根因/思路：只终止直接子进程无法覆盖孙进程；不同系统的进程组机制也不同。
- 解法：Windows 使用整树终止，其他系统使用独立进程组并保留强制终止兜底；默认串行运行会写缓存的裁判。
- 教训/可复用点：外部命令的生命周期边界必须覆盖完整进程树，并用真实后代进程验证。

## [2026-07-28] [通用] 证据采集必须早于会修改现场的清理步骤

- 现象/目标：报告中的文件差异可能记录清理后的内容，而不是执行过程真正产出的内容。
- 根因/思路：差异快照虽在清理前完成，行级证据却在清理后重新读取工作区。
- 解法：在清理开始前保存行级差异，清理结果仍按原流程记录。
- 教训/可复用点：任何会改变现场的收尾动作之前，都要先固化诊断和审计证据。

## [2026-07-28] [通用] 配置校验与可恢复写入必须使用同一契约

- 现象/目标：接口允许的配置编号可能被秘密存储拒绝，历史坏记录还会拖垮整个列表。
- 根因/思路：入口和存储层各自维护规则，普通覆盖写入也无法恢复中断留下的备份。
- 解法：统一编号规则，写入前校验，读取时清理坏记录，并在读取和写入前恢复原子写入备份。
- 教训/可复用点：配置标识、持久化路径和恢复流程必须共享同一套边界规则。

## [2026-07-24] 工程执行计划 R1-R8 实施：事件解析关键事件检测、插件安全、模块拆分

- 现象/目标：事件解析器无法检测关键事件缺失（Claude 的 result 事件、Codex 的 turn.completed 事件），导致 tokenUsage 和 cost 在关键事件缺失时仍被报告为可靠数据；插件注册无路径验证；大文件 claude-provider-profiles.ts 混合了加密/SSRF/CRUD 逻辑
- 根因/思路：(1) formatMismatch 仅在"多数事件不被识别"时触发，对渐进式格式变更太宽松；(2) loadAdapterPlugins 直接 await import 无路径校验；(3) 869 行的 provider-profiles 文件违反单一职责
- 解法：R1 新增 missingCriticalEvents 字段到事件解析器返回类型，当关键事件缺失时自动设置 tokenUsageReliable=false 和 costQuality="unavailable"；R2 添加路径验证（拒绝相对路径、..遍历、node_modules、非 file:// 协议）；R3 为 costKnown 添加 @deprecated；R4 为 DOM 查询添加 queryElement 空值守卫和 @owner 注释；R5 将加密/SSRF 逻辑提取到 secret-storage.ts；R6-R8 添加子入口点、SSRF 环境变量、runner 模块拆分
- 教训/可复用点：[通用] 事件解析器的"关键事件缺失"检测比"格式不匹配"检测更精确——后者是统计阈值，前者是确定性断言；[通用] 插件加载必须校验路径，不能信任用户输入的 import 路径

## [2026-07-19] Workbench 评分契约与证据路径产品闭环

- 现象/目标：默认 Workbench 暴露 correctness/speed/cost 等非法评分模式，静默回落 practical 且与 leaderboard 回退不一致；Evidence 常无行级 diff；Agent 选择不展示 support tier。
- 根因/思路：Workbench 未绑定 `SCORE_MODES` 单一事实源；`validateRunPayload` 不校验 scoreMode；`getRunScoreMode` 回退 balanced 而 runner 用 practical；runner 只持久化文件名。
- 解法：Plan 对齐六种合法模式；API 拒绝非法 scoreMode；统一回退 practical 并归一化历史脏数据；runner 采集 `fileDiffs`；选择器展示 tier/token/cost；cwd 路径与错误文案前置；补 preflight/evidence 本地遥测。
- 教训/可复用点：`[通用]` 默认入口的枚举必须与后端契约同源并在边界校验；“静默回退”会污染历史可比性。

## [2026-07-19] 测量可信度管线闭环与 UI 本机绑定契约对齐

- 现象/目标：token 不可信时仍可能被当成完整结果；Docker/文档仍宣传 `0.0.0.0` UI，而实现已拒绝。
- 根因/思路：adapter 质量信号未贯通到 Workbench integrity；Codex 忽略 `tokenCountSuspicious`；报告写路径弱于 core 原子写；主机契约文档漂移。
- 解法：补齐 Codex/Base CLI 质量标记；Workbench 增加 token/data-quality/trace-incomplete 完整性原因；report 改用 `writeAtomic`；Docker 默认 `--help`；文档与 CORS 去掉 0.0.0.0 承诺。
- 教训/可复用点：`[通用]` 测量字段只有在入口、结果、报告、UI 四层一致消费时才有可信度；实现收紧安全边界后必须同步清文档与死代码。

## [2026-07-19] 官方任务包目录与双语内容自动同步

- 现象/目标：30 个官方任务包的目录和双语内容需要长期保持一致。
- 根因/思路：README 与任务包文件分别维护，容易出现名称、说明、目标和评测理由漂移。
- 解法：新增 `scripts/sync-taskpack-catalog.mjs`，由任务包生成中英文目录；提供 `pnpm taskpacks:sync` 和 `pnpm taskpacks:check`，并补齐缺失字段。
- 教训/可复用点：可从源文件生成的目录不要手写；同步命令和检查命令应同时提供。

## [2026-07-18] 内置 Demo 与 CLI 静态资源复制边界

- 现象/目标：CLI 打包后的页面和内置 Demo 需要与源码目录使用同一套资源，避免“源码可用、发布包失效”。
- 根因/思路：资源复制路径和父仓库的忽略规则互相影响，导致发布目录缺文件或页面加载仓库外源码。
- 解法：收紧 CLI 资源复制范围，补充浏览器可直接使用的本地校验模块，并用真实 Demo 验证发布产物。
- 教训/可复用点：发布包必须按最终目录验证，不能只验证开发目录。

## [2026-07-18] Trace 恢复与取消状态的可见性

- 现象/目标：运行恢复和取消后，页面需要显示准确的状态、事件和运行标记。
- 根因/思路：恢复流程、取消事件和页面状态各自处理，缺少统一的终态约束。
- 解法：统一 run marker、trace resume 和 `agent.cancelled` 的传递与展示，并增加对应回归检查。
- 教训/可复用点：可恢复流程必须同时验证持久化状态、事件流和页面终态。

## [2026-07-18] 保留显式开启评测命令的安全开关

- 现象/目标：默认禁止评测命令中的 `eval`，但用户显式设置 `AGENTARENA_ALLOW_EVAL_IN_JUDGES=1` 时仍应生效。
- 根因/思路：CLI 和 UI 入口曾把该环境变量覆盖为 `false`，导致显式配置无法传递到执行层。
- 解法：入口不再覆盖用户明确设置的值；未设置时仍保持默认禁止，并补充 CLI、UI 和安全测试。
- 教训/可复用点：安全默认值不能通过静默覆盖显式配置来实现，应区分“未配置”和“明确关闭/开启”。

## [2026-07-18] 旧版页面改用浏览器可用的本地模块

- 现象/目标：旧版页面能打开，但语言切换和结果加载失败。
- 根因/思路：浏览器脚本指向仓库外源码路径，页面运行时无法读取该模块。
- 解法：新增浏览器可用的本地校验模块，并让旧版页面引用它；用浏览器流程验证语言切换和结果加载。
- 教训/可复用点：浏览器入口不能依赖 Node 专用或仓库外路径，必须检查构建后的真实资源。

## [2026-07-18] Workbench 直接由 Node 执行时补齐 TypeScript 导入扩展名

- 现象/目标：Workbench 在浏览器构建中正常，但直接由 Node 执行时无法加载相对模块。
- 根因/思路：Node 的 ESM 加载规则不会自动补上 TypeScript 相对导入的扩展名。
- 解法：调整 Workbench 运行入口的相对导入并补充构建与运行检查，保证开发和发布路径一致。
- 教训/可复用点：同一模块若同时由打包器和 Node 执行，必须分别验证两套加载规则。

## [2026-07-18] 将 diffReliable 传入最终结果

- 现象/目标：差异可靠性已经计算出来，但最终结果没有携带它，报告无法据此降级精度相关结论。
- 根因/思路：快照比较和结果组装分属不同阶段，字段只在中间对象存在，未进入最终结果。
- 解法：把 `diffReliable` 接入最终结果、评分和报告，并增加跨层回归测试。
- 教训/可复用点：中间计算字段只有进入最终契约并被测试覆盖，才会真正影响用户看到的结果。

## [2026-07-16] 工作台 PWA：首次安装 service worker 的 controllerchange 不应 reload

- 现象/目标：加离线 PWA（sw.js + 注册）后，workbench 三个 e2e 报 `errors` 数组非空，命中 `assert.deepEqual(errors, [])`；监控到 `/api/ui-info`、`/api/agent-detection`、`/api/taskpacks`、`/api/provider-profiles` 首屏全部 `net::ERR_ABORTED`。
- 根因/思路：`main.tsx` 注册 SW 后无条件监听 `controllerchange` 并 `location.reload()`。`sw.js` 在 `install` 时 `skipWaiting()`、`activate` 时 `clients.claim()`，会令**首次安装**也触发 `controllerchange`。reload 发生在 `useWorkbench` 的 `refreshEnvironment()` 仍在进行 4 个 `/api/*` 请求时 → 请求被取消（abort），且造成首屏闪烁。`provider-profiles` 单独 401 是 localhost 鉴权豁免边界差异，非主因。
- 解法：把 reload 绑定到「主动 `postMessage(SKIP_WAITING)`（即发现更新版 SW）」这一事实——仅在 `updatefound` 监听里、worker `installed` 且有旧 controller 时置 `pendingSkip` 再跳等待；首次 install 的 `controllerchange` 不 reload（页面本就已被新 worker 接管）。诊断脚本证实 6 个 `/api/*` 全部 200，无 aborted；e2e 3/3 复绿。
- 教训/可复用点：[通用] 注册 SW 时 `controllerchange → reload` 必须区分「首装 claim」与「更新跳过等待」；标准 PWA 只在后者 reload，否则会打断进行中的请求并闪烁。验证「无网络错误」类 e2e 时，用 Playwright `response`/`requestfailed` 监听打印每个 `/api` 请求的真实状态，比只看断言快定位。

## [2026-07-16] 阶段9 遗留收尾：Trace Worker + FileChanges 行级 diff 就绪

- 现象/目标：阶段9 两项遗留未完成——大 Trace 主线程卡顿、FileChanges 无行级改动。
- 根因/思路：runner 跑完即清理 workspace，只存文件名不存内容，行级 diff 对已完成 run 不可重建（需 runner 改动，仅惠及未来 run，需单独授权）；大 Trace 的 `buildTimeline` 在主线程跑会卡 UI。
- 解法：新增 `workers/trace-worker.ts`（>2000 事件走 Worker 解析，先发前 500 步，`loadFull` 拉全量，报错回退主线程）；`FileChanges` 支持 `DiffBlock` 渲染统一 diff（红绿/上下文行，无 innerHTML 防 XSS），`NormalizedAgentResult.fileDiffs` 已接好，runner 何时存内容即可零成本接入。
- 教训/可复用点：跨端数据缺失（如行级 diff）若需改 runner 才能补全，前端先做成「结构就绪」而非硬造数据；重计算放 Worker，主线程只兜底。

## [2026-07-16] e2e 测试中文正则编码损坏导致 compare 测试永久超时

- 现象/目标：阶段10 提交的 compare e2e 测试在套件和单独运行都卡 30s+ 等「Safe demo」按钮，但同结构 evidence 测试却过。
- 根因/思路：compare 测试块的中文正则（如 `/Safe demo|安全 Demo/i`、`/Save session|保存会话/i`）在提交时被以错误编码（GBK 字节混进 UTF-8 文件，或乱码成 U+FFFD）写入；i18n 默认 zh-CN 时按钮文案是 UTF-8「安全 Demo」，正则里的坏字节匹配不到 → 超时。另一错误：断言 `.trend-grid/.muted-line`，但 demo 只加载 1 个 run，compare 页走 `runs.length < 2` 的 empty-state 分支，根本不渲染这两个类。
- 解法：用 PowerShell 以 UTF-8 字节级核对，把损坏中文还原为正确 UTF-8；断言改为等 `.empty-state, .compare-session`（单 run 真实渲染），session 按钮存在时才校验；单独跑 2.9s 通过，全量 15/15 绿。
- 教训/可复用点：[通用] 往 UTF-8 源码里写中文时，绝不用 GBK 视角的编辑器/工具（PowerShell ISE、某些 heredoc）落盘，否则混合编码极难肉眼发现；e2e 断言要匹配「当前数据下的真实渲染分支」，demo 单 run 不可比时该显示 empty-state 而非 trend 区。

## [2026-07-16] 新版 Compare 接入基线趋势 / 交叉会话 / 保存分享

- 现象/目标：Compare 页只有单基准 + 候选排除，缺历史趋势、多运行交叉聚合和会话持久化（阶段10）。
- 根因/思路：旧版 `view-model/comparison.js` 已有 `getAgentTrendRows`/`getCrossRunCompareRows` 等逻辑，但新版工作台未暴露；且带重 legacy 依赖，不能整段引入。
- 解法：新增独立 `domain/compare.ts`（纯函数，复用同一套公平规则但自含评分，不引 legacy）、`useCompareSession` hook（localStorage 引用式保存）、`TrendSparkline` 纯 SVG 组件；Compare 页拆成「公平比较 / 基线趋势 / 交叉会话」三块，未知指标显示「未知」不补零，推荐项仅在有成功 agent 时出现，可信度低时显示 caution 横幅。
- 教训/可复用点：新版 domain 逻辑优先收敛成无依赖纯函数，避免把旧 view-model 整段拖进来；趋势/推荐用引用式会话（只存 runId），run 不存在时静默忽略，不报错。

## [2026-07-16] [通用] Windows 下向测试文件追加含中文的内容

- 现象/目标：给 `tests/*.e2e.mjs` 追加含中文正则（如 `/Safe demo|安全 Demo/i`）的内容后，`biome check` 报 `stream did not contain valid UTF-8` 内部错误。
- 根因/思路：用 `Out-File -Encoding utf8` 写入会给文件加 BOM（EF BB BF），biome 的底层 reader 对带 BOM 或被 PowerShell 二次编码的中文产生误判；且该错误在原始提交版本上就已存在，是 biome 在 Windows 上对含 CJK 的 test 文件的已知 I/O 怪象，并非我改动引入。
- 解法：用 `.Substring`/`[System.IO.File]::WriteAllBytes` 去掉 BOM；用 `node --check` 单独验证 `.mjs` 语法（biome 不可用时）；`pnpm lint` 仍会因该文件报内部错误，但全仓 302 个文件实际“No fixes applied”，属可忽略的 Windows 怪象。
- 教训/可复用点：PowerShell 追加中文文本别用 `Out-File -Encoding utf8`（会加 BOM），改用普通重定向或先写无 BOM 文件；biome 对含中文测试文件的 UTF-8 报错在 Windows 上是环境怪象，用 `node --check` 兜底验证语法即可。

## [2026-07-16] 新版 Evidence 接入真实 Trace 回放

- 现象/目标：新版工作台 Evidence 页的 Trace 区块只是占位，旧版靠相对 URL 巧合命中 trace 文件，真实/导入结果无法稳定回放（P1「Trace 路径再次分裂」）。
- 根因/思路：CLI 静态服务只覆盖 `WEB_REPORT_DIST_ROOT`，真实 trace 在 `.agentarena/runs|<ui-runs>/<runId>/agents/<variantId>/trace.jsonl`，相对路径无法解析；身份也无法绑定到 run+variant。
- 解法：新增 `GET /api/trace?runId&variantId` 端点（packages/cli），服务端按 workspace 解析并用 `isPathInsideWorkspace`  containment 防逃逸；前端新增 `domain/trace.ts`（纯函数）、`useTrace` hook、`TraceReplay` 与 `FileChanges` 组件，demo 用内置样例离线回放、真实结果经端点加载，缺失/错误降级为文本。
- 教训/可复用点：新前端取 Trace 必须走身份绑定的后端端点，不要用相对路径猜测；CLI 资产由 `copy-cli-assets.mjs` 从 `apps/web-report/dist` 复制到 `packages/cli/assets`，新增 public 资源后必须重 build CLI 才会进入运行产物，否则浏览器 404 且难查。

## [2026-07-15] 渐进式前端迁移保留稳定业务能力

- 现象/目标：重建实验工作台的信息结构和界面，同时不能破坏已稳定的运行、报告、导入、离线和本地配置隔离能力。
- 根因/思路：现有前端虽然拆出文件，但状态和页面职责仍集中；继续叠加难以控制，一次性重写又会复制大量隐藏兼容行为。
- 解法：采用轻量新应用壳，先统一数据和证据身份，再以双入口按完整页面迁移；默认切换和旧版删除分成两个发布门槛。
- 教训/可复用点：复杂界面迁移应先稳定数据边界，以页面为发布和回退单位，最后才移除旧实现，不能用整套重写换取表面整洁。

## [2026-07-14] [通用] 子进程密钥不能通过临时启动脚本传递

- 现象/目标：第三方 Provider 已与个人配置隔离，但 Windows 后台启动脚本仍可能把完整环境写入磁盘，导致密钥短暂落盘。
- 根因/思路：进程环境与脚本内容混为一体；内存中的敏感变量被序列化成了可读取文件。
- 解法：启动脚本只保留进程引导信息，敏感环境直接传给子进程；同时实际观察运行中的脚本并验证清理失败会阻止成功结果。
- 教训/可复用点：敏感信息只能存在于受控进程环境，不能为了跨进程传参而写入命令行、脚本、日志或诊断文件。

## [2026-07-14] [通用] 无人值守工具不能把交互授权当成运行时细节

- 现象/目标：Claude 登录和 Provider 检查都正常，但官方任务等待授权直到超时，第三方任务则退出成功却没有写入文件。
- 根因/思路：安全整改取消了默认跳过权限，但运行前检查仍只验证安装和登录，没有验证无人值守任务必需的明确授权。
- 解法：未显式开启时在页面、预检和直接执行入口统一阻止并说明风险；开启后用官方与第三方真实任务分别验证。
- 教训/可复用点：无人值守系统必须把交互权限当成前置契约，不能等到执行中再靠超时暴露。

## [2026-07-13] [通用] 外部工具隔离必须覆盖探测、执行和进程继承

- 现象/目标：第三方 Claude 需要全新配置环境，但鉴权探测会改项目设置，Windows 子进程还会继承未传入的个人登录变量。
- 根因/思路：探测与执行分别拼装环境，后台启动包装器又把“省略变量”误当成“继续继承”。
- 解法：官方模式直用当前配置；第三方统一创建临时配置、限制设置来源和 MCP，并让 Windows 严格采用传入环境；工作区工具配置在 Git 基线前移除。
- 教训/可复用点：隔离不是设置几个新变量，而是要同时统一配置来源、工作目录、子进程继承、失败关闭和清理生命周期。

## [2026-07-13] [通用] 提交前独立审查必须覆盖并发、真实路径和地址格式

- 现象/目标：自动检查全绿后，独立审查仍发现状态保存重叠、目录链接逃逸和 IPv6 本机地址无效。
- 根因/思路：普通成功路径没有覆盖保存顺序、解析后的真实位置和 IPv6 URL 方括号规则。
- 解法：串行化可靠保存并传播失败；同时检查文字路径与真实路径；统一生成 IPv4/IPv6 本机地址，并补真实请求测试。
- 教训/可复用点：全绿不等于边界完整；提交前复审应主动构造并发、链接跳转和不同地址族的反例。

## [2026-07-13] 补齐本地任务包的信任边界

- 现象/目标：本地模式已拒绝外部仓库，但任务包读取过晚才报错，且仍可请求继承本机 Git 登录辅助设置。
- 根因/思路：入口校验与执行环境使用了不同规则，“本地文件”又被误当成“可信输入”。
- 解法：读取任务包时就统一校验仓库来源；Git 登录辅助设置默认不传递，只允许操作者明确开启；页面和文档补充社区任务包提醒。
- 教训/可复用点：信任边界要在最早入口生效，并由同一规则贯穿类型、读取、执行和用户提示。

## [2026-07-13] 拆分网页运行职责并让浏览器检查真正把关

- 现象/目标：一个网页处理入口同时承担运行、日志、实时推送和页面响应；浏览器缺失时强制检查仍会跳过。
- 根因/思路：运行生命周期没有独立边界，测试又把“没有执行”当成“通过”。
- 解法：把运行相关请求和状态类型拆到独立模块；强制浏览器检查时，浏览器不可用会直接失败；导入错误同时显示在当前操作区。
- 教训/可复用点：关键检查必须证明功能真的执行过；集中状态不等于把所有职责塞进同一个入口。

## [2026-07-13] [通用] 结果保存故障测试必须命中真实写入路径

- 现象/目标：已有故障测试声称覆盖保存失败，但实际修改的文件接口从未被生产代码调用，无法阻止损坏结果被当成未完成而重复执行。
- 根因/思路：原测试替换了表面 API，真实保存链路使用文件句柄和替换操作；Windows 覆盖旧文件还存在中断窗口。
- 解法：在真实文件句柄和替换步骤注入失败；替换前保留可恢复副本，失败后恢复；损坏结果明确拒绝恢复，保存失败立即停止运行。
- 教训/可复用点：故障测试必须先证明注入点确实被调用；可恢复记录的写入失败不能降级成警告。

## [2026-07-12] 收回到纯本地运行边界

- 现象/目标：当前阶段只提供本机网页和本地/内置仓库，消除对外访问与外部下载带来的风险。
- 根因/思路：产品已暴露局域网监听和外部仓库入口，但没有完整的外部信任边界。
- 解法：拒绝非本机监听地址和外部仓库 URL，并删除运行层的外部下载与凭据传递路径。
- 教训/可复用点：当产品声明本地优先时，入口、类型约束、运行逻辑和文档必须同时收回，不能只靠说明约束。

## [2026-07-07] 修复实时输出和远程流连接失效

- 现象/目标：开启实时活动事件后页面收不到 agent 输出，远程访问时 SSE 连接也可能被鉴权拦住。
- 根因/思路：runner 只给单个 agent 传了活动采集依赖，没把活动回调接回进度事件；EventSource 又不能带 Authorization 头。
- 解法：把 agent 活动回调接入进度事件和页面状态，允许 `/api/run-stream` 使用查询 token，并补齐断线回退、默认输出目录和 trace 文件关闭。
- 教训/可复用点：实时 UI 必须验证从执行端到浏览器的完整链路；EventSource 鉴权要单独设计，不能套用只支持请求头的接口规则。

## [2026-07-06] [通用] 修复运行日志、页面恢复和正则超时稳定性

- 现象/目标：修复审查发现的运行日志丢失、页面刷新恢复不稳、正则超时无效、trace 重复读取等稳定性问题。
- 根因/思路：问题分散在运行链路、浏览器状态恢复、阻塞型正则执行和并发读取边界，单点修补不足以保证端到端稳定。
- 解法：补齐活动输出传递、让正则在可终止的隔离执行中运行、串行化 trace 读取，并修复页面标题分隔符的编码问题。
- 教训/可复用点：稳定性修复要覆盖真实入口和生成产物，不能只看源码；涉及 UI 状态恢复时要用浏览器回归确认。


## [通用] 2026-07-06 TypeScript 类型检查在本仓库 Windows pnpm 环境下的两个坑

- 现象：`tsc` 报 `Cannot find type definition file for 'node'`，以及 workspace 依赖 `@agentarena/core` 报 `Cannot find module`。
- 根因：① `node_modules/@types/node` 是指向 pnpm store 的目录联结（junction），但 `index.d.ts` 经该联结子路径解析失败；② `@agentarena/core` 仅 workspace 符号链接、未 `build` 出 `dist` 时 `.d.ts` 不存在，tsc 同样解析不到。
- 解法：验证用临时 `tsconfig.verify.json` 把 `typeRoots` 指向 pnpm store 实际路径（`node_modules/.pnpm/@types+node@<ver>/node_modules/@types`），并把 `@agentarena/core` 用 `paths` 映射到已 `build` 的 `dist/index.d.ts`；`include` 只放本包 `src`，避免把 core 源码拉进 `rootDir` 触发 TS6059/TS6307。验证完删掉临时 tsconfig。
- 教训：本仓库 `node_modules` 不完整、符号链接在 Windows 上解析不稳；单包类型校验优先 `build` 依赖 + 临时 `paths`/`typeRoots` 指向 store，不要用把源码拉进 `rootDir` 的 `paths` 映射。

## [通用] 2026-07-06 安全基线改为"默认安全、放开需显式 opt-in"

- 现象：审查发现 agent 传输默认 `--dangerously-skip-permissions`、Codex 默认 bypass 沙箱、judge 默认 `allowEval`、多个本地 `/api/` 路由免鉴权——"默认放开"在引入社区任务包/自定义 judge（项目自述的首要攻击面）时即升级为 RCE/文件读取/XSS。
- 根因：历史实现把"本地可信"当默认，但社区任务包与自定义 judge 是未隔离的任意代码/命令执行入口。
- 解法：全面改为默认安全——传输不注入跳过权限标志、Codex 真实尊重 sandbox 模式、judge 默认关闭 `allowEval`、敏感/破坏型 API 路由强制鉴权、web-report 的 `new Function` 仅限可信来源、token 不再经 URL hash；放开需显式环境变量/配置 opt-in。
- 教训：凡涉及"执行外部/社区提供的命令、脚本、judge、任务包"的代码路径，基线必须是默认拒绝、opt-in 放开，不要把"本地跑"的便利性当成安全性假设。

## [通用] 2026-07-02 templates.ts 中 spawnSync 使用 shell:true 导致命令注入风险

- 现象：`packages/cli/src/templates.ts` 中三处 `spawnSync` 调用在 Windows 上使用 `shell: process.platform === "win32"`，shell 会解释参数中的特殊字符，存在命令注入风险。
- 根因：`shell: true` 在 Windows 上通过 `cmd.exe` 执行命令，参数中的 `&`、`|`、`>` 等字符会被 shell 解释。虽然当前参数来自内部模板而非用户输入，但这是安全反模式。
- 解法：移除所有三处的 `shell: process.platform === "win32"` 选项。所有命令（`pnpm`、`npm`、`npx`）都是已知二进制文件，参数以数组形式传递，Node.js 的 `spawnSync` 在 Windows 上能直接通过 `CreateProcess` 解析 `.cmd`/`.exe`，无需 shell 介入。
- 教训：`spawnSync` 传数组参数时永远不需要 `shell: true`。`shell: true` 仅在需要 shell 内置功能（如管道、通配符展开）时才使用，且此时应确保参数经过适当转义。

## [通用] 2026-07-02 splice 在循环中固定位置插入导致输出逆序

- 现象：`decision-report.ts` 中 failure diagnosis 区块的条目顺序与 `report.failureDiagnostics` 数组顺序相反。
- 根因：循环内反复调用 `lines.splice(lines.length - 3, 0, ...)` 在固定位置插入，每次新内容都挤到之前插入内容的前面，导致整体逆序。
- 解法：先用 `diagLines` 数组按正序收集所有诊断行，循环结束后一次性 `lines.splice(lines.length - 3, 0, ...diagLines)` 插入。
- 教训：在循环中用 `splice` 向同一位置插入会反转顺序。正确做法是先收集再批量插入，或用 `unshift` 反向遍历。

## [通用] 2026-07-02 --json 模式下结构化日志污染 stdout 导致输出不可解析

- 现象：`agentarena run --json` 的 stdout 里混入了 INFO 级别的 JSON 日志行，导致 `jq` 等工具解析失败。
- 根因：`logging.ts` 的 `log()` 函数对 INFO 级别用 `console.log()`（写 stdout），与最终 JSON 结果输出共用同一流。
- 解法：在 `logging.ts` 中增加全局 `jsonOutputMode` 开关，`run.ts` 检测到 `--json` 时调用 `setJsonOutputMode(true)`，INFO/DEBUG 日志改走 `process.stderr.write()`。ERROR/WARN 已经走 stderr 不受影响。
- 教训：CLI 工具的 stdout 是机器可读接口，任何非结果输出（日志、进度、提示）都必须走 stderr。这是 Unix 管道设计的基本约定，但很容易在"加个 console.log"时被忽略。

## [通用] 2026-07-02 Windows 子进程输出编码不匹配导致 doctor 乱码

- 现象：中文 Windows 上 `agentarena doctor` 显示的子进程错误信息是乱码（如"'xxx' 不是内部或外部命令"的中文翻译）。
- 根因：Windows 控制台默认使用 ANSI 代码页（如 CP936/GBK），但 `runProcess` 用 `Buffer.toString("utf8")` 解码，非 UTF-8 字节序列被替换为 U+FFFD。
- 解法：新增 `decodeProcessOutput()` 函数——先尝试 UTF-8，如果检测到 U+FFFD 替换字符且在 Windows 上，通过 `chcp` 获取系统代码页并用 `TextDecoder` 重新解码。覆盖 GBK/Big5/Shift-JIS/EUC-KR/Windows-125x 等常见编码。
- 教训：Node.js 的 `Buffer.toString("utf8")` 不会抛异常，只会静默插入替换字符。在 Windows 上处理子进程输出时，必须考虑系统 ANSI 代码页的回退。`TextDecoder` 原生支持 GBK 等编码（前提是 Node.js 带完整 ICU）。

## [通用] 2026-07-02 CSS 文件中嵌入的 Emoji 字符因编辑器损坏产生不可见控制字符

- 现象：web-report 的"评分权重"折叠面板标题前显示乱码或不显示图标。
- 根因：`styles.css` 中 `content: '⚙️'` 的 Emoji 在某次编辑中被损坏——UTF-8 多字节序列的前导字节丢失，残留 `\x16`（SYN）和 `\x15`（NAK）控制字符。这些字符不可见但会破坏 CSS 解析。
- 解法：用 Node.js 脚本扫描 CSS 文件中所有 U+0000–U+001F（除 Tab）的控制字符，替换为正确的 Emoji 字符。
- 教训：编辑器对非 ASCII 字符的损坏是静默的——文件能保存、能构建，但运行时表现异常。对 CSS `content` 属性中的 Unicode 字符，优先使用 CSS 转义序列（如 `\2699`）而非直接嵌入 Emoji 字符，可避免此问题。

## [通用] 2026-07-01 Judge 安全策略不一致导致 node -e 命令被拦截

- 现象：用户用默认 repo-health 模板跑分，test-result 和 lint-check judge 总是失败，报 "Eval-style invocation (-e/-c/--eval) is not allowed"。大量官方任务包也用了 `node -e`，全部受影响。
- 根因：`command-runner.ts` 的 `executeCommand` 支持通过 `options.allowEval` 控制 eval 拦截。只有 `command` 类型 judge 传了 `{ allowEval: true }`，而 `test-result`、`lint-check`、`patch-validation`、`compilation` 四种 judge 都没传，导致它们走默认值（仅检查 `AGENTARENA_ALLOW_EVAL_IN_JUDGES=1` 环境变量），默认拒绝。
- 解法：给四种 judge 的 `executeCommand` 调用统一加上 `{ allowEval: true }`，与 `command` judge 保持一致。
- 教训：安全策略要在所有执行路径上保持一致。如果一种 judge 类型允许 eval，其他类型也应该允许——它们的命令来源相同（任务包文件），安全边界没有区别。新增 judge 类型时，检查是否需要传 `allowEval`。

---
## [2026-07-19] ????????????????

- ??/???30 ???????????????????????
- ??/???README ???????????????????????????????
- ????? `scripts/sync-taskpack-catalog.mjs`??????????????? `pnpm taskpacks:sync` ? `pnpm taskpacks:check`?????????
- ??/???????????????????????????????????

## [2026-07-18] ?? Demo ? CLI ????????

- ??/???CLI ????????? Demo ??????????????????????????????
- ??/???????????????????????????????????????????
- ????? CLI ????????????????????????????? Demo ???????
- ??/????????????????????????????

## [2026-07-18] Trace ???????????

- ??/????????????????????????????????
- ??/????????????????????????????????
- ????? run marker?trace resume ? `agent.cancelled` ?????????????????
- ??/???????????????????????????????

## [2026-07-18] ???????????????

- ??/????????????? `eval`???????? `AGENTARENA_ALLOW_EVAL_IN_JUDGES=1` ??????
- ??/???CLI ? UI ???????????? `false`????????????????
- ????????????????????????????????? CLI?UI ??????
- ??/????????????????????????????????????????/????

## [2026-07-18] ????????????????

- ??/????????????????????????
- ??/???????????????????????????????
- ??????????????????????????????????????????????
- ??/?????????????? Node ??????????????????????

## [2026-07-18] Workbench ??? Node ????? TypeScript ?????

- ??/???Workbench ?????????????? Node ????????????
- ??/???Node ? ESM ?????????? TypeScript ?????????
- ????? Workbench ????????????????????????????????
- ??/????????????????? Node ????????????????

## [2026-07-18] ? diffReliable ??????

- ??/?????????????????????????????????????????
- ??/??????????????????????????????????????
- ???? `diffReliable` ???????????????????????
- ??/????????????????????????????????????????

## [2026-07-16] 工作台 PWA：首次安装 service worker 的 controllerchange 不应 reload

- 现象/目标：加离线 PWA（sw.js + 注册）后，workbench 三个 e2e 报 `errors` 数组非空，命中 `assert.deepEqual(errors, [])`；监控到 `/api/ui-info`、`/api/agent-detection`、`/api/taskpacks`、`/api/provider-profiles` 首屏全部 `net::ERR_ABORTED`。
- 根因/思路：`main.tsx` 注册 SW 后无条件监听 `controllerchange` 并 `location.reload()`。`sw.js` 在 `install` 时 `skipWaiting()`、`activate` 时 `clients.claim()`，会令**首次安装**也触发 `controllerchange`。reload 发生在 `useWorkbench` 的 `refreshEnvironment()` 仍在进行 4 个 `/api/*` 请求时 → 请求被取消（abort），且造成首屏闪烁。`provider-profiles` 单独 401 是 localhost 鉴权豁免边界差异，非主因。
- 解法：把 reload 绑定到「主动 `postMessage(SKIP_WAITING)`（即发现更新版 SW）」这一事实——仅在 `updatefound` 监听里、worker `installed` 且有旧 controller 时置 `pendingSkip` 再跳等待；首次 install 的 `controllerchange` 不 reload（页面本就已被新 worker 接管）。诊断脚本证实 6 个 `/api/*` 全部 200，无 aborted；e2e 3/3 复绿。
- 教训/可复用点：[通用] 注册 SW 时 `controllerchange → reload` 必须区分「首装 claim」与「更新跳过等待」；标准 PWA 只在后者 reload，否则会打断进行中的请求并闪烁。验证「无网络错误」类 e2e 时，用 Playwright `response`/`requestfailed` 监听打印每个 `/api` 请求的真实状态，比只看断言快定位。

## [2026-07-16] 阶段9 遗留收尾：Trace Worker + FileChanges 行级 diff 就绪

- 现象/目标：阶段9 两项遗留未完成——大 Trace 主线程卡顿、FileChanges 无行级改动。
- 根因/思路：runner 跑完即清理 workspace，只存文件名不存内容，行级 diff 对已完成 run 不可重建（需 runner 改动，仅惠及未来 run，需单独授权）；大 Trace 的 `buildTimeline` 在主线程跑会卡 UI。
- 解法：新增 `workers/trace-worker.ts`（>2000 事件走 Worker 解析，先发前 500 步，`loadFull` 拉全量，报错回退主线程）；`FileChanges` 支持 `DiffBlock` 渲染统一 diff（红绿/上下文行，无 innerHTML 防 XSS），`NormalizedAgentResult.fileDiffs` 已接好，runner 何时存内容即可零成本接入。
- 教训/可复用点：跨端数据缺失（如行级 diff）若需改 runner 才能补全，前端先做成「结构就绪」而非硬造数据；重计算放 Worker，主线程只兜底。

## [2026-07-16] e2e 测试中文正则编码损坏导致 compare 测试永久超时

- 现象/目标：阶段10 提交的 compare e2e 测试在套件和单独运行都卡 30s+ 等「Safe demo」按钮，但同结构 evidence 测试却过。
- 根因/思路：compare 测试块的中文正则（如 `/Safe demo|安全 Demo/i`、`/Save session|保存会话/i`）在提交时被以错误编码（GBK 字节混进 UTF-8 文件，或乱码成 U+FFFD）写入；i18n 默认 zh-CN 时按钮文案是 UTF-8「安全 Demo」，正则里的坏字节匹配不到 → 超时。另一错误：断言 `.trend-grid/.muted-line`，但 demo 只加载 1 个 run，compare 页走 `runs.length < 2` 的 empty-state 分支，根本不渲染这两个类。
- 解法：用 PowerShell 以 UTF-8 字节级核对，把损坏中文还原为正确 UTF-8；断言改为等 `.empty-state, .compare-session`（单 run 真实渲染），session 按钮存在时才校验；单独跑 2.9s 通过，全量 15/15 绿。
- 教训/可复用点：[通用] 往 UTF-8 源码里写中文时，绝不用 GBK 视角的编辑器/工具（PowerShell ISE、某些 heredoc）落盘，否则混合编码极难肉眼发现；e2e 断言要匹配「当前数据下的真实渲染分支」，demo 单 run 不可比时该显示 empty-state 而非 trend 区。

## [2026-07-16] 新版 Compare 接入基线趋势 / 交叉会话 / 保存分享

- 现象/目标：Compare 页只有单基准 + 候选排除，缺历史趋势、多运行交叉聚合和会话持久化（阶段10）。
- 根因/思路：旧版 `view-model/comparison.js` 已有 `getAgentTrendRows`/`getCrossRunCompareRows` 等逻辑，但新版工作台未暴露；且带重 legacy 依赖，不能整段引入。
- 解法：新增独立 `domain/compare.ts`（纯函数，复用同一套公平规则但自含评分，不引 legacy）、`useCompareSession` hook（localStorage 引用式保存）、`TrendSparkline` 纯 SVG 组件；Compare 页拆成「公平比较 / 基线趋势 / 交叉会话」三块，未知指标显示「未知」不补零，推荐项仅在有成功 agent 时出现，可信度低时显示 caution 横幅。
- 教训/可复用点：新版 domain 逻辑优先收敛成无依赖纯函数，避免把旧 view-model 整段拖进来；趋势/推荐用引用式会话（只存 runId），run 不存在时静默忽略，不报错。

## [2026-07-16] [通用] Windows 下向测试文件追加含中文的内容

- 现象/目标：给 `tests/*.e2e.mjs` 追加含中文正则（如 `/Safe demo|安全 Demo/i`）的内容后，`biome check` 报 `stream did not contain valid UTF-8` 内部错误。
- 根因/思路：用 `Out-File -Encoding utf8` 写入会给文件加 BOM（EF BB BF），biome 的底层 reader 对带 BOM 或被 PowerShell 二次编码的中文产生误判；且该错误在原始提交版本上就已存在，是 biome 在 Windows 上对含 CJK 的 test 文件的已知 I/O 怪象，并非我改动引入。
- 解法：用 `.Substring`/`[System.IO.File]::WriteAllBytes` 去掉 BOM；用 `node --check` 单独验证 `.mjs` 语法（biome 不可用时）；`pnpm lint` 仍会因该文件报内部错误，但全仓 302 个文件实际“No fixes applied”，属可忽略的 Windows 怪象。
- 教训/可复用点：PowerShell 追加中文文本别用 `Out-File -Encoding utf8`（会加 BOM），改用普通重定向或先写无 BOM 文件；biome 对含中文测试文件的 UTF-8 报错在 Windows 上是环境怪象，用 `node --check` 兜底验证语法即可。

## [2026-07-16] 新版 Evidence 接入真实 Trace 回放

- 现象/目标：新版工作台 Evidence 页的 Trace 区块只是占位，旧版靠相对 URL 巧合命中 trace 文件，真实/导入结果无法稳定回放（P1「Trace 路径再次分裂」）。
- 根因/思路：CLI 静态服务只覆盖 `WEB_REPORT_DIST_ROOT`，真实 trace 在 `.agentarena/runs|<ui-runs>/<runId>/agents/<variantId>/trace.jsonl`，相对路径无法解析；身份也无法绑定到 run+variant。
- 解法：新增 `GET /api/trace?runId&variantId` 端点（packages/cli），服务端按 workspace 解析并用 `isPathInsideWorkspace`  containment 防逃逸；前端新增 `domain/trace.ts`（纯函数）、`useTrace` hook、`TraceReplay` 与 `FileChanges` 组件，demo 用内置样例离线回放、真实结果经端点加载，缺失/错误降级为文本。
- 教训/可复用点：新前端取 Trace 必须走身份绑定的后端端点，不要用相对路径猜测；CLI 资产由 `copy-cli-assets.mjs` 从 `apps/web-report/dist` 复制到 `packages/cli/assets`，新增 public 资源后必须重 build CLI 才会进入运行产物，否则浏览器 404 且难查。

## [2026-07-15] 渐进式前端迁移保留稳定业务能力

- 现象/目标：重建实验工作台的信息结构和界面，同时不能破坏已稳定的运行、报告、导入、离线和本地配置隔离能力。
- 根因/思路：现有前端虽然拆出文件，但状态和页面职责仍集中；继续叠加难以控制，一次性重写又会复制大量隐藏兼容行为。
- 解法：采用轻量新应用壳，先统一数据和证据身份，再以双入口按完整页面迁移；默认切换和旧版删除分成两个发布门槛。
- 教训/可复用点：复杂界面迁移应先稳定数据边界，以页面为发布和回退单位，最后才移除旧实现，不能用整套重写换取表面整洁。

## [2026-07-14] [通用] 子进程密钥不能通过临时启动脚本传递

- 现象/目标：第三方 Provider 已与个人配置隔离，但 Windows 后台启动脚本仍可能把完整环境写入磁盘，导致密钥短暂落盘。
- 根因/思路：进程环境与脚本内容混为一体；内存中的敏感变量被序列化成了可读取文件。
- 解法：启动脚本只保留进程引导信息，敏感环境直接传给子进程；同时实际观察运行中的脚本并验证清理失败会阻止成功结果。
- 教训/可复用点：敏感信息只能存在于受控进程环境，不能为了跨进程传参而写入命令行、脚本、日志或诊断文件。

## [2026-07-14] [通用] 无人值守工具不能把交互授权当成运行时细节

- 现象/目标：Claude 登录和 Provider 检查都正常，但官方任务等待授权直到超时，第三方任务则退出成功却没有写入文件。
- 根因/思路：安全整改取消了默认跳过权限，但运行前检查仍只验证安装和登录，没有验证无人值守任务必需的明确授权。
- 解法：未显式开启时在页面、预检和直接执行入口统一阻止并说明风险；开启后用官方与第三方真实任务分别验证。
- 教训/可复用点：无人值守系统必须把交互权限当成前置契约，不能等到执行中再靠超时暴露。

## [2026-07-13] [通用] 外部工具隔离必须覆盖探测、执行和进程继承

- 现象/目标：第三方 Claude 需要全新配置环境，但鉴权探测会改项目设置，Windows 子进程还会继承未传入的个人登录变量。
- 根因/思路：探测与执行分别拼装环境，后台启动包装器又把“省略变量”误当成“继续继承”。
- 解法：官方模式直用当前配置；第三方统一创建临时配置、限制设置来源和 MCP，并让 Windows 严格采用传入环境；工作区工具配置在 Git 基线前移除。
- 教训/可复用点：隔离不是设置几个新变量，而是要同时统一配置来源、工作目录、子进程继承、失败关闭和清理生命周期。

## [2026-07-13] [通用] 提交前独立审查必须覆盖并发、真实路径和地址格式

- 现象/目标：自动检查全绿后，独立审查仍发现状态保存重叠、目录链接逃逸和 IPv6 本机地址无效。
- 根因/思路：普通成功路径没有覆盖保存顺序、解析后的真实位置和 IPv6 URL 方括号规则。
- 解法：串行化可靠保存并传播失败；同时检查文字路径与真实路径；统一生成 IPv4/IPv6 本机地址，并补真实请求测试。
- 教训/可复用点：全绿不等于边界完整；提交前复审应主动构造并发、链接跳转和不同地址族的反例。

## [2026-07-13] 补齐本地任务包的信任边界

- 现象/目标：本地模式已拒绝外部仓库，但任务包读取过晚才报错，且仍可请求继承本机 Git 登录辅助设置。
- 根因/思路：入口校验与执行环境使用了不同规则，“本地文件”又被误当成“可信输入”。
- 解法：读取任务包时就统一校验仓库来源；Git 登录辅助设置默认不传递，只允许操作者明确开启；页面和文档补充社区任务包提醒。
- 教训/可复用点：信任边界要在最早入口生效，并由同一规则贯穿类型、读取、执行和用户提示。

## [2026-07-13] 拆分网页运行职责并让浏览器检查真正把关

- 现象/目标：一个网页处理入口同时承担运行、日志、实时推送和页面响应；浏览器缺失时强制检查仍会跳过。
- 根因/思路：运行生命周期没有独立边界，测试又把“没有执行”当成“通过”。
- 解法：把运行相关请求和状态类型拆到独立模块；强制浏览器检查时，浏览器不可用会直接失败；导入错误同时显示在当前操作区。
- 教训/可复用点：关键检查必须证明功能真的执行过；集中状态不等于把所有职责塞进同一个入口。

## [2026-07-13] [通用] 结果保存故障测试必须命中真实写入路径

- 现象/目标：已有故障测试声称覆盖保存失败，但实际修改的文件接口从未被生产代码调用，无法阻止损坏结果被当成未完成而重复执行。
- 根因/思路：原测试替换了表面 API，真实保存链路使用文件句柄和替换操作；Windows 覆盖旧文件还存在中断窗口。
- 解法：在真实文件句柄和替换步骤注入失败；替换前保留可恢复副本，失败后恢复；损坏结果明确拒绝恢复，保存失败立即停止运行。
- 教训/可复用点：故障测试必须先证明注入点确实被调用；可恢复记录的写入失败不能降级成警告。

## [2026-07-12] 收回到纯本地运行边界

- 现象/目标：当前阶段只提供本机网页和本地/内置仓库，消除对外访问与外部下载带来的风险。
- 根因/思路：产品已暴露局域网监听和外部仓库入口，但没有完整的外部信任边界。
- 解法：拒绝非本机监听地址和外部仓库 URL，并删除运行层的外部下载与凭据传递路径。
- 教训/可复用点：当产品声明本地优先时，入口、类型约束、运行逻辑和文档必须同时收回，不能只靠说明约束。

## [2026-07-07] 修复实时输出和远程流连接失效

- 现象/目标：开启实时活动事件后页面收不到 agent 输出，远程访问时 SSE 连接也可能被鉴权拦住。
- 根因/思路：runner 只给单个 agent 传了活动采集依赖，没把活动回调接回进度事件；EventSource 又不能带 Authorization 头。
- 解法：把 agent 活动回调接入进度事件和页面状态，允许 `/api/run-stream` 使用查询 token，并补齐断线回退、默认输出目录和 trace 文件关闭。
- 教训/可复用点：实时 UI 必须验证从执行端到浏览器的完整链路；EventSource 鉴权要单独设计，不能套用只支持请求头的接口规则。

## [2026-07-06] [通用] 修复运行日志、页面恢复和正则超时稳定性

- 现象/目标：修复审查发现的运行日志丢失、页面刷新恢复不稳、正则超时无效、trace 重复读取等稳定性问题。
- 根因/思路：问题分散在运行链路、浏览器状态恢复、阻塞型正则执行和并发读取边界，单点修补不足以保证端到端稳定。
- 解法：补齐活动输出传递、让正则在可终止的隔离执行中运行、串行化 trace 读取，并修复页面标题分隔符的编码问题。
- 教训/可复用点：稳定性修复要覆盖真实入口和生成产物，不能只看源码；涉及 UI 状态恢复时要用浏览器回归确认。


## [通用] 2026-07-06 TypeScript 类型检查在本仓库 Windows pnpm 环境下的两个坑

- 现象：`tsc` 报 `Cannot find type definition file for 'node'`，以及 workspace 依赖 `@agentarena/core` 报 `Cannot find module`。
- 根因：① `node_modules/@types/node` 是指向 pnpm store 的目录联结（junction），但 `index.d.ts` 经该联结子路径解析失败；② `@agentarena/core` 仅 workspace 符号链接、未 `build` 出 `dist` 时 `.d.ts` 不存在，tsc 同样解析不到。
- 解法：验证用临时 `tsconfig.verify.json` 把 `typeRoots` 指向 pnpm store 实际路径（`node_modules/.pnpm/@types+node@<ver>/node_modules/@types`），并把 `@agentarena/core` 用 `paths` 映射到已 `build` 的 `dist/index.d.ts`；`include` 只放本包 `src`，避免把 core 源码拉进 `rootDir` 触发 TS6059/TS6307。验证完删掉临时 tsconfig。
- 教训：本仓库 `node_modules` 不完整、符号链接在 Windows 上解析不稳；单包类型校验优先 `build` 依赖 + 临时 `paths`/`typeRoots` 指向 store，不要用把源码拉进 `rootDir` 的 `paths` 映射。

## [通用] 2026-07-06 安全基线改为"默认安全、放开需显式 opt-in"

- 现象：审查发现 agent 传输默认 `--dangerously-skip-permissions`、Codex 默认 bypass 沙箱、judge 默认 `allowEval`、多个本地 `/api/` 路由免鉴权——"默认放开"在引入社区任务包/自定义 judge（项目自述的首要攻击面）时即升级为 RCE/文件读取/XSS。
- 根因：历史实现把"本地可信"当默认，但社区任务包与自定义 judge 是未隔离的任意代码/命令执行入口。
- 解法：全面改为默认安全——传输不注入跳过权限标志、Codex 真实尊重 sandbox 模式、judge 默认关闭 `allowEval`、敏感/破坏型 API 路由强制鉴权、web-report 的 `new Function` 仅限可信来源、token 不再经 URL hash；放开需显式环境变量/配置 opt-in。
- 教训：凡涉及"执行外部/社区提供的命令、脚本、judge、任务包"的代码路径，基线必须是默认拒绝、opt-in 放开，不要把"本地跑"的便利性当成安全性假设。

## [通用] 2026-07-02 templates.ts 中 spawnSync 使用 shell:true 导致命令注入风险

- 现象：`packages/cli/src/templates.ts` 中三处 `spawnSync` 调用在 Windows 上使用 `shell: process.platform === "win32"`，shell 会解释参数中的特殊字符，存在命令注入风险。
- 根因：`shell: true` 在 Windows 上通过 `cmd.exe` 执行命令，参数中的 `&`、`|`、`>` 等字符会被 shell 解释。虽然当前参数来自内部模板而非用户输入，但这是安全反模式。
- 解法：移除所有三处的 `shell: process.platform === "win32"` 选项。所有命令（`pnpm`、`npm`、`npx`）都是已知二进制文件，参数以数组形式传递，Node.js 的 `spawnSync` 在 Windows 上能直接通过 `CreateProcess` 解析 `.cmd`/`.exe`，无需 shell 介入。
- 教训：`spawnSync` 传数组参数时永远不需要 `shell: true`。`shell: true` 仅在需要 shell 内置功能（如管道、通配符展开）时才使用，且此时应确保参数经过适当转义。

## [通用] 2026-07-02 splice 在循环中固定位置插入导致输出逆序

- 现象：`decision-report.ts` 中 failure diagnosis 区块的条目顺序与 `report.failureDiagnostics` 数组顺序相反。
- 根因：循环内反复调用 `lines.splice(lines.length - 3, 0, ...)` 在固定位置插入，每次新内容都挤到之前插入内容的前面，导致整体逆序。
- 解法：先用 `diagLines` 数组按正序收集所有诊断行，循环结束后一次性 `lines.splice(lines.length - 3, 0, ...diagLines)` 插入。
- 教训：在循环中用 `splice` 向同一位置插入会反转顺序。正确做法是先收集再批量插入，或用 `unshift` 反向遍历。

## [通用] 2026-07-02 --json 模式下结构化日志污染 stdout 导致输出不可解析

- 现象：`agentarena run --json` 的 stdout 里混入了 INFO 级别的 JSON 日志行，导致 `jq` 等工具解析失败。
- 根因：`logging.ts` 的 `log()` 函数对 INFO 级别用 `console.log()`（写 stdout），与最终 JSON 结果输出共用同一流。
- 解法：在 `logging.ts` 中增加全局 `jsonOutputMode` 开关，`run.ts` 检测到 `--json` 时调用 `setJsonOutputMode(true)`，INFO/DEBUG 日志改走 `process.stderr.write()`。ERROR/WARN 已经走 stderr 不受影响。
- 教训：CLI 工具的 stdout 是机器可读接口，任何非结果输出（日志、进度、提示）都必须走 stderr。这是 Unix 管道设计的基本约定，但很容易在"加个 console.log"时被忽略。

## [通用] 2026-07-02 Windows 子进程输出编码不匹配导致 doctor 乱码

- 现象：中文 Windows 上 `agentarena doctor` 显示的子进程错误信息是乱码（如"'xxx' 不是内部或外部命令"的中文翻译）。
- 根因：Windows 控制台默认使用 ANSI 代码页（如 CP936/GBK），但 `runProcess` 用 `Buffer.toString("utf8")` 解码，非 UTF-8 字节序列被替换为 U+FFFD。
- 解法：新增 `decodeProcessOutput()` 函数——先尝试 UTF-8，如果检测到 U+FFFD 替换字符且在 Windows 上，通过 `chcp` 获取系统代码页并用 `TextDecoder` 重新解码。覆盖 GBK/Big5/Shift-JIS/EUC-KR/Windows-125x 等常见编码。
- 教训：Node.js 的 `Buffer.toString("utf8")` 不会抛异常，只会静默插入替换字符。在 Windows 上处理子进程输出时，必须考虑系统 ANSI 代码页的回退。`TextDecoder` 原生支持 GBK 等编码（前提是 Node.js 带完整 ICU）。

## [通用] 2026-07-02 CSS 文件中嵌入的 Emoji 字符因编辑器损坏产生不可见控制字符

- 现象：web-report 的"评分权重"折叠面板标题前显示乱码或不显示图标。
- 根因：`styles.css` 中 `content: '⚙️'` 的 Emoji 在某次编辑中被损坏——UTF-8 多字节序列的前导字节丢失，残留 `\x16`（SYN）和 `\x15`（NAK）控制字符。这些字符不可见但会破坏 CSS 解析。
- 解法：用 Node.js 脚本扫描 CSS 文件中所有 U+0000–U+001F（除 Tab）的控制字符，替换为正确的 Emoji 字符。
- 教训：编辑器对非 ASCII 字符的损坏是静默的——文件能保存、能构建，但运行时表现异常。对 CSS `content` 属性中的 Unicode 字符，优先使用 CSS 转义序列（如 `\2699`）而非直接嵌入 Emoji 字符，可避免此问题。

## [通用] 2026-07-01 Judge 安全策略不一致导致 node -e 命令被拦截

- 现象：用户用默认 repo-health 模板跑分，test-result 和 lint-check judge 总是失败，报 "Eval-style invocation (-e/-c/--eval) is not allowed"。大量官方任务包也用了 `node -e`，全部受影响。
- 根因：`command-runner.ts` 的 `executeCommand` 支持通过 `options.allowEval` 控制 eval 拦截。只有 `command` 类型 judge 传了 `{ allowEval: true }`，而 `test-result`、`lint-check`、`patch-validation`、`compilation` 四种 judge 都没传，导致它们走默认值（仅检查 `AGENTARENA_ALLOW_EVAL_IN_JUDGES=1` 环境变量），默认拒绝。
- 解法：给四种 judge 的 `executeCommand` 调用统一加上 `{ allowEval: true }`，与 `command` judge 保持一致。
- 教训：安全策略要在所有执行路径上保持一致。如果一种 judge 类型允许 eval，其他类型也应该允许——它们的命令来源相同（任务包文件），安全边界没有区别。新增 judge 类型时，检查是否需要传 `allowEval`。

---

## 2026-06-29 [通用] Codex adapter 在 Windows 上卡住（sandbox 提示）

- 现象：Windows 上运行 Codex adapter 时，命令行一直等待用户输入，卡住不动
- 根因：Codex CLI 在 Windows 上默认开启 sandbox 交互提示，非交互环境下 stdin 无法响应
- 解法：给 Codex adapter 的 spawn 参数加上 `--no-sandbox` 或设置环境变量跳过交互确认
- 教训：跨平台 adapter 开发时，Windows 的交互行为差异是最常见的卡住原因。所有外部 CLI 调用都应该设置 `stdio: ['ignore', 'pipe', 'pipe']` 或提供非交互标志

## 2026-06-29 Claude Code adapter 在 Windows 上找不到可执行文件

- 现象：Windows 上 `claude` 命令能跑但 adapter 报 `ENOENT`
- 根因：Windows 上 `claude` 实际是 `claude.cmd`，Node.js 的 `child_process.spawn` 不会自动解析 `.cmd` 扩展名
- 解法：spawn 时加 `shell: true`，或显式查找 `claude.cmd` 路径
- 教训：Windows 上所有 CLI adapter 都要处理 `.cmd`/`.bat`/`.exe` 扩展名问题。`shell: true` 是最简单的通用解法

## 2026-06-29 Web Report 社区排行榜 XSS 漏洞

- 现象：社区排行榜的 label 字段未转义直接插入 DOM，可被注入恶意标签
- 根因：web-report 是原生 JS SPA，没有框架自动转义，手动拼接 HTML 时遗漏了转义
- 解法：对所有外部数据（trace、community labels、leaderboard）统一做 HTML 转义后再插入 DOM
- 教训：不用框架的 SPA 要自己管 XSS。所有 `innerHTML` 操作前必须转义。最好封装一个 `escapeHtml()` 函数统一使用

## 2026-06-29 Report 分数计算在自定义权重变化后不更新

- 现象：用户修改自定义权重后，报告页面的分数没有重新计算
- 根因：权重变化后只更新了 UI 显示，没有触发分数重算逻辑
- 解法：权重变化时发出事件，监听器重新计算所有分数并更新 DOM
- 教训：自定义权重/配置变更后，要检查所有依赖它的派生计算是否都重新执行了。UI 状态和数据状态要保持单向数据流

## 2026-06-29 代码审查发现 17 个文件需要修复

- 现象：一次性 code review 发现 17 个文件有问题，涉及安全、逻辑、风格
- 根因：快速迭代期间没有持续 lint + typecheck，问题累积
- 解法：逐个修复后，在 CI 里加入 `pnpm lint` + `pnpm typecheck` 门禁，防止再累积
- 教训：monorepo 项目要定期跑全量 lint + typecheck。最好在 pre-commit 或 CI 里强制执行，不要等问题累积到 17 个文件再修

## 2026-06-10 [通用] Agent 执行完成后结果可恢复（crash recovery）

- 现象：Agent 执行中途如果 runner 进程崩溃，之前已完成的结果全部丢失，需要重新跑
- 根因：结果只在最终完成时一次性写出，没有中间态持久化
- 解法：runner 每完成一个 agent 的执行就持久化结果；重启后扫描已完成的结果，跳过重跑直接汇总
- 教训：长时间运行的任务（benchmark、批处理）必须有 checkpoint 机制。每完成一个子任务就持久化，crash 后从断点恢复而非全量重跑

## 2026-06-08 [通用] Windows shell 参数注入漏洞（adapters 模块）

- 现象：安全审计发现 agent adapter 在拼接 CLI 参数时存在注入风险，用户可控的 task prompt 可以注入额外 shell 命令
- 根因：`child_process.spawn` 在 Windows 上如果传了 `shell: true`，参数会经过 shell 解析，特殊字符（`&`、`|`、`;`）会被解释为命令分隔符
- 解法：对所有用户可控参数做 shell 转义；优先用 `execFile`（不走 shell）代替 `spawn(shell: true)`；加了 71+88 条注入测试
- 教训：Windows 上 `shell: true` + 用户输入 = 命令注入。任何拼接 CLI 参数的地方都要做转义，最好用不走 shell 的 API。安全审计要专门检查参数拼接路径

## 2026-06-08 [通用] 生成的 CI workflow 文件命令注入

- 现象：CLI 生成 GitHub Actions workflow 文件时，用户输入的命令直接拼接进 YAML，可注入任意 CI 命令
- 根因：模板字符串拼接时没有对 shell 特殊字符做转义
- 解法：所有写入 workflow YAML 的命令都加引号包裹，加了 49 条模板注入测试
- 教训：生成代码/配置文件时，用户输入必须经过转义。YAML 里的命令字符串要用引号包裹。代码生成器是注入攻击的高危区域

## 2026-06-08 [通用] Windows 上 authenticated git clone 失败

- 现象：Windows 上带认证的 git clone（含 token 的 URL）失败，Linux/macOS 正常
- 根因：Windows 的 git credential manager 和 URL 内嵌 token 的交互方式不同，URL 中的特殊字符（如 `/`、`@`）在 Windows 上需要不同处理
- 解法：在 repo-resolution 模块加 Windows 专属的 URL 编码逻辑，加了 87 条 Windows clone 测试
- 教训：涉及 git 操作的跨平台代码，Windows 的 credential 和 URL 处理是独立的 case。不能假设 Linux 上能跑的 clone 逻辑在 Windows 上也行

## 2026-05-17 [通用] 大量数据渲染卡顿：引入虚拟滚动

- 现象：排行榜和 trace replay 页面数据量大时（100+ 行），滚动卡顿明显
- 根因：所有行一次性渲染到 DOM，浏览器要维护大量 DOM 节点
- 解法：引入虚拟滚动，只渲染可视区域 + 少量缓冲行的 DOM 节点
- 教训：超过 50 行的列表就要考虑虚拟滚动。DOM 节点数是前端性能的第一杀手，虚拟滚动是最有效的优化手段
