# ADR-0059：Agent loop 混合只读并行工具批处理

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** 将既有 `dispatchReadToolsInParallel` 接入生产 `runAgentLoop` 正常 turn 与 recovery 路径；非 read 仍串行
- **相关：** [ADR-0032](0032-conservative-parallel-read-tools.md)、[ADR-0051](0051-provider-finish-reason-and-length-tool-rejection.md)、[ADR-0056](0056-tool-result-turn-budget-and-spill.md)、[ADOPTION B-03](0121-improvements-adoption-closeout.md)
- **证据路径：** `src/main/ai/tools/batch-dispatch.ts`、`src/main/ai/agent-loop.ts`、`tests/unit/tool-batch-dispatch.unit.test.ts`

## 背景

ADR-0032 交付了 `dispatchReadToolsInParallel`（仅 `effect=read` 有界并行；write/privileged/external_write 预检 denied）。生产 `agent-loop.ts` 此前仍以串行 `for (const call of toolCalls) executeToolCall(...)` 执行整批工具，并行调度未接线。B-04 turn 聚合预算（ADR-0056）与 A-02 length 零副作用拒绝（ADR-0051）已存在，需要在不破坏这些不变量的前提下接入只读并行。

## 决定

### 1. 混合批处理（hybrid batch）

新增冻结模块 `src/main/ai/tools/batch-dispatch.ts`，导出 `executeToolBatch` / `partitionToolCalls`：

1. 按 **原始顺序** 将 `toolCalls` 切分为 **连续 pure-read 段** 与 **单个非 read 槽**。
2. 连续 pure-`read` 段 → `dispatchReadToolsInParallel`（默认并发 4，最大 8）。
3. `workspace_write` / `external_write` / `privileged` / 未知 → **串行** `executeToolCall`（经 ToolDispatcher + effect-policy）。
4. 混合示例：`[read, read, write, read]` → parallel(read,read) → serial(write) → parallel/serial(read)。

### 2. Loop 与 recovery DRY

`runAgentLoop` 主工具批与 `iterationLimitRecovery` 工具批 **共用** `executeToolBatch`。Recovery 通过 `resolveCall` 保留允许列表 / 已完成业务工具的 skip 语义，不绕过 budget / cancel。

### 3. 预算、取消、A-02、B-04

- 每个 **admitted** call 仍走 `execution.budgetStop('tool')` → `startToolCall` → 执行 → `recordToolError`。
- cancel / duration exhaustion 在段边界与串行槽边界检查；中途取消不再 admit 后续 call。
- **A-02** length + toolCalls 拒绝路径保持在任何 dispatch **之前**，零 handler。
- 整批 outcomes 之后仍调用 `applyTurnToolResultBudget`（B-04 / ADR-0056）。

### 4. 不并行非 read

- 从不 `Promise.all` write / privileged / external_write。
- effect 分类仍由 `classifyToolEffect` / `authorizeToolEffect` 权威；本层只做调度切分。
- 不引入 YOLO、shell、MCP、settlement 改动。

## 已实施范围与验证入口

- `src/main/ai/tools/batch-dispatch.ts`（新建）
- `src/main/ai/agent-loop.ts`（主批 + recovery 接线；仅 tool-batch 区域）
- `src/main/ai/tools/execution.ts`（可选 re-export）
- `tests/unit/tool-batch-dispatch.unit.test.ts`
- 既有 `tests/unit/parallel-read-tools.unit.test.ts`、`tests/unit/agent-loop-finish-length.unit.test.ts` 不得回归

```powershell
pnpm exec vitest run --project unit tests/unit/tool-batch-dispatch.unit.test.ts
pnpm exec vitest run --project unit tests/unit/parallel-read-tools.unit.test.ts
pnpm exec vitest run --project unit tests/unit/agent-loop-finish-length.unit.test.ts
pnpm run check:parallel-read-tools
```

## 不变量

- 仅 `effect=read` 可并行；写/特权/未知串行。
- Transcript / `tool_result` 事件顺序与模型 tool_calls 原始顺序一致。
- length 截断批零副作用；turn budget 在 batch 之后应用。
- Settlement sole-writer / toolsReplayed:false / effect lattice 不变。

## 不包含 / non-claims

- 不并行 writes 或 privileged 工具。
- 不改变 `parallel_tasks` 子代理语义。
- 不改 provider retry catch（A-05 所有权区域）。
- 不引入 shell / MCP / FTS / 远程 telemetry。
