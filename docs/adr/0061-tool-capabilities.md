# ADR-0061：ToolCapabilities 元数据叠加 TOOL_CONTRACT

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** 工具能力元数据（`isReadOnly` / `maxConcurrency` / `supportsCancel` / `effectClass`）声明与合同文档；**不**放开写并行
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0032](0032-conservative-parallel-read-tools.md)、[ADR-0041](0041-tool-annotations-and-result-budget.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADOPTION B-07](0121-improvements-adoption-closeout.md)
- **证据：** `src/main/ai/tools/tool-capabilities.ts`、`src/main/ai/tools/registry.ts`、`docs/tools/TOOL_CONTRACT.md`、`tests/unit/tool-capabilities.unit.test.ts`

## 背景

effect lattice（ADR-0024）与 risk annotations（ADR-0041）已回答「副作用类 / 风险提示」。调度与取消仍需要稳定的**能力发现**形状：哪些工具可并行、上限多少、是否配合 cancel。B-07 要求把这些字段声明在工具侧与 TOOL_CONTRACT，且**不得**借此放开 write 并行。

## 决定

1. 新增 `ToolCapabilities` 与 `capabilitiesForTool(toolName)`（`tool-capabilities.ts`）。
2. 默认由 `classifyToolEffect` + effect-class 表派生：
   - `read` → `isReadOnly: true`，`maxConcurrency: 4`，`supportsCancel: true`
   - `workspace_write` / `external_write` / `privileged`（含未知）→ `isReadOnly: false`，**`maxConcurrency: 1`**，`supportsCancel: true`
3. 非 `read` 工具硬钳 `maxConcurrency <= 1`，即使将来有 per-tool override 也不可放大写并行。
4. `ToolEntry.capabilities?` 可选覆盖；`resolveToolEntryCapabilities` 供 registry 发现。
5. `docs/tools/TOOL_CONTRACT.md` 增加 Capability metadata 章节；主工具表行形状保持 `check-tool-contract.mjs` 可解析（`| \`name\` | \`effectClass\` |`）。

Capabilities **是元数据**，不替代 effect authorization、permission gate 或 capability catalog。

## 不变量

- 未知工具 fail-closed 为 privileged / concurrency 1。
- 写类工具 `maxConcurrency` 永不为 >1。
- 不改变 parallel-read dispatcher 的「仅 read 可并行」规则。

## 验证

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/tool-capabilities.unit.test.ts
node scripts/check-tool-contract.mjs
pnpm run check:tool-dispatcher
```

## 非目标

- **不**启用 write / external_write / privileged 并行执行。
- **不**引入 shell / MCP / YOLO 标签。
- **不**重写 agent-loop 或强制默认并行调度。
- **不**把 capabilities 当作唯一授权源。