# Corn Bot P1：执行底座静态能力对照（DSH / OpenClaw / Mastra）

日期：2026-10-12。对应[后续统一实施计划](../plans/CORN_BOT_FORWARD_PLAN.md) §5.1 的 RT-DECISION 静态部分。

**本文只是只读静态对照。** 三份审计都只读了源码、文档和 npm 元数据，没有安装、启动任何候选，没有启动 App 或 Host，没有调用模型，也没有读取凭据。本文**不是选型决定**：选择哪个底座，要等 §5.2 的真实比较结果，并写进 ADR（建议编号 0007，创建前确认）。第 8 节的排序只是“真实比较先测谁”的建议。

标注约定：`supported` / `conditional` / `unavailable` 沿用计划 §5.1；“doc-only”表示只有文档声明、没在源码里核实；“未知”表示只能实测回答；“推断”表示源码里没有直接证据。

## 1. 固定版本

| 候选 | 固定点 | 说明 |
| --- | --- | --- |
| DSH | `dsh-v0.2.0-rc.2` / `639ed015`，与 `runtime.lock.json` 一致 | 源码 clone 在 `/Users/qin/deepseek-harness`（remote `deepseek-ai/deepseek-harness`，即 ADR-0006 记载的位置）。旧笔记里的 `deepseek-harness-desktop-official` 路径在本机不存在，不再引用。 |
| Claw | `v0.3.0-rc.2`（9 个组件都在该 tag，工作区干净） | `/Users/qin/DSH/plugins/dsh-claw-suite/`；MIT，自有。 |
| Corn 基线 | main `8b6989c` | 引用 Corn 文件时以此为准。 |
| OpenClaw | `v2026.10.2` / `b8952d477f0c932d8ddc6da5c89cab5a169b6ff1`（GitHub Latest，2026-10-12 发布） | npm `latest=2026.10.2`、`beta=2026.10.5-beta.1`、`extended-stable=2026.8.35`。Gateway wire v4，客户端与 Gateway 必须一起锁版本。**旧 pin `ebdc7d54` 是 main 上未发布的提交**，已与 release 分支分叉，不能作为可发布锁定点，本文取代它。 |
| Mastra | `81299c921d6f499d4c62f14c38e4d4d88b4fbfae`（2026-10-11 “exit prerelease mode”） | `@mastra/core@1.76.0`、`@mastra/libsql@1.26.0`、`@mastra/memory@1.37.0`、`@mastra/mcp@2.3.0`（可选）、CLI `mastra@1.34.0`，tag 都指向该提交；原生依赖 `@libsql/client@0.18.0` → `libsql@0.5.29`。**旧 pin `3014f061` 已被取代**：run fencing 是 1.76.0 才加入的。 |

OpenClaw 和 Mastra 的浅克隆在项目外层 `Corn Bot/.cache/research-src/`，不进仓库。

## 2. 统一能力表（13 行）

每格写法：**状态**，一句证据要点；“缺口”是 Corn 仍要做的事或未知项。具体 `path:line@pin` 引用见附录 A/B/C，按行号对应。

