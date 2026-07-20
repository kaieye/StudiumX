# Codex Rust v0.144.4 教学化借鉴与实施规划

> **状态：** P0 领域模块已经实施并沉淀至 ADR-0008 至 ADR-0016；P0 **Win/Mac 发布完成证明已关闭**（见 [ADR-0017](../adr/0017-win-mac-p0-release-proof-and-audit-policy.md)）。本文件只记录 P1/P2 backlog，不重复已完成实现与发布证明细节。
>
> **参考项目：** `ref_project/codex-rust-v0.144.4`
>
> **适用项目：** StudiumX
>
> **核心决策：** 不扩张为通用 coding agent；先证明教学闭环在可发布标准下可恢复、可审计且对学习者安全。

## 0. 已实施基线与文档边界

所有已完成的领域决定、实现范围、Git 提交与定向自动化入口都已从本执行规划移除，并沉淀到 [ADR 索引](../adr/README.md)（ADR-0008 至 ADR-0016）。本文件不再维护任何完成清单。

ADR-0008 至 ADR-0016 证明已实施的受限模块边界；ADR-0017 记录 Win/Mac clean-checkout 审计、runtime gate 与真实 Electron longitudinal/crash Golden。P1 不得在未读 ADR-0017 的前提下重新打开已关闭的 P0 发布证明。

## 1. P0 发布证明（已关闭）

> 历史 closure 说明。**不再是待办。** 权威记录：[ADR-0017](../adr/0017-win-mac-p0-release-proof-and-audit-policy.md)。

### 1.1 当前准确表述

- P0 领域模块：ADR-0008 至 ADR-0016。
- Win/Mac 发布证明：已关闭（runtime gates、真实 Electron longitudinal / crash-restart Golden 于 `--repeat-each=3`、clean-checkout audit、inventoried skip 政策）。
- 发布证明 commit：`a797f07a65ed7a598bb96d1666e496fcf0275f67`（见 ADR-0017）。
- 后续工作从 §2 P1 开始；不得借 P1 重开已关闭的 P0 发布证明。

### 1.2 已关闭的证明面（摘要）

1. committer / recovery / read-repair **runtime** gates（非失效静态正则）。
2. 全量 integration 在 Win 上可解释：能力门 skip 进入 `platformReleaseSkipBudget` / `knownPlatformSkip`，未解释 skip 仍 fail-closed。
3. 真实 longitudinal Electron Golden 与 crash/restart injection。
4. clean-checkout 全量发布审计与机外证据摘要（ADR-0017）。

### 1.3 允许写域（仅当修复 ADR-0017 范围内回归）

仅可修改 audit contract/gates、相关 tests/harness、必要的 platform 兼容与文档/ADR。不得借机重写 session/evidence/outcome/planner/context/presentation 深模块，也不得引入 MCP、shell、第二 provider、通用多 Agent、数据库、云同步或新 runtime。

### 1.4 Electron 命令（仍为发布审计的一部分）

```powershell
pnpm exec playwright test tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e --repeat-each=3
```


## 2. P1 Backlog：P0 release closure 后才可开始

已经实施的 P1 条目已从本计划移除；以下条目尚未达到计划级完成证明。

### P1-2：Typed Tool Dispatcher 与 Effect Policy

- **StudiumX 落点：** `src/main/ai/tools/execution.ts`、tool registry/definition modules、workspace write tool、search/fetch adapters；新 `src/main/ai/tools/tool-outcome.ts` 与 `effect-policy.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/registry.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/router.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/orchestrator.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/parallel.rs`。
- **interface / seam：** `ToolDispatcher.dispatch(call): Promise<ToolOutcome<Output, ToolError>>`；outcome 显式区分 `succeeded|failed|cancelled|denied|timed_out`，effect 分类为 `read|workspace_write|external_write|privileged`。
- **验收：** 非法 JSON 不再静默变 `{}`；失败不再靠含 `error` 的字符串推断；effect 先授权后执行；operation ID 与 audit correlation 可追踪。
- **测试命令：** `pnpm run check:workspace-write-tool`；`pnpm run check:web-fetch-safe-url`；`pnpm exec vitest run --project unit tests/unit/tool-dispatcher.unit.test.ts`。
- **风险与迁移：** 风险是破坏现有工具返回契约；迁移为每个现有工具建 typed adapter，先 shadow-compare 再删除字符串推断；P1 不新增 shell/MCP 工具。

