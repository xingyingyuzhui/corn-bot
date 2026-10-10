# Corn Bot — 本地 macOS 持久 Bot 工作平台：代码级迭代实施计划

> 版本：计划 v1.1 · 2026-10-10（依据实施前审阅反馈修订）  
> 交付对象：执行开发的 Coding Agent / 工程团队  
> 目标：独立 `Corn Bot.app`，高保真借鉴 Grok Bot 的白色双栏/三栏桌面 UI，运行于用户当前 macOS 桌面，复用 DeepSeek Harness（DSH）的 Agent 引擎及既有 DSH Claw Suite 的治理能力。  
> **性质：待执行的开发计划，不表示已实现、已集成或已测试通过。**

---

## 0. 执行摘要：冻结的决策

1. **新仓库：`xingyingyuzhui/corn-bot`**，建议先建为独立仓库；本计划不要求创建 DSH fork，不要求修改官方 `deepseek-ai/deepseek-harness` 主仓库，不要求把 Corn UI 注册到 DSH 的 `sidebar.workspaces` 插槽。实际 GitHub 仓库创建由执行 Agent 完成；仓库目前尚未创建。
2. **品牌/产品/UI 与 DSH 原 UI 解耦**：Electron 主进程 + React/TypeScript Renderer；界面直接实现 Bot 名册、聊天、详情、资料库、电脑，而不是嵌套 DSH 原有 WorkspaceBrowser。保留共享 DSH Agent Runtime。
3. **优先完整 DSH Host API + 自有 Bridge**，而不是重复开发 Agent Loop。第一阶段用 TypeScript SDK 做通信 Spike 可以，但正式版不能直接依赖 SDK 完成取消、审批和长期任务生命周期（其协议有明确缺口）。
4. **macOS 真实本机电脑**：优先使用 DSH 官方 `dsh-computer-use` + `experimental-computer-use-cua-driver-{mcp,native}`；浏览器优先 `dsh-browser-use` + `experimental-browser-use-playwright-mcp`。不要在尚未验证能力时从零写 Swift Computer Driver。Swift Helper **仅作可选补充**。
5. **Claw Suite 保持独立**，锁定 `dsh-claw-suite@0.3.0-rc.2` 及九个组件；Corn Bot 新开发 `corn-bridge`、`corn-tasks` 等自己拥有的产品边界。若发现 Claw Suite 需改，向相应 Claw 插件仓库提交兼容性补丁，不把其代码复制进 Corn 仓库。
6. **安全不能因产品 UI 变化而倒退**：每个 Corn Bot 必须经 Claw Registry 的真实 Session Binding、Claw Gate 和官方 Sandbox/Approval。不能从普通 DSH Session 假冒 Claw；`claw-uncertain` 必须拒绝危险操作。
7. **截图作为视觉基准**：`design/references/grok-bot-chat-two-pane.png` 和 `grok-bot-chat-three-pane.png` 是用户提供的参考图。先还原布局、字重、排版、颜色、间距、圆角，再做动效。默认浅色主题，不强行上 Liquid Glass。
8. **版本/运行时锁定**：优先 DSH `dsh-v0.2.0-rc.2`（提交 `639ed015397290b3745d163aafe02ffee4aa3f84`）与 Claw Suite `v0.3.0-rc.2` 的组合；官方 `master` 2026-10-10 时为 `d743267388641bc76f17c45ce8b4c231aed1d32c`，是**后续 API 对照，不作为第一轮自由升级目标**。参考 DSH RC2 Node `^22.19.0 || >=24`、pnpm `11.7.0`；Corn 仓库应采用可兼容的 Node LTS，具体以锁文件验证。
9. **开发阶段必须使用隔离数据家目录**，例如 `DSH_HOME=$HOME/.corn-bot-dev/dsh`。禁止直接迁移或污染用户现有 `~/.dsh`、既有 Desktop profile、已注册的 Claw Agent。生产迁移必须先备份、可回滚。
10. **第一里程碑是产品主界面 + 真实对话**，第二里程碑是本机电脑操作，随后才是 Bot-to-Bot 与 Routines。不要为炫技先写多 Agent 调度系统。
11. **M2 必须引入最小 SQLite 持久化与 Run ID**：M2 建立 Bot、Conversation、Binding、TaskRun、CornEvent 和数据库版本迁移；M3 所有 Computer Lease 绑定已存在或原子创建的 `runId`。M4 负责高级恢复及长期任务，不再首次引入数据库。
12. **产品默认决策**：全局默认模型+每 Bot 覆盖；每 Bot 默认主会话一条，但 schema 支持多 Conversation；语音第一阶段做语音转文字，实时语音会话后置。所有尚未实现的按钮必须 disabled+解释，不能空点击或伪成功。
13. **三栏标定口径**：右侧详情约占窗口总宽度 36%–38%（初始目标约 37%），约为扣除左侧名册后剩余宽度的一半；不得误写成剩余区域的 36%。

### 非目标

- 不在 macOS 上运行默认 Linux VM、Docker 桌面或云端 Computer；用户明确要求当前 Mac 本机操作。
- 不自行发明未经官方 DSH 认证的 RPC 协议并冒充其公共接口；任何未在当前锁定 tag 中发现的 API 都先做可行性验证。
- 不复用原厂不可再分发的图片、字体、精灵资源或反编译代码资产。社区代码可在明确许可证及来源情况下受控借鉴。
- 不在第一个版本追求跨平台、多人 SaaS、远端设备控制、自动接管所有应用权限或完整 Grok Bot 功能覆盖。

---

## 1. 已经核对的官方源码与架构结论

### 1.1 DSH 基线与模块清单

| 能力 | 仓库路径（官方，RC2 锁定） | 真实意义 | Corn 实现要求 |
|---|---|---|---|
| Desktop 宿主 | `apps/desktop/src/main.ts`, `host-process.ts`, `backend-controller.ts` | Electron Shell、Host 子进程、失败恢复、关闭语义 | 借鉴生命周期，**不嵌入官方 Renderer** |
| 完整 Session Remote | `packages/api/session-controller/src/index.ts`, `types.ts`, `history.ts`, `control.ts` | `list/create/prompt/cancel/page/follow/control/selectModel` | 正式聊天的主协议 |
| Browser→Host 网关 | `packages/api/gateway`, `packages/client/connection`, `packages/api/remotes` | Typert Remote、认证 Cookie、WS 复用、取消/重连 | 使用其受支持 Carrier 或实验验证过的 Bridge |
| SDK 子进程 | `packages/sdk/client`, `sdk/server`, `sdk/protocol` | stdio JSON-RPC + `DeepSeekHarness` / `HarnessClient` | 仅 Spike 或经审查的特定任务模式 |
| Computer Registry | `packages/computer-use/computer-use` | 注册恰好一个 Desktop Provider；不提供跨会话资源锁 | 复用服务，Corn 增加全局锁 |
| CUA Native | `packages/experimental/computer-use-cua-driver-native` | `@trycua/cua-driver`，在宿主机截图/窗口/输入；权限由 macOS 用户批准 | 优先实机验证；Crasher 风险存在 |
| CUA MCP | `packages/experimental/computer-use-cua-driver-mcp` | 通过单独驱动进程操作本机 Mac | 稳定性/隔离性回退方案 |
| Browser Registry/Provider | `packages/browser-use/browser-use`, `packages/experimental/browser-use-playwright-mcp` | 浏览器会话级操作与 Tool 暴露；重启不自动恢复 cookies/pages | 优先复用；持久 Profile 自己明确管理 |
| Schedule | `packages/schedule/schedule`, `docs/user/guide/schedule.md` | 可持久投递到 Session；不等于任务完成 | Corn Routine 需要 Run 状态和 Job Supervisor |
| Tool Gate | `docs/tool-execution-pipeline.md` | `tools/pre-execute` → monotonic `tools.guard` → 真实工具 → `tools/result` | Mac 动作必须走完整工具管线 |

正式 `session` 业务接口对应文件 `packages/api/session-controller/src/index.ts`，**不要把 `@deepseek-ai/dsh-sdk-client` 的 `run()` 和完整 `ctx.remote.session` 混为一谈**。后者在 RC2 具备 `cancel/follow`，前者的 SDK 协议没有 mid-turn cancel / 互动审批能力。

### 1.2 当前 Claw Suite（RC2）必须复用的事实

- 独立组件：`dsh-claw-core`, `registry`, `identity`, `policy`, `permissions`, `gate`, `delegate`, `memory`, `observability`，另有一个 Meta `dsh-claw-suite`。
- 根插件 `dsh-claw-suite` 通过 `cordis.patch.yml` 加载组件；产品发布使用 GitHub Release 本地包，不经 npm 安装。
- `registry-navigation.mjs` 已实现 `ensure wa-* preset → session.create → preset 检查 → session/bind → model → session/state ready`，请**提炼为服务端可调用适配器或复用相同流程**，不能抛弃其中的失败/部分成功处理。
- Registry 真实路由：`/api/dsh-claw/registry/list`, `/create`, `/preset/ensure`, `/session/bind`, `/session/state`, `/session/adopt`；这些路由已在组件源码中出现，具体入参必须以 RC2 源码校验。
- `session/bind` 当前要求 `agentId` 以 `wa_` 开头，有 revision 并发检查，会核对 workspace、cwd、preset。Corn 不要用自由输入名称代替稳定 `agentId`。
- DSH 自己的普通 Session 与 Claw Session 不是同一安全域。Corn 只展示合法绑定的 Claw Session，不要把所有普通 DSH 会话强行映射为 Bot。
- 核心第三态分类为 `claw`, `ordinary`, `claw-uncertain`。安全设计需覆盖符号链接、目录变化、错误绑定、部分创建、断线恢复。

