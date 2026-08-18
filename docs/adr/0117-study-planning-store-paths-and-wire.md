# ADR-0117：StudyPlanningStore 路径、wire schema 与 V1→V2 迁移落地冻结

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** 学习规划 / 任务 / ScheduleBlock / TimerPlan / TimerSession 事实的 **canonical 路径布局、备份文件名、wire schema 版本、StudyPlanningStore 命令信封、错误码、V1→V2 迁移与 localStorage 擦除策略**。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0094](0094-study-task-timer-planning-design-gate.md)、[ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)、[ADR-0130](0130-study-planning-phase7-and-completion-residual.md)、[ADR-0003](0003-critical-json-backups-and-verified-recovery.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)
- **证据：** `src/shared/study-planning/snapshot-wire.ts`（`STUDY_PLANNING_DIR_SEGMENTS` / `snapshot.json`）、`src/main/study-planning-durable-store.ts`、`src/renderer/src/study-space/planning-client.ts`；测试 `tests/unit/study-planning-*.unit.test.*`；renderer cutover 落地见 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)。

## 背景

[ADR-0094](0094-study-task-timer-planning-design-gate.md) 已冻结原则（教学决策事实的文件真相源、StudyPlanningStore、expectedRevision + action id、dry-run 迁移、备份 ≥30 天或用户确认擦除），但**明确不冻结**具体路径、wire schema 版本号与备份文件名。Phase 1 纯函数切片已落地于 `src/shared/study-planning/`；本 ADR 关闭该实现门，使 Phase 2+ 可立项 `StudyPlanningStore` 与迁移，而不重开 Phase 0 产品十项冻结。

## 决定

### 1. Canonical 路径布局（工作区相对）

根目录固定为工作区下 `.studiumx/study-planning/`：

| 相对路径 | 内容 | 说明 |
| --- | --- | --- |
| `snapshot.json` | 当前权威快照（见 §2 wire） | sole-writer 唯一正式读/写入口产物 |
| `snapshot.json.bak` | 最近一次成功 durable publish 前的 verified 备份 | ADR-0003 精神；可读 canonical 不被静默用 `.bak` 覆盖 |
| `backups/snapshot-YYYYMMDDTHHMMSSZ.json` | 迁移 / 手动导出 / 重大 schema 升级前的时间戳备份 | 建议保留 ≥ **30 天**或直至用户确认擦除（产品冻结 #10） |
| `migration-report-latest.json` | 最近一次 V1→V2（或 schema bump）迁移报告 | 可重建；非任务权威 |
| `tmp/` | 写入中转（atomic rename 源） | 不得被 UI 当作权威读取 |

论证：与 workspace 约定 `.studiumx/` 一致；规划数据与教学 LearningSession ledger **物理分离**，降低误写教学 settlement 的 blast radius；`userData` 全局副本**不**作为多 workspace 权威（只读 export 须另 ADR）。**禁止**将 `localStorage` key `studiumx:study-space:v1` / `studiumx:study-task-categories:v1` 继续当作长期任务/排程权威；迁移完成后仅允许 UI 草稿/偏好类 key。

### 2. Wire schema

| 字段 | 冻结值 |
| --- | --- |
| 顶层 `schema` | 字面量 `"studiumx.study-planning"` |
| 顶层 `schemaVersion` | 整数 **`1`**（本 ADR 首发）；不兼容变更必须 +1 并写迁移 |
| 时间字段 | 权威为 epoch **ms**（`startAtMs` / `endAtMs` / `dueAtMs` / `createdAtMs` 等），与 Phase 1 纯模型一致 |
| 修订 | 顶层 `revision: number`（≥1，单调）；实体可有 `revision` 供诊断，CAS 以顶层为准 |
| 标识 | 字符串 id；TimerSession **永不**裸称 `session` 字段指计时 |

`snapshot.json` 顶层形状（v1，实现可加 optional，不得删 required）：

```ts
type StudyPlanningSnapshotV1 = {
  schema: 'studiumx.study-planning'
  schemaVersion: 1
  revision: number
  updatedAtMs: number
  tasks: PlanningTask[]
  scheduleBlocks: ScheduleBlock[]
  timerPlans: TimerPlanV2[]
  timerSessions: TimerSessionRecord[] // At most one running personal TimerSession
  preferences?: StudyPlanningPreferencesV1
  localAnalyticsHints?: Record<string, unknown> // Rebuildable; not remote telemetry
}
```

`TimerSessionRecord` 字段 Phase 2 实现时扩展，但必须含：`id`、`status`（含 `needs_reconcile`）、`clockMode`、`planSnapshot`、`taskId | null`、`startedAtMs`、累计专注/休息分项、`actionId` 幂等键引用。序列化：UTF-8 JSON，stable key order **不**强制；写入经 durable replace（temp → 服从 `durable-file` 原语）→ rename → 更新 `.bak`。

### 3. StudyPlanningStore 合同

| 方法 | 语义 |
| --- | --- |
| `readSnapshot(): Promise<StudyPlanningSnapshotV1>` | 只读；verified recovery 可读 `.bak` 仅当 canonical 不可用 |
| `applyCommand(command, expectedRevision): Promise<ApplyResult>` | 唯一写入口；CAS 失败不部分提交 |

