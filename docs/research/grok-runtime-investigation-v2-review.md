# Grok 运行机制调查 v2：审阅意见

日期：2026-10-12。审阅输入：本目录报告 v2 和更新说明；调查仓库固定 `2133483b5f90f079dfb26af4b2993ae12b35cd6d`。Corn main 只读核对基线 `8b6989c`。

结论：可作为产品行为契约和机制研究输入；技术选型与代码级排期还需修订，不能直接按表开工。无需继续取得 Grok 私有 Temporal Worker 才能实现目标体验。

## 1. 此次独立核对到的事实

- 固定提交中的 cloud-routing-protocol.json 与报告一致：消息发送与显式 Interrupt 为不同请求；发送请求带 agent/session/message/task 等地址信息，没有直接的 steer/queue/interrupt 字段。静态字段不足以证明实际服务端路由算法。
- runtime-provider-map.json 明确把评估 bundle 的符号、注入端口及开关与线上状态分开；它没有提供实际云端 Provider 和账号 gate 的证明。
- turn-steer 摘录可确认数组入队、队首出队、交付失败回队首、Run 结束结算剩余消息的局部逻辑。
- steer_inbox_probe.cjs 从收集的评估 bundle 抽取模块，使用协议类 stub 验证队列；不是只写一份独立模拟算法。但本次没有执行该 probe，更没有复验 Grok 线上行为，passed 仍是仓库记录的既有结果。
- subagent-runtime 摘录可确认每个 subagentId 对应一个 pending steer 值，并在 interrupt 后复用 Runner 继续。连续 set 存在覆盖前值的风险；尚不能据此声称云端实际发生消息丢失。