| # | 能力 | DSH 0.2.0-rc.2 + Claw 0.3.0-rc.2 | OpenClaw v2026.10.2 | Mastra 1.76.0 |
| --- | --- | --- | --- | --- |
| 1 | 模型设置 | **conditional**。全局默认和 Key 的读写已实测；**会话 / Bot 级覆盖 unavailable**：公开的 `session.selectModel` 会改写全局默认。缺口：上游补丁 U1；Key 是明文 0600 文件。 | **conditional**。可按 agent 设模型，`sessions.create/patch.model` 可覆盖会话模型。缺口：Key 以明文 JSON 存在 SQLite；agent 之间会读穿共享凭据；覆盖是否立即生效、重启后是否保留，未知。 | **conditional**。可按请求或调用选模型，AgentController 按线程持久保存切换。缺口：没有凭据存储；没传 key 时会回退读 `process.env`；模型数组会自动切换服务商，无法配置。 |
| 2 | 身份 / 会话创建 | **supported**。Claw Registry 的 create、ensure、bind 已实测；`session.create` 可幂等接管。缺口：映射持久化（DATA-01）；返回 `presetError` 时必须显式 ensure。 | **supported**。有 `agents.create`，`sessions.create` 支持 agentId、label、model、idempotencyKey。缺口：`agents.create` 需要 admin；ID 映射表由 Corn 自建。 | **supported**。Agent 可在代码里创建，也可用 `addAgent` 运行时注册；`createSession` 可绑定指定线程。缺口：AgentController 的 Session 状态只在内存；不能用 Stored Agents / editor（含 EE 代码）。 |
| 3 | 消息受理幂等 | **conditional**。`requestId` 存进 `source.rpcId` 做去重，但查重和插入之间隔着一次 await，并发的重复请求可能都通过。缺口：C5（单写者、持久 requestId、丢回执后对账）。 | **conditional**。`idempotencyKey` 必填，且直接成为 runId；去重表在内存，保留 5 分钟、最多 1000 条。缺口：超时或重启后不保证去重，要先用 `chat.history` 对账再重试。 | **conditional**。`sendMessage` / `stream` 没有去重，重试会再跑一轮，工具副作用也会重复。缺口：Corn 必须先在数据库里受理，再调用 Mastra。 |
| 4 | 只读历史 | **supported，但顺序敏感**。先 `projections`（取 asOfSeq）再 `page`（throughSeq）不会激活 Agent；冷 `follow` 会把 Agent 唤醒。缺口：transport 白名单缺 `session/projections`（C2）。 | **supported（部分 doc-only）**。`chat.history`、`sessions.preview` 不调模型。缺口：`chat.history` 会还原冷归档；发一条新消息会触发 recover，所以不能用“发消息”来查状态。 | **supported**。存储层的 `listMessages` / `listThreads` 不唤醒 Agent。缺口：低；UI 改读 Corn 投影。 |
| 5 | 实时流 | **conditional**。`follow` 先给快照，然后按持久 seq 连续推送。缺口：请求不支持 `afterSeq`，重连只能拿新快照再用 page 补洞。 | **conditional**。每个 run 的事件带 `seq`，跳号就重载历史；delta 补齐上限 200 条或 1MB。缺口：外层 seq 按连接计、重连清零，不能按 seq 重放。 | **conditional**。普通 stream 没有持久序号；重放缓存默认在内存（5 分钟），且没有 LibSQL 实现。缺口：Main 自建单调序号投影；重启后未落盘的片段无法回放。 |
| 6 | 审批结算 | **supported（Turn / callId 级）**。顺序是 pre-execute → 审批 → guard；中止后结果为 cancelled，迟到的回答被丢弃，没有应答方时默认拒绝。缺口：审批没有超时；绑定到 Attempt / 代次要做 C4。 | **conditional**。审批绑定 toolCallId 和 runId，先答者生效，10 分钟超时即拒绝，run abort 后取消等待，批准时冻结参数。缺口：不认识 Corn 的代次。 | **conditional**。审批绑定 runId 和 toolCallId，只认恢复入口传来的结果；停止会删除挂起快照，但删除是异步、不等待完成的。缺口：不绑定代次或参数哈希，批准后直接执行；AgentController 的审批闸门只在内存。 |
| 7 | 取消 | **conditional**。`session.cancel` 只取消该 Session 当前的 Turn；**按 Run 定点取消 unavailable**。缺口：前台和后台必须用不同 Session；子代理和后台 Shell 是否会被连带终止，未知。 | **conditional**。`chat.abort` / `sessions.abort` 可按 runId 停止，有作用域，不会误停。缺口：回执只表示信号已发出；不理会取消的工具可能在 run 结束后才返回。 | **conditional**。`abortRunStream` 和 `manager.cancel(taskId)` 都是请求式取消。缺口：没有“已真正停止”的确认；停父 run 不会级联取消它的后台任务（推断）。 |
| 8 | 每次派发的任务控制检查 | **conditional（有公开挂点）**。`tools.guard()` 同步、只能拒绝，在审批之后运行，任何监听器都推翻不了。缺口：Corn 尚未实现（C1）；guard 与 `tools/execute` 包装器之间有时间窗。 | **内建 unavailable，有挂点**。`before_tool_call` 链（trusted policy 先、普通 hook 后）每次派发都会经过。缺口：它不认识 attempt、stopEpoch、lease，这部分全由 Corn 写。 | **内建 unavailable**。只有 durable 运行权 fencing 和后台任务租约，检查的是“哪个进程拥有这个 run”。缺口：Corn 写 `governedTool()` 包装层。 |
| 9 | 重启恢复 | **conditional**。未闭合的 Turn 会补上合成结束，在途工具记为错误，不重放；SIGKILL 恢复已实测。缺口：收件箱里的待处理项会不会自动开 Turn、profile 组件会不会在启动时激活 Session，未知。 | **conditional，与计划冲突**。恢复始终开启：重启后会自动给主会话发合成消息续跑，静态没找到关闭开关。缺口：与 §8.2“先只读对账”冲突；Full Access 会话保留完整工具。 | **conditional**。durable 恢复默认关闭，但开启后会重放模型和工具调用；`recoverStaleTasksOnStart` **默认 true**，会自动重新派发。缺口：两者都必须显式关闭，再自建只读对账。 |
| 10 | **硬门槛：逐次派发治理** | **conditional**。普通调用已满足且有实测；停止 fencing、过期控制和审计归属要靠 C1 补。 | **conditional**。挂点 fail-closed，嵌套调用逐个检查；但批准后不重查、没有 hook 就放行、不认识 Corn 代次。 | **内建不满足；靠自建包装可达（conditional）**。唯一逐次生效的授权点是 EE 的 FGA；Corn 要写 `governedTool()`，它能否覆盖所有工具未证实。 |
| 11 | 后台任务与前台独立响应 | **conditional / 未知**。每个 Session 一个独立 Agent，但共享同一个 Host 进程，LLM 层没有全局并发或优先级控制。缺口：`steer` / `updateQueue` 没有 revision 和采纳回执；前台时延只能实测。 | **conditional**。不同会话可并行（默认上限 `max(8, CPU×4)`）；steer 在下一个运行时边界注入；`activeRunIds` 和 narration 不调模型。缺口：steer 没有明确的采纳回执；utility 模型的后台调用会占用请求额度。 | **conditional**。后台任务的单位是“一次工具调用”；signal 在下一个循环边界送达。缺口：开 `untilIdle` 时结果回灌会让前台多跑一轮；进度只有状态；完成回调在内存，崩溃可能丢。 |
| 12 | 本地存储与打包 | **conditional**。Corn 未签名 arm64 包约 846 MB（其中 node_modules 约 526 MB）；Host 是一个用 Electron execPath 启动的子进程；全新 profile 已通过。缺口：进程数和内存没测过；`node:sqlite` 打包后未验证。 | **conditional**。必须用真实 Node 24（不能用 Electron execPath）和完整的 node_modules；根包解包后 257.7 MB、13,889 个文件，65 个依赖未计入。缺口：node-pty beta、koffi 等原生模块的签名公证；额外进程。 | **conditional**。纯进程内运行；core 75 MB + memory 11 MB + mcp 6.5 MB + libsql store 4 MB；原生 `libsql` 每个架构一个包，需要 asarUnpack。缺口：在 Electron 44 打包后能否加载未实测；与 `node:sqlite` 分两个库文件。 |
| 13 | 许可、成熟度、版本漂移 | **conditional**。DSH 与 Claw 都是 MIT；rc1→rc2 的核心路径没变。缺口：rc2→alpha.2 有 935 个提交、6259 个文件，改了 projections、删了 `tools.mode: both`；Claw 只有一位维护者。 | **conditional**。MIT（依赖未逐包审计）；约 23 天发了 11 个以上稳定版，main 每周约 3000 个提交，成熟度表全部 LTS=false（另有 extended-stable 线）。缺口：破坏性变更风险高，文档有滞后。 | **conditional（许可待定）**。包标 Apache-2.0，但 core 的 npm 包里带 66 个 `ee/` 文件，非 EE 代码运行时会 import `auth/ee`；EE 许可禁止生产使用和再分发。缺口：需维护者或法务决定；durable 仍是 beta。 |

体积口径不同：DSH 的 846 MB 是整个 Corn .app；OpenClaw 的 257.7 MB 只是根 npm 包，还要另加依赖、Node 24 运行时和 Corn 自身的 Electron；Mastra 的数字是各包解包体积，同样运行在 Corn 的 Electron 里。真实比较时要按同一口径重测。

## 3. 硬门槛逐项对比（第 10 行）

计划 §5.1 要求：每次真实工具派发都要经过可信、可审计的强制检查，能力上等价覆盖现有 Claw Gate、权限和审批绑定。下表按检查项拆开。“内建”指不写 Corn 代码时候选本身是否满足；“Corn 适配”写名称和挂点；“上游补丁”指是否需要改候选本身（选型期间一律不实施）。