### 1.3 连接/认证硬约束

官方 `packages/client/connection` 对 `/api` 的调用和 WebSocket 都要求认证。其机制包括 Host/Origin 校验、启动令牌首次根路径兑换 signed Cookie、同源约束以及 WebSocket 认证。**只知道端口不能直接调用 API；严禁在 Corn Renderer 里持有长期管理员令牌。**

因此 M0 必须完成一个真实集成 Spike，选出符合 DSH 认证语义的运行拓扑。不可写死 `fetch('http://127.0.0.1:3080/api/...')` 假设可以跨域访问。

### 1.4 实现候选路径（必须经过 M0 判定）

**首选 A — Corn UI + 同一 DSH Host Web origin**：Corn 的静态 Renderer 由同一已认证 Host origin 提供，或由受支持的本机 Electron Web document 代理映射；Corn 使用独立 Client Cordis 装配 `connection`, `api-gateway/client`, `api-remotes/client`。只渲染 Corn React App，不加载官方 UI Workspace 组件。验证 Claw 路由认证、Model/Sessions Remote 和实时流。

**备选 B — Electron Main 受信本地 Bridge**：由 Electron 主进程持有 Host 生命周期和受限的主机凭证，通过具备明确审计与认证的本地 IPC/Host Connector 与完整 Session Controller 通信。Renderer 仅访问允许列表，不直接拿凭证。不能擅自调用 DSH 未公开的私有函数；必要时新建可复用的 DSH Host Bridge 插件公开稳定接口。

**实验 C — SDK subprocess**：用 `@deepseek-ai/dsh-sdk-client` 验证离线/独立 UI 能驱动模型，作为 fallback 原型。**不能作为需要完整交互式 Approval、取消及 Session Control 的正式产品实现**，除非 M0 补充完整且可维护的协议能力并通过真实审查。

M0 结束必须写出 `docs/adr/ADR-0001-dsh-transport.md` 并固定一种正式架构；若 A/B 都失败则停止后续功能开发，不能伪造互通成功。

---

## 2. 新仓库结构与包边界（目标文件树）

```text
corn-bot/
├── README.md
├── LICENSE
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── .gitignore
├── .github/workflows/ci.yml
├── .github/workflows/release-macos.yml
├── .node-version
│
├── apps/
│   ├── desktop/
│   │   ├── package.json
│   │   ├── electron-builder.config.ts
│   │   ├── src/main.ts
│   │   ├── src/preload.ts
│   │   ├── src/security/window-policy.ts
│   │   ├── src/security/ipc-allowlist.ts
│   │   ├── src/runtime/dsh-host-supervisor.ts
│   │   ├── src/runtime/profile-bootstrap.ts
│   │   ├── src/runtime/host-auth.ts
│   │   ├── src/runtime/host-readiness.ts
│   │   ├── src/runtime/health-recovery.ts
│   │   ├── src/runtime/process-lock.ts
│   │   ├── src/runtime/quit-policy.ts
│   │   ├── src/ipc/index.ts
│   │   └── tests/
│   └── renderer/
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── src/main.tsx
│       ├── src/app/CornApp.tsx
│       ├── src/app/CornShell.tsx
│       ├── src/app/routes.tsx
│       ├── src/app/CompositionRoot.tsx
│       ├── src/features/roster/
│       │   ├── BotRoster.tsx
│       │   ├── PinnedBotCard.tsx
│       │   ├── BotGroupSection.tsx
│       │   ├── BotListItem.tsx
│       │   └── BotStatusIndicator.tsx
│       ├── src/features/chat/
│       │   ├── ConversationPane.tsx
│       │   ├── ConversationHeader.tsx
│       │   ├── MessageBubble.tsx
│       │   ├── MessageComposer.tsx
│       │   ├── MessageFeed.tsx
│       │   ├── HandoffNotice.tsx
│       │   ├── ApprovalCard.tsx
│       │   └── RunReceiptCard.tsx
│       ├── src/features/details/
│       │   ├── BotDetailsPane.tsx
│       │   ├── OverviewTab.tsx
│       │   ├── KnowledgeTab.tsx
│       │   └── ComputerTab.tsx
│       ├── src/features/computer/
│       │   ├── ComputerPreview.tsx
│       │   ├── ComputerTakeover.tsx
│       │   └── ControlLeaseBanner.tsx
│       ├── src/features/routines/
│       ├── src/features/groups/
│       ├── src/features/settings/
│       │   ├── GlobalModelSettings.tsx
│       │   ├── BotModelSettings.tsx
│       │   └── AppConnectionsPage.tsx
│       ├── src/features/bot-editor/
│       │   ├── CreateBotDialog.tsx
│       │   ├── BotProfileEditor.tsx
│       │   ├── BotPermissionEditor.tsx
│       │   ├── BotTagsEditor.tsx
│       │   └── BotShareDialog.tsx
│       ├── src/features/voice/
│       │   ├── DictationButton.tsx
│       │   ├── VoiceModeButton.tsx
│       │   └── VoicePermissionNotice.tsx
│       ├── src/shared/components/
│       ├── src/shared/hooks/
│       ├── src/shared/accessibility/
│       ├── src/styles/tokens.css
│       ├── src/styles/global.css
│       ├── src/styles/layout.css
│       └── tests/
│
├── packages/
│   ├── contracts/
│   │   ├── src/bot.ts
│   │   ├── src/conversation.ts
│   │   ├── src/events.ts
│   │   ├── src/approval.ts
│   │   ├── src/computer.ts
│   │   ├── src/routine.ts
│   │   ├── src/run.ts
│   │   ├── src/model-selection.ts
│   │   ├── src/bot-settings.ts
│   │   └── src/index.ts
│   ├── ui-kit/
│   │   ├── src/Avatar.tsx
│   │   ├── src/Surface.tsx
│   │   ├── src/Pill.tsx
│   │   ├── src/SegmentedTabs.tsx
│   │   └── src/motion.ts
│   ├── dsh-adapter/
│   │   ├── src/transport.ts
│   │   ├── src/session-client.ts
│   │   ├── src/session-event-reducer.ts
│   │   ├── src/claw-registry-client.ts
│   │   ├── src/bot-session-transaction.ts
│   │   ├── src/remote-error.ts
│   │   └── tests/
│   ├── state/
│   │   ├── src/event-store.ts
│   │   ├── src/bot-projections.ts
│   │   ├── src/chat-projections.ts
│   │   ├── src/run-projections.ts
│   │   └── tests/
│   └── local-db/
│       ├── src/schema.ts
│       ├── src/migrations/
│       │   └── 0001_corn_core.sql     # M2 前移：Bot/Conversation/Run 基础表
│       ├── src/repositories/
│       │   ├── bot-repository.ts
│       │   ├── conversation-repository.ts
│       │   ├── run-repository.ts
│       │   ├── event-repository.ts
│       │   └── ui-state-repository.ts
│       ├── src/database.ts
│       ├── src/migration-runner.ts
│       └── tests/
│
├── plugins/
│   ├── dsh-corn-bridge/
│   │   ├── package.json
│   │   ├── host.js
│   │   ├── cordis.patch.yml
│   │   ├── src/routes/bots.ts
│   │   ├── src/routes/tasks.ts
│   │   ├── src/routes/computer.ts
│   │   ├── src/routes/events.ts
│   │   ├── src/security/authorize.ts
│   │   └── tests/
│   └── dsh-corn-tools/         # 只有确认官方 Provider 能力缺口后再启用
│       ├── package.json
│       ├── host.js
│       ├── src/control-lease.ts
│       └── tests/
│
├── services/
│   ├── corn-orchestrator/
│   │   ├── src/runner.ts
│   │   ├── src/run-lifecycle.ts      # M2 实现最小状态机
│   │   ├── src/minimal-run-service.ts # M2 本地可持久 Run
│   │   ├── src/scheduler-adapter.ts
│   │   ├── src/inbox-outbox.ts
│   │   ├── src/recovery.ts
│   │   └── tests/
│   └── mac-helper/            # 仅有官方 CUA 覆盖不了的需求才建立
│       └── README.md
│
├── design/
│   ├── references/grok-bot-chat-two-pane.png
│   ├── references/grok-bot-chat-three-pane.png
│   ├── flows/
│   │   ├── bot-create.md
│   │   ├── bot-profile-and-permissions.md
│   │   ├── bot-share-and-tags.md
│   │   └── voice-buttons.md
│   ├── screenshots/
│   ├── design-spec.md
│   └── visual-regression.md
│
├── docs/
│   ├── architecture.md
│   ├── compatibility-matrix.md
│   ├── security-boundaries.md
│   ├── adr/
│   ├── runbooks/
│   └── milestones/
└── scripts/
    ├── verify-dsh-version.mjs
    ├── smoke-host.mjs
    ├── run-visual.mjs
    └── package-macos.mjs
```

