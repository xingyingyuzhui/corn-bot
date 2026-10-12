# Corn Bot：后台执行与并行聊天的现成方案调研

日期：2026-10-11。目标优先：实现 Grok Bot 式后台执行、独立聊天、进度查询、修改要求和停止；既有 DSH 技术路线不是唯一候选。此次只做网络检索、官方文档及 GitHub 源码抽查，没有安装框架、启动 App/Host、调用模型或恢复 smoke。

> 2026-10-12 补注：下文的固定提交已被取代。OpenClaw 的 `ebdc7d54` 是 main 上未发布的提交，现改为锁定 `v2026.10.2` / `b8952d47`；Mastra 的 `3014f061` 改为锁定 `@mastra/core@1.76.0` 等 / `81299c92`。新的固定版本、静态能力对照和排序见[静态能力对照](runtime-capability-matrix-2026-10-12.md)。本文正文保持原样。

## 结论

有现成实现可以作为底座，建议停止把“大型自研 Orchestrator”作为默认前提。

第一候选：OpenClaw，验证完整运行时嵌入 Corn UI 的路线。第二候选：Mastra，验证以 TypeScript SDK 装配前台 Agent 与后台 Worker 的路线。现有 DSH 作为保留既有实现的对照路线；不能仅因为已经做了部分接线，就排除更接近目标的底座。

这是基于文档和源码接口的优先级判断，不是已运行的性能/可靠性结论，也不代表已决定替换生产后端。

## 1. OpenClaw：最接近完整个人助理运行时的候选

