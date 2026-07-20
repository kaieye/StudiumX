# Codex Rust v0.144.4 教学化借鉴与实施规划

> **状态：** P0/P1 已关闭；**P2-1…P2-5 与 P2-8 已实施**并沉淀至 ADR-0029…0034。剩余 **P2-6 / P2-7** 仍为信号触发、默认不排期。  
> **参考项目：** `ref_project/codex-rust-v0.144.4`  
> **适用项目：** StudiumX  
> **核心决策：** 不扩张为通用 coding agent；先证明教学闭环在可发布标准下可恢复、可审计且对学习者安全。

## 0. 已实施基线（不要重开）

已完成的领域决定、实现范围与发布证明的权威记录见 [ADR 索引](../adr/README.md)：

| 范围 | ADR | 说明 |
| --- | --- | --- |
| P0 教学领域模块 | [0008](../adr/0008-learning-session-ledger-as-canonical-teaching-process.md)–[0016](../adr/0016-trusted-assessment-artifacts-for-outcome-evaluation.md) | Session / Evidence / Outcome / Planner / Context / Presentation / Events / Assessment |
| P0 Win/Mac 发布证明 | [0017](../adr/0017-win-mac-p0-release-proof-and-audit-policy.md) | clean-checkout audit、runtime gates、真实 Electron Golden |
| 本地数据相关边界 | [0001](../adr/0001-rebuildable-sqlite-projection.md)–[0007](../adr/0007-persisted-user-history-redaction.md)、[0018](../adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md)–[0020](../adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md) | 投影/备份/publish/trace/memory/redaction 与后续 evidence 边界 |
| P1 运行时与教学运营 | [0021](../adr/0021-agent-run-state-machine-separate-from-session.md)–[0028](../adr/0028-teaching-audit-correlation-safe-metadata.md) | Run 状态机、Config、Capability、ToolDispatcher、CourseDefinition、Doctor/Inspector、Audit correlation、Coordinator host / blocking CI 等 |
| P2 只读投影 / 调度 / 导出 | [0029](../adr/0029-learning-branch-projection.md)–[0034](../adr/0034-redacted-support-bundle.md) | Branch projection、Resume picker、Tech inspector、Parallel read tools、Config CAS、Support bundle |

**禁止：** 借后续工作重开已关闭的 P0/P1/P2 已实施规格为“未完成 backlog”；变更须走新 design gate / ADR 修订。不得引入 MCP、shell、第二 provider、通用多 Agent、SQLite 真相源、云同步或新 runtime（除非某剩余 P2 项被真实信号触发并获批）。

**Electron Golden（发布审计仍可用）：**

```powershell
pnpm exec playwright test tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e --repeat-each=3
```

## 1. 已合入的 P2 实施（并行 worktree）

| 项 | 分支 / feature | merge | 门禁 |
| --- | --- | --- | --- |
| P2-1 Learning Branch Projection | `opt/p2-01-learning-branch-projection` / `717a9c6` | `3ec6dda` | `pnpm run check:learning-branch-projection` |
| P2-2 Session Resume Picker | `opt/p2-02-session-resume-picker` / `669e3a2` | `cac87b0` | `pnpm run check:session-resume-picker` |
| P2-3 Advanced Tech Inspector | `opt/p2-03-tech-inspector` / `2341549` | `81cee1d` | `pnpm run check:tech-inspector` |
| P2-4 Parallel Read Tools | `opt/p2-04-parallel-read-tools` / `f87209b` | `1854e28` | `pnpm run check:parallel-read-tools` |
| P2-5 Config Optimistic Concurrency | `opt/p2-05-config-optimistic-concurrency` / `e39313a` | `fe648a9` | `pnpm run check:config-optimistic-concurrency` |
| P2-8 Redacted Support Bundle | `opt/p2-08-support-bundle` / `35dde79` | `899aeb3` | `pnpm run check:support-bundle` |

以上条目均为**领域纯模块 / 薄适配**优先：只读投影、CAS 写、consent 导出；默认不改 learner 主路径 UI。IPC/renderer 接线可另立 design gate。

## 2. 剩余 P2 Backlog（仍须真实信号）

### P2-6：MCP（仅在存在真实教学 Adapter 时）
- 受限 Adapter，返回既有 typed outcomes。无真实 Adapter 与威胁模型则**永不**实施。

### P2-7：Helper Isolation（仅执行不可信代码时）
- 独立 helper process；普通 Lesson/grounding 不经过。无不可信代码执行需求则不实施。