### 依赖方向强约束

`apps/renderer` → `packages/contracts`, `ui-kit`, `dsh-adapter`, `state`；不直接依赖 Electron Main、DSH Host 私有包、Node `fs`、Claw 文件路径。  
`apps/desktop` → `packages/contracts`, `local-db` 与受限的 `dsh-adapter` Host 侧实现；不 import UI 组件。  
`plugins/dsh-corn-bridge` → DSH 公开的 Host Context / Claw Suite API；绝不 import Electron，尽量不触碰私有文件。  
`services/corn-orchestrator` → `contracts`, `local-db`, 受限 DSH Adapter；不 import React。  
`packages/contracts` 不依赖业务包（仅类型、schema、纯函数）。

### Monorepo 约定

- 每个包使用精确版本或兼容的 workspace 协议，仅 Corn 自家依赖可用 `workspace:*`；打包 DSH 插件时要生成可发布形式，避免将 `workspace:` 直接塞进 DSH 用户 profile。
- 新 Corn 插件不可擅自修改 `dsh-claw-suite` Meta 包；采用独立插件安装/组合，后续做一个 Corn 产品装配器管理加载顺序。RC2 新版的 Suite 本身仍按当前 Release tarball 安装。
- 数据目录建议 `$HOME/Library/Application Support/Corn Bot/`：包含 `corn.db`, `logs`, `assets`, `runtime`；隔离 DSH_HOME 用 `$HOME/Library/Application Support/Corn Bot/dsh-home`（技术细节以 DSH 官方支持的 home 重定向机制验证）。

---

## 3. 核心领域模型（M0/M2 冻结）

目标：不能把 Bot、会话、一次执行、电脑和调度视为同一个对象。

```ts
export type BotId = string & { readonly __brand: 'BotId' }
export type CornConversationId = string & { readonly __brand: 'CornConversationId' }
export type CornRunId = string & { readonly __brand: 'CornRunId' }

export type BotPresence =
  | 'idle' | 'thinking' | 'working' | 'waiting' | 'blocked' | 'done' | 'error'

export interface CornBot {
  id: BotId                      // Corn 自己的稳定 ID，不随管理名称/slug 改变
  clawAgentId: string           // Registry 中 wa_... ID，非自由填写
  slug: string                  // Claw directory slug，仅数据映射
  displayName: string
  avatar: { kind: 'uploaded' | 'generated' | 'default'; assetId?: string; color?: string }
  sectionId?: string
  pinned: boolean
  modelOverride?: { provider: string; model: string; reasoningEffort?: string }  // per-Bot 显式覆盖；必须经 DSH catalog 验证
  archivedAt?: string
  revision: number
}

export interface CornConversationBinding {
  conversationId: CornConversationId
  botId: BotId
  dshSessionId: string
  clawPresetId: string          // wa-...
  state: 'provisioning' | 'needs_model' | 'ready' | 'archived'
}

export type RunState =
  | 'queued' | 'running' | 'waiting_approval' | 'waiting_resource'
  | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface CornTaskRun {
  runId: CornRunId
  botId: BotId
  conversationId: CornConversationId
  dshSessionId: string
  origin: 'human' | 'routine' | 'bot_message'
  idempotencyKey: string
  state: RunState
  createdAt: string
  updatedAt: string
  lastEventSeq?: number
}

export interface CornEvent {
  eventId: string
  kind: string                  // 'run.started'、'bot.message'、'approval.requested' 等
  botId?: BotId
  runId?: CornRunId
  seq: number                   // Corn 事件流自己的序列，独立于 DSH Session seq
  occurredAt: string
  payload: unknown              // 接收后必须 schema 解析/收窄
}
```

`Corn Event` 与 DSH `SessionWireEvent` 要有明确来源，消息不得双重存储为两份“权威聊天日志”。Corn 数据库仅保存索引、Bot 组织/业务状态、投递记录与偏移量；DSH SessionLog 是 Agent 对话和工具执行的权威事实。客户端展示投影可以缓存，但必须随 DSH 事件可重建。

---

## 4. UI 规范：用户两张截图为最高优先级

### 4.1 视觉参考及尺寸

- `design/references/grok-bot-chat-two-pane.png`：原图 2048×1527，左侧固定名册 + 右侧聊天，没有详情面板。
- `design/references/grok-bot-chat-three-pane.png`：原图 2048×1534，左侧固定名册 + 中间变窄聊天 + 右侧详情面板（`详情/资料库/电脑`）。
- 设计稿逻辑 viewport 约 1416×1056；原图可能含设备像素缩放，**必须通过可见分割线比例及截图元数据标定真实 CSS px/DPR**，不可把 PNG 宽度直接等同 CSS 尺寸。
- 双栏左栏约为窗口总宽的 27%；三栏右侧详情约为**窗口总宽的 37%**（约等于**去掉左栏之后可用空间的 50%**）；三栏中间聊天因此约占 36%。以原图分割线为准，不能把右侧误记为“剩余空间的 36%”。
- 在标定视口 **1416 CSS px** 下参考基准：左栏约 **380px**、中间聊天约 **510–520px**、右侧详情约 **516–526px**（允许标定阶段微调）；在原始 2048 像素截图下应按比例换算而非硬编码图片像素。
- 正常宽屏建议 `grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--details-width)`，`--sidebar-width: clamp(280px, 26.9vw, 380px)`、`--details-width: 36.7vw` 仅作初始变量；在 1200px 以下优先改为可关闭覆盖面板/独立详情视图，避免聊天区被压得不可用。最终阈值由视觉测试确认。
- 背景纯白到浅灰、极低对比边界；浅灰色 Bot 气泡、近黑色用户气泡、整体不叠加过量玻璃模糊。阴影只用于输入胶囊及浮层。

### 4.2 必须精确还原的组件和行为

| 组件 | 建议文件 | 截图行为与状态 |
|---|---|---|
| Mac Titlebar | `apps/desktop/src/main.ts` + `WindowChrome.tsx` | 原生交通灯 x3，左栏顶部搜索/加号；拖动区域精确限定，不能遮挡可点击元素 |
| Pinned Bot | `PinnedBotCard.tsx` | 左上头像收藏卡、大图片、星标角标、卡片灰色底 |
| Bot Sections | `BotGroupSection.tsx` | “技术组 / 办公组”小字标题、独立组、展开/折叠、滚动 |
| Bot Row | `BotListItem.tsx` | 头像、名称、单行摘要、不同状态呈现；行距/头像宽高从图片标定 |
| Chat Header | `ConversationHeader.tsx` | 顶部居中的头像+名字白色胶囊，详情面板开关独立于名称点击 |
| Message Bubble | `MessageBubble.tsx` | 用户黑底白字靠右；Bot 灰底黑字靠左；文本自动换行与宽度自适应 |
| Date Divider | `MessageFeed.tsx` | 中央低对比日期和时间；时间间隔正确分组 |
| Bot Handoff | `HandoffNotice.tsx` | 图片中“已发消息给 [Bot A] 和 [Bot B]”中央事件行，带迷你头像；不能把它当 Bot 回复文本 |
| Input Composer | `MessageComposer.tsx` | 底部圆角胶囊，左加号，提示“给 Bot 发消息”，右麦克风和语音；⌘Enter/Enter 行为统一 |
| Bot Details | `BotDetailsPane.tsx` | 三栏时从右侧推入；顶部头像、名称、标签链接、`详情/资料库/电脑` Tab |
| Computer Tab | `ComputerTab.tsx` | 空状态、权限状态、正在工作状态、画面预览及 Takeover 按钮 |
| Bottom Bar | `BotRoster.tsx` | 左下账户小头像与“连接应用”；实际连接页随后接入 |
| Create Bot | `CreateBotDialog.tsx` | 点击左上 `+` 进入创建流程；名称、头像、组别、职责、模型、策略；提交时显示真实 Claw 事务进度、失败恢复 |
| Profile & Permissions | `BotProfileEditor.tsx`, `BotPermissionEditor.tsx` | 编辑身份/职责和权限并发出服务端修订；危险授权不得通过 UI 绕过 Gate 硬上限 |
| Tags | `BotTagsEditor.tsx` | 详情页“添加标签”有明确编辑/保存/删除动作，标签独立于组别 |
| Share | `BotShareDialog.tsx` | 右上分享按钮弹出分享/导出菜单；第一版只输出脱敏 Bot 资料摘要，不生成公开链接 |
| Dictation / Voice | `DictationButton.tsx`, `VoiceModeButton.tsx` | 灰色麦克风表示转文字；黑色声纹按钮表示独立实时语音模式，后者尚未接通时应明确 disabled 原因 |

### 4.3 行为规格

