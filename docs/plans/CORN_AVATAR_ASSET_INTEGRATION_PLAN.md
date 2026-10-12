# Corn 头像素材与 App 图标接入计划

日期：2026-10-11。用户要求将已制作的素材与修正版图标纳入下一步开发；本文件细化主计划 §15、PR-02D 和 PR-03A。

**2026-10-12状态：02D-1静态头像、角色选择器和App图标已在PR #9合入main；02D-2动态组件尚未实现，Finder/Dock/App switcher人工验收及最终视觉验收待完成。** 素材包测试不代替App验收。当前顺序以[后续统一计划](CORN_BOT_FORWARD_PLAN.md)为准；下文的旧分支/先合#7指令仅保留历史背景，素材锁、渲染契约和验证范围继续有效。

**2026-10-12维护者决策：** 动效行为以 DMG 0.68.1 引擎为参照并在 Corn TypeScript 中重写（边界见 §3A）；02D-2 拆为 02D-2a 动效引擎（v1 视觉，可立即开工）与 02D-2b 形变接入（依赖 Corn 原创 `corn-avatar-kit-v2`），见 §4；动画状态不改变业务状态，见 §5。

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
3. **PR-02D-2：React 动画接入。** 原计划为单个 PR：基于同一原创几何实现动态/静态/上传图渲染、统一生命周期与状态 fixture，完成单元、视觉和负载验证。2026-10-12 拆为下列 3a–3c；可在 02C 期间有序开发；M1 收尾必须包含 02C 和完整 02D（2a+2b）的证据。
   - 3a. **PR-02D-2a：动效引擎。** 统一调度、生命周期、时间采样、可承载形变的帧契约、形变↔idle 过渡、静态路径与清理；沿用 v1 视觉，测试仅用虚拟时钟+JSDOM。现在即可开工，不等 v2 素材。
   - 3b. **Corn avatar kit v2 素材包（仓库外设计工作）。** `design-assets/corn-avatar-kit-v2` 提供 Corn 原创形变目标，独立资产锁；v1 静态头像、16 角色与 App 图标不变。
   - 3c. **PR-02D-2b：形变接入。** v2 定稿锁定且 02D-2a 合入后实施；第一批 5 种形变及视觉验收，第二批随后。
   - Kit 研究锁由 `0248419` 升至 `5bb4379`（独立小代码 PR，由另一 agent 处理）。§3A 引用的 DMG 事实以 `5bb4379` 文档为准；02D-2a 合并时如该 PR 仍未合，PR 描述须注明所引用的提交。
   - **合并顺序（2026-10-12）：** #20 → #23 → #25 → #24（#25 已叠在 #23 之上；其 `AVATAR_SOURCE_MATRIX` 链接指向 #25 的 ADR-0003 增补）；引擎实现 #26（`feat/avatar-motion-engine`，`504dccc`，即 02D-2a）独立合并。
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

## 3A. DMG 参照与借用边界（2026-10-12 维护者决策）

