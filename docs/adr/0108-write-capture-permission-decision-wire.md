# ADR-0108：write capture 路径接线 permissionDecision 审计字段

- **状态：** 已实施（ADOPTION B-08 residual：write capture 调用点传入 journal `permissionDecision`）
- **日期：** 2026-07-21
- **范围：** 仅在 registry 权限结算之后、write handler / first-touch pre-image capture 之前，将 **已知** 的 journal 审计词汇写入 `ToolContext` 槽位，并由 `workspace.ts` 捕获路径可选透传；**不**改变 permission settlement 权威
- **相关：** [ADR-0049](0049-write-rewind-journal.md)、[ADR-0063](0063-declarative-tool-policy.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADR-0101](0101-workspace-tool-policy-catalog-inject.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/ai/tools/registry.ts`（`ToolContext.lastJournalPermissionDecision` + resolve 后 per-call 设置）
  - `src/main/ai/tools/workspace.ts`（`captureAndAppendWritePreImage` 透传）
  - `src/main/ai/tools/tool-policy.ts`（纯 `journalPermissionDecisionFromGateAndResolution`）
  - `src/main/ai/tools/write-rewind-journal.ts`（既有可选字段；本切片无结算语义变更）
  - `tests/unit/write-capture-permission-decision.unit.test.ts`
  - `tests/unit/tool-policy.unit.test.ts`
  - `tests/unit/write-rewind-journal.unit.test.ts`

## 背景

ADR-0049 交付 write rewind journal（first-touch pre-image）。ADR-0063 residual 已就绪：

- 纯 `evaluateToolPolicy` + registry gate
- `WriteRewindJournalEntry.permissionDecision?: allow|prompt|forbidden|deny`
- `CaptureWritePreImageInput.permissionDecision?` 已被 `captureAndAppendWritePreImage` 接受
- 纯 helpers：`associatePermissionDecision` / `withPermissionDecision`

缺口：`workspace.ts` 的 capture 调用点 **未** 传入 `permissionDecision`。权限在 `registry.ts` 的 `resolveToolPermission` 中于 handler **之前** 结算；write handler 仅在 allow 之后运行。Journal **不**拥有 permission settlement；字段仅为审计元数据。

B-08 residual 仍开放：把已知决策接到 first-touch capture，使 journal 行可记录审计词汇；Granular UI / multi-file course policy merge 继续 defer。

## 决定

### 1. ToolContext 调用时审计槽（推荐路径 A）

扩展 `ToolContext`：

```ts
/**
 * Optional journal audit only (ADR-0063 residual / B-08 capture wire / ADR-0108).
 * Set by registry after permission resolve when a decision is known.
 * Never used to re-authorize writes; capture may read and pass through.
 */
lastJournalPermissionDecision?: 'allow' | 'prompt' | 'forbidden' | 'deny'
```

规则：

1. registry 在 **非 deny 进入 handler 之前**，按本 call 的 gate + resolution 设置该槽。
2. 无 permission descriptor 的工具：`delete` 槽（避免跨 call 泄漏）。
3. 假定 agent loop 对 write 工具串行；per-call overwrite，不引入并发授权状态机。

### 2. 稳定映射规则（纯 helper）

`journalPermissionDecisionFromGateAndResolution`：

| policyAction | interactiveDecision | journal |
| --- | --- | --- |
| `deny` | * | `forbidden` |
| * | `deny` | `deny` |
| `force_interactive` | `allow` / `allow_once` / `allow_for_run` / `allow_for_directory` | `prompt` |
| `defer_to_approval_mode` / `allow` | 同上 allow* | `allow` |
| 其他 / 未知 | * | `undefined`（省略字段） |

说明：

- gate `deny` / interactive deny **不会**进入 write capture（handler 不跑）；映射仍单元可测，便于审计一致性。
- force_interactive 且用户/grant 放行 → journal **`prompt`**（记录走了交互路径），**不是**改写成 `allow`。
- defer + lattice auto-allow / grant → journal **`allow`**。
- fail-soft：未知组合返回 `undefined`，capture 省略字段。

### 3. workspace capture 透传

```ts
await captureAndAppendWritePreImage({
  workspaceRoot: ctx.workspaceRoot,
  relativePath: target.relativePath,
  runId: ctx.runId,
  content: input.content,
  ...(ctx.lastJournalPermissionDecision
    ? { permissionDecision: ctx.lastJournalPermissionDecision }
    : {})
})
```

未知决策 → **省略**字段（不写 `null` / 不伪造）。

### 4. 权威边界

- Journal **不**结算 permission；仅记录 audit metadata。
- **不**用 journal 字段再授权写。
- **不**改变 effect lattice / `request_approval` / grants / durable publish sole-writer。
- **不**引入 YOLO / always-approve 标签。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/write-rewind-journal.unit.test.ts `
  tests/unit/tool-policy.unit.test.ts `
  tests/unit/write-capture-permission-decision.unit.test.ts
```

## 不变量

- permission settlement 仍在 registry `resolveToolPermission` + approvalMode / grants / UI。
- write capture 仅 **透传** 已知 journal 词汇。
- 无 shell argv / prefix_rule / YOLO / always-approve。
- 不触碰 settlement sole-writer、`expectedRevision`、`toolsReplayed`。
- 缺决策时 journal 行可缺少 `permissionDecision`（向后兼容）。

## 明确不包含 / non-claims

- **不** 提供 Granular 审批 UI。
- **不** 合并多文件 course policy pack。
- **不** 用 journal 字段反推或重放 permission。
- **不** 改 durable publish / operation journal 权威。
- **不** 编辑 ADOPTION.md 正文（协调者 residual 文案）。
- **不** S-09 / agent-loop peel / support-bundle。
