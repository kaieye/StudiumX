# ADR-0094：任务清单 / 时间排程 / 专注时钟一体化 — Phase 0 design gate

- **状态：** 已采纳（Phase 0 design gate / decision freeze；无生产行为变更）
- **日期：** 2026-07-21
- **范围：** 任务清单、任务详情、周/日时间排布、番茄时钟、连续专注、正计时/倒计时、时钟方案、休息、无任务启动、分类、提醒、恢复与本地分析的**产品与架构决策冻结**；不授权任何生产代码、路径/schema wire 或 UI 变更
- **相关：**
  - 产品地板：[`AGENTS.md`](../../AGENTS.md)
  - Phase 0 决策包：历史 ephemeral 编排产物（`docs/_agent-work/` 已于 2026-07-22 清理）；**持久权威**为 **本 ADR + [ADR-0130](0130-study-planning-phase7-and-completion-residual.md)**（原路线图已删除）
  - [ADR-0003](0003-critical-json-backups-and-verified-recovery.md)（关键 JSON 备份与恢复精神）
  - [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)（教学 Session / LearningSession 消歧）
  - [ADR-0021](0021-agent-run-state-machine-separate-from-session.md)（AgentRun 与 Session 状态机分离；防计时/教学 Session 命名混用）
  - [ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)（sole-writer / revision 精神）
  - [ADR-0075](0075-module-size-policy-and-giant-peel.md)（模块尺寸）
- **证据提交：** 本 ADR（决策记录）；实现与路径/schema 须另立项、另 ADR

## 背景

截至 2026-07-21，仓库已有任务、周排程、倒计时与时钟方案的初始能力，但“任务”“时钟方案”“时间窗口”与“正在运行的计时器”仍松散耦合。规划路线图文档已归档删除；规划与 residual 政策以本 ADR 与 [ADR-0130](0130-study-planning-phase7-and-completion-residual.md) 为准。

在未完成 Phase 0 design gate 前，任何 canonical 文件路径、writer、schema、迁移或 UI 重写都不得被解释为已批准实施。本 ADR **只冻结**产品与架构决策及当前可审计基线，**不**新增 public API、**不**改生产路径、**不**宣称功能已实施。

### 当前基线（代码锚点，只读）

| 事实 | 现状 |
| --- | --- |
| 持久化 | `StudySnapshot` 经 `session-snapshot.ts` 写入 `localStorage` key `studiumx:study-space:v1`（`STUDY_SPACE_STORAGE_KEY`）；类别另有 `studiumx:study-task-categories:v1` |
| 计时模型 | 以 `remainingSeconds` 为核心，仅支持倒计时；状态 `idle` / `running` / `paused`；相位 `focus` / `break` |
| 时钟方案 | `StudyTimerPlan`：名称、`focusMinutes` / `breakMinutes`、以及 `simulationStartTime` / `simulationEndTime`（`HH:MM` **标签**，不自动生成时间块） |
| 任务排程 | 每个 `StudyTask` 至多一个可选 `schedule`（weekday + start/end minutes）；默认类别常落在内置 `study` |
| 无任务启动 | `resolveFocusTaskId`（`useStudySession.ts`）优先显式任务 → 当前选中 → **自动取第一条未完成任务** |
| 方案与分配 | 无 `allocateTimeWindow`；无 AllocationProposal；计划窗口标签 ≠ 分配器 |
| 与教学 Session | 教学权威仍为 LearningSession / ledger；个人时钟与 analytics 事实不得冒充 teaching Session |

上述缺口与规划 §1、§13–§14 一致；本 gate 冻结目标态，**不**在本 ADR 落地实现。

## 决定

### 1. 六层领域模型（冻结命名）

```text
任务 Task
  └─ 一个要完成的学习意图，可被拆成多个时间块

时间窗口 TimeWindow
  └─ 用户愿意用于学习的一段可用时间，例如 09:00–12:00

时钟方案 TimerPlan
  └─ 可复用的节奏规则，例如 25/5、每 4 轮长休息 15 分钟

排程提案 AllocationProposal
  └─ 纯计算结果；说明如何把任务和休息装入时间窗口，尚未写入清单

计划时间块 ScheduleBlock
  └─ 已确认的具体安排，例如 09:00–09:25 学任务 A

实际计时会话 TimerSession
  └─ 用户真正执行的正计时或倒计时记录，可提前、延后、暂停或中断
```

| 中文名 | 英文名 | 不得混用为 |
| --- | --- | --- |
| 任务 | Task | 一次计时、一个日历格 |
| 时间窗口 | TimeWindow | 时钟方案本身 |
| 时钟方案 | TimerPlan | 某天 09:00 的具体安排 |
| 排程提案 | AllocationProposal | 已保存日程 |
| 计划时间块 | ScheduleBlock | 实际执行时长 |
| 计时会话 | **TimerSession** | 时钟方案；**也不得**裸用 “Session” 指代计时 |

**术语硬规则：** 计时领域始终写 **TimerSession**；教学权威继续写 **LearningSession**（或产品语境下的教学 Session）。禁止用裸 “Session” 指代时钟事实，以免与 ADR-0008 教学 Session 混淆。

