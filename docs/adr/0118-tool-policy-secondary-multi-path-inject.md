# ADR-0118：次级路径 tool-policy multi-path inject

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION B-08 residual：次级 inject 接 multi-path；Granular UI 仍 defer）
- **日期：** 2026-07-21
- **范围：** 将 `loadAndMergeToolPolicyDocumentsFromWorkspace`（默认 primary + course overlay）接到全部次级产品 inject 点；grant/omit 门禁与 default-equivalent 语义不变；**不**引入 Granular UI
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0063](0063-declarative-tool-policy.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADR-0083](0083-workspace-tool-policy-product-inject.md)、[ADR-0088](0088-workspace-tool-policy-secondary-inject.md)、[ADR-0101](0101-workspace-tool-policy-catalog-inject.md)、[ADR-0112](0112-tool-policy-multi-document-merge.md)、[ADR-0115](0115-tool-policy-multi-path-load-merge.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/ai/delegation-runtime.ts`（child run inject → multi-path）
  - `src/main/lesson-plan-production.ts`（grant-gated inject → multi-path）
  - `src/main/connector-health-catalog.ts`（evaluate inject → multi-path）
  - `src/main/teaching-capability-catalog.ts`（`loadToolPolicyForCapabilityCatalog` → multi-path）
  - `tests/unit/secondary-tool-policy-inject.unit.test.ts`
  - `tests/unit/catalog-tool-policy-inject.unit.test.ts`
  - `tests/unit/tool-policy-fs.unit.test.ts`（helper 既有覆盖）
  - `docs/adr/0118-tool-policy-secondary-multi-path-inject.md`（本文件）

## 背景

ADR-0115 交付 `loadAndMergeToolPolicyDocumentsFromWorkspace`（primary `.studiumx/tool-policy.json` + optional course overlay `.studiumx/tool-policy.course.json`），并**仅**将主对话 `teaching-conversation-runtime` 切到 multi-path。次级路径仍调用单文件 `loadToolPolicyDocumentFromWorkspace`：

| 次级路径 | 既有门禁 |
| --- | --- |
| `delegation-runtime` | `workspaceRoot` 真值才读盘 |
| `lesson-plan-production` | `workspaceToolAccessGranted === true` 且 `rootPath` |
| `connector-health-catalog` | trim 后非空 `rootPath` |
| `teaching-capability-catalog` / `loadToolPolicyForCapabilityCatalog` | trim 后非空 root；空 → null |

B-08 residual 要求次级路径与对话路径共享同一 discovery/merge helper，且 **仅有主文件时行为与单文件 load 相同**。Granular UI 仍不在本切片。

## 决定

### 1. 机械切换（保留门禁）

四处产品 inject 将：

```ts
await loadToolPolicyDocumentFromWorkspace({ workspaceRoot })
```

替换为：

```ts
await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot })
```

- **不**在调用点硬编码 `relativePaths`（使用默认 `DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATHS`）。
- **保留**既有 grant / empty-root / omit 门禁（见上表）。
- 加载结果仍经 `toolPolicyDocumentOption`：null/omit → 字段省略 → registry `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT`。
- 单文件 API `loadToolPolicyDocumentFromWorkspace` **继续导出**，供测试与 advanced 调用。

### 2. Merge / load 语义不重实现

| 层 | 权威 |
| --- | --- |
| 多路径装载 + fail-soft | ADR-0115 helper |
| pure most-restrictive-wins merge | ADR-0112 `mergeToolPolicyDocuments` |
| 单文件 contained IO | ADR-0079 |

本切片**不**改 merge 算法、路径约定、maxBytes 或路径逃逸规则。

### 3. 行为保证

1. **仅 primary 存在：** 与切前单文件 load **相同**（返回主文档）。
2. **primary + course：** merge strictest（rules 按路径序 + `defaultDecision` strictest）。
3. **全无 / 全失败：** `null` → omit 字段（default-equivalent）。
4. **非法 secondary：** skip；不拖垮 primary。
5. **grant false（lesson-plan）：** 仍不发起 FS 读。
6. **空 workspaceRoot：** 仍不发起 FS 读。

### 4. Fail-closed / 产品地板

- 禁止 YOLO / always-approve / argv / `prefix_rule` 产品字段。
- 不改 approvalMode lattice、effect authorization、settlement sole-writer。
- 不引入 ShellTool、MCP marketplace、远程 telemetry。
- **无** Granular 审批 UI / Settings policy 编辑器。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/tool-policy-fs.unit.test.ts `
  tests/unit/tool-policy.unit.test.ts `
  tests/unit/teaching-conversation-runtime-tool-policy-inject.unit.test.ts `
  tests/unit/secondary-tool-policy-inject.unit.test.ts `
  tests/unit/catalog-tool-policy-inject.unit.test.ts
```

覆盖点（摘要）：

- 次级 compose 门禁：root 缺席 / grant false / null load → omit
- capability helper 空 root / 缺失文件 → null
- capability helper multi-path merge（primary + course → forbidden 胜出）
- capability helper primary-only ≡ 单文件语义
- connector evaluate 空 workspace 不抛
- helper 层 multi-path 回归（`tool-policy-fs.unit.test.ts`，本切片不改写）

## 不变量

- 磁盘读仅经 ADR-0079 contained / bounded 单文件 loader（由 multi-path helper 复用）。
- merge 权威仍是 pure ADR-0112。
- settlement sole-writer / `expectedRevision` / `toolsReplayed:false` 不动。
- 主对话 multi-path 仍由 ADR-0115 负责；本切片不回改 conversation-runtime。

## 明确不包含 / non-claims

1. **不** 引入 Granular 审批 UI / Settings policy 编辑器。
2. **不** 改 conversation-runtime inject（已 ADR-0115）。
3. **不** 改 pure merge 算法（ADR-0112）。
4. **不** 改 grant 语义（lesson-plan 仍 grant-gated）。
5. **不** 发明 YOLO / always-approve / shell argv / `prefix_rule`。
6. **不** 编辑 [ADR-0121](0121-improvements-adoption-closeout.md) 正文。
7. **不** 引入 shell tool、MCP marketplace、远程 telemetry 或 settlement 变更。
8. **不** 自动扫描 course 包目录树；仅默认双相对路径。

## Residual（产品信号触发）

| 项 | 说明 |
| --- | --- |
| Granular UI | 叠在 allow/prompt/forbidden 之上；禁 YOLO 标签；Settings policy 编辑器仍 defer |
| 更多路径层 | 校团 managed 等额外相对路径需独立产品约定，不默认扫描 |

## 与 ADOPTION B-08 的关系

- ADR-0063 评估、0079 loader、0083/0088/0101 inject、0108 capture、0112 pure merge、0115 主对话 multi-path 已落地。
- 本 ADR 关闭 B-08 residual 中的 **次级路径 multi-path inject** 子项；**Granular UI** 仍是产品侧唯一开放 residual（相对本 multi-path 线）。
