# ADR-0057：Provider 有界 jittered retry 与共享 run budget

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** 纯策略 `provider-retry.ts` + `agent-loop` 对 provider 调用失败路径的有界自动重试接线
- **相关：** [ADR-0052](0052-provider-error-and-recovery-taxonomy.md)（A-04 flags）、[ADOPTION A-05](0121-improvements-adoption-closeout.md)

## 背景

A-04 已提供双轴中的 recovery flags（`classifyProviderRecovery` → `retryable` / `shouldCompress` / `shouldFallback`），但 `agent-loop` 在 `streamChatProvider` / recovery / finalization 等路径上仍是「首个 provider 错误即 `execution.failed`」。  
真正的节流/上游 transient（429、5xx、timeout、network、empty_stream）需要 **有界、可注入、计入 run budget** 的自动重试；billing / auth / overflow / length 则 **永久禁止** 自动重试。

## 决策

### 1. 纯策略模块 `src/shared/provider-retry.ts`

- `planProviderRetry`：根据 `classifyProviderRecovery(error).retryable` 与 `ProviderRetryBudget` 决定 `retry | fail`。
- `withProviderRetry`：小异步 helper——sleep + 再调用；**不**负责 maxProviderCalls 记账（由 loop 在每次 `run(attempt)` 内 `budgetStop` + `startProviderCall`）。
- 默认 `maxAttempts = 3`（1 次原始 + 最多 2 次重试）。
- Backoff：base ≈ 250ms，指数，**full jitter**，上限 8s；若存在 `retryAfterMs` 则 `max(backoff, retryAfter)` 再加小 jitter。
- AbortSignal 中止等待。
- **无** credential 多 key 旋转 API；**无** 本切片强制 circuit-breaker。

### 2. 共享 budget 双轴

| 轴 | 权威 | 作用 |
| --- | --- | --- |
| Run budget | 既有 `AgentLoopExecutionState` / `maxProviderCalls` / duration / tokens | 每次 retry 尝试仍 `startProviderCall`，耗尽则 `budget_exhausted` |
| Retry attempt cap | `ProviderRetryBudget.maxAttempts`（默认 3） | 单次逻辑 provider 调用的 transport 重试上限 |

两轴同时生效：任一先到即停止。

### 3. Loop 接线（仅 provider 错误路径）

`invokeProviderWithRetry` 包装：

- 主循环 `streamChatProvider`
- unsupported 端点 `streamProvider`
- iteration-limit recovery `streamChatProvider`
- finalization `streamChatProvider`

诊断：

- status 消息前缀 `auto_retry_scheduled:<reasonCode>:attempt=…:delayMs=…`
- 多尝试耗尽时 `auto_retry_exhausted:<reasonCode>:attempts=…`
- `execution.noteProviderRetry` → 既有 `ProviderHookEvent` kind `retry`（及 rate_limit 时 `rate_limit`）

**不**改 tool batch（B-03）、finish/length 门（A-01/A-02）、settlement sole-writer。

### 4. 永不自动重试（由 A-04 flags 强制）

- billing / quota
- permanent authentication
- context_overflow
- max_tokens / length truncation
- payload_too_large / format_error / content_policy（`retryable: false`）
- 未知/非 transient HTTP（保守 `retryable: false`）

`shouldCompress` 可被观测；**本切片不**在 retry 路径强制 compress-on-retry。

## 已实施范围与验证入口

- `src/shared/provider-retry.ts`（新建）
- `src/main/ai/agent-loop.ts`（provider 调用 wrap + 诊断）
- `src/main/ai/agent-loop-execution-state.ts`（`noteProviderRetry`）
- `tests/unit/provider-retry.unit.test.ts`
- `tests/unit/agent-loop-provider-retry.unit.test.ts`（可选 loop smoke）

```bash
pnpm exec vitest run --project unit tests/unit/provider-retry.unit.test.ts
pnpm exec vitest run --project unit tests/unit/provider-recovery.unit.test.ts
pnpm exec vitest run --project unit tests/unit/agent-loop-finish-length.unit.test.ts
pnpm exec vitest run --project unit tests/unit/agent-loop-provider-retry.unit.test.ts
pnpm run check:provider-errors
```

## 不包含 / non-claims

- **不** credential multi-key rotate / 未配置聚合器的自动 failover。
- **不** YOLO / always-approve / shell / MCP marketplace。
- **不** circuit-breaker 产品面（可后续纯内存可选）。
- **不** 在 retry 失败时自动 compress 再试（除非未来独立切片）。
- **不** 改 settlement / toolsReplayed / 自动 memory / 远程 telemetry。
