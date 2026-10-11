# Corn Bot 右侧管理面板实施计划

日期：2026-10-11（Asia/Shanghai）。状态：**待执行，未修改产品代码，未声明真实 Claw 配置接通。**

模型配置后续修复采用[官方能力接入计划](CORN_MODEL_CONFIGURATION_FIX_PLAN.md)：全局 Provider/凭据/默认模型从 fixture 转为 DSH 权威事实，可在完整 M2 Bot 接线前独立交付；本计划 03B 的 Bot 模型仍依赖真实绑定，避免 `session.selectModel` 改全局默认。

基线：main `d28f085`（PR #7 合并）。本轮文档位于 `docs/bot-management-plan`；头像、runtime、U1 各自已有工作分支，本计划不修改那些工作区。主计划 §14 决策 13 / §16 引用本计划；原素材接入增量继续使用 §15。

## 1. 产品决策与界面结构

保留聊天右侧的头像、名字、标签、分享与关闭按钮，以及现有两栏/三栏/窄窗 overlay 布局。将当前“详情 / 资料库 / 电脑”改为 **“概览 / 配置 / 资料库”**。Claw 的 Bot 管理能力在 Corn 自有组件中呈现。

```text
当前 Bot：头像 · 名称 · 标签 · 来源标记
概览 | 配置 | 资料库
概览：职责摘要、工作区、当前状态、例行任务
配置：核心设定 → 模型 → 权限 → 技能（分区列表进入子页）
资料库：资料 | 记忆（资料库内部的两个分区）
配置 / 权限 / 本机操作 → 按需打开操作视图（M3）
```

配置首页用四个带摘要的入口行，在现有面板内进入子页，提供“返回配置”。不在窄面板顶部塞进六个并列主 Tab。Bot 已由左侧选中，管理面板不再增加一个全局 Agent 下拉框。复制 ID 只放概览，明确区分 Corn Bot ID 与已绑定的 Claw Agent ID；未绑定（含示例 Bot）时不展示虚构的 Claw Agent ID。刷新针对当前分区。归档/恢复另列后续生命周期任务，不开放删除或全局 leave-behind 设置。

| 分区 | 展示内容 | 写入/阶段 |
| --- | --- | --- |
| 概览 | 职责、工作风格摘要；工作区展示名；实际绑定/会话及运行状态；模型/权限摘要；例行任务 | M1 使用来源明确的 fixture；M2 接真实绑定/运行事实；M6 接真实例行任务。未知计数显示“尚未接通”，不填假 0 |
| 配置 → 核心设定 | 基本资料；行为与身份设定（SOUL、IDENTITY、AGENTS、TOOLS、HEARTBEAT 的友好名称和说明） | M1 复用已有名称/职责/工作风格编辑；高级文件内容只作开发 fixture 或未接通状态。M2/后续提交经已验证的 Claw Identity 接口读写 |
| 配置 → 模型 | 跟随全局 / 此 Bot 覆盖；当前生效模型；目录及不可用原因 | M1 复用当前模型编辑器；M2 接正式目录与 Bot 模型设置。全局设置仍在 Settings，不在此页录入 API Key |
| 配置 → 权限 | 策略预设、能力矩阵、当前生效权限与硬上限；本机操作能力 | M1 权限只读，保持现有禁用解释；M2 通过 Claw Policy 真实保存并回读；M3 接本机授权/控制状态 |
| 配置 → 技能 | 可发现的技能、此 Bot 禁用项、不可用原因 | M1 正常页面明确未接通，开发路由可有样例；M2 能从已验证目录读取时开放只读列表，M7 做可操作的启用/禁用与连接器管理。技能安装留在全局能力管理 |
| 资料库 → 资料 | 用户提供的资料、Bot 成果、来源与关联任务 | M1 空/加载/失败 fixture；文件索引、受控打开与真实预览继续在 M7 |
| 资料库 → 记忆 | 关于用户（USER）、长期记忆（MEMORY）、按日期的日记、待确认记忆 | M2 先做当前 Bot 的受控只读查询；变更、待确认操作按接口审计结果另提交。Claw Memory 设置属于全局范围，移至 Settings，不在此处伪装成单 Bot 设置 |

核心设定与记忆共用文件目录规则，USER/MEMORY/日记归记忆分区；核心页提供跳转，不出现两份独立编辑器。资料文件、模型对话日志和长期记忆分别保留各自来源，不自动合并成“知识”。

## 2. 当前代码与原 Claw 参考事实

