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

## 未完成：会话/历史 checkpoint 与 archived retrieval

### 定义

- **Run lifecycle checkpoint**：已有的单次运行状态记录，不负责历史快照。
- **会话/历史 checkpoint**：待设计的可命名恢复点，用于解释或恢复某个 conversation/session 的历史状态。
- **Archived retrieval**：显式查询已归档 turn、tool result 或 child transcript，并返回有界内容与稳定引用。

### 设计约束

- checkpoint 不复制大型 artifact；优先保存稳定引用、head、digest、schema version 和创建原因。
- 检索索引必须可以从权威 conversation、sidecar 和 artifact 重建。
- retrieval 默认不注入 provider history；注入必须由上层显式请求，并记录来源、预算和截断信息。
- retrieval 结果不能自动写入 learner memory，也不能被伪装成原始 user/assistant turn。
- 缺失 artifact、hash 不匹配、索引损坏和旧 schema 必须以可解释错误返回，不能静默降级为错误内容。
- 手动压缩、课程生成和批量写文件是否自动创建 checkpoint，需要在实现前确定一致策略。

### 验收重点

- 可以按 conversation、时间范围和 artifact 类型进行有界检索。
- 索引删除后可以重建，重建不会修改原始 turns。
- checkpoint 恢复不会重新执行有副作用工具。
- UI 能显示 retrieval 来源和 checkpoint 关系，而不是只展示无来源摘要。

相关 seam：

- `src/main/agent-conversation-session-audit.ts`
- `src/main/agent-conversation-archive.ts`
- `src/main/teaching-agent-conversations.ts`
- `src/shared/agent-conversation-catalog.ts`

## 未完成：Artifact 生命周期

### 范围

- tool result、child transcript、parent-turn staging 和索引文件的保留期。
- 孤儿 artifact 发现、重复内容处理、引用计数或等价保护机制。
- dry-run 清理、删除审计、失败重试和索引重建。
- 写入前 secret redaction，以及清理日志自身的隐私过滤。

### 约束

- 清理前必须证明 artifact 不再被有效 conversation、checkpoint、branch 或 audit entry 引用。
- 内容 digest 可以用于检测重复，但不能仅凭 digest 合并具有不同权限或来源语义的记录。
- 清理操作必须幂等；部分失败后重试不能扩大删除范围。
- 默认保留策略需要可配置，但不能允许不受上限的永久增长作为唯一模式。

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

- 会话 checkpoint 的默认创建时机和用户可见命名方式。
- archived-history 索引采用可重建文件索引还是独立数据库。
- artifact 保留策略按时间、大小、conversation 状态还是组合阈值执行。
- branch 并发冲突采用乐观版本、单写者锁还是显式 fork。
- retrieval 内容进入 provider context 时使用专用 message role、tool result 还是 reference block。

## 主要风险

- 多个持久化层可能形成互相冲突的事实来源，必须为每种数据声明权威来源和重建方向。
- replay 处理不当会重复产生副作用或把未确认内容伪装成最终回答。
- archive 索引和 provider metadata 会扩大敏感信息落盘面，redaction 必须先于持久化。
- branch、checkpoint 和清理相互依赖，任何删除操作都必须先验证引用完整性。
- retrieval 与 compaction 反复转换可能导致语义漂移，必须保留 provenance、digest 和截断诊断。
