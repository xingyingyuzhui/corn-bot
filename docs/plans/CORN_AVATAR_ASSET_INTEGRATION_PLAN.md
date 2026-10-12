# Corn 头像素材与 App 图标接入计划

日期：2026-10-11。用户要求将已制作的素材与修正版图标纳入下一步开发；本文件细化主计划 §15、PR-02D 和 PR-03A。

**2026-10-12状态：02D-1静态头像、角色选择器和App图标已在PR #9合入main；02D-2动态组件尚未实现，Finder/Dock/App switcher人工验收及最终视觉验收待完成。** 素材包测试不代替App验收。当前顺序以[后续统一计划](CORN_BOT_FORWARD_PLAN.md)为准；下文的旧分支/先合#7指令仅保留历史背景，素材锁、渲染契约和验证范围继续有效。

## 1. 锁定本轮输入

源目录：`/Users/qin/DSH/Corn Bot/design-assets/corn-avatar-kit-v1`。交付包：`/Users/qin/DSH/Corn Bot/design-assets/corn-avatar-kit-v1.zip`。接入时将选定源文件和发布资产迁入 Git 仓库；开发、CI 和最终 App 均从仓库内读取。

| 输入 | 用途 / SHA-256 |
| --- | --- |
| `assets/app-icon.png` | 正式候选 App 图标；对应外部 `corn-bot-app-icon-v3-eyes-fixed.png`。`4b783687756c2c104b94ced8e609ca170d3c609108052665e4faa2f3354d2942` |
| `src/artwork.ts` | 原创 SVG 几何、配色、16 角色。`642d014ca54a310a761d6e998cf2460678b725973bcad2ca2c1bc24987670061` |
| `src/avatar.ts` | 18 状态与动画控制器的接入起点。`075f81274ca4b9717235c7be4c6f659fd0670cd689c352f8b1296a0f7eb8e314` |
| `assets/catalog.json` | 角色/轮廓/状态/群组目录。`a539555892cb2ec1521fe2e99a6ac188185716ad05d63396772968b446e5536f` |
| `assets/manifest.json` | 其余生成资产及源码的逐文件 SHA-256 |
| `tests/avatar.test.mjs`、`docs/verification.md` | 独立素材包已有检查，迁入后补 App 级检查 |

视觉要求：平面玉米、金黄色主体、简化苞叶、黑色胶囊眼睛。默认眼睛为 **`/`，上端向右、下端向左**；不采用早期写实版本或眼睛方向错误的 v2，不改回写实 3D。

范围为 16 角色、9 原创轮廓、18 展示状态、288 角色状态采样、5 群组及 1 总览，共 337 个 SVG。这代表素材覆盖，不代表已经注册了 16 个真实 Bot，也不代表原 Grok 全状态复刻。总览、画廊与全量采样用于设计验收；产品按需要引入，避免将整个演示画廊打包。

## 2. 下一步顺序与依赖

1. 先完成 PR #7（PR-02B）的 review 与合并。合并后，从同一 main 基线分别开 runtime R1–R3 修复、U1 固定提示与 PR-02D-1 分支，允许并行；runtime finding 关闭不是 02D-1 的开工前置条件，但仍是阶段验收条件。PR-02C 继续完成布局/交互门禁，不以新素材替代这些检查。
2. **PR-02D-1：静态头像与 App 图标。** 迁入原创资产、锁定来源、确定角色默认映射、替换统一占位组件，并产出 macOS 图标。接入改变头像区域的视觉基线，需明确记录这项设计变化；布局尺寸仍按现有金标。
3. **PR-02D-2：React 动画接入。** 基于同一原创几何实现动态/静态/上传图渲染、统一生命周期与状态 fixture，完成单元、视觉和负载验证。可在 02C 期间有序开发；M1 收尾必须包含 02C 和完整 02D 的证据。
4. **PR-03A（M2）：真实事件驱动。** 在 PR-02C 门禁通过、PR-02D 接入完成和真实 Session/Run 适配具备后，连接 DSH/Claw 状态。
5. **PR-09A（M8）：发布复查。** 再次核查资产来源、构建清单与签名/公证后的实际图标；M1 先验证未签名开发 `.app`。

## 3. PR-02D-1：仓库资产、静态头像与 macOS 图标