- `apps/renderer/src/features/details/BotDetailsPane.tsx` 当前只有三个空状态；`⋯` 提供资料、标签、模型、权限入口。
- `apps/renderer/src/app/layout-state.ts` 使用 `details | library | computer`，按 Bot 保存 Tab；普通草稿/消息滚动也在该模型中。面板占总宽约 36.7%，窄窗变 overlay。
- `features/bot-editor/` 已有 `BotProfileDialog`、`BotModelDialog`、`PermissionsDialog` 和表单逻辑；Renderer 写入经 `WorkspaceRepository`，当前为 fixture。复用表单/业务逻辑，抽出可嵌入内容，不复制两套保存实现。
- `packages/dsh-adapter/src/claw-registry-client.ts` 已封装 create、preset/ensure、revision、bind、session state；核心/记忆/策略/技能读写尚未封装为 Corn 管理契约。
- 原 Claw 面板参考来自**锁定发布包**中的 `dsh-claw-registry/package/registry-settings.mjs` / `host.js`，以及 Identity/Memory 的 `host.js`。仅研究行为和已公开路由，不复制 Claw 的组件、实现或 CSS。

研究产物位于主 checkout `.runtime/claw/dsh-claw-suite-0.3.0-rc.2`，发布 tar SHA-256 为 `99ea3c2007e36345e9b97874e8fb8f0337f607fdfb017bcaaea25fd1ef5808cb`，与 `runtime.lock.json` 一致。以下只证明源码存在接口，**不证明 Corn 已完成调用或可写验收**：

| 能力 | 在锁定发布包中看到的公开路由 | 接入前重点 |
| --- | --- | --- |
| 概览/诊断 | `/api/dsh-claw/registry/list`、`diag` | 字段来源、绑定状态、仅展示当前 Bot 的安全信息；list revision 不当作 Gate 生效证据 |
| 核心 | `/api/dsh-claw/identity/read`、`write` | 接口使用 root；root 由 Main 根据 Bot 绑定解析；写文件白名单，USER/MEMORY 不走 Identity |
| 模型 | `/api/dsh-claw/registry/models`、`model` | inherit/provider/model/reasoning 字段、真实生效时间及目录验证；不让此 Bot 的选择意外改全局默认 |
| 权限 | `/api/dsh-claw/registry/policy` | 有部分写入失败的场景；保存/回读/有效策略及硬上限都要验证 |
| 技能 | `/api/dsh-claw/registry/skills` | 已看到的是 agentId + deny 列表写入，不等于完整技能目录/安装接口；目录发现需另核对 DSH 公共能力 |
| 记忆 | `/api/dsh-claw/memory/read`、`write`、`settings` | read/write 以 root 定位 Bot；settings 不带 Bot root，属于全局设置；action/vault/date、待确认操作及边界逐项审计 |

现有 session bind/state 等接口出现 `expectedRevision`，以上配置写接口不能据此推定具有相同原子并发语义。实现前记录每个接口的版本/冲突/幂等及部分成功行为；Main 串行写入只解决 Corn 内的并发，不冒充 Host 端 CAS。需要 Claw 侧补能力时在 Claw 仓库单独实现、发布和升级 lock；不在 Corn 内复制逻辑或悄悄新增私有路由。

## 3. 导航、状态和编辑行为

1. 新导航 ID：主 Tab 为 `overview | configuration | library`；配置子页为 `home | core | model | permissions | skills`，资料分区为 `artifacts | memory`。维护单一目录，标签、键盘导航、快捷入口和恢复校验均从该目录读取。
2. 旧 `details → overview`，旧 `library → library/artifacts`，旧 `computer → configuration/permissions`；未知值回概览。当前只在 Renderer 内存保存，未来 M2 持久化再使用同一正规化函数迁移，避免误称已有数据库迁移。
3. 按 Bot 保存最后主 Tab、子页和分区滚动位置；配置编辑草稿不跨 Bot 静默保留（聊天草稿的按 Bot 保留规则不变）。切 Tab、关闭面板或切 Bot 时若有未保存配置，提供“保存 / 放弃 / 取消”；保存失败保留当前草稿且不切换，取消则停留原处。Key 不进入任何跨 Bot 草稿，离开编辑器即清理。未接通的功能没有假保存。
4. 异步请求、保存目标固定为发起时的 botId/字段，使用读取代次和取消机制；A 的迟到结果不能覆盖 B 的内容、关闭 B 的编辑器或改 B 的焦点。关闭操作已发出的写请求不能被当成已撤销；以回读事实显示结果。
5. 每分区分别支持 loading/empty/error/read-only/unavailable，刷新只更新当前 Bot 的相应读取。错误、权限不足及断线给安全原因，不用空页代表加载失败。
6. 模型和权限从 `⋯` 主入口迁入配置页。`⋯` 保留导出等低频操作（复制 ID 只在概览）；快捷键、旧编辑入口和审批卡“权限设置”链接都导航到当前 Bot 的配置子页，共用业务逻辑。
7. 资料/标签编辑保持现有能力；头像选择依赖 02D-1 的统一组件和选择器。配置页不得修改全局头像偏好或其它 Bot 的模型。
8. 主 Tab 是 ARIA tablist，配置入口是普通导航按钮，不做层层嵌套的假 Tab。返回后焦点回到原入口，打开子页聚焦标题；键盘左右/Home/End 支持主 Tab，弹层 Escape 先关闭最内层。runtime 播报继续使用 U1 的稳定 Shell 层，不在每个子页重建 live region。

