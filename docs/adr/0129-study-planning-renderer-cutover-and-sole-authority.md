# ADR-0129：Study planning renderer cutover 与 sole-authority 沉淀

- **状态：** 已实施（架构沉淀；记录 **已落地** 的 renderer dual-write / sole-read 与 TimerSession 权威切分；**不**宣称路线图 §18 产品完成）
- **日期：** 2026-07-22
- **范围：** 学习规划 / 任务 / ScheduleBlock / TimerPlan / TimerSession / categories 在 **renderer cutover** 阶段的读写权威、dual-write 模式、sole-read hydrate、迁移 fail-closed、localStorage 降级为可重建缓存、segment-close analytics 与 live focus counters 的 TimerSession 权威，以及 OS sleep 钩子的 **renderer 边界**（visibility / pagehide）与 **main powerMonitor OS 信号桥**（channel 已落地；unit recovery matrix 已补；完整 sleep/crash **e2e** 矩阵 residual 仍开）。
- **相关：**
  - Phase 0 产品与架构冻结：[ADR-0094](0094-study-task-timer-planning-design-gate.md)
  - Canonical 路径 / wire / Store 合同：[ADR-0117](0117-study-planning-store-paths-and-wire.md)
  - 关键 JSON 备份精神：[ADR-0003](0003-critical-json-backups-and-verified-recovery.md)
  - sole-writer / revision 精神：[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)
  - TimerSession 命名消歧：[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)
  - 模块尺寸：[ADR-0075](0075-module-size-policy-and-giant-peel.md)
  - 规划全文：[`docs/study-task-timer-planning-roadmap.md`](../study-task-timer-planning-roadmap.md)
- **证据提交：** 本 ADR + 已合并的 shared pure / main durable / renderer dual-write·hydrate 与对应 unit 测试；**不**附带本切片新功能实现

## 背景

[ADR-0094](0094-study-task-timer-planning-design-gate.md) 冻结了六层模型与十项产品决策；[ADR-0117](0117-study-planning-store-paths-and-wire.md) 冻结了 `.studiumx/study-planning/snapshot.json` 路径、wire v1、`StudyPlanningStore` 命令信封与 V1→V2 迁移原则。随后工程分阶段落地：

1. **Phase 1–7 shared pure + 内存 Store + durable host + product IPC**（main sole-writer）；
2. **Renderer cutover**：在保留 V1 `StudySnapshot` UI shell 的同时，把清单 / 排程 / 方案 / 计时 / 类别等 **写** 经 dual-write 推入 canonical，**读** 在 canonical 有数据时 sole-read hydrate。

在未沉淀本 ADR 前，这些 cutover 决策分散在路线图 §22.4 changelog 与 `docs/_agent-work/reports/study-planning-cutover-*.md` 中。本 ADR 把 **已落地且重要** 的权威切分写成可审计架构决定，避免后续 PR 误把 dual-write 当成「双权威」、或误宣称 §18 完成 / 路径再冻结。

### 当前代码锚点（只读事实）

| 层 | 锚点 | 角色 |
| --- | --- | --- |
| Canonical 路径 / wire | `src/shared/study-planning/snapshot-wire.ts`（`STUDY_PLANNING_DIR_SEGMENTS` / `snapshot.json`） | ADR-0117 布局；本 ADR **不**改路径 |
| Durable sole-writer | `src/main/study-planning-durable-store.ts` | trial → persist → commit；IO fail-closed |
| IPC 薄客户端 | `src/renderer/src/study-space/planning-client.ts` | 缺 workspace/API 时结构化错误，不静默发明权威 |
| Dual-write 族 | `planning-dual-write.ts`、`planning-*-dual-write.ts` | 乐观 UI + CAS 发布 canonical |
| Sole-read hydrate | `planning-hydrate.ts` | canonical 有任务时替换 UI 清单等投影 |
| 迁移 | `planning-migration.ts` + `import-migration-commit.ts` | dry-run → 用户确认 → commit；**不**自动擦除 localStorage |
| TimerSession 时钟 | `planning-timer-dual-write.ts`、`planning-timer-display.ts` | 转换 dual-write；本地 TimerSession 为 focus UI 时钟 |
| Analytics / counters | `planning-timer-session-analytics.ts`、`planning-timer-session-focus-counters.ts` | segment-close fact + live focus 秒以 TimerSession 为权威 |
| Sleep / wake | `planning-timer-sleep-hooks.ts` + `planning-timer-os-power.ts` + `useStudySession` visibility/pagehide + OS bridge | renderer 钩子 + main `powerMonitor` **信号 fan-out**（`teach:system-power`）；pin 仍 renderer dual-write |
| V1 缓存 key | `constants.ts` `studiumx:study-space:v1`；`taskCategories.ts` `studiumx:study-task-categories:v1` | 可重建 co-cache，非长期任务权威 |