### P1-3：显式 Agent Run 状态机

- **StudiumX 落点：** agent runner/recovery、`src/renderer/src/app-shell/agent-conversation-runner.ts`、run persistence；新 `agent-run-state-machine.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/session/turn.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tasks/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/codex_thread.rs`。
- **interface / seam：** `AgentRunStateMachine.transition(current, command|event): TransitionResult`；状态与 teaching Session 分离。
- **验收：** waiting/running/awaiting_user/cancelling/completed/failed/interrupted 的合法边明确；恢复与取消幂等；非法转换被记录而不是静默修复。
- **测试命令：** `pnpm run check:agent-run-recovery`；`pnpm run check:agent-operation-idempotency`；`pnpm exec vitest run --project unit tests/unit/agent-run-state-machine.unit.test.ts`。
- **风险与迁移：** 风险是把 teaching Session 误合并进 run；迁移只包现有 runner，SessionLedger 通过 IDs 关联而非继承状态。

### P1-4：TeachingConfigResolver

- **StudiumX 落点：** settings/config loading、workspace preferences、provider settings；新 `src/main/teaching-config-resolver.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/config/src/state.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/config/src/merge.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/config/src/fingerprint.rs`。
- **interface / seam：** `resolve(scope): ResolvedTeachingConfig { value, sources, diagnostics, fingerprint }`；来源优先级显式。
- **验收：** default/user/workspace/session override 的来源可解释；secret 不进入普通 snapshot；配置变更可检测；无效配置返回诊断而非半应用。
- **测试命令：** `pnpm run check:settings-secret-storage`；`pnpm exec vitest run --project unit tests/unit/teaching-config-resolver.unit.test.ts`。
- **风险与迁移：** 风险是重建通用配置平台；迁移仅覆盖教学闭环消费字段，现有 settings 通过 Adapter 注入，未使用字段不搬迁。

### P1-5：TeachingCapabilityCatalog

- **StudiumX 落点：** provider/search/skill readiness、permission snapshot；新 `src/main/teaching-capability-catalog.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/service.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/render.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/injection.rs`。
- **interface / seam：** `snapshot(request): CapabilitySnapshot`，每项含 available/disabled/unconfigured/denied/degraded 与原因、freshness。
- **验收：** planner/context 只消费可用能力；disabled/unconfigured 不进入 prompt；readiness 有 TTL 且失败可降级；不建立第二 provider/skill registry。
- **测试命令：** `pnpm run check:skill-library`；`pnpm run check:web-search-providers`；`pnpm exec vitest run --project unit tests/unit/teaching-capability-catalog.unit.test.ts`。
- **风险与迁移：** 风险是 catalog 与真实执行漂移；迁移从现有 registry 派生只读 snapshot，执行前仍由 effect policy 复核。

### P1-6：Context Projection Report 与预算审计

