# ADR-0063：声明式 tool-policy 形状（非 shell argv）

- **状态：** 已实施（ADOPTION B-08）
- **日期：** 2026-07-21
- **范围：** 纯函数工具策略评估（`allow` / `prompt` / `forbidden`），按工具名 / effect / 路径前缀匹配；**不**引入 shell argv、`prefix_rule` 或 YOLO / always-approve 产品标签
- **相关：** [ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADR-0061](0061-tool-capabilities.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据路径：** `src/main/ai/tools/tool-policy.ts`、`src/main/ai/tools/registry.ts`（`resolveToolPermission`）、`src/main/ai/tools/write-rewind-journal.ts`（可选 `permissionDecision`）、`tests/unit/tool-policy.unit.test.ts`

## 背景

`write-policy.ts` 已提供路径级 `allow|ask|deny` 纯决策；`effect-policy.ts` 负责 effect lattice 分类与 pre-execution 授权。教师可版本化策略仍缺一层**声明式**形状：按工具名 / effect / 路径前缀给出 `allow|prompt|forbidden`，且必须与 Codex 可借鉴的策略形状对齐，同时**永不**映射 shell 命令 argv / `prefix_rule`。

产品地板禁止 YOLO / DangerFullAccess / always-approve 作为默认或 UI 标签；`settings.tools.approvalMode` 中的 `full_access` 仍是写路径既有三态之一，不得被 tool-policy 产品化为 always-approve。

## 决定

1. 新增纯模块 `src/main/ai/tools/tool-policy.ts`：
   - `ToolPolicyDecision = 'allow' | 'prompt' | 'forbidden'`
   - `ToolPolicyRule`：可选 `tools` / `effects` / `pathPrefixes` + 必填 `decision`
   - `ToolPolicyDocument`：`version: 1`、`rules`、可选 `defaultDecision`
   - `evaluateToolPolicy({ toolName, effectClass, path?, document })` → `{ decision, matchedRuleIndex?, reason }`
2. **匹配语义：** 规则维度以 AND 组合；无维度规则永不匹配（防止误全局 allow）。多规则命中时取 **strictest-of-matches**（`forbidden` > `prompt` > `allow`）。
3. **默认 fail-closed：** 无匹配且未声明 `defaultDecision` 时，`privileged` → `forbidden`，其余 effect → `prompt`。
4. **路径：** 复用 `write-policy.normalizeRelativePath`；绝对 / 逃逸路径不参与 path prefix 匹配。提供 `mapWritePolicyDecision` 将 `allow|ask|deny` 映射为 `allow|prompt|forbidden`。
5. **接线边界：** 纯模块为 B-08 主交付；本 residual 将 `evaluateRegistryToolPolicyGate` 接入 `resolveToolPermission`，并为 journal 增加可选 `permissionDecision` 审计字段。agent-loop / Granular UI / FS loader 仍 residual。

## 已实施范围与验证入口

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/tool-policy.unit.test.ts
```

## 不变量

- evaluate 纯函数：无 FS IO、无 side effect。
- 规则形状仅工具名 / effect / 路径前缀；**无** argv、`prefix_rule`、command prefix DSL。
- **无** YOLO / `always_approve` / `DangerFullAccess` 导出或产品标签。
- 不替代 effect authorization、interactive permission gate、workspace containment 或 settlement sole-writer。
- `full_access` 写路径 approvalMode 不由 tool-policy 强制 bypass；tool-policy 可独立调用。

## 不包含 / non-claims

- **不**加载/解析磁盘上的教师 policy 文件（形状就绪；loader residual）。
- **不**引入 shell tool、MCP marketplace、OS sandbox 产品声明（registry 接线仅声明式 allow/prompt/forbidden）。
- **不**把 `full_access` 重命名为 DangerFullAccess / YOLO。
- **不**自动 always-approve 任何 privileged 工具。

## Residual wire（后续切片）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| registry / permission gate | **已接线（本 residual）** | `resolveToolPermission` 调用 `evaluateRegistryToolPolicyGate`：`forbidden` → 立即 `deny`（短于 `full_access` / creates auto-allow）；`prompt` → 强制 interactive（跳过 auto-allow）；`allow` → 仅 defer 到既有 `approvalMode` lattice，不发明 YOLO。默认文档 `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT`（`defaultDecision: allow` + 空 rules）保持既有 approvalMode 行为，直到注入规则。可选 `ToolContext.toolPolicyDocument`。 |
| journal `permissionDecision` | **形状已就绪（本 residual）；capture 接线见 [ADR-0108](0108-write-capture-permission-decision-wire.md)** | `WriteRewindJournalEntry.permissionDecision?: allow|prompt|forbidden|deny` + `CaptureWritePreImageInput` 可选字段；纯 helper `associatePermissionDecision` / `withPermissionDecision` / `journalPermissionDecisionFromGateAndResolution`。registry 设置 `lastJournalPermissionDecision`；workspace capture 透传；journal 不拥有 settlement。 |
| pure document loader | **已提供（无 FS）** | `loadToolPolicyDocument(raw)` 纯解析；拒绝 argv / prefix_rule / YOLO 字段。工作区/课程级磁盘 loader residual。 |
| FS / course policy loader | **已关闭见 [ADR-0079](0079-workspace-tool-policy-fs-loader.md)** | 默认相对路径 .studiumx/tool-policy.json；contained 读 + 纯 parse；产品 run 自动注入仍 residual。 |
| Granular 审批 UI | residual | 禁 YOLO 标签；叠在本决策之上。 |

### Registry 语义（forbidden vs full_access）

1. 先评估声明式 policy（effect = `classifyToolEffect(toolName)`，path = `targetPath`）。
2. **forbidden** 永远优先于 `approvalMode: full_access` 的 `allow_for_run` 快捷路径。
3. **prompt** 关闭 full_access / based_on_approval(creates) 自动放行，进入 grants + UI。
4. **allow** 不自动放行：仍遵守 `request_approval` / grants / memory 人工门。
5. 无 YOLO / DangerFullAccess / always-approve 标签。