- 左边名册保持宽度和滚动位置；右面板打开后中间 Chat **收窄**，不覆盖聊天；关闭后 Chat 展开，位置和草稿不丢失。
- 每个 Bot 有独立输入草稿、滚动位置、最近打开 Tab；切 Bot 不导致另一个 Bot 正在执行的 Run 取消。
- 长消息虚拟化或分页，滚动到底时自动追随；用户手动滚动上方时停止自动追随，提示“跳到底部”。
- 支持用户自定义头像，**不强迫所有 Bot 都生成同一图形**；动态状态通过边缘动画/标识叠加，用户上传头像正文不做改写。
- 7 态 Presence 来自真实 `TaskRun` 和 DSH Session 状态，不允许随机抖动假冒工具活动。
- 深色主题可后置；第一轮 UI 金标是这两张**白色浅色**截图。

### 4.4 必须有真实行为的 UI 交互（新增，v1.1）

1. **左上 `+` / 创建 Bot**：M1 可对 Mock Repository 创建完整的 Bot Card，必须验证必填项、重名提示、取消、键盘聚焦；M2 切换为真实 `registry/create → preset/ensure → session/create → bind`，失败时保存 partial state 并展示“重试/查看详情”，不伪造完成。首次初始化角色与模型必须有默认值来源。
2. **Bot Profile / 编辑职责**：详情页可打开名称、头像、职责、工作风格编辑器；M1 写 Mock；M2/M4 通过 Claw Registry/Identity 正式受控写入（乐观锁/版本对比），不直接从 Renderer 写 SOUL/IDENTITY 文件。
3. **Permissions**：详情页增加“权限”设置入口，M1 展示权限矩阵和不可用原因；正式调用 Claw Policy/Permissions，变更必须与预览的生效策略一致；**硬权限上限不可由 UI 放宽**，涉及危险授权进入人工确认。
4. **标签**：点击“添加标签”进入多标签编辑；标签用稳定 tag ID，支持创建、关联、移除、筛选，标签与左侧分组不是同一对象；M2 增加 `tags`/`bot_tags` 数据表，重启仍可恢复。
5. **右上分享**：第一版显示“复制 Bot 简介 / 导出受限配置”菜单，导出前展示字段清单；默认剔除 Memory、对话、API Key、凭据、绝对路径、内部策略细节和工作区内容；没有真实远程分享后端时**不得生成分享 URL 或执行外发**。原生 Mac Share Sheet 后续可选。
6. **输入框左侧 `+`**：打开附件选择与最近文件入口；M1 的 Mock 状态不得伪装为上传成功，M2 才接 DSH 官方上传凭据/Session Attachment 机制；失败时展示可恢复错误。
7. **灰色麦克风**：产品定义为 Speech-to-Text（按住/点击开始听写→停止→填入草稿→用户确认发送），默认**不自动发送**。M1 显示明确的未配置状态，M7 才接入 macOS 或受支持 DSH STT Provider 并完成系统授权和音频测试。
8. **黑色声纹按钮**：产品定义为实时双向语音会话（可能涉及 TTS、VAD、打断和回声消除），排到 M8 之后的独立迭代；在未开发之前显示 disabled 和说明，而不是点击后进入假的语音聊天室。
9. **连接应用**：M1 进入真实的 App Connections 页面，显示可用连接器与断开状态，不能伪造已连接；M7 接 Claw 允许的 MCP/DSH Skills 授权流程。
10. **模型设置**：Settings → Models 配置全局默认；Bot Details → 更多 → Model 可覆盖其独立模型；`effectiveModel = botOverride ?? globalDefault`，必须通过 DSH `modelCatalog` 校验 provider/model/reasoningEffort，并在模型不可用时显示 `needs_model`，不能静默切换不相容模型。
11. **会话策略**：一个 Bot 创建时默认只有一条主 Conversation；数据模型保留 `conversationId → dshSessionId` 1:1、多条 Conversation → 同一 `botId` 的 1:N。M1/M2 不强行暴露“新建第二聊天”；后续新增 UI 时各会话独立历史、草稿、Request ID 和 Run，Bot 级长期记忆仍共享。
12. **失败反馈**：任何尚未接通的可见操作都必须明确禁用、提示原因或进入功能说明页。不得保留无 onClick 效果却看起来可用的按钮。

### 4.5 UI 视觉测试门禁

`apps/renderer/tests/visual/` 配置 Playwright，运行固定尺寸（按 CSS 标定）、固定 DPR、固定字体版本、冻结时间与模拟事件数据；完成：

- `roster-two-pane.spec.ts`：对比参考图一的布局，验收左名册、气泡、底部输入；
- `details-three-pane.spec.ts`：参考图二，确保左栏不动，详情出现，Chat 重新排版；
- `chat-content-long.spec.ts`：长中文消息、链接、中英文混排、Markdown；
- `bot-handoff.spec.ts`：机器人转发消息及 Handoff 事件的居中芯片；
- `avatar-presence.spec.ts`：上传图与生成头像共存，减少动画设置；
- `resize.spec.ts`：1440、1280、1024 与高 DPR；必须显式断言三栏标准视口的右栏宽度约为**整个窗口的 37%**，打开/关闭面板时左栏坐标变化低于 1px；
- `bot-editor.spec.ts`：创建 Bot、表单校验、编辑职责、编辑策略、标签关联/保存、分享脱敏；
- `voice-buttons.spec.ts`：麦克风=听写、声纹=语音会话两个功能语义分别验证；未实现时 disabled 文案与无副作用；
- `model-conversations.spec.ts`：全局模型和 Bot 级覆盖、主聊天默认行为、切换 Bot 保持草稿；
- `keyboard-accessibility.spec.ts`：键盘 Tab、Escape 关闭面板、VoiceOver 基础语义。

视觉门禁使用**分区域对比**（左侧、主聊天、详情、输入框），并记录实际误差区域。不要用一个含随机头像和时间的整页像素门禁误伤正常动态效果；严禁只凭“看起来差不多”判通过。

---

## 5. 详细迭代：必须按顺序合入

### M0（P0）：真实 DSH Host 与 Claw RC2 的接入可行性，禁止提前堆 UI

**目标**：选出合法可维护的 Host 运行和完整 Session API 通信方式，确认安全边界、DSH 版本矩阵。

**新增文件**：

- `apps/desktop/src/runtime/{dsh-host-supervisor,host-auth,host-readiness,process-lock,profile-bootstrap}.ts`
- `packages/dsh-adapter/src/{transport,session-client,claw-registry-client,remote-error}.ts`
- `scripts/{verify-dsh-version,smoke-host}.mjs`
- `docs/adr/ADR-0001-dsh-transport.md`
- `docs/compatibility-matrix.md`
- `tests/integration/dsh-rc2-host.test.ts`

**操作步骤（顺序不可颠倒）**：

1. 在新仓库固定 DSH RC2 `639ed015...`，记录安装的 `@deepseek-ai/dsh`、`api-session-controller`、`dsh-claw-suite` 和依赖锁；隔离 `DSH_HOME`。
2. 运行 DSH 基础 Host 不打开旧 UI；验证 `dsh web --no-open` 启动、Ready、优雅退出和端口回收。应用正式使用动态端口/父进程传递已验证端口，禁止与用户既有 3080 / Desktop 19387 冲突。
3. 加载 Claw Suite RC2，测试服务端 Registry 预设注册和 `session/bind`。避免沿用历史 profile 的 `wa-*` 残留。
4. 验证**受认证** Electron Renderer / Bridge 访问完整 Host API：`session.list/create/prompt/follow/cancel`；分别测试首次 Cookie 握手、WebSocket reconnect、重启 token 失效、非法 Origin、非授权窗口访问。
5. 验证 `session.follow` 的 snapshot/事件/assistant-stream 正确映射，断开 WS 后补历史且不重放重复消息。
6. 尝试 SDK `HarnessClient` Spike 仅作为对照，并记录：能发 Prompt，但中途 cancel/交互审批/既有 `wa-*` 组合是否能覆盖正式需求。严禁因为 SDK 更容易启动就默认选 C。
7. 在应用层验证必要的 Gate 生效、Approval 能正确显示和回传、Claw 与普通 Session 严格隔离；如果这些无法成立，停止正式 UI 后端接入，写明 blocker。

**验收测试**：

- `M0-01` 新 profile 冷启动 3 次无依赖残留；
- `M0-02` 未认证请求 `/api` 得 401/403（视失败类别），未经授权不得取会话；
- `M0-03` 真实发送消息并收到逐步 Stream、最终持久化事件；
- `M0-04` 开启 `session.cancel` 后当前 Turn 结束，等待队列不被误删；
- `M0-05` 强制 Host 退出后 UI 显示失联，重连可恢复真实日志；
- `M0-06` 不可用的 Claw preset 不能回退到普通 `standard` 继续执行；
- `M0-07` Gate 阻止禁止的工具调用，且审计有一致 Trace ID。

**交付**：ADR 明确首选/回退策略、端口和认证策略、Bridge 最小 PoC、全部验证日志。

