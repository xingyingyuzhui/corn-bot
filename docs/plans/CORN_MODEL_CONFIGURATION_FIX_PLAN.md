# Corn 模型配置修复与官方能力接入计划

日期：2026-10-11（Asia/Shanghai）。状态：**待执行；本文件只形成修复计划，没有修改 App 代码，也没有证明正式配置流程已接通。**

基线：main `d28f085`。runtime 修复分支已存在，读取时 HEAD 为 `40d9f66`；U1 与头像各有独立分支。本计划位于 `docs/bot-management-plan` 工作区，接续[管理面板计划](CORN_BOT_MANAGEMENT_PANEL_PLAN.md)，不修改正在进行的修复代码。

## 1. 问题与目标

DSH 官方已经提供模型设置、提供方目录、自定义提供方、凭据存储、模型发现和模型选择。Corn 的 M0 接入只从 `model.env` / `CORN_MODEL_*` 读取两个预设提供方，再把 Key 注入 Host 环境。这个开发测试入口不能成为正式产品配置系统。

修复必须同时完成两件事：

1. 配置异常不再在 Electron 顶层抛出，窗口始终能展示安全错误；这由当前 runtime R2 修复负责，配合 R1/R3 的 Claw 与进程生命周期门禁。
2. 正式 App 从无 Key 的独立 Corn profile 启动，用户在 Corn 的设置页配置模型；读写和持久化使用 DSH 官方服务，移除正式启动对 `model.env` 和两个写死路由的依赖。

独立 App、独立数据与复用 DSH 官方配置能力同时成立。不读取、复制或修改用户现有 DSH 安装、`~/.dsh`、配置和凭据。Claw 实现与 Grok Kit 不复制进 Corn。官方 DSH 客户端的公开导出、许可和装配条件单独核查，不能把 Kit 的禁止复制规则误套成禁止复用 DSH 官方包。

## 2. 已核实的代码事实

| 位置 | 已核实事实 | 影响 |
| --- | --- | --- |
| Corn `runtime/model-provider.ts` | 仅支持 `deepseek-official`、`xiaomi-token-plan-cn`；不完整配置会抛异常 | 只保留为显式开发测试入口，不扩建为产品 Provider 管理器 |
| main `apps/desktop/src/main.ts` | 在模块顶层构造 supervisor 时解析模型配置 | 异常可发生在窗口建立前；当前 runtime 分支已调整控制流程，但关闭结论要等 review/测试 |
| `runtime/profile-bootstrap.ts` | 把选中 Provider 的 Key 注入 Host 环境，通过启动 patch 装配路由 | 环境凭据会压过设置页保存值，且官方将该来源视为只读；正式启动要撤掉这层注入 |
| `features/settings/ModelsSection.tsx` | 从 fixture Repository 读取目录并保存示例默认模型 | 当前不是官方凭据/提供方配置界面 |
| `packages/dsh-adapter/src/transport.ts` | 已允许 `session/modelCatalog`、`session/selectModel`；未允许 settings/credentials/llm 管理接口 | 必须增加经过审核的窄适配，不开放任意 RPC |

官方事实固定到 DSH `0.2.0-rc.2` / commit `639ed015397290b3745d163aafe02ffee4aa3f84`，使用本地 Git 对象读取，不以当前 master 推断 RC2 能力：

| 官方源码 | 已存在能力 / 关键语义 |
| --- | --- |
| `packages/api/settings-controller/src/{index,credentials}.ts` | `settings.describe/update/replace/mutate`；settings 写入有 `expectedRevision`，冲突码是 `settings/conflict`；`credentials.describe/set/unset`，读取只有 configured/source/writable，不返回 Key |
| `packages/llm/llm/src/index.ts` | `llm.listProviders`、`llm.listConfigurableProviders`、`llm.discoverModels` 公共 Remote |
| `packages/client/ui-settings-models/src/client/{store,operations,ProviderEditor,CustomProviderCard,DeepSeekOnboardingDialog}.tsx/ts` | 官方目录、设置、凭据状态的组合方式；自定义提供方、首次配置和保存行为参考 |
| `packages/credentials/credentials-local/{README.zh.md,src/index.ts}` | 官方本地凭据存储，支持持久化/重载；启动环境优先并只读；私有文件权限不等于对同用户 Agent 工具隔离 |
| `packages/core/agent-default-model/src/index.ts` | 默认模型由官方 Config/Config Editor 持有；配置页投影设置了 `auto: false`，不能假设它自动出现在 settings 描述符中 |
| `packages/api/session-controller/src/{catalog,commands,index}.ts` | 模型目录/可用性与选择；`session.selectModel` 同时异步保存全局默认，不能拿它直接实现独立 Bot 覆盖 |