### 2. 十项产品冻结（与 phase0-freeze-package §19 一致）

| # | 决策 | 冻结值 |
| --- | --- | --- |
| 1 | 无任务启动默认 | **`ask_every_time`（每次询问）**。允许偏好记忆；须可在设置中恢复。 |
| 2 | 收件箱 / 待归类建模 | **`categoryId: null` + `inbox: true`**（不是伪造的 `study` 类别）。内置不可删「待归类」为 **投影**，不是静默 study 默认。自定义类别仍由用户拥有。 |
| 3 | 番茄到点后休息策略 | 默认 **`ask`（询问）**，不自动进入休息。 |
| 4 | 窗口末段剩余时间 | 若剩余 ≥ `minimumFinalFocusMinutes` → **`adaptive_final_focus`**；否则 wrap_up / blank。默认 `windowFillPolicy`：**`adaptive_final_focus`**。 |
| 5 | 可疑正计时间隔 | 默认 **120 分钟**内允许连续不确认；超出后标记 `needs_reconcile`，要求用户确认 / 截断 / 丢弃。（记为默认；实现可后置。） |
| 6 | 完全关闭休息提醒 | **允许**，但仅经用户显式连续方案 `breakPolicy: none` / `reminder_only`。**禁止**作为番茄的静默默认。 |
| 7 | 任务完成且存在未来块 | **每次询问**（取消 / 保留作复习 / 重新指派）。禁止静默批量取消默认。 |
| 8 | 默认 `estimateMinutes` | **`empty` / `null`**（不要用方案单轮专注分钟自动填）。 |
| 9 | Canonical 规划文件路径 | **本 ADR 不冻结具体路径**。仅冻结原则：工作区范围内受控文件；localStorage 非长期权威；SQLite 仅可重建分析投影。路径 / schema / 备份由**首个纯函数切片之后**的实现 ADR 决定。路线图中的 `.studiumx/study-planning/` 等仅为**建议**，非冻结。 |
| 10 | localStorage 迁移后保留 | 备份导出建议保留 ≥ **30 天** **或**直至用户确认擦除；fail-closed；须 dry-run。确切路径 / 保留介质由实现 ADR 定。 |

### 3. 架构原则（冻结）

| 原则 | 内容 |
| --- | --- |
| 真相源与同步边界 | **教学决策事实**仍以文件 / ledger 为真相源；任务、排程、等级/XP 等个人产品状态不属于 teaching authority，可按独立同步契约多端同步。localStorage 不是跨设备长期权威；SQLite 若参与，不得替代教学事实，且禁止 FTS / 向量库作产品搜索。详见 ADR-0167。 |
| 单 writer | **`StudyPlanningStore`** 为规划数据 sole-writer 入口：`readSnapshot()` / `applyCommand(command, expectedRevision)`。 |
| 修订与幂等 | 所有写路径带 **`expectedRevision`** 与 **action / operation id**；exact retry 不得重复创建任务或会话。 |
| 纯分配 | **`allocateTimeWindow(input) -> AllocationProposal`** 必须是纯函数；**提案先于写入**；UI 不得散落循环/休息/尾段规则。 |
| 方案快照 | 运行中 / 历史 **TimerSession 冻结 `planSnapshot`**；编辑方案只影响下一段，不得改写历史事实。 |
| 单活动时钟 | 同一用户空间最多 **一个 `running` 的个人 TimerSession**。 |
| 休息与完成 | 休息块 **不计入**任务专注；完成计时段 **≠** 完成任务（独立动作）。 |
| 与教学 settlement | **不**改变 `TeachingTurnCoordinator` / host outcome settlement sole-writer；**不**放宽 `toolsReplayed: false`；fork 不得重放真实计时副作用。 |
| 产品地板 | **无**默认 shell、YOLO / always-approve、MCP marketplace、远程 telemetry / phone-home。 |
| 模块尺寸 | 新模块遵守 [ADR-0075](0075-module-size-policy-and-giant-peel.md)；优先深模块 + 纯函数 peel，避免继续塞 renderer 巨石。 |

### 4. 首个可交付切片（路线图 §20；本 gate 授权边界）

在**不**写 canonical、**不**启动真实计时的前提下，后续实现可立项为：

1. 本 ADR / design gate（本文件）；
2. **`TimerPlanV2` 纯类型与验证**；
3. **`allocateTimeWindow` 纯函数**；
4. 09:00–12:00 的 25/5 + 长休息 + 自适应尾段 **预览**；
5. UI 仅展示 **AllocationProposal**（若做 UI，仍可不写盘）；
6. 纯函数单测 + 可访问预览验证产品规则。

**明确：** 首切片 **禁止** canonical 写入、V1→V2 迁移落盘、真实 TimerSession 生命周期替换、以及路径/schema 的“先写死再补 ADR”。路径与 wire schema 必须在进入 store / 持久化实施前另立实现 ADR。

### 5. Phase 0 清单映射（STC-001 … STC-009）

