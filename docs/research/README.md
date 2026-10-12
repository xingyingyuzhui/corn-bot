# Corn Bot 研究输入

当前执行顺序以[后续统一实施计划](../plans/CORN_BOT_FORWARD_PLAN.md)为准。本目录保留调查原文及对应评审，不把其中的拟定接口、旧阶段顺序或候选能力当作已实现事实。

| 文件 | 用途 | 证据范围 |
| --- | --- | --- |
| [Grok运行机制调查v2](grok-runtime-investigation-v2.md) | 用户提供的行为与执行机制调查原文 | 调查固定2133483；局部来源/配置/probe记录，未取得完整云端Worker |
| [v2审阅意见](grok-runtime-investigation-v2-review.md) | 阶段、控制边界和schema的实施修正 | 2026-10-12只读抽查；未执行probe/Host/模型 |
| [现成底座比较](runtime-options-2026-10-11.md) | OpenClaw/Mastra/Agno/Pi候选机制与固定源码输入 | 官方资料/代码抽查，尚无Corn上的候选运行/性能验收 |
| [P1静态能力对照](runtime-capability-matrix-2026-10-12.md) | DSH/OpenClaw/Mastra 13行能力表、治理硬门槛逐项对比、自研清单、真实门禁场景与静态排序（非决定） | 三份只读审计合并；新固定版本；未运行任何候选、未调用模型 |

前三份文件从项目外层整理进入仓库，正文保持原字节；现成底座比较于2026-10-12在开头追加了一条固定版本补注，原正文未改。静态能力对照是本仓库内新写的文档。它们是研究材料，不是Corn发布资源，不包含提取的Grok bundle。原下载包、更新说明和历史交接存于项目外层archive，恢复映射及哈希见其MANIFEST.json。
