# ADR-0028：Teaching Audit Correlation 与安全元数据边界

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 教学审计 correlation 使用封闭 `AuditCorrelation` 与 allowlisted `TeachingAuditSafeMetadata`；默认不投影 provider payload / secret / learner answer / raw reasoning / 完整绝对路径。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)
- **证据：** `src/main/teaching-audit-correlation.ts`、`scripts/check-teaching-audit-correlation.mjs`、`tests/unit/teaching-audit-correlation.unit.test.ts`；提交 `f1a7f3d`、merge `0391ba8`

## 决定

教学审计 correlation 使用封闭 `AuditCorrelation`：

`{ sessionId, turnId, eventId?, operationId?, effectId? }`

日志与 support 导出只接受 **allowlisted** `TeachingAuditSafeMetadata`。SessionLedger（ADR-0008）与 Agent run（ADR-0021）保持身份分离，仅通过 ID 关联。默认 **永不**投影：provider payload、secrets、完整 learner answers、raw reasoning、完整绝对路径。

模块为纯函数（无 I/O、无网络），复用既有 `redactAgentSecretText`，不重写 secret 词表。Hook 点包括 command / turn envelope、tool operation effect，以及 `redactTeachingAuditForExport`。

本决定是对 ADR-0005（main-owned trace / 安全日志）在**教学回合元数据**面的显式补充：traceId 仍由 main 拥有；教学 correlation 增加 session/turn/operation 语义，但不引入第二 logging 子系统。

## 已实施范围与验证入口

- `src/main/teaching-audit-correlation.ts`
- `scripts/check-teaching-audit-correlation.mjs`

```powershell
pnpm run check:teaching-audit-correlation
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-audit-correlation.unit.test.ts
```

## 不变量

- 拒绝字段词表覆盖 providerPayload / learnerAnswer / reasoning / apiKey / secret / prompt / transcript 等。
- 纯模块：不得引入 fs / fetch / SQLite / MCP / shell。
- Correlation 不得把 Session 状态机与 Agent run 状态机合并。

## 不包含

- 不授权无预览 support bundle 或完整 raw transcript 导出（P2-8 另案）。
- 不替代 C-4P9 audit JSONL wire（ADR-0019）或完整 C-4P9 close-out。
- 不建立全局 actionId / multi-writer audit bus。
