# Corn Bot — 本地 macOS 持久 Bot 工作平台：代码级迭代实施计划

> 版本：计划 v1.3 · 2026-10-11（基于 Kit 动态头像更新，新增 Avatar Motion 子系统与代码级验收）；仓库同步版附 §14 维护者决策及 §15 Corn 原创素材接入增量，§14 与正文冲突时以 §14 为准
> 交付对象：执行开发的 Coding Agent / 工程团队  
> 目标：独立 `Corn Bot.app`，高保真借鉴 Grok Bot 的白色双栏/三栏桌面 UI，运行于用户当前 macOS 桌面，复用 DeepSeek Harness（DSH）的 Agent 引擎及既有 DSH Claw Suite 的治理能力。  
> **性质：待执行的开发计划，不表示已实现、已集成或已测试通过。**

---

## 0. 执行摘要：冻结的决策

1. **新仓库：`xingyingyuzhui/corn-bot`**，建议先建为独立仓库；本计划不要求创建 DSH fork，不要求修改官方 `deepseek-ai/deepseek-harness` 主仓库，不要求把 Corn UI 注册到 DSH 的 `sidebar.workspaces` 插槽。仓库已于 2026-10-10 创建（私有）。
2. **品牌/产品/UI 与 DSH 原 UI 解耦**：Electron 主进程 + React/TypeScript Renderer；界面直接实现 Bot 名册、聊天、详情、资料库、电脑，而不是嵌套 DSH 原有 WorkspaceBrowser。保留共享 DSH Agent Runtime。
3. **优先完整 DSH Host API + 自有 Bridge**，而不是重复开发 Agent Loop。第一阶段用 TypeScript SDK 做通信 Spike 可以，但正式版不能直接依赖 SDK 完成取消、审批和长期任务生命周期（其协议有明确缺口）。
4. **macOS 真实本机电脑**：优先使用 DSH 官方 `dsh-computer-use` + `experimental-computer-use-cua-driver-{mcp,native}`；浏览器优先 `dsh-browser-use` + `experimental-browser-use-playwright-mcp`。不要在尚未验证能力时从零写 Swift Computer Driver。Swift Helper **仅作可选补充**。
5. **Claw Suite 保持独立**，锁定 `dsh-claw-suite@0.3.0-rc.2` 及九个组件；Corn Bot 新开发 `corn-bridge`、`corn-tasks` 等自己拥有的产品边界。若发现 Claw Suite 需改，向相应 Claw 插件仓库提交兼容性补丁，不把其代码复制进 Corn 仓库。
6. **安全不能因产品 UI 变化而倒退**：每个 Corn Bot 必须经 Claw Registry 的真实 Session Binding、Claw Gate 和官方 Sandbox/Approval。不能从普通 DSH Session 假冒 Claw；`claw-uncertain` 必须拒绝危险操作。
7. **视觉证据分级**：用户提供的 `design/references/grok-bot-chat-{two,three}-pane.png` 是指定场景的**最高优先级视觉验收基准**；`xingyingyuzhui/grok-bot-ui-ux-kit` 提供可追溯的 0.68.1 静态 UX 规格与官网演示对照，分别归档、不能混称同一版本。先还原布局、字重、排版、颜色、间距、圆角，再做动效。默认浅色主题，不强行上 Liquid Glass。
8. **版本/运行时锁定**：优先 DSH `dsh-v0.2.0-rc.2`（提交 `639ed015397290b3745d163aafe02ffee4aa3f84`）与 Claw Suite `v0.3.0-rc.2` 的组合；官方 `master` 2026-10-10 时为 `d743267388641bc76f17c45ce8b4c231aed1d32c`，是**后续 API 对照，不作为第一轮自由升级目标**。参考 DSH RC2 Node `^22.19.0 || >=24`、pnpm `11.7.0`；Corn 仓库应采用可兼容的 Node LTS，具体以锁文件验证。
9. **开发阶段必须使用隔离数据家目录**，例如 `DSH_HOME=$HOME/.corn-bot-dev/dsh`。禁止直接迁移或污染用户现有 `~/.dsh`、既有 Desktop profile、已注册的 Claw Agent。生产迁移必须先备份、可回滚。
10. **第一里程碑是产品主界面 + 真实对话**，第二里程碑是本机电脑操作，随后才是 Bot-to-Bot 与 Routines。不要为炫技先写多 Agent 调度系统。
11. **M2 必须引入最小 SQLite 持久化与 Run ID**：M2 建立 Bot、Conversation、Binding、TaskRun、CornEvent 和数据库版本迁移；M3 所有 Computer Lease 绑定已存在或原子创建的 `runId`。M4 负责高级恢复及长期任务，不再首次引入数据库。
12. **产品默认决策**：全局默认模型+每 Bot 覆盖；每 Bot 默认主会话一条，但 schema 支持多 Conversation；语音第一阶段做语音转文字，实时语音会话后置。所有尚未实现的按钮必须 disabled+解释，不能空点击或伪成功。
13. **三栏标定口径**：右侧详情约占窗口总宽度 36%–38%（初始目标约 37%），约为扣除左侧名册后剩余宽度的一半；不得误写成剩余区域的 36%。
14. **UI Kit 锁定与知识来源**：M0 固定 `grok-bot-ui-ux-kit` 的 commit `0248419b80dde84560409802afb98f38803df52c`。将 `docs/{website-comparison,integration,visual-system,component-spec,ui-ux-spec,replication-checklist,provenance,capture-plan}.md` 作为 UI/UX 设计输入，产品代码以 Corn 自己的 React/TS 类型与状态实现；不得将原 ASAR/Renderer、未授权字体/图标/音频/品牌素材打包进产品。具体参照 §12–§13。

15. **动态头像单独立项**：Kit `0248419` 恢复了官网 35 状态/25 轮廓的动态头像与 DMG 53 状态独立引擎。Corn 在 **M0 确定授权与引擎策略，M1 实现头像纯组件/可替换渲染器/动效生命周期，M2 把 DSH/Claw 实际运行状态接入映射，M8 检查发布产物**。两个来源的状态不可直接混用；不存在可直接用的第三方代码再分发许可时只参考行为规格，自行实现动画。详见 §13。

### 非目标

