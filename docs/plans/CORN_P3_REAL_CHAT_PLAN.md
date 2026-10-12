# Corn Bot P3 真实前台聊天实施计划（DATA-01 + CHAT-01）

版本：2026-10-12 / v1。基线：main `781ae4e`。上位入口：[统一实施计划](CORN_BOT_FORWARD_PLAN.md) §7（P3）、§8（P4，前向兼容）、§13（工作包）。

**本文件只是计划，没有产品代码。** 没有调用真实模型，没有运行 GUI、Electron 或 packaged App。DSH 源码只在 `/Users/qin/deepseek-harness` 用 `git show dsh-v0.2.0-rc.2:<path>` 只读查阅。下文 DSH 行号均以该 tag 为准。

## 0. 基线校正

统一计划 v1 写成之后，下列事实已经变化。本计划以它们为前提：

| 事项 | 当前状态 | 来源 |
| --- | --- | --- |
| MODEL-01b（#15 模型设置） | **已合**。main 的 preload 已暴露 `modelSettings`，Main 有 `ModelSettingsService`。真实 Key 检查仍 pending | [PR #15](https://github.com/xingyingyuzhui/corn-bot/pull/15) |
| U1（Session-only 模型选择） | **已授权、已合、已锁定**。`SessionClient.selectSessionModel` 恒发 `scope: 'session'`，并拒绝没有回显 `scope: 'session'` 的回复；传输层只放行 `scope === 'session'`；`verifyDshPatches` 失败即 `runtime_patch_mismatch` | [U1 记录](../milestones/U1-SESSION-MODEL-PATCH.md)、[PR #27](https://github.com/xingyingyuzhui/corn-bot/pull/27) |
| DSH headless 门禁 B1–B6 | 已合；fake 模型。B2/B6 已证明 `session.cancel` 只结束 Turn | [DSH-HEADLESS-GATES](../milestones/DSH-HEADLESS-GATES.md) |
| 定向停止 | ADR-0007 补遗：有条件成立，叶子优先顺序为强制规定；U2 只是草案 | [ADR-0007 补遗](../adr/ADR-0007-execution-runtime.md#addendum-2026-10-12-targeted-stop-verdict) |
| 产品数据层 | **不存在**。`CompositionRoot` 在正常入口仍绑定 `FixtureWorkspaceRepository`；preload 只有 `runtimeStatus` 与 `modelSettings` | `apps/renderer/src/app/CompositionRoot.tsx`、`apps/desktop/src/preload.cts` |
| SQLite | [ADR-0002](../adr/ADR-0002-sqlite-runtime.md) 已因 D0（PR #34）改为 Accepted：CI 上 Electron Main 与打包 App 中 WAL、`synchronous=FULL`、外键、`backup()` 均通过（SQLite 3.53.4）；签名/公证/DMG 安装后的 App 仍未验证 | ADR-0002 |

因此 CHAT-01 的依赖里，MODEL-01b 和 U1 已满足。剩下的是 DATA-01，以及“必需视觉门禁”（GUI 暂停期间保持 pending，不阻塞代码合并，但阻塞 P3 签收）。

## 1. 目标、非目标与签收口径

**目标（统一计划 §7.3 退出条件）**：在正常页面创建真实 Bot、配置模型，得到真实流式回复，完成一次审批，取消当前回复，重开后历史可用，示例标识消失。假模型测试和真实模型请求的证据分开记录。

**P3 不做**（防止范围蔓延）：

- 后台 Run/Attempt/Worker、RunCard、Outbox、C1 `corn-run-control`（P4 / RUN-01a）。P3 不建 `task_runs` 等表。
- U2 实现，以及 C1 pre-step fence。
- 附件和图片上传、听写/语音、记忆/资料、群组、Bot-to-Bot。
- `steer` 插话、Composer 的 `updateQueue edit`、`user-questions` 问答 UI。
- Bot 删除，以及核心设定/权限/技能的写入。权限和技能只读展示；可写入需先过公开接口审计，属 P7。
- 一个 Bot 多条会话。表结构预留，UI 只有一条主会话。

**签收口径**：代码已合和真实签收是两个独立字段（统一计划 §14）。单测、headless fake 门禁、CI 都只证明它们自己覆盖的范围；GUI 联合验收与真实模型请求各自单独记录。

## 2. 复用简报（研究结论）

Context7 本次需要认证，没有使用。以下资料取自官方文档、GitHub 源码，以及 DSH tag 源码。

| 关注点 | 已有方案 / 先例 | 借用什么 | 仍需 Corn 自建的部分及原因 |
| --- | --- | --- | --- |
| SQLite 驱动 | ① `node:sqlite`：Node 24.15 起为 Stability 1.2（Release candidate）；Electron 44.7.0 内置 Node 24.21.0、SQLite 3.53.4（ADR-0002 实测）。同步 API；构造选项 `enableForeignKeyConstraints` 默认 true、`defensive` 默认 true、带 `timeout`；有 `sqlite.backup()`（在线备份 API）。② `better-sqlite3` 12.x：随包发布 Electron ABI 预编译二进制（含 v143/v148），需 `asar.unpack`，Electron 升级时要重新核对 ABI，pnpm 需加 `allowBuilds`。Signal Desktop 用自家 fork，跑在 SQL worker 里。③ `@vscode/sqlite3` / `sqlite3`：异步回调式原生模块，同样有 ABI 负担。④ RxDB 的 Electron 文章同样推荐 `node:sqlite`，理由是免原生重建 | **推荐 `node:sqlite`**（见 §3.1） | 一个约 100 行的 `driver.ts`：把 `DatabaseSync` 与 Node 26 的改名 `Database`（DEP0210）、事务、PRAGMA 读取包住。换驱动时只改这一个文件 |
| 迁移 | ① Signal Desktop：`PRAGMA user_version` + 有序 TS 迁移，尽量放进一个事务；遇到更新版本的库直接拒绝（`DBVersionFromFutureError`）；`user_version` 在事务内更新。② Drizzle：`drizzle-orm/node-sqlite` 驱动在 1.0.0-beta.17（2026-03）加入，kit 支持在 beta.18 加入，仍是 pre-release。③ Kysely：没有一方 `node:sqlite` 方言 | 照搬 Signal 的版本与事务规则，外加一张校验和台账 | 纯 SQL 迁移，以 TS 字符串常量嵌入（`tsc` 不复制 `.sql`，打包 App 不需要额外资产）。P3 只有 7 张表，不为它引入 ORM 和 kit 依赖；P4 表多了再评估（决策 2） |
| 流式聊天投影 | DSH 官方 client：`session-controller/src/client/sessions/session.ts`（用 `requestId` 跟踪乐观回显，看到 inbox 插入或 `user/message` 即回收）；`assistant-stream.ts` L131–187（`start/chunk/end`；index 不连续、active 期间又来 `start`、`end` 对不上，都返回 `rebaseline`；`end.committed` 指名 seq 后才发布对应的 durable `assistant/message`）；`gateway/src/client/journal-stream.ts`（opening snapshot 整窗替换，之后连续 append，断线就重开） | 状态规则和 rebaseline 判据 | Main 侧的纯函数 `ConversationProjector`。官方 client 依赖 cordis 与 React 运行时，不能直接搬 |
| 审批绑定 | DSH `ui-approval` client：`$events` waterfall `approval/request` → 用 `allowed-once`/`rejected` 作答。Gateway（`api/gateway/src/index.ts`）：新的 client generation 连上时，仍 pending 的事件以**同一 `eventId`** 重投（L513）；已完成的事件、或被替换掉的 generation 交来的结果，都按幂等 no-op 处理（L618–621）。`user-approval/src/index.ts`：没有 answerer 时默认 `unavailable`（L283）；`approval/asked`/`approval/decided` 是 durable 审计（L225/L232），其 `id` 与 `eventId` 不是同一个值 | 绑定元组与 fail-closed 语义 | `ApprovalBroker`：handle 映射、generation 切换、Corn 侧超时（C4）、durable 对账 |
| Electron IPC | Electron 官方：只用 `contextBridge` 暴露窄函数，不暴露 `ipcRenderer` 或 event 对象（29 起无法再透传）；MessagePort 走 `webContents.postMessage`，再由 preload 转交主世界。Corn 现有模式（`ipc/model-settings.ts`）：每个通道一个命令、严格 parse、`assertTrustedSender`、闭集错误码、rejection 不外泄 | 原样沿用 Corn 现有模式 | 新增一个推送通道。P3 用 `webContents.send` 按帧合并推送，不用 MessagePort（决策 10） |
| 请求去重 | DSH `session.prompt`：对同一 `requestId` 检查 inbox 与 durable log，已存在就直接回 `{accepted: true}`（`commands.ts` L330、L602–614）。`session.create` 带显式 `sessionId` 时语义是“创建或恢复一次”，并断言 preset 与 cwd 不变（`agent.ts` L239–275） | 同一 `requestId`、同一 `sessionId` 重试天然幂等 | Corn 必须在调用 RPC **之前**持久化 `requestId` 和 `sessionId` |
| Bot/Session 事务 | 已审计的 Claw Registry 路由；`scripts/lib/model-session.mjs` 的 `boundSession`（create → preset/ensure → session/create → bind → selectSessionModel → state ready）；v1.3 计划 §M2 的事务描述 | 步骤顺序 | 每步持久化断点、闭集失败码、可修复续跑；不降级为普通 Session |

## 3. 关键设计

### 3.1 DB 驱动：`node:sqlite`（附条件）

推荐 `node:sqlite`，理由：

- 没有原生 addon：Electron 升级不需要 ABI 重建，不需要 `asar.unpack`，也不需要新的 `allowBuilds`。打包树和 `verify:runtime` 的锁定纪律不受影响（现有包体约 846 MB，减重属 C8，尚未开始）。
- 同步 API 适合“Main 单写者、写入极小”的场景，事务边界写在代码里一目了然。
- 自带在线备份（`sqlite.backup`）、默认开启外键与 defensive，减少自定义代码。
- ADR-0002 已在 Electron 44.7.0 的 Node 模式完成 WAL 写读；D0 之后 Main 进程本体与打包 App 也已由 CI 验证。

附带条件和风险：

- Stability 1.2 仍可能有破坏性变化，例如类名改为 `Database`。全部 API 只经 `driver.ts` 调用。
- 没有 `transaction()` 帮手。`db.write(fn)` 自己执行 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`；`fn` 若返回 thenable，直接抛错并回滚，防止 await 跨越事务。
- 同步调用运行在 Main 线程。约束：写入单行或几行，不做大扫描；聊天正文不入库（§3.3），所以不会出现大表。若实测 Main 卡顿，再按 Signal 模式迁到 `utilityProcess`/worker（不在 P3 范围）。
- **改选 better-sqlite3 的触发条件**（任一）：打包 App 中 `node:sqlite` 不可用或行为不同；Electron/Node 升级移除或破坏 API；WAL、外键、备份三项中任一在打包环境失效。

### 3.2 事实源

| 数据 | 权威所在 | Corn DB 存什么 |
| --- | --- | --- |
| Provider / Key / 全局默认模型 | DSH 官方 settings/credentials（`ModelSettingsService`） | **不存** |
| Claw agent（`wa_` agentId、workspaceId、canonicalRoot、`wa-` preset、策略） | Claw Registry | 映射缓存（`claw_agents`），每次启动核对 |
| Claw 的 per-agent `model`（`registry/model`） | Claw Registry | **不用、不写**。不在白名单内，避免出现第三份模型选择 |
| 会话消息、Turn、工具、审批 asked/decided | DSH Session journal | 不存正文；只存受理身份与状态（§3.3） |
| Bot 的模型覆盖意图 | Corn（产品设定） | `bots.model_override_*`（可空）。实际生效值以 Session `modelSelection` 投影为准，每次发送前对齐（§3.6） |
| Bot 产品身份（名称、头像、置顶/隐藏、标签、排序） | Corn | `bots`、`tags`、`bot_tags` |
| 绑定（Conversation ↔ DSH Session ↔ Claw agent） | Corn 记录 + Claw `session/bind` 双向核对 | `conversations`、`session_bindings` |
| UI 偏好 | Corn | `ui_prefs`（键为白名单，值为 JSON，可重建） |

Renderer 永远不读 DB，只拿到 Main 投影出来的脱敏视图（已有 `WorkspaceSnapshot` 形状）。

### 3.3 四种身份，绝不混用

| 名称 | 谁生成 | 生命周期 | 用途 |
| --- | --- | --- | --- |
| `clientId` | Renderer，每次发送动作一个 | 一次 IPC 命令及其重复提交 | 拦截同一按钮的重复 IPC；`UNIQUE(conversation_id, client_id)` |
| `requestId` | Main，**写入 DB 后**才调用 RPC | 永久 | 即 DSH `SessionRequestId`。在 journal 中表现为 `user/message.data.source.rpcId`，**名字容易与下一行混淆**。重试一律复用它，由 DSH 在 inbox 与 log 两处去重 |
| 传输层 `rpcId` | `HostTransport.rpc` 每次 HTTP 调用一个 | 一次 HTTP 往返 | 只做信封关联，不持久化，不出现在任何 Corn 逻辑里 |
| Turn / seq / attemptId | DSH | durable（turn、seq）；进程内（`attemptId`） | 进度与流的位置。Turn 号不能当作消息身份；`attemptId` 只用于临时流 |

审批也有一组身份：`$events` generation 的 `clientId`、pending waterfall 的 `eventId`（跨 generation 不变）、durable 的 `approval/asked.id`、工具 `callId`。Renderer 只拿到 Main 生成的不透明 `approvalHandle`。

### 3.4 数据层：位置、打开、迁移、备份

- **位置**：打包为 `userData/corn-data/corn.sqlite`；开发为 `CORN_DATA_DIR`，缺省时由 `CORN_DSH_HOME` 推导为同级 `<home>-data/`，使每个 worktree 天然隔离。目录 0700，文件 0600。不得位于 DSH home 内，不得位于 `~/.dsh` 内或其祖先（复用 `assertIsolatedHome` 的规则）。目录放一个 `.corn-bot-data.json` 所有者标记。
- **进程锁**：复用 `process-lock.ts`，锁文件 `corn-data.lock`。拿不到锁就进入 `data_locked`，不打开 DB。
- **打开序列**（在 Host 启动前完成，与 Host 状态相互独立）：
  1. 设置 `application_id` 并校验，不是 Corn 的文件就拒绝。
  2. 设置 `journal_mode=WAL` 并断言返回值为 `wal`；`synchronous=FULL`（决策 4）；`busy_timeout` 设为 5000 ms。
  3. 读取 PRAGMA，断言 `foreign_keys=1`，并设 `trusted_schema=OFF`。
  4. 执行 `PRAGMA quick_check`，结果不是 `ok` 就进入 `data_corrupt`，不写入。
- **迁移**：
  1. 读 `user_version`。大于代码已知的最大版本时进入 `data_from_future`，不写任何东西。
  2. 需要升级时，先用 `sqlite.backup()` 备份到 `backups/corn-v<from>-<ts>.sqlite`（只保留最近 3 份）。
  3. 在一个 `BEGIN IMMEDIATE` 事务中依次执行各迁移，设置 `user_version`，并在 `schema_migrations(version, name, sha256, applied_at)` 写入台账。
  4. 失败时回滚（SQLite DDL 可回滚），保留备份，进入 `data_migration_failed`。
  5. 已应用迁移的 sha256 与代码不一致时进入 `data_schema_tampered`。
- **关闭**：`before-quit` 中 `control.shutdown()` 之后执行 `wal_checkpoint(TRUNCATE)` 再关闭。
- **数据状态**：新增闭集 `DataStatus`（`opening | ready | locked | corrupt | from_future | migration_failed | schema_tampered | unavailable`），与 `RuntimeStatus`、`ModelStatus` 三者分离，Renderer 各自显示。数据不可用时 Bot 管理与聊天全部禁用并说明原因，不回退到 fixture，也不自动删库。从备份恢复的 UI 不在 P3（决策 12），只写 runbook。

### 3.5 Schema 0001（草案，最终以 D1 的 PR 为准）

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- data_id；home_id = DSH home 标记中的 id，用来发现“库指向另一个 home”

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL,
  sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT;

CREATE TABLE bots (
  bot_id TEXT PRIMARY KEY,                 -- 'bot_' + uuid，Corn 自有，改名不变
  display_name TEXT NOT NULL,
  avatar_variant TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  sort_key TEXT NOT NULL,
  model_override_provider TEXT, model_override_model TEXT, model_override_effort TEXT,
  CHECK ((model_override_provider IS NULL) = (model_override_model IS NULL)),
  provisioning TEXT NOT NULL CHECK (provisioning IN ('creating', 'ready', 'needs_repair')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;

CREATE TABLE claw_agents (
  bot_id TEXT PRIMARY KEY REFERENCES bots(bot_id),
  agent_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
  canonical_root TEXT NOT NULL, dsh_preset TEXT NOT NULL,
  policy_preset TEXT NOT NULL,             -- 创建时选定，见决策 6
  created_at INTEGER NOT NULL) STRICT;
-- agent_id 的 wa_ 前缀与 dsh_preset 的 wa- 前缀由 repository 的 parser 校验

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(bot_id),
  kind TEXT NOT NULL CHECK (kind IN ('main')),
  created_at INTEGER NOT NULL) STRICT;
CREATE UNIQUE INDEX one_main_conversation ON conversations(bot_id) WHERE kind = 'main';

CREATE TABLE session_bindings (
  binding_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  dsh_session_id TEXT NOT NULL UNIQUE,     -- 调用 session/create 之前生成并写入
  stage TEXT NOT NULL CHECK (stage IN ('planned', 'agent_created', 'preset_ensured',
    'session_created', 'verified', 'bound', 'model_applied', 'ready', 'needs_model', 'retired')),
  last_error TEXT,                         -- 闭集错误码，从不保存 Host 原文
  applied_provider TEXT, applied_model TEXT, applied_effort TEXT,
  home_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE UNIQUE INDEX one_live_binding ON session_bindings(conversation_id) WHERE stage <> 'retired';

CREATE TABLE message_admissions (
  request_id TEXT PRIMARY KEY,             -- = DSH SessionRequestId
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  binding_id TEXT NOT NULL REFERENCES session_bindings(binding_id),
  client_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('queue')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'accepted', 'observed',
    'rejected', 'unknown', 'withdrawn')),
  body_text TEXT,                          -- 只在 observed 之前保留（决策 5）
  body_sha256 TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  observed_seq INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (conversation_id, client_id)) STRICT;
CREATE INDEX admissions_open ON message_admissions(state) WHERE state IN ('pending', 'sending', 'unknown');

CREATE TABLE tags (tag_id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT;
CREATE TABLE bot_tags (
  bot_id TEXT NOT NULL REFERENCES bots(bot_id),
  tag_id TEXT NOT NULL REFERENCES tags(tag_id),
  PRIMARY KEY (bot_id, tag_id)) STRICT;

CREATE TABLE ui_prefs (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
```

为 P4 预留（本次不建）：

- `task_runs.conversation_id` 引用 `conversations`。
- `run_directives.request_id` 引用 `message_admissions`，使用户消息的规范身份只有一个。
- Worker Session 绑定到 Attempt，不进入 `session_bindings`。
- P4 用迁移 0002 加表，不修改 0001 的语义。

审批在 P3 不落库：Main 重启必然伴随 Host 重启，未结束的 Turn 会被合成为 `interrupted`，pending 的审批随之失效。P4 后台审批要绑定 Attempt 时再加表。

### 3.6 Bot 创建与绑定事务（可修复）

每一步先写断点再调用，失败只写闭集错误码，任何一步都可以由 `repairBot(botId)` 从断点续跑。不降级成普通 Session；一个已绑定的 Session 绝不改绑给别的 Bot。

| # | 步骤 | 幂等性与异常处理 |
| --- | --- | --- |
| 0 | 写入 `bots(creating)`、`conversations(main)`、`session_bindings(planned)`，同时预生成 `dsh_session_id = corn-<uuid>` | 本地事务 |
| 1 | `registry/create {name}` → `claw_agents` | **不幂等**（按名称生成 slug）。回复丢失时进入 `claw_create_unknown`。修复时读 `registry/list`，只有恰好一个候选满足以下全部条件才收养：标题与名称完全相同、未被任何 Corn 绑定引用、在尝试时间之后创建（字段以 tag 源码为准，A1 时先核对）。否则保持 `needs_repair` 并报告孤儿 agent（决策 16） |
| 2 | `registry/preset/ensure` → 回复的 `presetId === dshPreset` | 幂等 |
| 3 | 设置策略 preset（决策 6）：只允许 `{preset: 'research' \| 'developer'}` 这一精确形状 | 幂等 |
| 4 | `session/create {sessionId, cwd: canonicalRoot, agentPreset}` | DSH 语义为“创建或恢复”，并断言 preset 与 cwd 不变（`agent.ts` L239–275），同 id 重试安全 |
| 5 | 校验：`session/list` 中该行的 header 满足 `agentPreset === dshPreset`、`cwd === canonicalRoot`，且不是 subagent | 不符即 `binding_mismatch`，停止 |
| 6 | `registry/session/bind {state: 'provisioning', expectedRevision}` | 409 revision 冲突：重读后最多重试 3 次。已绑定到同一 agent 视为成功（用 `registry/list` 核对）；已绑定到其他 agent 则停止 |
| 7 | 模型：有覆盖则 `selectSessionModel`（U1，要求回显 `scope: 'session'` 且选择一致）；跟随全局则不写 | 先按新鲜的 `session/modelCatalog` 校验；无效就 `needs_model`，并调用 Claw `session/state needs_model`，**不换用别的模型** |
| 8 | `registry/session/state {ready}` → `stage = ready`，`provisioning = ready` | 幂等 |

**跟随全局的语义（U1 的约束）**：U1 记录 §2 写明，Session 的 log 一旦出现 `request/header` 或 `model/selection`，就不再跟随全局默认。也就是说，跟随全局的 Bot 发出第一条消息后，就被钉在当时的模型上。因此 Corn 定义：“跟随全局”= **每次发送前**，Main 在该 Session 的串行 lane 内比较“期望模型”（覆盖值，或当前全局默认）与投影中的 `modelSelection`。不一致就先调用 `selectSessionModel(scope: 'session')`，再发 prompt。永远不写全局默认（传输层已经拒绝），也不采用“先改后恢复”。见决策 11。

### 3.7 发送、流、重连

**发送**：

1. Renderer `sendMessage(botId, clientId, text)`。
2. Main 按 `(conversation, clientId)` 查重；已存在就返回原 messageId。
3. 写入 `admission(pending, requestId, body)`。
4. 进入该 Session 的串行 lane（沿用 `SessionClient.prompt` 现有的 in-flight 去重与 lane）。
5. 模型对齐（§3.6）。
6. `session/prompt {requestId, mode: 'queue'}`，按结果分三类：
   - `{accepted: true}` → `accepted`。
   - 闭集 `RemoteError`（如 `gateway/bad-request`、`session/agent-busy`、`session/not-found`）→ `rejected`，附闭集原因。
   - 超时、HTTP 5xx、`corn/disconnected`、Host 正在恢复 → `unknown`。在同一个 Host generation 内用**同一个 requestId** 自动重试，最多 3 次，带退避。仍不确定就显示“未确认送达”，提供手动“重发”（同样复用 requestId）。

在 follow 中看到 `user/message.data.source.rpcId === requestId`，或在 inbox 投影里看到它，即转为 `observed`，并把 `body_text` 置空。

**投影（`ConversationProjector`，纯函数）**：

- **`snapshot`**：整窗替换。读取 `records`、`cursor`、projections baseline（inbox、modelSelection）和 assistantStream baseline（若有 `activeAttempt`，用已累积的 stream 显示临时气泡）。
- **`event`**：必须满足 `seq === cursor + 1`，否则触发 rebaseline（重开 follow），绝不补造。`surfaceOp` 为 `replace` 时，P3 也直接 rebaseline。
- **`assistant-stream`**：照搬官方判据。`start` 时已有 active，或 `chunk.index !== nextIndex`，或 `end` 与 pending 对不上，都 rebaseline。`end.committed{seq}` 之后，等该 seq 的 durable `assistant/message` 到达再替换临时气泡，按 seq 去重，不会出现两份答案。`abandoned` 时丢弃临时内容。
- **事件到 FeedItem 的映射**：
  - `user/message` 映射为用户气泡；`assistant/message` 的文本部分映射为 Bot 气泡。
  - `tool/*` 映射为简短提示：工具名加成功或失败，不展示原始输出。
  - `approval/asked` 与 `approval/decided` 映射为审批卡状态。
  - `turn/end` 映射为提示：`aborted` 显示“已停止”，`interrupted` 显示“运行时中断”，`blocked` 和 `error` 各有对应文案。
  - 未知且 `ignorable` 的事件直接跳过；未知且非 `ignorable` 的事件显示中性提示，不崩溃。
  - chunk 的具体形状（文本、思考、工具调用增量）在 A1 时按 tag 核对后固定。P3 只渲染文本，思考内容默认不展示。
- **断线**（`corn/disconnected` 或 Host 恢复中）：
  1. 会话标为 `reconnecting`，丢弃临时流（不算成功），`sending` 状态的受理转为 `unknown`。
  2. Host ready 后重开 follow，由新 snapshot 整窗替换，再按 `requestId` 对账受理。
- **推送**：Main 按会话维护 revision，按帧合并（16–33 ms）后经 `corn:workspace:changed` 推送 `{revision, conversations: {...}}`。Renderer 发现 revision 跳号就主动拉取 `corn:workspace:snapshot`。

**启动时的只读恢复**（Main 启动、Host ready 之后、打开任何 follow 之前）：

1. 每个 `ready`/`needs_model` 的绑定先读 `session/projections`（不会激活 Agent）。结果为 `null` 就进入 `session_missing`（`needs_repair`）。
2. 用 `session/list` 的 header 核对 preset 与 cwd，用 `registry/list` 核对 agent 与绑定。
3. 对 `pending`/`sending`/`unknown` 的受理，用 projections 的 inbox 与 `session/page(throughSeq: asOfSeq)` 按 `requestId` 对账。
4. 只对**当前选中的那个会话**打开 follow（会激活 Agent；前台会话可以接受）。

B4 已证明：重启后排队的 inbox 项不会自动开始。P3 把它显示为“排队中（运行时重启后未开始）”，提供“移除”（`updateQueue remove`）。下一条用户消息是否会把它一起带出，由门禁 G6 实测后再定文案。

### 3.8 审批（C4）

1. Host ready 后，Main 在每个 Host generation 只开一条 `$events` 流，并记下 `ready.clientId`。
2. 收到 `waterfall approval/request` 时，`agentId` 就是 sessionId。只有它属于当前 home 中某个 `ready` 前台绑定时，Main 才建立 pending 记录 `{handle, eventId, clientId, sessionId, botId, callId?, toolName, reason（脱敏、截断）, turn, createdAt}`。其他情况回复 `{kind: 'next'}`，DSH 得到 `unavailable`（fail-closed）。
3. Renderer 只拿到 `handle`。`answerApproval(botId, handle, 'allowed-once' | 'rejected')` 之前，Main 依次校验：handle 存在；属于该 Bot；所在 generation 是当前的；没有被撤回或已决定；所属 Turn 没有结束。通过后才发出 `$events/result {clientId, eventId, outcome: {kind: 'result', value}}`。
4. 卡片状态先置为 `submitting`。**终态只认** durable 的 `approval/decided`（用 `callId` 关联到 `approval/asked.id`）或 `$events` 的 `cancel` 帧。B3 已证明迟到的回复也会返回成功，但不产生任何效果，所以 RPC 成功本身不算决定。
5. WS 重连后，DSH 以同一 `eventId` 向新 generation 重投。Main 把 handle 改挂到新的 `clientId`；尚未决定的答复在新 generation 上重发一次。
6. Corn 侧超时（决策 9）到期后回复 `rejected`，并写一条会话提示。
7. `user-questions/request` 在 P3 不支持：回复 `{kind: 'next'}`，并显示提示。
8. 历史审批由 journal 中的 asked/decided 成对渲染，只读。
9. 绝不：自由文本 outcome、把聊天文本当作审批、替其它 Session 作答、在停止后作答。

### 3.9 取消当前对话

`cancelTurn(botId)` 只作用于该 Bot 主会话的 sessionId，按以下顺序：

1. **子会话**：从 `session.list` 中找出 `parentSessionId` 链指向本前台 Session 的子会话，用 `interruptByParent` 从最深处开始中断。
2. **作业**：对本前台 Session 及其子会话执行 `job.list` / `job.kill`。
3. **重列**：重复第 1、2 步直到一次完整遍历为空，以 5 轮、5 s 为界。
4. **父 Turn**：最后执行 `session.cancel`。

这与 ADR-0007 补遗规定的顺序相同（决策 8），只是 P3 没有 C1 fence。之后在该 Session 上出现的 `turn/start` 视为陈旧 Turn，立即取消，并计数泄漏的请求。其他 Bot 的 Session、P4 的 Worker Session 不在遍历范围内。

其它要点：

- `cancel` 会保留 inbox，所以 UI 必须写明“已停止当前回复，排队消息仍在”，并提供移除。
- 停止会把 pending 审批变成 `cancelled`（B3），之后 Main 拒绝该 handle。
- 撤回尚未发出的受理：`pending` 直接标为 `withdrawn`；已进入 inbox 的用 `updateQueue remove`。

### 3.10 IPC 与 Renderer

- **新增 contract** `packages/contracts/src/workspace.ts`：
  - 通道常量 `WORKSPACE_CHANNELS`；
  - 每条命令的 payload 类型与 parser（模仿 `model-settings/commands.ts`：形状严格、字符串有长度上限、未知键拒绝）；
  - 闭集错误码；
  - 推送事件形状；
  - 跨 IPC 的视图类型，从 `apps/renderer/src/model/workspace.ts` 迁入，Renderer 原路径 re-export。
- **命令**（invoke）：`snapshot`、`createBot`、`repairBot`、`sendMessage`、`resend`、`cancelQueued`、`cancelTurn`、`answerApproval`、`setPinned`、`setHidden`、`updateBotProfile`（只含名称与头像）、`setBotModel`、`createTag`、`setBotTags`、`setUiPref`、`loadEarlier`。
- **推送**：`corn:workspace:changed`。preload 暴露 `onWorkspaceChanged(cb)`，只把数据传给回调，不传 event 对象，并返回取消订阅函数。
- 每个 handler 都先 `assertTrustedSender`，`extra.length` 必须为 0，rejection 一律转成闭集错误。
- Renderer 侧：新增 `MainWorkspaceRepository`（`label: 'live'`），用 `useSyncExternalStore` 承载 `getSnapshot`/`subscribe`。`CompositionRoot` 的选择规则：
  - preload 有 `workspace` 桥 → live；
  - 开发服务器上显式 `#fixture=default|ui-states` → fixture；
  - 打包构建永远不会选到 fixture；没有桥的打包环境显示数据不可用。
- live 路由下：职责/工作风格、分组、语音、连接应用仍按“后续开放”禁用（决策 7）；`setGlobalModel` 走已合的 model-settings 通道。`BotOrigin` 只出现 `live`，示例标识自然消失。

## 4. 切片与依赖

图例：**并行** 表示与同一批次的其它切片没有共享文件、也没有共享可变状态，可由不同 agent 在各自的 worktree 中同时做。**串行** 表示必须等前置切片合入。Main、preload、contracts 是公共边界，由同一个负责人按顺序合入（统一计划 §3）。

```text
批次 1（全部并行）: C0 契约 | D1 local-db | A1 adapter | D0 驱动定案
批次 2（并行，各自依赖批次 1）: D2 Main 数据接线 | P1 Bot 事务 | P2 投影 | AB 审批代理
批次 3（串行）: CS 聊天服务 → W1 IPC + Renderer live
批次 4: G 门禁脚本（可与 W1 并行编写；运行时一次一个场景）
之后: V1 GUI 联合验收（待恢复） → R1 首次真实调用（待授权）
```

| 切片 | 依赖 | 并行性 | PR 分支建议 |
| --- | --- | --- | --- |
| D0 | — | 并行 | `docs/adr-0002-sqlite-final` + CI smoke 事实 |
| C0 | — | 并行（公共边界负责人） | `feat/p3-workspace-contract` |
| D1 | — | 并行 | `feat/p3-local-db` |
| A1 | — | 并行 | `feat/p3-adapter-follow-events` |
| D2 | C0、D1 | 与 P1/P2/AB 并行（公共边界负责人） | `feat/p3-main-data` |
| P1 | C0、D1、A1 | 并行 | `feat/p3-bot-provisioner` |
| P2 | C0、A1 | 并行 | `feat/p3-conversation-projector` |
| AB | C0、A1 | 并行 | `feat/p3-approval-broker` |
| CS | D2、P1、P2 | 串行 | `feat/p3-chat-service` |
| W1 | CS、AB | 串行（公共边界负责人） | `feat/p3-live-workspace` |
| G | CS、AB（脚本编写）；W1（G8 的 UI 断言部分） | 编写可并行，运行串行 | `test/p3-headless-gates` |
| V1 | W1、G | 待 GUI 恢复 | — |
| R1 | V1、维护者授权 | 待授权 | — |

### D0：驱动定案（ADR-0002）

- **范围**：在 `CORN_DESKTOP_SMOKE` 的 facts 里加一组 `sqlite`：`{sqliteVersion, wal, foreignKeys, backupOk, mainProcess: true}`，在临时目录完成开库、WAL、外键、`backup()`、关闭。CI 的 macos-14 `runtime-smoke` job 已经在托管 runner 上跑 `dev:desktop` 与 `smoke:packaged`，因此“Main 进程本体”和“打包 App”两项都由 CI 给出证据，不占用本机（决策 3）。ADR-0002 依据 CI 结果改为 Accepted，或保留 Proposed 并写明缺口。
- **文件**：`apps/desktop/src/main.ts`（smoke facts，最小改动）、`apps/desktop/src/smoke/sqlite-probe.ts`、`scripts/smoke-packaged.mjs`（断言新 facts）、`docs/adr/ADR-0002-sqlite-runtime.md`。
- **测试**：给 `sqlite-probe` 写单测（用 Node 的 `node:sqlite`）。CI 的 Electron 与 packaged 结果作为证据。本机不运行。
- **风险与边界**：
  - [ ] Electron Main 的 ESM 导入 `node:sqlite` 是否需要特殊处理（没有打包器，应可直接导入）。
  - [ ] 打包后 `userData` 路径可写。
  - [ ] CI runner 的 macOS 版本与本机不同，结论只代表 CI 环境。

### C0：Workspace IPC 契约

- **范围**：落实 §3.10 的 contract：通道、命令 parser、闭集错误码（`validation | not_found | conflict | stale | unavailable | data_unavailable | runtime_not_ready | model_unavailable | binding_broken | host_error`）、视图类型迁移、推送事件形状，以及 `DataStatus`。
- **文件**：`packages/contracts/src/workspace.ts`、`packages/contracts/tests/workspace.test.ts`、`apps/renderer/src/model/workspace.ts`（re-export）、`apps/renderer/src/corn-bridge.d.ts`。
- **测试**：每条命令都有合法、缺键、多键、超长、错误类型的用例；通道表与 preload 一致性的测试先写好，接线在 W1。
- **风险**：
  - [ ] 视图类型迁移不能改变 Renderer 现有测试的行为。
  - [ ] `exactOptionalPropertyTypes` 下可选字段要省略而不是写 `undefined`。

### D1：`packages/local-db`

- **范围**：`driver.ts`（打开、PRAGMA、`write()`/`read()`、thenable 防护、改名兼容）、`migrator.ts`（user_version、台账、备份、拒绝未来版本、校验和）、`migrations/0001-core.ts`、各 store（`bots`、`agents`、`conversations`、`bindings`、`admissions`、`tags`、`ui-prefs`）及带闭集枚举的 row parser（`never` 穷尽）。纯 Node，不引用 Electron。
- **文件**：`packages/local-db/{package.json,src/**,tests/**}`；根 `package.json` 的 `test` glob 加上 `packages/local-db/tests/*.test.ts`；`tsconfig.json` 已覆盖 `packages/**`。
- **测试**（tmp 目录与 `:memory:`）：
  - 空库迁移；重复打开不重复迁移；未来版本拒绝且不写入。
  - 迁移中途抛错能回滚，备份文件存在且可打开；sha256 篡改被拒绝。
  - 外键违例被拒；`write()` 传入 async 函数会抛错并回滚。
  - `UNIQUE(conversation_id, client_id)`；`one_live_binding`；`body_text` 在 observed 后置空。
  - 损坏文件（写入垃圾字节）得到 `corrupt`；`application_id` 不符被拒；WAL 被断言开启。
- **风险**：
  - [ ] CI ubuntu 的 Node 24.18 带有 `node:sqlite` RC，但与 Electron 的 24.21 小版本不同。D1 只依赖两者共有的 API。
  - [ ] `STRICT` 表要求 SQLite 3.37 及以上（满足）。
  - [ ] 只用 number 存时间戳，不开 BigInt。

### A1：dsh-adapter 补齐

- **范围**：
  - `SessionFollower`：follow 帧（snapshot/event/assistant-stream）的结构校验、连续性检查、关闭；
  - `ApprovalEvents`：`$events` 的 ready/waterfall/cancel 解析，以及 `answer(eventId, value)`、`delegate(eventId)`；
  - `SessionClient.page()`、`sessionRows()`（解析 header 中的 preset、cwd、parentSessionId、origin、running）；
  - `ClawRegistryClient.list()`（agents 与 bindings 的结构化解析）；
  - 视决策 6 加 `policy(agentId, preset)`。
- **白名单变化**：Claw 路由仅在决策 6 选 B 时加 `registry/policy`，并且只放行 `{agentId, policy: {preset}}` 且 preset ∈ {research, developer}。RPC 与流的白名单不变（`session/page`、`$events/result`、`session/follow`、`$events`、`job/*`、`subagents/interruptByParent` 都已在内）。
- **按 tag 核对后写进 PR 描述**：
  - assistant chunk 的具体形状；
  - `registry/list` 的 agent 字段（判断能否满足 §3.6 第 1 步的收养条件）；
  - `waterfall` 请求里 `callId`/`reason`/`displayReason` 的投影形状。
- **测试**：fake mux/fake transport：帧解析的正例与反例、`seq` 跳号回调、`$events` 解析、白名单拒绝（`registry/model`、`registry/session/adopt`、未知 preset）。
- **风险**：
  - [ ] `displayReason` 是多语言对象，只取 `zh`/`en` 并截断。
  - [ ] 不得把 `$events` 的 `clientId` 写进日志。

### D2：Main 数据接线

- **范围**：
  - `AppPaths.data` 与隔离断言（拒绝 `~/.dsh`、DSH home 本身及其祖先）；
  - data lock；
  - 在 Host 启动前打开 DB，失败进入 `DataStatus`，不影响 Host 启动；
  - `before-quit` 时 checkpoint 并关闭；
  - `home_id` 与 DSH home 标记核对，不一致时所有绑定标为 `home_mismatch`，不使用；
  - `corn:data:status` 通道。
- **文件**：`apps/desktop/src/app-paths.ts`、`apps/desktop/src/data/{open.ts,paths.ts}`、`apps/desktop/src/main.ts`、`apps/desktop/src/preload.cts`（只加 `dataStatus`）、相关测试。
- **测试**：app-paths（开发与打包、`CORN_DATA_DIR`、按 home 推导）；隔离负例；锁冲突；用 fake 验证启动顺序（DB 失败时 Host 仍可启动，聊天禁用）；退出时序。
- **风险**：
  - [ ] `CORN_DSH_HOME` 未设置的开发默认路径不能与其它 worktree 冲突。
  - [ ] 不得在 DSH home 内创建任何 Corn 数据文件。

### P1：Bot 创建与修复事务

- **范围**：落实 §3.6 的 `BotProvisioner`：`create(draft)`、`repair(botId)`、`setModel(botId, override | null)`。每一步都写断点。
- **文件**：`apps/desktop/src/workspace/bot-provisioner.ts`、`apps/desktop/tests/bot-provisioner.test.ts`。
- **测试**（全部用 fake 的 registry、session、DB）：
  - 每一步分别抛出“明确失败”和“结果未知”两种错误，再修复续跑；
  - `registry/create` 结果未知时：恰好一个候选才收养，多个或零个候选进入 `needs_repair`；
  - 409 重试上限；已绑定到其他 agent 时停止；
  - `selectSessionModel` 回显不对时进入 `needs_model`，且不发生全局写；
  - 模型不在目录中进入 `needs_model`；
  - 绝不调用 `session/create` 以外的方式造普通会话；
  - 同一 Bot 的并发 create/repair 被串行化。
- **风险**：
  - [ ] Claw 创建会写 workspace 目录。孤儿 agent 不自动删除，只报告。
  - [ ] Bot 改名时只改 Corn 的 `display_name`；P3 不改 Claw 标题。

### P2：`ConversationProjector`

- **范围**：落实 §3.7 的纯 reducer，输入为帧，输出为 `ConversationView`、受理观测与 rebaseline 信号。
- **文件**：`apps/desktop/src/workspace/conversation-projector.ts`、`apps/desktop/tests/conversation-projector.test.ts`、`apps/desktop/tests/fixtures/p3-frames/*.json`。帧序列由 G2/G4 在 fake 模型下录制并脱敏，只含 fake 文本与结构；在 G 可用之前先手写。
- **测试**：
  - 正常 snapshot → 流 → committed 只出现一个气泡；
  - abandoned；index 跳号、重复 start、`end` 不匹配都会 rebaseline；
  - `seq` 跳号；`replace` 引发 rebaseline；
  - 断线时丢弃临时流；
  - `user/message` 的 rpcId 映射到受理；
  - `turn/end` 各种原因的提示；未知事件；
  - 历史分页 prepend 不重复。
- **风险**：
  - [ ] chunk 形状随 DSH 版本漂移。parser 对未知 chunk 采取跳过加计数，不崩溃。

### AB：`ApprovalBroker`

- **范围**：落实 §3.8：handle 表、generation 切换、校验链、durable 对账、超时、`user-questions` 委托。
- **文件**：`apps/desktop/src/workspace/approval-broker.ts`、`apps/desktop/tests/approval-broker.test.ts`。
- **测试**：
  - 伪造、跨 Bot、过期 generation、已撤回、已决定、Turn 已结束的 handle 一律拒绝；
  - 重连重投后 handle 正确改挂；
  - RPC 成功但随后 `decided` 为 `cancelled` 时，卡片最终为 `cancelled`；
  - 超时会发出 `rejected`；
  - 非 Corn Session 的请求得到 `next`；
  - 没有 `callId` 时按 Turn 内顺序匹配。
- **风险**：
  - [ ] DSH 没有 answerer 时请求会一直 pending。Main 的 `$events` 流断开期间，Host 侧会持续悬挂，必须在 ready 后立即重连。
  - [ ] `reason` 可能包含路径或命令行，展示前截断，且不写日志。

### CS：`ChatService`

- **范围**：落实 §3.7、§3.9：受理状态机、lane、模型对齐、自动与手动重试、撤回、取消（含叶子优先）、follow 生命周期（只跟随当前选中的会话）、启动时的只读恢复、断线重连。
- **文件**：`apps/desktop/src/workspace/chat-service.ts`、`apps/desktop/src/workspace/foreground-stop.ts`、相关测试。
- **测试**（fake Host 与 DB）：
  - IPC 重复 clientId 只受理一次；
  - 回复丢失后的重试复用 requestId；
  - `rejected` 与 `unknown` 两条路径分开；
  - 期望模型与 `modelSelection` 不一致时先 select 再 prompt，同一 lane 内顺序正确；
  - 停止只调用本会话及其子会话；陈旧 Turn 被取消并计数；
  - Host 恢复后 `sending` 转为 `unknown` 并完成对账；
  - DB 写失败时不发 RPC；
  - 切换选中会话时关闭旧 follow。
- **风险**：
  - [ ] follow 会激活 Agent，因此只对选中的前台会话打开。
  - [ ] Host 重启后的“排队未开始”文案依赖 G6 的结果。

### W1：IPC 接线与 Renderer live

- **范围**：`WorkspaceService` 组装 P1/CS/AB 与 DB；`ipc/workspace.ts` 注册各通道；preload 增加 `workspace`；按帧合并推送；`MainWorkspaceRepository`；`CompositionRoot` 路由切换；live 下禁用未接通的功能；`RuntimeAnnouncer` 显示 live。
- **文件**：
  - `apps/desktop/src/workspace/workspace-service.ts`、`apps/desktop/src/ipc/workspace.ts`、`apps/desktop/src/preload.cts`、`apps/desktop/src/main.ts`；
  - `apps/renderer/src/app/{CompositionRoot.tsx,live-repository.ts}`、`apps/renderer/src/fixtures/routes.ts`；
  - 相关测试：`ipc-boundary`、通道一致性、renderer jsdom。
- **测试**：
  - 不可信发送方被拒；多余参数被拒；rejection 不外泄；
  - 推送 revision 跳号后主动拉 snapshot；
  - 打包构建永远不会选到 fixture，dev `#fixture` 仍可用；
  - live 下没有 `fixture`/`mock-created` 标识；
  - 被禁用的入口有说明。
- **风险**：
  - [ ] 公共边界由同一负责人改，避免和 D2 冲突。
  - [ ] M1 的视觉基线要更新的部分留到 V1。

### G：headless 真实 Host 门禁（fake 模型）

沿用 `scripts/gates/lib/*` 的约定：fresh Corn home、loopback fake 模型（`maxRetries: 0`）、scrubbed env、sandbox（真实 bash 时按 B3 的规则不放进 sandbox）、`run.mjs` 设时限、结束后断言清理。**一次只跑一个场景。** 门禁直接驱动 Main 侧的服务（这些服务都是纯 Node），使用临时 DB，**不启动 Electron**。

| 场景 | 内容 | 通过条件 |
| --- | --- | --- |
| G1 创建 | 用 provisioner 创建两个 Bot（一个 research、一个 developer） | 每步断点齐全；Claw 绑定为 `ready`；header 中的 preset 与 cwd 一致 |
| G2 流式 | 一条消息，fake 分段流 | 只有一个气泡，seq 连续，受理为 `observed` 且正文已清，零重复 |
| G3 去重 | 同一 clientId 重复调用；丢弃 prompt 回复后用同一 requestId 重试 | journal 中只有一条 `user/message`，fake 模型只收到一次请求（标题请求另计） |
| G4 审批 | developer 的 Bot，fake 调用 `bash true`；分别做 allowed-once、rejected、伪造 handle、迟到答复 | durable `approval/decided` 与卡片一致；负例不产生任何工具执行 |
| G5 取消 | 流挂起时停止；另一 Bot 的流不受影响；pending 审批变为 cancelled；附带一个子会话和一个作业的变体 | `turn/end aborted`；另一会话 completed；+2 s 时子会话和作业清零；泄漏的请求有计数 |
| G6 重连与重启 | 在流中途断开 WS；SIGKILL Host 后恢复 | 不出现重复消息；临时流不算成功；出现 `interrupted` 提示；受理对账正确；记录排队项的行为 |
| G7 模型隔离 | 见 §5 | 见 §5 |
| G8 重启历史 | 关闭 Host 与 DB 后重开 | Bot、绑定、标签、UI 偏好恢复；先 projections→page 再 follow；历史完整 |

- **文件**：`scripts/gates/p3-*.mjs`、`scripts/lib/fake-model-server.mjs`（如需新 marker 就增补）、`docs/milestones/P3-HEADLESS-GATES.md`（结果）。
- **风险**：
  - [ ] 每个新 Session 的首个 Turn 会额外产生一次标题请求，所有计数都要单列。
  - [ ] developer 策略下的后台作业需要 git workspace（B2 的发现）。

### V1：GUI 联合验收（暂停，待维护者恢复）

正常入口完成：创建 Bot、配置模型、流式回复、一次审批、停止、重开历史、示例标识消失、与 02C/02E-2 视觉基线一起看。一次一个场景，窗口不抢焦点。恢复之前全部保持 pending。

### R1：首次真实模型调用（未授权）

放在 V1 之后，因为 Key 只能通过 Corn 已审查的设置界面（GUI）输入。维护者需要一次性给出：

1. **Provider**：内置 DeepSeek，或某个 catalog/custom route 的 id。
2. **模型 id** 与 `reasoningEffort`（若适用）。
3. **请求上限 N**：包含 DSH/pi-ai 内部重试、每个新 Session 的标题请求、可能的 compaction 请求。若是 custom provider，建议设 `maxRetries: 0`。
4. **停止条件**：例如第一次出现错误、429 或超时就停止，不重试；达到 N 即停止；另设一个金额上限（如需要）。
5. **场景**：建议只做一个 Bot、一条纯文本消息、不触发工具，预计 2 次请求（回复加标题）。审批的真实调用另行授权，因为它依赖模型自行决定调用工具，请求数不确定。
6. **Key 输入**：由维护者在 Corn 设置页手动输入；不读 `model.env`，不在聊天里索要，不写日志。
7. **证据保留**：只保留计数、模型名、时延、结果，不保留正文。

## 5. 模型隔离门禁（§7.3，G7）

**前置**：U1 已合，`selectSessionModel` 只能写 Session 范围；fake 模型服务提供 `corn-gate-model`、`-alt`、`-third` 三个模型；全局默认通过官方 settings 路径设为 `corn-gate-model`。

| 步 | 动作 | 断言 |
| --- | --- | --- |
| 1 | 创建 Bot1（覆盖为 `-alt`）、Bot2（跟随全局） | `modelCatalog().default` 仍是 `corn-gate-model` |
| 2 | 两个 Bot 各发一条 | wire 和 `request/header`：Bot1 为 `-alt`，Bot2 为 `corn-gate-model` |
| 3 | 把 Bot1 的覆盖改为 `-third`，两个 Bot 各发一条 | Bot1 为 `-third`；Bot2 与全局默认不变 |
| 4 | 经官方 settings 路径把全局默认改为 `-alt`，两个 Bot 各发一条 | Bot2 为 `-alt`（发送前完成对齐）；Bot1 仍为 `-third` |
| 5 | 重启 Host 并重开 DB，两个 Bot 各发一条 | 结果与第 4 步相同 |
| 6 | 把 Bot1 的覆盖设为不在目录中的模型 | 进入 `needs_model`，不发请求，不换用别的模型 |
| 全程 | 统计传输层 | `session/selectModel` 中 `scope !== 'session'` 的调用为 0（传输层拦截，测试也计数）；没有“先改后恢复”；fake 服务按模型记账，与预期逐条一致 |

通过后在 ADR-0007 Consequences 第 7 项记为 **headless 通过（fake）**；真实 Provider 的隔离证据属于 R1 之后的另一次授权。

## 6. 退出条件对照

| §7.3 退出条件 | 代码切片 | 自动化证据 | 真实签收 |
| --- | --- | --- | --- |
| 正常页面创建真实 Bot | P1、W1 | 单测 + G1 | V1 |
| 配置模型 | P1、CS（+ 已合的 #15） | 单测 + G7 | V1；真实 Key 见 R1 |
| 真实流式回复 | P2、CS | 单测 + G2/G3/G6 | V1（fake）+ R1（真实） |
| 一次审批 | AB | 单测 + G4 | V1 |
| 取消 | CS | 单测 + G5 | V1 |
| 重开历史 | D1、D2、CS | 单测 + G8 | V1 |
| 示例标识消失 | W1 | jsdom 测试 | V1 |
| 假模型与真实证据分开 | 全部 | `P3-HEADLESS-GATES.md` 只记 fake | R1 单独记录 |

## 7. 待维护者决策（推荐见各项）

1. **DB 驱动**：A `node:sqlite`（内置，免 ABI）；B `better-sqlite3`（原生、成熟、需 unpack/重建）。**推荐 A**，用 `driver.ts` 隔离，按 §3.1 的触发条件改选 B。
2. **迁移工具**：A 手写 SQL + `user_version` + 校验和台账（Signal 模式）；B Drizzle（`node-sqlite` 仍是 beta）；C Kysely（无一方 `node:sqlite` 方言）。**推荐 A**，P4 表变多时再评估 B。
3. **打包环境的 SQLite 证据**：A 在 CI 托管 macOS runner 的 desktop/packaged smoke 中加入 SQLite 事实；B 等本机 GUI 恢复后再跑。**推荐 A**，不占本机窗口；本机 packaged 仍记 pending。
4. **`synchronous` 级别**：A `FULL`；B `NORMAL`。**推荐 A**。写入很小，掉电时也不会丢已提交的受理记录，避免同一消息以新 requestId 重复发送。
5. **未确认消息的正文是否落库**：A 落库，observed 后置空（文件 0600）；B 只在内存，重启后要求用户重输。**推荐 A**，否则 `unknown` 状态无法安全重发。
6. **新 Bot 的策略 preset**：A 固定用 Claw 默认（research），不新增路由；B 创建时二选一（research 或 developer），白名单精确加入 `registry/policy`；C 开放完整权限编辑。**推荐 B**，默认 research。审批验收需要 developer；C 留到 P7。
7. **live 下的职责/工作风格/分组/标签**：A 标签落库，职责与工作风格禁用并标“后续开放”，分组不做；B 职责与工作风格也存进 Corn DB 但不注入 Agent；C 全部禁用。**推荐 A**。B 会让 UI 显示一个 Agent 并不知道的设定。
8. **“停止”的范围**：A 只取消 Turn；B 取消 Turn，并按叶子优先停止本对话 Session 自己的子会话和作业。**推荐 B**，否则停止后作业仍在跑，与用户预期不符；其他 Session 不受影响。
9. **审批超时（C4）**：A 无超时；B Corn 侧 30 分钟后回复 rejected；C 10 分钟。**推荐 B**，避免 Turn 无限挂起，又给用户足够时间。
10. **Renderer 推送方式**：A `webContents.send` 加按帧合并；B MessagePort。**推荐 A**。前台流量很小，B 带来端口生命周期与重载的复杂度；有性能证据再换。
11. **跟随全局的语义**：A 每次发送前把 Session 对齐到当前全局默认（只写 Session 范围）；B 只在创建时继承，之后固定。**推荐 A**。U1 没有“回到跟随”的事件，B 会让全局修改对老 Bot 静默失效。
12. **数据损坏或迁移失败**：A P3 只检测、停用并写 runbook；B P3 就做“从备份恢复”的 UI。**推荐 A**，恢复 UI 放到 P8 数据迁移包。
13. **Bot 删除**：A P3 不做，只能隐藏；B 做归档。**推荐 A**。归档牵涉 Claw workspace 与 Session 的处置，单独设计。
14. **每个 Bot 的会话数**：A 单主会话（schema 预留 kind）；B 多会话。**推荐 A**。
15. **首次真实调用的形态**：A 单 Bot、单条纯文本、无工具，上限 3 次请求，出错即停；B 同时验证审批。**推荐 A**，B 另行授权。
16. **`registry/create` 结果未知时的修复**：A 只在恰好一个精确候选时自动收养，否则报告孤儿；B 一律不收养，交由人工处理；C 按名称取最新的一个。**推荐 A**。C 可能收养错误的 agent。
17. **开发环境的 DB 位置**：A 由 `CORN_DSH_HOME` 推导出同级的 `-data` 目录，可用 `CORN_DATA_DIR` 覆盖；B 固定为 `~/.corn-bot-dev/data`。**推荐 A**，每个 worktree 自动隔离。

### 7.1 决策记录（2026-10-12）

维护者确认：上面 17 项全部按推荐执行，即 1A、2A、3A、4A、5A、6B（默认 research）、7A、8B、9B、10A、11A、12A、13A、14A、15A、16A、17A。R1 的形态（15A）只定下范围，真实调用本身仍需维护者给出 Provider、模型 ID、请求上限和停止条件后单独授权。

同日另两项 ADR-0007 相关决定：

- **方案 C 探针已授权**：C1 `agent/pre-step` 停止闸门在父会话空闲时的 B6-idle 探针，headless、fake 模型、一次一个场景；同时统计模型请求与压缩请求。0 次泄漏才把 C 纳入 C1，原型只留在探针分支。
- **仅泄漏请求时仍可进入 `cancelled`**：没有其它残留、只有泄漏的模型请求时，Run 可进入 `cancelled`，泄漏数记在停止审计里（与 ADR-0007 2026-10-12 补遗一致）。

## 8. 安全与运行约束（全部切片适用）

- 不读 `~/.corn-bot-dev/model.env`、`~/.dsh`、`/Applications/DeepSeek Harness.app`；不发生付费调用；不记录密钥、cookie、`$events` clientId、Host 原文、提示词正文。
- 本机 GUI、Electron、packaged 运行全部暂停。headless 门禁只用 fake loopback 模型，一次一个场景，负载过高时停止增加。
- IPC 只暴露产品命令，不暴露通用 RPC、fetch、SQL 或路径；Main 对每个请求重新校验。
- 每个 PR 写明：行为、接口与数据变更、实际跑过的验证、未跑项、安全限制。执行者不做自审闭环，由独立 reviewer 审查后按 merge commit 合并。
