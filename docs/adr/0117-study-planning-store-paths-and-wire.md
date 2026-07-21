# ADR-0117：StudyPlanningStore 路径、wire schema 与 V1→V2 迁移落地冻结

- **状态：** 已采纳（实现 gate；**授权**后续 sole-writer / 迁移实现，本 ADR 本身**无**生产写路径变更）
- **日期：** 2026-07-21
- **范围：** 学习规划 / 任务 / ScheduleBlock / TimerPlan / TimerSession 事实的 **canonical 路径布局、备份文件名、wire schema 版本、StudyPlanningStore 命令信封、错误码、V1→V2 迁移与 localStorage 擦除策略**
- **相关：**
  - Phase 0 产品与架构冻结：[ADR-0094](0094-study-task-timer-planning-design-gate.md)
  - 规划全文：[`docs/study-task-timer-planning-roadmap.md`](../study-task-timer-planning-roadmap.md)
  - 关键 JSON 备份精神：[ADR-0003](0003-critical-json-backups-and-verified-recovery.md)
  - sole-writer / revision 精神：[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)
  - TimerSession 命名消歧：[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)
  - 模块尺寸：[ADR-0075](0075-module-size-policy-and-giant-peel.md)
- **证据提交：** 本 ADR（决策记录）；生产 store / IPC 须后续提交单独落地

## 背景

ADR-0094 **原则**已冻结（文件真相源、StudyPlanningStore、expectedRevision + action id、dry-run 迁移、备份 ≥30 天或用户确认擦除），但**明确不冻结**具体路径、wire schema 版本号与备份文件名。Phase 1 纯函数切片（STC-101..108）已落地于 `src/shared/study-planning/`，**禁止**在无实现 ADR 的情况下写 canonical 生产路径。

本 ADR 关闭该实现门，使 Phase 2+ 可立项 `StudyPlanningStore` 与迁移，而不重开 Phase 0 产品十项冻结。

## 决定

### 1. Canonical 路径布局（工作区相对）

根目录固定为工作区下的：

```text
.studiumx/study-planning/
```

| 相对路径 | 内容 | 说明 |
| --- | --- | --- |
| `snapshot.json` | 当前权威快照（见 §2 wire） | sole-writer 唯一正式读/写入口产物 |
| `snapshot.json.bak` | 最近一次成功 durable publish 前的 verified 备份 | ADR-0003 精神；可读 canonical 不被静默用 `.bak` 覆盖 |
| `backups/snapshot-YYYYMMDDTHHMMSSZ.json` | 迁移 / 手动导出 / 重大 schema 升级前的时间戳备份 | 建议保留 ≥ **30 天**或直至用户确认擦除（产品冻结 #10） |
| `migration-report-latest.json` | 最近一次 V1→V2（或 schema bump）迁移报告 | 可重建；非任务权威 |
| `tmp/` | 写入中转（atomic rename 源） | 不得被 UI 当作权威读取 |

**论证（相对其它候选）：**

- 与现有 workspace 约定 `.studiumx/`（tool-policy 等）一致，避免散落 userData 根导致多窗口路径歧义。
- 规划数据与教学 LearningSession ledger **物理分离**，降低误写教学 settlement 的 blast radius。
- `userData` 全局副本**不**作为多 workspace 权威；若未来做只读 export，须另 ADR。

**禁止：** 将 `localStorage` key `studiumx:study-space:v1` / `studiumx:study-task-categories:v1` 继续当作长期任务/排程权威；迁移完成后仅允许 UI 草稿/偏好类 key。

### 2. Wire schema

| 字段 | 冻结值 |
| --- | --- |
| 顶层 `schema` | 字面量 `"studiumx.study-planning"` |
| 顶层 `schemaVersion` | 整数 **`1`**（本 ADR 首发）；不兼容变更必须 +1 并写迁移 |
| 时间字段 | 权威为 epoch **ms**（`startAtMs` / `endAtMs` / `dueAtMs` / `createdAtMs` 等），与 Phase 1 纯模型一致 |
| 修订 | 顶层 `revision: number`（≥1，单调）；实体可有 `revision` 供诊断，CAS 以顶层为准 |
| 标识 | 字符串 id；TimerSession **永不**裸称 `session` 字段指计时 |

**`snapshot.json` 顶层形状（v1，非 exhaustive 字段列表——实现可加 optional，不得删 required）：**

```ts
type StudyPlanningSnapshotV1 = {
  schema: 'studiumx.study-planning'
  schemaVersion: 1
  revision: number
  updatedAtMs: number
  tasks: PlanningTask[]
  scheduleBlocks: ScheduleBlock[]
  timerPlans: TimerPlanV2[]
  /** At most one running personal TimerSession in a user space. */
  timerSessions: TimerSessionRecord[]
  preferences?: StudyPlanningPreferencesV1
  /** Rebuildable; not remote telemetry. */
  localAnalyticsHints?: Record<string, unknown>
}
```

`PlanningTask` / `ScheduleBlock` / `TimerPlanV2` 语义对齐 `src/shared/study-planning/` 与路线图 §13；**TimerSessionRecord** 字段在 Phase 2 实现时扩展，但必须含：`id`、`status`（含 `needs_reconcile`）、`clockMode`、`planSnapshot`、`taskId | null`、`startedAtMs`、累计专注/休息分项、`actionId` 幂等键引用。

序列化：UTF-8 JSON，stable key order **不**强制；写入经 durable replace（write temp → fsync 策略服从现有 `durable-file` 原语）→ rename → 更新 `.bak`。