事实来源：Kit `5bb4379` 的 `docs/avatar-state-audit.md`、`docs/avatar-reference.md`、`docs/avatar-state-catalog.md`（只读，`git show 5bb4379:<path>`）；Corn 现有动效起点为 v1 `src/avatar.ts`（姿态＋装饰叠加、无形变、时间纯函数 `sampleFrame`、每实例 RAF）。本节是 [ADR-0003 2026-10-12 增补](../adr/ADR-0003-avatar-engine.md#addendum-2026-10-12-dmg-behaviour-reference-borrowing-boundary-unified-scheduler) 的执行细则。

**参照来源。** 行为基准是 DMG 0.68.1 安装包引擎（按时间采样；保留 5 颗 orbit/spawning 粒子与 standby 光晕；53 状态）。官网组件只作 idle 身体/眼睛**运动**参数参照（姿态幅度/频率、眨眼与注视节奏），不取其静态尺寸或 presentation 常量。同一状态不混用两来源；与 DMG 不同之处一律记为“Corn 选择”并写入下表或对应 PR。官网的节点复用（orbit 只剩 3 颗、spawning 隐藏两粒、standby 光晕被隐藏）和按帧采样墨迹（60 FPS 无墨迹）不复现。

| 借用并以 Corn TS 重写 | 不借用（保持 Corn 原创） |
| --- | --- |
| 状态语义；时序/相位、缓动曲线；形变结构（哪些状态完整形变并隐藏眼睛、休息相位恢复眼睛、形变→idle 恢复）；粒子/环数量；墨迹时间采样（预计算路径、最多点数、抬笔按时间擦除）；<48px compact 行为；`overflow: visible` 规则与按显示尺寸适配 viewBox | Kit/Grok 源文件、压缩代码、SVG path 数据、素材；精确形变几何（笔杆尺寸、位移范围、基础角、描边宽、环半径等）；DMG clips 关键帧数据；身体、眼睛、表情与配色。复制代码/几何属于另一项边界变更，本决策未授权 |

| DMG 状态 / 形变 | 结构（借用） | 时序与曲线（借用） |
| --- | --- | --- |
| writing / pencil | 主体缩成笔尖＋笔杆，完整形变隐藏眼睛；落笔书写→抬笔返回；可见墨迹 | 2500ms 周期，前 68% 落笔、后 32% 抬笔；墨迹为预计算路径按状态时间取样，最多 64 点，抬笔按时间擦除，不随 RAF 追加。**Corn 选择（#26）：** 最多 25 点 = 24 个预计算路径采样＋1 个当前笔尖点 |
| thinking / dots | 主体变中心点＋左右两点，隐藏眼睛 | 左右点轮流抬升、缩放、变淡。**Corn 选择（#26）：** 周期 1400ms |
| searching → radar | 主体＋3 层扩散环 | 每轮 1300ms，三环错相，透明度随扩散衰减 |
| progress（DMG `loading` 同形变） | 主体＋淡色轨道＋进度弧；不是永久 100% 圆环 | 形变 2500ms、休息 1500ms 循环；休息相位恢复眼睛 |
| alerting / bang | 直立提醒条＋主体缩成圆点，隐藏眼睛；不得用 writing 或静态感叹号替代 | 2.2s 周期衰减抖动 |
| orbit（DMG `waiting` 同形变） | 主体＋5 颗轨道点，深度改变半径/透明度 | 持续循环 |
| spawning / gather | 5 粒子向主体聚拢、逐颗消失；单帧可见数随阶段变化 | 展示 2000ms、休息 1500ms，粒子错相；休息恢复眼睛 |
| sending / send | 主粒子＋尾随小粒子＋淡出环；某帧只见一点属正常阶段 | 1500ms，各元素有不同出现窗口。**#26：** 02D-2a 仍画 v1 装饰，相位按 1500ms 周期 |
| receiving / receive | 外侧点收拢到主体，再出现接收环；不与 sending 强制镜像 | 1700ms；入射方向按 seed 变化，不固定。**#26：** 02D-2a 仍画 v1 装饰，相位按 1700ms 周期 |
| uploading / dock | 两点依次进入再环绕主体 | 首点约 0.2s、次点约 1.5s 起，入场段约 0.9s |
| dictating / wave | 中央主体＋左右 4 节点 | 幅度由时间函数驱动，不代表真实麦克风音量 |
| powering-down / standby | 缩小主体＋淡色呼吸光晕，入场有收缩环 | 持续呼吸；名称不表示组件自行销毁 |

通用规则：完整形变相位隐藏眼睛，形变→idle 后恢复两眼并清除形变节点；DMG 小于 48px 启用 compact，影响 idle 等片段调度，**不**减少形变粒子数；头像 SVG 与紧邻父级保持 overflow 可见，形变缩放/viewBox 随显示尺寸调整，不导出大尺寸帧再缩小或固定覆盖 viewBox。DMG 的 `next/hold`（waking 1.6s→idle、finished/failed/approving 片段后→idle、blocked 120s→drowsy）不进入引擎，见 §5。

**Corn 过渡与 compact 参数（#26 `504dccc`，均为 Corn 选择）：** 形变进入 320ms，形变权重 >0.5 时隐藏眼睛；状态切换 240ms 平滑混合；形变之间切换时旧形变在过渡前半段淡出、新形变在后半段生长。waking 不自转 idle：从 1.6s 起在 waking 状态内用 400ms 把姿态混合到 idle 姿态，waking 何时结束由展示层 TTL 决定。<48px compact 循环去掉 idle 摆动、保留轻微上下浮动；形变粒子/环数量不减少。

**Corn 18 状态对照。** 契约词表不变（ADR-0003 §2）；无形变状态的 DMG clips 是关键帧数据，Corn 按片段语义自写姿态，属 Corn 选择。

| Corn 状态 | DMG 参照 | 接入 | Corn 选择 / 偏离 |
| --- | --- | --- | --- |
| idle | 官网 idle 身体/眼睛运动参数（不用 DMG idle clips） | 2a | <48px 简化 idle 运动沿用 DMG compact 尺寸规则，记为 Corn 选择 |
| sleeping | sleeping：sleepy，无形变 | 2a | v1 `standby` 装饰属偏离，2b 视觉验收时定去留 |
| waking | waking：surprised；DMG 1.6s 自回 idle | 2a | 不继承自回：1.6s 起在 waking 内 400ms 混合到 idle 姿态，状态结束由展示层 TTL 决定 |
| listening | listening：calm，无形变 | 2a | v1 `wave` 装饰属偏离，须与 dictating 形变可区分 |
| thinking | thinking 形变 | 2b 第一批 | 形变为三粒玉米粒（v2） |
| searching | radar 形变 | 2b 第一批 | v1 与 thinking 共用 `dots` 是缺陷；2a 帧契约先区分为 radar，视觉在 2b |
| working | Working_A–F 片段组，无形变 | 2a | v1 `progress` 装饰属偏离，须与 progress 形变可区分 |
| dictating | dictating / wave | 2b 第二批 | — |
| writing | writing / pencil | 2b 第一批 | 玉米身体缩成笔尖＋原创笔杆（v2） |
| sending / receiving / uploading | send / receive / dock | 2b 第二批 | — |
| alerting | alerting / bang | 2b 第一批 | 审批阻塞时持续到结算，由展示层维持 |
| happy / celebrate | Done_A / Rotation_A＋happy | 2a | 短态，TTL 在展示层 |
| confused | Blocked_A，无形变 | 2a | v1 `alert` 装饰属偏离，不得触发 alerting 形变 |
| progress | progress / loading | 2b 第一批 | — |
| powering-down | powering-down / standby 光晕 | 2b 第二批 | — |
| （无对应值） | orbit / waiting、spawning | 2b 第二批 | 18 态契约中没有；须在该 PR 先定契约（新增 Corn 状态或从现有状态显式映射），未定前不出货 |

## 4. PR-02D-2：动态组件与 App 级验收（2026-10-12 拆为 02D-2a / 02D-2b）

原单 PR 要求保留并分配到下面两个 PR：按主计划 §13.4 拆成 `AvatarRenderer`、`CornMotionAvatar`、`StaticAvatar`、`UploadedAvatar`、`motion-presets`、`motion-scheduler` 和 `useAvatarLifecycle`，复用原创素材几何与表情算法；当前独立控制器每实例 RAF 的实现需要按 ADR-0003 适配，不能仅复制控制器就宣称完成架构要求。

### 4.1 PR-02D-2a：动效引擎（v1 视觉，可立即开工）

| 模块 | 实施内容 |
| --- | --- |
| `motion-scheduler.ts` | 全局唯一调度器：N 个实例共 1 个 RAF；注册即订阅，0 订阅取消 RAF；共享一个 `IntersectionObserver`、一个 `visibilitychange` 与一个 reduced-motion 监听。时钟可注入（产品为单调时钟，测试为虚拟时钟）。调度器维护共享的虚拟动画时间，每个 tick 推进量封顶 100ms（参照 DMG） |
| 采样器（`motion-presets.ts`，必要时拆 `motion-sampler.ts`） | 帧 = 共享虚拟动画时间的纯函数（状态、虚拟时间 − 状态起点、seed、显示尺寸、过渡信息）；不按帧积分。**长间隔（维护者决策 2026-10-12）：** 后台 Tab、睡眠等长间隔后虚拟时间只推进 100ms，从原处继续，不跳相位、不追帧。主计划 §13.4/§13.6 的“封顶 dt”按此落地；“隐藏后重置时间相位”不采用。时序表每项注明 DMG 参照值或“Corn 选择” |
| 帧契约 | 在 v1 `AvatarFrame`（姿态＋表情＋装饰）上增加形变字段：形变类型、权重 0–1、相位、眼睛可见性、抽象部件（粒子/环/笔杆/墨迹点）数量与位置，以及按显示尺寸所需的绘制范围。2a 中 searching 已标为 radar，与 thinking 区分 |
| 形变↔idle 过渡 | 进入/退出均为时间纯函数（记录过渡起点与上一状态在该时刻的采样）；完整形变隐藏眼睛，回 idle 恢复眼睛并移除形变节点/属性。Corn 选择：形变进入 320ms（权重 >0.5 隐藏眼睛），状态切换 240ms 平滑混合；形变间切换时旧形变在前半段淡出、新形变在后半段生长。2a 用测试专用占位形变验证契约，不进入产品视觉 |
| 墨迹 | 每周期由 seed 预计算路径，按状态时间取样，抬笔相位按时间擦除；同一虚拟时间在任何帧率下结果相同。上限为 Corn 选择 25 点（24 个预计算采样＋1 个当前笔尖点；DMG 最多 64 点） |
| `useAvatarLifecycle.ts`、`AvatarRenderer`、`StaticAvatar` | 隐藏、离屏、系统减少动态、`animatedAvatars=false` 走静态路径，不加载动画运行时、不建 RAF；`setState`/偏好变化更新现有实例而不重建运行时；StrictMode 双挂载、切 Bot、关闭详情、销毁窗口后 RAF/observer/listener 归零 |
| compact 与裁切 | <48px 走 compact 分支（14px 必须命中）：去掉 idle 摆动、保留轻微上下浮动（Corn 选择），保留眼睛方向，不减少形变粒子/环数；sending/receiving 仍画 v1 装饰，相位按 1500/1700ms 周期；SVG `overflow: visible`，紧邻父级不得 `overflow: hidden`，viewBox 按显示尺寸适配 |
| 无自主状态切换 | 引擎 API 没有 next/hold，不设会改变状态的定时器；状态只由 props 输入（§5） |

其余沿用原 §4：稳定 seed 来源为 Bot ID/持久偏好；同一 Bot 的多个可见实例拥有不同 SVG ID；`spin` 真正转一圈且不裁切，`bounce/burst` 受动效设置约束。开发专用 fixture 路由展示 16 角色和 18 状态（形变状态在 2a 显示 v1 视觉并标注“形变待 2b”）；正常 M1 UI 保留示例标记；5 群组素材只作预览。新增/迁入 avatar contract、shape、lifecycle、scheduler、sampler 测试，纳入根级 `pnpm test`/typecheck/build；保留原 9 项测试覆盖。上传图、原名文本与邻近状态提示继续可用；动画表情不能替代可访问的错误或审批文本。

2a 的测试只用虚拟时钟＋JSDOM（RAF/observer/媒体查询均为可计数的 stub），不跑 GUI、Electron 或 packaged smoke。

### 4.2 PR-02D-2b：形变接入（依赖 v2 素材与 02D-2a）

- **素材：** 仓库外 `/Users/qin/DSH/Corn Bot/design-assets/corn-avatar-kit-v2` 提供 Corn 原创形变目标（writing：玉米身体缩成笔尖＋原创笔杆；thinking：三粒玉米粒；searching：玉米周围的 radar 环；progress；alerting；第二批随后）。v2 单独资产锁（建议 `design/corn-assets/ASSET_LOCK-v2.json`，PROVENANCE 增补 v2 段），按 §1 方式迁入仓库；v1 锁、静态头像、16 角色和 App 图标不变。
- **第一批：** writing、thinking、searching（radar）、progress、alerting。**第二批：** orbit/waiting、spawning、sending、receiving、uploading、dictating/wave、powering-down 光晕；其中 orbit/waiting、spawning 需先按 §3A 定契约。
- v1 装饰偏离（sleeping `standby`、listening/waking `wave`、working `progress`、confused `alert`）在本 PR 定去留并记为 Corn 选择，不得与形变外观混淆。
- 视觉验收：与 Kit 画廊对比轮廓，确认形态明显不同（ADR-0003 Consequences）；固定 seed/虚拟时钟/DPR 做头像区域快照，先静态后时序；在两栏/三栏、窄窗、折叠列表与 20+ Bot 场景测帧耗时/内存和资源清理，性能基线以目标 Mac 实测记录。GUI 部分在 smoke 暂停期间保持 pending。

### 4.3 02D-2 验收门禁（2026-10-12 增补）

| 门禁 | 方法 | 归属 |
| --- | --- | --- |
| 帧率无关：同一虚拟动画时间在 30/60/120 FPS 及低于 100ms 封顶的不规则 delta 下得到相同帧，墨迹亦然 | 虚拟时钟逐字段比较帧与序列化 SVG | 2a |
| 长间隔（后台 Tab、睡眠）：虚拟时间单次最多推进 100ms，从原处继续，无相位跳变 | 虚拟时钟注入长间隔，单独断言 | 2a |
| 全部使用尺寸 14/24/30/32/36/48/52/60px＋144px fixture；14px 走 compact | JSDOM 尺寸模拟（2a）；区域截图（2b，GUI pending）。30px 仅为尺寸矩阵，账户头像语义不变 | 2a + 2b |
| 形变→idle 恢复两眼、无残留节点/属性 | DOM 断言：2a 占位形变，2b 真实形变 | 2a + 2b |
| 粒子/笔杆/环不裁切：SVG overflow 可见、紧邻父级无 `overflow: hidden`、viewBox 按显示尺寸 | 计算样式与祖先检查（2a）；视觉复核（2b，GUI pending） | 2a + 2b |
| N 个实例只有 1 个 RAF | RAF stub 计数 | 2a |
| 卸载、切 Bot、StrictMode 双挂载、窗口销毁后 RAF/observer/listener 归零 | stub 计数；真实窗口销毁部分 GUI pending | 2a |

**合并证据：** 2a 为 `pnpm check`、`pnpm build`、UI 资产审计及上表 2a 项；2b 另加 v2 资产锁核对、React/视觉/负载检查，以及 `pnpm package:mac` / `pnpm smoke:packaged` 对新提交的结果。报告静态、fixture 动态与 packaged 图标各自状态，未运行的 GUI/视觉项写明 pending，不记为通过。独立素材包测试通过不直接勾选 M1 验收。

## 5. PR-03A：真实业务映射

`packages/state/src/avatar-presentation.ts` / `avatar-state-reducer.ts` 消费经过校验的真实 Session/Run/Gate 事件，采用 §13.5 优先级：审批阻塞 > 错误 > 语音 > 推理/工具 > 消息 > 完成短态 > 待命。状态按 Bot/Run 隔离，处理乱序、重复、重连和短态 TTL。

`session.prompt` accepted 只表示入队；只有真实完成事实触发 `happy/celebrate`。Host 断线保留可靠投影并显示离线信息，不触发成功；未知推理/工具细节显示可证明的状态。该层不改变 Gate 权限、PTC 禁用决策或 Runtime 隔离边界。

**动画状态 ≠ 任务状态（2026-10-12 决策 6）。** 引擎不自行改变业务状态；DMG 的自动回 idle（finished/failed/approving 片段结束后、waking 1.6s）与 blocked 120s→drowsy 不用于有业务含义的状态。失败、审批和后台任务的呈现只由本 reducer 根据真实事件驱动并保持到对应事实结算；happy/celebrate 等短态由展示层 TTL（`AVATAR_BEHAVIOR_MAPPING` 规则 4，假时钟测试）到期回落，不由引擎自转。

## 6. 文档收尾

同步主计划、M1 PR checklist、ADR-0003、`design/design-spec.md`、UI coverage 和开发 runbook；在 M1 证据中列出本次头像区域的主动视觉变化与仍未接通的业务状态。PR-09A 核查最终产物仅含选定 Corn 资产与代码，不含 Kit 提取资源、设计演示画廊或外部绝对路径依赖；v1/v2 两份资产锁分别核对。

## 7. 开工决策补充（2026-10-11）

- 本轮计划/清单文档不进入 PR #7。#7 合并后，将这些文档改动迁到 02D-1 分支，作为第一个提交；迁移前保留当前改动，不随 #7 的代码提交带入。
- U1 从 #7 合并后的 main 单独开分支；runtime R1–R3 另开分支。共用的 RuntimeView 安全错误码契约由 runtime PR 提供；U1 可先按现有契约和 fixture 做布局、语义状态去重，最后集成错误码并复验。U1 的布局/状态区域变化需进入 02C 视觉基线。
- `apps/desktop/src/main.ts` 的重叠改动按 runtime PR → 02D-1 图标改动的合并顺序处理；02D-1 静态素材/图标产物可先独立实施。
- 现有四个直接使用 Supervisor 的 smoke：`smoke:cold` 走基础 bootstrap，明确不证明 Claw 就绪；`smoke:host`、`smoke:model`、`smoke:model-lifecycle` 走正式治理启动入口，每次启动/重启都验证 profile、Claw 和 child 代次。`smoke:governance` 虽使用独立临时 profile/测试 patch，也须复用正式 profile/Claw 校验，不归入无治理 bootstrap；`smoke:packaged` 继续走真实 App 正式入口。只有 setup/template 构建及基础 cold 测试使用 bootstrap，安装后的正式检查仍必需；不增加普通 App 可选择的跳过治理开关。
- R1/R2/R3/U1 回归可按场景扩展现有 smoke 或独立放 `scripts/`，根 package.json 提供入口和 `pnpm smoke:review` 汇总。普通 `pnpm check` 保持 lint/typecheck/unit；Electron/进程 smoke 单独执行，CI 中用 macOS smoke job；失败或缺少必需场景时汇总退出非零。付费模型测试不加入默认汇总，也不因本轮启动修复自动调用。
- U1 播报在 CompositionRoot/稳定 Shell 层维护上一次语义状态，单一 runtime live region，`polite`/`atomic`。运行时去重键为状态与安全错误码（桥接不可用有独立键），示例来源只在首次或来源变化时播报；轮询时间、PID、retry 计数、Bot ID、布局和组件重挂不触发重复播报。比较相邻状态而非永久历史集合：`failed → recovering → failed` 应再次播报失败。可见固定提示持续显示；不让 ChatPane、侧栏和全局通知重复播报同一 runtime 变化。