## 决定

### 1. Dual-write + sole-read hydrate（读写不对称）

**写路径（dual-write）：**

- 当 `workspaceRoot` + `TeachingSystemApi`（`readStudyPlanning` / `applyStudyPlanning`）可用时，产品路径对 tasks / schedule blocks / timer plans / timer sessions / categories / preferences 的变更 **必须** 经 dual-write 调用 `StudyPlanningStore.applyCommand`（CAS + `actionId`），与 V1 `StudySnapshot` 乐观更新并行。
- Canonical 成功时以 workspace `snapshot.json` 为权威；canonical 跳过（缺 workspace / API）或失败时 **不得** 把 localStorage 升格为教学或规划长期真相源——仅保留 UI 可用性。
- 故意 **不** 对每 tick `advance` 做 dual-write（避免磁盘 thrash）；elapsed 由 pause/finish 与按需 pin 从 `lastSampleWallMs` 结算。

**读路径（sole-read hydrate）：**

| 条件 | 行为 |
| --- | --- |
| 缺 workspace / API / IO 失败 | 保留 V1 缓存（fail-closed；不静默发明行） |
| Canonical 空且 V1 有任务 | 保留 V1；`migrationSuggested`（引导 dry-run + 确认迁移） |
| Canonical 有任务 | **替换** UI tasks 为投影的 `PlanningTask`（sole-read） |
| Canonical `timerPlans` / `preferences` / `categories` / `timerSessions` / `scheduleBlocks` 有值 | 对应字段 sole-read 投影；缺省则保留 host V1 缓存 |

覆盖面（已落地 peel 模块，非 exhaustive API 列表）：

- **Tasks：** create / complete / reopen / update / delete（soft-cancel）/ remove-done bulk / assistant-import
- **ScheduleBlock：** V1 单 schedule upsert + multi-block create/delete（STC-307）
- **TimerPlan：** save / copy / rename / set-default / delete
- **TimerSession：** start / pause / resume / finish / pin advance / reconcile（无 per-tick 写盘）
- **Categories：** `set_categories` dual-write + hydrate sole-read
- **Preferences：** emptyStartPolicy、classificationPromptOptOut、simulation window、defaultTimerPlanId

**论证：** 渐进 cutover 允许 V1 UI shell 继续服务 presence / 过渡交互，同时把持久权威收敛到 ADR-0117 文件，而不把 renderer 写成第二 sole-writer。

### 2. TimerSession 为 segment-close analytics 与 live focus counters 权威

在 dual-write 时钟落地后，并行 V1 `ActiveStudySession` / `StudySessionLifecycle`  twin 曾继续：

1. 在 segment close 发射 `study_session` analytics fact；
2. 在 tick 上推进 `todayFocusSeconds` / `totalFocusSeconds` / streak。

这会造成 **双时钟** 与可能的双重 fact 或秒数分歧。已落地 demotion：

| 事实类 | 权威 | 实现锚点 |
| --- | --- | --- |
| Focus / break **显示时钟**（remaining / elapsed） | 本地 + durable **TimerSession** | `planning-timer-display` / dual-write transitions |
| **Segment-close** `StudySessionFact` | **TimerSession** 投影（fact id = session.id 便于 ledger 去重） | `planning-timer-session-analytics.ts`；V1 twin 可 `discardActiveSessionWithoutAnalytics` |
| **Live** focus 秒 / streak | **TimerSession** `accumulatedFocusSeconds` 增量 | `planning-timer-session-focus-counters.ts`；strip V1 twin 的 focus mutation |
| Presence / notification / task-activity intents | 仍可经 V1 lifecycle **过滤后** 发出（非 study_session 专注 fact） | filter V1 `study_session` intents when TimerSession present |
| 教学 LearningSession / settlement | **永不** 由 TimerSession 或 study-space analytics 替代 | ADR-0008 / ADR-0023 |

