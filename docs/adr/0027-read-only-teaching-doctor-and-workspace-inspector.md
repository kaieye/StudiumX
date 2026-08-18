# ADR-0027：只读 TeachingDoctor 与 Workspace Inspector（诊断 ≠ 修复）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 教学诊断分两层只读缝（`TeachingWorkspaceInspector` + `TeachingDoctor.run(facts)`）；repair 与诊断分离、`autoRepairAllowed` 恒为 `false`。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0031](0031-advanced-tech-inspector.md)、[ADR-0034](0034-redacted-support-bundle.md)
- **证据：** `src/main/teaching-workspace-inspector.ts`、`src/main/teaching-doctor.ts`、`src/shared/teaching-types/teaching-doctor.ts`、`tests/unit/teaching-doctor.unit.test.ts`；提交 `cf6a070`、`8bd3c97`、merge `9ebc933`、`85dd33a`

## 决定

教学诊断分两层只读缝：

1. **`TeachingWorkspaceInspector`**：对单一 workspace root 产出 `WorkspaceInspectionReport`（canonical files、schema、dangling links、catalog drift、temp artifacts）。**永不**写文件系统、**永不** auto-repair，**永不**把 catalog projection 当作 canonical 真相。
2. **`TeachingDoctor.run(facts)`**：纯函数消费调用方采集的 facts，产出结构化 `TeachingDoctorReport`（checkId / result / evidence / recommendedAction / repair）。覆盖 P0 crash window、config 可用性、source gap、catalog drift。

**Repair 是与诊断分离的 effect。** v1 中 `autoRepairAllowed` 恒为 `false`，`diagnostics.autoRepair = 'disabled'`。即使 `overallStatus` 为 `fail` / `error`，`workspaceOpenPolicy` 仍为 `read_only_allowed`——Doctor 失败不得阻断只读打开 workspace。

导出路径必须脱敏；evidence 仅相对路径与聚合字段。

## 已实施范围与验证入口

- `src/main/teaching-workspace-inspector.ts`
- `src/main/teaching-doctor.ts`
- `src/shared/teaching-types/teaching-doctor.ts`
- `scripts/check-teaching-workspace-inspector.mjs`、`scripts/check-teaching-doctor.mjs`

```powershell
pnpm run check:teaching-workspace-inspector
pnpm run check:teaching-doctor
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-workspace-inspector.unit.test.ts tests/unit/teaching-doctor.unit.test.ts
```

## 不变量

- Inspector / Doctor 只读；v1 不自动执行 repair。
- Doctor 失败不阻止 `read_only` workspace open。
- 导出与 evidence 不含 secrets、完整绝对路径、raw learner answers 或 provider payloads。

## 不包含

- 不授权自动 repair worker、destructive cleanup 或 support-bundle 无预览导出（见 P2-8 触发项）。
- 不把 Inspector findings 提升为 Outcome / Learning record。
- 不替代 P0 settlement / reconciler 的权威修复路径。