### M1（P0）：Electron + React 高保真 UI Shell（初期 Mock 数据）

**目标**：先满足用户给出的两张截图，但所有交互有清晰状态模型。M1 允许 mock 数据和 disabled 未实现能力，但禁止将未接通按钮伪装成已完成。

**主要文件**：`apps/desktop/src/{main,preload}.ts`, `apps/renderer/src/app/{CornApp,CornShell}.tsx`, `src/features/{roster,chat,details}/*`, `src/styles/{tokens,layout}.css`, `packages/ui-kit/src/*`。

**实现顺序**：

1. Electron 透明/自绘标题栏与 macOS traffic lights（使用原生窗口配置；只有经测试的 draggable 区域，按钮加 `no-drag`）。
2. 定义浅色 tokens：Canvas、Sidebar surface、Selected row、User bubble、Bot bubble、Dimmed text、Dividers、Pill 输入框；尽量从用户截图量取而非主观杜撰。
3. `CornShell` 以 `selectedBotId`, `detailsOpen`, `detailsTab`, `sidebarWidth`, `chatScrollState` 组成 UI 状态，不混杂 DSH runtime state。
4. 左栏固定区：搜索/新增、Pinned Bot、分组标签、Bot 行、左下连接应用。
5. 中栏：居中标题胶囊、日期 divider、黑/灰消息气泡、Handoff Notice、固定底部 Composer。
6. 右栏：详情/资料库/电脑 Tabs、空状态、可折叠面板；切换后保持 Composer 草稿。
7. 模拟数据用 `fixtures/` 的具名对象，不把 mock fetch 写到正式 Adapter 中。所有可用按钮必须真实改变状态；尚未接通的附件上传/系统听写/实时语音应明确 disabled 或展示“尚未接通”引导，不能模拟外部副作用。
7a. 按 §4.4 定义 Create Bot、Bot Profile、权限、标签、Share、连接应用与模型入口的交互/状态。M1 用 Mock 接口但 UI 状态、禁用/失败行为必须真实可测试。
8. 加 VoiceOver 标签、减少动效支持、输入焦点恢复与 Mac 快捷键。

**验收**：截图双栏/三栏视觉回归通过；页面能够切换和输入；详情页打开时 Chat 按比例收缩；不会加载 DSH 官方 Web UI。

### M2（P0）：Claw Bot 与 DSH Session 的真实绑定/实时会话

**主要文件**：

- `packages/local-db/src/database.ts`, `migration-runner.ts`, `migrations/0001_corn_core.sql` （由 M4 **前移到 M2**）
- `packages/local-db/src/repositories/{bot,conversation,run,event,ui-state}-repository.ts`（M2 建立最小可用接口）
- `services/corn-orchestrator/src/{minimal-run-service,run-lifecycle}.ts`（M2 建立 Run 基础状态机）
- `packages/contracts/src/{run,model-selection,bot-settings}.ts`
- `packages/dsh-adapter/src/bot-session-transaction.ts`
- `packages/dsh-adapter/src/session-event-reducer.ts`
- `packages/dsh-adapter/src/claw-registry-client.ts`
- `packages/state/src/{event-store,chat-projections,bot-projections}.ts`
- `apps/renderer/src/features/chat/{MessageFeed,MessageComposer,ApprovalCard}.tsx`
- `plugins/dsh-corn-bridge/src/routes/bots.ts`
- `tests/integration/bot-create-and-chat.test.ts`

**M2 最小数据库必须先于真实 Bot 创建落地：**

- 表：`schema_migrations`、`bots`（包含可选 `model_override`）、`app_settings`（包含全局默认模型）、`conversations`、`session_bindings`、`task_runs`、`run_attempts`、`corn_events`、`ui_state`、`tags`、`bot_tags`。`task_runs` 必须从 M2 开始具备稳定 `run_id`、`bot_id`、`conversation_id`、`dsh_session_id`、`state`、`idempotency_key`、`last_event_seq`。
- 原则：一个事务提交所需的 Corn 元数据；DSH 本身的 Session Log 不复制为第二份权威日志。DB 采用 SQLite WAL 和显式迁移版本，`UNIQUE` / 外键 / 复合幂等键提供重复操作防护，写入由唯一进程所有者串行管理；不得让 Electron Renderer 直接访问 db 文件。驱动选择（Node `node:sqlite` vs better-sqlite3）在 M0 记录平台验证，选定后固定版本和打包测试。
- 首次 Bot→Session 绑定建立时，保存最小 `CornTaskRun`（创建/对话每次执行拥有独立 `runId`）；M2 为真实运行创建 `run.started/completed/cancelled/interrupted` 等事件，且 UI 可读；M4 再做跨重启完整对账、长期任务调度、失败重试和历史查询。
- M2 重启恢复必须可用：数据库恢复 `botId → conversationId → dshSessionId` 和 UI 选择状态，随后从 DSH Session Follow 获取权威消息；未终结 Run 恢复为 `interrupted` 或 `reconciling`，不能误报 `completed`。
- `packages/local-db/tests/{migration,run-repository,round-trip}.test.ts`、`tests/integration/run-m2-restart.test.ts` 必须加入 M2 门禁。

**事务步骤**（遵循现有 `dsh-claw-registry/registry-navigation.mjs`，不凭空发明另一套）：

```text
Corn UI: create/select Bot
→ Claw Registry 创建/读取 agent，获取 wa_ agentId + workspaceId + dshPreset
→ POST /api/dsh-claw/registry/preset/ensure
→ DSH remote.session.create({workspaceId, sessionId: clientGenerated, agentPreset})
→ 校验 returned agentPreset
→ POST /api/dsh-claw/registry/session/bind({sessionId, agentId, expectedRevision, source:'create'})
→ 按 Bot model 需要调用 remote.session.selectModel
→ POST /api/dsh-claw/registry/session/state({sessionId, state:'ready'})
→ corn local DB commit ConversationBinding
→ remote.session.follow({address:{kind:'session',sessionId}, assistantStream:true})
```

- 注意 `remote.session` 返回可能带 `RemoteResult` envelope，必须采用版本相符的解包逻辑，失败码不可吞掉。
- `session.create` 成功而 `bind` 失败时**标记部分创建**；不要丢失 Session ID、不要自动把它转给别的 Bot。提供 UI 重试绑定与人工修复入口。
- `selectModel` 失败标记 `needs_model`，不要继续假装 ready。
- 向 `remote.session.prompt` 发送 `requestId`, `mode:'queue' | 'steer'`, `content:[{type:'text',text}]`, `sessionId`, `clientTimeZone`；requestId 持久化与重试去重。
- `remote.session.cancel({sessionId})` 仅终止当前活跃 Turn，待处理消息保留，UI 文案必须准确。
- `follow` 首帧的 `snapshot.records` 和后续 seq 日志按身份、位置去重；流式 assistant chunks 与最终 committed `assistant/message` 合并，不展示两份答案。
- 不能从单个 assistant 消息推导所有 Task Run 状态；另有状态聚合器。
- Claw Session 导航不依赖 DSH `uiWorkspace.openSession`：Corn UI 内使用 `conversationId` 状态路由。

**验收**：创建 2 个真实 Bot；分别发送与取消；重启 Corn 后从 SQLite 恢复 Bot/Conversation/Run/标签、选中会话和消息；建立稳定 `runId`；Claw Gate 与 Memory 生效；审计可追溯；不能读取另一 Bot 的私有记忆文件。

### M3（P0）：本机 macOS Computer Use + Computer Panel

**前置检查（v1.1）**：M2 的 `task_runs`、`run_attempts` 和 `runId` 已真实落库；任何由 Agent 发起的 Computer Action 必须属于已有 Run，后台非对话动作先原子创建 Run，不能用任意临时字符串填充租约。

**新增/修改**：

- `plugins/dsh-corn-tools/src/control-lease.ts`（实际插件目录按 M0 需要），`plugins/dsh-corn-bridge/src/routes/computer.ts`
- `packages/contracts/src/computer.ts`
- `apps/renderer/src/features/computer/{ComputerPreview,ComputerTakeover,ControlLeaseBanner}.tsx`
- `apps/renderer/src/features/details/ComputerTab.tsx`
- `apps/desktop/src/security/ipc-allowlist.ts`
- `tests/integration/mac-computer-smoke.test.ts`

**必须先做的 Provider 实机核验**：