| 文件 / 目录 | 实施内容 |
| --- | --- |
| `packages/contracts/src/avatar.ts`（新建） | 统一 18 状态、9 轮廓、角色 variant 与头像偏好；替换主计划旧 provisional shape 名称，避免契约与素材包各维护一套枚举 |
| `packages/ui/package.json`、构建配置（新建） | 建立正式工作区包，接入 renderer 和根级检查；发布代码编译自迁入的 TS，不引用外部设计目录或 Kit 的 `dist/avatar.js` |
| `packages/ui/src/avatar/artwork.ts`（新建） | 迁入并适配 Corn 原创几何；独立稳定 SVG ID，多个同角色实例不冲突 |
| `packages/ui/src/avatar/variants.ts`、`StaticAvatar.tsx`、`BotAvatar.tsx`（新建） | 角色目录与统一入口；AvatarSpec 显式保存 variantId，不按可编辑的 Bot 名称猜角色；旧记录或未知 variant 回退现有首字/色相占位 |
| `packages/ui/assets/avatars/`、`groups/`（新建） | 选定静态 Bot 与群组 SVG；群组素材先归档，M1 不新增群组详情或真实群组能力 |
| `apps/renderer/src/model/workspace.ts`、`src/fixtures/{m1-workspace,fixture-repository}.ts` | 扩展当前 `AvatarSpec { initial, hue }` 占位模型；已有记录经显式适配保留有效 fallback，新增 Bot 有明确默认 variant；账户/用户头像保持各自语义 |
| `apps/renderer/src/shared/Avatar.tsx`、`avatar.css` | 作为现有使用点的兼容适配器，逐步委托 `BotAvatar`，保持容器尺寸与布局 |
| `apps/desktop/assets/app-icon-source.png`（新建） | 迁入锁定的 v3 PNG；记录生成工具、提示词方向与来源，检查透明边缘和小尺寸可读性 |
| `scripts/generate-app-icons.mjs`（新建） | 先将同一源图缩放并居中置于 1024×1024 透明画布，再生成 16/32/128/256/512 pt 的 1×/2× iconset 与 ICNS；以约 824×824 主体区域为 legacy 图标初始参数并对照 Apple 模板/实际 Dock 调整，记录最终参数及派生产物哈希；保留长宽比，避免二次加圆角 |
| `apps/desktop/electron-builder.config.ts`、`scripts/package-macos.mjs`、必要时 `src/main.ts` | 配置 macOS icon 的仓库绝对解析路径，确保 staging 时文件可用；开发 Dock 与 packaged App 使用同源图标；核验 `.app` 实际图标资源与 Info.plist 引用 |
| `design/corn-assets/ASSET_LOCK.json`、`PROVENANCE.md`（新建） | 记录上述源哈希、角色目录、来源及迁入路径；适配后的代码另记录新哈希，不冒充字节相同 |

需通过统一组件覆盖现有使用点：`BotListItem` 32 px、`HiddenBotsSection` 24 px、`RosterRail` 36 px、`PinnedBotCard` 52 px、`ConversationHeader` 24 px、`BotDetailsPane` 60 px、`BotProfileDialog` 48 px、`HandoffNotice` 14 px。`BotRoster` 的账户头像 30 px 保持账户偏好，不因使用同一旧组件而被强制改成 Bot。

同一 Bot 在列表、标题、详情、收藏卡中的 variant、颜色和 seed 一致；小尺寸简化装饰但保留眼睛方向。13 个现有示例 Bot 显式配置对应 variantId；新建 Bot 按稳定 Bot ID 哈希，从锁定顺序的非小黄 15 个角色中选默认值并存入 AvatarSpec，创建/编辑允许用户从全部 16 角色选择。缺少/未知 variantId 的旧记录回退现有首字/色相占位，不自动套用小黄。稳定哈希不因重命名、重渲染或编辑顺序变化而改变头像。

PR-02D-1 仅做角色选择器，写明确标识的 fixture；头像上传保持禁用，原因改为“在 M2 接通”。M2 再实现受控资产访问、上传/解码失败回退与持久化；02D 可先定义 UploadedAvatar 接口并测试受控图片 fixture，不开放本地上传或临时 object URL 功能。

**本阶段验收：** 16 角色/9 轮廓静态总览和全部使用尺寸通过；列表/标题/详情统一且不引入布局漂移；未知 variant 与旧占位记录可显示；用户图片保持原貌；从 clean checkout 可生成图标和完成打包；Finder、运行中 Dock 与 App 切换器检查来自新 `.app` 的图标，小尺寸无明显裁切、边缘杂色或变形。用户现有 App 的缓存显示不能当作新包的验收证据。

macOS 图标采用上述 ICNS 路径（选项 A），本轮不新增 Icon Composer/Xcode 工具链，也不重做分层源图。约 824 的主体尺寸是候选 legacy 布局参数，不是 macOS 27 自动处理的保证；如新 `.app` 实测出现额外底板或异常尺寸，继续调整透明留白/边缘并复验，不能仅以 ICNS 成功生成宣告验收。设计依据：[Apple App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)。源 PNG 的锁定哈希保持不变，规范化输出另记哈希。

## 4. PR-02D-2：动态组件与 App 级验收