| ID | 路线图条目 | 本 gate 结论 |
| --- | --- | --- |
| **STC-001** | 冻结六层领域术语与关系 | **已决定**：见 §1；TimerSession / LearningSession 消歧见术语硬规则 |
| **STC-002** | canonical 文件范围、schema 版本与 workspace 路径 | **原则已冻结、路径未冻结**：见产品冻结 #9 与架构「真相源」；具体路径/schema → 实现 ADR |
| **STC-003** | 规划数据权威、单 writer、revision、迁移与恢复 | **已决定（原则）**：StudyPlanningStore + expectedRevision + operation id；迁移 dry-run / fail-closed / 备份见 #10 与 ADR-0003 精神；详细 failure matrix → 实现 ADR |
| **STC-004** | inbox 类别 vs `categoryId: null` | **已决定**：`categoryId: null` + `inbox: true`；「待归类」为投影 |
| **STC-005** | 无任务启动默认 | **已决定**：`ask_every_time` |
| **STC-006** | 运行中修改方案 | **已决定**：历史/当前段冻结 `planSnapshot`；修改仅影响下一段 |
| **STC-007** | 通知、声音与休息自动化默认 | **已决定（默认策略）**：番茄到点默认 `ask`；可显式 `breakPolicy: none` / `reminder_only`；其余提醒细节可在实现切片细化但不得违背本表 |
| **STC-008** | V1→V2 dry-run 迁移与失败策略 | **已决定（策略）**：dry-run 必需；fail-closed；备份保留 ≥30 天或用户确认擦除；exact path TBD |
| **STC-009** | `CONTEXT.md` 术语 | **本 ADR 冻结术语**；`CONTEXT.md` 更新为同 workstream 文档义务（非本文件职责时仍以本 ADR 为决策权威） |

**Phase 0 验收（文档门）：** 决策已写入本 ADR；**无**实现代码提前冻结错误文件路径。

## 关键不变量（自路线图 §3.2 压缩）

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

## 明确不包含 / non-claims

本 ADR **不**：

- 实现 `TimerPlanV2`、`allocateTimeWindow`、StudyPlanningStore、迁移、IPC 或任何 UI；
- 冻结具体文件路径、目录布局、wire schema 版本号或备份文件名；
- 授权默认 shell、YOLO / DangerFullAccess / always-approve、MCP marketplace、远程 telemetry / phone-home、或产品面 FTS / 向量搜索；
- 改变教学 outcome settlement sole-writer、`expectedRevision` 教学路径、或 LearningSession ledger 权威；
- 重写 Agent run 状态机、EventBus/timeline，或以覆盖率/泛型 lint 替换 teaching / privacy / security 门禁；
- 将 renderer `localStorage` 扩成长期权威，或把本地 study analytics 测试地基（`check:analytics`）解释为远程 telemetry。

路线图中的类型草案（§13）仅为职责说明，**不是**已批准 wire schema。

## 后续工作约束

1. **不得**在无独立实施工作与（必要时）实现 ADR 的情况下直接进入 Phase 1+ 生产改动。
2. 进入 **StudyPlanningStore / canonical 持久化** 前，必须另立路径、schema、备份、迁移与 crash/restart 的实现 ADR；本 gate 仅提供原则与产品冻结值。
3. 首个实现切片应优先 **纯 TimerPlanV2 + allocateTimeWindow + 预览**（§4），避免同时三线重写周计划、计时生命周期与迁移。
4. 任何触达权限 / provider 隐私 / 外部内容边界的路径仍须 `pnpm run check:security` 等既有门禁；本 ADR 本身无生产代码可测。
5. 模块新增遵守 ADR-0075；禁止借机 peel 教学 settlement 巨石。

## 权威与规划细节

| 文档 | 角色 |
| --- | --- |
| **本 ADR-0094** | Phase 0 **冻结决策权威**（产品 10 项、六层模型、架构原则、STC 映射、non-claims） |
| （历史）`docs/_agent-work/phase0-freeze-package.md` | **已清理**（2026-07-22）；曾为 ephemeral 决策包来源。**持久权威**为 **本 ADR + ADR-0130**，非 `_agent-work` |
| 未来实现 ADR | 路径 / schema / 备份 / 迁移 / store IPC 的落地权威 |

---

**一句话：** 任务是目标、时间块是安排、TimerSession 是事实；先提案后写入；教学决策事实以文件 / ledger 为真相源，个人产品状态可依独立契约同步；本文件只关门 Phase 0 决策，不交付实现。

---

## Living product note (2026-07-22)

Phase 0 freeze historically named **`allocateTimeWindow` / AllocationProposal** as a pure-first design target for explainable window fill. **Product decision 2026-07-22:** the shipped product **does not** include 「按时钟方案生成排程提案」 (`allocateTimeWindow` / AllocationProposal UI / `apply_allocation_proposal`) nor 「旅行时区」 settings (`defaultTimeZone` prefs / travel rezone sheet). Those surfaces were **withdrawn** from code + residual docs (see [ADR-0130](0130-study-planning-phase7-and-completion-residual.md)；原路线图已删除). TimerPlan / 时钟方案 catalog, conflict detect/resolve, estimate suggestion, and timezone-DST display helpers remain. This note does **not** rewrite the historical freeze tables above; it only records the later product withdrawal.