## 4. 文件级实施拆分

以下是拟新增/调整文件，不代表它们已经存在。

| 文件 / 目录 | 职责 |
| --- | --- |
| `features/details/BotDetailsPane.tsx`、`details.css` | 保留面板外壳/头像/header，接三主 Tab 与分区内容；按新内容更新内部滚动而不改变总宽规则 |
| `features/details/details-navigation.ts`、`apps/renderer/tests/details-navigation.test.ts` | 单一导航目录、旧值正规化、快捷入口解析；测试置于现有根命令实际扫描的 tests 目录 |
| `features/details/overview/BotOverview.tsx` | 来源标记、职责摘要、工作区、运行/任务概览；绑定与运行状态分别展示 |
| `features/details/configuration/{BotConfigurationHome,CoreSettingsSection,ModelSettingsSection,PermissionsSection,SkillsSection}.tsx` | 四入口和子页，不嵌套多个 modal；分别加载和显示能力边界 |
| `features/details/library/{BotLibrary,ArtifactsSection,MemorySection}.tsx` | 资料与记忆两个分区，独立读模型和空/失败状态 |
| `features/bot-editor/*` | 抽取可嵌入的表单内容/控制逻辑；原 Dialog 成为兼容外壳或移除使用点；保留 #7 已修好的 focus、busy、冲突及关闭行为 |
| `app/{layout-state,CornShell,OverlayHost}.tsx/ts`、`features/chat/ApprovalCard.tsx` | 按真实文件扩展导航状态、快捷入口及取消/返回；不改聊天 delivery/审批答案语义 |
| `model/{workspace,repository}.ts`、`fixtures/{fixture-repository,m1-workspace,ui-states}.ts` | credential-free 管理视图与明确 fixture；M1 用既有命令；新增读模型不把虚构 ID/路径表示为真实绑定 |
| `packages/contracts/src/bot-management.ts`（M2） | Bot 绑定、只读概览、核心/记忆/模型/权限/技能的窄 DTO 与明确命令；分区能力状态、资源版本信息 |
| `packages/dsh-adapter/src/{claw-identity-client,claw-memory-client,claw-policy-client,claw-skills-client}.ts`（M2/M7） | 已验证的公开接口适配；模型优先扩展现有 Registry client；Schema/错误/部分成功处理 |
| `apps/desktop/src/ipc/*`、`security/ipc-allowlist.ts`（M2/M7） | 受信 Main 解析 botId→agentId/root，检查绑定与操作白名单；Renderer 不获得任意 endpoint、路径或密钥 |
| `packages/local-db` / 真实 WorkspaceRepository（M2） | 持久化 Corn 的偏好/索引及最小恢复信息；Claw 配置和 DSH 日志保留其权威来源，避免出现第二份互相漂移的配置 |

当前 `app` 文件后缀分别为 `layout-state.ts`、`CornShell.tsx`、`OverlayHost.tsx`；表中集合只是文件级分组，不要求创建混合后缀的新文件。

## 5. PR 顺序与现有并行工作的衔接

| 工作包 | 时机 / 依赖 | 交付与门禁 |
| --- | --- | --- |
| 02E-1 管理面板导航与现有编辑器 | 从当前 main 开独立 feature 分支，先做导航与共享表单；runtime/U1/02D-1 可并行；头像接入与最终联合验收在 02D-1 合并后 | 三主 Tab、配置四分区、资料/记忆容器、旧值正规化、现有 fixture 编辑和只读权限；skills/记忆真实功能仍显示未接通；更新右侧视觉基线 |
| 02E-2 交互/视觉验收 | 02E-1 + U1 + 02D-1 接入后 | Bot 隔离、草稿/焦点/迟到请求、键盘、窄窗、固定提示、区域快照；02C 最终金标包含本次主动变化 |
| 03B 管理数据与第一批真实接线 | M2 的真实 Repository/IPC/绑定/Session/Run 基础可用，runtime R1–R3 关闭；先核查上述 API | 概览、核心/记忆只读、真实模型和有效权限读取；经接口语义验证的配置写入作为独立提交，失败/部分成功可恢复；不要求付费对话才能做所有管理测试 |
| M3 本机操作入口 | M2 已有持久 Run 与 lease 基础，Provider 实机门禁通过 | 配置→权限→本机操作；当前 Run 卡/聊天状态可直接打开独立操作视图，提供画面、暂停、接管；主 Tab 不恢复“电脑” |
| M6/M7 后续完整能力 | 按原阶段依赖 | 概览例行任务、资料成果、技能及连接器操作；记忆写入/待确认管理经公开 API 验证后接入 |

