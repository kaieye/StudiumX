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

## 未完成：Session tree 与 durable replay

### 目标模型

未来 session 需要显式的 `sessionId`、`branchId`、branch head、fork point 和 replay source。当前线性 `parentId` 不能被直接解释成完整 branch 模型。

### 设计约束

- fork 后原 branch 不变，新 branch 共享不可变历史引用并拥有独立 head。
- replay 只重建允许的输入与审计上下文；默认不重新执行写工具、权限决定或外部请求。
- session replay 与 event bus 的短窗口事件 replay 必须使用不同 API 和命名。
- archived retrieval 结果、compaction summary 和 recovery notice 都要保留各自 provenance，不能转成普通原始 turn。
- branch 删除或归档前要检查 checkpoint 与 artifact 引用完整性。
- 并发打开和写入同一 branch 需要明确的版本冲突策略。

### 验收重点

- 可从允许的历史点 fork、打开和继续不同 branch。
- 重启与索引重建后 branch lineage 保持稳定。
- UI 能区分原始历史、fork 后新增内容、replay 输出和 recovery notice。

## SDK/provider hooks 对持久化的要求

- hook 只输出规范化事件，不把 SDK 私有对象直接写入 checkpoint、turn metadata 或 sidecar。
- usage、retry、rate limit、stop reason 和错误需要区分 provider 报告值、本地估算值和 unknown。
- 重复或乱序 hook 不能重复计费、重复终结 run 或推进错误的 durable sequence。
- provider metadata 在持久化前必须经过字段白名单、大小限制和 secret redaction。

## 开放问题

- branch 并发冲突采用乐观版本、单写者锁还是显式 fork。
- retrieval 内容进入 provider context 时使用专用 message role、tool result 还是 reference block。

## 主要风险

- 多个持久化层可能形成互相冲突的事实来源，必须为每种数据声明权威来源和重建方向。
- replay 处理不当会重复产生副作用或把未确认内容伪装成最终回答。
- provider metadata 会扩大敏感信息落盘面，redaction 必须先于持久化。
- branch 删除、归档或恢复前必须验证既有 checkpoint 与 artifact 引用完整性。
- retrieval 与 compaction 反复转换可能导致语义漂移，必须保留 provenance、digest 和截断诊断。
