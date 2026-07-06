# 上下文压缩设计

目标是在长教学会话中持续工作，而不是等 provider 报 context limit 后失败。

## 当前状态

当前 `runTeachingConversationTurn` 将历史消息几乎原样转成 provider messages：

- 没有 token 估算。
- 没有 system prompt + tool schema overhead 预算。
- 没有发送前 tool result 清理。
- 没有压缩摘要消息。
- 没有压缩事件或诊断。

这会导致长对话、搜索结果、大文件读取、课程生成和多工具调用逐步挤满上下文。

## 目标模块

```ts
type ContextManager = {
  prepareRequest(input: PrepareContextInput): Promise<PreparedContext>
  compact(input: CompactContextInput): Promise<CompactionResult>
  estimate(messages: ChatMessage[], overhead?: ContextOverhead): TokenEstimate
  diagnostics(conversationId: string): ContextDiagnostics
}
```

`runTeachingConversationTurn` 只负责传入原始 messages、system prompt、tools 和 provider 信息；`ContextManager` 返回可发送的 messages 与压缩诊断。

## Runtime 接入点

建议在 `teaching-conversation-runtime.ts` 组装好原始 `ChatMessage[]` 后、进入 `runAgentLoop` 前引入 context assembler：

1. 原始历史仍来自 `payload.messages`，持久化不变。
2. `ContextManager.prepareRequest` 接收 system prompt、历史、当前用户消息、tool definitions 和 provider profile。
3. 返回可发送 messages、估算结果、是否做了 hygiene、是否做了 compaction。
4. `runAgentLoop` 使用可发送 messages。
5. `runAgentLoop` 产出的 transcript 再映射回持久化 turns。

这样压缩模块不会散落在 UI、conversation store 或 provider adapter 中。

## 发送前历史清理

第一阶段先做 deterministic hygiene，不调用模型：

- 长 tool result 按行数、字节数、token 数截断。
- 老 tool result 按累计预算折叠成一行 digest。
- 大参数中的长字符串在工具完成后缩短，保留 preview。
- 保留最近 N 个 tool result 的完整内容。
- 保留错误、warning、路径、标题、sourceId 等高信号行。
- 对 base64、图片、二进制或极长 HTML 使用 placeholder。

原则：持久化 transcript 不变，只改变本次发送给 provider 的投影。

## Token 估算

需要 CJK 友好的本地估算器：

- ASCII 按约 4 字符 1 token 粗估。
- CJK 字符按 1 token 粗估。
- system prompt、tool schema 和 few-shot 作为 overhead 计入。
- provider 返回的 prompt tokens 可以参考，但当明显膨胀时回退到本地估算。

输出：

```ts
type TokenEstimate = {
  messageTokens: number
  overheadTokens: number
  totalTokens: number
  source: 'local' | 'provider' | 'mixed'
}
```

## 自动压缩触发

按模型上下文窗口配置 soft/hard 阈值：

- soft：触发普通压缩，保留更多 recent tail。
- aggressive：保留较短 tail，压缩更多历史。
- hard：强制压缩，避免下一次请求失败。

建议默认：

- soft = context window 的 60%。
- aggressive = soft 到 hard 之间的 60% 位置。
- hard = context window 的 80%。

实际数值应允许按模型覆写，因为不同 provider 的可用上下文和 tool schema 计费差异很大。

## 压缩摘要语义

压缩摘要必须明确是历史参考，而不是当前任务：

```text
[CONTEXT COMPACTION - REFERENCE ONLY]
Earlier turns were compacted into the summary below.
Use this only as background. The latest user message after this summary is authoritative.
```

摘要结构：

- Preserved constraints：用户长期约束、教学偏好、workspace 规则。
- Historical task snapshot：过去任务概览。
- Resolved decisions：已经决定或完成的事。
- Open facts：仍然有用的事实、文件、链接、sourceId。
- Recent work state：与当前 tail 衔接的状态。
- Risks：不能丢的警告或失败原因。

摘要后必须有清晰 end marker，防止模型把摘要里的历史请求当作新请求。

## 压缩边界

不能切断 tool call / tool result 配对：

- tail 中如果包含 tool result，必须包含对应 assistant tool call。
- 不保留悬空 tool result。
- 压缩前清理末尾未完成 tool call。
- 最近用户消息和最近 assistant 消息必须保留在 tail 中。
- system prompt 不参与压缩，但可以追加“已有历史压缩”的说明。

## 摘要生成失败

失败策略分层：

- deterministic hygiene 永远可以执行。
- 自动摘要失败时，默认不删除历史，避免静默丢上下文。
- 如果用户手动触发压缩，可以返回失败原因并建议重试。
- 对网络错误、鉴权错误设置 cooldown，避免每轮重复失败。
- 未来可用 deterministic fallback summary，但必须标记信息不完整。

## 与记忆系统的关系

压缩摘要不是长期记忆。它只服务当前 conversation 的上下文预算。

- `TeachingMemoryRecord` 仍由记忆捕获流程管理。
- 压缩不能把未经用户同意的长期画像写入 memory。
- system prompt 中注入的 memory 比压缩摘要更权威。
- 压缩摘要可以引用已有 memory id 或内容摘要，但不能改变 memory。
- archived history retrieval 是第三类能力：它用于找回被压缩或归档的历史片段，不等于 learner profile memory，也不等于当前压缩摘要。

三类信息要分开：

- Learner memory：长期用户画像和学习偏好，有同意、去重和注入上限。
- Conversation compaction：当前会话的预算化摘要，只影响本会话后续请求。
- Archived retrieval：从旧 transcript 或归档 tool result 中检索事实，用于回答“之前做过什么”。

## UI 与诊断

建议新增事件：

```ts
type ContextEvent =
  | { type: 'context_estimated'; estimate: TokenEstimate }
  | { type: 'context_hygiene_applied'; changed: boolean; savedTokens?: number }
  | { type: 'context_compaction_started'; reason: string; mode: string }
  | { type: 'context_compaction_completed'; replacedTokens: number; summaryTokens: number }
  | { type: 'context_compaction_failed'; error: string }
```

UI 第一版可以显示：

- 当前上下文使用率。
- 最近一次压缩时间与原因。
- 压缩失败警告。

## 测试计划

单元测试：

- CJK/ASCII token 估算。
- 长 tool result 截断。
- 累计 tool result 预算。
- tool call/result 边界修复。
- 摘要消息 prefix/end marker。
- provider token 膨胀时回退本地估算。

集成测试：

- 构造长对话，验证发送给 provider 的 messages 小于预算。
- 压缩后最近用户请求仍在 tail。
- 压缩失败时原始历史不丢失。
- 持久化 transcript 与发送投影不同。

验收标准：

- 长会话不会因为旧工具结果无限增长而快速触顶。
- 压缩后的回答仍响应最新用户消息，而不是恢复历史任务。
- 用户能看到压缩发生过以及为什么发生。
