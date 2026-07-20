# Codex Rust v0.144.4 教学化借鉴与实施规划

> **状态：** P0/P1 已关闭并沉淀至 ADR；本文件只维护 **P2 backlog**（默认不排期）。  
> **参考项目：** `ref_project/codex-rust-v0.144.4`  
> **适用项目：** StudiumX  
> **核心决策：** 不扩张为通用 coding agent；先证明教学闭环在可发布标准下可恢复、可审计且对学习者安全。

## 0. 已实施基线（不要重开）

已完成的领域决定、实现范围与发布证明已从本执行规划移除，权威记录见 [ADR 索引](../adr/README.md)：

| 范围 | ADR | 说明 |
| --- | --- | --- |
| P0 教学领域模块 | [0008](../adr/0008-learning-session-ledger-as-canonical-teaching-process.md)–[0016](../adr/0016-trusted-assessment-artifacts-for-outcome-evaluation.md) | Session / Evidence / Outcome / Planner / Context / Presentation / Events / Assessment |
| P0 Win/Mac 发布证明 | [0017](../adr/0017-win-mac-p0-release-proof-and-audit-policy.md) | clean-checkout audit、runtime gates、真实 Electron Golden |
| 本地数据相关边界 | [0001](../adr/0001-rebuildable-sqlite-projection.md)–[0007](../adr/0007-persisted-user-history-redaction.md)、[0018](../adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md)–[0020](../adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md) | 投影/备份/publish/trace/memory/redaction 与后续 evidence 边界 |
| P1 运行时与教学运营 | [0021](../adr/0021-agent-run-state-machine-separate-from-session.md)–[0028](../adr/0028-teaching-audit-correlation-safe-metadata.md)；Context/Presentation 深化见 [0013](../adr/0013-budgeted-provenance-aware-teaching-context.md)、[0014](../adr/0014-learner-safe-teaching-turn-presentation.md) | Run 状态机、Config、Capability、ToolDispatcher、CourseDefinition、Doctor/Inspector、Audit correlation、Coordinator host / blocking CI 等 |

**禁止：** 借后续工作重开已关闭的 P0/P1 规格为“未完成 backlog”；变更须走新 design gate / ADR 修订。不得引入 MCP、shell、第二 provider、通用多 Agent、SQLite 真相源、云同步或新 runtime（除非某 P2 项被真实信号触发并获批）。

**Electron Golden（发布审计仍可用）：**

```powershell
pnpm exec playwright test tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e --repeat-each=3
```

## 1. P2 Backlog：仅由真实规模或风险信号触发

P2 默认不排期。每个条目必须由可量化触发信号进入实施。不得因“Codex 有”而建设。

### P2-1：Learning Branch Projection
- 只读分支投影；不改变 canonical outcome 历史。触发：线性 planner 无法满足已观察场景。

### P2-2：长 Session Resume Picker
- 从 durable ledger 筛选 resume 候选。触发：真实 workspace Session 数与恢复失败工单达门槛。

### P2-3：高级技术 Inspector
- 诊断模式 typed events/effects/projection report viewer；默认隐藏。触发：支持流程需要。

### P2-4：保守的并行只读工具
- 仅 `effect=read` 且无锁冲突时可并行。触发：profiling 证明收益。

### P2-5：Watcher/Config 乐观并发
- `write(expectedFingerprint, next)`。触发：观测到外部编辑丢失。

### P2-6：MCP（仅在存在真实教学 Adapter 时）
- 受限 Adapter，返回既有 typed outcomes。无真实 Adapter 与威胁模型则永不实施。

### P2-7：Helper Isolation（仅执行不可信代码时）
- 独立 helper process；普通 Lesson/grounding 不经过。

### P2-8：脱敏 Support Bundle
- 用户预览并同意后导出；默认无 raw prompt/secret/完整绝对路径。