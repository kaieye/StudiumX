# ADR-0115：tool-policy 多相对路径 load + merge（课程 overlay）

- **状态：** 已实施（ADOPTION B-08 residual：multi-file FS discovery / 产品注入 merged doc；Granular UI 仍 defer）
- **日期：** 2026-07-21
- **范围：** `loadAndMergeToolPolicyDocumentsFromWorkspace` 多相对路径 fail-soft 装载 + ADR-0112 pure merge；**仅** `teaching-conversation-runtime` 主对话路径改用 dual-path 默认；delegation / lesson-plan / catalog 仍单文件
- **相关：** [ADR-0063](0063-declarative-tool-policy.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADR-0083](0083-workspace-tool-policy-product-inject.md)、[ADR-0088](0088-workspace-tool-policy-secondary-inject.md)、[ADR-0101](0101-workspace-tool-policy-catalog-inject.md)、[ADR-0112](0112-tool-policy-multi-document-merge.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/ai/tools/tool-policy-fs.ts`（`loadAndMergeToolPolicyDocumentsFromWorkspace`、`OPTIONAL_COURSE_TOOL_POLICY_RELATIVE_PATH`）
  - `src/main/teaching-conversation-runtime.ts`（主对话 inject 改 multi-path）
  - `tests/unit/tool-policy-fs.unit.test.ts`
  - `tests/unit/teaching-conversation-runtime-tool-policy-inject.unit.test.ts`
  - `docs/adr/0115-tool-policy-multi-path-load-merge.md`（本文件）

## 背景

ADR-0079 交付单文件 contained FS loader；ADR-0083/0088/0101 将**单个**可选 `.studiumx/tool-policy.json` 注入各运行时路径；ADR-0112 交付 pure `mergeToolPolicyDocuments`（most-restrictive-wins）。

B-08 residual 仍开放「多文件 FS discovery / 产品注入 merged doc」。课程层需要在工作区主策略之上叠加更严的 course overlay，且 **secondary 缺失不得改变** 仅有主文件时的行为。Granular UI 仍不在本切片。

## 决定

### 1. 路径约定

| 常量 | 相对路径 | 角色 |
| --- | --- | --- |
| `DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH` | `.studiumx/tool-policy.json` | 工作区主策略（既有） |
| `OPTIONAL_COURSE_TOOL_POLICY_RELATIVE_PATH` | `.studiumx/tool-policy.course.json` | 可选课程 / 校团 overlay |
| `DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATHS` | 上述二者按序 | 产品 multi-path 默认 |

- 不引入 glob / 目录树扫描 / 任意优先级 DSL。
- 调用方可传显式 `relativePaths`；空串跳过；路径逃逸仍由单文件 loader 拒绝 → null。

### 2. API

```ts
export async function loadAndMergeToolPolicyDocumentsFromWorkspace(input: {
  workspaceRoot: string
  /** defaults: [primary, course overlay] */
  relativePaths?: readonly string[]
  maxBytes?: number
}): Promise<ToolPolicyDocument | null>
```

语义：

1. 对每个相对路径调用既有 `loadToolPolicyDocumentFromWorkspace`（per-file fail-soft → null）。
2. 跳过 null（缺失 / 非法 JSON / 非法形状 / 超限 / 逃逸 / YOLO·argv 拒绝）。
3. 零文档 → **`null`**（产品侧 omit 字段 ≡ default-equivalent）。
4. 单文档 → 原样返回（与单文件 load 行为一致）。
5. 多文档 → `mergeToolPolicyDocuments(docs)`（ADR-0112：rules 按路径序拼接 + `defaultDecision` strictest）。
6. merge **throw**（理论上不应出现，因单文件 loader 已过滤非法形状）→ catch 后 **`null`** fail-soft，永不向产品返回无效合并结果。

单文件 API **保持不变**。

### 3. 产品注入（本切片仅一处）

`teaching-conversation-runtime` / `runTeachingConversationTurnActive`：

- 将 `loadToolPolicyDocumentFromWorkspace` 替换为 `loadAndMergeToolPolicyDocumentsFromWorkspace`（默认 dual paths）。
- **仅有主文件 / 无 course overlay：** 与 ADR-0083 单文件行为 **相同**（返回主文档；null 时 omit）。
- `workspaceRoot` 缺席或空：不发起 FS 读。
- **不**改 delegation-runtime / lesson-plan-production / capability·connector catalog（仍 ADR-0088/0101 单文件）；列为 residual。

### 4. Fail-closed / default-equivalent

- 任一文件失败不拖垮整批：skip 该文件。
- 全部失败或全无 → `null` → `toolPolicyDocumentOption` 省略字段 → registry `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT`。
- **禁止** YOLO / always-approve / argv / `prefix_rule` 产品字段；非法文档不进入 merge。
- 不改变 approvalMode lattice、effect authorization、settlement sole-writer。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/tool-policy-fs.unit.test.ts tests/unit/tool-policy.unit.test.ts tests/unit/teaching-conversation-runtime-tool-policy-inject.unit.test.ts
```

覆盖点（摘要）：

- 无文件 → null
- 仅 primary → 与单文件 load 相等
- 仅 secondary → 返回 course 文档
- 双文件 → merge strictest（evaluate 对目标工具 forbidden 胜出）
- 非法 secondary（YOLO / 坏 JSON）被忽略，primary 保留
- 显式 `relativePaths` 顺序 + 空串跳过
- 路径常量约定

## 不变量

- 磁盘读仅经 ADR-0079 contained / bounded 单文件 loader。
- merge 权威仍是 pure ADR-0112；FS 层不重实现规则语义。
- 无 shell / MCP marketplace / YOLO / always-approve / autoDrain。
- 不触碰 settlement sole-writer、`expectedRevision`、`toolsReplayed`。
- **无** Granular 审批 UI。

## 明确不包含 / non-claims

1. **不** 引入 Granular 审批 UI / Settings policy 编辑器。
2. **不** 改 delegation / lesson-plan / catalog inject（仍单文件；可后续 residual 接 multi-path）。
3. **不** glob / 自动扫描 course 包目录树；仅约定双相对路径（可显式扩展列表）。
4. **不** 改 pure merge 算法（ADR-0112 为准）。
5. **不** 改 write capture / permissionDecision 接线（ADR-0108）。
6. **不** 发明 YOLO / always-approve / shell argv / `prefix_rule`。
7. **不** 编辑 [ADR-0121](0121-improvements-adoption-closeout.md) 正文。
8. **不** 引入 shell tool、MCP marketplace、远程 telemetry 或 settlement 变更。

## Residual（产品信号触发）

| 项 | 说明 |
| --- | --- |
| Granular UI | 叠在 allow/prompt/forbidden 之上；禁 YOLO 标签 |
| 次级路径 multi-path | delegation / lesson-plan / catalog 接同一 helper |
| 更多路径层 | 校团 managed 等额外相对路径需独立产品约定，不默认扫描 |

## 与 ADOPTION B-08 的关系

- ADR-0063 评估、0079 loader、0083/0088/0101 inject、0108 capture、0112 pure merge 已落地。
- 本 ADR 关闭 B-08 residual 中的 **multi-file FS discovery + 主对话 merged inject** 子项；**Granular UI** 与次级路径 multi-path 仍 defer。