这里只证明源码能力与当前接入缺口；发布包的生成参数、装配、实际生效与打包结果仍需以下实测。

## 3. 正式运行与开发测试的边界

### 3.1 正式 App

- 正式启动不读取开发 `model.env`，也不消费 `CORN_MODEL_*` 注入模型/Key。Host 使用 Corn 自己的 DSH home、profile、设置服务与官方凭据服务。
- 无凭据时正常展示窗口并启动经过 Claw 验证的 Host。`runtime ready` 表示 Host/认证/Claw 可用；模型状态另用 `needs_configuration | available | unavailable | checking`。无模型不得显示“可以发送”，也不得伪装成 Host 崩溃。
- 首次显示“配置模型”，进入 Settings → 模型。保存后回读提供方、凭据状态和目录，选择有效默认模型，满足条件后开放真实发送。
- 清除 Key 后该提供方变为未配置；保存和实际可调用分开呈现，不把 `credentials.set` 成功当成网络认证成功。付费测试仅由用户主动点击或明确授权的 smoke 触发。
- DSH 配置服务本身损坏、不可写或未装配时分别显示原因；不绕过错误偷偷换 Provider、降级普通 Session 或放松 Claw 校验。

### 3.2 开发与回归测试

- 现有 `CORN_MODEL_*` / mode-600 文件只用于明确的开发 smoke。测试参数显式传入 supervisor；默认开发 App 也走正式设置路径。测试报告标记凭据来源，严格禁止打印值。
- 显式测试覆盖无效时继续安全失败，不能静默借用其它来源的 Key。生产打包路径不启用测试覆盖；环境来源的测试 Key 显示只读状态，不承诺 UI 可以覆盖它。
- 已有 Corn 开发 Key 不自动复制或迁移。需要导入时另做显式 Corn-only 导入操作；本轮不做，不读取既有 DSH 凭据。

## 4. 第一工作包：复用现有 runtime 修复，关闭启动问题

不重复实现 runtime agent 已在修的 R1–R3。review 要求如下：

1. 无 Key、未知测试路由、权限 644、不可读文件均不产生未捕获异常；窗口先出现，错误只含已批准的安全错误码。
2. 认证/Claw 检查中的退出不会被迟到成功改为 ready；启动/停止/退出清理完整，旧代次不能覆盖新代次。
3. `startup-control.test.ts` 在修复后快速结束，测试文件没有残留进程、定时器或监听器；测试命令整体退出，不能仅看断言通过。
4. 新测试在旧版本失败、修复版本通过；完整 `pnpm check` / build、相关 review smoke 和 packaged 启动门禁通过。

本包关闭的是启动和治理缺陷。即使所有测试通过，也不声明官方模型配置接入完成。U1 继续展示安全错误；新模型状态沿用稳定 Shell 播报机制，避免重复播报。

## 5. 第二工作包：官方 API 与组合验证，先于完整 M2 对话接线

从 runtime 修复合并后的 main 开独立分支；这部分全局模型配置不依赖 Bot/Run 数据库，可优先于完整 M2 聊天交付。先验证、再做可写界面：