**非权威说明：** `StudySnapshot` 上的 presence shell 计数仍可读，但在 TimerSession 存在时其 focus 秒 **来源** 为 TimerSession 增量，不是 V1 reliable-timer twin。本地 analytics ledger 可重建，**不是** 远程 telemetry。

### 3. 迁移 fail-closed；禁止自动擦除 localStorage

对齐 ADR-0117 §4，产品路径冻结为：

1. **Dry-run 强制：** `migrateStudyV1ToPlanning` 纯函数；不写盘、不改 localStorage。
2. **用户确认后 commit：** `import_migration_commit` 要求 `userConfirmed: true`；dry-run  alone never commits。
3. **Durable fail-closed：** `DurableStudyPlanningStore.applyCommand` 顺序为 trial on clone → persist → commit memory；任何 IO/校验失败 → 返回 `io_failed`，**内存与磁盘均不半提交**；迁移 sidecar 失败同样不 commit。
4. **无自动擦除：** commit 成功后 **不得** 自动 `localStorage.removeItem` 权威 key（`studiumx:study-space:v1`、`studiumx:study-task-categories:v1`）。擦除仅允许：用户显式确认，或产品策略 **≥30 天** 备份窗口后的后续 UX（本 ADR 不实现擦除 UI）。
5. **Banner UX：** hydrate `kept_v1` + `migrationSuggested` 经 MigrationBannerSheet 确认；禁止静默 migrate。

### 4. OS sleep / exit：renderer visibility / pagehide + main powerMonitor 信号桥

STC-206 产品路径 **已** 在 renderer 落地：

- `visibilitychange` → `visibility_resume` 再采样 wall clock（应对 throttle / 系统睡眠后 tab 恢复）；
- `pagehide` → best-effort durable pin（advance dual-write），**永不** 静默 finish / 计入专注；
- 冷启动 reattach 打开中的 `running` / `paused` / `needs_reconcile`；长间隙（默认 120 min，冻结 #5）→ `needs_reconcile` + ReconcileSheet。

**已落地（OS 信号桥，非第二时钟权威）：**

- main `powerMonitor` `suspend` / `resume` → `teachingEventChannels.systemPower`（`teach:system-power`）广播到所有存活窗口；
- 载荷 `{ kind: 'suspend' | 'resume', atMs }`；preload `onSystemPower`；renderer `planning-timer-os-power` 映射为既有 wake（suspend→pagehide-like pin，resume→visibility_resume-like）；
- **禁止** main 写 `DurableStudyPlanningStore` / 成为 TimerSession sole-writer；pin 仍走 renderer dual-write + `expectedRevision` CAS（ADR-0117）；
- 长间隙仍 `needs_reconcile` + ReconcileSheet，**禁止**静默 focus credit（ADR-0094 #5）。

**仍延期 / residual：** before-quit 强制 durable pin；完整 sleep/**crash**/多窗并发 **e2e** 矩阵证据；kill -9 仍依赖冷启动 reattach + reconcile。**Unit recovery matrix** 已补（`tests/unit/study-planning-timer-recovery-matrix.unit.test.ts`：power map、double-resume 幂等、≥120min needs_reconcile、cold reattach fail-closed、CAS dual-pin `revision_conflict`）——improved partial，**不得**因 unit 矩阵宣称 §18 bullet 8 全关。

### 5. 仍为 V1 rebuildable cache 的内容（诚实边界）

下列 **不是** 长期规划权威，可在丢失后从 canonical 或用户数据重建 / 重导：

| 项 | 说明 |
| --- | --- |
| `studiumx:study-space:v1` | V1 `StudySnapshot` UI shell / presence host / 迁移源；canonical 有数据时 tasks 等 sole-read 覆盖 |
| `studiumx:study-task-categories:v1` | 类别 co-cache；`snapshot.categories` sole-read 优先 |
| V1 单 `task.schedule` 镜像 | multi-block 下仅 primary-block 投影缓存，非 ScheduleBlock 全集权威 |
| V1 lifecycle twin | pause/resume 采样与部分 presence/notification 意图宿主；**非** study_session fact / live focus 秒权威 |
| 本地 analytics ledger / day segments 单桶重建 | 可重建；非远程 telemetry；TimerSession 不存 pause interval 细节 |
| `migration-report-latest.json` / `localAnalyticsHints` | 可重建旁路；非任务权威 |
| UI 草稿与瞬时状态 | empty-start 对话态、sheet 开合等 |