| 检查项 | 候选 | 内建 | Corn 适配（名称与挂点） | 上游补丁 |
| --- | --- | --- | --- | --- |
| 每次派发的强制检查点 | DSH | **是**。`tools.guard()` 同步、只拒绝，在所有 pre-execute 和审批之后运行；PTC 内层调用也走同一准备流程。Claw Gate 已注册在这里。 | C1 `corn-run-control`：在全局 `tools.guard` 注册 Corn 控制检查。 | 否 |
| | OpenClaw | **是，但空链放行**。`before_tool_call` 链在多个工具装配点都有包装，`tools.invoke` 也走同一路径。 | `corn-governance` 插件：`api.registerTrustedToolPolicy`（不设 matcher，匹配全部工具）。 | 否 |
| | Mastra | **否**。审批判定只决定“要不要问人”；`processOutputStep` 每个模型步骤只调一次；没有“工具执行前”的处理器 hook；唯一逐次授权点是 EE 的 `requireFGA(TOOLS_EXECUTE)`。 | `governedTool()`：包住每个工具的 `execute`；构建 Agent 时断言所有工具都带 Corn 标记；用 `disableBuiltinTools` 关闭或包住内置工具。 | 如果包装覆盖不了框架内部生成的工具，就需要在非 EE 的 `builder.ts` `createExecute`（FGA 所在位置）加守卫 hook |
| 审批后重查 | DSH | **是**。guard 在审批之后运行，并且每次同步重读策略文件，等待期间收紧的策略会生效。 | C1 在同一个 guard 里再查 epoch、revision、lease。 | 否 |
| | OpenClaw | **否**。批准后只重查 abort 信号、插件运行时版本和来源守卫。 | `corn-governance` 再注册一个最高优先级的普通 `api.on("before_tool_call")`。它在 trusted policy 的审批结算之后运行，在这里再查一次控制状态。 | 否（运行顺序需实测确认） |
| | Mastra | **否**。批准后直接执行。 | `governedTool()` 在 execute 时检查，天然位于审批等待之后；审批记录绑定 attempt、stopEpoch、参数哈希和策略版本。 | 否 |
| 默认拒绝（含策略或插件未加载） | DSH | **部分是**。未知工具归为 `other` 并拒绝；Claw 权限层不可用时拒绝；ADR-0006 每次启动都校验 Claw 拓扑。缺口：`memory` 工具和身份变更直接放行；只管 Claw 归类的会话。 | C1：控制快照未知或过期时拒绝；把 C1 纳入 ADR-0006 启动校验，未加载就不准入。 | 否。收紧 memory 和身份放行属于 Claw 策略改动，选型期不做 |
| | OpenClaw | **部分是**。hook 出错、抛异常、15 秒超时都按拒绝处理；**但一个 hook 都没注册时直接放行**。 | Main 准入自检：`plugins.list`、`tools.effective`、`plugins.changed` 代次都正确才准入，否则拒绝所有新 turn；控制状态拿不到时返回 `{allow:false}`。 | 否。但如果重启自动续跑会抢在 Main 自检之前运行，可能需要上游开关（未知） |
| | Mastra | **否**。没有强制层；策略抛异常时判为“需要审批”；渠道显示不了审批控件时会直接执行工具。 | `governedTool()`：上下文缺失、过期或未知时一律拒绝；有未标记的工具就拒绝启动。 | 同第一项 |
| 停止 fencing | DSH | **否**。Claw 没有停止代次、租约或过期控制；DSH 只在派发前查一次取消。 | C1 维护 stopEpoch 和租约。停止时既把 epoch 加一，也调用 `session.cancel`，因为 guard 和 `tools/execute` 包装器之间的时间窗只有中止信号能拦住。 | 否 |
| | OpenClaw | **否**。不认识 stopEpoch；最后一刻会查 abort 信号，可以按 runId 中止。 | `corn-governance` 查 stopEpoch；Corn 先推进 stopEpoch，再调用 `chat.abort{runId}`。 | 否 |
| | Mastra | **部分**。durable 每一步前后都做运行权 fencing，后台任务有租约，但检查的都是进程所有权。 | `governedTool()` 查 stopEpoch；Corn 按 run 级联取消后台任务。 | 否 |
| 审计归属 | DSH | **部分**。Gate 只审计拒绝：没有 callId，1.5 秒内的相同拒绝会被合并，写入失败被吞掉；放行只能从 Session 日志的 `tool/call`、`approval/*` 里找。 | C1 写拒绝审计，带 runId、attemptId、callId、rootCallId。 | 可选 U2（Claw 审计补 callId），选型期不做 |
| | OpenClaw | **是**。hook 的放行和拦截都作为 enforced plugin gate 写进审计账本，保留 30 天、最多 10 万条；外部 ACP 运行时内部的动作记为 unsupported。 | Corn 自己记录 runId、toolCallId 与 attempt、revision 的对应关系，OpenClaw 账本作旁证。 | 否 |
| | Mastra | **否**。AgentController 的授权和策略只在内存，没有审计。 | `governedTool()` 执行前写“派发尝试”审计，执行后在隔离检查下写结果审计。 | 否 |
| 嵌套调用 | DSH | **源码上是，未实测**。PTC 内层调用也经过 guard；但实测只证明了外层 `run_code` 被拒绝。 | 继续禁用 PTC；内层治理作为 U3 后置。 | 开放 PTC 时需要（L） |
| | OpenClaw | **是**。Code Mode 的每个嵌套调用都单独过 hook 和审批，外层带 `toolKind:"code_mode_exec"`。外部 harness（Codex、Claude CLI、ACP）覆盖不全。 | 默认禁用 Code Mode、Swarm、`sessions_spawn`、Full Access 和 elevated；锁定只用嵌入式运行时。 | 否 |
| | Mastra | **推断是**。子 Agent 工具、MCP 工具、code-mode 桥接调用都会经过 `execute`，需要实测。 | `governedTool()` 覆盖这些路径；禁用 code mode。 | 同第一项 |
| 重启后自动续跑 / 重放 | DSH | **不重放**（源码证实）。只有配置里声明的 Agent 会在启动时自动恢复，API 创建的 Session 不会。收件箱待处理项会不会自动开 Turn，未知。 | C3 只读对账：先 projections 再 page，不用 follow；未知的非幂等副作用标为 unknown，不自动重试。 | 否 |
| | OpenClaw | **会自动续跑**（始终开启，静态没找到开关）。每个中断周期最多 3 次计费尝试；恢复轮次会换新 runId。 | 恢复闸门：`corn-governance` 拒绝“还没经过 Corn 只读对账的 attempt”的所有副作用工具；禁用 Full Access；启动时先对账再放开准入。 | 如果 hook 识别不了恢复轮次或无法推迟它，就需要上游开关（未知） |
| | Mastra | **默认会自动重新派发**：`recoverStaleTasksOnStart` 默认 true；durable 恢复默认关闭，一旦开启会重放工具。 | 设 `recoverStaleTasksOnStart:false`，保持 durable 恢复关闭；启动时用 `listTasks`、`listSuspendedRuns`、`listActiveRuns` 只读对账；非幂等工具用幂等键。 | 否（“可安全重放工具”的声明还在上游 #25780，未实现） |

