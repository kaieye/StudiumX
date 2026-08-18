# ADR-0021：Agent Run 状态机与 Teaching Session 分离

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 显式 `AgentRunStateMachine`（waiting/running/awaiting_user/cancelling/completed/failed/interrupted）与 `LearningSession` 分离，仅以 ID 关联。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)
- **证据：** `src/main/agent-run-state-machine.ts`、`src/main/ai/agent-run-store.ts`、`tests/unit/agent-run-state-machine.unit.test.ts`；提交 `8a0fd64`、merge `fb02469`

## 决定

Agent 执行生命周期由显式 `AgentRunStateMachine` 管理，状态空间为 waiting / running / awaiting_user / cancelling / completed / failed / interrupted。Teaching `LearningSession`（ADR-0008）保持独立 canonical 教学过程；两者仅通过 ID 关联，禁止把 run 状态继承进 SessionLedger，也禁止用 Session 状态机替代 run recovery。

合法转换在状态机内枚举；非法转换被记录并拒绝，不得静默“修复”为合法边。恢复与取消路径幂等。

## 已实施范围与验证入口

- `src/main/agent-run-state-machine.ts`：纯状态转换与结果类型。
- `src/main/ai/agent-run-store.ts`：持久化 run 时走状态机，不扩张为第二套教学 ledger。

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/agent-run-state-machine.unit.test.ts
pnpm run check:agent-run-recovery
pnpm run check:agent-operation-idempotency
```

## 不变量

- SessionLedger 与 Agent run 身份分离；关联仅限 ID / correlation 字段。
- 取消与恢复不得制造重复 run 事实或回写 teaching outcome。
- 非法边必须可审计，不得静默 swallow。

## 不包含

- 不授权 MCP、shell、通用多 Agent 平台或第二 provider。
- 不把 teaching Session 生命周期并入 agent runner。
- 不替代 P0 outcome / evidence settlement authority。
