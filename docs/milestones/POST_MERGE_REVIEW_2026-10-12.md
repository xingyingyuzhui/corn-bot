# #16–#19 独立事后审查

日期：2026-10-12。最终产品代码基线：main `8b6989c`。维护者指出最终批次未完成独立签收即合并，因此本次由三个未实现这些修复的reviewer重新读取主checkout并做必要的轻量假依赖反证；不读取已清理工作树、不回退、不修改实现。

## 结果

| 范围 | 本次结论 | 本次验证 |
| --- | --- | --- |
| #17 保存与导航 | 所查范围未发现新的可确认缺陷 | 当前main 24个target tests通过；旧F2反例返回unsaved、保持Bot/草稿/guard，第二次保存才clean；missing不放行 |
| #16 审计隔离/取消/N4 | N4原缺陷已修；新增PMR-01需要新PR | 当前main所有权/中断13个fake tests通过；纯EventEmitter假child证明未确认停止仍删home/释放锁 |
| #18+#19 Gate/草稿/有限停止组合 | 新增PMR-02需要新PR | 当前main 28个fake tests通过；exitOnly反例证明Host已exit仍ready且无恢复 |

没有真实Host、模型、Electron、浏览器或smoke。假child测试不能签收真实进程清理、桌面输入或packaged行为；所有已有真实验收pending保持。

## PMR-01 / P2：AuditLab 未确认Host停止仍删除home和释放锁

位置：[model-audit-fixtures.mjs](../../scripts/lib/model-audit-fixtures.mjs) 第421–445行。

destroy用attempt收集host.stop失败后，仍继续releaseLock及rm lab。纯假child忽略TERM/KILL且不发exit/close时：stop报survived SIGKILL，summary为hostsStopped=0、lockReleased=true、removed=true，home已删除。报告虽然失败，但资源所有权已经被放弃。

新PR要求：未确认Host停止时保留lab/home/锁；仍关闭可独立清理的stub；报告明确retained及cleanup failure，非零退出。不用“删除目录成功”掩盖存活资源。补同一假child反证，并覆盖清理重入、可清理资源与保留资源的分离。

模板OwnedResources层和产品supervisor已经有保留规则，AuditLab应与之保持一致。真Host复验等待授权恢复。

## PMR-02 / P2：Host exit但stdio未close，ready和认证继续存在

位置：[dsh-host-supervisor.ts](../../apps/desktop/src/runtime/dsh-host-supervisor.ts) 第158行及317–323行。

exit回调只设置exitConfirmed；lifetime中止及onFailure依赖close。后代保留stdout/stderr时，主进程已退出而close迟迟不到。现有RuntimeHarness的fake child在ready后exitOnly(null,SIGKILL)，读到view=ready、running=true、authPresent=true、recoverySchedules=0。

新PR要求：exit立即撤销本代次就绪/认证、abort lifetime并发出一次失败通知；close仅负责管道收尾，不能重复触发恢复。保留有限停止和旧进程/资源所有权要求，不绕过未确认停止的保护。

补readiness/auth/Claw检查/ready各阶段的exitOnly，以及exit后close、不重复通知、stop赢过迟到成功的回归。真Host与GUI恢复仍待验。

## 处置

两项开独立修复PR或边界清晰的两个提交，由执行者实现、独立reviewer审查。P1静态选型和#15 N1/N3不因此阻塞；依赖当前DSH生命周期/审计的真实验证在问题闭合前不能完整签收。

本次事后审查已经执行，不再把四包写成“完全未审”；保留“最终批次合并前缺独立签收”这一过程事实。当前状态为“事后审查完成、两项发现待修、真实验收pending”。