小结：

- **DSH** 内建满足 2 项（强制检查点、审批后重查），部分满足 3 项，且普通调用的 deny / ask / reject / cancel 已有实测。缺的都可以放进一个 Corn 插件（C1），不需要改上游。
- **OpenClaw** 的挂点框架最完整：fail-closed、嵌套调用逐个检查、有审计账本。缺的“批准后重查”和“空链放行”都能用插件加准入自检补上。真正的障碍是重启自动续跑。
- **Mastra** 在非 EE 部分没有任何内建强制点，全部依赖 `governedTool()`。这个包装能否覆盖框架内部生成的工具，是 Mastra 能否过门槛的关键未知。

## 4. 各候选必需的自研 / 补丁清单

规模 S / M / L 是静态估计，不是排期。

**共同部分（与底座无关，三条路线都要做）：** Run / Attempt / Directive / ControlOp / Completion / Outbox 产品域和数据库（DATA-01、RUN-01），规模 **L**。即 DSH 清单里的 C6。另外三条路线都要做：前台和 Worker 双会话编排、ID 映射、只读对账加 UI 投影。下面只列各底座**专属**的部分。

### DSH（专属部分合计 M）

| ID | 内容 | 类型 | 规模 |
| --- | --- | --- | --- |
| U1 | `session.selectModel` 增加“只作用于本会话、不写全局默认”的参数，或新增一个只选会话模型的 Remote | **上游补丁**；按计划 §5.3 需要单独授权 | 代码 S；上游不接受时要自维护补丁包，并重钉 lock 和模板哈希，流程成本 M |
| C1 | `corn-run-control` Host 插件：全局 `tools.guard` 检查 attempt、stopEpoch、revision 和租约；Main 通过认证的 JSON 路由推送控制快照；控制状态未知或过期时拒绝；写带 runId、attemptId、callId、rootCallId 的拒绝审计；纳入 ADR-0006 启动校验 | Corn 自有（不改上游，也不改 Claw） | M |
| C2 | transport 白名单补 `session/projections`、`session/updateQueue`；follow 合并加 page 回填 | Corn 适配 | S |
| C3 | 只读对账与恢复（未闭合 Turn 判为 unknown，未知副作用不重试） | Corn 适配 | S–M |
| C4 | 审批映射（eventId ↔ callId ↔ Attempt，代次替换，Corn 侧超时主动拒绝） | Corn 适配 | S–M |
| C5 | requestId 持久记录、单飞、丢回执后对账 | Corn 适配 | S |
| C6 | 产品域与数据库 | 共同部分 | L |
| C7 | 前后台双 Session 编排；可选的 Corn 侧模型请求节流 | Corn 适配 | M（效果取决于实测） |
| C8 | 包体裁剪（846 MB） | Corn 打包 | M |
| (U2) | Claw 审计补 callId、去掉 1.5 秒合并（C1 已能覆盖） | 可选 Claw 补丁，选型期不做 | S |
| (U3) | PTC 内层治理 | 后置，继续禁用 | L |

### OpenClaw（专属部分合计 M，可能到 L）

| 内容 | 规模 |
| --- | --- |
| `corn-governance` 插件：trusted policy（全匹配）、最高优先级普通 hook 做批准后重查、与 Main 之间的认证通道、Corn 审计映射；`contracts.trustedToolPolicies` 声明，通过 `plugins.load.paths` 加载 | M |
| Gateway 子进程监督器：就绪检测，处理退出码 78、1012 关闭码和 shutdown 事件；关掉 Bonjour、渠道和更新检查；用 `OPENCLAW_HOME/STATE_DIR` 把数据放进 Corn 目录；Main 独占 admin token | M |
| 恢复闸门：自动续跑在对账前被策略挡住；启动时先对账再准入（能否完全挡住取决于实测） | M（若需要上游开关则更大） |
| Node 24 打包：内置真实 Node 和完整 node_modules（不进 asar），node-pty beta、koffi、esbuild 等原生模块签名公证 | M–L |
| 停止状态机（stopping → 确认 → cancelled）、审批重绑到 Corn 代次、超过 5 分钟或重启后的幂等对账、ID 映射、流投影 | 各 S–M |
| 长期升级跟随：锁定 tag，每次升级重跑全部门禁 | 持续成本 |

### Mastra（专属部分合计 M，可能到 L）

| 内容 | 规模 |
| --- | --- |
| `governedTool()` 包装与审计：覆盖前台执行、提前派发、后台任务、审批后恢复、durable 恢复、子 Agent、MCP 和 code-mode 桥接；构建时断言工具标记；`disableBuiltinTools` | M（若 AgentController 内置工具必须全部纳入治理则为 L） |
| 控制面：attempt、stopEpoch、revision、lease 的状态与审批记录绑定；IPC 审批命令先查 Corn 状态 | M |
| 幂等受理：Corn 先在事务里写 messageId 和 runId，再调用 Mastra | S–M |
| 凭据存储：Keychain 或 safeStorage 由 Main 管理；每次调用传显式 provider 实例；清理继承的环境变量 | S–M |
| 单调序号事件投影、只读对账（关闭 `recoverStaleTasksOnStart`） | S–M |
| LibSQL 打包：asarUnpack；做 universal 包需要两个架构 | S–M |
| （备选）非 EE `builder.ts` `createExecute` 守卫 hook | 上游补丁，代码 S，需长期维护 |

## 5. 风险与需维护者决定的事项

### 需要维护者决定

