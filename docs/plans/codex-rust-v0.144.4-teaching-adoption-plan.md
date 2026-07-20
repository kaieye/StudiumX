# Codex Rust v0.144.4 教学化借鉴与实施规划

> **状态：** P0/P1 已关闭并沉淀至 ADR；本文件只维护 **P1 合入记录** 与 **P2 backlog**（P2 默认不排期）。  
> **参考项目：** `ref_project/codex-rust-v0.144.4`  
> **适用项目：** StudiumX  
> **核心决策：** 不扩张为通用 coding agent；先证明教学闭环在可发布标准下可恢复、可审计且对学习者安全。

## 0. 已实施基线（不要重开）

已完成的领域决定、实现范围与发布证明已从本执行规划移除，权威记录见 [ADR 索引](../adr/README.md)：

| 范围 | ADR | 说明 |
| --- | --- | --- |
| P0 教学领域模块 | [0008](../adr/0008-learning-session-ledger-as-canonical-teaching-process.md)–[0016](../adr/0016-trusted-assessment-artifacts-for-outcome-evaluation.md) | Session / Evidence / Outcome / Planner / Context / Presentation / Events / Assessment |
| P0 Win/Mac 发布证明 | [0017](../adr/0017-win-mac-p0-release-proof-and-audit-policy.md) | clean-checkout audit、runtime gates、真实 Electron Golden；commit `a797f07` |
| 本地数据相关边界 | [0001](../adr/0001-rebuildable-sqlite-projection.md)–[0007](../adr/0007-persisted-user-history-redaction.md)、[0018](../adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md)–[0020](../adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md) | 投影/备份/publish/trace/memory/redaction 与后续 evidence 边界 |
| P1 运行时边界 | [0021](../adr/0021-agent-run-state-machine-separate-from-session.md)–[0023](../adr/0023-teaching-turn-coordinator-host-and-blocking-ci.md) | Agent run 与 Session 分离、能力 catalog 只读就绪、Coordinator host sole-writer 与 blocking CI |

**禁止：** 借 P1 重开已关闭的 P0 发布证明；不得引入 MCP、shell、第二 provider、通用多 Agent、SQLite 真相源、云同步或新 runtime。  
**Electron Golden（发布审计仍可用）：**

```powershell
pnpm exec playwright test tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e --repeat-each=3
```

## 1. 并行实施跟踪（12 worktrees）

从 HEAD `1515136` 切出 12 个分支，路径 `D:\project\StudiumX-worktrees\p1-XX`。合并顺序见 §2 历史记录；实现可并行，冲突面尽量按落点文件隔离。

| ID | 分支 | Worktree | 状态 | Feature | Merge |
| --- | --- | --- | --- | --- | --- |
| P1-2 | `opt/p1-02-typed-tool-dispatcher` | `...\p1-02` | integrated | `b4f3c9c` | `0d99c14` |
| P1-3 | `opt/p1-03-agent-run-state-machine` | `...\p1-03` | integrated | `8a0fd64` | `fb02469` |
| P1-4 | `opt/p1-04-teaching-config-resolver` | `...\p1-04` | integrated | `a21de1b` | `a6072a1` |
| P1-5 | `opt/p1-05-teaching-capability-catalog` | `...\p1-05` | integrated | `262c2b9` | `cd33836` |
| P1-6 | `opt/p1-06-context-projection-report` | `...\p1-06` | integrated | `3966e0d` | `2a00286` |
| P1-7 | `opt/p1-07-course-definition-store` | `...\p1-07` | integrated | `ef8b326` | `2f83389` |
| P1-8 | `opt/p1-08-resource-grounder-deepen` | `...\p1-08` | integrated | `768d7d6` | `7c83525` |
| P1-9 | `opt/p1-09-teaching-workspace-inspector` | `...\p1-09` | integrated | `cf6a070` | `9ebc933` |
| P1-10 | `opt/p1-10-teaching-doctor` | `...\p1-10` | integrated | `8bd3c97` | `85dd33a` |
| P1-11 | `opt/p1-11-audit-correlation-privacy` | `...\p1-11` | integrated | `f1a7f3d` | `0391ba8` |
| P1-12 | `opt/p1-12-teaching-composer-a11y` | `...\p1-12` | integrated | `8cc956b` | `f6257cc` |
| P1-13 | `opt/p1-13-coordinator-blocking-ci` | `...\p1-13` | integrated | `8d5c057` | `8278dd9` |

每个 worktree 完成后应在本分支提交，并在 worktree 根写入 `WORKTREE_RESULT.md`（不入库）。重要架构决定合入 main 时再沉淀为 ADR。

> **进度（2026-07-20）：** 12/12 worktree 已按历史合并顺序合入 `main`（feature SHAs 与 merge SHAs 见上表；integration tip 另含 typecheck 修复）。合入后 P1 单元测试 166 passed、9 个 P1 check scripts 通过、`tsc --noEmit` 通过。架构沉淀见 ADR-0021–0023。

## 2. P1 已关闭（不要重开）

P1-2…P1-13 已全部合入 `main`（feature / merge SHAs 见 §1）。执行规格与验收细节从本文件移除，避免与代码/ADR 双源漂移。

| 范围 | 权威记录 | 主要落点 |
| --- | --- | --- |
| P1-2 Typed ToolDispatcher / Effect Policy | §1 merge `0d99c14` | `src/main/ai/tools/{dispatcher,effect-policy,tool-outcome}.ts` |
| P1-3 Agent Run 状态机 | [ADR-0021](../adr/0021-agent-run-state-machine-separate-from-session.md) | `src/main/agent-run-state-machine.ts` |
| P1-4 TeachingConfigResolver | §1 merge `a6072a1` | `src/main/teaching-config-resolver.ts` |
| P1-5 TeachingCapabilityCatalog | [ADR-0022](../adr/0022-teaching-capability-catalog-read-only-readiness.md) | `src/main/teaching-capability-catalog.ts` |
| P1-6 Context ProjectionReport | §1 merge `2a00286` | `src/main/ai/context-projection-report.ts` |
| P1-7 CourseDefinition store | §1 merge `2f83389` | `src/main/course-definition-store.ts` |
| P1-8 ResourceGrounder 深化 | §1 merge `7c83525` | `src/main/resource-grounder.ts`、`resource-grounder-external-adapters.ts` |
| P1-9 Workspace inspector | §1 merge `9ebc933` | `src/main/teaching-workspace-inspector.ts` |
| P1-10 TeachingDoctor | §1 merge `85dd33a` | `src/main/teaching-doctor.ts` |
| P1-11 Audit correlation / privacy | §1 merge `0391ba8` | `src/main/teaching-audit-correlation.ts` |
| P1-12 Composer commands / a11y | §1 merge `f6257cc` | `src/shared/teaching-command.ts`、`TeachingComposerCommandMenu.tsx` |
| P1-13 Coordinator host + blocking CI | [ADR-0023](../adr/0023-teaching-turn-coordinator-host-and-blocking-ci.md) | `teaching-turn-coordinator-host.ts`、`.github/workflows/blocking-ci.yml` |

**禁止：** 借 P2 或后续工作重开已合入的 P1 规格为“未完成 backlog”；变更须走新 design gate / ADR 修订，而不是把本节恢复成 todo 列表。

### 历史合并顺序（已执行）

```text
P1-3, P1-2, P1-4 → P1-5, P1-6 → P1-8, P1-7 → P1-9 → P1-10, P1-11, P1-12 → P1-13
```

## 4. P2 Backlog：仅由真实规模或风险信号触发

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