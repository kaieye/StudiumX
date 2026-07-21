# ADR-0060：Tools/schema 会话指纹守卫（单 run 内静默扩 schema fail-closed）

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** 单次 `runAgentLoop` / agent run 内，对每轮（含 recovery）提供给 provider 的 `ToolDefinition[]` 做确定性指纹与过渡判定
- **相关：** [ADOPTION B-05](0121-improvements-adoption-closeout.md)、[ADR-0040](0040-teaching-session-protocol-facade.md)（会话门面稳定前缀）、[ADR-0044](0044-teaching-prompt-cache-contract.md)（prompt cache 稳定面）、[ADR-0048](0048-tool-contract-and-write-policy.md)（工具合同）
- **证据路径：** `src/main/ai/tools/tools-schema-fingerprint.ts`、`src/main/ai/agent-loop.ts`（`assertToolsSchemaStable` 一行钩子）、`tests/unit/tools-schema-fingerprint.unit.test.ts`、`docs/adr/0060-tools-schema-session-fingerprint.md`

## 背景

教学会话的 system prefix（ADR-0044）与会话协议门面（ADR-0040）要求**稳定的能力边界**。若同一 agent run 中途静默扩大 `tools` 数组（新增工具名，或同一工具的 JSON Schema parameters 变宽/变语义），会：

1. 破坏模型可见的工具面一致性（与 prompt-cache / 会话稳定前缀意图冲突）；
2. 让 effect / permission 门禁在未审计的情况下面对更大攻击面；
3. 使审计与复现困难（「本 run 实际暴露了哪些 schema」不固定）。

合法收窄（例如 durable success 后减少工具、recovery 子集）应当允许，但必须留下显式审计码，而不是 silent mutation。

## 决定

### 1. 确定性指纹

`fingerprintToolDefinitions(tools)`：

- 对每个 tool 取 `function.name` + **canonical** `function.parameters`（`stableSerialize`：对象键排序、递归）；
- 按 tool name 排序后 `JSON.stringify` 整表；
- `node:crypto.createHash('sha256').update(...).digest('hex')`。

**不**纳入 description 文案（copy 编辑不应导致 surface id 抖动）。

### 2. 过渡判定

`evaluateToolsSchemaTransition(prev, nextTools, prevTools?)`：

| 情况 | 结果 |
| --- | --- |
| `prev === null` | 建立指纹，`ok` + `changed: false` |
| 指纹相同 | `ok` + `changed: false` |
| 仅移除工具名，保留工具的 parameters 与 **首次** baseline 字节一致 | `ok` + `change: 'narrowed'` + `auditCode: tools_schema_narrowed` |
| 收窄后恢复到首次 baseline 的 schema-equal 子集/全集 | `ok` + `changed: false`（相对 run grant，非 silent expansion） |
| 出现 **首次 baseline 中不存在** 的 tool name | `ok: false` + `change: 'expanded'` + `tools_schema_expanded` |
| 已有 tool 的 parameters 规范化 JSON 变化 | `ok: false` + `change: 'incompatible'` + `tools_schema_incompatible` |
| 指纹变化且无 `prevTools` 可比 | `ok: false` + `incompatible`（fail closed） |

### 3. 运行时钩子（fail closed）

`assertToolsSchemaStable(state, tools)` + agent-loop `applyToolsSchemaGuard`：

- 每个 provider 迭代（主循环与 `iterationLimitRecovery`）在 `streamChatProvider` **之前**调用；
- **baseline 固定在本 run 首次成功建立的工具面**；允许在该 grant 内收窄/恢复（恢复不算 expansion）；**仅**新增首次未授予的 tool name 或改 parameters 才 fail closed；
- expansion / incompatible：**不**调用 provider；`status: error` 诊断 + `execution.failed`；
- narrow：允许 + `status` 消息带 `tools_schema_narrowed`。

### 4. 与既有层正交

- **不**改 TOOL_CONTRACT effect lattice、permission、write-policy。
- **不**改 registry 注册或 TeachingCommand 闭集。
- **不**承担跨 run / 跨 session 的 schema 版本管理。
- Finalization `tools: []` 路径不经过本守卫（空工具收尾是既有「停止提供工具」语义，不是 silent expansion）。

## 已实施范围与验证入口

- `src/main/ai/tools/tools-schema-fingerprint.ts`（新建）
- `src/main/ai/agent-loop.ts`（`toolsSchemaGuard` + `applyToolsSchemaGuard`）
- `tests/unit/tools-schema-fingerprint.unit.test.ts`

```powershell
pnpm exec vitest run --project unit tests/unit/tools-schema-fingerprint.unit.test.ts
```

## 不变量

- 同一 run 内，相对首次指纹的 **schema expansion 与 parameter 变更一律 fail closed**。
- 合法 narrow 必须产生 `tools_schema_narrowed` 审计可见信号。
- 指纹对 tool 顺序与 parameters 键顺序稳定。
- 不引入 shell / MCP marketplace / FTS / YOLO / 远程 telemetry。

## 不包含 / non-claims

- 不是完整 capability system 重写（B-07 / B-10 等另轨）。
- 不声明跨 session 的 tool registry 版本锁定或 skill-pack schema 签名。
- 不自动「强制回滚到 previous tool array 再调 provider」——本切片选择 **fail closed + diagnostic**（更清晰、更少 silent recovery）。
- 不改变 settlement sole-writer、prompt-cache 组装细节或 provider retry（A-05）。
- 不把 description 差异当作安全边界。