1. **Mastra EE 许可（需维护者或法务决定）。** `@mastra/core` 的 npm 包里带 66 个 `ee/` 文件，非 EE 代码在运行时会 import `auth/ee`。EE 许可写明不允许生产使用，也不允许再分发（`ee/LICENSE:7`）。需要判断：把未使用的 EE 代码打进 .app 是否算再分发。如果答案是否定的，Mastra 路线就不成立，除非上游把这部分解耦。
2. **DSH 上游补丁 U1。** 按计划 §5.3，选定 DSH 之后还需要单独授权才能实施；另外要决定上游不接受时是否自维护补丁包。
3. **OpenClaw 重启自动续跑。** 它和计划 §8.2“启动先只读对账再决定执行”冲突，需要维护者决定：是只要求“副作用被策略挡住”就够了，还是要求“恢复轮次本身不得在对账前运行”。这个决定直接影响 OpenClaw 能否进入真实比较。
4. **真实比较的范围和预算。** 选哪一个挑战者与 DSH 同场比较（见第 8 节）；Provider、模型 ID、请求次数上限（包含框架内部重试和 utility / 后台调用）和停止条件，按计划 §5.2 由维护者单独给出。

### 已知风险

- **DSH**
  - Corn 包约 846 MB。
  - 上游漂移快：alpha.2 同时改了 projections 的返回形状，又删了 `tools.mode: both`（现有 PTC smoke 的配置会失效）。
  - 审批没有超时。
  - 不能按 Run 定点取消。
  - Host 共享一个事件循环，LLM 层没有并发或优先级控制。
  - Key 是明文 0600 文件。
  - Claw 只有一位维护者。
- **OpenClaw**
  - 重启后自动续跑，且 Full Access 会话保留完整工具。
  - Key 以明文 JSON 存在 SQLite。这一点 DSH 也类似，不是 OpenClaw 独有的劣势。
  - 根包 257.7 MB，另需单独的 Node 24，原生模块里有 node-pty beta。
  - 约两天一个稳定版，main 每周约 3000 个提交，没有 LTS（extended-stable 线能否当作长期锁定点需另评）。
  - 嵌入文档仍锁在旧版本，已经滞后。
- **Mastra**
  - durable 是 beta，允许不升主版本就破坏兼容；durable 恢复会重新执行工具。
  - `recoverStaleTasksOnStart` 默认 true，会自动重新派发。
  - 没传 key 时回退读 `process.env`。
  - 停止时快照删除是异步的，存在竞态。
  - 发布节奏约每月 10 个版本。
  - 近期修过并发 durable run 写错对话、执行了已被排除的工具等问题。

## 6. 统一真实门禁场景（待运行）

顺序按计划 §5.2。**先用 fake provider 和无副作用的任务**；只用一个前台会话加一个 Worker，同一个小任务，一次只跑一个候选，不抢焦点。真实模型调用要等维护者按 §5.2 给出范围后才能做。每个场景都记录响应时延、CPU、内存、进程数、限流情况和实际停止情况。

1. **后台未完成时独立回复。** 通过标准：前台收到独立回复，Worker 没有被取消或替换，前台这一轮里没有混入后台结果。
   - DSH：Worker Session 的 Turn 进行中时，前台首个流式分片的时延；两个 Session 的 seq 互不干扰；有没有 Provider 429。
   - OpenClaw：worker 的 `activeRunIds` 非空时，前台收到 `chat` final；worker run 没被 interrupt 或 abort（队列模式不能是 interrupt）。
   - Mastra：前台首个 token 的时延；后台任务行状态不变；没有 abort 事件；`untilIdle` 没有导致前台多跑一轮。
2. **改要求。** 通过标准：确认收到，后续执行能体现新要求；越界的调用在实际派发时被拒绝。
   - DSH：`steer` / `updateQueue` 连发三条，看 `agent/inbox/spliced` 和 claim 的顺序、哪一步被采纳、有没有丢失或合并。
   - OpenClaw：`chat.send{queueMode:"steer"}` 后出现 `sessions.changed reason:steer` 和 `agent.input.settled`，以及消息在 transcript 里的位置。
   - Mastra：拿到 signal 的受理 id，在下一个循环边界看到回显；正在运行的工具不被回滚；越界调用被 `governedTool()` 拒绝并写入审计。
3. **准确查询。** 通过标准：查询时零模型调用，不编造百分比。
   - DSH：`session/control` 和 projections 给出的状态与持久事件一致。
   - OpenClaw：读 `sessions.list`、`chat.history` 和账本时，用量里没有新增的 observer、标题或摘要调用。
   - Mastra：只读 Corn 投影或 `getTask`。
4. **停止指定任务。** 通过标准：被停的任务不再派发新动作；另一个会话不受影响；停止后再批准旧审批也不执行。
   - DSH：依次出现 `turn/end aborted`、工具体静止、guard 拒绝后续派发；子代理和后台作业是否真的终止；在审批等待中停止后结果为 `approval/decided cancelled`，之后再回 `allowed-once` 无效。
   - OpenClaw：先推进 stopEpoch 再 `chat.abort{runId}`；审计里不再出现 `tool_action`；对旧审批调用 `approval.resolve` 不执行；exec 和 node-pty 的子进程树是否被结束。
   - Mastra：包装层审计里没有新派发；从取消返回到工具实际退出的间隔；检查删除快照的竞态。
5. **一次交付。** 通过标准：刷新 UI 或重连后，完成结果只交付一次。
   - DSH：`turn/end` 对应同一个 completionId 和 Outbox。
   - OpenClaw：终态事件经 Outbox 只投递一次，WebSocket 重连后不重复。
   - Mastra：`onTaskComplete`、`untilIdle` 重入和 Outbox 三者不重复。
6. **重启不盲目重放。** 通过标准：如实标记为中断或待核对；未知的副作用不自动重试，也不出现第二次。
   - DSH：分别在流中和工具执行中 SIGKILL；用 projections 加 page 只读对账，不调 follow；在途工具被标为错误；收件箱待处理项不自动开 Turn。
   - OpenClaw：在工具执行中途 `kill -9` Gateway；自动续跑是否在 Corn 对账前启动，策略是否挡住副作用；子 agent 不自动重启。
   - Mastra：SIGKILL Main；在 stale recovery 关闭的前提下重启后不自动派发；LibSQL 运行权代次递增；running 状态标为中断待核对。

补充门禁（与上面同批串行跑）：