- 不在 macOS 上运行默认 Linux VM、Docker 桌面或云端 Computer；用户明确要求当前 Mac 本机操作。
- 不自行发明未经官方 DSH 认证的 RPC 协议并冒充其公共接口；任何未在当前锁定 tag 中发现的 API 都先做可行性验证。
- 不复用原厂不可再分发的图片、字体、精灵资源或反编译代码资产。社区代码可在明确许可证及来源情况下受控借鉴。
- 即使研究仓库由同一用户公开，也不代表其 `reference/`、`assets/`、`tokens/` 所包含的第三方来源资源可以直接作为 Corn Bot 的开源/商业发布资源；按 §12 来源审计和许可门禁处理。
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
│           ├── visual/
│           └── fixtures/                  # 命名 fixture（M1 Mock），仅测试/开发路由使用
│               ├── kit-chat-states.ts
│               ├── kit-voice-states.ts
│               └── kit-avatar-states.ts   # 固定种子/可控时间/上载分支
│
├── packages/
│   ├── contracts/
│   │   ├── src/bot.ts
│   │   ├── src/avatar.ts                 # AvatarPreference / AvatarVisualState / AvatarEvent
│   │   ├── src/conversation.ts
│   │   ├── src/events.ts
│   │   ├── src/approval.ts
│   │   ├── src/computer.ts
│   │   ├── src/routine.ts
│   │   ├── src/run.ts
│   │   ├── src/model-selection.ts
│   │   ├── src/bot-settings.ts
│   │   └── src/index.ts
│   ├── ui/                                # Corn 自有组件包（原名 ui-kit，避免与研究仓库 UI/UX Kit 混淆）
│   │   ├── src/Avatar.tsx                 # 兼容外观封装（只透传）
│   │   ├── src/avatar/
│   │   │   ├── BotAvatar.tsx              # public view component
│   │   │   ├── AvatarRenderer.tsx         # 能力/授权控制的 renderer selector
│   │   │   ├── CornMotionAvatar.tsx       # Corn 自主实现动画（默认）
│   │   │   ├── UploadedAvatar.tsx         # 用户图片独立分支
│   │   │   ├── StaticAvatar.tsx           # 无动效/后台/无权限 fallback
│   │   │   ├── motion-presets.ts          # shape/state/config; Corn-owned
│   │   │   ├── motion-scheduler.ts        # RAF、IO、Document、Reduce Motion
│   │   │   ├── useAvatarLifecycle.ts      # mount/visibility/unmount
│   │   │   └── index.ts
│   │   ├── tests/avatar/
│   │       ├── avatar-contract.test.ts
│   │       ├── avatar-lifecycle.test.tsx
│   │       └── avatar-shapes.test.tsx
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
│   │   ├── src/avatar-state-reducer.ts    # M2: real DSH/Claw → Corn state
│   │   ├── src/avatar-presentation.ts     # UI deterministic precedence
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
│   ├── dsh-corn-bridge/        # 推迟（§14 决策 1）：仅在确需 Host 侧路由时创建
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
│   ├── avatar-motion/              # Corn 独立设计资源，许可审查后才加入
│   ├── grok-kit/
│   │   ├── kit.lock.json             # 机器可读 pin（commit + 必读文件 SHA-256）
│   │   ├── SOURCE_LOCK.md            # Kit 提交、来源、范围、授权分级
│   │   ├── SPEC_MAPPING.md           # Kit 规格 → Corn TSX/CSS/test
│   │   ├── INTERACTION_COVERAGE.md   # 83 项验收交叉索引（PR-02B）
│   │   ├── AVATAR_SOURCE_MATRIX.md   # 官网 35/25 与 DMG 53 分表
│   │   ├── AVATAR_BEHAVIOR_MAPPING.md
│   │   └── RIGHTS_REVIEW.md          # 原始资源的阻断式授权审查
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
    ├── verify-ui-kit-reference.mjs   # 证据版本与路径约束
    ├── audit-ui-assets.mjs           # 排除未授权原包文件
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
  avatar: {
    kind: 'uploaded' | 'generated' | 'default'
    assetId?: string                   // uploaded / user-licensed art only
    color?: string                     // Corn palette; no third-party sprite implied
    motion?: { shape: CornAvatarShape; seed: number; enabled: boolean }
  }
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
- **范围先分清**：这两张用户提供的截图是指定 UI 的场景金标；Kit 对 0.68.1 安装包静态复原的侧栏默认 280px（展开约束 240–400、折叠 88）、详情默认 320px（最小 280）、主聊天最小 424px，则用于 **`dmg-0681` 布局 profile 和 UX 边界测试**；官网演示布局另作为 `website-demo` 来源。不得把这些静态指标未经匹配直接用于覆盖用户截图场景。
- 双栏左栏约为窗口总宽的 27%；三栏右侧详情约为**窗口总宽的 37%**（约等于**去掉左栏之后可用空间的 50%**）；三栏中间聊天因此约占 36%。以原图分割线为准，不能把右侧误记为“剩余空间的 36%”。
- ~~在标定视口 1416 CSS px 下参考基准：左栏约 380px、中间聊天约 510–520px、右侧详情约 516–526px~~。**PR-02A 标定结果（2026-10-11）**：截图为 DPR 2，真实视口 **1024×764 CSS px**；左栏 **276px**、三栏时聊天 **372px**、详情 **376px**（总宽 36.7%）。详见 `design/design-spec.md`。
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
| Bot 管理面板 | `BotDetailsPane.tsx` / `features/details/*` | §16：概览 / 配置 / 资料库；核心、模型、权限、技能进入配置子页；本机画面/Takeover 在 M3 独立操作视图 |
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
- `avatar-motion-states.spec.ts`：官网35状态/25轮廓的 Corn 兼容映射、固定seed静态帧、idle/thinking/working/alerting 转换、非法状态拒绝；
- `avatar-motion-lifecycle.spec.ts`：IntersectionObserver、`document.hidden`、`prefers-reduced-motion`、暂停/重新可见、卸载、重复切 Bot 时无多余 RAF；
- `avatar-motion-load.spec.ts`：长 Bot 列表滚动、离屏暂停、20+ 实例交替显示、React strict-mode mount/unmount，含性能日志与内存趋势；
- `resize.spec.ts`：1440、1280、1024 与高 DPR；必须显式断言三栏标准视口的右栏宽度约为**整个窗口的 37%**，打开/关闭面板时左栏坐标变化低于 1px；
- `kit-layout-profiles.spec.ts`：分开验证 `user-screenshots` 三栏宽度和 `dmg-0681` 静态规格，后者测 sidebar 240/280/400/88、主区 424、详情最小 280；布局来源记录进 test metadata；
- `kit-thread-resize.spec.ts`：以主内容 ResizeObserver 测得的 847/848/849px 宽度验证 task-thread 单栏/并排及 424px 下限，不以 viewport 媒体查询冒充；
- `kit-composer-ime.spec.ts`：IME 组合期间 Enter 不发送，Shift+Enter 不发送，菜单打开不误提交；仅附件可以发送，最多6个、失败保留草稿、重试不重复入队；
- `kit-ui-states.spec.ts`：详情 tab 随 bot/group 成员变更；审批 once/deny/always/expired、voice activating/recording/processing/error 的 mock state 有真实可见反馈；
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

**主要文件**：`apps/desktop/src/{main,preload}.ts`, `apps/renderer/src/app/{CornApp,CornShell}.tsx`, `src/features/{roster,chat,details}/*`, `src/styles/{tokens,layout}.css`, `packages/ui/src/*`。

**实现顺序**：

1. Electron 透明/自绘标题栏与 macOS traffic lights（使用原生窗口配置；只有经测试的 draggable 区域，按钮加 `no-drag`）。
2. 定义浅色 tokens：Canvas、Sidebar surface、Selected row、User bubble、Bot bubble、Dimmed text、Dividers、Pill 输入框；尽量从用户截图量取而非主观杜撰。 **先制作 `design/grok-kit/SPEC_MAPPING.md` 和来源标注；依据 Kit 的 `docs/visual-system.md`、`docs/component-spec.md` 建立自行实现的 Corn CSS 语义变量；不要直接引入 `assets/styles/index-*.css` 或安装包来源的字体。**
3. `CornShell` 以 `selectedBotId`, `detailsOpen`, `detailsTab`, `sidebarWidth`, `chatScrollState` 组成 UI 状态，不混杂 DSH runtime state。 另外显式区分 `sidebarManualCollapsed`、`sidebarAutoCompact`、`preferredSidebarWidth`、`detailsPreferredWidth`、`layoutReferenceProfile`；响应式规则按主内容宽度计算。
4. 左栏固定区：搜索/新增、Pinned Bot、分组标签、Bot 行、左下连接应用。
5. 中栏：居中标题胶囊、日期 divider、黑/灰消息气泡、Handoff Notice、固定底部 Composer。
6. 右栏：详情/资料库/电脑 Tabs、空状态、可折叠面板；切换后保持 Composer 草稿。
7. 模拟数据用 `fixtures/` 的具名对象，不把 mock fetch 写到正式 Adapter 中。所有可用按钮必须真实改变状态；尚未接通的附件上传/系统听写/实时语音应明确 disabled 或展示“尚未接通”引导，不能模拟外部副作用。
7a. 按 §4.4 定义 Create Bot、Bot Profile、权限、标签、Share、连接应用与模型入口的交互/状态。M1 用 Mock 接口但 UI 状态、禁用/失败行为必须真实可测试。
7b. 按 §13 实现 `packages/ui/src/avatar`：先验证两类动画来源及许可，默认使用 Corn 自主实现的 Motion Renderer；接 Kit **状态/轮廓/节奏契约**，实现 `BotAvatar`、`AvatarRenderer`、`StaticAvatar`、上传图片、RAF/IO/reduced-motion 生命周期；M1 只用命名 fixture，不宣称 DSH 事件已连接。
8. 加 VoiceOver 标签、减少动效支持、输入焦点恢复与 Mac 快捷键。 对照 Kit `docs/ui-ux-spec.md` 的 18 项快捷键清单，逐项标为 `implemented/deferred/not-applicable`，禁止悄然漏项；“推导/未知”项不声称与原版实测一致。
9. `MessageComposer` 对照 Kit 的 `src/composer.js` 行为接口**重新用 TS 编写**；确保 IME、菜单、附件、离线/重发与任务线程 context 被独立建模；Kit 参考代码不是 DSH 后端实现。
10. 新增 `docs/milestones/M1-UI-KIT-COVERAGE.md`，从 Kit 83 项验收清单生成 Corn 自己的进度矩阵，至少 Shell/Composer/Transcript/详情/任务线程/主题/键盘五大组通过后才准合并 PR-02。

**验收**：截图双栏/三栏视觉回归通过；页面能够切换和输入；详情页打开时 Chat 按比例收缩；不会加载 DSH 官方 Web UI。**头像新增验收**：列表和标题都通过同一 `BotAvatar` 契约渲染；6 个演示 Bot 可切换状态，卸载/离屏/减少动效切静态且无 RAF 残留；自定义上传图不被强制替换成形变头像。详见 §13。

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

### M3（P0）：本机 macOS Computer Use + 操作视图

**前置检查（v1.1）**：M2 的 `task_runs`、`run_attempts` 和 `runId` 已真实落库；任何由 Agent 发起的 Computer Action 必须属于已有 Run，后台非对话动作先原子创建 Run，不能用任意临时字符串填充租约。

