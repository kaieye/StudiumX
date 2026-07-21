# ADR-0112：tool-policy 多文档 pure merge（most-restrictive-wins）

- **状态：** 已实施（ADOPTION B-08 residual：pure multi-document merge only）
- **日期：** 2026-07-21
- **范围：** 纯函数 `mergeToolPolicyDocuments`：将多个 `ToolPolicyDocument` 合并为单一文档，**most-restrictive-wins**；**不**接线产品注入、**不**多文件 FS 自动发现、**不** Granular UI
- **相关：** [ADR-0063](0063-declarative-tool-policy.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADR-0083](0083-workspace-tool-policy-product-inject.md)、[ADR-0088](0088-workspace-tool-policy-secondary-inject.md)、[ADR-0101](0101-workspace-tool-policy-catalog-inject.md)、[ADR-0108](0108-write-capture-permission-decision-wire.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/ai/tools/tool-policy.ts`（`mergeToolPolicyDocuments`）
  - `tests/unit/tool-policy.unit.test.ts`（merge 语义与 evaluate 一致性）
  - `docs/adr/0112-tool-policy-multi-document-merge.md`（本文件）

## 背景

ADR-0063 交付单文档 `evaluateToolPolicy`：多规则命中时取 strictest（`forbidden` > `prompt` > `allow`）。ADR-0079/0083/0088/0101 将**单个**可选工作区文件 `.studiumx/tool-policy.json` 注入各运行时路径。

B-08 residual 仍开放「课程/多层 policy merge / Granular UI」。课程层、校团 overlay、工作区文件等**多层策略**需要一个可组合的 pure merge，以便后续产品在**不发明 YOLO** 的前提下叠加限制。本切片只交付 **pure merge**；UI 与多文件 FS 发现仍 defer 到产品信号。

## 决定

### 1. API

```ts
export function mergeToolPolicyDocuments(
  documents: readonly ToolPolicyDocument[]
): ToolPolicyDocument
```

单函数即可；不另增 `mergeToolPolicyDocumentsStrictestDefaults` 别名（保持 API 面小）。

### 2. 合并算法（most-restrictive-wins）

| 维度 | 语义 |
| --- | --- |
| 空输入 `[]` | **fail-soft**：返回与 `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT` 等价的副本（`version: 1`、`defaultDecision: 'allow'`、空 `rules` 数组拷贝）。产品未装载任何文档时保持既有 approvalMode 主导，不发明全局 prompt/YOLO。 |
| `null` / `undefined` 条目 | **fail-closed**：throw |
| `version` | 全部必须为 `1`；任一其他版本 → throw |
| 无效 rule / 非法 `defaultDecision` | throw |
| 规则含 `argv` / `prefix_rule` / YOLO 字段 | throw（与 `loadToolPolicyDocument` 拒绝面一致） |
| `rules` | **按输入顺序拼接**（后文档 append）。`evaluateToolPolicy` 已在单文档内取 strictest-of-matches，拼接即可实现「任一图层可收紧」。 |
| `defaultDecision` | 仅在**声明了**该字段的文档之间取 **strictest**；若无任何文档声明，则**省略**结果字段（保留 evaluate 对 privileged → forbidden / 其他 → prompt 的 fallback） |
| 结果形状 | 普通不可变友好对象：`version: 1`、rules 数组拷贝、可选 `defaultDecision`；**无** argv / YOLO / always-approve 字段 |

### 3. 与评估的关系

- Merge **不**改变 `evaluateToolPolicy` / registry gate / journal 映射语义。
- 对合并结果调用 `evaluateToolPolicy` 等价于「所有图层规则并集 + 默认项最严」的预期结果。
- 不改 `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT` 语义；空 merge 与「未加载文档」default-equivalent 对齐。

### 4. 不变量

- 纯函数：无 FS IO、无 side effect、无产品注入。
- **无** YOLO / `always_approve` / `DangerFullAccess` / shell argv / `prefix_rule`。
- 不替代 effect authorization、interactive permission gate、workspace containment 或 settlement sole-writer。
- 不改变 registry `resolveToolPermission` 或既有单文件 inject 路径。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/tool-policy.unit.test.ts
```

覆盖点（摘要）：

- 两文档：allow default + forbidden 规则 vs prompt 规则 → evaluate 对目标工具 **forbidden** 胜出
- `defaultDecision`：allow+prompt → prompt；allow+forbidden → forbidden；全未声明 → 省略字段 + privileged fail-closed
- rules 拼接顺序保持；`matchedRuleIndex` / strictest 评估仍正确
- 空数组 → DEFAULT 等价
- 非法 version / null 条目 → throw
- 合并结果序列化无 argv / YOLO 字段

## 明确不包含 / non-claims

1. **不** 引入 Granular 审批 UI / Settings policy 编辑器。
2. **不** 改产品 inject 位点（conversation / delegation / lesson-plan / catalog）——仍为单文件 optional load（ADR-0083/0088/0101）。
3. **不** 多文件 FS 自动发现（course / layer 路径扫描、glob、优先级目录树）——可选 residual，需产品信号 + 独立切片。
4. **不** 改 write capture / `permissionDecision` 接线（ADR-0108 仍为准）。
5. **不** 改 registry gate / approvalMode lattice；**不**发明 YOLO / always-approve。
6. **不** 编辑 [ADR-0121](0121-improvements-adoption-closeout.md) 正文（本切片仅 ADR + pure helper + unit）。
7. **不** 引入 shell tool、MCP marketplace、远程 telemetry 或 settlement 变更。

## Residual（产品信号触发，非本切片 todo）

| 项 | 说明 |
| --- | --- |
| Granular UI | 叠在 allow/prompt/forbidden 之上；禁 YOLO 标签 |
| 多文件 FS discovery | 例如 course + workspace 双文件 load 后调用本 merge；路径约定与 loader 需独立 ADR |
| 产品 inject 接线 | 将 merge 结果传入 `buildToolContext` / `ToolContext.toolPolicyDocument` 须单独立项 |

## 与 ADOPTION B-08 的关系

- ADR-0063 单文档评估 + registry gate、ADR-0079 FS loader、ADR-0083/0088/0101 inject、ADR-0108 capture wire 已落地。
- 本 ADR 关闭 B-08 residual 中的 **pure multi-document merge** 子项；**Granular UI** 与 **multi-file FS discovery** 仍 defer。