7. **模型隔离（计划 §7.3）。** 两个 Bot，一个用覆盖模型、一个跟随全局。实际请求的 provider 和 model 要对，重启后仍然对；改覆盖不影响全局和另一个 Bot。
   - DSH：没有 U1 时预期**失败**，用来证明补丁确有必要。
   - OpenClaw：会话或 agent 覆盖能否立即生效、重启后是否保留；读穿共享凭据会不会造成串用。
   - Mastra：在环境里放一个假的 `OPENAI_API_KEY`，确认它没有被使用。
8. **治理负例。** 通过标准：审批等待期间收紧策略后，派发被拒绝；控制状态未知或过期时拒绝；每次拒绝都有 runId 和 callId 的审计。
   - DSH：`run_code` 外层被拒绝、内层派发数为 0；C1 未加载时不准入。
   - OpenClaw：故意让 `corn-governance` 加载失败，Main 必须拒绝准入；把 `requireApproval` 拖到 stop 之后再批准，必须不执行。
   - Mastra：子 Agent、MCP 和提前派发路径都经过包装层；未知工具默认拒绝；验证 `needsApprovalFn` 返回 false 会不会绕过 ask。
9. **资源与焦点。** 记录进程数、RSS、空闲和运行中的 CPU；不抢焦点；OpenClaw 没有 Bonjour 广播和更新检查的外网请求。

### 只有真实运行才能回答的问题（三份合并去重）

- **时延与资源**
  - 后台满载时前台首个分片的时延，以及退化程度。DSH 共享 Host 事件循环；Mastra 前台和后台在同一个 Main 事件循环；OpenClaw 在 Gateway 进程里并行。
  - Provider 限流会不会让两个会话互相阻塞。
  - 实际进程数、常驻内存和冷启动时间（OpenClaw 记到 `hello-ok`）。
- **停止与取消**
  - 停止从发出到确认要多久。
  - 子代理、后台 Shell 作业、MCP 调用、exec 和 node-pty 子进程树是否真的被终止。
  - guard 或包装层与实际工具体之间的时间窗，在真实工具（浏览器、Shell）里有多大。
  - Mastra 删除快照的竞态有多大。
- **重启恢复**
  - DSH：收件箱待处理项会不会自动开 Turn；profile 里的组件会不会在启动时激活 Session。
  - OpenClaw：自动续跑能否关闭或推迟；hook 能否识别恢复轮次。
  - Mastra：durable + LibSQL + 后台任务组合在 SIGKILL 后是否稳定。
- **改要求与采纳**
  - 停止或改要求之后，模型是否真的放弃旧方向（采纳和强制执行要分开验证）。
  - OpenClaw 的 `agent.input.settled` 能否当作采纳回执。
  - Mastra 的 signal 打断推理的行为是否与文档一致。
- **模型与凭据**
  - U1 落地后，模型切换提示和请求头在重启和并发下是否一致。
  - OpenClaw 的覆盖是否生效和持久，共享凭据会不会串用。
  - Mastra 的环境变量回退是否真被清理干净。
- **治理覆盖**
  - Mastra 的 `needsApprovalFn` 是否会绕过 ask。
  - OpenClaw 的 15 秒 hook 超时在 Main 慢响应时会不会误拒。
  - OpenClaw 用 loopback 静默配对、Main 持有 admin token 的方案，是否符合 Corn 的受限 IPC 边界。
- **打包**
  - `node:sqlite` 在打包后的 Main 里能否完成迁移、开 WAL、扛住崩溃。
  - `libsql` 原生模块在 Electron 44、asar 解包、universal 构建下能否加载，能否与 `node:sqlite` 共存。
  - node-pty beta 和 koffi 能否在 arm64 上签名、公证并正常加载。
- **请求预算**
  - 框架内部的重试次数，以及 utility / 后台模型调用（标题、observer、摘要、压缩）能否全部关掉。维护者设定请求上限之前需要这些数据。
  - OpenClaw 的幂等在超过 5 分钟或进程重启后是否仍然有效。

## 7. 与旧调研的关系

[2026-10-11 底座调研](runtime-options-2026-10-11.md)把 OpenClaw 列为第一候选、Mastra 第二、DSH 作对照，依据是“哪个更接近完整的后台助理运行时”。本次审计把**治理硬门槛**和**恢复语义**放在最前面，得出的静态顺序不同（见第 8 节）。旧文档的正文保留不改，只在开头补注新的固定版本。两者的差异来自评估重点不同，不代表旧调研的事实有误。

## 8. 静态建议（不是决定）

以下仅基于三份只读审计，用来决定真实比较先测谁，不代替 ADR-0007。

**静态排序：DSH > Mastra > OpenClaw。** 第二、三名差距很小，主要取决于两个外部条件：Mastra 的许可，以及 OpenClaw 自动续跑能否挡住。

1. **DSH：静态上离硬门槛最近，专属改动最小。**
   - guard 在审批之后运行，并且每次重读策略；未知工具默认拒绝；普通调用的 deny / ask / reject / cancel 都有实测。
   - 源码层面不重放在途工具。
   - 专属改动是 U1（S，需单独授权）加 C1（M），其余适配都是 S 级。
   - 需要说清的三点：
     - “不自动续跑”只在源码层面证实，收件箱待处理项会不会自动开 Turn 还要实测。
     - 默认拒绝有缺口：memory 和身份变更直接放行，只覆盖 Claw 归类的会话。
     - 不能按 Run 定点取消，所以前台和后台必须拆成两个 Session。
2. **Mastra：进程内运行，原语齐全，但卡在两个未定项。**
   - 优点：TS 原生、不用额外起进程；线程、signal、后台任务和运行权 fencing 都有现成实现；默认不开 durable 恢复。
   - 卡点一：EE 许可要由维护者或法务决定。
   - 卡点二：非 EE 部分**没有内建**的逐次强制点，只能靠 Corn 的 `governedTool()` 包住共同的 `execute` 入口。这不需要改上游，但它能否覆盖框架内部生成的工具未证实；覆盖不了就要上游补丁。
3. **OpenClaw：对 Corn 来说排第三，原因不是治理能力。**
   - 它的治理挂点在三者中内建最完整：fail-closed、嵌套逐个检查、有审计账本。单看硬门槛，它比 Mastra 更近。
   - 排第三，是因为重启自动续跑始终开启、静态找不到开关，和 §8.2 的只读对账冲突，而且可能抢在 Main 准入自检之前运行。
   - 另外它的打包成本最高（单独的 Node 24、完整 node_modules、beta 原生模块），发版最快且没有 LTS，长期跟随成本也最高。

**建议：** 真实比较先跑 **DSH 加一个挑战者**，严格串行。