- **StudiumX 落点：** `src/main/ai/request-context-projection.ts`、`context-compactor.ts`、P0 `teaching-context-assembler.ts`。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/context_manager/history.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/compact.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/agents_md.rs`。
- **interface / seam：** 稳定 `ProjectionReport`，记录 included/omitted/reason/truncation/budget/provenance/fingerprint。
- **验收：** 相同 facts/config 得到确定性 fingerprint；Mission/Session/本地证据优先级受测试保护；报告默认脱敏；超预算原因可诊断。
- **测试命令：** `pnpm run check:agent-loop-context-hygiene`；`pnpm run check:agent-loop-context-compaction`；`node scripts/check-context-projection-report.mjs`。
- **风险与迁移：** 风险是报告包含学习者隐私或 prompt；迁移只记录摘要、来源 ID、字节/token 估算和原因码，不记录原文。

### P1-7：Durable CourseDefinition

- **StudiumX 落点：** Course 目录/manifest、workspace lifecycle、catalog；新 `course-definition-store.ts` 与 migration reader。
- **Codex 参考：** durable state 思路参考 `ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/store.rs`，但不采用 SQLite 真相源。
- **interface / seam：** `CourseDefinitionStore.read/write/repair`；CourseDefinition 含 course ID、Mission link、目标、Session ordering 和 schema version。
- **验收：** Course 不再只由路径猜测；Session 顺序/状态可恢复；旧 workspace 可读并按需 materialize；catalog 可重建。
- **测试命令：** `node scripts/check-course-definition-store.mjs`；`node scripts/check-workspace-catalog-reconciliation.mjs`；相关 integration test。
- **风险与迁移：** 风险是批量改写用户 workspace；迁移采用 lazy materialization、备份与 dry-run report，不强制全库迁移。

### P1-8：ResourceGrounder 深化

- **StudiumX 落点：** P0 `resource-grounder.ts`、search/fetch、本地资源索引、source preview。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/service.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/render.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core-skills/src/injection.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs`。
- **interface / seam：** 扩展 Adapter 为统一 `GroundingSourceAdapter`，仍输出同一 `GroundingPack`。
- **验收：** 去重、freshness、digest、trust/use-for、引用失效和 safe URL 明确；失败转 resource gap；外部内容不隐式写 workspace。
- **测试命令：** `pnpm run check:search-runtime`；`pnpm run check:web-tools-baseline`；`pnpm run check:web-fetch-safe-url`；`node scripts/check-resource-grounder.mjs`。
- **风险与迁移：** 风险是演化成通用 RAG 平台；迁移只增加由真实教学场景驱动的 Adapter，向量库不进入默认路线。

### P1-9：TeachingWorkspaceInspector

- **StudiumX 落点：** teaching workspace lifecycle/catalog/placement/reconciliation；新只读 inspector。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder.rs`。
- **interface / seam：** `inspect(root): WorkspaceInspectionReport`，检查 canonical files、schema、dangling links、catalog drift、temp artifacts。
- **验收：** inspector 默认只读；问题有稳定 code/severity/path-safe evidence/repairability；不把 projection 当 canonical。
- **测试命令：** `node scripts/check-teaching-workspace-inspector.mjs`；`node scripts/check-workspace-catalog-reconciliation.mjs`。
- **风险与迁移：** 风险是 inspector 暗中修复；迁移将 inspect 与 repair command 分开，修复前展示计划并留审计。

### P1-10：结构化 Doctor 与恢复报告

- **StudiumX 落点：** recovery coordinator、catalog repair、settings/provider diagnostics、CLI/diagnostic UI。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/state_db.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/thread-store/src/store.rs`。
- **interface / seam：** `TeachingDoctor.run(): DoctorReport`；每项输出 check ID、result、safe evidence、recommended action；repair 是单独 effect。
- **验收：** 能诊断 P0 两个 crash window、配置不可用、source gap、catalog drift；报告可导出且脱敏；doctor 失败不阻塞只读打开 workspace。
- **测试命令：** `node scripts/check-teaching-doctor.mjs`；`pnpm run check:agent-run-recovery`。
- **风险与迁移：** 风险是“一键修复”破坏事实；迁移首版只读，自动修复限于确定性 projection rebuild。

### P1-11：Audit Correlation 与教学范围 Provider Privacy 加固

- **StudiumX 落点：** operation IDs、tool audit、provider request logging、support diagnostics。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs` 的 IDs/事件边界和 `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs` 的调用生命周期。
- **interface / seam：** `AuditCorrelation { sessionId, turnId, eventId?, operationId?, effectId? }`；日志仅存 safe metadata。
- **验收：** 一次教学 outcome 可追到 evidence/effect，而无需保存原始推理；provider payload、secret、完整学习者回答默认不进入日志；导出经过 redaction。
- **测试命令：** `pnpm run check:provider-privacy`；`pnpm run check:settings-secret-storage`；`node scripts/check-teaching-audit-correlation.mjs`。
- **风险与迁移：** 风险是可观测性成为隐私泄露面；迁移用 allowlist schema，旧自由文本日志不迁入新 audit store。

### P1-12：Teaching Composer Commands 与剩余无障碍加固

- **StudiumX 落点：** conversation composer、reader、keyboard/focus hooks、presentation tests。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/bottom_pane/chat_composer.rs`。
- **interface / seam：** 有限 `TeachingCommand` union，例如 continue/retry/show_source/end_session；命令不等于任意工具调用。
- **验收：** 键盘、屏幕阅读器、错误恢复和 reduced motion 可用；命令可发现；不会绕过 planner/effect policy；固定“轮到你”区域稳定。
- **测试命令：** teaching E2E；axe/a11y 测试；`node scripts/check-teaching-composer-a11y.mjs`。
- **风险与迁移：** 风险是斜杠命令扩张成通用 Agent 控制台；迁移只开放教学动作，技术命令保留在诊断模式。

