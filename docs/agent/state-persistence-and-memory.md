# 状态、持久化与记忆边界

本文只描述尚未完成的持久化工作及其约束。现有类型以 `src/shared/teaching-types/agent.ts`、`src/main/ai/agent-run-types.ts` 和实际 reader/writer 为准，本文不复制容易漂移的 TypeScript 类型定义。

## 兼容基线

后续实现必须兼容现有 conversation JSON、session audit sidecar、tool/child artifacts、run lifecycle checkpoint 和 child lifecycle recovery。这里的基线只用于界定兼容性，不作为完成记录。

需要始终满足：

- conversation turns 是对话事实来源；发送投影、compaction 和 retrieval 不能静默改写它。
- `AgentRunCheckpoint` 表示单次运行状态，不等同于会话/历史快照 checkpoint。
- child transcript 和 archived content 不自动展开进父上下文。
- learner memory、conversation compaction、archived retrieval 使用独立的写入与读取策略。
- 所有路径必须经过 workspace 包含关系、稳定 id、大小上限和完整性校验。

## SDK/provider hooks 对持久化的要求

- hook 只输出规范化事件，不把 SDK 私有对象直接写入 checkpoint、turn metadata 或 sidecar。
- usage、retry、rate limit、stop reason 和错误需要区分 provider 报告值、本地估算值和 unknown。
- 重复或乱序 hook 不能重复计费、重复终结 run 或推进错误的 durable sequence。
- provider metadata 在持久化前必须经过字段白名单、大小限制和 secret redaction。

## 开放问题

- retrieval 内容进入 provider context 时使用专用 message role、tool result 还是 reference block。

## 主要风险

- provider metadata 会扩大敏感信息落盘面，redaction 必须先于持久化。
- retrieval 与 compaction 反复转换可能导致语义漂移，必须保留 provenance、digest 和截断诊断。
