# ADR-0052：Provider 错误 UX 与 recovery taxonomy 双轴

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** `classifyProviderError` 修正 quota/billing 与 `rate_limit` 混淆；新增纯函数 `classifyProviderRecovery`（flags only，**未**接线 auto-retry）
- **相关：** [ADOPTION A-03 / A-04](0121-improvements-adoption-closeout.md)、后续 A-05（有界 retry，不在本 ADR）

## 背景

StudiumX 原先只有 UX 四类 `ProviderErrorKind`：

`insufficient_balance | authentication | rate_limit | http`

`classifyProviderError` 将 `/rate limit|too many requests|quota exceeded/` 一并映射到 `rate_limit`。  
这会把 **配额/计费耗尽** 误标成 **节流**，造成：

1. 用户文案错误（提示“稍后重试”而实际需要充值/提配额）；  
2. 未来 A-05 auto-retry 的脚枪：对 billing 盲目重试烧钱/无意义。

来源证据：historical `pi` review (see ADR-0121)（NON_RETRYABLE 含 `quota exceeded`）、`hermes.md`（recovery flags 与 UX 解耦）。

## 决策

### 1. UX 轴保持 4 类（A-03）

- **不**新增 `quota` / `billing` UX kind。  
- 账单余额、`quota exceeded`、`insufficient_quota`、billing hard limit、中文「余额/额度/配额不足」→ **`insufficient_balance`**。  
- **仅**真正的 429 / `rate limit` / `too many requests` → **`rate_limit`**。  
- 分类顺序：**billing/quota 先于 rate_limit**（即使 HTTP 看起来像 429，quota 语言优先）。  
- `providerErrorReason` 与 i18n：余额/配额统一为「余额或配额不足」，速率限制文案标明「与配额耗尽不同」。

### 2. Recovery 轴独立（A-04）

新建 `src/shared/provider-recovery.ts`：

```ts
classifyProviderRecovery(error) → {
  class, retryable, shouldCompress, shouldFallback, reasonCode, uxKind?, status?, providerMessage?
}
```

| 类 | retryable | shouldCompress | shouldFallback | 说明 |
| --- | --- | --- | --- | --- |
| `billing` | false | false | true | 含 balance + quota |
| `authentication` | false | false | false | 永久鉴权失败 |
| `rate_limit` | true | false | true | 节流；flags only |
| `overloaded` / `server_error` / `timeout` / `network` | true | false | true | 传输/上游 transient |
| `empty_stream` | true | false | true | 独立类（可检测 EmptyStreamError / 空流文案） |
| `context_overflow` | false | true | false | 优先压缩，不盲重试 |
| `max_tokens` | false | false | false | length truncation |
| `payload_too_large` | false | true | false | 413 等 |
| `format_error` / `content_policy` | false | false | true | 改请求或换模型 |
| `http` / `unknown` | false | — | 视情况 | 保守默认 |

**禁止（本切片与默认产品）：**

- 凭证多 key 轮换（`should_rotate_credential` 不存在）  
- 在 agent-loop 内自动 sleep/retry（A-05）  
- shell / MCP / telemetry / YOLO 相关扩展  

### 3. 调用面

- `operationFeedback` 继续只吃 UX kind；`insufficient_balance` 路径覆盖 quota。  
- `lesson-plan-production` `providerErrorReason` 使用更新后的文案。  
- **不**改 agent-loop / hooks 重试策略。

## 已实施范围与验证入口

- `src/shared/provider-error.ts`
- `src/shared/provider-recovery.ts`（新建）
- `src/renderer/src/app-shell/operationFeedback.ts`（既有 switch 兼容）
- i18n：`zh-CN.json` / `en-US.json` provider 文案
- `scripts/check-provider-errors.mjs`
- 单测：`tests/unit/provider-error.unit.test.ts`、`provider-recovery.unit.test.ts`、`operation-feedback.unit.test.ts`

```bash
pnpm run check:provider-errors
pnpm exec vitest run --project unit \
  tests/unit/provider-error.unit.test.ts \
  tests/unit/provider-recovery.unit.test.ts \
  tests/unit/operation-feedback.unit.test.ts
```

## 不包含 / non-claims

- **不**实施有界 jittered retry、Retry-After、共享 retry budget、circuit breaker（A-05）。  
- **不**实施 credential rotation 或未配置聚合器的自动 failover。  
- **不**把 recovery flags 写入 wire/journal 事件（留给 A-05）。  
- **不**保证覆盖所有上游方言错误码；分类为 best-effort 模式匹配，未知默认 `unknown` 且 `retryable: false`。
