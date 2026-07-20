# Codex Rust v0.144.4 教学化借鉴与实施规划

> **状态：** P0 已关闭并沉淀至 ADR；本文件只维护 **P1/P2 backlog** 与并行实施跟踪。  
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

**禁止：** 借 P1 重开已关闭的 P0 发布证明；不得引入 MCP、shell、第二 provider、通用多 Agent、SQLite 真相源、云同步或新 runtime。  
**Electron Golden（发布审计仍可用）：**

```powershell
pnpm exec playwright test tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e --repeat-each=3
```

## 1. 并行实施跟踪（12 worktrees）

从 HEAD `1515136` 切出 12 个分支，路径 `D:\project\StudiumX-worktrees\p1-XX`。合并顺序见 §3；实现可并行，冲突面尽量按落点文件隔离。

| ID | 分支 | Worktree | 状态 |
| --- | --- | --- | --- |
| P1-2 | `opt/p1-02-typed-tool-dispatcher` | `...\p1-02` | in_progress |
| P1-3 | `opt/p1-03-agent-run-state-machine` | `...\p1-03` | in_progress |
| P1-4 | `opt/p1-04-teaching-config-resolver` | `...\p1-04` | in_progress |
| P1-5 | `opt/p1-05-teaching-capability-catalog` | `...\p1-05` | queued |
| P1-6 | `opt/p1-06-context-projection-report` | `...\p1-06` | in_progress |
| P1-7 | `opt/p1-07-course-definition-store` | `...\p1-07` | in_progress |
| P1-8 | `opt/p1-08-resource-grounder-deepen` | `...\p1-08` | queued |
| P1-9 | `opt/p1-09-teaching-workspace-inspector` | `...\p1-09` | queued |
| P1-10 | `opt/p1-10-teaching-doctor` | `...\p1-10` | queued |
| P1-11 | `opt/p1-11-audit-correlation-privacy` | `...\p1-11` | in_progress |
| P1-12 | `opt/p1-12-teaching-composer-a11y` | `...\p1-12` | queued |
| P1-13 | `opt/p1-13-coordinator-blocking-ci` | `...\p1-13` | queued |

每个 worktree 完成后应在本分支提交，并在 worktree 根写入 `WORKTREE_RESULT.md`（不入库）。重要架构决定合入 main 时再沉淀为 ADR。

## 2. P1 Backlog

### P1-2：Typed Tool Dispatcher 与 Effect Policy

- **StudiumX 落点：** `src/main/ai/tools/execution.ts`、tool registry/definition modules、workspace write tool、search/fetch adapters；新 `src/main/ai/tools/tool-outcome.ts` 与 `effect-policy.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/{registry,router,orchestrator,lifecycle,parallel}.rs`。
- **interface / seam：** `ToolDispatcher.dispatch(call): Promise<ToolOutcome<Output, ToolError>>`；outcome 显式区分 `succeeded|failed|cancelled|denied|timed_out`，effect 分类为 `read|workspace_write|external_write|privileged`。
- **验收：** 非法 JSON 不再静默变 `{}`；失败不再靠含 `error` 的字符串推断；effect 先授权后执行；operation ID 与 audit correlation 可追踪。
- **测试命令：** `pnpm run check:workspace-write-tool`；`pnpm run check:web-fetch-safe-url`；`pnpm exec vitest run --project unit tests/unit/tool-dispatcher.unit.test.ts`。
- **风险与迁移：** 风险是破坏现有工具返回契约；迁移为每个现有工具建 typed adapter，先 shadow-compare 再删除字符串推断；P1 不新增 shell/MCP 工具。

### P1-3：显式 Agent Run 状态机

- **StudiumX 落点：** agent runner/recovery、`src/renderer/src/app-shell/agent-conversation-runner.ts`、run persistence；新 `agent-run-state-machine.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/session/turn.rs`、`tasks/lifecycle.rs`、`codex_thread.rs`。
- **interface / seam：** `AgentRunStateMachine.transition(current, command|event): TransitionResult`；状态与 teaching Session 分离。
- **验收：** waiting/running/awaiting_user/cancelling/completed/failed/interrupted 的合法边明确；恢复与取消幂等；非法转换被记录而不是静默修复。
- **测试命令：** `pnpm run check:agent-run-recovery`；`pnpm run check:agent-operation-idempotency`；`pnpm exec vitest run --project unit tests/unit/agent-run-state-machine.unit.test.ts`。
- **风险与迁移：** 风险是把 teaching Session 误合并进 run；迁移只包现有 runner，SessionLedger 通过 IDs 关联而非继承状态。

### P1-4：TeachingConfigResolver

