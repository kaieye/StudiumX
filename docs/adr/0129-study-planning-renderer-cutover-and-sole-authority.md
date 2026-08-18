# ADR-0129：Study planning renderer cutover 与 sole-authority 沉淀

- **决策状态：** accepted
- **实施状态：** partial
- **日期：** 2026-07-22
- **范围：** 学习规划 / 任务 / ScheduleBlock / TimerPlan / TimerSession / categories 在 **renderer cutover** 阶段的读写权威、dual-write 模式、sole-read hydrate、迁移 fail-closed、localStorage 降级为可重建缓存、segment-close analytics 与 live focus counters 的 TimerSession 权威，以及 OS sleep 钩子的 renderer 边界（visibility / pagehide）与 main powerMonitor OS 信号桥。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0094](0094-study-task-timer-planning-design-gate.md)、[ADR-0117](0117-study-planning-store-paths-and-wire.md)、[ADR-0130](0130-study-planning-phase7-and-completion-residual.md)、[ADR-0003](0003-critical-json-backups-and-verified-recovery.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)
- **证据：** `src/main/study-planning-durable-store.ts`、`src/renderer/src/study-space/planning-client.ts`、`planning-hydrate.ts`、`planning-timer-session-analytics.ts`、`planning-timer-sleep-hooks.ts`、`planning-timer-os-power.ts`；测试 `tests/unit/study-planning-timer-recovery-matrix.unit.test.ts`、`tests/e2e/study-planning-timer-thrash*.e2e.spec.ts`；代码锚点 / 测试矩阵全表见 `docs/adr/evidence/ADR-0129.md`。

## 背景

[ADR-0094](0094-study-task-timer-planning-design-gate.md) 冻结六层模型与十项产品决策；[ADR-0117](0117-study-planning-store-paths-and-wire.md) 冻结 `.studiumx/study-planning/snapshot.json` 路径、wire v1、`StudyPlanningStore` 命令信封与 V1→V2 迁移原则。随后工程分阶段落地：Phase 1–7 shared pure + 内存 Store + durable host + product IPC（main sole-writer），然后 **renderer cutover**：保留 V1 `StudySnapshot` UI shell 的同时，把清单 / 排程 / 方案 / 计时 / 类别等 **写** 经 dual-write 推入 canonical，**读** 在 canonical 有数据时 sole-read hydrate。本 ADR 把**已落地且重要**的权威切分写成可审计架构决定，避免后续 PR 把 dual-write 误当「双权威」或误宣称 §18 完成。

## 决定

### 1. Dual-write + sole-read hydrate（读写不对称）

**写路径（dual-write）：** 当 `workspaceRoot` + `TeachingSystemApi`（`readStudyPlanning` / `applyStudyPlanning`）可用时，产品路径对 tasks / schedule blocks / timer plans / timer sessions / categories / preferences 的变更**必须**经 dual-write 调用 `StudyPlanningStore.applyCommand`（CAS + `actionId`），与 V1 `StudySnapshot` 乐观更新并行。Canonical 成功时以 workspace `snapshot.json` 为权威；canonical 跳过（缺 workspace / API）或失败时**不得**把 localStorage 升格为教学或规划长期真相源——仅保留 UI 可用性。**不**对每 tick `advance` 做 dual-write（避免磁盘 thrash）；elapsed 由 pause/finish 与按需 pin 从 `lastSampleWallMs` 结算。

**读路径（sole-read hydrate）：**

| 条件 | 行为 |
| --- | --- |
| 缺 workspace / API / IO 失败 | 保留 V1 缓存（fail-closed；不静默发明行） |
| Canonical 空且 V1 有任务 | 保留 V1；`migrationSuggested`（引导 dry-run + 确认迁移） |
| Canonical 有任务 | **替换** UI tasks 为投影的 `PlanningTask`（sole-read） |
| Canonical `timerPlans` / `preferences` / `categories` / `timerSessions` / `scheduleBlocks` 有值 | 对应字段 sole-read 投影；缺省则保留 host V1 缓存 |