- 如果维护者在比较开始前给出了 Mastra EE 许可的肯定答复，挑战者选 Mastra。
- 否则选 OpenClaw，并把场景 6（重启不盲目重放）放在最前面跑，先看自动续跑能否被挡住。

**会让排序翻转的结果：**

- DSH 下降，出现以下任一情况：
  - U1 上游不接受，且维护者不接受自维护补丁。
  - 场景 1 里，共享 Host 事件循环导致前台时延不可接受。
  - `session.cancel` 不能终止子代理或后台作业，Corn 也补不上。
  - 重启后收件箱待处理项会自动开 Turn。
  - 846 MB 或 alpha 线的漂移在发行上不可接受。
- Mastra 上升到第一或稳居第二：
  - EE 许可得到肯定答复，或上游解耦 `auth/ee`。
  - 场景 8 证明 `governedTool()` 覆盖了全部派发路径，包括提前派发、后台任务、MCP 和子 Agent。
  - `libsql` 在打包后能正常加载。
  - 进程内的前台时延可以接受。
- Mastra 出局：许可答复否定，或包装层覆盖不全且上游不接受守卫 hook。
- OpenClaw 上升：
  - 自动续跑可以关闭或推迟，或 hook 能识别恢复轮次并在 Corn 对账前挡住它。
  - Node 24 和原生模块在 arm64 上能签名、公证并正常加载。
  - 维护者接受以 extended-stable 线作为锁定点和跟随节奏。

## 附录 A：DSH 证据（`@rc2` = `dsh-v0.2.0-rc.2` / `639ed015`，源码 `/Users/qin/deepseek-harness`）

路径缩写：`sc/` = `packages/api/session-controller/src/`；`loop/` = `packages/core/agent-loop/src/`；`tools/` = `packages/core/tools/src/`；`approval/` = `packages/interaction/user-approval/src/`。Claw 文件位于 `/Users/qin/DSH/plugins/dsh-claw-suite/<组件>/`（`@v0.3.0-rc.2`）；Corn 文件位于 main `8b6989c`。里程碑文档指 Corn 仓库 `docs/milestones/` 下的同名文件。

1. 全局默认的写入与重启保留、`credentials-local` 的 set / unset / describe：MODEL-CONFIG-API-AUDIT §3、§4。`selectModel` 写全局默认：`sc/commands.ts:170-175@rc2`；未公开的会话级接口：`sc/agent.ts:333-336@rc2`；会话发出首次请求后模型“粘住”：`sc/agent.ts:294-310@rc2`；新建会话取当时的全局默认：`sc/agent.ts:497-500@rc2`；`installModelSelection` 挂点：`packages/core/agent/src/model-selection.ts:81-112@rc2`，注册位置 `sc/agent.ts:323@rc2`；Claw `registry/model` 只存值不应用：审计 §7。alpha.2 的 `selectModel` 仍写全局（alpha.2 `commands.ts:171`）。
2. Registry：compat-matrix “Integration contracts”；`dsh-claw-registry/host.js:259,361,540-560`。`session.create`：`sc/commands.ts:105-144@rc2`、`sc/agent.ts:239-276@rc2`。
3. 去重：`sc/commands.ts:330,602-614@rc2`；查重后的 await `:354`，插入 `:364-365`；持久收件箱 `loop/inbox.ts:2@rc2`；Corn 串行与合并 `packages/dsh-adapter/src/session-client.ts:54-76`；回执不含 Turn ID：M0-API-AUDIT “Prompt…correlation”。
4. `sc/index.ts:490-512@rc2`（projections）；`sc/history.ts:77-112@rc2`（page）；冷 follow 唤醒 `sc/history.ts:204-212@rc2`；Corn 白名单 `packages/dsh-adapter/src/transport.ts:16-25`。
5. `sc/history.ts:182-213@rc2`；没有 `afterSeq`：`sc/types.ts:487-491@rc2`。
6. `tools/index.ts:1505-1519@rc2`；`approval/index.ts:128-131,267-300@rc2`；eventId 与审计 id 是两套：M0-API-AUDIT “Interactive approval”。
7. `sc/commands.ts:511-525@rc2`；工具体等静止 `tools/index.ts:1559-1592@rc2`。
8. `tools/index.ts:723-731,1126-1154,1519@rc2`；派发前取消检查 `:1532,1572`；PTC `tools/ptc.ts:538-557@rc2`。
9. `loop/index.ts:848-863@rc2`（合成结束、不重放）、`:374-403`（仅配置声明的 Agent 自动恢复）；M0-EVIDENCE model-lifecycle 第 4、5 项。
10. Gate：`dsh-claw-gate/host.js:264-298`（pre-execute）、`:202-224`（guard）、`:56-69`（权限层不可用即拒绝）、`:131-143`（1.5 秒合并）、`:83-95`（写失败被吞）；`dsh-claw-permissions/perm-layers.mjs:185-195`（同步重读）、`:196`（memory 放行）；`dsh-claw-policy/policy-schema.mjs:414-454`、`dsh-claw-permissions/perm-path.mjs:241-247`（未知工具即 other）、`:243`；实测见 M0-EVIDENCE governance、model-lifecycle 第 2、3 项和 PTC 行。alpha.2 仍保留 guard 及其在审批后的顺序：alpha.2 `tools/src/index.ts:1142,1525`。
11. LLM 层无全局并发：在 `@rc2` 的 llm 和 agent-loop 里没搜到相关实现；steer / updateQueue：M0-API-AUDIT。
12. ADR-0005（包体）、ADR-0002（node:sqlite Proposed）、M0-EVIDENCE（fresh profile）；`apps/desktop/src/runtime/dsh-host-supervisor.ts:299-301`；`packages/storage/storage-sqlite/src/index.ts:10@rc2`。
13. `LICENSE@rc2`（MIT）；rc1→rc2 187 个提交，rc2→`0.2.1-alpha.2` 935 个提交、6259 个文件（两个 tag 之间的 git 统计）。

## 附录 B：OpenClaw 证据（`@v2026.10.2` = `b8952d47`）

路径缩写：`gw/` = `docs/gateway/`；`proto/` = `docs/gateway/protocol/`；`btc/` = `src/agents/agent-tools.before-tool-call.`。