**新增/修改**：

- `plugins/dsh-corn-tools/src/control-lease.ts`（实际插件目录按 M0 需要），`plugins/dsh-corn-bridge/src/routes/computer.ts`
- `packages/contracts/src/computer.ts`
- `apps/renderer/src/features/computer/{ComputerPreview,ComputerTakeover,ControlLeaseBanner}.tsx`
- `apps/renderer/src/features/details/configuration/PermissionsSection.tsx`（本机操作入口，§16）；画面/暂停/接管在 `features/computer/*` 的独立视图，不恢复“电脑”主 Tab
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
| PR-02 | Corn UI Shell、Kit 双来源 profile、双栏/三栏 Mock + Avatar Motion 的 M1 完整组件；产出 83 项 UI/UX 覆盖矩阵及 avatar 附加测试 | 固定 viewport 分区截图 + Playwright 差异 + 847/848/849 内容宽/IME/语音/审批 state fixtures + Avatar lifecycle/shape/state 测试 |
| PR-03 | Session Adapter + Registry 事务 **+ M2 SQLite 最小 Schema + Run ID** | 真实创建/发消息/断线恢复/部分成功 E2E、数据库迁移和 Kill/Restart |
| PR-04 | CUA Provider 试验 + 安全门禁 | 真机权限/窗口/输入/独占锁证据 |
| PR-05 | 本机操作入口、独立预览、人工接管（§16） | User takeover E2E |
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
| `apps/renderer/src/styles/layout.css` | 开关详情通过 CSS Grid 追加/移除第 3 列，不改左列宽和滚动容器；中列 `minmax(0,1fr)` | 1024×764 三栏布局各列宽断言（`layout-probe.ts`） |
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
| 本机操作入口 | `features/details/configuration/PermissionsSection.tsx` → `features/computer/*` | §16：配置→权限，或从活动 Run 打开操作视图；查授权→请求画面→Takeover 独占；沿用 M3 租约与 Gate | 授权撤销、并发控制 |
| 左下连接应用 | `features/settings/AppConnectionsPage.tsx` | M1 只列真实连接状态；M7 接 DSH MCP/Skills 管理 | 断开、刷新、权限边界 |

### 11.4 修订执行指令（直接交给总 Coding Agent）

> 请以此 v1.3 文档为准继续 M0–M8，不要从头重构架构。M0 先完成真实 Host 连接和 SQLite 驱动/打包选择的 ADR 验证。M1 高保真三栏右侧详情栏按整个窗口宽度 37% 标定，并完成所有可见按钮的状态和行为规格（未接通者明确禁用）。M2 必须实现实际 SQLite Schema、Bot/Conversation/Binding/Run 持久化、基础状态机、标签、UI 状态与重启恢复。M3 使用 M2 的真实 runId 构造 `DesktopControlLease`，不允许空 Run 或临时 ID。M4 只完善崩溃对账和长任务恢复，禁止把初始数据库推迟至 M4。模型、主会话、语音采用 §4.4 的默认策略。每一项修改必须给出具体 diff、测试日志、真实版/Mock 能力区分和后续风险；不允许只改文档而跳过代码落地。

---

## 12. v1.2 UI/UX Kit 接入专项补丁（M0/M1/M2/M8 必须执行）

