# AgentArena 开发日志

> 按时间倒序。只记"当时花了时间想明白、且未来大概率会再遇到"的东西。
> 格式：现象/目标 → 根因/思路 → 解法 → 教训/可复用点。

---

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