### 3. StudyPlanningStore 合同

| 方法 | 语义 |
| --- | --- |
| `readSnapshot(): Promise<StudyPlanningSnapshotV1>` | 只读；verified recovery 可读 `.bak` 仅当 canonical 不可用 |
| `applyCommand(command, expectedRevision): Promise<ApplyResult>` | 唯一写入口；CAS 失败不部分提交 |

**命令信封（v1）：**

```ts
type StudyPlanningCommandEnvelope = {
  actionId: string
  operationId?: string
  type: StudyPlanningCommandType
  payload: unknown
  clientIssuedAtMs?: number
}

type ApplyResult =
  | { ok: true; revision: number; snapshot: StudyPlanningSnapshotV1; effects: StudyPlanningEffect[] }
  | { ok: false; error: StudyPlanningError; revision: number }
```

**命令闭集（可增不可偷换语义；与路线图 §14.2 对齐）：**

`create_task` · `update_task` · `complete_task` · `save_timer_plan` · `apply_allocation_proposal` · `start_timer_session` · `pause_timer_session` · `resume_timer_session` · `finish_timer_session` · `switch_session_task` · `reconcile_stale_session` · `quick_start` · `set_preferences` · `import_migration_commit`（仅迁移确认后）

**错误码（稳定字符串）：**

| code | 含义 |
| --- | --- |
| `revision_conflict` | `expectedRevision` 不匹配 |
| `duplicate_action` | 同 `actionId` exact retry → 返回首次成功结果（**不**重复创建） |
| `invalid_command` | 未知 type / payload 校验失败 |
| `invariant_violation` | 如第二 running TimerSession、locked 重叠写入 |
| `not_found` | 目标 task/session/plan 不存在 |
| `migration_required` | schema 不匹配且未迁移 |
| `io_failed` | 磁盘错误（fail-closed，不半写） |

**effects（给 UI/IPC 的旁路信号，非第二权威）：**  
如 `timer_session_started`、`classification_prompt_suggested`、`reconcile_required`、`future_blocks_need_decision`。

### 4. V1 → V2 迁移

1. **Dry-run 强制：** 使用纯函数 `migrateStudyV1ToPlanning`（已存在）生成 `MigrateStudyV1Result` + 报告；**不写盘**。
2. **真迁移 fail-closed：** 任一步 IO/校验失败 → 保留 V1 localStorage 与未写坏的 canonical；不删除源。
3. **步骤顺序：**  
   a. 读 V1 keys → dry-run 报告展示用户；  
   b. 写 `backups/snapshot-…`（若已有 v2）与/或导出 V1 JSON 到 `backups/`；  
   c. `import_migration_commit` 经 store 写入 `snapshot.json`；  
   d. 仅在用户确认或 ≥30 天策略后，才允许擦除 localStorage 权威 keys（偏好 key 可保留）。
4. **映射规则（冻结）：**  
   - 任务保留 `id` / `title` / done→status / category；无 category → `categoryId: null` + `inbox: true`（冻结 #2）；  
   - 单 `schedule` → **一个** locked `ScheduleBlock`（Task 1:N 模型起点）；  
   - `StudyTimerPlan` → `TimerPlanV2`，长休息默认写入报告 `plan_long_break_defaulted`；  
   - `simulationStart/End` → **suggested window only**，非历史日程；  
   - 不可靠 active timer → 迁移后 `needs_reconcile`，禁止静默计入专注。
5. **类别 key** `studiumx:study-task-categories:v1`：迁入 snapshot 时去重保色保 ID；冲突记入 report。

### 5. localStorage 策略

| Key | 迁移后角色 |
| --- | --- |
| `studiumx:study-space:v1` | 源数据；commit 成功后降级为可删备份提示，**非**权威 |
| `studiumx:study-task-categories:v1` | 同上 |
| UI 偏好（empty-start、声音开关等） | 可留 localStorage **或** `preferences` 字段；不得单独持有任务列表 |

### 6. 与教学 / 产品地板边界

- **不**改写 `TeachingTurnCoordinator` / LearningSession settlement。
- **不**默认远程 telemetry；`localAnalyticsHints` 仅本地可重建。
- **无** shell / YOLO / MCP marketplace / 产品 FTS。
- 计时标识永远 **TimerSession**。

## 明确不包含 / non-claims

本 ADR **不**：

- 实现 store / IPC / UI（仅冻结合同与路径）；
- 授权 Phase 7 全部高级排程一次做完；
- 冻结具体 IPC channel 字符串（可在落地 PR 用 `studyPlanning:*` 前缀，列入 teaching-ipc 合同时再登记）；
- 改变 ADR-0094 十项产品冻结值。

## 后续工作约束

1. 生产写路径必须经 `StudyPlanningStore.applyCommand`；renderer 不得直接写 `snapshot.json`。
2. schemaVersion bump 须新 ADR 或本 ADR 修订节 + 迁移测试。
3. 模块遵守 ADR-0075；禁止继续胀大 `WorkbenchPomodoro.tsx` / `useStudySession.ts` / `StudyTaskSchedulePage.tsx`。
4. 门禁：触及 writer/路径/IPC 时叠加 `check:security`、`check:teaching-ipc-contract`、`check:blocking-ci`。

---

**一句话：** 规划权威落在工作区 `.studiumx/study-planning/snapshot.json`（schema v1 + revision CAS）；迁移 dry-run 后 fail-closed 提交；localStorage 不再是任务真相源。