02E、03B 是计划工作包名称，不是 GitHub PR 编号。02E-1 可先在占位头像上开发导航并按统一接口接入；不等待 02D-2 动画或全部 runtime 修复才开工。合并时集中处理 `BotDetailsPane` 的 avatar 使用点与 U1 布局变化。管理面板文件由 02E 负责人修改，02D 只提供头像组件/适配；最终联合验收不能各看旧截图。

02C 可以先完成聊天/列表不受影响区域；管理面板、头像和 U1 提示区域的最终基线在集成后冻结。新增面板不替代 R1–R3/U1 关闭证据，也不提前启用 PTC。§14 已推迟的群组详情、深色主题和任务线程保持原阶段。

## 6. 本机操作与现有 M3 计划的协调

移除“电脑”主 Tab 是信息架构调整。本机浏览器/macOS 控制仍保留原 M3 的 Driver、Gate、Run、设备级独占租约和用户接管要求。操作视图可从配置/权限或正在执行的 Run 进入；关掉右侧面板或预览不自动取消任务，停止/接管按真实控制协议生效。

Claw 策略授权与 macOS 系统授权分开展示，不把 UI 开关当作系统已授权。M1 展示当前未接通原因，M3 才显示实际授权/控制状态；屏幕内容仅在受控操作视图读取，不把每个 Bot 描述为拥有一台云端电脑。

## 7. 验收与证据

- **导航**：旧 Tab 正规化、按 Bot 恢复、复制 ID/刷新/快捷入口、配置返回均有效；无效配置子页回配置首页。开关面板不改变草稿、选中 Bot 或聊天滚动。
- **编辑**：名称/职责/工作风格/模型 fixture 可保存和失败恢复；同 Bot 多编辑入口不产生两份互相覆盖的状态；未保存提示、保存中关闭、A→B 切换、A 迟到响应、重复提交和版本变化均覆盖。权限在 M1 继续只读，技能/记忆不伪成功。
- **模型/权限真实接线**：全局与 Bot 覆盖隔离；目录失效有明确状态；策略保存回读与实际工具治理匹配；硬上限和 RC2 审批结果保持一致；部分写入失败不能只弹“已保存”。
- **资料/记忆**：当前 Bot 绑定校验；未绑定 Bot/路径绕过/另一 Bot 的 ID 拒绝；全局 Memory 设置不受单 Bot 操作改变；未知、空、断线和异常响应分别展示。
- **视觉与访问性**：1024×764 两栏/三栏、720×520 overlay、折叠名单、长中文标题、长配置正文、面板滚动；左栏 276 px 与详情总宽比例保持；子页无横向溢出，焦点可见，键盘可返回，U1 固定提示不被遮挡或重复播报。
- **回归**：`pnpm check`、`pnpm build`，新增 package 测试实际进入根级入口；真实 Electron layout smoke；相关更改打包后 `smoke:packaged`。02E 只证明 fixture UI；03B 才用真实隔离 Corn profile 证明 API/权限/重启恢复。
- **文档**：更新主计划、M1 checklist、`design/design-spec.md`、`design/grok-kit/SPEC_MAPPING.md`/coverage，并记录右侧内容为用户主动改变的区域；不改历史 02B 证据为“已实现新面板”。私有原 Claw 截图只作本地输入，不复制到 Git。

## 8. 执行 Agent 清单

1. 读取本计划和 §14 决策 13，先列出当前分支基线与已有未关闭 review；对照 02D/U1 的公开组件接口。
2. 做 02E-1，复用现有模型/资料/权限业务逻辑，提交可 review 的导航和嵌入编辑器；只新增必要 fixture 状态。
3. 集成 U1/02D-1，做 02E-2，更新受影响区域视觉基线并报告布局/交互回归。
4. M2 前完成 route/action/scope/concurrency/partial-result 的审计表，分只读与写入提交；仅通过已验证能力开放保存。
5. 分别报告 fixture UI、真实 Claw 调用和本机操作的验证范围；空页面改了名称不算管理能力交付。

## 9. 已确认决策（2026-10-11）

| 问题 | 决定 |
| --- | --- |
| 02E-1 开工时机 | 不必等 02D-1 合并。从当前 main 开分支，先做导航与共享表单；头像接入和最终联合验收放在 02D-1 合并后 |
| 复制 ID | 只放概览。明确区分 Corn Bot ID 与已绑定的 Claw Agent ID；未绑定时不展示虚构 ID |
| 切换 Bot 时的未保存配置 | 不静默保留。提供“保存 / 放弃 / 取消”；保存失败保留当前草稿且不切换。Key 不进入跨 Bot 草稿，离开编辑器时清理 |