**仍是权威的：** 工作区 `.studiumx/study-planning/snapshot.json`（及 verified `.bak` 仅在 canonical 不可读时的恢复路径，见 ADR-0003 / ADR-0117）。

## 后果

### 正面

- 规划持久权威与教学 LearningSession settlement **正交**，且 renderer 不得直接写 `snapshot.json`。
- Cutover 可渐进：UI 巨石（`useStudySession` 等）按触达 peel dual-write / pure 模块，符合 ADR-0075。
- Analytics 与 live counters 与 durable 时钟对齐，降低双 fact / 双秒数风险。
- 迁移与 IO 失败不毁源数据；localStorage 保留作回滚与迁移源。

### 约束 / 成本

- 在 dual-write 窗口内，V1 与 canonical 短暂分歧可能出现（revision conflict、skip）；产品须 CAS retry / 乐观 UI 诚实，**不得** 静默以 V1 覆盖 canonical。
- Presence 仍读 shell counters：须保证 TimerSession 增量 credit 已接，否则徽章偏差。
- main `powerMonitor` 已接信号桥，但仍是 best-effort：renderer 冻结 / 无窗口时仍依赖冷启动 reattach + reconcile；**不**保证 crash-proof pin。Unit recovery matrix 覆盖 pure 路径与 store CAS 双写 thrash，**不**替代 e2e kill-9。
- 未完成自动擦除 UX：磁盘上可能长期并存 V1 key 与 snapshot（有意，非泄漏教学权威）。

## 明确不包含 / non-claims

本 ADR **不**：

1. **宣称路线图 §18 全部产品完成定义已满足**（STC-702..704 等与完整并发/sole-UI 清单仍以路线图诚实状态为准）；
2. **冻结或修改** ADR-0117 已定路径、`schemaVersion`、命令信封或错误码以外的 **新** canonical 路径 / wire 字段（schema bump 须新 ADR 或修订 0117）；
3. 授权 YOLO / 默认 shell / MCP marketplace / 默认远程 telemetry / 产品 FTS·向量搜索；
4. 改写 `TeachingTurnCoordinator`、LearningSession ledger、outcome settlement 或 `toolsReplayed:false`；
5. 实现 localStorage 自动擦除 UI、或把 V1 完全删除；（main `powerMonitor` **信号桥** 已落地，见 §4；unit recovery matrix 已补；e2e 完整矩阵仍开）
6. 把 SQLite / agent run 提升为规划或教学权威；
7. 把 ephemeral `docs/_agent-work/*` 当作长期 sole authority（长期权威为本 ADR + ADR-0094 + ADR-0117 + 路线图产品节）。

## 后续工作约束

1. 新的 renderer 写路径必须 dual-write（或在确认 cutover 完成后改为 pure canonical 写 + sole-read），**禁止** 仅写 localStorage 后靠 hydrate 偶然覆盖的「假 sole-authority」。
2. 新的 analytics 关闭路径必须以 **TimerSession** 为 segment-close 源；不得重新启用 V1 twin 为并行 fact 权威。
3. 触及 durable / IPC / 迁移时叠加 `check:security`、`check:teaching-ipc-contract`、相关 unit（`tests/unit/study-planning-*.unit.test.*`）。
4. 若落地 localStorage 擦除或扩展 power 面（lock-screen / before-quit durable 保证）：独立 PR，更新本 ADR 后果节或另立短 ADR；不得静默放宽 fail-closed / 120 min reconcile。
5. 模块继续 peel；禁止为「一次对齐」同时胀大 `useStudySession` / `WorkbenchPomodoro` / `StudyTaskSchedulePage`。

---

**一句话：** Renderer cutover 以 **dual-write 写 canonical、sole-read hydrate 读** 收敛权威；**TimerSession** 独占 segment-close analytics 与 live focus 秒；迁移 fail-closed 且 **永不自动擦除** localStorage；sleep 钩子含 **visibility/pagehide + main powerMonitor 信号桥**（pin 仍 renderer）+ **unit recovery matrix**（pure + CAS）；完整 sleep/crash **e2e** 矩阵 residual 仍开——且 **不** 宣称 §18 完成，**不** 超出 ADR-0117 再冻新路径。