### P1-13：TeachingTurnCoordinator 的生产接线与 Blocking CI

- **剩余落点：** 将现有 main-process coordinator 接入实际 IPC / App 调用链；新增 `.github/workflows/blocking-ci.yml`（或仓库采用的等价 required-check 配置）及 package scripts。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/codex_thread.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tasks/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/.github/workflows/blocking-ci.yml`。
- **接线边界：** coordinator 只编排既有深模块，不吸收其领域规则；renderer 不直接编排 writer/tool/provider。
- **验收：** 生产调用经受控 main-process 路径处理；取消/恢复/重复命令幂等；P0 golden、security、privacy、typecheck/build 成为 blocking CI；失败产物脱敏。
- **测试命令：** 生产接线 contract / integration 测试、最终基线全部命令，以及 CI workflow / required-check 验证。
- **风险与迁移：** 风险是 coordinator 变成 God object、CI 一次性全红；迁移只接入既有调用链，按可靠性分批设为 required，但 P0 golden 在发布前必须 blocking。

### P1 依赖与建议合并顺序

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

---

## 3. P2 Backlog：仅由真实规模或风险信号触发

P2 默认不排期。每个条目必须由可量化触发信号进入实施，例如：真实 workspace 恢复耗时、Session 数量、用户需要分支学习的比例、可信 Adapter 数、故障率或支持工单。不得因“Codex 有”而建设。

### P2-1：Learning Branch Projection

- **StudiumX 落点：** SessionLedger/Planner 的只读分支投影和 UI navigator；不改变 canonical outcome 历史。
- **Codex 参考：** conversation/thread 分支恢复思想参考 `ref_project/codex-rust-v0.144.4/codex-rs/core/src/codex_thread.rs`，不照搬 coding thread 模型。
- **interface / seam：** `LearningBranchProjector.project(sessionHistory): LearningBranchView`。
- **验收：** 能表达 remediation/alternative path；Learning record 只提交一次；切换分支不复制事实。
- **测试命令：** 新 branch projection unit/integration/E2E。
- **风险与迁移：** 复杂度过高；仅当线性 planner 无法满足已观察场景时启用，从投影开始，不先改文件格式。

### P2-2：长 Session Resume Picker

- **StudiumX 落点：** session list/resume UI、ledger query/read model。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/resume_picker.rs`。
- **interface / seam：** `ResumeCandidateQuery.list(filters): ResumeCandidate[]`。
- **验收：** 按教学目标、最近动作、needs-you/blocked 状态筛选；候选来自 durable ledger；键盘/a11y 完整。
- **测试命令：** resume query unit + Electron E2E。
- **风险与迁移：** 过早服务不存在的长历史；触发阈值建议为真实 workspace 中 Session 数和恢复失败工单达到团队设定门槛。

### P2-3：高级技术 Inspector

- **StudiumX 落点：** 诊断模式中的 typed events/effects/projection report viewer。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/tui/src/history_cell/mod.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/tui/src/status_indicator_widget.rs`；只借技术可见性，不展示 raw reasoning。
- **interface / seam：** 只读 `TechnicalInspectionView`，所有字段走 redaction schema。
- **验收：** 默认隐藏；可导出 safe report；任何 secret/raw prompt/reasoning 都不可见。
- **测试命令：** privacy/redaction checks + inspector E2E。
- **风险与迁移：** 形成第二主 UI；仅面向支持/开发，不能进入学习者默认导航。

### P2-4：保守的并行只读工具

- **StudiumX 落点：** typed tool dispatcher parallel scheduler。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/parallel.rs`。
- **interface / seam：** `ReadonlyToolBatch.execute`；只有声明 `effect=read` 且 resource locks 不冲突的调用可并行。
- **验收：** 输出顺序确定；取消传播；写 effect 永不并行；并发确有性能收益。
- **测试命令：** scheduler race/cancellation/idempotency tests。
- **风险与迁移：** nondeterminism；先有 profiling，再对 allowlist 工具启用，默认串行。