命令信封（v1）：`{ actionId, operationId?, type, payload, clientIssuedAtMs? }`；`ApplyResult = { ok: true; revision; snapshot; effects } | { ok: false; error; revision }`。

命令闭集（可增不可偷换语义；`apply_allocation_proposal` **已于 2026-07-22 随 allocation 产品路径移除**）：`create_task` · `update_task` · `complete_task` · `save_timer_plan` · `start_timer_session` · `pause_timer_session` · `resume_timer_session` · `finish_timer_session` · `switch_session_task` · `reconcile_stale_session` · `quick_start` · `set_preferences` · `import_migration_commit`（仅迁移确认后）。

错误码（稳定字符串）：`revision_conflict`（expectedRevision 不匹配）· `duplicate_action`（同 actionId exact retry → 返回首次成功，不重复创建）· `invalid_command` · `invariant_violation`（如第二 running TimerSession、locked 重叠写入）· `not_found` · `migration_required` · `io_failed`（磁盘错误，fail-closed 不半写）。

**effects**（给 UI/IPC 的旁路信号，非第二权威）：如 `timer_session_started`、`classification_prompt_suggested`、`reconcile_required`、`future_blocks_need_decision`。

### 4. V1 → V2 迁移

1. **Dry-run 强制：** 纯函数 `migrateStudyV1ToPlanning`（已存在）生成 `MigrateStudyV1Result` + 报告；**不写盘**。
2. **真迁移 fail-closed：** 任一步 IO/校验失败 → 保留 V1 localStorage 与未写坏的 canonical；不删除源。
3. **步骤顺序：** 读 V1 keys → dry-run 报告展示用户 → 写 `backups/snapshot-…`（若已有 v2）与/或导出 V1 JSON → `import_migration_commit` 经 store 写 `snapshot.json` → 仅在用户确认或 ≥30 天策略后，才允许擦除 localStorage 权威 keys（偏好 key 可保留）。
4. **映射规则（冻结）：** 任务保留 `id` / `title` / done→status / category；无 category → `categoryId: null` + `inbox: true`（冻结 #2）；单 `schedule` → **一个** locked `ScheduleBlock`；`StudyTimerPlan` → `TimerPlanV2`（长休息默认写报告 `plan_long_break_defaulted`）；`simulationStart/End` → **suggested window only**，非历史日程；不可靠 active timer → 迁移后 `needs_reconcile`，禁止静默计入专注。
5. **类别 key** `studiumx:study-task-categories:v1`：迁入 snapshot 时去重保色保 ID；冲突记入 report。

### 5. localStorage 策略

`studiumx:study-space:v1` 与 `studiumx:study-task-categories:v1` 为迁移源数据，commit 成功后降级为可删备份提示、**非**权威；UI 偏好（empty-start、声音开关等）可留 localStorage **或** `preferences` 字段，但不得单独持有任务列表。

### 6. 与教学 / 产品地板边界

- **不**改写 `TeachingTurnCoordinator` / LearningSession settlement；expectedRevision / toolsReplayed 不变。
- **不**默认远程 telemetry；`localAnalyticsHints` 仅本地可重建。
- **无** shell / YOLO / MCP marketplace / 产品 FTS；计时标识永远 **TimerSession**。

## 不变量（ADR-0117 专用）

- `StudyPlanningStore.applyCommand` 是唯一写入口；renderer 不得直接写 `snapshot.json`。
- 所有写路径带 `expectedRevision`（CAS 顶层 revision）+ `actionId`；exact retry 幂等，CAS 失败不部分提交。
- 同一用户空间至多一个 `running` 个人 TimerSession；TimerSession 永不裸称 `session`。
- 迁移强制 dry-run + fail-closed；**永不**静默自动擦除 localStorage 权威 key。

## 后果

- 生产写路径必须经 `StudyPlanningStore.applyCommand`；renderer 不得直接写 `snapshot.json`。
- schemaVersion bump 须新 ADR 或本 ADR 修订节 + 迁移测试；IPC channel 落地 PR 用 `studyPlanning:*` 前缀并登记 teaching-ipc 合同。
- 模块遵守 ADR-0075；禁止继续胀大 `WorkbenchPomodoro.tsx` / `useStudySession.ts` / `StudyTaskSchedulePage.tsx`。

## 验证

- 触及 writer / 路径 / IPC：`pnpm run check:security`、`pnpm run check:teaching-ipc-contract`、`pnpm run check:blocking-ci` + 相关 unit（`tests/unit/study-planning-*.unit.test.*`）。
- Cutover 与 recovery 验证入口见 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)。

## 非目标

本 ADR **不**：

- 实现 store / IPC / UI（仅冻结合同与路径）；
- 授权 Phase 7 全部高级排程一次做完（见 [ADR-0130](0130-study-planning-phase7-and-completion-residual.md)）；
- 冻结具体 IPC channel 字符串；
- 改变 ADR-0094 十项产品冻结值。