1. Compose 官方 `@deepseek-ai/dsh-computer-use` + `@deepseek-ai/dsh-experimental-computer-use-cua-driver-native`；若 native 对当前 Mac 的授权进程、升级或崩溃隔离不理想，则改用 `...cua-driver-mcp`，但**同一 Host 同时只能注册一个 computer-use provider**。
2. `check_permissions(prompt:false)` / 等价工具 → Mac 系统人工授权 → 列窗口 → 截图 → 点击一个安全测试应用控件 → 全新状态验证。不能为了 demo 自动勾选 TCC 权限。
3. 浏览器优先 compose `dsh-browser-use` + `...browser-use-playwright-mcp`；一个独立 Session 维持其浏览器，验证浏览器重启后状态丢失语义，不谎称默认持久浏览器登录态。
4. 首版 Computer Panel 可以显示“当前操作 + 最近授权截图 + 窗口标题 + 控制状态”，**不要假装 CUA 已自带持续高帧率直播**。实时视频预览若官方驱动不提供，单独设计受控 capture source；仅在确有必要时增加 Swift ScreenCaptureKit Helper。
5. 以一个 **Host/设备级 lease coordinator** 管理真实桌面；不能靠 React 状态锁。最低字段：`leaseId, botId, runId, owner:'agent'|'user', expiresAt, fencingToken`；`runId` 外键指向 M2 已持久化 `task_runs`；所有写输入经 Gate + 租约校验，用户接管切换为 user 并阻断新的 Agent 输入。M3 增加 `0002_control_lease.sql` 迁移与唯一活跃租约约束。
6. 注意真实 CUA 驱动可能不会调用 Corn 的自定义工具包装，因此强制执行 lease 时必须覆盖实际 `cua_driver_native__*` 和 `mcp__cua-driver-mcp__*` 的写动作；通过 `tools.guard` 统一拦截，未分类工具保守拒绝；只处理 UI 显示而不拦真实驱动是安全漏洞。
7. 将 browser/desktop 作为两条 Lane：browser 通道可在隔离的浏览器 Session 里并发，desktop 真实屏幕/键鼠必须单写者。不要混淆窗口级“后台输入”与全机前台输入。
8. 评估截图 MIME、DPR、多屏坐标映射、Retina scale、窗口移动、输入法、隐私保护、敏感应用拒绝名单；截图不得自动上传到外部服务（LLM 工具附件按用户选择的模型路由受控发送并明确提示）。

**验收**：用户授权后 Bot 能操作本机安全应用/网页；用户点击“接管”后 Agent 立刻停止新输入；多 Bot 竞争按队列/拒绝处理；关闭 Preview 不停止任务；macOS 权限撤销后 fail closed；Driver 崩溃有错误处理。

### M4（P1）：完善长期 Task / Run、状态卡与跨崩溃对账恢复

**新增/修改**：

- `services/corn-orchestrator/src/{runner,run-lifecycle,recovery}.ts`
- `packages/local-db/src/{schema,migrations,repositories}/`（扩展 M2 的现有 Schema 和仓库；**禁止二次新建初始数据库**）
- `packages/contracts/src/events.ts`
- `packages/state/src/run-projections.ts`
- `apps/renderer/src/features/chat/RunReceiptCard.tsx`

**实现**：

1. **在 M2 最小数据库上做增量 Schema Migration**，例如 M3 `0002_control_lease.sql`，M4 `0003_run_recovery.sql`：补齐 `routines`、`bot_messages`、`approvals`、任务执行恢复元数据及长期状态；不得延后 M2 已承诺的 Bot/Conversation/Run 最小持久化。每次 Migration 带版本及备份/恢复策略。
2. Run 状态机：`queued → running → waiting_approval/waiting_resource → running → completed/failed/cancelled/interrupted`，状态转移由单一服务校验。
3. 日志链路有三种标识：Corn `runId`、DSH `sessionId`、Session `seq`；Corn `eventId/seq` 独立。`turn/end`、审批、工具出错与资源等待映射必须可解释。
4. Host 异常退出：恢复时先读取 DSH 持久日志和 Corn event cursor，对账最后已提交的执行事实；**不可未经校验就自动重复不可逆操作**。
5. 每个任务有 idempotencyKey；仅对查询/可重试纯读自动重放，发信、上传、部署、付款等需人工确认或目标服务幂等保障。
6. 任务卡显示 Owner、状态、当前工具/动作、开始时间、阻塞原因、结果、可撤销按钮，不用原始 JSON 卡片糊到聊天里。

**验收**：Host kill -9 后重启恢复 UI/任务；显示 interrupted 而非假成功；重复事件不出现重复消息；用户可检查真实 Tool Result。

### M5（P1）：多 Bot 异步消息 + 群组

**新增/修改**：

- `services/corn-orchestrator/src/inbox-outbox.ts`
- `packages/contracts/src/conversation.ts`（Group/Message envelope）
- `apps/renderer/src/features/chat/HandoffNotice.tsx`
- `apps/renderer/src/features/groups/*`
- `plugins/dsh-corn-bridge/src/routes/events.ts`

**机制**：持久 Bot Messenger ≠ DSH 临时 Subagent Delegate。每条 Bot 消息包含 `messageId, fromBotId, toBotId, originRunId, conversationId, payload, status, causationId`；投递队列 at-least-once + 接收去重；支持 reply、过期、重试及限跳数。

**权限**：接收方以自己的 Claw 身份/Policy 执行，不继承发送方的高权限。Group Conversation 共享消息索引，私有 SOUL/USER/MEMORY 不自动群发。无权限的 Bot 不可被利用作间接工具代理；跨 Bot 操作依然经过 Gate。

**截图要求**：居中“已发消息给 X 和 Y”，显示小头像；点击可查看消息与对应 Run，不将 `HandoffNotice` 伪装成系统提示词。

**验收**：Chief → Researcher/Developer，两方独立执行并反馈；重启/网络断开不丢消息；重复投递不重复执行；权限降级测试通过。

### M6（P1）：Routines 与 macOS 用户级常驻

**新增/修改**：

- `services/corn-orchestrator/src/scheduler-adapter.ts`
- `apps/desktop/src/runtime/quit-policy.ts`
- `apps/desktop/src/runtime/health-recovery.ts`
- `apps/renderer/src/features/routines/{RoutinePage,RoutineEditor,RunHistory}.tsx`
- `packages/contracts/src/routine.ts`
- `docs/runbooks/launchagent.md`

**关键边界**：官方 DSH `schedule` 是把提醒投递到 Session Inbox，**不代表执行完成**；Cron 和时区由官方计算，Corn 必须建立 Routine→Run 关联、任务状态/完成判断以及失败处置。建议首版映射常驻 Bot 的固定 DSH Session 并检查调度与 Session Writer Lock；若需要独立 Routine Worker，则采用一个被明确定义的单写入者后台 Host，防止 UI Host 与 Worker 同时写同一 Session。

**macOS 生命周期**：窗口点击关闭 → 默认隐藏/后台运行；明确“退出 Corn Bot”才关闭前台。若要用户登出后仍持续运行，LaunchAgent 做不到，不能宣称其能在退出登录后操作桌面。Mac 睡眠不保证持续执行，睡眠期间应展示下次唤醒后补偿计划。

**验收**：创建一次性与重复 Routine、暂停/启用、检查跨重启下一次 UTC 计划；关闭窗口后服务仍在登录用户会话内运行；电脑睡眠唤醒后的 Run 状态可解释；UI 和后台不造成重复执行。

### M7（P2）：资料库、连接应用与成果交付

**修改**：`KnowledgeTab.tsx`, `apps/renderer/src/features/settings/*`, `packages/local-db/src/repositories/artifact.ts` 等。

**原则**：知识索引元数据由 Corn 管理；原始文件仍位于用户 Mac，经允许的安全路径访问。文件卡能预览、用 Finder 打开、定位来源和所属 Run；外部应用连接应通过受支持的 DSH MCP/权限体系，不将密钥存进 renderer 的 localStorage。

**语音扩展（M7 只含听写 STT）**：`features/voice/DictationButton.tsx` 使用经 M0/M7 验证的 macOS 原生或 DSH STT 能力，采用先授权、开始/停止录音、转写到 Composer 草稿、用户确认发送的闭环；禁止默认自动发送；存储策略必须显式区分音频临时缓存和对话正文。黑色声纹按钮的实时全双工语音在 M8 之后单独立项，不能用普通录音功能冒充。

**验收**：图片/Markdown/PDF 等关联文件可查、路径权限有效；目录移动后展示“丢失/重定位”；访问不属于该 Bot 的敏感资料必须拒绝；有授权 Mac 的 STT 能填入草稿，无授权时明确拒绝，黑色语音按钮不触发任何未实现副作用。

### M8（P2）：发布、升级、回滚与持续测试

**文件**：`apps/desktop/electron-builder.config.ts`, `scripts/package-macos.mjs`, `.github/workflows/{ci,release-macos}.yml`, `docs/runbooks/upgrade.md`, `docs/runbooks/rollback.md`。

- 构建目标优先 macOS arm64，x64 后续测试；Apple Code Signing + Notarization，权限描述及签名应用归属固定。
- DSH Host runtime 和 Corn App 版本解耦，但用 `compatibility-matrix.md` 明确组合；升级前验证 Suite/DSH，安装 staging/profile 配置备份，可回滚。
- 原生 CUA Driver 的 optionalDependencies 不可忽略；绝不能发布纯 JS 包后声称电脑操作可用。
- macOS 权限授权归属要稳定：升级应用不应凭空换 Bundle ID；未签名开发版与已签名正式版的 TCC 行为需要独立测试。
- GitHub CI：lint/typecheck/unit/integration(contract mocks)/UI visual/macOS smoke/release checks。视觉测试固定 OS、DPR 和字体；敏感 macOS TCC E2E 应由受控测试机器执行，不应让公共 CI 自动授予权限。
- 安装器支持卸载，不删除用户 Bot 记忆/数据库；明确单独的“彻底删除本地数据”操作。