1. `gw/config-agents/entries-and-multi-agent.md:77`；`proto/rpc-session-control.md:38,47`；`src/gateway/server-methods/models-auth-status.test.ts:43-54`；`docs/concepts/oauth.md:76-81`；`src/state/openclaw-agent-schema.sql:742-746`（`store_json TEXT`）；`gw/embedding.md:141-144`；`docs/concepts/multi-agent.md:34`；`docs/help/environment.md:39-41`。
2. `proto/rpc-talk-config-and-agents.md:76,93`；`packages/gateway-protocol/src/schema/sessions-create.ts:19`。
3. `schema/logs-chat.ts:349`；`src/gateway/server-methods/chat-send-session.ts:103`；`src/gateway/server-constants.ts:16-17`；`chat-send-retry-comparison.ts:22-60`；`proto/rpc-session-control.md:62`；`gw/restart-recovery.md:675-677`（doc-only）；`proto/transport.md:163-173`。
4. `proto/rpc-session-control.md:32,53-58`；`proto/rpc-bootstrap-and-events.md:54-58`；`gw/restart-recovery.md:597-599`。
5. `gw/clients.md:154-170,179-181,200-204`；`proto/transport.md:62-71`；`proto/rpc-session-control.md:54`；`proto/rpc-bootstrap-and-events.md:162-178`。
6. `btc/approval.ts:275-278,345-348,395-448`；`docs/plugins/plugin-permission-requests.md:88-89,150-167`；`src/plugins/hooks.ts:1036-1053`。
7. `schema/logs-chat.ts:353-359`；`proto/rpc-session-control.md:46`；`chat-abort-handler.ts:219-221,399-401`；`btc/wrapper.ts:545`。
8. `btc/wrapper.ts:416-449,499-503`；`btc/policy.ts:250-408`；`docs/plugins/hooks/tool-policy.md:17-39`。
9. `gw/restart-recovery.md:12,603-620,653-662,706-719,734-739`。
10. fail-closed：`src/plugins/hook-runner-global.ts:25-29`、`src/plugins/hooks.ts:105-110`、`btc/policy.ts:431-442`、`src/plugins/trusted-tool-policy.ts:292-296,339-341`；空链放行：`btc/policy.ts:213-215`；批准后不重查：`btc/wrapper.ts:499-503`；trusted policy 审批之后才运行普通 hook：`btc/policy.ts:305-340`；嵌套调用：`btc/policy.ts:93-96,191-193`、`docs/tools/code-mode/internals.md:60-65`、`docs/plugins/hooks/tool-policy.md:21-24,234-247`；包装的装配点：`openclaw-tools.ts:582`、`attempt-bundle-tools.ts:202` 等；审计：`gw/audit.md:133-145`、`proto/ledgers.md:14-19`；外部 harness：`docs/plugins/codex-harness-runtime/v1-support-contract.md:26`。
11. `gw/config-agents/models.md:138`；`docs/tools/steer.md:28-35`；`proto/rpc-session-control.md:26,60`；`proto/rpc-bootstrap-and-events.md:97-117,185-198`；`proto/ledgers.md:14-28`；`docs/tools/subagents/operations.md:11-21`。
12. `package.json:2257,2275,2288,2378,2380-2381`；`gw/embedding.md:33-41,62-84,150-160`；`gw/telemetry.md:15-20`；`docs/install/updating/automatic-updates.md:72,96`；npm 根包解包体积为 257.7 MB、13,889 个文件。
13. `package.json:17`（MIT）；`docs/maturity/scorecard.md:707-731`；`gw/clients.md:20-36,338-350`；npm dist-tags 与 GitHub Releases。

## 附录 C：Mastra 证据（`@81299c92`）

路径缩写：`core/` = `packages/core/src/`；`docs/` = `docs/src/content/en/docs/`；`agentic/` = `core/loop/workflows/agentic-execution/`。

1. `docs/models/index.mdx:31,191-211,250-262`；`docs/harness/agent-controller.mdx:200-206`；`core/llm/model/gateways/models-dev.ts:103,117`（回退读 env）；`core/agent/agent.ts:10312-10326`（`approveToolCall` 接受 model 参数）。
2. `core/mastra/index.ts:~2803,3395`；`docs/harness/agent-controller.mdx:100-138`。
3. `core/agent/signals.ts:49,195`；`core/agent/thread-stream-runtime.ts:377-385,1716-1731`。
4. `core/storage/domains/memory/base.ts:240,287`；`docs/harness/agent-controller.mdx:140-164`。
5. `core/agent/thread-stream-runtime.ts:1164`；`docs/harness/durable-agents.mdx:180`；`core/cache/inmemory.ts:29-36`；`docs/harness/agent-controller.mdx:503`。
6. `agentic/tool-call-step.ts:533-538,716-730,731-763`；`core/agent/agent.ts:9206-9233`；`docs/harness/agent-controller.mdx:436-447`。
7. `core/background-tasks/manager.ts:430-517`；`docs/harness/signals.mdx:129`。
8. `core/agent/durable/execution-fence.ts:1010-1038`；`docs/leases.md:111-121`。
9. `core/agent/durable/run-recovery.md:50-54,92-94,101-104`；`docs/harness/durable-agents.mdx:290-294`；`core/background-tasks/manager.ts:520-527,1834-1894`。
10. `agentic/tool-approval-verdict.ts:29-74`；`core/agent-controller/session.ts:3953-3984`、`session-run-engine.ts:953-1016`、`agent-controller.ts:2038-2060,2416-2422`；`docs/harness/agent-controller.mdx:449`；`core/processors/index.ts:800-812`；`eager-tool-execution.ts:604-655`；EE FGA：`core/tools/tool-builder/builder.ts:603,908-938`。
11. `docs/harness/background-tasks.mdx:148,177,194-250`；`docs/harness/signals.mdx:60-70`；`docs/harness/agent-controller.mdx:126`。
12. `docs/harness/durable-agents.mdx:374-380`；`stores/libsql/src/storage/domains/{workflows,memory}`；`core/llm/model/provider-registry.ts:1066-1077`（`MASTRA_OFFLINE`）；`core/telemetry/posthog.ts:16`；`core/mastra/index.ts:3195`；`engines node>=22.13.0`；`@libsql/darwin-arm64` 约 7.8 MB。
13. `ee/LICENSE:7`；非 EE 代码对 `auth/ee` 的 import：`core/tools/tool-builder/builder.ts:17`、`core/workflows/workflow.ts:11`、`core/memory/thread-fga.ts:1`；`packages/core/CHANGELOG.md:172`（run fencing 加入 1.76.0）、`:299`、`:338`；`docs/harness/durable-agents.mdx:12-16`（beta 声明）。
