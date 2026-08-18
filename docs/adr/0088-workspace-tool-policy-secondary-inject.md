# ADR-0088：次级 agent-run 路径注入 workspace tool-policy

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION B-08 residual：delegation + lesson-plan secondary inject）
- **日期：** 2026-07-21
- **范围：** 仅在 `delegation-runtime` 与 `lesson-plan-production` 两条次级 agent-run 路径，将 workspace 内可选 tool-policy 文档注入 `buildToolContext`；缺文件保持 default-equivalent
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0063](0063-declarative-tool-policy.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADR-0083](0083-workspace-tool-policy-product-inject.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/ai/delegation-runtime.ts`（`executeChild` 注入点）
  - `src/main/lesson-plan-production.ts`（`produce`，grant-gated 注入）
  - `src/main/ai/tools/tool-policy-fs.ts`（loader + `toolPolicyDocumentOption`；本切片无 API 变更）
  - `tests/unit/secondary-tool-policy-inject.unit.test.ts`
  - `tests/unit/tool-policy-fs.unit.test.ts`

## 背景

ADR-0063 交付声明式 tool-policy；ADR-0079 交付 workspace-contained FS loader；ADR-0083 已在 **primary** `teaching-conversation-runtime` 完成可选注入。B-08 residual 仍开放：其它 `buildToolContext` 调用点是否接线。

本切片只接 **两条次级 agent-run 路径**：

1. 委托子 run（`DelegationRuntime.executeChild`）
2. 教案生产 agent loop（`produce`，且仅当 `workspaceToolAccessGranted === true`）

不重接 capability / connector 等 catalog 探针路径。

## 决定

### 1. delegation-runtime

在 `executeChild` 内、`buildToolContext` 之前：

1. 当 `this.options.workspaceRoot` 为非空（truthy）字符串时，`await loadToolPolicyDocumentFromWorkspace({ workspaceRoot })`。
2. 经 `toolPolicyDocumentOption(doc)` 展开注入 `buildToolContext`；`null` → **省略**字段。
3. `workspaceRoot` 缺席或空：不发起 FS 读。
4. 子能力子集 / `parentAllowedToolNames` / `workspaceWrite: false` 行为不变。

### 2. lesson-plan-production（grant-gated）

1. 既有 `workspaceToolOptions` 仅在 `workspace.workspaceToolAccessGranted === true` 时带 `workspaceRoot`（grant 仍是工具面 fail-closed 门）。
2. **仅当 grant true 且 `rootPath` 非空**：`await loadToolPolicyDocumentFromWorkspace`，再 merge 进传给 `buildToolContext` 的 options。
3. **grant false / 缺席：不发起 FS 读**，options 为空；**不**因 policy 文件存在而授予 workspace 工具。
4. Registry 仍只用 `workspaceToolOptions`（不需要 policy doc）；policy 只进 `buildToolContext`。

### 3. Fail-closed / default-equivalent

- Loader 语义仍以 ADR-0079 为准。
- **缺文件 ≡ 未注入文档 ≡ 默认 in-process 文档**。
- **禁止** YOLO / always-approve / argv / `prefix_rule` 产品语言。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/tool-policy-fs.unit.test.ts tests/unit/tool-policy.unit.test.ts tests/unit/secondary-tool-policy-inject.unit.test.ts
```

## 不变量

- 仅 delegation + lesson-plan secondary paths 新增自动加载；primary 仍由 ADR-0083 负责。
- lesson-plan：**grant false 永不 FS load**，且 policy 不绕过 grant 门。
- 磁盘读仅经 ADR-0079 contained / bounded loader。
- 无 shell / MCP marketplace / YOLO / always-approve / autoDrain 翻转。
- 不触碰 settlement sole-writer、`expectedRevision`、`toolsReplayed`。

## 明确不包含 / non-claims

- **不** 接线 `teaching-capability-catalog` / `connector-health-catalog`（catalog/read probes residual）。
- **不** 改 primary conversation inject（ADR-0083）。
- **不** 改 pure FS loader denylist 或 approvalMode lattice。
- **不** 合并多文件 course policy pack。
- **不** 提供 Granular 审批 UI。
- **不** 编辑 ADOPTION.md 正文（协调者 residual 文案）。
