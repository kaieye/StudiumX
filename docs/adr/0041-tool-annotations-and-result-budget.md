# ADR-0041：工具 Risk Annotations 与结果字节预算

- **状态：** 已实施（ZCode 借鉴 Phase A）
- **范围：** tool risk annotations（readonly/destructive/network/privileged）+ hard result byte budget
- **证据路径：** `src/main/ai/tools/annotations.ts`、dispatcher/registry 接线

## 决定

工具定义补齐 **risk annotations** 与 **硬结果字节预算**：

1. `annotationsForEffectClass` 从既有 `ToolEffectClass` 派生默认 `ToolRiskAnnotations`（readOnlyHint / destructiveHint / openWorldHint / risk）。
2. `ToolEntry` 可选覆盖 `annotations` 与 `resultBudget`。
3. `enforceToolResultBudget` 默认 **32KiB** UTF-8 硬预算；超限时截断并附加可见 `[truncated: ...]` 标记。
4. `ToolDispatcher` 成功路径与 `ToolRegistry.handlerMap` 成功路径均强制预算。

此举对齐 ZCode MCP-friendly 工具形态中的 annotations + result budget，但不引入 MCP 市场或 shell 工具。

## 已实施范围与验证入口

- `src/main/ai/tools/annotations.ts`
- `src/main/ai/tools/dispatcher.ts`
- `src/main/ai/tools/registry.ts`
- `tests/unit/tool-annotations.unit.test.ts`

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/tool-annotations.unit.test.ts
```

## 不变量

- 未知 effect 保持 fail-closed privileged。
- 截断必须可见，不得静默丢弃。
- annotations 是元数据；不替代 effect policy / permission gate / capability catalog。

## 不包含

- 不注册 shell/MCP 工具。
- 不把 annotations 当作唯一授权源。
- 不改变 operation journal 幂等语义。
