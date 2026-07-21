# ADR-0083：产品路径注入 workspace tool-policy

- **状态：** 已实施（ADOPTION B-08 residual：primary conversation path 可选注入）
- **日期：** 2026-07-21
- **范围：** 仅在 `teaching-conversation-runtime` 主对话路径将 workspace 内可选 tool-policy 文档注入 `buildToolContext`；缺文件保持 default-equivalent
- **相关：** [ADR-0063](0063-declarative-tool-policy.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/teaching-conversation-runtime.ts`（`runTeachingConversationTurnActive` 注入点）
  - `src/main/ai/tools/tool-policy-fs.ts`（`toolPolicyDocumentOption` 纯 helper；loader 语义不变）
  - `tests/unit/tool-policy-fs.unit.test.ts`
  - `tests/unit/teaching-conversation-runtime-tool-policy-inject.unit.test.ts`

## 背景

ADR-0063 交付声明式 tool-policy 与 registry gate；ADR-0079 交付 workspace-contained FS loader（`.studiumx/tool-policy.json`，fail-closed → `null`）。B-08 residual 仍开放：**产品 run 路径**如何可选挂载 loader，且缺文件不得改变既有 `approvalMode` lattice。

本切片只接 **primary teaching conversation path**，不重接 delegation / lesson-plan / capability / connector 等其它 `buildToolContext` 调用点。

## 决定

### 1. 主路径注入（唯一产品接线）

在 `runTeachingConversationTurnActive` 内、`buildToolContext` 之前：

1. 当 `conversation.workspaceRoot` 为非空字符串时，`await loadToolPolicyDocumentFromWorkspace({ workspaceRoot })`。
2. 若结果为文档，经 `toolPolicyDocumentOption(document)` 展开为 `{ toolPolicyDocument: document }` 传入 `buildToolContext`。
3. 若结果为 `null`（缺失 / 非法 / 超限 / 逃逸），**省略** `toolPolicyDocument` 字段（不传 `null` 作为「空策略」语义），registry 继续 `ctx.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT`。
4. `workspaceRoot` 缺席或空：不发起 FS 读。

权限 resolver / eventBus / settlement / autoDrain 接线保持不变。

### 2. 纯 inject helper

`toolPolicyDocumentOption(document)`：

| 输入 | 输出 |
| --- | --- |
| 有效 `ToolPolicyDocument` | `{ toolPolicyDocument: document }` |
| `null` / `undefined` | `{}`（字段省略） |

保持 runtime 薄；unit 可直接测 inject 决策，无需 Electron。

### 3. Fail-closed / default-equivalent

- Loader 语义仍以 ADR-0079 为准：任何失败 → `null`。
- **缺文件 ≡ 未注入文档 ≡ 默认 in-process 文档**（`defaultDecision: 'allow'` + 空 rules），既有 approvalMode lattice 不变。
- **禁止** 以空文档 / 空 rules 伪造「全禁」或 YOLO；禁止 argv / `prefix_rule` / always-approve 产品语言。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/tool-policy-fs.unit.test.ts tests/unit/tool-policy.unit.test.ts tests/unit/teaching-conversation-runtime-tool-policy-inject.unit.test.ts
CI=true pnpm exec vitest run --project unit tests/unit/teaching-conversation-runtime.unit.test.ts
```

## 不变量

- 仅 primary conversation path 自动加载；其它 `buildToolContext` 调用点仍可选手动注入。
- 磁盘读仅经 ADR-0079 contained / bounded loader。
- 无 shell / MCP marketplace / YOLO / always-approve / autoDrain 翻转。
- 不触碰 settlement sole-writer、`expectedRevision`、`toolsReplayed`。

## 明确不包含 / non-claims

- **不** 合并多文件 course policy pack。
- **不** 提供 Granular 审批 UI（叠在 ADR-0063 之上的 UI residual 不变）。
- **不** 接线 delegation-runtime / lesson-plan-production / teaching-capability-catalog / connector-health-catalog（其它调用点 residual）。
- **不** 改 pure FS loader denylist 或 approvalMode lattice。
- **不** peel teaching-workspace 巨石。
- **不** 编辑 ADOPTION.md 正文（协调者 residual 文案）。
