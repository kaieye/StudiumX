# ADR-0094：任务清单 / 时间排程 / 专注时钟一体化 — Phase 0 design gate

- **决策状态：** accepted
- **实施状态：** partial
- **日期：** 2026-07-21
- **范围：** 任务清单、任务详情、周/日时间排布、番茄时钟、连续专注、正计时/倒计时、时钟方案、休息、无任务启动、分类、提醒、恢复与本地分析的**产品与架构决策冻结**；不授权任何生产代码、路径/schema wire 或 UI 变更。
- **取代：** 无
- **被取代：** 无
- **相关：** [`AGENTS.md`](../../AGENTS.md)、[ADR-0003](0003-critical-json-backups-and-verified-recovery.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0117](0117-study-planning-store-paths-and-wire.md)、[ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)、[ADR-0130](0130-study-planning-phase7-and-completion-residual.md)、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)
- **证据：** 本 ADR 为决策冻结、无生产代码；落地由实现族承担（`src/shared/study-planning/` 纯层、[ADR-0117](0117-study-planning-store-paths-and-wire.md)、[ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)、[ADR-0130](0130-study-planning-phase7-and-completion-residual.md)）；历史基线 / STC 映射见 `docs/adr/evidence/ADR-0094.md`。

> **产品撤回注记（2026-07-22）：** 产品方此后**撤回**两个原规划面：**按时钟方案生成排程提案**（`allocateTimeWindow` / AllocationProposal UI / `apply_allocation_proposal`）与**旅行时区**设置（`defaultTimeZone` prefs / rezone sheet）——二者已从代码与 residual 文档移除，不再作为产品交付。TimerPlan 时钟方案 catalog、冲突检测/解决、估算建议与时区-DST 展示辅助保留。此注记不重写下表冻结决策，仅记录后续产品撤回（详见 [ADR-0130](0130-study-planning-phase7-and-completion-residual.md)）。

## 背景

截至 2026-07-21，仓库已有任务、周排程、倒计时与时钟方案的初始能力，但“任务”“时钟方案”“时间窗口”与“正在运行的计时器”仍松散耦合。本 ADR **只冻结** Phase 0 的产品与架构决策及可审计基线：任何 canonical 文件路径、writer、schema、迁移或 UI 重写在通过本 design gate 前不得被解释为已批准实施；本 ADR **不**新增 public API、**不**改生产路径、**不**宣称功能已实施。

## 决定

### 1. 六层领域模型（冻结命名）

```text
任务 Task ─ 一个要完成的学习意图，可被拆成多个时间块
时间窗口 TimeWindow ─ 用户愿意用于学习的一段可用时间，例如 09:00–12:00
时钟方案 TimerPlan ─ 可复用的节奏规则，例如 25/5、每 4 轮长休息 15 分钟
排程提案 AllocationProposal ─ 纯计算结果；说明如何把任务和休息装入时间窗口，尚未写入清单
计划时间块 ScheduleBlock ─ 已确认的具体安排，例如 09:00–09:25 学任务 A
实际计时会话 TimerSession ─ 用户真正执行的正计时或倒计时记录，可提前、延后、暂停或中断
```

**术语硬规则：** 计时领域始终写 **TimerSession**；教学权威继续写 **LearningSession**（或产品语境下的教学 Session）。禁止用裸 “Session” 指代时钟事实，以免与 ADR-0008 教学 Session 混淆。Task / TimeWindow / TimerPlan / AllocationProposal / ScheduleBlock 不得混用为一次计时、日历格、具体安排或实际执行时长。

### 2. 十项产品冻结

| # | 决策 | 冻结值 |
| --- | --- | --- |
| 1 | 无任务启动默认 | **`ask_every_time`**（每次询问）；允许偏好记忆；须可在设置中恢复。 |
| 2 | 收件箱 / 待归类建模 | **`categoryId: null` + `inbox: true`**（不是伪造的 `study` 类别）；内置不可删「待归类」为投影；自定义类别仍由用户拥有。 |
| 3 | 番茄到点后休息策略 | 默认 **`ask`**（询问），不自动进入休息。 |
| 4 | 窗口末段剩余时间 | ≥ `minimumFinalFocusMinutes` → **`adaptive_final_focus`**；否则 wrap_up / blank。默认 `windowFillPolicy`：**`adaptive_final_focus`**。 |
| 5 | 可疑正计时间隔 | 默认 **120 分钟**内允许连续不确认；超出标记 `needs_reconcile`，要求确认 / 截断 / 丢弃。 |
| 6 | 完全关闭休息提醒 | **允许**，但仅经用户显式方案 `breakPolicy: none` / `reminder_only`；**禁止**作为番茄静默默认。 |
| 7 | 任务完成且存在未来块 | **每次询问**（取消 / 保留作复习 / 重新指派）；禁止静默批量取消默认。 |
| 8 | 默认 `estimateMinutes` | **`empty` / `null`**（不要用方案单轮专注分钟自动填）。 |
| 9 | Canonical 规划文件路径 | **不冻结具体路径**。仅冻结原则：工作区范围内受控文件；localStorage 非长期权威；SQLite 仅可重建分析投影。路径 / schema / 备份由实现 ADR 决定（后续 [ADR-0117](0117-study-planning-store-paths-and-wire.md)）。 |
| 10 | localStorage 迁移后保留 | 备份导出建议保留 ≥ **30 天** **或**直至用户确认擦除；fail-closed；须 dry-run。确切路径由实现 ADR 定。 |

