# ADR-0106：Agent loop applyToolsSchemaGuard pure-ish peel

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-03 residual by-touch peel）
- **日期：** 2026-07-21
- **范围：** 将 `agent-loop.ts` 底部 **pure-ish** 助手 `applyToolsSchemaGuard`（`assertToolsSchemaStable` + status emit）抽到旁路模块；**不**改 schema 语义、retry、tool-result budget、provider I/O 或 budget 策略本身
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0060](0060-tools-schema-session-fingerprint.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0090](0090-teaching-config-overlay-parse-peel.md)、[ADR-0100](0100-agent-loop-fallback-peel.md)、[ADR-0103](0103-agent-loop-budget-reason-peel.md)、[ADOPTION S-03](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/ai/agent-loop-schema-guard.ts`（新）
  - `src/main/ai/agent-loop.ts`（import + 删除本地副本）
  - `tests/unit/agent-loop-schema-guard.unit.test.ts`（新；mock emit；ok / narrowed / fail 路径）
  - `docs/adr/0106-agent-loop-schema-guard-peel.md`（本文件）

## 背景

ADR-0075 将模块尺寸政策与巨石 **按触达 peel** 纪律正式化。ADR-0100 / ADR-0103 已将 fallback 与 budget-reason 纯助手从 `agent-loop.ts` 旁路 peel。当前 loop 仍逼近软告警带，底部仍承载：

1. 主 loop / provider retry 包装 / turn tool-result budget（I/O 与 execution 耦合）；
2. B-05 / ADR-0060 的 `applyToolsSchemaGuard`：对 `assertToolsSchemaStable` 的薄包装，并在 fail-closed expansion 与 audited narrow 时 emit status（无磁盘 I/O、无 retry 策略）。

第 2 类与 retry / tool-budget 无策略耦合，适合 **单 helper** by-touch peel。本切片**只** peel `applyToolsSchemaGuard`；`invokeProviderWithRetry`、`applyTurnToolResultBudget` **不**在本轮移动。

## 决定

### 1. 新模块边界

| 模块 | 职责 |
| --- | --- |
| `agent-loop-schema-guard.ts` | `applyToolsSchemaGuard`（assert + status emit；pure-ish） |
| `agent-loop.ts` | 主 run loop、provider retry 包装、turn tool-result budget；**import** 上述助手；仍持有 `createToolsSchemaGuardState()` 与 call site |
| `tools/tools-schema-fingerprint.ts` | 保持 ADR-0060 权威：指纹 / baseline / `assertToolsSchemaStable`；**不**混入 loop emit 形状 |

选择 **新文件** 而非扩展 fingerprint 模块：fingerprint 是无 UI/status 语义的纯 surface 合同；loop 侧 emit 形状属于 agent-loop 旁路 cluster，单独文件名更诚实。

### 2. 行为与公共面

- 函数体与 peel 前逐字等价：`!ok` → `status: 'error'` 且 message = `` `[${auditCode}] ${reason}` ``；`ok && changed && change === 'narrowed'` → `status: 'thinking'` 且 fingerprint 前 12 字符审计文案；其余 ok 路径无 emit。
- emit 参数类型收窄为 status-only 子集（`ToolsSchemaGuardEmit`），避免 `agent-loop-schema-guard` ↔ `agent-loop` 循环依赖；call site 传入的 `AgentLoopEvent` emit 在 strictFunctionTypes 下仍可赋值。
- **不**把 `applyToolsSchemaGuard` 提升为跨包产品公共面；仍为 main AI 内部实现细节。
- 无 schema 语义变更（ADR-0060 仍为准）、无 retry / budget / settlement / toolsReplayed 变更。

### 3. 不变量

- 主 loop 与 recovery 两处 call site 仍调用同名助手；fail-closed 仍 `execution.failed(..., schemaDecision.reason)`。
- 无循环依赖：schema-guard → fingerprint + provider-adapter types + teaching-types status；loop → schema-guard。
- 不触达 teaching-workspace / learning-session-ledger / teaching-turn-coordinator。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/agent-loop-schema-guard.unit.test.ts `
  tests/unit/agent-loop-budget-reason.unit.test.ts `
  tests/unit/agent-loop-fallback.unit.test.ts `
  tests/unit/tools-schema-fingerprint.unit.test.ts
```

可选：`pnpm run check:module-size`（warning-only；agent-loop 行数应实质下降）。

## 明确不包含 / non-claims

1. **不** peel `invokeProviderWithRetry`（I/O + execution 耦合）。
2. **不** peel `applyTurnToolResultBudget`（async I/O-ish）。
3. **不** peel teaching-workspace / ledger / coordinator 三巨石（仍为 S-03 residual by-touch）。
4. **不** 改 tools/schema 指纹守卫语义（ADR-0060 仍为准）。
5. **不** 改 provider retry / rate-limit / budget stop 语义（ADR-0057 等仍为准）。
6. **不** 把 `check:module-size` 升为 Blocking CI。
7. **不** 引入 shell / YOLO / MCP marketplace / 远程 telemetry。
8. **不** 改 ADOPTION.md 正文（本切片仅 ADR + 代码 peel）。

## 与 ADOPTION S-03 的关系

- ADR-0075 政策 + ADR-0090 / ADR-0100 / ADR-0103 pure peel 已落地；本 ADR 是 **agent-loop 单 pure-ish helper** residual peel。
- 建议 residual 措辞：S-03 政策与 by-touch pure peel（config-resolver、agent-loop fallback、budget-reason、schema-guard）已落地；**巨石**仍仅按触达 peel，禁止三线并行大搬家。loop residual 仍含 `invokeProviderWithRetry` / `applyTurnToolResultBudget`（仅按触达再 peel）。
