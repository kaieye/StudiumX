# ADR-0100：Agent loop fallback / legacy request 纯助手 peel

- **状态：** 已实施（ADOPTION S-03 residual by-touch peel）
- **日期：** 2026-07-21
- **范围：** 将 `agent-loop.ts` 底部**纯** message-shaping 助手 `safeFallbackText` / `legacyRequestFromMessages` 抽到旁路模块；**不**改 retry、budget、schema guard、tool batch 或 provider I/O
- **相关：** [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0059](0059-read-parallel-tool-batch-in-agent-loop.md)、[ADR-0060](0060-tools-schema-session-fingerprint.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0090](0090-teaching-config-overlay-parse-peel.md)、[ADOPTION S-03](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/ai/agent-loop-fallback.ts`（新）
  - `src/main/ai/agent-loop.ts`（import + 删除本地副本）
  - `tests/unit/agent-loop-fallback.unit.test.ts`（新；纯助手行为）
  - `docs/adr/0100-agent-loop-fallback-peel.md`（本文件）

## 背景

ADR-0075 将模块尺寸政策与巨石 **按触达 peel** 纪律正式化。`agent-loop.ts` 约 900 行，**不在** legacy-giant allowlist（teaching-workspace / ledger / coordinator），但已逼近软告警带，底部同时承载：

1. 主 loop / retry / budget / schema guard / tool-result budget（产品运行时边界，耦合 execution state 与 I/O）；
2. 可选 transcript fallback 的 fail-closed 调用，以及 degraded/legacy 单发路径的 message → `{ systemPrompt, userPrompt, jsonMode }` 整形（纯函数、无 I/O）。

第 2 类与第 1 类无状态耦合，适合 **单 cluster** by-touch peel，避免把 loop 继续当「最大文件垃圾桶」。本切片**只** peel 这一 cluster；`invokeProviderWithRetry`、`budgetStopReasonFromError`、`applyToolsSchemaGuard`、`applyTurnToolResultBudget` **不**在本轮移动。

## 决定

### 1. 新模块边界

| 模块 | 职责 |
| --- | --- |
| `agent-loop-fallback.ts` | `safeFallbackText`、`legacyRequestFromMessages`（纯 message shaping / fail-closed fallback 调用） |
| `agent-loop.ts` | 主 run loop、provider retry 包装、schema guard、turn tool-result budget、budget stop 映射；**import** 上述助手 |

### 2. 行为与公共面

- 函数体与 peel 前逐字等价（trim / catch→`''`、system join、中文角色前缀与「最新用户消息」折叠、`jsonMode: false`）。
- **不**把 `safeFallbackText` / `legacyRequestFromMessages` 提升为跨包产品公共面；仍为 main AI 内部实现细节。外部继续只从 `agent-loop` 使用 `runAgentLoop` 等既有导出。
- 无 retry 策略变更、无 budget 语义变更、无 settlement / toolsReplayed 变更。

### 3. 不变量

- Degraded / tools-unsupported 路径仍用 `legacyRequestFromMessages` 折叠 transcript。
- Durable-success 与 budget-exhaustion fallback 仍经 `safeFallbackText` fail-closed（抛错或 null → 空串）。
- 无循环依赖：`agent-loop-fallback` 仅依赖 `ChatMessage` 类型（`provider-adapter`）。
- 不触达 teaching-workspace / learning-session-ledger / teaching-turn-coordinator。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/agent-loop-fallback.unit.test.ts
# 既有 loop 冒烟（可选同轮）：
CI=true pnpm exec vitest run --project unit tests/unit/agent-loop-provider-retry.unit.test.ts tests/unit/agent-loop-execution-state.unit.test.ts tests/unit/agent-loop-finish-length.unit.test.ts
```

可选：`pnpm run check:module-size`（warning-only；agent-loop 行数应实质下降）。

## 明确不包含 / non-claims

1. **不** peel `invokeProviderWithRetry`（I/O + execution 耦合）或本轮同时 peel schema guard / tool-result budget 多 cluster。
2. **不** peel teaching-workspace / ledger / coordinator 三巨石（仍为 S-03 residual by-touch）。
3. **不** 改 provider retry / rate-limit / budget stop 语义（ADR-0057 等仍为准）。
4. **不** 改 tools/schema 指纹守卫或 parallel read batch（ADR-0060 / ADR-0059）。
5. **不** 把 `check:module-size` 升为 Blocking CI。
6. **不** 引入 shell / YOLO / MCP marketplace / 远程 telemetry。
7. **不** 改 ADOPTION.md 正文（本切片仅 ADR + 代码 peel）。

## 与 ADOPTION S-03 的关系

- ADR-0075 政策 + ADR-0090 config-resolver overlay-parse peel 已落地；本 ADR 是 **agent-loop 单 helper cluster** residual peel。
- 建议 residual 措辞：S-03 政策与 by-touch pure peel（config-resolver、agent-loop fallback）已落地；**巨石**仍仅按触达 peel，禁止三线并行大搬家。