> 本节为 2026-10-11 新增的**可执行文件级任务**，对 §4.1 初期推测值、M1 视觉标定、PR-02 UI 范围进行有条件细化。**不改动 DSH 运行/鉴权、Claw Suite 权限、M2 SQLite/Run 和 M3 ComputerLease 的原有强制顺序。**
>
> 研究仓库：[`xingyingyuzhui/grok-bot-ui-ux-kit`](https://github.com/xingyingyuzhui/grok-bot-ui-ux-kit)；固定提交 `0248419b80dde84560409802afb98f38803df52c`；研究产品：Grok Bot 0.68.1 静态安装包与 2026-10-11 官网演示观察（**不同来源**）。

### 12.1 资料可信度及优先级（必须带入实现和测试）

| 来源 | 适用场景 | 可以证明 | 不能证明 |
|---|---|---|---|
| 用户双栏/三栏截图 | 指定目标默认浅色产品场景 | 像素布局、面板比率、文字与组件位置 | 其他窗口宽度和隐藏操作完整流程 |
| Kit `docs/website-comparison.md` + `examples/product.*` | 官网页面演示风格参考 | 官网观察时点的布局和参考页实际可运行 | 0.68.1 原版所有页面均长这样 |
| Kit `docs/ui-ux-spec.md` / `visual-system.md` / `component-spec.md` | 0.68.1 静态样式与状态机 | 可定位的原包 CSS / JS 静态分支与数学公式 | 未经运行观察的完整 UX / 服务端真实结果 |
| Kit `examples/workbench.*` / `src/*` | Demo fixture、主题/输入适配器参考 | 参考实现存在这些模拟操作与状态 | 原生真实 Agent、附件上传、语音/Computer 后端 |
| Kit `docs/capture-plan.md` | 进一步证据采集 | 仍需实测的列表与场景 | 尚未执行的观察不能写成已验证 |

**默认设计 profile 策略**：`user-screenshots` 为首版正式 UI 的目标视觉 profile，按照两张截图标定左右分割比例（约 27% 和 37% 总窗右栏）；`dmg-0681` 为静态行为/边界测试 profile；`website-demo` 为官网视觉对照 profile。**不要为三个 profile 各写一套业务应用**：业务状态和组件相同，设计 token/布局 preset 与 fixture 切换即可。最初只允许 `user-screenshots` 是面向用户发布的默认 profile，其他 profile 仅用于开发验收，除非经批准。

### 12.2 Kit 研究引用方式（只读、pin、不得错误授权）

1. **M0**：创建 `design/grok-kit/SOURCE_LOCK.md`，记录仓库 URL、上述完整 commit、被使用的每一份文档路径、SHA（可选）、观察日期、`未运行原应用` 标识。开发者通过 `git clone` + `git checkout 0248419b80dde84560409802afb98f38803df52c` 在本地**设计研究目录**只读访问（例如 `.research/grok-bot-ui-ux-kit`，并在 `.gitignore` 排除），不要将研究库 `reference/`、`assets/`、`evidence/` 当作 Corn 发布依赖。
2. **M0**：新增 `design/grok-kit/RIGHTS_REVIEW.md`，按文件与类型分类：自己写的示例 JS/CSS（需确认授权）、测量事实/思路（允许借鉴）、来自 DMG 的原 bundle/图标字体/图片/音频/主题原表达式（没有充分权利证明前禁止拷贝入 Corn 产品）、来自官网的头像/logo/网页样式（同样不得擅自再分发）。Corn 自主画头像或保留用户明确授权提供的自定义图片。**没有 license 文件不能推定 MIT。**
3. **M0**：`scripts/verify-ui-kit-reference.mjs` 读取 SOURCE_LOCK，验证 kit 提交是否匹配 pin，`docs/integration.md`、`docs/ui-ux-spec.md`、`docs/replication-checklist.md`、`docs/website-comparison.md` 这些研究文件存在且能检索；若 clone 不存在，CI 应用受控 checkout 或跳过研究库比对并**保留明确诊断**，不能静默当通过。
4. **M8 发布门禁**：`scripts/audit-ui-assets.mjs` 列举最终 `.app`/asar 所有资源；拒绝打包 `reference/renderer/**`、`assets/fonts/cursor-icons-*.woff2`、`assets/fonts/X-VF-*`、未经确认授权的原图像/声音、未经独立许可审计的原版 CSS 或 JS。生成 `THIRD_PARTY_NOTICES.md`；若研究资产的许可不明确，发布流程停止并请求明确授权或者使用自行实现替代品。

### 12.3 M1 文件级 UI 实施映射

| Kit 依据 | Corn 目标文件（新增或修改） | 代码任务 | 测试 |
|---|---|---|---|
| `docs/website-comparison.md`, 用户截图 | `apps/renderer/src/app/CornShell.tsx`; `src/styles/layout.css` | 确立 `user-screenshots` 双栏/三栏金标；通过 layout preset 而非随意 CSS media query 切换 | `visual/roster-two-pane`, `details-three-pane` |
| `docs/ui-ux-spec.md` §2 | `apps/renderer/src/app/layout-reference.ts`; `src/features/roster/BotRoster.tsx`; `src/styles/layout.css` | `sidebarExpandedWidth`, `manualCollapsed`, `autoCompact`, `detailsWidth` 分离；`dmg-0681` 下 expanded=280、范围240–400、collapsed=88，主区最小424，详情默认320/最小280；resize+pointer cleanup | `visual/kit-layout-profiles.spec.ts` |
| `docs/ui-ux-spec.md` §2.2 | `apps/renderer/src/features/chat/TaskThreadPane.tsx`; `src/features/chat/useTaskThreadLayout.ts` | 以 `ResizeObserver` 测**主内容宽**；≥848px 且 opt-in 时并排；公式 `min(max(424,p), max(A/2,A-424))`；线程输入携带 taskId | `visual/kit-thread-resize.spec.ts` |
| `docs/visual-system.md`; `component-spec.md` | `apps/renderer/src/styles/tokens.css`, `global.css`; `packages/ui/src/{Surface,Pill}.tsx` | 依据观察值自主实现浅/深语义 token、系统字体/字号、气泡18px、按钮尺寸、焦点/减少动效；别把 Kit `assets/styles/index-*.css` 全局引入 | `visual/kit-theme.spec.ts` |
| `src/composer.js`; `docs/integration.md` | `apps/renderer/src/features/chat/MessageComposer.tsx`; `src/features/chat/composer-actions.ts` | 自主 TypeScript 复写 Enter/Shift+Enter/IME、菜单拦截、附件-only、草稿快照、失败保留、发送与语音状态切换；附件上限6；避免按钮暗示原版后端已实现 | `visual/kit-composer-ime.spec.ts` |
| `docs/ui-ux-spec.md` §3/5 | `apps/renderer/src/features/chat/{MessageFeed,ApprovalCard,HandoffNotice,RunReceiptCard}.tsx` | 明确 queued/dispatching/accepted/failed；审批 pending/submitting/approved/denied/expired；主消息与任务线程上下文分离 | `visual/kit-ui-states.spec.ts` |
| `docs/ui-ux-spec.md` §1/3 | `apps/renderer/src/features/details/BotDetailsPane.tsx`; `features/settings/*` | bot tabs overview/media/computer 与 group tabs overview/media/members 区分；对象切换校验 tab；设置 pending/failure 不用假成功 | `visual/kit-details-tabs.spec.ts` |
| `docs/ui-ux-spec.md` §4 | `apps/renderer/src/features/voice/{DictationButton,VoiceModeButton}.tsx`; `apps/renderer/tests/fixtures/kit-voice-states.ts` | activating/recording/processing/stop-in-flight/error fixture 与 UI；M1 未接麦克风时 disabled 与说明，真实 STT 仍是 M7 | `visual/kit-voice-states.spec.ts` |
| `docs/ui-ux-spec.md` 快捷键小节 | `apps/renderer/src/shared/hooks/useCornKeyboardShortcuts.ts`; `src/shared/accessibility/*` | 将 18 项梳理到 `design/grok-kit/INTERACTION_COVERAGE.md`，处理冲突、平台快捷键、焦点与 IME | `visual/keyboard-accessibility.spec.ts` |
| `docs/replication-checklist.md` | `design/grok-kit/INTERACTION_COVERAGE.md`; `docs/milestones/M1-UI-KIT-COVERAGE.md` | 逐项记录 83 条的 `covered / deferred / not-applicable / unknown`、Corn 文件、fixture、测试证据；不得把清单本身当作已测试 | PR-02 门禁审查 |

**目录约定**：表中 `src/` 省略路径时指向 `apps/renderer/src/`；`packages/ui` 是 Corn 自主实现的可复用组件包，不是原厂 component bundle 的重命名。禁止直接运行 `reference/renderer` 作为 Corn 前端，也禁止复制原 Electron preload 并注入 `window.desktop`、`coordinatorPort` 伪造原版宿主。

### 12.4 明确的事件状态与 UX 验收（M1 + M2）

- **输入**：Enter 发送，Shift+Enter 换行，`isComposing`/IME 不提交，菜单占用 Enter/Tab/Escape 时不冒泡发送；纯附件消息允许提交；主 Composer 6 个附件限制，超限反馈可恢复；失败时保留完整草稿和 staging，不自动重复调用 DSH。M1 由 fixture 驱动，M2 使用真正 `session.prompt` 与持久回执。
- **异步消息**：区分 UI 本地待发送、DSH 接收入队、持久消息回显、Agent Run 完成；`session.prompt.accepted` 不是 `run.completed`，重连时以稳定 requestId/event seq 消除重复展示；无法连接不隐藏失败。
- **任务线程**：`taskId` 是必传上下文；线程消息绝不可误发到主 Conversation；在主内容宽 847px 为覆盖，848/849px 在 opt-in 且无排斥条件时允许并排；主内容宽与窗口宽不是同一个度量。
- **详情**：切 Bot 与切 Group 需要依据对象类型修正 tabs；关闭详情恢复聊天可见宽与位置；侧栏的手动折叠偏好不被自动紧凑写坏。
- **语音**：录音状态只是 UI fixture，不暗示系统已授权或收音成功；灰色 mic 和黑色 waveform 按照 §4.4 产品既定决策，真正系统操作等到 M7/M8 后独立规划。
- **审批/Computer**：所有审批调用 Claw Gate 的真实授权服务；`approveOnce`、`deny`、`alwaysAllow`（受硬策略上限）和 expired 必须显示结算结果，Computer Preview 无实时流时写明静态预览，不能伪造直播或用户接管成功。

### 12.5 PR 切分及合入门槛

| PR | 依赖 | 必须提交的可检查成果 | 不得做的事 |
|---|---|---|---|
| PR-00D：Kit 来源与尺寸 ADR | M0 | `SOURCE_LOCK.md`、`RIGHTS_REVIEW.md`、`SPEC_MAPPING.md` 初稿、设计 profile 选择 ADR（`ADR-0004-design-profiles.md`）、`verify-ui-kit-reference.mjs` | 引入原 bundle、把无许可材料放进应用资源 |
| PR-02A：布局/视觉 token | PR-00D | 用户截图金标布局 + `dmg-0681` 行为 profile + Corn 自主绘制 token/icon、分区截图 | 直接把 280px 覆盖 380px 截图金标；复制原版全量 CSS |
| PR-02B：组件与交互 | PR-02A | Composer、详情 tab、审批卡、任务线程、Voice mock 全状态与 83 项矩阵 | 假定模版 demo 等于真实完成 |
| PR-02C：视觉/UX 门禁 | PR-02B | Playwright 区域截图、847/848/849 内容宽测试、IME 与失败回退测试、分支证据报告 | 只提交“看起来一致”而无可复现的测试 |
| PR-03：连接真实 DSH | PR-02C 且 M0 Host Spike PASS | `dsh-adapter`、Registry Binding + M2 SQLite/Run、实时状态回显，UI Card 映射到真实事件 | UI 直接写 Claw 文件、读取 DSH 私有内存、绕开 Gate |
| Release 审核 | M8 | 实际 `.app` 资源审计、第三方告知、源码许可/依赖审计 | 将 Kit 原始资产当成 MIT 代码直接分发 |

### 12.6 给执行 Agent 的补充指令（v1.2 基线，SHA 已更新）

> 从 M0 开始，除本计划 v1.1 既有 DSH Host/Claw Gate/SQLite/Run 安全基线外，请先审读 `xingyingyuzhui/grok-bot-ui-ux-kit` 固定提交 `0248419b80dde84560409802afb98f38803df52c` 的 `AGENTS.md`、`docs/website-comparison.md`、`docs/integration.md`、`docs/visual-system.md`、`docs/component-spec.md`、`docs/ui-ux-spec.md`、`docs/replication-checklist.md`、`docs/provenance.md` 和 `NOTICE.md`。用 `SOURCE_LOCK.md` 锁定来源，按 `SPEC_MAPPING.md` 逐文件实现独立 Corn React/TS 组件，83 项逐条归档验证状态，用户双栏/三栏截图仍是默认视觉金标，0.68.1 与官网 demo 只作为不同来源的行为/设计参照。不得移植缺少独立授权的原 renderer、preload、字体、图标、图片或音频。按 PR-00D、PR-02A/B/C、PR-03 顺序实施，提供 screenshot diff、状态测试、许可审查与实际 DSH Agent 验证。尚未实现的后端能力要标注 Mock/disabled，不得以静态参考交互声称功能已跑通。



---

## 13. v1.3 动态头像专项增量计划（M0/M1/M2/M8：必须执行）

> **变更来源：** `xingyingyuzhui/grok-bot-ui-ux-kit` 最新提交 [`0248419b80dde84560409802afb98f38803df52c`](https://github.com/xingyingyuzhui/grok-bot-ui-ux-kit/commit/0248419b80dde84560409802afb98f38803df52c)，相对 v1.2 来源 `c51253833ca89e14cb3630832efe3a612d2afb3f` 新增 1 个提交，45 个文件变化（`git diff --stat` 核对）。研究代码由 GitHub 仓库源码审查确认；**没有在 Corn 的 macOS + DSH 环境运行，也未证明与原 App 所有实际行为一致。**
>
> **原计划保持不变：** M0 的 DSH Host/Claw Gate Spike、M1 主布局 UI 金标、M2 SQLite + Run、M3 本机操作租约、M4+ 调度与发布边界全部保留；新增 Avatar Motion 垂直模块，**不要独立重造一个头像后端服务**。

### 13.1 新 Kit 提供的确定事实（不要混淆来源）

| 来源 | 状态/轮廓 | 主要能力 | 边界 |
|---|---|---|---|
| 官网 2026-10-11 的 React 动画子集 | **35 个状态、25 个轮廓** | SVG 路径连续变化、眼睛/眨眼、形变、转身/弹跳/庆祝粒子；`mountAvatar` + `setState` / `setShape` / `setPaused` / `spin` / `bounce` / `burst` / `snapshot` / `destroy` | 原官网版本号未知；不能把这一组枚举当成 DMG 枚举；原实现未经独立再许可 |
| DMG 0.68.1 数学动画引擎 | **53 个状态** | `createMotion`、`createBehavior`、`renderMotionSVG`、`updateSVG`；compact clips、独立形变/表情/姿态控制 | 不等于官网组件的同一算法；`failed`/`finished`/`waiting`/`streaming` 等状态不能直接传入官网 API |
| Kit 工作台和主预览 | 6 个示例 Bot 动态头像 | 产品预览已接入动画，带画廊、暂停和 reduced-motion/不可见时静态回退 | preview 的业务状态映射是 Kit 的示例选择，不代表 DSH 事件或 Grok Bot 后端真实规则 |

**必须阅读的新增研究文件：**
- `docs/avatar-animation.md`（接入与映射、两套来源差异、引擎生命周期）
- `src/avatar.js`, `src/avatar.d.ts`, `src/avatar.css`（官网适配器的状态与接口说明）
- `assets/avatar-motion/catalog.json`（状态、形状、动画节奏、静态证据）
- `docs/avatar-motion-validation.json`, `tests/avatar.test.js`（独立子集的测试边界）
- `examples/avatar-motion.{html,css,js}`（可交互参考，用于视觉/状态枚举的研究）
- `NOTICE.md`, `docs/provenance.md`（权利归属、静态提取与验证限制）

**具体观察值：** 官网 `idle` 眨眼 6–14 秒、表情 9–16 秒，`listening` 眨眼 3–7 秒，`working` 眨眼 2.8–5.5 秒；`thinking` 使用 dots，`dictating` wave，`sending` send，`receiving` receive，`writing` pencil，`alerting` bang。默认官网形态包含 `blob`、`wedge`、`gem` 等；`seed` 可控制随机节奏。以上只能作为研究/视觉行为参照，具体 Corn 自主实现以自己的动画时序契约与测试为准。

### 13.2 M0 增量任务：更新 SOURCE_LOCK 与授权门禁（PR-00E）

**新增/修改文件：**

| 文件 | 需要完成的工作 |
|---|---|
| `design/grok-kit/SOURCE_LOCK.md` | 将 Kit SHA 固定为 `0248419...`，记录旧 SHA、比较链接、官网与 DMG 不同来源、研究文件清单与日期；避免未来 clone main 造成不可复现 |
| `design/grok-kit/AVATAR_SOURCE_MATRIX.md` | 对官网 35/25 与 DMG 53 建两张独立表，写每种 state 的来源、是否适用 Corn、未知项、是否有授权 |
| `design/grok-kit/RIGHTS_REVIEW.md` | 为 `src/website-avatar*.generated.js`、`src/avatar-engine.generated.js`、`src/avatar.js`、`dist/avatar.js`、`reference/website/motion/*`、提取的几何/静态素材设置逐文件来源、是否第三方受保护实现、产品允许的用途 |
| `design/grok-kit/AVATAR_BEHAVIOR_MAPPING.md` | 写 Corn 自主业务状态 → 官网状态的映射与置信度，明确不是官方服务端协议 |
| `scripts/verify-ui-kit-reference.mjs` | 增加对 avatar-animation docs/types/catalog/tests 的路径、commit 验证；严格区分 research-only 与允许打包的文件 |
| `docs/adr/ADR-0003-avatar-engine.md` | 在 `research-only`、`corn-original`、`licensed-component` 三个选项中确定发布默认；默认 `corn-original`，批准明确再分发许可后才可切换 |

**授权强约束：** Kit 新 `NOTICE.md` 明确说明 `src/*avatar*.generated.js` 含官网/安装包恢复的第三方代码，不因 GitHub 公开而取得 MIT 等许可，`dist/avatar.js` 也包含同样来源。`dist/avatar.js.LEGAL.txt` 的存在只表示依赖许可声明，并不是 Grok Bot 源代码的再分发授权。Corn **默认不得把以上提取 JS、原几何路径、原图标/字体或从官网抓取的资产作为产品构建依赖或嵌入最终 `.app`**。对于本地研究，Kit 工作台可在隔离目录跑；正式 Corn 要采用自己创作、权利明确的视觉资产与渲染代码。获得明确授权后才可选择原动画组件，且必须完成依赖/React 版本/打包审计。

M0 交付证据：锁定 SHA 的 GitHub 差异记录、Kit `npm ci && npm run build && npm run check` 的独立参考环境结果（如在执行机未运行，标记未验证）、授权矩阵与 ADR；不把参考子集运行成功等同于 Corn macOS E2E 成功。

### 13.3 定义 Corn 自有的 Avatar Domain Contract（M1）

**新建 `packages/contracts/src/avatar.ts`**，由视图、状态投影、事件适配共享，禁止在此 import React、DSH Runtime 或 Kit 的原代码：

```ts
export type CornAvatarShape =
  | 'cob' | 'baby-cob' | 'round-cob' | 'tall-cob' | 'kernel'
  | 'twin-kernel' | 'husk-bud' | 'husk-fan' | 'popcorn' // §15 锁定的 Corn 原创轮廓；待 PR-02D 接入契约

export type AvatarVisualState =
  | 'idle' | 'sleeping' | 'waking' | 'listening' | 'thinking'
  | 'searching' | 'working' | 'dictating' | 'writing' | 'sending'
  | 'receiving' | 'uploading' | 'alerting' | 'confused'
  | 'happy' | 'celebrate' | 'progress' | 'powering-down'

export interface AvatarPreference {
  kind: 'uploaded' | 'generated' | 'default'
  variantId?: string       // §15：Corn 角色目录校验；未知/旧记录回退首字与色相占位
  assetId?: string          // 仅用户有权使用的图片
  color?: string            // Corn 自有语义配色
  motion?: { shape: CornAvatarShape; seed: number; enabled: boolean }
}

export interface AvatarRuntimeSignals {
  botId: string
  activeRunCount: number
  phase: 'idle' | 'thinking' | 'searching' | 'tool' | 'sending'
       | 'waiting_approval' | 'waiting_resource' | 'failed' | 'completed'
  voice: 'none' | 'listening' | 'dictating'
  message: 'none' | 'inbound' | 'outbound'
  updatedAt: number
}

export interface AvatarPresentation {
  visual: AvatarVisualState
  animated: boolean
  tone: 'neutral' | 'attention' | 'error' | 'success'
  transientUntil?: number
}
```

- `AvatarVisualState` 是 Corn 精简业务展示枚举，不是全部官网 35 状态。`CornAvatarShape` 初期 9 个可自行实现的轮廓，不可因为 Kit 有 25 个就强行复制原几何数据。研发验收应分成 **研究参考 35/25 可访问** 与 **Corn v1 已获权且实际实现的 shape/state 子集**，分别报告覆盖，不得将二者混为一谈。
- `CornBot.avatar` 将 `motion` 加在现有 `uploaded|generated|default` 偏好中，不能给 `uploaded` 强套变形。自定义人物头像展示原图，只在可获权情况下加外部状态环/提示；仍支持列表和标题两个尺寸。
- 持久化只保存用户的 avatar 偏好：`variantId`, `shape`, `seed`, `enabled`, `color`, `assetId`。实时业务 `AvatarRuntimeSignals` 和当前 `visual` 由事件投影/恢复计算；不要每次眨眼或动画帧写 SQLite。

### 13.4 UI Kit 模块：按文件拆分，禁止巨型 Avatar.tsx（M1 / PR-02D）

| Corn 文件 | 代码职责 | 需要的验证 |
|---|---|---|
| `packages/ui/src/avatar/BotAvatar.tsx` | 统一公开组件：`botId`, `avatar`, `presentation`, `size`, `decorative`；列表/标题/详情共用 | 不同容器尺寸、同一 Bot 颜色/形状一致、ARIA 可访问 |
| `packages/ui/src/avatar/AvatarRenderer.tsx` | `uploaded`、`motion`、`static` 三种渲染器选择，依据 preference、权限/功能开关及环境 | 上传图保留原貌；动画不可用时不崩溃 |
| `packages/ui/src/avatar/CornMotionAvatar.tsx` | 只实现 Corn 自己的 SVG/Canvas 动画；从可审计的 geometry/primitive 自主设计表情、眨眼、姿态及形变 | 固定 seed/时间的连续帧有限值、至少 idle/thinking/working/alerting |
| `packages/ui/src/avatar/UploadedAvatar.tsx` | 用户头像及 fallback 图；解码失败/没有图片时回退 | 错误路径、预览及裁切尺寸 |
| `packages/ui/src/avatar/StaticAvatar.tsx` | 静态姿态，作为低功耗与无障碍回退；不加载动画运行时 | reduced-motion 下不创建 RAF |
| `packages/ui/src/avatar/motion-presets.ts` | `CornAvatarShape` 几何与表情参数，保持来源清楚；禁直接粘原抓取的 SVG path 数据 | 轮廓有限、无 NaN/Infinity、样式 token 来源清楚 |
| `packages/ui/src/avatar/motion-scheduler.ts` | 统一每实例更新节拍、封顶 delta、schedule/cancel RAF；不依赖 DSH | 高压切换不泄露 RAF，组件消失即停 |
| `packages/ui/src/avatar/useAvatarLifecycle.ts` | `IntersectionObserver`/visibility/reduced-motion/卸载统一暂停回退；`setState` 不应导致 mount 动画运行时重建 | StrictMode 双挂载与 unmount 后事件清理 |
| `packages/state/src/avatar-presentation.ts` | pure function: `AvatarRuntimeSignals -> AvatarPresentation`，明确优先级/稳定态/临时态计时 | table tests、假时钟、冲突优先级 |
| `packages/state/src/avatar-state-reducer.ts` | 在 M2 把 DSH `session.follow` 和 Claw Task/Approval 事件投影为 `AvatarRuntimeSignals` | 真正 DSH 事件 fixture、重连恢复/乱序/过期 Run 去重 |

`packages/ui/src/Avatar.tsx` 只作为旧使用点适配器，逐步替换为 `BotAvatar`；不要在 `BotListItem`、`PinnedBotCard`、`ChatHeader` 中各自实现一个不同头像动画。`CornMotionAvatar` 不负责 DSH 订阅、Registry 查询、Run 状态或 SQLite 访问。

**Kit 接口的研究映射**：`mountAvatar` → Corn `BotAvatar` 组件生命周期；`setState` → props 更新；`setShape` → 用户偏好更新；`setPaused` → motion policy；`spin/bounce/burst` → 经过用户偏好/减少动效保护的短暂反馈；`snapshot` → 视觉快照测试工具；`destroy` → effect cleanup。这里只**映射行为，不直接引用 Kit 恢复出的实现**。允许 renderer 后续以合法授权的原组件作为可选替换，但 API 应保持稳定。

### 13.5 动画状态优先级和 DSH 事件接线（M1 fixture，M2 真实流）

在 `design/grok-kit/AVATAR_BEHAVIOR_MAPPING.md` 固定下表，逐条写测试。**以下为 Corn 产品自行定义的映射，不是原版 Grok Bot 已验证的后端业务协议**。

| Corn 运行/事件来源 | Corn 视觉状态 | 原因与限制 |
|---|---|---|
| Claw Gate 产生待审批请求 | `alerting` | 高优先级，持续到审批结算；不要用临时 `working` 覆盖 |
| Run failed / tool error | `confused` + error tone | 错误保留在真正的 Run/Task 卡片，头像不能替代故障提示 |
| Voice 正在听写 | `dictating` | 音频状态与模型工具状态独立，关闭语音后恢复相应状态 |
| 用户语音通话监听（未来阶段） | `listening` | 首版真实 Voice Call 尚未实现，M1 fixture 可显示但不可声称可用 |
| DSH Agent 模型推理 | `thinking` | 来源于真实 agent/status 或 Stream 控制投影，不能以 UI 请求 pending 猜测 |
| DSH 浏览器查询或搜索 | `searching` | 工具元数据可判别时使用，否则 `working` |
| 受管 Tool 正在执行 / Run running | `working` | 多 Bot 同时工作，各自投影，禁止把全局状态共享给所有 Bot |
| Bot 发送/接收异步消息 | `sending`/`receiving` | 事件应绑定 Bot ID；短状态后回到当前真实 Run 状态 |
| 产生上传动作 | `uploading` | 区分 UI 暂存文件/真实上传事件 |
| Run completed | `happy` 或短暂 `celebrate` | transient 动画结束回 `idle` 或仍在执行的其他 Run 状态 |
| 无活动 Run/消息/审批 | `idle` | idle 偶发眨眼/微动，非固定循环摆动 |
| UI/Session 断线 | 上次可靠状态+明确离线标识 | 不应将“离线”映射成假 idle 或假成功 |

**优先级约定**：审批阻塞 > Run 失败/异常 > 活跃语音 > 当前会话交互（推理/工具） > 消息收发 > 暂态完成 > Idle；同一 Bot 多个 Run 时按明确 `foregroundRunId` 与 aggregate 状态裁定，事件必须带 `botId`/`runId`/单调序号，过期事件不得反向覆盖新状态。短态使用统一 presentation TTL（具体时长作为 Corn 配置并做假时钟测试），稳定态不因每次消息 chunk 重播庆祝动画。

**M2 接线规则**：

1. `packages/dsh-adapter/src/session-event-reducer.ts` 继续负责官方 session durable event、assistant-stream 与控制投影；新增 `packages/state/src/avatar-state-reducer.ts` 消费经过 Schema 验证的领域事件，而不是解析 Markdown 内容或读取 DOM 文本。对于单次 Run，要在 Run 记录真实建立后才能关联 `runId`。
2. 当 `session.prompt` 返回 accepted 时，仅标为消息已入队；**不得在这一步直接设置 `done/celebrate`**。只有真实 Turn/Run 完成事实可以触发完成态。
3. Claw Gate 的 approval pending/settled、tool starts/ends 与 Messenger 消息需明确接入点；官方未暴露的事件必须记录缺口并降级到 `working` 或状态未知提示，不可伪造。
4. 浏览器或 Mac Computer 工具属于具体 Bot/Run；切换当前查看的 Bot 不改变其他 Bot 的动画状态，任务后台运行与窗口隐藏不冲突。
5. DSH Host 崩溃、断线和冷启动以持久状态对账为准；不能因 UI 重新挂载就将 `running` 保存成 `completed`。Avatar 本身无权主动执行补偿操作。

### 13.6 性能、可访问性和视觉回归（M1/M2）

**渲染与调度**：列表虚拟化或 IntersectionObserver 阻止不可见头像持续渲染；`document.hidden`、macOS 窗口不可见、`prefers-reduced-motion`、设置项 `animatedAvatars=false` 时使用 `StaticAvatar`。监听器与 RAF 在 `unmount`、React StrictMode、组件频繁复用、Bot 切换时清理。每个 Bot 的 seed 由固定配置/稳定 ID 派生，不能每 render 调用 `Math.random()`。帧调度采用 `dt` 封顶，隐藏超过阈值恢复时重置时间相位，不追赶大量积压帧。

**新增测试文件与 fixture：**

- `apps/renderer/tests/fixtures/kit-avatar-states.ts`：6 个示例 Bot，显式 `botId/shape/color/state/seed`；涵盖 idle/thinking/working/alerting/failed、两种主题、上传图；任何 Kit 素材只当研究图，fixture 的发布资源自行创作。
- `packages/ui/tests/avatar/avatar-contract.test.ts`：未知 state/shape 走显式安全回退或强类型拒绝，不能按两套来源混传字符串；Bot 稳定 seed、颜色、大小与上传图保真。
- `packages/ui/tests/avatar/avatar-shapes.test.tsx`：自主实现的轮廓和表情几何完整，SVG 元素 id 唯一，无 NaN/Infinity。
- `packages/ui/tests/avatar/avatar-lifecycle.test.tsx`：模拟 `IntersectionObserver`、`visibilitychange`、媒体查询切换、StrictMode unmount；检查 RAF 创建/取消数与 DOM observer 清理。
- `packages/state/tests/avatar-presentation.test.ts`：优先级表、审批冲突、消息短态 TTL、同 Bot 多 Run、事件乱序/去重、断线未知态。
- `apps/renderer/tests/visual/avatar-motion-states.spec.ts`：受控虚拟时钟/固定 seed 采集单帧和短时间序列，截取单独头像区域，固定 viewport、DPR、系统字体；不拿随机动效整页截图做 gate。
- `apps/renderer/tests/visual/avatar-motion-load.spec.ts`：滚动 20+ Bot、Tab 来回切换及设置减少动效，记录帧耗时/内存趋势、是否存在离屏 RAF/observer 泄露，基线按目标 Mac 实测冻结，不随意声称“已达 60 FPS”。
- `apps/renderer/tests/visual/avatar-motion-lifecycle.spec.ts`：关闭详情/侧栏、Mac 窗口切后台、销毁 root 后不发生无主 UI 更新；`motion=false` 时头像仍显示。

**UI 验收顺序**：先锁定 **静态帧**（复刻截图的布局、尺寸、头像颜色/轮廓与文字对齐），再进行 **状态行为**（run/审批/语音），最后进行 **动态时序和压力测试**。上传用户头像可保持静态，不应为了风格一致强制动画化。

**无障碍**：头像默认 `aria-hidden=true`，Bot 名称以真实文本表达；状态必须在邻近文本或 ARIA live region 有描述（并节流），不依赖仅动画表情。尊重 `prefers-reduced-motion`，没有动画不影响收发消息/审批功能。

### 13.7 PR 增量切分与强制验收

| PR | 时机 | 必须实现的文件/成果 | 阻断条件 |
|---|---|---|---|
| **PR-00E** Avatar 来源/许可/契约 ADR | M0，PR-00D 后 | `SOURCE_LOCK` 更新、`AVATAR_SOURCE_MATRIX.md`、`AVATAR_BEHAVIOR_MAPPING.md`、`ADR-0003-avatar-engine.md`、`RIGHTS_REVIEW`、Kit SHA 校验 | 原组件/提取素材无许可却进入 Corn 构建依赖；混淆官网与 DMG 状态 |
| **PR-02D** Corn 原创头像与 App 图标 | M1，PR-02A 后，可与 02B/02C 有序衔接 | §15 素材锁定；02D-1 静态头像、统一组件、macOS 图标生成/打包；02D-2 动画、fixtures、unit/visual/lifecycle/load tests；列表、标题、详情等使用点统一 | 把独立素材包测试当 App 接入通过；图标未进入新 `.app`；离屏耗 CPU；减少动效无效 |
| **PR-03A** DSH 状态接线 | M2，PR-03 内独立提交 | `state/src/avatar-{presentation,state-reducer}.ts`、Session/Run/Gate 映射、回归事件测试 | 把 enqueue 当完成；Bot 之间状态串线；断线误报成功 |
| **PR-09A** Avatar 发布检查 | M8，PR-09 前 | `scripts/audit-ui-assets.mjs` 补充排除提取代码、版权审计记录、`.app` asar 清单 | 未经明确许可打包原官网组件/DMG 生成脚本/原路径/第三方音频或字体 |

**最终合并门槛**：PR-02D 只证明 UI 引擎在 mock/fixture 中真实动画可用；PR-03A 必须证明由真实 DSH/Claw 事件驱动的状态切换；PR-09A 必须证明可发布资产来源合规。Kit 原测试不能代替 Corn 的独立测试。

### 13.8 交给 Coding Agent 的最终补充指令（v1.3）

> 在继续执行 Corn Bot 计划前，固定 `grok-bot-ui-ux-kit` 到 `0248419b80dde84560409802afb98f38803df52c`（以前的 `c5125383` 已过时），阅读 `docs/avatar-animation.md`、`src/avatar.d.ts`、`src/avatar.js`、`assets/avatar-motion/catalog.json`、`NOTICE.md`、`tests/avatar.test.js`。保留官网 35 状态/25 轮廓与 DMG 53 状态的**来源隔离**，优先把动画**业务契约和行为规范**移植为 Corn 自有代码。先完成 PR-00E 授权/架构 ADR，再做 PR-02D：在 React 中实现独立 `BotAvatar`/Renderer/静态回退/上传图/动画生命周期，并通过可控 seed/时间、离屏暂停、reduced-motion、StrictMode 清理、视觉比较。M1 可以用 fixture；M2 必须通过真实 DSH Session/Run/Claw Gate 状态驱动，禁止伪造“agent 正在思考”或“任务已完成”。不得将 Kit 恢复出的 `src/website-avatar*.generated.js`、`src/avatar-engine.generated.js`、`dist/avatar.js` 或相关原始资源未经独立授权直接打包进 Corn。完成后提交按文件列出的 diff、测试日志、Mac 截图/短录像、性能数据、授权审计结果、剩余差异清单。旧的 M0 主线、M2 SQLite/Run、M3 ComputerLease 顺序不变。

---

## 14. 维护者实施决策（2026-10-11，覆盖正文冲突处）

> 本节由仓库维护者在 v1.3 交接后确认。与 §0–§13 冲突时以本节为准；未提及部分保持 v1.3 原文。

| # | 议题 | 决策 | 影响位置 |
|---|---|---|---|
| 1 | 通信方案 | 正式采用 B（Electron Main 受信 Bridge），§1.4 首选 A 不再推进，除非 B 未通过必需检查。`plugins/dsh-corn-bridge` 推迟，仅在 RC2/Claw 未公开某个 Host 侧路由时创建，并在 ADR-0001 记录原因 | `docs/adr/ADR-0001-dsh-transport.md`、§2 文件树 |
| 2 | 审批结果 | 只实现 DSH RC2 已有结果：`allowed-once` / `rejected` / `cancelled` / `unavailable`。`alwaysAllow` 不是审批答案，改为跳转 Bot 权限编辑器修改 Claw Policy（受硬上限约束）；`expired` 对应 Remote `cancel`、generation 替换或迟到回复 | §4.4、§12.4、§12.3 ApprovalCard、`design/grok-kit/SPEC_MAPPING.md` |
| 3 | 任务线程 | M1 不做 `TaskThreadPane`、`taskId`、847/848/849 主内容宽并排；推迟到 M4/M5，届时 `taskId` 引用 `CornTaskRun`。`kit-thread-resize.spec.ts`、`kit-thread-states.ts` 随之推迟 | §4.5、§12.3、§12.4 |
| 4 | M1 超出截图的范围 | 只纳入语音状态 fixture（activating/recording/processing/stop-in-flight/error 仅在开发 fixture 路由可见，正式界面仍 disabled）。深色主题、群组详情 tab、`dmg-0681` 布局 profile 及其边界测试均推迟 | §4.5、§12.1、§12.3；`docs/adr/ADR-0004-design-profiles.md` |
| 5 | 开发顺序 | M1 期间允许并行开发不碰界面的 M2 底层（SQLite schema/迁移、session 事件 reducer、Run 状态机）；这些代码在 PR-02C 合并前不接入 Renderer | §12.5 PR-03 依赖 |
| 6 | 头像风格 | Corn 原创：可保留“彩色形状 + 眼睛”的气质，但几何、表情、配色与动态有自己的辨识度，不模仿原版的标志性形态；不复制或描摹任何恢复出的路径与展示参数 | §13；`docs/adr/ADR-0003-avatar-engine.md` |
| 7 | Kit 自写代码 | 只参考行为，全部用 TypeScript 重写；不移植 Kit 任何文件（包括维护者自写的 `src/composer.js`、`examples/*`） | §12.2、`design/grok-kit/RIGHTS_REVIEW.md` |
| 8 | Kit 仓库可见性 | 转为私有。CI 无法 checkout，`pnpm verify:ui-kit` 在 CI 中输出明确的 `skipped` 诊断；本地需要时用 `--strict` | `design/grok-kit/SOURCE_LOCK.md` |
| 9 | 分支 | PR-00D/E 在叠加于 `feat/m0-runtime-spike` 的新分支上进行，PR #1 保持草稿 | — |
| 10 | PTC（`run_code`） | M0 结论限定为：**普通调用治理通过；PTC 外层拒绝通过，嵌套治理尚未验证。** PTC 保持禁用，M1 只使用已验证的普通工具调用链，不为此发布 Claw rc3。启用 PTC 前必须实测四项：嵌套调用逐次拒绝（`research`）、逐次审批（`developer`）、审批待决时取消、审计与观测 trace 关联到外层 `run_code` 的 `rootCallId`。候选 Claw 修改先在 Claw 仓库的隔离测试环境验证，通过后再发布并升级 Corn 的 `runtime.lock.json` | `docs/milestones/M0-EVIDENCE.md`、`scripts/smoke-governance.mjs --ptc` |
| 11 | 签名与公证 | M0 只产出未签名的 arm64 `Corn Bot.app` 供本地验证；Developer ID 签名、hardened runtime 与公证推迟，分发前需新 ADR | `docs/adr/ADR-0005-packaging.md` |
| 12 | 下一步头像与 App 图标 | 用户要求将已制作的 Corn 原创素材包和 v3 修正版图标纳入后续开发。PR-02D 分为静态/图标接入与动态组件接入，M2 接真实事件；锁定 16 角色、9 玉米轮廓、18 状态，默认眼睛方向为 `/`。群组素材先保留，不扩大 M1 群组功能。素材包独立验证不等于 App 验收通过 | §13 provisional 轮廓已更新；§15；[素材接入计划](CORN_AVATAR_ASSET_INTEGRATION_PLAN.md) |
| 13 | 右侧 Bot 管理面板 | 用户要求将 Claw 管理能力纳入右侧 Corn 面板。主 Tab 改为概览 / 配置 / 资料库；配置含核心、模型、权限、技能，资料库含资料/记忆。复用现有编辑器，M1 fixture、M2 真实接线；移除电脑主 Tab，M3 本机操作改为按需打开的独立视图，治理/租约要求保留 | §4.2、§4.4、M1/M2/M3/M7；§16；[管理面板实施计划](CORN_BOT_MANAGEMENT_PANEL_PLAN.md) |
| 14 | 模型配置修复 | 正式 App 接通 DSH 官方 settings/credentials/LLM 目录与模型管理；`model.env` / `CORN_MODEL_*` 只留为显式开发 smoke。无 Key 可启动配置界面，Host ready 与模型可用分开。全局设置在 runtime/U1 关闭后优先接通，不等待完整 M2 Bot/Run；这是决策 5 对真实 Renderer 接线时机的狭窄例外，仍须相关 UI/打包验收。全局 Provider/凭据/默认模型由 DSH 官方配置持有，Corn DB 仅存可重建投影与产品偏好。Bot 覆盖经 Claw，不能借 `session.selectModel` 副作用改全局默认 | §3、§4.4、M2 app_settings/模型表、§12.5；§17；[模型配置修复计划](CORN_MODEL_CONFIGURATION_FIX_PLAN.md) |
| — | 模型凭据 | Corn 专用 DeepSeek API Key 在 PR-00D/E 完成后、M0-03 开始前由维护者本地配置，同时确认模型 ID。Key 不进入 Git、计划文件或聊天 | M0-03、`docs/runbooks/development.md` |

**同步修正（非决策性）**：ADR 编号顺延，SQLite 已占 ADR-0002，头像引擎为 ADR-0003，设计 profile 为 ADR-0004；`packages/ui-kit` 更名为 `packages/ui`；`design/fixtures/*.ts` 移到 `apps/renderer/tests/fixtures/`，`design/` 只存文档；§12.2 checkout 改为 `0248419…`；§0 第 1 条更新为仓库已创建；§13 头注的变化文件数按 `git diff --stat` 更正为 45。

---

## 15. Corn 原创素材与 App 图标接入增量（2026-10-11）

**输入已生成，App 接入待执行。** 下一步使用 `/Users/qin/DSH/Corn Bot/design-assets/corn-avatar-kit-v1`：16 个角色、9 种原创玉米轮廓、18 种状态、288 个角色状态静态采样和 5 个群组。正式候选图标为包内 `assets/app-icon.png`，对应 `corn-bot-app-icon-v3-eyes-fixed.png`；平面玉米风格、黑色胶囊眼睛向 `/` 倾斜。较早写实版本及眼睛角度错误版本不进入发布。

完整文件拆分、源 SHA-256、当前占位组件的迁移、图标产物及验收见 **[CORN_AVATAR_ASSET_INTEGRATION_PLAN.md](CORN_AVATAR_ASSET_INTEGRATION_PLAN.md)**。接入后源代码和资产保存在 Corn 仓库，构建不依赖上述外部绝对路径。

| 阶段 | 下一步交付 | 验收边界 |
| --- | --- | --- |
| PR-02D-1 | 迁入并锁定原创资产，建立 `packages/ui` 与统一 `BotAvatar`，替换现有 `apps/renderer/src/shared/Avatar.tsx` 占位；覆盖列表、收藏卡、标题、详情、编辑、折叠栏和交接通知；生成 iconset/ICNS 并配置 macOS 打包 | 同一 Bot 配色/轮廓一致，上传图保持原貌；各使用尺寸及布局回归；新 `.app` 的 Finder/Dock/App 切换器图标检查 |
| PR-02D-2 | 基于原创几何接 React 动画、统一调度、静态回退、18 状态 fixtures；稳定 seed、独立 SVG ID、StrictMode/卸载/离屏/减少动态清理 | App 级 unit/visual/lifecycle/load 证据；素材包原有 9 项测试只作迁移起点 |
| PR-03A / M2 | 真实 Session/Run/Gate 到 AvatarPresentation 的按 Bot/Run 投影、优先级、短态 TTL、重连对账 | accepted 不当完成，审批不被普通工作态覆盖，断线不报成功，多 Bot 不串线 |
| PR-09A / M8 | 最终来源与构建清单复查，分发图标检查 | 不包含 Kit 提取资源；不将演示画廊打进 App；签名/公证按发布 ADR 单独验证 |

先完成 PR #7 的 review 与合并，之后从 main 分别进行 runtime R1–R3、U1 与 02D-1，允许并行；runtime 关闭证据作为阶段验收条件，而非 02D-1 开工前置。`main.ts` 重叠部分按 runtime PR → 02D-1 合并。PR-02C 门禁继续执行；U1 与头像的主动视觉变化更新区域基线，布局标定保持。M1 收尾需同时具备 review 修复关闭、02C 与完整 02D 证据。M2 底层并行规则仍按 §14。5 个群组头像先归档，群组功能维持原定后续阶段。

开工补充：App 图标先规范化透明留白再出 ICNS，按新 `.app` 的实际效果验收；新 Bot 从非小黄 15 角色稳定哈希选默认值，显式存 variantId，旧/未知值回退首字与色相占位；02D-1 做 16 选 1，上传推迟 M2 并更新禁用原因。计划文档不进入 #7，合并后作为 02D-1 分支首个提交。U1 分支、四项 smoke 入口及状态播报去重见接入计划 §7。

## 16. 右侧 Bot 管理面板增量（2026-10-11；02E-1 已合并，02E-2/03B 待执行）

§15/决策 12 保留给并行头像 02D-1 分支的素材接入计划，合并文档时保持两个增量和已确认顺序。本节不表示管理面板或 Claw 配置已接通。

右侧保留头像、名称、标签和既有布局，三个主 Tab 调整为 **概览 / 配置 / 资料库**。概览展示职责、工作区、状态和例行任务；配置以入口列表进入核心设定、模型、权限、技能子页；资料库分为资料与记忆。模型/权限从 `⋯` 迁入配置，现有编辑器抽出可嵌入内容，统一业务写路径。

详细文件拆分、旧 Tab 迁移、草稿/异步响应隔离、Claw rc2 路由来源和验收见 [CORN_BOT_MANAGEMENT_PANEL_PLAN.md](CORN_BOT_MANAGEMENT_PANEL_PLAN.md)。M1 用显式 fixture/只读/未接通状态；M2 对接真实 Repository、绑定、核心/记忆读取及已验证配置写入；技能/资料/例行任务完整能力继续按 M6/M7。Memory 全局设置保留在 Settings，不伪装为 Bot 级配置。

移除电脑主 Tab 不取消 M3 的真实本机操作。权限页和活动 Run 可打开独立操作视图，提供画面、暂停与接管，继续强制真实 Run、Gate 和设备级租约。

执行拆成 02E-1 管理导航/现有编辑器、02E-2 集成/视觉门禁、03B 真实数据接线。02E-1 可与 runtime/U1/头像有序开发；M1 收尾仍要求 review finding 关闭、02C 及相关集成证据。02C 的右侧内容金标按本次用户要求主动更新，布局尺寸保持已标定规则。

## 17. 模型配置修复增量（2026-10-11；runtime 修复与接口审计已完成，第三工作包起待执行）

完整计划见 [CORN_MODEL_CONFIGURATION_FIX_PLAN.md](CORN_MODEL_CONFIGURATION_FIX_PLAN.md)。先关闭 runtime R1–R3/U1，再优先接通全局模型设置与凭据，不等待完整 M2 Bot/Run。已有环境变量方案仅保留为显式开发 smoke；正式 App 无 Key 时启动独立、经 Claw 验证的 Host，并显示配置入口。

复用官方 settings/credentials/LLM 目录、schema、发现与存储；撤掉正式启动中的环境 Key 注入，避免它压过设置页值。全局默认模型写入口先核查，缺少公开能力时按 ADR-0001 做最小 Host seam，不能制造假 Session 或调私有方法。Bot 模型仍经 Claw 并验证实际 Session 生效，禁止 `session.selectModel` 的副作用串改全局默认。

DSH 官方配置是 Provider/凭据/全局默认模型的唯一事实源，正文 `app_settings` 中的模型字段仅作可重建投影，Corn 独立产品偏好仍可持久化。配置写入的版本冲突、凭据只读来源与多步部分成功要显式处理。模型可用性与 Host ready 分开验收；不崩溃不等于完整配置接入已完成。