1. 在 Corn 临时 home 中验证 packaged profile 已装配官方 Settings Controller、settings/config editor、credentials-local、LLM Provider 与默认模型服务；缺包时增加精确锁定的官方包，更新生成模板与打包验证，不自写替代服务。
2. 对照 RC2 发布包生成 Remote descriptor 记录每个方法的 endpoint、参数名、返回值、缺服务错误、取消行为和版本语义。`settings/mutate` 不凭手写签名猜测，使用真实请求做 round-trip。
3. 验证提供方目录、可配置但尚未激活的条目、凭据状态、设置 schema、模型目录和 discovery。Provider 配置结构/协议选项从官方 schema 得到，不能另维护两路由或任意协议清单。
4. **全局默认模型公开写入接口是开工门禁**：不能假设 default-model namespace 可写，不能创建假 Session 借 `selectModel` 的副作用保存默认。先验证 RC2 已有公共写入能力；如缺少，按 ADR-0001 在单独的 Corn Host Bridge 公开一个受限、经过官方目录验证且等待保存完成的命令，内部只调用官方服务。它属于 Corn 产品适配，不复制 Agent/Claw。若所需官方方法不公开，先做上游补丁与版本升级，不调私有方法。
5. 读取/回读由 Host 权威事实驱动；Corn 只缓存投影。不在 Corn SQLite、`model.env` 和 DSH settings 各存一份互相竞争的全局模型/Provider/Key。

产出 `docs/milestones/MODEL-CONFIG-API-AUDIT.md`，逐项报告 verified / unavailable / pending，并更新 ADR-0001 的实际接口决策。接口验证不需要购买一次模型回复。

## 6. 第三工作包：Corn 设置页与凭据写入接通

### 6.1 界面与权限

- Settings → 模型展示真实提供方目录、未配置/可用/不可用/只读状态，提供新增/编辑 Provider、设置/更换/清除 Key、模型目录与默认选择。
- 优先评估官方客户端包的可复用公开 exports。满足许可、依赖与 Corn UI 条件则复用；组件依赖原 DSH UI 装配或未公开时，只在 Corn 实现展示层，并照官方流程调用同一后端。审计记录选择，不能以换皮为由重写配置存储与 Provider 发现。
- 支持当前组合公开的 Provider 及自定义 Provider 配置；未装配的协议/账户能力显示真实原因。本轮以 API Key 配置为完整交付；DeepSeek 账户登录/OAuth 的独立认证流程另核查，未交付时明确标识，不假登录。
- Key 只在当前密码输入控件和一次写请求中短暂存在；不放 Workspace 状态、持久草稿、LocalStorage、数据库、日志或 IPC 回包。关闭/提交后清理输入，失败保留非机密字段并要求重新输入 Key。
- Renderer 输入 Key 经受限 IPC 写入 Main，再调用 `credentials.set`。现有安全文档中“不接收凭据”应精确表达为“不接收存量凭据、启动机密和回读密钥”；用户主动输入的单向写入是必要例外。
- Main 接受 provider ID 和结构化编辑命令，根据当前可信目录解析 ns/path/ref，并验证允许字段、协议和 revision。Renderer 不获得通用 settings.mutate、任意 namespace、credential ref 或任意 RPC。自定义 API endpoint 是受控 Provider 配置字段，不转化为通用网络代理；校验沿用官方约束并记录实际允许范围。

### 6.2 保存、失败与并发

- settings 写入使用读取时的 revision；冲突返回可恢复状态，不自动无条件覆盖。保存后回读，而不是把表单值当成事实。
- 官方参考代码是先写 settings、再写 credential；两步不是原子事务。Corn 显示各步结果及 `partially_applied`，例如“提供方配置已保存，密钥未保存”。重试从实际回读状态继续，不盲目回滚或删除仍被其他 Provider 使用的凭据。
- 一个 Provider 的异步响应不能修改另一个编辑器；Host 断线/代次更换后丢弃旧读取。已经发出的写入超时不等于未写入，先回读再确定是否重试。
- 凭据 set/unset 没有从 settings revision 推导来的 CAS；Main 串行写入不冒充跨客户端原子事务。外部写入与未知提交结果通过回读处理。
- 原始 Host/Provider 错误可能包含用户配置或响应正文，Main 映射安全错误；Key/ref 冲突、不可写、超时和配置冲突分别展示，不回传原始 stack/body。
- 更新凭据/Provider 对正在执行请求的实际影响按官方生命周期验证，不能承诺更换 Key 会撤销在途请求。目录刷新不主动取消任务。

