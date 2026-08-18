# ADR-0023：TeachingTurnCoordinator Host 与 Blocking CI

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** `TeachingTurnCoordinatorHost` 薄适配层、`commitLearningOutcome` sole-writer 路径与最小 Blocking CI 门禁。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)
- **证据：** `src/main/teaching-turn-coordinator-host.ts`、`src/main/teaching-ipc-gateway.ts`、`.github/workflows/blocking-ci.yml`、`scripts/check-blocking-ci.mjs`、`tests/unit/teaching-turn-coordinator-host.unit.test.ts`；提交 `8d5c057`、merge `8278dd9`

## 决定

生产环境通过 `TeachingTurnCoordinatorHost` 解析已注册 workspace、绑定 ledger / recorder / committer / planner 端口，并委托 `TeachingTurnCoordinator`。Host 是薄适配层：不含领域规则，不让 renderer 编排 writers / tools / providers。

`commitLearningOutcome` 优先走 host 的 sole-writer 路径（合成稳定 turn envelope），避免 IPC 旁路第二套 settlement writer。Blocking CI（`.github/workflows/blocking-ci.yml`）只强制 typecheck、security/privacy/settings-secret，以及 P0 teaching evidence / IPC 与 coordinator host 单元缝；不把全量 suite 一次变红作为默认门禁。

## 已实施范围与验证入口

- `src/main/teaching-turn-coordinator-host.ts`
- `src/main/teaching-ipc-gateway.ts` 可选 `turnCoordinatorHost`
- `src/main/index.ts` 生产注入 host
- `.github/workflows/blocking-ci.yml`、`scripts/check-blocking-ci.mjs`

```powershell
pnpm run check:blocking-ci
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-turn-coordinator-host.unit.test.ts tests/unit/teaching-ipc-gateway.unit.test.ts
```

## 不变量

- 未知 workspace fail-closed。
- Host 输出对 IPC 保持 learner-safe 投影（省略 bulky assembly / 原始 fact payload）。
- CI 失败日志不得上传 raw secrets、learner answers 或 provider payloads。

## 不包含

- 不授权把 coordinator 扩张为通用 multi-agent 平台。
- 不把 blocking CI 扩成全量 e2e 必需（Golden 仍为发布审计工具）。
- 不改变 P0 outcome settlement authority（ADR-0011 / 0018）。
