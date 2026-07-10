# 状态、持久化与记忆边界

目标是让 agent 能力增强后仍然可审计、可恢复、可解释，同时避免把 learner memory、会话摘要和历史归档混成一套概念。

## 当前状态

`src/main/teaching-agent-conversations.ts` 持久化 conversation JSON turns。Phase 6B 后，大型 tool result 会从 JSON 中移到 `.agent-sessions/<conversationId>/tool-results/...txt` artifact；显式读取完整 conversation 时再 hydrate 回内存。Markdown 展示仍会截断 tool result。

Phase 6A 已在 `AgentChatTurn.metadata` 中保存审计 metadata：sources、child run 摘要、compaction/hygiene/context estimate 和大型 tool result 诊断。读取旧 JSON 时会 normalize/cap 这些字段，避免 malformed metadata 污染记录。

Phase 6B 已新增 `.agent-sessions/<conversationId>.jsonl` append-only sidecar，记录 header、turn、tool_call、source、child_run、compaction、hygiene、context estimate 和 tool result diagnostic entry。它是 teaching conversation 的审计投影和 artifact 索引，还不是完整 session tree 或独立 `AgentSessionStore`。

`src/shared/teaching-memory-capture.ts` 已有 learner profile memory 捕获、去重和同意流程。这是长期用户画像，不是 conversation compaction。

`src/shared/teaching-types.ts` 已有 `AgentChatMessage` / `AgentChatTurn` 和 `AgentTurnMetadata`。仍缺：

- replaced turn ids。
- checkpoint 或 archived-history 索引。
- child transcript 独立持久化。
- pending stream staging、启动恢复和 branch/fork/open 生命周期。

## 数据分层

### Conversation Turns

原始对话事实来源。保存用户消息、assistant 消息、tool call 和 tool result。

原则：

- 不因发送前 hygiene 改写原始 turn。
- 不因自动 compaction 删除原始 turn，至少 v1 不删除。
- 可以增加 metadata，让 UI 和诊断知道某些历史已被摘要覆盖。

### Compaction Items

当前会话的预算化摘要。用于继续当前会话，不是长期记忆。

建议字段：

```ts
type AgentCompactionMetadata = {
  id: string
  createdAt: string
  mode: 'normal' | 'aggressive' | 'manual'
  reason: string
  replacedTurnIds: string[]
  replacedTokenEstimate: number
  summaryTokenEstimate: number
  sourceDigest: string
  model?: string
}
```

### Child Runs

子 agent 执行记录。父 turn 只需要保存 child summary 和 child run id。

建议字段：

```ts
type AgentChildRunMetadata = {
  childRunId: string
  label: string
  profile: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  summary?: string
  error?: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    toolCalls: number
  }
}
```

### Sources

搜索和抓取产生的来源。来源应作为 turn metadata 保存，避免只藏在 assistant 文本里。

建议字段：

```ts
type AgentSourceMetadata = {
  sourceId: string
  url: string
  title?: string
  provider: string
  retrievedAt: string
  publishedAt?: string
}
```

### Learner Memory

长期用户画像。仍沿用现有 memory capture 流程：

- 只保存对未来学习有价值的信息。
- 遵守已有同意策略。
- 有注入上限。
- 不由 compaction 自动写入。

## 推荐类型扩展

`AgentChatTurn` 已增加可选 metadata，而不是引入完全不同的 turn 类型：

```ts
type AgentTurnMetadata = {
  sources?: AgentSourceMetadata[]
  compactions?: AgentCompactionMetadata[]
  childRuns?: AgentChildRunMetadata[]
  contextHygiene?: AgentContextHygieneMetadata[]
  contextEstimate?: AgentContextEstimateMetadata
  toolResults?: AgentToolResultDiagnostic[]
}
```

这样旧数据仍可读取，新 UI 可以逐步识别 metadata。当前 metadata 是审计数据；续聊 provider history projection 仍只发送 role/content。

## 持久化策略

v1：

- 原始 turns 的结构、普通消息和普通 tool result 保留在 JSON；大型 tool result 的完整内容进入 artifact。
- compaction summary 仍只作为发送投影注入；metadata 保存 compaction 诊断、sourceDigest 和 token/message 计数。
- child run 只保存最终摘要、状态、filesRead、citations 和 usage。
- sources 保存到相关 assistant turn metadata。
- 大型 tool result 归档到 `.agent-sessions/<conversationId>/tool-results/...txt`，JSON turn 保留 digest、preview、归档路径和 token/size 估算。
- `.agent-sessions/<conversationId>.jsonl` 保存 append-only 审计投影，用稳定 id 和 `parentId` 串起当前线性 turn 链。

v2：

- child transcript 单独保存，可按 childRunId 打开。
- pending stream staging 和启动恢复，避免崩溃后留下不可解释的 running/orphan child run。
- 完整 session tree/fork/replay 索引，可按 branch 或 replaced turn ids 解释历史变化。
- archived history 建索引，支持后续检索。

## Checkpoint 与恢复

短期只需要恢复安全：

- 应用重启时，内存中的 running child run 标记为 canceled 或 unknown。
- compaction summary 已写入后不得重复插入同一 digest。
- 发送前 hygiene 是纯函数，重启后可重新计算。

长期可以增加 checkpoint controller：

- 每次课程生成、批量写文件、手动压缩前创建 checkpoint。
- 支持查看 checkpoint 和恢复历史状态。
- checkpoint 不应成为 Phase 1-4 的阻塞项。

## UI 诊断

建议 UI 渐进展示：

- 当前上下文估算：local estimate、provider prompt tokens、tool schema overhead。
- 最近一次 hygiene：压缩了多少旧工具输出。
- 最近一次 compaction：原因、模式、替换 token 估算。
- 子任务列表：label、状态、耗时、错误。
- 来源列表：title、url、retrievedAt。

默认聊天界面不展开原始诊断；提供折叠入口即可。

## 风险

- JSON 无限增长：Phase 6B 已缓解父 conversation 大型 tool result 膨胀；child transcript、archived history 索引和重复 artifact 清理仍需要后续边界。
- 摘要漂移：多次压缩会累积误差，需要 source digest 和 replaced turn ids。
- 隐私泄漏：摘要生成前要复用 secret redaction，避免把 token/key 写入摘要。
- 旧任务复活：摘要必须是 reference-only，并由最新用户消息覆盖。
- memory 污染：不能把压缩摘要自动变成长期 learner memory。

