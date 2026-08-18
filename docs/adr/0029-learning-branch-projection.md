# ADR-0029：Learning Branch Projection（只读分支投影）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 教学路径可视化使用只读 `projectLearningBranch(facts)` 投影，产出 primary path 与显式标记为 non-canonical 的 alternate branches。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0012](0012-deterministic-next-teaching-step-planner.md)、[ADR-0014](0014-learner-safe-teaching-turn-presentation.md)
- **证据：** `src/shared/teaching-types/learning-branch-projection.ts`、`src/main/learning-branch-projection.ts`、`scripts/check-learning-branch-projection.mjs`、`tests/unit/learning-branch-projection.unit.test.ts`；提交 `717a9c6`、merge `3ec6dda`

## 决定

教学路径可视化使用 **Learning Branch Projection**：纯函数 `projectLearningBranch(facts)` 在不读写 ledger 的前提下，产出 primary path 与明确标记为 non-canonical 的 alternate branches（如 retry / clarification / resource_wait 的反事实投影）。

投影消费与 `NextTeachingStepPlanner` 同级的 non-content-bearing facts，可附带历史 session 摘要（id/status/outcomeKind only）。输出带 `schemaVersion=1`、稳定 fingerprint，永不写 outcome / session / record。

## 已实施范围与验证入口

- `src/shared/teaching-types/learning-branch-projection.ts`
- `src/main/learning-branch-projection.ts`
- `scripts/check-learning-branch-projection.mjs`

```powershell
pnpm run check:learning-branch-projection
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/learning-branch-projection.unit.test.ts
```

## 不变量

- 只读；不改变 canonical outcome 历史。
- 无 I/O、无 `Math.random`；输入不被原地修改。
- alternate 路径必须可识别为投影，不得伪装为已结算事实。

## 不包含

- 不授权 UI picker、IPC host 接线，或把 branch 状态持久化为真相源。
- 不修改 planner 的 action 词表权威。
