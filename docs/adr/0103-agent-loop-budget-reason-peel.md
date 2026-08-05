# ADR-0103：Agent loop budgetStopReasonFromError 纯助手 peel

- **状态：** 已实施（ADOPTION S-03 residual by-touch peel）；其中 run-budget stop reason 的产品政策已由 [ADR-0171](0171-continuous-agent-runs-and-context-governance.md) 于 2026-08-04 取代，映射代码待后续切片删除。
- **日期：** 2026-07-21
- **范围：** 将 `agent-loop.ts` 底部**纯**错误映射助手 `budgetStopReasonFromError` 抽到旁路模块；**不**改 retry、schema guard、tool-result budget、provider I/O 或 budget 策略本身
- **相关：** [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0090](0090-teaching-config-overlay-parse-peel.md)、[ADR-0100](0100-agent-loop-fallback-peel.md)、[ADOPTION S-03](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/ai/agent-loop-budget-reason.ts`（新）
  - `src/main/ai/agent-loop.ts`（import + 删除本地副本）
  - `tests/unit/agent-loop-budget-reason.unit.test.ts`（新；纯助手行为）
  - `docs/adr/0103-agent-loop-budget-reason-peel.md`（本文件）

## 背景

ADR-0075 将模块尺寸政策与巨石 **按触达 peel** 纪律正式化。ADR-0100 已将 `safeFallbackText` / `legacyRequestFromMessages` 从 `agent-loop.ts` 旁路 peel。当前 loop 仍约 870+ 行，底部仍承载：

1. 主 loop / retry / schema guard / turn tool-result budget（产品运行时边界，耦合 execution state 与 I/O）；
2. 将 thrown value 上的 `budgetStopReason` 字段映射为 `AgentRunBudgetStopReason` 的纯函数（无 I/O、无副作用）。

第 2 类与第 1 类无状态耦合，适合 **单 helper** by-touch peel。本切片**只** peel `budgetStopReasonFromError`；`invokeProviderWithRetry`、`applyToolsSchemaGuard`、`applyTurnToolResultBudget` **不**在本轮移动。

## 决定

### 1. 新模块边界

| 模块 | 职责 |
| --- | --- |
| `agent-loop-budget-reason.ts` | `budgetStopReasonFromError`（纯 error → budget stop reason 映射） |
| `agent-loop.ts` | 主 run loop、provider retry 包装、schema guard、turn tool-result budget；**import** 上述助手 |
| `agent-loop-fallback.ts` | 保持 ADR-0100 边界（message shaping / fail-closed fallback）；**不**混入 budget reason 映射，以免模块名与职责漂移 |

选择 **新文件** 而非扩展 `agent-loop-fallback.ts`：fallback 模块语义是 transcript fallback / legacy request shaping；budget-reason 映射属于独立 pure cluster，单独文件名更诚实。

### 2. 行为与公共面

- 函数体与 peel 前逐字等价是该次 peel 的历史实现事实：非 object / 缺字段 / 未知字符串 → `undefined`；仅接受 `'duration' | 'provider_calls' | 'tool_calls' | 'total_tokens'`。其中 run 级 reason 的继续使用已被 ADR-0171 取代。
- **不**把 `budgetStopReasonFromError` 提升为跨包产品公共面；仍为 main AI 内部实现细节。
- 无 retry 策略变更、无 budget 语义变更、无 settlement / toolsReplayed 变更。

### 3. 不变量

- 所有既有 call site（tools-unsupported catch、provider catch、inner loop catch、outer catch）仍调用同名纯助手。
- 无循环依赖：`agent-loop-budget-reason` 仅依赖 `AgentRunBudgetStopReason` 类型（`shared/teaching-types`）。
- 不触达 teaching-workspace / learning-session-ledger / teaching-turn-coordinator。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/agent-loop-budget-reason.unit.test.ts `
  tests/unit/agent-loop-fallback.unit.test.ts `
  tests/unit/agent-loop-provider-retry.unit.test.ts `
  tests/unit/agent-loop-execution-state.unit.test.ts `
  tests/unit/agent-loop-finish-length.unit.test.ts
```

可选：`pnpm run check:module-size`（warning-only；agent-loop 行数应实质下降）。

## 明确不包含 / non-claims

1. **不** peel `invokeProviderWithRetry`（I/O + execution 耦合）。
2. **不** peel `applyToolsSchemaGuard` / `applyTurnToolResultBudget`（本轮单 cluster only）。
3. **不** peel teaching-workspace / ledger / coordinator 三巨石（仍为 S-03 residual by-touch）。
4. **不** 改 provider retry / rate-limit / budget stop 语义（ADR-0057 等仍为准）。
5. **不** 改 tools/schema 指纹守卫或 parallel read batch（ADR-0060 / ADR-0059）。
6. **不** 把 `check:module-size` 升为 Blocking CI。
7. **不** 引入 shell / YOLO / MCP marketplace / 远程 telemetry。
8. **不** 改 ADOPTION.md 正文（本切片仅 ADR + 代码 peel）。

## 与 ADOPTION S-03 的关系

- ADR-0075 政策 + ADR-0090 / ADR-0100 pure peel 已落地；本 ADR 是 **agent-loop 单 pure helper** residual peel。
- 建议 residual 措辞：S-03 政策与 by-touch pure peel（config-resolver、agent-loop fallback、agent-loop budget-reason）已落地；**巨石**仍仅按触达 peel，禁止三线并行大搬家。
