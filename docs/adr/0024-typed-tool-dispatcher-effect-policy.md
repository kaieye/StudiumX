# ADR-0024：Typed ToolDispatcher、Effect Policy 与 ToolOutcome

- **状态：** 已实施（P1-2；合入 main `0d99c14` / feature `b4f3c9c`）
- **范围：** 工具调用前置 effect 分类与授权、严格参数解析、typed `ToolOutcome`
- **证据提交：** `b4f3c9c`、merge `0d99c14`

## 决定

教学工具调用走 `ToolDispatcher` 薄编排：`classifyToolEffect` → `authorizeToolEffect` → 严格参数解析 → 既有 `ToolHandlerMap` handler → 封闭 `ToolOutcome`。**`status` 是成功/失败的唯一真源**；调用方不得从 free-text content（例如字符串里是否含 `"error"`）推断失败。

Effect 分类为 `read` | `workspace_write` | `external_write` | `privileged`。未知工具 **fail closed 为 `privileged`**，新能力必须显式映射。此策略与 `registry.ts` 的交互式 `workspace_write` 权限门正交：前者回答“本回合是否允许该 effect 类在任何 handler 副作用之前运行”，后者仍负责具体写路径授权。

`ToolOutcome` 携带 audit-safe correlation（`toolCallId` / 可选 `runId` / `operationId`），不记录 provider payload 或 learner answers。Dispatcher **不**注册 shell/MCP 新工具，也不替代 capability catalog 或 workspace write containment。

## 已实施范围与验证入口

- `src/main/ai/tools/dispatcher.ts`
- `src/main/ai/tools/effect-policy.ts`
- `src/main/ai/tools/tool-outcome.ts`
- `src/main/ai/tools/execution.ts` 经 dispatcher 路径

```powershell
pnpm run check:tool-dispatcher
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/tool-dispatcher.unit.test.ts
```

## 不变量

- 未授权 effect / 未允许工具名 → `denied`，且在 handler 前拒绝。
- 取消与超时映射为 `cancelled` / `timed_out`，不得伪装 `succeeded`。
- Deny / error 文案仅安全诊断字符串，不得含 secrets 或 raw args。
- 不因引入 dispatcher 而扩张 MCP、shell、第二 provider 或通用多 Agent 工具面。

## 不包含

- 不授权并行写工具、MCP 或任意 shell 执行（P2 触发项另案）。
- 不把 effect policy 当作唯一执行授权；capability / registry / path containment 仍须复核。
- 不改变 P0 Evidence / Outcome settlement authority。