覆盖面（已落地 peel 模块）：Tasks（create/complete/reopen/update/delete(soft-cancel)/remove-done bulk/assistant-import）；ScheduleBlock（V1 单 schedule upsert + multi-block create/delete）；TimerPlan（save/copy/rename/set-default/delete）；TimerSession（start/pause/resume/finish/pin advance/reconcile，无 per-tick 写盘）；Categories（`set_categories` dual-write + hydrate sole-read）；Preferences（emptyStartPolicy、classificationPromptOptOut、simulation window、defaultTimerPlanId）。

**论证：** 渐进 cutover 允许 V1 UI shell 继续服务 presence / 过渡交互，同时把持久权威收敛到 ADR-0117 文件，而不把 renderer 写成第二 sole-writer。

### 2. TimerSession 为 segment-close analytics 与 live focus counters 权威

已落地 demotion：并行 V1 `ActiveStudySession` / `StudySessionLifecycle` twin 不再作为 focus 事实权威。

| 事实类 | 权威 | 实现锚点 |
| --- | --- | --- |
| Focus / break **显示时钟**（remaining / elapsed） | 本地 + durable **TimerSession** | `planning-timer-display` / dual-write transitions |
| **Segment-close** `StudySessionFact` | **TimerSession** 投影（fact id = session.id 便于 ledger 去重） | `planning-timer-session-analytics.ts` |
| **Live** focus 秒 / streak | **TimerSession** `accumulatedFocusSeconds` 增量 | `planning-timer-session-focus-counters.ts` |
| Presence / notification / task-activity intents | 可经 V1 lifecycle **过滤后** 发出（非 study_session 专注 fact） | filter V1 `study_session` intents |
| 教学 LearningSession / settlement | **永不**由 TimerSession 或 study-space analytics 替代 | ADR-0008 / ADR-0023 |

**非权威说明：** `StudySnapshot` presence shell 计数仍可读，但 TimerSession 存在时其 focus 秒**来源**为 TimerSession 增量；本地 analytics ledger 可重建，**不是**远程 telemetry。

### 3. 迁移 fail-closed；禁止自动擦除 localStorage

1. **Dry-run 强制：** `migrateStudyV1ToPlanning` 纯函数；不写盘、不改 localStorage。
2. **用户确认后 commit：** `import_migration_commit` 要求 `userConfirmed: true`；dry-run alone never commits。
3. **Durable fail-closed：** `DurableStudyPlanningStore.applyCommand` 顺序为 trial on clone → persist → commit memory；任何 IO/校验失败 → `io_failed`，**内存与磁盘均不半提交**。
4. **无自动擦除：** commit 成功后**不得**自动 `localStorage.removeItem` 权威 key；擦除仅允许用户显式确认或 ≥30 天备份窗口后的后续 UX（本 ADR 不实现擦除 UI）。
5. **Banner UX：** hydrate `kept_v1` + `migrationSuggested` 经 MigrationBannerSheet 确认；禁止静默 migrate。

### 4. OS sleep / exit：renderer visibility / pagehide + main powerMonitor 信号桥

- `visibilitychange` → `visibility_resume` 再采样 wall clock（应对 throttle / 系统睡眠后 tab 恢复）；`pagehide` → best-effort durable pin（advance dual-write），**永不**静默 finish / 计入专注；冷启动 reattach 打开中的 `running` / `paused` / `needs_reconcile`；长间隙（默认 120 min）→ `needs_reconcile` + ReconcileSheet。
- main `powerMonitor` `suspend` / `resume` → `teachingEventChannels.systemPower`（`teach:system-power`）广播到所有存活窗口；载荷 `{ kind: 'suspend' | 'resume', atMs }`；preload `onSystemPower`；renderer `planning-timer-os-power` 映射为既有 wake。
- **禁止** main 写 `DurableStudyPlanningStore` / 成为 TimerSession sole-writer；pin 仍走 renderer dual-write + `expectedRevision` CAS。
- **仍延期 / residual：** before-quit 强制 durable pin；完整 sleep/**crash**/多窗并发 **e2e** 矩阵证据；kill -9 仍依赖冷启动 reattach + reconcile。**Unit recovery matrix** 已补（`tests/unit/study-planning-timer-recovery-matrix.unit.test.ts`），但**不得**因 unit 矩阵宣称 §18 bullet 8 全关。

