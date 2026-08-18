# ADR-0079：Workspace-contained tool-policy FS loader

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** 在已注册工作区根下，通过 contained IO 可选读取相对路径的声明式 tool-policy JSON，解析复用纯 `loadToolPolicyDocument`，失败一律闭包为 `null`。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0063](0063-declarative-tool-policy.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据：** `src/main/ai/tools/tool-policy-fs.ts`（新）、`src/main/ai/tools/tool-policy.ts`（纯 loader / evaluate，未改行为）、`src/main/path-access.ts`（`readContainedRegularFileBounded`）、`tests/unit/tool-policy-fs.unit.test.ts`

## 背景

ADR-0063 交付了纯声明式 tool-policy 形状与 registry gate（`evaluateRegistryToolPolicyGate`），并提供无 FS 的 `loadToolPolicyDocument(raw)`。residual 表中 **FS / course policy loader** 仍开放：教师/课程可版本化策略需要磁盘读取，但不得引入 shell argv / `prefix_rule` DSL，也不得在缺文件时改变既有 `approvalMode` lattice。

产品地板：无默认 shell、无 YOLO / always-approve、工作区 IO 必须 contained；S-02 workspace-host port 可能并行落地，本切片 **直接** 使用 `path-access`，不依赖 host port。

## 决定

### 1. 新模块 `tool-policy-fs.ts`

| 导出 | 含义 |
| --- | --- |
| `DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH` | `'.studiumx/tool-policy.json'` |
| `WORKSPACE_TOOL_POLICY_MAX_BYTES` | `64 * 1024` |
| `loadToolPolicyDocumentFromWorkspace({ workspaceRoot, relativePath?, maxBytes? })` | 异步：contained 读 → 纯 parse → `ToolPolicyDocument \| null` |
| `loadToolPolicyDocumentFromJsonText(text)` | 薄 helper：`JSON.parse` + `loadToolPolicyDocument` |
| `attachWorkspaceToolPolicyDocument(ctxLike, document)` | 可选 attach：`toolPolicyDocument` 字段；`undefined` 不改；`null` 显式清空 |

### 2. 路径约定

- **默认相对路径：** `.studiumx/tool-policy.json`（与其它 `.studiumx/*` 工作区元数据并列）。
- 调用方可传 `relativePath`（例如课程包内路径）；经 `normalizeRelativePath` 规范化：
  - 拒绝 `..` 逃逸、绝对路径、盘符路径、空路径 → **null**。
- 目标绝对路径再经 `isLexicallyInsideRoot` 校验后，调用 `readContainedRegularFileBounded`。

### 3. Fail-closed 语义

下列情况一律返回 **`null`（不抛）**：

- 工作区根为空
- 相对路径非法 / 逃逸
- 文件缺失、非普通文件、符号链接、contained 校验失败
- 超过 bounded 上限（默认 64 KiB）
- JSON 非法
- 文档形状非法，或含 `argv` / `prefix_rule` / `yolo` / `alwaysApprove` 等（纯 loader 拒绝）

**缺文件 ≡ 未加载文档：** 调用方不注入 `ToolContext.toolPolicyDocument` 时，registry 继续使用 `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT`（`defaultDecision: 'allow'` + 空 rules），既有 approvalMode lattice 不变。

### 4. 接线边界（本切片）

- **交付：** loader + unit tests + 本 ADR。
- **不**强制改 agent-loop / registry 自动读盘：`ToolContext.toolPolicyDocument` 与 `buildToolContext({ toolPolicyDocument })` 已支持可选注入；产品路径可在后续 residual 挂载 loader。
- **不**改 `resolveToolPermission` 语义 lattice。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/tool-policy-fs.unit.test.ts
CI=true pnpm exec vitest run --project unit tests/unit/tool-policy.unit.test.ts
```

## 不变量

- 磁盘读仅经 `path-access` contained / bounded API。
- 解析权威仍是纯 `loadToolPolicyDocument`；FS 层不重新实现规则语义。
- **无** argv / `prefix_rule` / command-prefix DSL 产品字段。
- **无** YOLO / `always_approve` / `DangerFullAccess` 标签。
- 缺文件不得收紧或放松默认 approvalMode（null → 调用方不注入 → 默认 in-process 文档）。

## 明确不包含 / non-claims

- **不**自动在每个 agent run 加载 policy（接线 residual）。
- **不**提供 granular 审批 UI；叠在 ADR-0063 决策之上的 UI residual 不变。
- **不**引入 shell tool、MCP marketplace、OS sandbox 产品声明。
- **不**依赖 workspace-host port（S-02）；本切片 path-access 直连。
- **不**把 `full_access` 重命名为 YOLO / DangerFullAccess。
- **不**编辑 ADOPTION.md 正文（由协调者/后续 residual 文案更新）。

## Residual

| 项 | 状态 |
| --- | --- |
| FS loader + 默认路径约定 | **本 ADR 已关闭** |
| 产品 run 路径自动/可选注入 `toolPolicyDocument` | residual（零风险时可在 host 构造 `buildToolContext` 时调用 loader） |
| course-pack 专用相对路径约定 / 多文件 merge | residual |
| Granular 审批 UI | residual（ADR-0063） |