- 非阻塞子任务、完成回传、并发队列及停止/重启处理已有公开机制。[子任务接口](https://docs.openclaw.ai/tools/subagents/tool-reference)、[并发与恢复](https://docs.openclaw.ai/tools/subagents/operations)
- `/steer` 可向活跃运行发送新要求；能否即时接收由运行时决定，不保证中断已经执行中的工具。ACP 路线的 steer 等活跃 Turn 完成，不能把它当作中途改方向已生效。[Steer](https://docs.openclaw.ai/tools/steer)
- `/btw` 或 `/side` 对现有任务取上下文，独立回答旁支问题，保持主任务不变。一次性 BTW 默认不写主聊天历史；Control UI 的 Side chat 另有内存线程。因此 Corn 的持久聊天需求仍要单独接线。[BTW](https://docs.openclaw.ai/tools/btw)
- 官方提供嵌入路线：由应用管理 Node 子进程，通过 Gateway WebSocket 握手、RPC、事件通信；不是要求 Corn 采用 OpenClaw 的 UI。[Embedding](https://docs.openclaw.ai/gateway/embedding)

源码抽查固定为 `ebdc7d54c0842d96c4bb2fb2bb4be4758f07f255`：

- [session-companion-ask.ts](https://github.com/openclaw/openclaw/blob/ebdc7d54c0842d96c4bb2fb2bb4be4758f07f255/src/gateway/session-companion-ask.ts)：独立提问运行、上下文与取消控制。
- [session-companion-rpc.test.ts](https://github.com/openclaw/openclaw/blob/ebdc7d54c0842d96c4bb2fb2bb4be4758f07f255/src/gateway/session-companion-rpc.test.ts)：来源、权限、请求生命周期等已有回归测试；本次仅阅读，未运行。
- [仓库](https://github.com/openclaw/openclaw)。GitHub license 元数据为 MIT。

对 Corn 的建议：UI 保留，Main 经受限 IPC 管理 Gateway；用户无需了解“子代理”。后台任务与聊天在界面统一，查询和改要求明确指向任务。不能把临时 BTW 的“不入历史”直接照搬成 Corn 的普通聊天行为。

需要实测：目标模型下的独立回复时延；后台指导和停止语义；macOS 工具控制；独立打包；进程/内存负担。OpenClaw 不等于项目已有的 DSH Claw Suite，两者不能当作兼容插件互换。

## 2. Mastra：适合 Corn TypeScript 应用装配的 SDK 候选

- Background tasks 可让工具或子 Agent 非阻塞运行；提供状态/输出事件和本地 LibSQL 存储配置。[Background tasks](https://mastra.ai/docs/harness/background-tasks)
- 用户输入有 sendMessage/queueMessage；Signals 可向活跃线程投递上下文；正在执行的工具不会因为新信号自动回滚。[Signals](https://mastra.ai/docs/harness/signals)
- Durable/Evented Agent 提供观察、断线重连、保存状态及恢复配置；durable 功能当前明确标为 beta。默认事件缓存是内存缓存，不能据此声称进程重启后全部流片段都能回放。[Durable agents](https://mastra.ai/docs/harness/durable-agents)
- 工具审批和结构化 suspend/resume 有公开 API；持久恢复需配置持久存储。[Human in the loop](https://mastra.ai/docs/agents/human-in-the-loop)

源码目录核对固定为 `3014f061a74292443d5c8075de5072aa6f992592`：存在 background-tasks、agent-controller、相关停止/审批测试与 LibSQL 存储实现；抽查了锁定提交中的 Signals 文档。

[源码与提交](https://github.com/mastra-ai/mastra/tree/3014f061a74292443d5c8075de5072aa6f992592)。LICENSE.md 对非 ee 内容列 Apache-2.0，ee 部分另有许可证；采用时以所用包范围为准。

对 Corn 的建议：前台 Agent 处理聊天、查询、任务分派；长任务由独立 Worker 执行；后台任务管理、事件投递尽量用现有接口。不要仅向同一忙碌线程 sendMessage 就声称独立问答已实现。

需要实测：持久任务的恢复/重试是否会重放副作用；主线程与后台结果并发投递；工具审批隔离；本地数据库与 Electron 打包；beta API 的可锁定版本。

## 3. 其它候选

| 候选 | 已查到的能力 | 当前判断 |
| --- | --- | --- |
| [Agno](https://docs.agno.com/background-execution/overview) | 后台执行、状态持久化、客户端断线后继续、SSE 重连 | 可用，但普通 background task 本身不代表进程重启恢复；Python 路线适合作为替代验证，不列前两名。[生命周期限制](https://docs.agno.com/agents/running-agents) |
| [Pi](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md) | steer、follow-up、abort、事件订阅、队列清理 | 执行内核可复用，但完整后台任务产品仍需额外装配。本次打开原 badlogic/pi-mono 链接重定向到此仓库，采用时重新锁版本。 |

这些优先级是针对 Corn 的现有 UI、TypeScript 结构及目标效果的判断，不是通用框架排名。

## 4. 建议改写原实施方案

在原 C01–C05 之前增加候选底座验证阶段：OpenClaw、Mastra、现有 DSH 用同一套用户场景比较，选实际能做到的路线，之后才决定 Corn 必须新增的数据库和控制面。

不要先实现整套 RunSupervisor/RunControl 再评估框架；不要同时让两个 Agent Loop 管理同一个执行会话。若换运行时，替换适配边界和执行所有权，而不是把第二套模型循环叠加在 DSH 之上。

产品路由保持三种明确含义：普通聊天；对任务发送新要求；停止任务。GUI 可用引用任务卡和明确状态承载，不必暴露 session/worker 的技术术语。

## 5. 共同验收场景（当前全部待运行）

1. 一个长任务保持进行中，用户问无关问题，真实收到独立回复，原任务未被取消或替换。
2. 用户改要求，任务能确认收到，并在后续执行中体现；对强制限制另检验工具控制边界。
3. 用户查进度，结果来自真实任务状态，不等待后台推理结束、不编造百分比。
4. 用户停止指定任务，确认该任务不再派发新动作；其他会话不被误停；旧审批不能重新启动已停止任务。
5. 刷新 UI 后能找回聊天和任务状态；后台完成只产生一次可见结果。
6. Host 崩溃后如实标记中断/待核对，未知副作用不盲目重试。
7. 正常使用期间进程数、CPU、内存及窗口焦点行为符合本机体验；不同任务不争抢 Mac 键鼠和同一工作树。

恢复验证后先用一个前台会话加一个后台 Worker、同一小任务串行比较；不跑大型 benchmark、不同时开多套底座。当前 smoke 暂停仍有效，真实模型调用也未获本次调研授权。

原方案中的双 Session 思路可保留，但后台生命周期不必全部自研。底座以这组真实效果的结果决定，调研不能代替演示。