### P2-5：Watcher/Config 乐观并发

- **StudiumX 落点：** file watcher、config fingerprint、workspace writer precondition。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/config/src/fingerprint.rs`。
- **interface / seam：** `write(expectedFingerprint, next)` 返回 committed/conflict。
- **验收：** 外部编辑不会被静默覆盖；冲突有可恢复 UI；watcher 去抖且不生成重复事件。
- **测试命令：** concurrent edit integration tests、workspace recovery checks。
- **风险与迁移：** 假冲突与 watcher 风暴；只在观测到多人/外部编辑丢失后引入。

### P2-6：MCP（仅在存在真实教学 Adapter 时）

- **StudiumX 落点：** capability catalog、typed dispatcher 下的受限 Adapter；不是独立平台入口。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/protocol/src/protocol.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/registry.rs`；只借协议适配与 capability discovery 思路。
- **interface / seam：** `GroundingSourceAdapter` 或有限 `TeachingEffectAdapter`，必须返回现有 typed outcomes。
- **验收：** 至少一个真实教学场景、威胁模型、授权、超时、审计、隐私和离线降级完整；无任意工具透传。
- **测试命令：** Adapter contract/security/privacy tests + golden scenario 的可选变体。
- **风险与迁移：** 远程工具扩大攻击面；无真实 Adapter 和用户价值证据则永不实施。

### P2-7：Helper Isolation（仅执行不可信代码时）

- **StudiumX 落点：** 独立 helper process/OS boundary，不放进普通 teaching turn。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/core/src/tools/lifecycle.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/core/src/spawn.rs`；不直接照搬 Codex sandbox。
- **interface / seam：** `UntrustedExecutionService`，输入输出最小化且 capability-deny-by-default。
- **验收：** threat model、资源限制、文件/网络 allowlist、kill/recovery/audit 完整；普通 Lesson/grounding 不经过 helper。
- **测试命令：** platform-specific security tests 和 abuse cases。
- **风险与迁移：** 跨平台维护成本极高；只有产品明确需要运行不可信学习代码时立项。

### P2-8：脱敏 Support Bundle

- **StudiumX 落点：** doctor、inspector、audit reports 的导出层。
- **Codex 参考：** `ref_project/codex-rust-v0.144.4/codex-rs/cli/src/doctor.rs`、`ref_project/codex-rust-v0.144.4/codex-rs/rollout/src/recorder.rs`；不复制原始会话。
- **interface / seam：** `SupportBundleBuilder.build(policy): BundleManifest`，每个文件有来源与 redaction result。
- **验收：** 默认不含原始回答、prompt、provider payload、secret、完整绝对路径；用户预览并明确同意后导出。
- **测试命令：** snapshot/redaction/privacy/adversarial fixture tests。
- **风险与迁移：** 高价值隐私聚合；先提供本地 doctor report，只有支持流程证明需要时增加 bundle。

---

## 4. P0 发布完成声明（Win/Mac，已关闭）

历史最小证明清单已由 [ADR-0017](../adr/0017-win-mac-p0-release-proof-and-audit-policy.md) 关闭。摘要：

1. runtime committer / recovery / read-repair gates 绿。
2. 全量 unit/integration 在目标平台可解释；未解释 skip 失败；Win32 预算精确、Linux 预算为空。
3. longitudinal + crash-recovery Electron Golden 各 `--repeat-each=3` 绿。
4. clean-checkout `node scripts/release-audit.mjs` 机外证据 `passed: true`。

**当前准确表述：** P0 领域模块已实施；Win/Mac 发布级自动化、真实 Electron crash/restart Golden 与干净 checkout 审计已证明完成（ADR-0017）。Linux 产品船与完整 C-4 writer migration 不在该声明内。