- **StudiumX 落点：** settings/config loading、workspace preferences、provider settings；新 `src/main/teaching-config-resolver.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/config/src/{state,merge,fingerprint}.rs`。
- **interface / seam：** `resolve(scope): ResolvedTeachingConfig { value, sources, diagnostics, fingerprint }`；来源优先级显式。
- **验收：** default/user/workspace/session override 的来源可解释；secret 不进入普通 snapshot；配置变更可检测；无效配置返回诊断而非半应用。
- **测试命令：** `pnpm run check:settings-secret-storage`；`pnpm exec vitest run --project unit tests/unit/teaching-config-resolver.unit.test.ts`。
- **风险与迁移：** 风险是重建通用配置平台；迁移仅覆盖教学闭环消费字段，现有 settings 通过 Adapter 注入，未使用字段不搬迁。

### P1-5：TeachingCapabilityCatalog

- **StudiumX 落点：** provider/search/skill readiness、permission snapshot；新 `src/main/teaching-capability-catalog.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/{service,render,injection}.rs`。
- **interface / seam：** `snapshot(request): CapabilitySnapshot`，每项含 available/disabled/unconfigured/denied/degraded 与原因、freshness。
- **验收：** planner/context 只消费可用能力；disabled/unconfigured 不进入 prompt；readiness 有 TTL 且失败可降级；不建立第二 provider/skill registry。
- **测试命令：** `pnpm run check:skill-library`；`pnpm run check:web-search-providers`；`pnpm exec vitest run --project unit tests/unit/teaching-capability-catalog.unit.test.ts`。
- **风险与迁移：** 风险是 catalog 与真实执行漂移；迁移从现有 registry 派生只读 snapshot，执行前仍由 effect policy 复核。

### P1-6：Context Projection Report 与预算审计

- **StudiumX 落点：** `src/main/ai/request-context-projection.ts`、`context-compactor.ts`、P0 `teaching-context-assembler.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/context_manager/history.rs`、`compact.rs`、`agents_md.rs`。
- **interface / seam：** 稳定 `ProjectionReport`，记录 included/omitted/reason/truncation/budget/provenance/fingerprint。
- **验收：** 相同 facts/config 得到确定性 fingerprint；Mission/Session/本地证据优先级受测试保护；报告默认脱敏；超预算原因可诊断。
- **测试命令：** `pnpm run check:agent-loop-context-hygiene`；`pnpm run check:agent-loop-context-compaction`；`node scripts/check-context-projection-report.mjs`。
- **风险与迁移：** 风险是报告包含学习者隐私或 prompt；迁移只记录摘要、来源 ID、字节/token 估算和原因码，不记录原文。

### P1-7：Durable CourseDefinition

- **StudiumX 落点：** Course 目录/manifest、workspace lifecycle、catalog；新 `course-definition-store.ts` 与 migration reader。
- **Codex 参考：** durable state 思路参考 `thread-store`，但不采用 SQLite 真相源。
- **interface / seam：** `CourseDefinitionStore.read/write/repair`；CourseDefinition 含 course ID、Mission link、目标、Session ordering 和 schema version。
- **验收：** Course 不再只由路径猜测；Session 顺序/状态可恢复；旧 workspace 可读并按需 materialize；catalog 可重建。
- **测试命令：** `node scripts/check-course-definition-store.mjs`；`node scripts/check-workspace-catalog-reconciliation.mjs`；相关 integration test。
- **风险与迁移：** 风险是批量改写用户 workspace；迁移采用 lazy materialization、备份与 dry-run report，不强制全库迁移。

### P1-8：ResourceGrounder 深化

- **StudiumX 落点：** P0 `resource-grounder.ts`、search/fetch、本地资源索引、source preview。
- **Codex 参考：** core-skills service/render/injection、tools/lifecycle（Adapter 边界思路）。
- **interface / seam：** 扩展 Adapter 为统一 `GroundingSourceAdapter`，仍输出同一 `GroundingPack`。
- **验收：** 去重、freshness、digest、trust/use-for、引用失效和 safe URL 明确；失败转 resource gap；外部内容不隐式写 workspace。
- **测试命令：** `pnpm run check:search-runtime`；`pnpm run check:web-tools-baseline`；`pnpm run check:web-fetch-safe-url`；`node scripts/check-resource-grounder.mjs`。
- **风险与迁移：** 风险是演化成通用 RAG 平台；迁移只增加由真实教学场景驱动的 Adapter，向量库不进入默认路线。

### P1-9：TeachingWorkspaceInspector