### 5. 仍为 V1 rebuildable cache 的内容（诚实边界）

| 项 | 说明 |
| --- | --- |
| `studiumx:study-space:v1` / `studiumx:study-task-categories:v1` | V1 UI shell / presence host / 迁移源 / 类别 co-cache；canonical 有数据时 sole-read 覆盖 |
| V1 单 `task.schedule` 镜像 | multi-block 下仅 primary-block 投影缓存，非 ScheduleBlock 全集权威 |
| V1 lifecycle twin | 非 study_session fact / live focus 秒权威 |
| 本地 analytics ledger / day segments 单桶重建 | 可重建；非远程 telemetry |
| `migration-report-latest.json` / `localAnalyticsHints` | 可重建旁路；非任务权威 |

**仍是权威的：** 工作区 `.studiumx/study-planning/snapshot.json`（及 verified `.bak` 仅 canonical 不可读时的恢复路径，ADR-0003 / ADR-0117）。

## 不变量（ADR-0129 专用）

- Renderer 不得直接写 `snapshot.json`；新写路径必须 dual-write（或 cutover 完成后 pure canonical 写 + sole-read），禁止「仅写 localStorage 后靠 hydrate 偶然覆盖」的假 sole-authority。
- TimerSession 是 segment-close analytics 与 live focus 秒的唯一事实权威；不得重新启用 V1 twin 为并行 fact 权威。
- 迁移永不自动擦除 localStorage；main powerMonitor 信号桥不是第二时钟权威，pin 仍 renderer + `expectedRevision` CAS。
- `expectedRevision`、fork `toolsReplayed:false`、settlement sole-writer、LearningSession ledger 权威不变。

## 后果

- 规划持久权威与教学 LearningSession settlement **正交**；cutover 可渐进，UI 巨石按触达 peel（ADR-0075）。
- Analytics 与 live counters 与 durable 时钟对齐，降低双 fact / 双秒数风险；迁移与 IO 失败不毁源数据。
- 约束：dual-write 窗口内 V1 与 canonical 可能短暂分歧，须 CAS retry / 乐观 UI 诚实，**不得**静默以 V1 覆盖 canonical；power 信号桥是 best-effort，**不**保证 crash-proof pin；未完成自动擦除 UX（磁盘上可能长期并存 V1 key 与 snapshot，有意）。

## 验证

- 触及 durable / IPC / 迁移：`pnpm run check:security`、`pnpm run check:teaching-ipc-contract`、相关 unit（`tests/unit/study-planning-*.unit.test.*`）。
- 代码锚点与测试矩阵全表见 `docs/adr/evidence/ADR-0129.md`。

## 非目标

本 ADR **不**：

1. **宣称路线图 §18 全部产品完成定义已满足**（§18 诚实状态以 [ADR-0130](0130-study-planning-phase7-and-completion-residual.md) 为准）；
2. **冻结或修改** ADR-0117 已定路径、`schemaVersion`、命令信封或错误码以外的**新** canonical 路径 / wire 字段（schema bump 须新 ADR 或修订 0117）；
3. 授权 YOLO / 默认 shell / MCP marketplace / 默认远程 telemetry / 产品 FTS·向量搜索；
4. 改写 `TeachingTurnCoordinator`、LearningSession ledger、outcome settlement 或 `toolsReplayed:false`；
5. 实现 localStorage 自动擦除 UI，或把 V1 完全删除；
6. 把 SQLite / agent run 提升为规划或教学权威；
7. 把 ephemeral `docs/_agent-work/*` 当作长期 sole authority（长期权威为 0094 + 0117 + 0129 + 0130）。
