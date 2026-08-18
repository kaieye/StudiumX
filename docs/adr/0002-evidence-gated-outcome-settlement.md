# ADR-0002：Evidence 门控的 Outcome Settlement

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** teaching-settlement

## 背景

Learning record 会影响后续教学决策，不能由 renderer、模型自述或任意工具直接写入。重试与崩溃恢复还要求 canonical 发布和投影同步具有明确的单写入者与并发语义。

## 决定

- `LearningOutcomeCommitter` 是 outcome / Learning record 的领域结算入口；评估与 durable effect 分离，并以稳定 operation identity 保持幂等。
- `TeachingTurnCoordinatorHost` 是 production settlement 的 sole-writer；renderer、planner、catalog、MCP 与 Lesson 生成器不得绕过它提交正式结果。
- settlement IPC 必须携带 `expectedRevision`；revision 冲突显式失败，不采用 last-write-wins。
- 只有受信 assessment artifact 与 canonical Session Evidence 可以支持 `established` 或 `misconception_corrected`；缺失、冲突或不可信输入保守结算为 recordless 结果。
- `needs_practice` 与 `not_evidenced` 不创建 Learning record；重启、重试或 reconcile 不得把它们升级为掌握。
- fork 与 recovery 不重放历史工具，持续保持 `toolsReplayed: false`；恢复只完成已确定的 canonical settlement / projection 工作。

## 边界与后果

- settlement receipt 或 projection 不是新的教学事实源。
- reconcile 可以修复投影，不能重新解释 Evidence 或改变已结算 outcome kind。
- 工具成功、文件写入成功和模型完成都不等于学习结果成立。
- 改变 sole-writer、revision 或 Evidence 门槛需要新的 ADR。

## 实施锚点

- [LearningOutcomeCommitter](../../src/main/learning-outcome-committer.ts)
- [TeachingTurnCoordinatorHost](../../src/main/teaching-turn-coordinator-host.ts)
- [Outcome committer 门禁](../../scripts/check-learning-outcome-committer.mjs)
