# ADR-0051：Provider finish/stop 信号透传与 length 截断拒 tool 执行

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** `ChatAdapterResult.finishReason`、adapter SSE/JSON 解析、`recordProviderUsage` 真实 stop、agent-loop 对 `length` 整批拒绝 tool 执行
- **相关：** [ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、ADOPTION A-01 / A-02

## 背景

Provider 响应（chat completions `finish_reason`、messages `stop_reason`、responses `status` / incomplete details）携带终态信号，但本仓库此前：

1. `ChatAdapterResult` 只有 `text` / `toolCalls` / `toolsSupported` / `usage`，**没有** finish 字段；
2. `AgentLoopExecutionState.recordProviderUsage` 把 provider hook ledger 的 stop **写死为 `'stop'`**，掩盖 length / tool_calls / content_filter 等真实原因；
3. agent-loop 在收到任意 `toolCalls` 时串行 `executeToolCall`，**不检查** finish 是否为 length 截断。截断后的 tool 参数常不完整，执行会引入 workspace 副作用。

ADOPTION A-01 / A-02 与 pi/grok 运行时正确性要求：透传 finish 信号，并在 length 时整批拒绝 tool 副作用。

## 决策

### 1. Adapter 结果携带可选 finishReason

- `ChatAdapterResult.finishReason?: ProviderStopReason`
- 取值对齐既有 `ProviderStopReason`：`'stop' | 'length' | 'tool_calls' | 'content_filter' | 'canceled' | 'error' | 'other'`（经 `normalizeStopReason`）
- **缺省含义：** 响应未给出可用终态信号。**禁止**在 ledger 侧伪造 `'stop'`。

### 2. 解析层填充

| 来源 | 字段 |
| --- | --- |
| chat_completions / custom_endpoint JSON | `choices[0].finish_reason` |
| chat_completions SSE | 末包 / 任一块 `choices[0].finish_reason`（last-wins） |
| messages JSON | `stop_reason` |
| responses JSON | `status`（`completed`→stop，`incomplete`+detail→length 等） |

实现：`extractFinishReason`（`response-parser.ts`）、`readChatSseStream` 返回 `finishReason`（`sse-parser.ts`）、`callChatInvocation` / `streamChatInvocation` / `requestChatJson` 写入 `ChatAdapterResult`。

### 3. Hook ledger 使用真实 reason

- `recordProviderUsage(usage, source?, finishReason?)`：仅当 `finishReason` 存在时 `providerHooks.record({ kind: 'stop', reason: finishReason })`
- 无 finish 信号时不写 stop 事件（call 可保留 usage 与 request_started，terminal 保持未决）

### 4. length + toolCalls → 零 handler

- 主循环与 recovery 路径：若 `finishReason === 'length'` 且 `toolCalls.length > 0`：
  - **不**调用 `executeToolCall` / `startToolCall`
  - 发出 `status: error` 诊断文案
  - 为每个 call 写入 isError 的 tool result（闭合 pair），`error: tool_calls_rejected_due_to_length`
  - 主循环 `continue` 进入下一 iteration 或后续 finalization；recovery 同理 `continue`
- `finishReason` 为 `stop` / `tool_calls`（或其它非 length）且有 toolCalls：行为不变，正常执行
- 纯 length 且无 toolCalls：仍可作为文本终答结束（不强制 error）

### 5. 不变量

- 不改变 LearningSession / outcome settlement sole-writer
- 不引入自动 retry、YOLO、凭证轮换、默认 shell / MCP marketplace / 远程 telemetry
- 空串 args→`{}` 的既有 `parseToolArguments` 行为保持；本切片不依赖改 tool-arguments

## 已实施范围与验证入口

- `src/main/ai/provider-adapter.ts` — `ChatAdapterResult.finishReason`
- `src/main/ai/provider-adapter/response-parser.ts` — `extractFinishReason`
- `src/main/ai/provider-adapter/sse-parser.ts` — stream `finishReason`
- `src/main/ai/provider-adapter/invocation.ts` — 填充结果
- `src/main/ai/agent-loop-execution-state.ts` — 真实 stop reason
- `src/main/ai/agent-loop.ts` — length 整批拒 tool（主循环 + recovery）

```bash
pnpm exec vitest run --project unit \
  tests/unit/provider-finish-reason.unit.test.ts \
  tests/unit/agent-loop-finish-length.unit.test.ts \
  tests/unit/agent-loop-execution-state.unit.test.ts \
  tests/unit/provider-hooks.unit.test.ts \
  tests/unit/provider-sse-dsml.unit.test.ts
```

## 不包含 / non-claims

- **不** 实现 A-03–A-05 的自动 retry / 恢复 wiring（仅 finish 字段 + length gate）
- **不** 在 length 时自动重试 provider 或自动提高 max_tokens
- **不** 改变 settlement sole-writer 或 LearningSession ledger authority
- **不** 默认 shell、MCP marketplace、远程 telemetry、YOLO / 凭证轮换
- **不** 把缺 finish 信号伪造为 `'stop'`
- **不** 改变 tool-arguments 空串→`{}` 策略（既有行为；privileged 副作用仍受 effect / approval 门控）