**发布门槛**：清洁 Mac 可安装；无旧 DSH 也能按引导安装或发现兼容 Runtime；退出/重启不丢数据；Agent 操作的权限可被撤销；UI 两张参考图的主结构通过视觉验收。

---

## 6. 安全/故障矩阵（交付前必须有自动化测试）

| 测试 | 触发 | 期望 |
|---|---|---|
| S01 | 直接访问 `/api`，无 Cookie / 错误 Origin | 拒绝且不返回敏感数据 |
| S02 | 伪造 `wa-*`/错误 Claw Binding | 拒绝执行危险工具 |
| S03 | Claw Gate 服务不可用/部分加载 | 高风险 Claw Tool fail closed，普通 Workspace 不误伤 |
| S04 | Session create 完成而 Binding 保存失败 | 部分创建记录可恢复，不当作普通 Session |
| S05 | `wa-*` 预设不存在 | 不回退成 `standard` |
| S06 | 电脑输入租约过期后，旧 Agent 延迟 Tool 到达 | fencingToken 拒绝旧拥有者 |
| S07 | 用户 Takeover 中 Agent 再次点击 | 新点击拒绝，用户控制优先 |
| S08 | 多个 DSH Host 竞争操作同一 Mac | 进程间锁/单 writer 有效，而不只靠内存锁 |
| S09 | Mac 无 Screen Recording / Accessibility 授权 | 显示缺失权限、无输入操作，不自动授权 |
| S10 | 截图/Tool Result 涉及敏感信息 | 审计脱敏，传模型按模型路由明确控制 |
| S11 | 应用 crash/restart | Bot 和日志恢复，未完成 Run 不报成功 |
| S12 | 重复 Bot Messenger 投递 | 接收去重、不重复副作用 |
| S13 | Routine 到期且前一次还在执行 | 串行/跳过/排队策略明确且可配置 |
| S14 | Preview 未打开但 Bot 工作 | 任务继续，不依赖 React 生命周期 |
| S15 | 从未可信文档读取提示词注入 | 不升级权限，不能跳过 Gate/审批 |
| S16 | Renderer XSS 或第三方页面试图 IPC | Electron contextIsolation + sandbox + allowlist + sender validation 拒绝 |
| S17 | Driver crash 或取消工具后输入已部分送达 | 状态未知提示 + 重新观察，不自动重试不可逆输入 |
| S18 | 更新失败导致 DSH profile manifest 半写入 | 事务性回滚并保留日志与原运行版本 |

**补充**：macOS 本机共享屏幕意味着 Bot 之间并非天然有 OS 级安全隔离。权限治理只能约束通过 DSH/Bridge 的受管操作；同用户同权限恶意进程、第三方插件及外部操作无法由 Corn UI 自身隔离。必要时另行设计高风险代码沙箱，但不是首版默认 Linux VM。

---

## 7. Agent 执行规范：最小任务拆分与 PR 切片

不得由一个 Coding Agent 一次提交完 M0–M8。建议每个里程碑至少拆分如下 PR：

| PR 编号建议 | 变更范围 | 需提供的证据 |
|---|---|---|
| PR-00 | 新仓库初始化、Node/pnpm、CI、截图资产、明确开源许可证 | `pnpm install`, `pnpm lint`, `pnpm test` |
| PR-01 | DSH Host 启动/停止/认证 Spike、ADR | 真实 Host API smoke 录像/日志，401/403 负例 |
| PR-02 | Corn UI Shell 与双栏/三栏 Mock | 固定 viewport 截图与 Playwright 差异报告 |
| PR-03 | Session Adapter + Registry 事务 **+ M2 SQLite 最小 Schema + Run ID** | 真实创建/发消息/断线恢复/部分成功 E2E、数据库迁移和 Kill/Restart |
| PR-04 | CUA Provider 试验 + 安全门禁 | 真机权限/窗口/输入/独占锁证据 |
| PR-05 | Computer Tab、预览、人工接管 | User takeover E2E |
| PR-06 | Run 高级恢复与跨进程对账（**不是第一次新建 Run Store**） | kill/relaunch/幂等测试 |
| PR-07 | Messenger + Group | 实际两个 Bot 异步协作与权限降级 |
| PR-08 | Routines + LaunchAgent | 登录状态下后台任务与重启恢复 |
| PR-09 | Artifacts / polish / release | 签名、公证、安装/更新/卸载/视觉报告 |

### 统一 PR Definition of Done

每个 PR 必须：

1. 列出修改/新增文件，说明为何属于当前层，不横向耦合其他业务层。
2. 提供确切运行版本和 SHA；DSH API 不得按旧经验猜测。
3. 提供正向与负向测试，包含失败路径；禁止仅在 Mock 上宣称功能完成。
4. 提供可复现的执行指令和结果摘要（实机需要用户交互授权的测试标记 `manual-required`）。
5. 更新 `docs/architecture.md` 与相应 ADR；接口变化需同步 `packages/contracts`。
6. 不将开发账号 token、模型 API Key、Apple 签名凭据、个人聊天日志及截图敏感内容提交 Git。
7. 新提交不能未经明确说明自动迁移用户现有 `~/.dsh`。
8. 涉及第三方代码复用时提供来源 URL、许可证、修改记录；原厂不明许可资源不可移植。

---

## 8. 先做什么：给主执行 Agent 的指令

> **你是 Corn Bot 的总工程执行 Agent。** 请从 `M0` 开始，不要直接实现所有里程碑。先创建 `xingyingyuzhui/corn-bot` 独立仓库（若用户已有仓库则在现有仓库继续，不强制重建），设置最小 TypeScript/Electron 工作区、CI，保留用户提供的参考截图。然后锁定 DeepSeek Harness `dsh-v0.2.0-rc.2` 和 Claw Suite `v0.3.0-rc.2`，按官方真实 API 完成连接/鉴权/会话/取消/实时流的 Spike。验证通过后产出 `ADR-0001` 与 M1 文件级 PR 清单。不能跳过 Gate、不能私有协议猜测、不能把 SDK 缺少的交互式审批能力说成已经实现。每个 PR 完成后输出日志、截图、测试、兼容性与剩余风险。若关键接口不可用，要停工并给出可验证的备选路径和对 DSH 上游的最小扩展需求。

### 用户负责审批的点

- 新仓库创建与公开/私有设置（建议先 `private`，准备开源时再转 public）；
- 实机授权 macOS Screen Recording、Accessibility、Automation；
- 切换影响现有 DSH profile 或导入真实 Bot 记忆；
- 外部消息发送/登录凭据管理和高风险不可逆动作；
- Apple Developer ID 签名、Notarization 与发布。

---

## 9. 参考源码与版本链

**DSH 官方 — 第一轮以 `dsh-v0.2.0-rc.2` 固定 tag 为准**

