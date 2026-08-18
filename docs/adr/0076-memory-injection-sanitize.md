# ADR-0076：记忆注入消毒（prompt injection sanitize）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施
- **日期：** 2026-07-21
- **范围：** 纯共享 `memory-sanitize` 模块；recall→inject 边界对 memory content 做轻量消毒
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md)、[ADR-0007](0007-persisted-user-history-redaction.md)、[ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)、[ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADOPTION S-10](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/memory-sanitize.ts`
  - `src/main/teaching-memory-recall.ts`（`retrieve` 返回前 sanitize content）
  - `tests/unit/memory-sanitize.unit.test.ts`

## 背景

跨会话记忆在 lesson / conversation prompt 注入时可能夹带控制字符、绝对路径或密钥形态字符串。产品地板要求同意门控 memory，并**禁止 FTS5 / 向量库作产品搜索**。S-10 本切片只补「注入前消毒」纯函数与最小接线，不重做检索排序。

## 决策

### 1. 纯共享 sanitize 模块

`src/shared/memory-sanitize.ts` 导出：

| 函数 | 行为 |
| --- | --- |
| `sanitizeMemoryInjectionText(raw, opts?)` | 去控制字符（保留 `\n`/`\t`）、折叠过量空白/连续换行、默认 2000 字截断、轻量密钥形态 redact、绝对路径前缀 → `[path]`；坏输入不抛，回落 `''` |
| `sanitizeMemoryRecordsForPrompt(records, opts?)` | 对每条 `content` 消毒；丢空；保序；可选 `totalBudget` |

密钥形态复用既有 `redactAgentSecretText`（与 agent 持久化脱敏同源），不新开搜索面。

### 2. 最小接线

`TeachingMemoryRecall.retrieve` 在选出候选后、返回前对每条 `content` 调用 `sanitizeMemoryInjectionText`，并丢弃消毒后为空的条目。  
**不**改 catalog 持久化正文、**不**改 consent 策略、**不**改 n-gram 打分算法本身（打分仍用原始 catalog 文本）。

### 3. 不变量

- 同意门控 memory：`settings.memory.enabled` 仍为总闸。
- 无默认 shell / 无 MCP marketplace / 无自动 remote telemetry。
- 不把消毒后的文本当作新的 durable authority；sanitize 仅作用于 injection 边界返回值。
- 动态记忆仍不 bake 进稳定 system prefix（ADR-0044）。

## 已实施范围与验证入口

```bash
CI=true pnpm exec vitest run --project unit \
  tests/unit/memory-sanitize.unit.test.ts \
  tests/unit/teaching-memory-recall.unit.test.ts
```

## 不包含 / non-claims

- **不** 实施 SQLite FTS5、产品全文搜索 UI、或向量 / embedding 检索。
- **不** 启动自动 memory phase / dream / 静默改写 learner-profile / 自动 skill 创建。
- **不** 重设计跨会话 recall 排序或 n-gram 打分策略（词法引擎仍以 ADR-0050 为准）。
- **不** 改变 consent capture 语义或 Memory catalog 分区 / migration 权限（C-6 destructive 仍延期）。
- **不** 把所有 prompt 组装点一次性扫完；conversation turn-tail 等若另有注入路径可后续单独立项接线同一 helper。