## 7. 第四工作包：Bot 模型与 M2 真实会话衔接

全局配置交付后，再接管理面板的“配置 → 模型”。用户只选择跟随全局或 Bot 覆盖；API Key 始终在全局设置。

- 使用已核实的 Claw `registry/models`、`registry/model`，Main 按 Corn Bot 绑定解析 agentId；不让 Renderer 提交任意 Claw ID。
- `session.selectModel` 的全局默认副作用必须隔离；验证 Claw Bot 配置如何应用到新 Session、已有 Session 和下一次请求。缺少可维护的 Session-only 接口时补公共 seam，不保存后偷偷“改回默认”制造竞争。
- 验证两个 Bot：A 覆盖、B 跟随全局；修改 A 不改变 B 或全局；改全局不覆盖 A。重启后保持配置与真实 Session 生效一致。
- `(provider, model, reasoningEffort)` 校验来源于真实目录；删除 Provider/清除 Key/模型下线后明确 needs_model，禁止静默切换别的模型或把失败回复当成 Host 掉线。
- 尚为 fixture 的 Bot 不向真实配置发写请求。运行时已接通、全局设置已接通、Bot/聊天已接通三项证据分别报告。

## 8. 文件与负责人边界

以下为拟新增/调整位置，具体拆分由实现验证后固定：

| 文件 / 范围 | 修改职责 |
| --- | --- |
| `runtime/{startup-control,model-provider,dsh-host-supervisor,profile-bootstrap}.ts`、`main.ts` | runtime agent 先关闭 R1–R3；后续接入包在合并基线上移除正式模型 env 注入，显式隔离 smoke 覆盖，不重做生命周期控制 |
| `packages/contracts/src/model-settings.ts` | 脱敏读取 DTO、Provider 配置命令、凭据写入命令、安全错误、部分成功与模型可用状态 |
| `packages/dsh-adapter/src/{model-settings-client,credentials-client,model-catalog-client}.ts`、`transport.ts` | 官方接口及生成参数适配、严格 allowlist、schema/revision/ref 映射、取消/代次和安全错误 |
| `apps/desktop/src/ipc/model-settings.ts`、`preload.cts`、`security/ipc-allowlist.ts` | 受信窗口校验、窄方法暴露、写入串行与脱敏；不向 Renderer 暴露通用 RPC |
| `apps/renderer/src/features/settings/{ModelsSection,ProviderEditor,ModelSetupNotice}.tsx` 与状态控制文件 | 真实目录、Provider/凭据编辑、首次引导、冲突与失败状态，保留 Corn 视觉与键盘行为 |
| `apps/renderer/src/model/{models,repository,workspace}.ts` | fixture/live 分离；全局模型配置由 Host 事实投影，Bot 继承策略接管理计划，不存第二份配置真源 |
| `features/details/configuration/ModelSettingsSection.tsx`、Bot 模型共享表单 | M2 Bot 模型接线；与管理面板负责人共享接口，避免两套编辑器/保存逻辑 |
| `scripts/lib/model-session.mjs`、`smoke-model*.mjs`、模板生成与打包脚本 | 显式开发覆盖；新增官方配置 round-trip smoke；产品 profile 从独立、无 Key 的模板启动 |
| `plugins/dsh-corn-bridge`（条件创建） | 只在默认模型公共写入缺口确认后建立最小命令；先记录 ADR 与官方服务调用，不创建重复配置引擎 |
| `docs/security-boundaries.md`、ADR-0001、M2 checklist / evidence | 记录凭据输入/回包边界、唯一事实源、公开接口决策与各层交付证据 |

credentials-local 是文件型官方存储，不能在计划或产品中称为 Keychain 或“Agent 无法读取”。若产品后续要求 OS 凭据保险库，另通过官方 CredentialProvider seam 接入，不在这轮冒称已交付。

## 9. 测试、反证与验收

### 9.1 必须通过的自动验证