1. [仓库](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2) · [RC2 commit](https://github.com/deepseek-ai/deepseek-harness/commit/639ed015397290b3745d163aafe02ffee4aa3f84)
2. [Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/api/session-controller/src/index.ts) · [Session Types](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/api/session-controller/src/types.ts) · [Follow History](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/api/session-controller/src/history.ts)
3. [API Gateway](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2/packages/api/gateway) · [Client Connection](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2/packages/client/connection) · [Remote Assembly](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2/packages/api/remotes)
4. [SDK Client](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/sdk/client/README.md) · [SDK Protocol](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/sdk/protocol/README.md)
5. [Computer Use](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/docs/subsystems/computer-use.md) · [CUA Native](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/experimental/computer-use-cua-driver-native/README.md) · [CUA MCP](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/experimental/computer-use-cua-driver-mcp/README.md)
6. [Browser Use](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/experimental/browser-use-playwright-mcp/README.md) · [Schedule](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/docs/user/guide/schedule.md) · [Tool Pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/docs/tool-execution-pipeline.md)
7. [Desktop Host process](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/src/host-process.ts) · [Desktop Electron main](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/src/main.ts)

**现有 Claw Suite — 0.3.0-rc.2**

8. [Suite Release](https://github.com/xingyingyuzhui/dsh-claw-suite/releases/tag/v0.3.0-rc.2)
9. [Registry Session Transaction](https://github.com/xingyingyuzhui/dsh-claw-registry/blob/release/0.3.0-rc.1/registry-navigation.mjs) · [Registry Host and Binding API](https://github.com/xingyingyuzhui/dsh-claw-registry/blob/release/0.3.0-rc.1/host.js)
10. [Core Session Classifier](https://github.com/xingyingyuzhui/dsh-claw-core/blob/release/0.3.0-rc.1/session-classifier.mjs) · [Claw Gate](https://github.com/xingyingyuzhui/dsh-claw-gate/blob/release/0.3.0-rc.1/host.js)

**社区界面参考（不是 Corn 的执行内核）**

11. [OpenMausBot Sidebar](https://github.com/milind-soni/OpenMausBot/blob/main/src/components/Sidebar.tsx), [ChatView](https://github.com/milind-soni/OpenMausBot/blob/main/src/components/ChatView.tsx), [ComputerPanel](https://github.com/milind-soni/OpenMausBot/blob/main/src/components/ComputerPanel.tsx)（Apache-2.0；移植代码需保留许可证）
12. [Rakazo/Grokbot Shell](https://github.com/vnavani/Grokbot/blob/main/apps/web/src/pages/Shell.tsx)（主要参考交互状态管理）
13. [Grok Bot 0.18 逆向重建](https://github.com/b-nnett/grok-bot-0.18-reconstructed)（仅供研究布局和行为，不直接搬运原厂逆向资产）

---

## 10. 最终验收清单

- [ ] 交付 `Corn Bot.app`，直接运行于本地 Mac，独立界面，不加载 DSH 官方 Workspace UI。
- [ ] 两张 Grok Bot 参考图对应的双栏/三栏交互布局已通过定点视觉回归。
- [ ] Bot 名册、分组、收藏、头像、消息、Handoff 和右侧三个 Tab 可用；新增 Bot、权限/职责、标签、分享按钮有明确可测试行为。
- [ ] Corn 使用完整 DSH Host Session API，至少支持创建、发送、取消、事件流与历史恢复。
- [ ] 每个 Bot 绑定真实 Claw Registry/Policy/Memory/Gate，不存在降级权限路径。
- [ ] 官方 CUA Provider 实际操作**当前这台 macOS**，不是 Linux VM；Mac 权限拒绝时 fail closed。
- [ ] 用户接管与全机互斥通过多 Bot 并发及竞争测试。
- [ ] **M2 即完成最小 SQLite + Run ID + 迁移 + 重启恢复**；M3 的租约外键绑定 Run；M4 完成高级恢复与重复事件处理。
- [ ] Routines、Messenger 能保留状态并在用户登录会话内后台运行，睡眠/退出登录的限制表述准确。
- [ ] 安装包签名/更新/卸载、数据库迁移、DSH 升级兼容、机密保护通过发布门禁。

**一句话架构原则：保留 DSH 的能力，保留 Claw Suite 的治理，独立构建 Corn Bot 的产品体验；先证实协议和安全，再交付高保真 UI 与本机电脑控制。**


---

## 11. v1.1 实施前纠偏：Agent 必须落实的文件/测试清单

> 本节覆盖 v1.0 中所有与 §4、M2、M3、M4 冲突的旧描述；其余 M0–M8 依赖顺序保持不变。

### 11.1 视觉布局补丁（M1 / PR-02）

| 文件 | 代码级改动 | 必须附带的测试 |
|---|---|---|
| `apps/renderer/src/styles/tokens.css` | 提供 `--corn-sidebar-width`、`--corn-details-width`、`--corn-chat-min-width`；将详情宽度目标定义为**窗口总宽约 37%** | 固定 viewport CSS 变量快照 |
| `apps/renderer/src/styles/layout.css` | 开关详情通过 CSS Grid 追加/移除第 3 列，不改左列宽和滚动容器；中列 `minmax(0,1fr)` | 1416px 三栏布局各列宽断言 |
| `apps/renderer/src/app/CornShell.tsx` | `detailsOpen` 只控制第三列；保留 activeBot、draft、scroll state；窄窗口改 overlay/独立面板 | 开关 Details 后名册 x 坐标稳定、聊天重排 |
| `apps/renderer/tests/visual/details-three-pane.spec.ts` | 从参考 PNG 人工记录分割线像素值和 DPR，校验右列 `rightPaneWidth / viewportWidth ≈ 0.37`，误差由 ADR 写明 | 定点基线截图、全截图差异报告 |
| `design/design-spec.md` | 记录 total-width 与 remaining-width 两个比例的换算，禁止写模糊的“可用宽度 36%” | review checklist |

### 11.2 SQLite/Run 基线补丁（M2 / PR-03；M3/PR-04 前置）

| 文件 | 代码级改动 | 必须附带的测试 |
|---|---|---|
| `packages/local-db/src/migrations/0001_corn_core.sql` | Bot、Conversation、Binding、TaskRun、Attempt、Event、UI State、AppSettings/ModelOverride、Tags、BotTags、SchemaVersion；FK/unique/index | 空库迁移、重复迁移、坏版本拒绝 |
| `packages/local-db/src/database.ts` | `PRAGMA foreign_keys=ON`，WAL 配置，进程内单 Writer 约束，关闭时 checkpoint/flush 策略 | 并发事务及异常退出 |
| `packages/local-db/src/migration-runner.ts` | 按序升级、迁移之前备份、失败恢复，不允许自动破坏用户 DB | 版本回滚/拒绝不兼容 schema |
| `packages/local-db/src/repositories/run-repository.ts` | `createRun`, `transitionRun`, `getRun`, `listOpenRuns`, `markInterrupted`；幂等唯一键 | 状态机合法/非法转移、重复请求 |
| `services/corn-orchestrator/src/minimal-run-service.ts` | 每个真实 DSH Turn admission 前建立 Run；Run 与消息 receipt/Session seq 分离，完成判定来自真实事件 | Prompt 被拒绝/并发提交/取消 |
| `packages/dsh-adapter/src/bot-session-transaction.ts` | 绑定事务成功后 commit ConversationBinding；部分失败保留 Session ID 和中间状态 | DB/DSH 写入失败补偿及恢复 |
| `apps/desktop/src/runtime/profile-bootstrap.ts` | 启动时打开并迁移 Corn DB、恢复绑定索引后连接 Host | 退出/重启/迁移门禁 |
| `tests/integration/run-m2-restart.test.ts` | 真实或可审计测试环境中重启：Bot/Conversation/Run/选中项完整，活跃 Run 标为需要对账 | kill/restart E2E |
| `packages/local-db/src/migrations/0002_control_lease.sql`（M3） | `control_leases.run_id REFERENCES task_runs(run_id)`、设备唯一活跃租约、防 stale fence | 非法 Run、租约超时、用户 Takeover |

### 11.3 产品交互补丁（M1 结构、M2/M7 真正接通）

| UI 按钮/入口 | 组件文件 | 契约/动作 | 测试 |
|---|---|---|---|
| 左上 `+` | `features/bot-editor/CreateBotDialog.tsx` | `createDraft → validate → create Claw Agent → create main Conversation` | 重名、取消、部分创建恢复 |
| Bot 资料编辑 | `features/bot-editor/BotProfileEditor.tsx` | 带修订号更新 Claw Identity，冲突提示 | 同时编辑冲突、权限校验 |
| 权限 | `features/bot-editor/BotPermissionEditor.tsx` | `previewEffectivePolicy → savePolicy`，不能升越 hard cap | 无授权/策略冲突/硬上限 |
| 标签 | `features/bot-editor/BotTagsEditor.tsx` | `tag.create/bind/unbind/list`，与 Group 区分 | 重启、重复标签、过滤 |
| 分享 | `features/bot-editor/BotShareDialog.tsx` | `exportPublicBotSummary` / copy；默认不导出秘密/长期记忆 | 输出脱敏、权限与路径不泄露 |
| 模型 | `features/settings/GlobalModelSettings.tsx`, `BotModelSettings.tsx` | `catalog → globalDefault/botOverride → selectModel`；失效转 `needs_model` | 模型下架、重新选择、per-Bot 隔离 |
| 灰色麦克风 | `features/voice/DictationButton.tsx` | M1 disabled 提示；M7 授权后启动/停止 STT 填草稿，不自动发消息 | 无授权拒绝、未实现禁用、STT 错误 |
| 黑色声纹 | `features/voice/VoiceModeButton.tsx` | M1–M8 disabled + 明确后续迭代标识；独立语音对话阶段上线 | 明确禁用、不误触发发送 |
| 右侧 `电脑` | `features/details/ComputerTab.tsx` | 查权限→请求画面→Takeover 独占；无授权不操作 | 授权撤销、并发控制 |
| 左下连接应用 | `features/settings/AppConnectionsPage.tsx` | M1 只列真实连接状态；M7 接 DSH MCP/Skills 管理 | 断开、刷新、权限边界 |

### 11.4 修订执行指令（直接交给总 Coding Agent）

> 请以此 v1.1 文档为准继续 M0–M8，不要从头重构架构。M0 先完成真实 Host 连接和 SQLite 驱动/打包选择的 ADR 验证。M1 高保真三栏右侧详情栏按整个窗口宽度 37% 标定，并完成所有可见按钮的状态和行为规格（未接通者明确禁用）。M2 必须实现实际 SQLite Schema、Bot/Conversation/Binding/Run 持久化、基础状态机、标签、UI 状态与重启恢复。M3 使用 M2 的真实 runId 构造 `DesktopControlLease`，不允许空 Run 或临时 ID。M4 只完善崩溃对账和长任务恢复，禁止把初始数据库推迟至 M4。模型、主会话、语音采用 §4.4 的默认策略。每一项修改必须给出具体 diff、测试日志、真实版/Mock 能力区分和后续风险；不允许只改文档而跳过代码落地。