- **StudiumX 落点：** teaching workspace lifecycle/catalog/placement/reconciliation；新只读 inspector。
- **Codex 参考：** `cli/src/doctor.rs`、`rollout/src/recorder.rs`。
- **interface / seam：** `inspect(root): WorkspaceInspectionReport`，检查 canonical files、schema、dangling links、catalog drift、temp artifacts。
- **验收：** inspector 默认只读；问题有稳定 code/severity/path-safe evidence/repairability；不把 projection 当 canonical。
- **测试命令：** `node scripts/check-teaching-workspace-inspector.mjs`；`node scripts/check-workspace-catalog-reconciliation.mjs`。
- **风险与迁移：** 风险是 inspector 暗中修复；迁移将 inspect 与 repair command 分开，修复前展示计划并留审计。

### P1-10：结构化 Doctor 与恢复报告

- **StudiumX 落点：** recovery coordinator、catalog repair、settings/provider diagnostics、CLI/diagnostic UI。
- **Codex 参考：** `cli/src/doctor.rs`、rollout/thread-store 诊断边界。
- **interface / seam：** `TeachingDoctor.run(): DoctorReport`；每项输出 check ID、result、safe evidence、recommended action；repair 是单独 effect。
- **验收：** 能诊断 P0 两个 crash window、配置不可用、source gap、catalog drift；报告可导出且脱敏；doctor 失败不阻塞只读打开 workspace。
- **测试命令：** `node scripts/check-teaching-doctor.mjs`；`pnpm run check:agent-run-recovery`。
- **风险与迁移：** 风险是“一键修复”破坏事实；迁移首版只读，自动修复限于确定性 projection rebuild。

### P1-11：Audit Correlation 与教学范围 Provider Privacy 加固

- **StudiumX 落点：** operation IDs、tool audit、provider request logging、support diagnostics。
- **Codex 参考：** protocol IDs/事件边界、tools/lifecycle 调用生命周期。
- **interface / seam：** `AuditCorrelation { sessionId, turnId, eventId?, operationId?, effectId? }`；日志仅存 safe metadata。
- **验收：** 一次教学 outcome 可追到 evidence/effect，而无需保存原始推理；provider payload、secret、完整学习者回答默认不进入日志；导出经过 redaction。
- **测试命令：** `pnpm run check:provider-privacy`；`pnpm run check:settings-secret-storage`；`node scripts/check-teaching-audit-correlation.mjs`。
- **风险与迁移：** 风险是可观测性成为隐私泄露面；迁移用 allowlist schema，旧自由文本日志不迁入新 audit store。

### P1-12：Teaching Composer Commands 与剩余无障碍加固

- **StudiumX 落点：** conversation composer、reader、keyboard/focus hooks、presentation tests。
- **Codex 参考：** `tui/src/bottom_pane/chat_composer.rs`。
- **interface / seam：** 有限 `TeachingCommand` union，例如 continue/retry/show_source/end_session；命令不等于任意工具调用。
- **验收：** 键盘、屏幕阅读器、错误恢复和 reduced motion 可用；命令可发现；不会绕过 planner/effect policy；固定“轮到你”区域稳定。
- **测试命令：** teaching E2E；axe/a11y 测试；`node scripts/check-teaching-composer-a11y.mjs`。
- **风险与迁移：** 风险是斜杠命令扩张成通用 Agent 控制台；迁移只开放教学动作，技术命令保留在诊断模式。

### P1-13：TeachingTurnCoordinator 的生产接线与 Blocking CI

- **剩余落点：** 将现有 main-process coordinator 接入实际 IPC / App 调用链；新增 `.github/workflows/blocking-ci.yml` 及 package scripts。
- **Codex 参考：** `codex_thread.rs`、`tasks/lifecycle.rs`、`.github/workflows/blocking-ci.yml`。
- **接线边界：** coordinator 只编排既有深模块，不吸收其领域规则；renderer 不直接编排 writer/tool/provider。
- **验收：** 生产调用经受控 main-process 路径处理；取消/恢复/重复命令幂等；P0 golden、security、privacy、typecheck/build 成为 blocking CI；失败产物脱敏。
- **测试命令：** 生产接线 contract / integration 测试、最终基线全部命令，以及 CI workflow / required-check 验证。
- **风险与迁移：** 风险是 coordinator 变成 God object、CI 一次性全红；迁移只接入既有调用链，按可靠性分批设为 required，但 P0 golden 在发布前必须 blocking。

## 3. P1 依赖与建议合并顺序

```text
P0 release closure green
  ├─ P1-3 Run state ───────────────┐
  ├─ P1-2 Typed tools/effects ─────┤
  ├─ P1-4 Config resolver ─ P1-5 Capability catalog
  ├─ P1-6 Projection report ─ P1-8 Grounder deepen
  ├─ P1-7 CourseDefinition ─ P1-9 Inspector ─ P1-10 Doctor
  ├─ P1-11 Audit/privacy ──────────┤
  └─ P1-12 Composer/a11y ──────────┴─ P1-13 Coordinator/CI
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