# ADR-0056：工具结果 turn 聚合预算与 spill-to-preview

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** 单次 model turn 内工具结果的聚合字符预算、sandbox spill、模型侧 preview + 相对路径指针
- **相关：** [ADR-0041](0041-tool-annotations-and-result-budget.md)（per-tool 字节硬预算）、[ADOPTION B-04](0121-improvements-adoption-closeout.md)、hermes `tool_result_storage` / `budget_config`
- **证据路径：** `src/main/ai/tools/tool-result-budget.ts`、`src/main/ai/agent-loop.ts`、`tests/unit/tool-result-budget.unit.test.ts`

## 背景

ADR-0041 已在 dispatcher/registry **成功路径**对**单个** tool result 强制默认 **32KiB UTF-8** 截断。这挡不住「多个中等结果在同一 assistant turn 累加爆上下文」。Hermes 用三层预算：工具内 cap → per-result persist → **turn 聚合 budget + spill**。StudiumX 此前只有分散 per-tool 上限与 journal 字节上限；后者不是模型上下文 spill。

## 决定

### 1. 分层（与 ADR-0041 正交）

| 层 | 模块 | 默认 | 作用 |
| --- | --- | --- | --- |
| Per-tool 硬字节预算 | `annotations.enforceToolResultBudget`（ADR-0041） | 32KiB | 单结果成功路径截断 + 可见 marker |
| Per-result 软 persist | `tool-result-budget.ts` | 100_000 chars | 超阈写 spill，模型见 preview |
| **Turn 聚合** | `tool-result-budget.ts` + `agent-loop` | **200_000 chars** | 同 turn 全部 tool result 合计超限时，优先 spill 最大的未 spill 结果 |

Journal `MAX_RESULT_BYTES`、operation journal 幂等语义 **不**承担模型上下文 spill。

### 2. Spill 路径与 path-access

- 目录：`.studiumx/tool-results/<sanitizeRunId>/`
- 文件：`<safeToolCallId>.txt`
- 写入前用 `path-access.isPathInsideRoot` 证明 spill 目录与文件均在 `workspaceRoot` 内。
- **模型可见**内容仅为 **workspace-relative** 路径（如 `.studiumx/tool-results/<runId>/call.txt`）；**禁止**绝对路径泄漏到 transcript / learner UI。
- 无 `workspaceRoot` 或 `runId` 时：不写盘，退化为 inline preview 截断（`spillUnavailable`）。

### 3. 模型侧消息形状

溢出结果替换为：

```text
<spilled-tool-result>
... size + relative path ...
Preview (first N chars):
...
</spilled-tool-result>
```

Preview 默认 **1_500** chars，优先在换行边界截断。

### 4. 防 persist→read 环

以下工具 **永不 spill**（pinned）：

- `read_workspace_file`
- `read_skill_resource`

否则模型读 spill 文件的完整结果会再次被 spill，形成放大环。错误结果与已含 `<spilled-tool-result>` 的内容同样跳过。

### 5. 接线位置

在 `runAgentLoop` 中，**整批** `executeToolCall` 完成后、`transcript.push({ role: 'tool' ... })` / `tool_result` 事件 **之前** 调用 `enforceToolResultTurnBudget`。恢复路径与正常 tool batch 同样应用。`workspaceRoot` / `runId` 由 teaching conversation、delegation child、lesson-plan production 传入。

**不**削弱 effect policy、permission gate、capability catalog。

## 已实施范围与验证入口

- `src/main/ai/tools/tool-result-budget.ts`（新建，冻结名）
- `src/main/ai/agent-loop.ts`（turn batch 接线）
- `src/main/teaching-conversation-runtime.ts` / `delegation-runtime.ts` / `lesson-plan-production.ts`（上下文传入）
- `tests/unit/tool-result-budget.unit.test.ts`

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/tool-result-budget.unit.test.ts
```

## 不变量

- ADR-0041 per-tool 预算仍先于本层生效；本层是 **turn 聚合** 与 **spill**，不是第二套静默截断。
- Spill 仅写 workspace 沙箱；绝对路径不进模型面。
- Pinned read 工具永不 spill。
- 不引入 shell / MCP / FTS；不自动 re-execute 工具「恢复」完整结果。

## 不包含 / non-claims

- 不按模型 context window 动态缩放预算（Hermes `budget_for_context_window` 二期）。
- 不把 spill 文件纳入 support-bundle 自动打包策略的完整产品面（路径规则与脱敏可后续叠加 ADR-0034）。
- 不改变 learner-facing presentation / redaction 管道。
- 不把 spill 当作 durable publish 或 LearningSession 权威。
