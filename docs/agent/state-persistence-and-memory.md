# 状态、持久化与记忆边界

本文只描述尚未完成的持久化工作及其约束。现有类型以 `src/shared/teaching-types/agent.ts`、`src/main/ai/agent-run-types.ts` 和实际 reader/writer 为准，本文不复制容易漂移的 TypeScript 类型定义。

## 兼容基线

后续实现必须兼容现有 conversation JSON、session audit sidecar、tool/child artifacts、run lifecycle checkpoint 和 child lifecycle recovery。这里的基线只用于界定兼容性，不作为完成记录。

需要始终满足：

- conversation turns 是对话事实来源；发送投影、compaction 和 retrieval 不能静默改写它。
- `AgentRunCheckpoint` 表示单次运行状态，不等同于会话/历史快照 checkpoint。
- event bus 的短窗口 replay 不等同于 durable session replay。
- child transcript 和 archived content 不自动展开进父上下文。
- learner memory、conversation compaction、archived retrieval 使用独立的写入与读取策略。
- 所有路径必须经过 workspace 包含关系、稳定 id、大小上限和完整性校验。

## 开放问题

当前没有待决的持久化设计问题。

## 主要风险

- 多个持久化层可能形成互相冲突的事实来源，必须为每种数据声明权威来源和重建方向。
- replay 处理不当会重复产生副作用或把未确认内容伪装成最终回答。
- branch 删除、归档或恢复前必须验证既有 checkpoint 与 artifact 引用完整性。
- retrieval 与 compaction 反复转换可能导致语义漂移，必须保留 provenance、digest 和截断诊断。