### 3. 架构原则（冻结）

| 原则 | 内容 |
| --- | --- |
| 真相源与同步边界 | **教学决策事实**仍以文件 / ledger 为真相源；任务、排程、等级/XP 等个人产品状态不属于 teaching authority，可按独立同步契约多端同步。localStorage 不是跨设备长期权威；SQLite 若参与不得替代教学事实；禁止 FTS / 向量库作产品搜索（[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)）。 |
| 单 writer | **`StudyPlanningStore`** 为规划数据 sole-writer 入口：`readSnapshot()` / `applyCommand(command, expectedRevision)`。 |
| 修订与幂等 | 所有写路径带 **`expectedRevision`** 与 **action / operation id**；exact retry 不得重复创建任务或会话。 |
| 纯分配 | **`allocateTimeWindow(input) -> AllocationProposal`** 必须是纯函数；**提案先于写入**；UI 不得散落循环/休息/尾段规则。（注：该产品路径已于 2026-07-22 撤回，见文首注记。） |
| 方案快照 | 运行中 / 历史 **TimerSession 冻结 `planSnapshot`**；编辑方案只影响下一段，不得改写历史事实。 |
| 单活动时钟 | 同一用户空间最多 **一个 `running` 的个人 TimerSession**。 |
| 休息与完成 | 休息块 **不计入**任务专注；完成计时段 **≠** 完成任务（独立动作）。 |
| 与教学 settlement | **不**改变 `TeachingTurnCoordinator` / host outcome settlement sole-writer；**不**放宽 `toolsReplayed: false`；fork 不得重放真实计时副作用。 |
| 产品地板 | **无**默认 shell、YOLO / always-approve、MCP marketplace、远程 telemetry / phone-home。 |
| 模块尺寸 | 新模块遵守 [ADR-0075](0075-module-size-policy-and-giant-peel.md)；优先深模块 + 纯函数 peel。 |

## 不变量（ADR-0094 专用）

1. 同一用户空间最多一个 `running` 个人 TimerSession。
2. `ScheduleBlock.endAt` 晚于 `startAt`；同一资源上锁定块不得重叠。
3. 休息段不计入任务专注时长。
4. 完成计时段 ≠ 完成任务。
5. 改/删 TimerPlan 不得改写历史会话；历史保存 `planSnapshot`。
6. 改任务标题/类别不得改写已记录会话时间与原始归属 ID。
7. 计时开始后任务归属默认冻结；切换任务结束当前事实段并开新段。
8. 自动排程不得移动用户锁定的手动时间块。
9. 硬结束时间默认不可被自动突破；延长须用户确认。
10. 正计时恢复后不得把无法确认的长时间休眠静默记为专注。
11. 自动创建的任务在清单与详情共用同一 canonical ID。
12. 分类提示不得阻塞任务完成；用户选“永不提示”后不得再弹。
13. 列表排序只是投影，不得改变手动排序权威。
14. 计划事实与实际事实分开；不得用实际超时反向改原计划。

## 后果

- 任何 canonical 文件路径、writer、schema、迁移或 UI 重写在通过本 design gate 前不得被解释为已批准实施；实现须另立项并（必要时）另立实现 ADR（路径 / schema / 备份 / 迁移见 [ADR-0117](0117-study-planning-store-paths-and-wire.md)，cutover 见 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)）。
- 首个可交付切片优先 **纯 `TimerPlanV2` + `allocateTimeWindow` + 预览**（若做 UI 仍可不写盘），避免同时三线重写周计划、计时生命周期与迁移；禁止在无实现 ADR 的情况下直接进入 Phase 1+ 生产改动。

## 验证

本 ADR 为决策冻结，无生产代码可测。路径 / wire / store 的稳定验证入口见 [ADR-0117](0117-study-planning-store-paths-and-wire.md) 与 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)（`pnpm run check:security`、`check:teaching-ipc-contract` 等既有门禁）；历史基线与 STC 映射见 `docs/adr/evidence/ADR-0094.md`。

## 非目标

本 ADR **不**：

- 实现 `TimerPlanV2`、`allocateTimeWindow`、StudyPlanningStore、迁移、IPC 或任何 UI；
- 冻结具体文件路径、目录布局、wire schema 版本号或备份文件名；
- 授权默认 shell、YOLO / DangerFullAccess / always-approve、MCP marketplace、远程 telemetry / phone-home、或产品面 FTS / 向量搜索；
- 改变教学 outcome settlement sole-writer、`expectedRevision` 教学路径、或 LearningSession ledger 权威；
- 重写 Agent run 状态机、EventBus/timeline，或以覆盖率/泛型 lint 替换 teaching / privacy / security 门禁；
- 将 renderer `localStorage` 扩成长期权威，或把本地 study analytics 测试地基（`check:analytics`）解释为远程 telemetry。
