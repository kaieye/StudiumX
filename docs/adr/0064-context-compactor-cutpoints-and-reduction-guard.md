# ADR-0064：ContextCompactor 切点策略、不足缩减守卫与审计字段

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** 增量 hardening `ContextCompactor` 的 cut-point 文档/导出、不足缩减守卫、审计事件字段；**不**替换压缩引擎
- **相关：** [ADOPTION B-09](0121-improvements-adoption-closeout.md)、[ADR-0045](0045-context-hygiene-ladder-and-quality-gates.md)（投影阶梯层 A）、[ADR-0013](0013-budgeted-provenance-aware-teaching-context.md)（教学 context 分离）
- **证据路径：** `src/main/ai/context-compactor.ts`、`tests/unit/context-compactor.unit.test.ts`、`docs/adr/0064-context-compactor-cutpoints-and-reduction-guard.md`

## 背景

`ContextCompactor` 已在产品路径中作为 provider 投影压缩实现（ADR-0045 层 A：hygiene → threshold → compact）。B-09 要求在**不换引擎**的前提下：

1. 把切点（cut-point）策略说清楚并可导出，避免下游误读为「任意裁剪」；
2. 在压缩完成后若 token/消息节省不足，**fail closed** 为 no-op，保留原始 transcript；
3. 丰富 `ContextCompactionEvent` 审计字段（cut index、移除/保留计数、封闭 outcome code），便于诊断与 ProjectionReport 侧消费。

产品地板：失败路径**始终**保留原始 messages；**不**默认 durable rewrite 学习者会话 JSON 正文。

## 决定

### 1. 切点策略（文档 + 常量）

导出 `CONTEXT_COMPACTOR_CUT_POINT_STRATEGY` 与 JSDoc 策略说明。选择顺序：

| 步骤 | 行为 |
| --- | --- |
| System boundary | 保留前缀连续 `system` 消息 |
| Recent tail | 按 `normalTailRatio` / `aggressiveTailRatio` token 预算 + `minTailMessages` 从尾部向内增长保留后缀 |
| Latest user anchor | 切点不得落在最新 `user` 之后（最近用户输入留在后缀） |
| Tool-pair repair | 保留后缀中的 `tool` 结果若会孤儿化其 assistant `tool_calls`，则边界前移以闭合配对 |
| Middle compact | 仅 `[systemCount, cutIndex)` 进入摘要；不足 `minMessagesToCompact` 则跳过 |
| Reference-only | 摘要以 system 插入 prefix 与 tail 之间；**默认不**写回 session JSON body |
| Reduction guard | 见下节 |

辅助导出：`selectCompactionCutIndex`（纯切点选择，供单测）。

### 2. 不足缩减守卫

新增选项（带默认）：

- `minTokenSavings`（默认 32）：绝对 token 节省下限
- `minTokenReductionRatio`（默认 0.05）：相对 `(before-after)/before` 下限

`reductionMeetsGuard(...)` 纯函数：两者**都**须满足。候选消息估完 token 后若不达标：

- `changed: false`
- `messages` 仍为**原始**数组引用语义（调用方传入的 transcript）
- 发出 `context_compaction_failed`，`outcomeCode: 'insufficient_reduction'`
- 进入 failure cooldown（与 summarize 异常相同）
- **不**缓存该 summary digest

### 3. 审计字段（封闭 outcome）

`ContextCompactionOutcomeCode` 闭集：

- `completed`
- `insufficient_reduction`
- `summary_empty`
- `summarize_error`

生命周期事件增量字段：

| 事件 | 新增字段 |
| --- | --- |
| `context_compaction_started` | `cutIndex`, `systemPrefixCount`, `messagesRemovedCount`, `keptSuffixCount` |
| `context_compaction_completed` | 同上 + `tokenSavings`, `outcomeCode: 'completed'`；保留 `replacedMessages` / `tailMessages` 兼容别名 |
| `context_compaction_failed` | 同上 + `outcomeCode`；不足缩减时可选 `beforeTokens` / `afterTokens` / `tokenSavings` |

### 4. 失败与非持久化

- summarize throw / empty summary / insufficient reduction：**一律**保留原始 transcript，`changed: false`。
- 压缩仅影响**本轮 provider 投影**（RequestContextProjector 路径）；本切片**不**开启 durable compaction boundary（ADR-0045 层 B）。

## 已实施范围与验证入口

- `src/main/ai/context-compactor.ts`（增量；引擎类保留）
- `tests/unit/context-compactor.unit.test.ts`
- 既有 fixture 检查仍有效：`pnpm run check:context-compactor`

```powershell
pnpm exec vitest run --project unit tests/unit/context-compactor.unit.test.ts
pnpm run check:context-compactor
```

## 不变量

- 失败路径不得丢弃或改写调用方 transcript。
- 默认不 durable rewrite 会话正文。
- 切点须保留 leading system、最近 user、tool pair 闭合。
- 不足缩减不得当作成功 completed。
- 不替换 ContextCompactor 引擎 / 不引入 shell / MCP / FTS / YOLO / 远程 telemetry。

## 不包含 / non-claims

- **不**实现 ADR-0045 层 B durable compaction boundary。
- **不**改 teaching context assembler（ADR-0013）或 prompt-cache 稳定前缀（ADR-0044）组装。
- **不**改 settlement sole-writer / ledger 权威。
- **不**用新引擎替换摘要策略（仍为注入的 `summarize` adapter）。
- **不**保证跨 provider 的 token 估算精确到计费级（本地 estimator 仍为近似）。