- 按主计划 §13.4 拆成 `AvatarRenderer`、`CornMotionAvatar`、`StaticAvatar`、`UploadedAvatar`、`motion-presets`、`motion-scheduler` 和 `useAvatarLifecycle`；复用原创素材几何与表情算法，接入 React 生命周期，统一调度。当前独立控制器每实例 RAF 的实现需要按 ADR-0003 适配，不能仅复制控制器就宣称完成架构要求。
- `setState`/偏好变化更新现有实例，稳定 seed 来源为 Bot ID/持久偏好；同一 Bot 的多个可见实例拥有不同 SVG ID。`spin` 真正转一圈且不裁切，`bounce/burst` 受动效设置约束。
- 隐藏、离屏、系统减少动态、App 设置关闭动画时采用静态渲染；StrictMode 双挂载、切 Bot、关闭详情、销毁窗口后清理 RAF、观察器和监听器。静态路径不加载动画运行时。
- 在开发专用 fixture 路由展示 16 角色和 18 状态；正常 M1 UI 保留示例标记。5 群组素材只作素材预览，不扩展已推迟的群组功能。
- 新增/迁入 avatar contract、shape、lifecycle 测试；在当前根级 `pnpm test`/typecheck/build 中实际纳入新 package 测试，防止只在独立包里通过。保留原 9 项测试覆盖，再补 React 与多使用点检查。
- 固定 seed/虚拟时钟/DPR 做头像区域快照，先静态后时序；在两栏/三栏、窄窗、折叠列表与 20+ Bot 场景测帧耗时/内存和资源清理。性能基线以目标 Mac 实测记录。
- 上传图、原名文本与邻近状态提示继续可用；动画表情不能替代可访问的错误或审批文本。

**合并证据：** `pnpm check`、`pnpm build`、UI 资产审计、上述 React/视觉/负载检查，以及 `pnpm package:mac` / `pnpm smoke:packaged` 对新提交的结果；报告静态、fixture 动态与 packaged 图标各自状态，缺少的手工检查写明。独立素材包测试通过不直接勾选 M1 验收。

## 5. PR-03A：真实业务映射

`packages/state/src/avatar-presentation.ts` / `avatar-state-reducer.ts` 消费经过校验的真实 Session/Run/Gate 事件，采用 §13.5 优先级：审批阻塞 > 错误 > 语音 > 推理/工具 > 消息 > 完成短态 > 待命。状态按 Bot/Run 隔离，处理乱序、重复、重连和短态 TTL。

`session.prompt` accepted 只表示入队；只有真实完成事实触发 `happy/celebrate`。Host 断线保留可靠投影并显示离线信息，不触发成功；未知推理/工具细节显示可证明的状态。该层不改变 Gate 权限、PTC 禁用决策或 Runtime 隔离边界。

## 6. 文档收尾

同步主计划、M1 PR checklist、ADR-0003、`design/design-spec.md`、UI coverage 和开发 runbook；在 M1 证据中列出本次头像区域的主动视觉变化与仍未接通的业务状态。PR-09A 核查最终产物仅含选定 Corn 资产与代码，不含 Kit 提取资源、设计演示画廊或外部绝对路径依赖。

## 7. 开工决策补充（2026-10-11）

- 本轮计划/清单文档不进入 PR #7。#7 合并后，将这些文档改动迁到 02D-1 分支，作为第一个提交；迁移前保留当前改动，不随 #7 的代码提交带入。
- U1 从 #7 合并后的 main 单独开分支；runtime R1–R3 另开分支。共用的 RuntimeView 安全错误码契约由 runtime PR 提供；U1 可先按现有契约和 fixture 做布局、语义状态去重，最后集成错误码并复验。U1 的布局/状态区域变化需进入 02C 视觉基线。
- `apps/desktop/src/main.ts` 的重叠改动按 runtime PR → 02D-1 图标改动的合并顺序处理；02D-1 静态素材/图标产物可先独立实施。
- 现有四个直接使用 Supervisor 的 smoke：`smoke:cold` 走基础 bootstrap，明确不证明 Claw 就绪；`smoke:host`、`smoke:model`、`smoke:model-lifecycle` 走正式治理启动入口，每次启动/重启都验证 profile、Claw 和 child 代次。`smoke:governance` 虽使用独立临时 profile/测试 patch，也须复用正式 profile/Claw 校验，不归入无治理 bootstrap；`smoke:packaged` 继续走真实 App 正式入口。只有 setup/template 构建及基础 cold 测试使用 bootstrap，安装后的正式检查仍必需；不增加普通 App 可选择的跳过治理开关。
- R1/R2/R3/U1 回归可按场景扩展现有 smoke 或独立放 `scripts/`，根 package.json 提供入口和 `pnpm smoke:review` 汇总。普通 `pnpm check` 保持 lint/typecheck/unit；Electron/进程 smoke 单独执行，CI 中用 macOS smoke job；失败或缺少必需场景时汇总退出非零。付费模型测试不加入默认汇总，也不因本轮启动修复自动调用。
- U1 播报在 CompositionRoot/稳定 Shell 层维护上一次语义状态，单一 runtime live region，`polite`/`atomic`。运行时去重键为状态与安全错误码（桥接不可用有独立键），示例来源只在首次或来源变化时播报；轮询时间、PID、retry 计数、Bot ID、布局和组件重挂不触发重复播报。比较相邻状态而非永久历史集合：`failed → recovering → failed` 应再次播报失败。可见固定提示持续显示；不让 ChatPane、侧栏和全局通知重复播报同一 runtime 变化。
