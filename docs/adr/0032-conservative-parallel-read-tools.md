# ADR-0032：保守的并行只读工具调度

- **状态：** 已实施（P2-4；feature `f87209b`；merge `1854e28`）
- **范围：** 仅 `effect=read` 工具可并行；write / external_write / privileged fail-closed 为 denied
- **证据提交：** `f87209b`、merge `1854e28`

## 决定

在既有 `ToolDispatcher` / effect policy 之上增加 `dispatchReadToolsInParallel`：

1. 预检每个 call 的 `classifyToolEffect`；非 `read` 立即产出 `denied`，不进入并行批次执行。
2. 允许的 read 以有界并发（默认 4、最大 8）`Promise` 调度，保留 per-call `ToolOutcome` correlation。
3. 混合批次采取 **(a)**：非 read 被 deny，纯 read 仍可并行——不因一个 write 拖死整批 read。

不改变 `parallel_tasks` child-agent 工具语义；不并行 workspace_write / privileged。

## 已实施范围与验证入口

- `src/main/ai/tools/parallel-read-dispatcher.ts`
- `src/main/ai/tools/execution.ts`（可选导出/适配）
- `scripts/check-parallel-read-tools.mjs`

```powershell
pnpm run check:parallel-read-tools
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/parallel-read-tools.unit.test.ts
```

## 不变量

- 仅 `effect=read` 并行。
- 未知工具仍 fail closed 为 privileged（继承 ADR-0024）。
- status 仍为 ToolOutcome 真源。

## 不包含

- 不授权并行 writes、MCP、shell 或通用多 Agent。
- 不强制 agent-loop 默认改为并行（可 opt-in）。