来源：[协议摘要](https://github.com/xingyingyuzhui/grok-bot-runtime-investigation/blob/2133483b5f90f079dfb26af4b2993ae12b35cd6d/analysis/cloud-routing-protocol.json)、[Provider 映射](https://github.com/xingyingyuzhui/grok-bot-runtime-investigation/blob/2133483b5f90f079dfb26af4b2993ae12b35cd6d/analysis/runtime-provider-map.json)、[Inbox probe](https://github.com/xingyingyuzhui/grok-bot-runtime-investigation/blob/2133483b5f90f079dfb26af4b2993ae12b35cd6d/analysis/steer_inbox_probe.cjs)。此次未下载大型 bundle、未启动模型/Host/Electron、未恢复 smoke、未修改产品代码。

## 2. 应保留的设计结论

1. 前台问答、后台任务、改向、停止分别路由；普通消息不暗中取消后台任务。
2. 同一项工作的补充应优先复用执行上下文，但不会每次输入都创建新的 Worker。
3. 指令采用持久日志与顺序处理，不能只保留一个 pendingSteer 字符串。
4. 入队受理、执行者领取、修改计划、限制生效是不同事实；不存在可靠证据时 UI 不显示已生效。
5. 工具停止需确认资源和子工作终止；停止订阅不等于停止执行。
6. 执行完成与用户交付分开去重，保留陈旧结果和合法成果的可追溯性。

## 3. 必须修订的工程前提

### 3.1 保留 DSH 是候选路线，不是本次已重新确定的唯一约束

报告把“保留 DSH/Claw”写为既定约束，但维护者最新要求是优先实现 Grok 的产品效果，不拘泥底座。因此应拆成：框架无关的行为契约；DSH 实现映射；OpenClaw/Mastra 等现成底座映射。此次 Grok 证据不能证明 DSH 是成本最低的实现方式，也不能据此取消候选比较。

不自动更换现有后端，不把多个 Agent Loop 叠加管理同一会话；选型另以共同用户场景验证后确定。

### 3.2 最小运行、控制、恢复与交付必须在同一竖向功能里成立

§8/§12.5 把 Supervisor、Completion、RunCard 和恢复分散到 M3–M5，会使 M2 有路由/指令但没有完整后台体验；另有§13“先做指令”的顺序，需要统一。

建议首个真实后台功能包含：一个前台会话、一个 Worker、Run/Attempt、幂等受理、最小事件投影、明确停止、基础资源互斥、一次性完成交付和一张 RunCard。只要后台可以执行有副作用的工具，相应控制与资源边界就不能后置。

复杂线程 UI、多级子任务、跨 Bot 编排、自动模型抢占、工具等待让出、Routine 通知策略仍可后置。

### 3.3 把 GuardPolicy 等伪代码改成可验证的 Host 集成门槛

guardPolicy.applyRestrictionIfAny、runGate.closeForNewSideEffects 和 checkpoint 都是 Corn 拟定接口，尚不是 RC2/Claw 已提供并接通的能力。Main/SQLite 的标志不会自动约束 Host 内部派发。

必须确定公开扩展点、状态同步/恢复及失联时行为，证明每次实际副作用前重查 Run 代次、停止状态、限制 revision 和租约。审批等待期间新增停止或限制后，旧审批成功也不能绕开新边界。

自然语言“不要改数据库”是指导输入；确定性强制限制还需要可执行的结构化规则及覆盖到的工具/路径范围。不能把任意自然语言自动变成已验证安全策略。Worker 的采纳确认也不能当作执行行为保证。

### 3.4 保留此前两个 DSH 接口门槛

- RC2 session.selectModel 会后台写全局默认，Worker 的专属模型选择仍需单独解决；不能先改全局再恢复。Corn ADR-0001 已记录该限制。
- RC2 session.follow 在冷会话场景会触发 Agent 激活。重启后先读取只读历史核对，再决定激活；不能为了恢复卡片就盲目 follow 一个已停止或待协调的 Worker。

两项不因 Grok 调查更具体而自动消失。若选择其他底座，也应验证对应的模型配置隔离和只读状态查询。

## 4. 数据模型还不是最终迁移

- §5/§6 与§12 存在两套名称/状态：corn_run_directives/run_directives、constraint/restriction 等。需收敛为一个状态机和 schema，不能各实现一半。
- §12 的 run_directives 既没有正文也没有规范消息外键；需明确一次性权威正文存储/引用，以便重启后重试。不要产生无限保留的第二份聊天日志。
- run_worker_bindings 以 runId 为唯一行却带 is_current，无法单靠这张表保留多次绑定历史。历史绑定应归 RunAttempt，Run/Workstream 只指向当前 Attempt；新旧事件据此隔离。
- adoptedRevision 不能无条件取最大已确认版本。版本1尚未确认而版本2已确认时，要规定是否版本2完整覆盖了版本1，或者保存逐条采纳关系；不能用最大数掩盖缺失约束。
- TaskRun 已可表示持续目标、RunAttempt 表示一次执行。Workstream 是否还需独立对象，应由跨 Run 工作复用需求决定，避免首版引入无独立生命周期的额外身份。
- 截至所核对 main，未发现 packages/local-db/services/corn-orchestrator 的现成实现；迁移编号和已存在表仍须实际对齐。报告 SQL 仅作为语义示意。

## 5. CompletionInbox 应有确定性的最小交付路径

首版 Worker 完成后先可靠更新任务卡和成果引用，这不应等待主模型空闲。需要润色或解释时再把摘要放入主 Bot 的低优先级队列。

不能让后台完成反复唤醒主模型、挤占用户正在聊天的容量，也不能让必要交付只由模型主观判断后静默消失。所有可见完成更新以稳定 completionId 去重；陈旧/取消结果保留可查询记录。

## 6. 对后续计划的建议

先把这份调查转换成统一的效果验收契约，再比较现成底座或 DSH 适配的最小方案：

1. 后台未完成时独立回答无关问题。
2. 同一任务连续三条指令不丢失，目标明确，修订状态真实。
3. 停止后不再派发新副作用，旧审批/旧事件不能复活任务。
4. 背景完成一次交付，前台不被等待或完成回传阻塞。
5. 刷新/重启如实恢复状态，未知副作用不自动重放。

统一按“一主会话+一 Worker”验证，首版并发默认1，资源仲裁覆盖前台和后台。当前仍保持 smoke 暂停，只可继续文档、静态核对和必要的轻量假依赖回归。调查中几十个 E2E 的编号应合并/去重为可追踪清单；不一次性启动完整重型矩阵。

不要继续追求复刻 Grok 的 Temporal、CloudAgent 私有协议或整个框架内部结构。此次证据最有价值的是行为边界；Corn 的实现以可维护、可验证地交付这些行为为准。