- runtime 原缺陷反证及修复后检查；安全错误、快速退出、进程/计时器/监听清理。
- 真实隔离 Host：keyless 启动、settings/目录/凭据读取；用假 Key 做 set/describe/unset、重启持久化和权限检查。假 Key 只证明存储，不证明模型可调用。
- Provider 配置版本冲突、未知 Provider/字段/协议、两步部分成功、写入超时后回读、凭据只读来源、断线/代次更换、另一 Provider 的迟到结果。
- Renderer 非受信调用、任意 namespace/ref/RPC 拒绝；输出/日志/导出扫描确保假 Key 不泄漏；清除 Key 后目录与发送状态正确。
- 两个 Bot 的全局/覆盖隔离与重启一致性，作为 M2 接线门禁；未实现时标 pending，不拿 fixture 测试代替。
- `pnpm check`、`pnpm build`，新增测试放入根命令实际扫描的 tests 目录；新增 `smoke:model-settings` 独立入口，纳入有条件的集成检查而不是把付费调用塞入默认单元测试。

### 9.2 产品与打包验收

1. 干净环境从 Finder 启动新打包 `.app`，无 `CORN_MODEL_*`、无旧 `model.env`、无已安装 DSH/Node/pnpm 依赖；显示设置入口，不弹 JS 异常。
2. 经 Corn 设置页配置一个真实可用 Provider、选择模型；在明确授权的受控 smoke 中验证一次实际模型请求。不要求重复付费调用；既有开发 Key 不自动导入。
3. 关闭/重开 App，Provider、凭据状态与默认模型仍存在；Key 输入框始终为空，不回显存量值；环境中旧变量不能压过正式设置。
4. 清除/更换 Key、错误 Key、不可用模型、离线、只读配置分别显示真实状态；可以回设置处理，不死循环重启 Host，不静默降级。
5. 设置页窄窗/键盘/焦点/保存中关闭正常；U1 runtime 提示与模型提示语义区分，不重复播报、不遮挡输入。

## 10. 合并顺序与完成定义

| 顺序 | 工作包 | 通过后能声明的交付 |
| --- | --- | --- |
| 1 | 现有 runtime R1–R3 → U1；02D-1 按原流程 | 启动安全失败、治理/生命周期修复、固定状态提示；不宣称官方模型配置已接通 |
| 2 | 模型 API/组合与全局默认写入审计 | 公共能力与生成参数真实验证，缺口有明确公开 seam 方案 |
| 3 | 全局模型设置/凭据/首次引导，撤掉正式 env 路径 | 用户从 Corn 界面完成配置并重启保留；不依赖完整 M2 Bot 数据库 |
| 4 | M2 Bot 覆盖与真实会话接线，联合管理面板 | 全局/Bot/Session 一致，真实对话与治理验收闭合 |

头像与管理面板展示层可并行推进；修改 `main.ts`、startup 与 profile 的接入包必须建立在 runtime 修复合并后的版本。API 审计可先开始，不阻断旧问题修复交付。

完成定义：**既不崩溃，也不要求用户编辑环境变量；配置读写、凭据持久化、Provider 发现复用 DSH 官方能力，Corn UI 与真实生效状态一致。**需要的接口未验证或仍为 fixture 时，不标完成。

## 11. 已确认决策（2026-10-11）

| 问题 | 决定 |
| --- | --- |
| 凭据输入 | 同意窄例外：Key 仅在密码输入控件和单次写请求中短暂存在，经受限 IPC 写入官方凭据服务；不回读，不持久化到界面状态、草稿或日志。第三工作包写入 `docs/security-boundaries.md` |
| 凭据存储 | 本轮使用官方 `credentials-local`，如实说明是受文件权限保护的本地存储；不称为钥匙串，不承诺隔离同用户的 Agent 工具 |
| 全局默认模型写入口 | RC2 缺少公开写入口时，允许最小 Corn Host Bridge：内部只调用官方公开服务，等待保存完成并回读验证。若必须依赖私有方法，走上游补丁，不能绕过 |
| 第二工作包门槛 | 审计草稿 PR 的核心门槛是 RC2 全局默认模型的公开写入方式，以及写入 → Host 重启 → 回读的实际持久化证据 |
