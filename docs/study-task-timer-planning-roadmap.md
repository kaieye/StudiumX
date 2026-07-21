# StudiumX 任务清单、时间排程与专注时钟一体化规划

> 状态：Phase 0 design gate **已关闭**；**Phase 1–7 共享纯领域 / 内存 Store 大部分已落地并单测**；**ADR-0117 durable host + product IPC 已落地**；**renderer cutover**：dual-write create/complete/update + schedule upsert + migration + empty-start + sole-read hydrate + **focus TimerSession dual-write** + **STC-306 future-blocks decision sheet** + **task list timeline views (STC-302 adapter)**；localStorage 仍为 V1 UI clock/presence + 可重建缓存/未自动擦除；**§18 未满足**；缺口：full timer sole-read / advance thrash 策略 / multi-block 周 UI (STC-307) / Plans UI / STC-702..704  
> 日期：2026-07-21  
> 权威冻结：[`docs/adr/0094-study-task-timer-planning-design-gate.md`](adr/0094-study-task-timer-planning-design-gate.md)；路径/wire：[`docs/adr/0117-study-planning-store-paths-and-wire.md`](adr/0117-study-planning-store-paths-and-wire.md)  
> 范围：任务清单、任务详情、周/日时间排布、番茄时钟、连续专注、正计时/倒计时、时钟方案、休息、无任务启动、分类、提醒、恢复与本地分析  
> 产品地板：文件是真相源；无默认远程 telemetry；不引入通用 shell、任意 MCP 或自动外发；持久化写入保持单一 writer、revision/CAS 与可恢复语义  
> 规划文档状态：shared 纯层 + main durable + IPC 已测；renderer dual-write (create/complete/update+schedule)/hydrate/timer-session + future-blocks sheet 已测；break 段与每 tick advance 仍 V1；周拖拽仍写 V1 再 dual-write 单 block（非 multi-block UI）；**§18 未完成**

---

## 0. 结论先行

### Phase 0 设计门状态

**Phase 0 design gate 已关闭（2026-07-21）。** 产品与架构冻结值以 [ADR-0094](adr/0094-study-task-timer-planning-design-gate.md) 为权威来源；本文档其余章节仍是规划语境与实施路线图。本节六层模型与下列核心决策在 Phase 0 中已冻结；具体路径 / wire schema / 备份位置仍留给实现 ADR，不得在此误当作已落地。

本功能不应继续把“任务”“时钟方案”“9:00–12:00 时间窗口”和“正在运行的计时器”混成同一个对象。应固定为六层关系：

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

推荐的核心产品决策如下：

1. **任务是目标，时间块是安排，实际会话是事实。** 一个任务允许对应多个时间块；休息时间块不是任务。
2. **时钟方案只描述节奏，不直接等于日程。** “25/5”与“09:00–12:00”应分开建模，再由排程器组合。
3. **默认提供倒计时，也提供正计时。** 正计时不是把剩余秒数倒着显示，而是独立的开放式会话模式。
4. **允许长时间不间断专注，但必须显式选择。** 可设置“仅提醒休息，不自动打断”或“完全不提醒”，不能偷偷强制中断。
5. **无任务启动时不应静默绑定第一条任务。** 默认弹出轻量选择：选择任务、创建临时任务、无任务计时；用户可记住偏好。
6. **自动创建的任务进入“待归类/收件箱”。** 完成后可提示归类，提示可关闭，归类不能阻塞完成。
7. **清单详情页、周计划和时钟必须共享同一任务记录。** 不做三份相互同步的副本。
8. **自动排程先生成提案，再由用户确认。** 只有用户明确启用“快速启动自动建任务”等偏好后，才允许在窄场景自动落盘。
9. **正在运行的会话冻结方案快照与任务归属。** 修改方案只影响下一段；切换任务应分段记录，不能篡改已经发生的时间。
10. **设计门 ADR 已落地为 ADR-0094。** 权威、单 writer、revision、迁移原则与恢复边界已冻结；具体 canonical 路径 / wire schema 仍待实现 ADR，不应把 renderer localStorage 继续扩成长期权威。

---

## 1. 当前实现基线

截至 2026-07-21，仓库中已经存在任务、周排程、倒计时和时钟方案的初始能力，但它们的关系仍较松散。

### 1.1 已经具备

- `StudyTimerPlan` 已保存方案名称、专注分钟、休息分钟和 `HH:MM` 起止标签。
- 时钟方案支持保存、应用、删除，最多 12 个。
- 个人时钟支持 `focus` / `break` 与 `idle` / `running` / `paused`。
- 计时目前以 `remainingSeconds` 为核心，仅支持倒计时。
- 默认时钟为 25 分钟专注、5 分钟休息，默认窗口标签为 09:00–11:00。
- 任务支持完成状态、类别和单个可选周排程。
- 周排程使用 15 分钟粒度。
- 任务默认类别当前为 `study`；内置类别还有 `entertainment`、`exercise`。
- 启动专注时会优先取显式任务、当前选中任务，否则自动取第一条未完成任务。
- 没有可用任务时，时钟可以产生未归属会话事实。
- 本地学习分析能够记录专注时间及任务归属；这不是远程 telemetry。

### 1.2 当前关键缺口

- 方案中的 09:00–12:00 目前只是标签，不会自动生成 25/5 时间块。
- 时钟方案与周计划没有真正的排程关系。
- 一个任务只能附带一个 schedule，难以表达“同一任务上午两段、下午一段”。
- 清单默认按现有数组顺序呈现，不是“今日按时间”视图。
- 没有正计时、目标正计时或开放式连续专注。
- 没有短休息/长休息的区分，也没有“每 N 轮长休息”。
- 没有时间窗口填充策略，不能决定末尾剩余 10–20 分钟怎么处理。
- 无任务启动不会自动建任务，也没有让用户选择策略的入口。
- 完成任务后没有归类提示，也没有“永不再提示”偏好。
- 修改正在使用的方案时，没有完整表达“当前会话不变、下一段生效”。
- 应用休眠、系统睡眠、跨午夜、长时间遗忘计时等恢复规则不完整。

### 1.3 现有代码锚点（V1 生产 / localStorage 基线）

- 数据类型：`src/renderer/src/study-space/types.ts`
- 默认值和限制：`src/renderer/src/study-space/constants.ts`
- 状态转换：`src/renderer/src/study-space/session/transitions.ts`
- 计时与任务接口：`src/renderer/src/study-space/session/useStudySession.ts`
- 实际会话归属：`src/renderer/src/study-space/session/study-session-lifecycle.ts`
- 时钟界面：`src/renderer/src/views/workbench/WorkbenchPomodoro.tsx`
- 任务清单：`src/renderer/src/views/workbench/WorkbenchTasks.tsx`
- 周排程：`src/renderer/src/views/workbench/StudyTaskSchedulePage.tsx`
- 类别：`src/renderer/src/study-space/taskCategories.ts`

### 1.4 Phase 1 纯领域切片（已落地；ADR-0094 §4 授权边界内）

纯函数、**无** canonical 写入、**无** IPC、**无** renderer wiring；与 ADR-0094 §4 首切片一致。**不**等于生产功能交付。

| 路径 | 覆盖 |
| --- | --- |
| `src/shared/study-planning/index.ts` | barrel 导出 |
| `src/shared/study-planning/timer-plan.ts` | STC-101：`TimerPlanV2` 规范化 / 验证 / seed / 内置目录 |
| `src/shared/study-planning/allocate-time-window.ts` | STC-102..107：`allocateTimeWindow` 纯函数 |
| `src/shared/study-planning/schedule-block.ts` | STC-108：`PlanningTask` / `ScheduleBlock` 模型与校验 |
| `src/shared/study-planning/migrate-v1.ts` | STC-108：V1→规划 dry-run 迁移 adapter（不写盘） |
| `tests/unit/study-planning-allocator.unit.test.ts` | STC-101..108 单测（含 migrate dry-run / ScheduleBlock 校验） |

实现取舍（非 wire-final）：时间用 `startAtMs` / `endAtMs` / `dueAtMs`（epoch ms）；`ScheduleBlockSource` 含 `migrated_v1`。

---

## 2. 统一术语（核心六层已 Phase 0 冻结）

六层核心术语已写入 [`CONTEXT.md`](../CONTEXT.md)（Study planning language）与 [ADR-0094](adr/0094-study-task-timer-planning-design-gate.md)。本节保留扩展词（FocusBlock、BreakBlock、WrapUpBlock、CountUp、Countdown、TaskCategory、Inbox）以及「精确不得混用」对照表。**实施状态仍以代码为准**；术语冻结权威为 ADR-0094（非 ephemeral workstream 包）。

| 中文名 | 英文名 | 精确定义 | 不应混用为 |
| --- | --- | --- | --- |
| 任务 | Task | 用户想完成的学习/活动意图 | 一次计时、一个日历格 |
| 任务类别 | TaskCategory | 用于归类任务的稳定标签 | 排程状态、优先级 |
| 待归类 | Inbox | 尚未决定类别的任务集合 | 默认“学习”类别 |
| 时间窗口 | TimeWindow | 用户可用于专注的一段开始/结束时间 | 时钟方案本身 |
| 时钟方案 | TimerPlan | 可复用的专注、休息、长休息与显示规则 | 某天 09:00 的具体安排 |
| 排程提案 | AllocationProposal | 排程器生成、尚待确认的无副作用结果 | 已保存日程 |
| 计划时间块 | ScheduleBlock | 已保存的具体时间安排 | 实际执行时长 |
| 专注段 | FocusBlock | 计划或实际专注的一段时间 | 整个任务 |
| 休息段 | BreakBlock | 短休息或长休息安排 | 任务 |
| 收尾段 | WrapUpBlock | 复盘、记录和整理下一步的短时间块 | 休息 |
| 计时会话 | TimerSession | 一次真实开始、暂停、恢复、完成/中断的计时事实 | 时钟方案 |
| 正计时 | CountUp | 从 0 开始累计实际时间，可无目标或有提醒目标 | 无限任务 |
| 倒计时 | Countdown | 从目标时长递减，到 0 产生到点事件 | 自动完成任务 |

---

## 3. 领域关系与不变量

### 3.1 关系

```text
Task 1 ─────── 0..N ScheduleBlock
Task 0..1 ──── 0..N TimerSession
TimerPlan 1 ── 0..N AllocationProposal
TimerPlanSnapshot 1 ── 0..N TimerSession
TimeWindow 1 ─ 1 AllocationProposal
AllocationProposal 1 ─ 1..N proposed blocks
ScheduleBlock 0..1 ── 0..N TimerSession
TaskCategory 1 ───── 0..N Task
```

### 3.2 必须保持的不变量

1. 同一用户空间最多只有一个 `running` 的个人计时会话。
2. `ScheduleBlock.endAt` 必须晚于 `startAt`，同一资源上的锁定时间块不得重叠。
3. 休息段不计入任务专注时长。
4. 完成计时段不自动等于完成任务；两者是独立动作。
5. 修改或删除时钟方案不得改写历史会话；历史保存方案快照。
6. 修改任务标题或类别不得改写已经记录的会话时间与原始归属 ID。
7. 计时开始后，任务归属默认冻结；切换任务会结束当前事实段并开启新事实段。
8. 自动排程不得移动用户锁定的手动时间块。
9. 硬结束时间默认不能被自动突破；延长必须由用户确认。
10. 正计时恢复后不得把无法确认的长时间休眠静默记为专注。
11. 任何自动创建的任务必须在任务清单和任务详情使用同一个 canonical ID。
12. 分类提示不得阻塞任务完成，也不得在用户选择“永不提示”后继续弹出。
13. 列表排序只是投影，不得改变手动排序权威。
14. 计划事实和实际事实必须分开，不能用实际超时反向修改原计划。

---

## 4. 时钟方案设计

### 4.1 方案类型

建议先提供三种用户可理解的类型，而不是暴露任意复杂序列编辑器。

#### A. 番茄循环

适用于常规学习。

- 专注时长：5–180 分钟
- 短休息：1–45 分钟
- 每 N 轮长休息：默认 4，可设 2–8
- 长休息：5–60 分钟
- 显示：默认倒计时，可选正计时显示
- 到点行为：提醒、自动切换或等待确认

#### B. 连续专注

适用于阅读、写作、考试模拟或心流工作。

- 模式：开放式正计时，或 30–240 分钟倒计时
- 休息策略：
  - 仅提醒，不自动暂停
  - 到点询问是否休息
  - 不提醒
- 可选提醒间隔：30/45/50/60/90/120 分钟或自定义
- 应明确显示“不会自动插入休息”，避免用户误解

#### C. 自定义节奏（后续）

适用于考试模拟、课程轮换等高级场景。

- 按顺序定义专注、短休息、长休息、收尾段
- 第一阶段不建议实现任意拖拽序列，以免方案接口过浅、状态组合爆炸
- 应等番茄循环和连续专注稳定后再评估

#### 内置方案目录（只读；Phase 5 / STC-501）

系统内置方案只读；用户可「复制为自定义」。**TimeWindow 模板**（如 09:00–12:00）与 TimerPlan **分开保存**，不得把窗口起止写进方案身份字段。下列 `id` 为逻辑名，非 wire-final：

| id（逻辑） | name | kind | clockMode | focus / break | notes |
| --- | --- | --- | --- | --- | --- |
| `classic_25_5` | 经典番茄 25/5 | pomodoro | countdown | 25 / 5 / 长休息 15（每 4 轮） | 系统只读默认 |
| `deep_50_10` | 深度 50/10 | pomodoro | countdown | 50 / 10 / … | 系统只读；可复制为自定义 |
| `continuous_countup` | 连续专注 | continuous | countup | `breakPolicy: reminder_only` 或 `none`（须显式） | **不是**番茄静默默认 |

### 4.2 方案字段建议

```ts
type TimerPlanV2 = {
  id: string
  name: string
  kind: 'pomodoro' | 'continuous'
  clockMode: 'countdown' | 'countup'
  focusMinutes?: number
  shortBreakMinutes?: number
  longBreakMinutes?: number
  longBreakEvery?: number
  breakPolicy: 'automatic' | 'ask' | 'reminder_only' | 'none'
  windowFillPolicy: 'complete_cycles' | 'adaptive_final_focus' | 'allow_overrun'
  minimumFinalFocusMinutes: number
  wrapUpMinutes: number
  notificationPolicy: {
    sound: boolean
    systemNotification: boolean
    focusEnd: boolean
    breakEnd: boolean
  }
  revision: number
}
```

`TimeWindow` 不应继续作为 `TimerPlan` 的身份字段。方案可以带“常用窗口建议”，但某天实际窗口必须单独保存。

#### Default values（Phase1 seed；非 path/schema 冻结）

下列数值供 **STC-101+ 纯函数首切片** 使用的种子默认；**除非已在 ADR-0094 冻结，否则不构成 durable product freeze**。产品后续可调参；若日后当作 durable freeze，须产品说明或实现 ADR 记录，**本轮不新开 ADR**。

| 字段 / 项 | Seed 默认 | 说明 |
| --- | --- | --- |
| 经典番茄 focus / shortBreak / longBreak / longBreakEvery | **25 / 5 / 15 / 4** | 与内置 `classic_25_5` 对齐 |
| `minimumFinalFocusMinutes` | **15** | `adaptive_final_focus` 末段阈值；§5.1 示例同源 |
| `wrapUpMinutes` | **5** | 收尾段建议时长 |
| `windowFillPolicy` | **`adaptive_final_focus`** | 已冻结 #4（§19 / ADR-0094） |
| 番茄 `breakPolicy` | **`ask`** | 已冻结 #3 |
| `estimateMinutes` 默认 | **null / empty** | 已冻结 #8；不自动用 focus 分钟填入 |
| 正计时可疑间隔阈值 | **120 分钟** | 已冻结 #5 → `needs_reconcile` |

交叉引用：§5.1 示例、§5.2 策略名、§19 第 3/4/5/8 条。

### 4.3 方案选择、修改和删除

- 系统内置方案只读，用户可以“复制为自定义方案”。
- 自定义方案支持改名、复制、设为默认、编辑和删除。
- 运行中编辑：
  - 保存方案新版本；
  - 当前 `TimerSession` 保持启动时快照；
  - 明确提示“将在下一段生效”；
  - 可提供“立即重启并应用”，但必须二次确认并结束当前段。
- 删除方案：历史和正在运行的会话继续持有快照；仅阻止未来再次选择。
- 重名方案允许但应提示；方案 ID 才是身份。
- 超出 12 个方案时不应静默截断，应返回明确错误或要求先删除。

---

## 5. 09:00–12:00 的分配规则

### 5.1 推荐默认：自适应填满窗口

对于 09:00–12:00、25 分钟专注、5 分钟短休息、每 4 轮长休息 15 分钟，且最后剩余至少 15 分钟（seed：`minimumFinalFocusMinutes = 15`，见 §4.2 Default values）即可缩短最后一轮：

| 时间 | 类型 | 示例任务 |
| --- | --- | --- |
| 09:00–09:25 | 专注 | 任务 A（第 1 段） |
| 09:25–09:30 | 短休息 | — |
| 09:30–09:55 | 专注 | 任务 A（第 2 段） |
| 09:55–10:00 | 短休息 | — |
| 10:00–10:25 | 专注 | 任务 B（第 1 段） |
| 10:25–10:30 | 短休息 | — |
| 10:30–10:55 | 专注 | 任务 B（第 2 段） |
| 10:55–11:10 | 长休息 | — |
| 11:10–11:35 | 专注 | 任务 C（第 1 段） |
| 11:35–11:40 | 短休息 | — |
| 11:40–12:00 | 自适应专注 | 任务 C（收尾或复习） |

结果：145 分钟专注、35 分钟休息，严格在 12:00 结束。

### 5.2 三种窗口填充策略

#### `complete_cycles`：只放完整轮次

- 只安排完整专注段。
- 末尾不足一轮时留作空白或收尾。
- 适合用户不希望缩短番茄轮次的情况。

#### `adaptive_final_focus`：自适应最后一轮，推荐默认

- 中间轮次保持原方案。
- 最后一段若剩余时间大于最小专注阈值，则缩短最后一轮。
- 窗口结尾不强制再安排一个休息段。
- 适合固定结束时间的学习窗口。

#### `allow_overrun`：完成轮次后允许越过窗口

- 仅作为显式高级选项。
- 生成提案时显示预计超出时间。
- 不得在用户未确认时自动越过后续锁定事件。

### 5.3 排程器的任务分配顺序

排程输入不应只是一条任务。建议按以下规则构造候选：

1. 用户手动锁定到窗口内的任务块。
2. 已开始但未完成的当前任务。
3. 今日到期或已逾期任务。
4. 用户指定优先级。
5. 已估时任务，按剩余估时填充。
6. 无估时任务，按手动顺序填充。
7. 所有任务都用完后，剩余窗口变为“可选复习/收尾”，不自动制造虚假任务。

任务应支持：

- 预计专注分钟数
- 已实际专注分钟数（投影，不直接写回估时）
- 是否允许拆分
- 最小单段时长
- 截止时间
- 手动优先级
- 锁定时间块

### 5.4 提前完成和超时

任务提前完成时提供：

- 开始下一任务
- 提前休息
- 用剩余时间复盘/整理
- 保持当前任务但不自动标记完成

任务超时时提供：

- 延长当前任务并顺延后续未锁定时间块
- 在硬结束时间停止并把剩余量退回任务
- 缩短下一休息，但不得低于用户设置的最小休息
- 切到下一任务并保留当前任务未完成

默认不应自动牺牲休息，也不应静默突破硬结束时间。

---

## 6. 正计时与倒计时

### 6.1 倒计时

适用于时间盒和番茄循环。

- 由目标时长得出结束点。
- 到 0 时产生“段到点”，不自动等于任务完成。
- 可选择自动进入休息、询问或只提醒。
- 暂停后剩余时长不变。

### 6.2 正计时

适用于开放式专注和不知道任务需要多久的场景。

- 从 0 累计。
- 可无目标，也可设置目标提醒点。
- 达到提醒点后继续计时，除非用户选择停止或休息。
- 展示计划时长与超时，但实际事实以会话区间为准。
- 允许用户在结束时将实际时间转换成后续估时参考，但不得自动改写全部相似任务。

### 6.3 实现原则

- 不以每秒写入持久化；保存 `startedAt`、累计暂停时长、上次确认点和状态。
- UI 每秒刷新只是投影。
- 系统时钟变化和休眠恢复使用可靠时钟策略进行校正。
- 正计时遗忘运行不能无限吞入分析：
  - 短休眠可按既有可靠时钟恢复；
  - 超过“可疑间隔”时要求用户确认结束点；
  - 用户可选择保留、截断或丢弃可疑区间。
- 一个任务中途切到另一个任务时，应结束前一个 `TimerSession` 分段，而不是只改 `taskId`。

---

## 7. 任务清单、日程与详情页

### 7.1 建议视图

1. **现在**：正在运行、暂停或即将开始的时间块。
2. **今日时间线**：按开始时间排列专注、休息和收尾段。
3. **收件箱/待归类**：快速创建或自动创建、尚未整理的任务。
4. **全部任务**：支持手动顺序、类别、状态和搜索。
5. **已完成**：完成历史，不与今日开放任务混排。
6. **周计划**：现有 7×24 网格的演进形态。

### 7.2 默认排序

“今日”视图推荐：

1. 正在进行
2. 已逾期未完成
3. 下一条有时间的任务
4. 当日后续计划任务，按开始时间
5. 当日未排程任务，按优先级和手动顺序
6. 完成任务折叠在底部或单独视图

“全部任务”保留用户手动顺序，不因打开“今日排序”而永久重排。

### 7.3 一个任务多个时间块

现有 `StudyTask.schedule?` 最终应演进为任务与时间块分离：

- 任务详情展示所有未来和历史时间块。
- 拖动某个时间块不会复制任务。
- 完成一个时间块不会自动完成任务。
- 完成任务后，未来未开始时间块提示取消、保留为复习或转给其他任务。
- 删除任务时必须询问如何处理未来时间块；历史实际会话保留不可变引用。

### 7.4 清单与详情同步

- 清单、详情、周计划和时钟通过统一 store/interface 读取同一任务。
- 页面之间传递任务 ID，不传整份任务副本作为权威。
- 跨 main/renderer 写入时带 `expectedRevision`，冲突时提示刷新/合并，不静默覆盖。
- 自动建任务与创建当前时间块需要作为一个受控命令处理，避免“时钟启动了但任务没建成”或反向半成功。

---

## 8. 无任务启动时钟

### 8.1 推荐默认交互

点击开始时，若没有显式选择任务：

#### 存在开放任务

弹出轻量选择：

- 使用最近/当前任务
- 选择其他任务
- 新建临时任务并开始
- 不绑定任务直接开始

不推荐继续静默选择数组中的第一条开放任务，因为排序变化会造成意外归属。

#### 没有开放任务

弹出：

- **创建“临时专注”并开始**（推荐按钮）
- 不绑定任务直接开始
- 取消

临时任务应：

- 进入“待归类/收件箱”；
- 标题可预填“临时专注 · 09:00”，并允许当场编辑；
- 自动创建从当前时间开始的计划时间块；
- 立即在清单和详情页可见；
- 与计时会话使用同一任务 ID。

### 8.2 可记忆偏好

用户可选择“以后总是这样做”：

- 总是创建临时任务
- 总是无任务计时
- 每次询问（推荐默认）

偏好必须可在设置中恢复，不得隐藏成为不可逆行为。

### 8.3 失败处理

- 建任务失败：不应偷偷启动为另一任务；允许改为无任务计时或重试。
- 启动计时失败：已建任务保留在收件箱，并提示未启动。
- 并发点击：命令使用 operation ID/revision 幂等，最多生成一个任务和一个会话。

---

## 9. 类别与完成后归类

### 9.1 类别策略

建议区分两件事：

- **用户默认类别**：手动新建任务时预选，例如“学习”。
- **待归类收件箱**：自动/快速创建但语义未知的任务，不应假装已经属于“学习”。

内置类别可以保留“学习、娱乐、锻炼”（对应 id：`study` / `entertainment` / `exercise`），新增不可删除的“待归类”。自定义类别仍由用户维护。

### 9.2 完成后提示

仅在满足以下条件时提示：

- 任务位于待归类；
- 用户开启“完成待归类任务时提醒”；
- 本次不是批量完成或导入迁移。

提示动作：

- 选择一个类别
- 保持待归类
- 稍后处理
- 不再提示

要求：

- 任务先完成，提示后出现；关闭弹窗不能回滚完成。
- 已有类别的任务不提示。
- “不再提示”写入本地偏好，可在设置恢复。
- 收件箱提供批量归类，避免每项都弹窗。

### 9.3 不建议的行为

- 不根据标题自动猜类别并静默写入。
- 不因计时方案名称自动改类别。
- 不把“未归类”统计为“学习”。
- 不把归类弹窗设为完成任务的硬门槛。

---

## 10. 休息设计

### 10.1 休息类型

- 短休息：轮次之间的恢复。
- 长休息：连续 N 轮之后的较长恢复。
- 手动休息：用户随时插入。
- 收尾：学习记录、整理材料、决定下一步；不算休息，也不算任务核心专注。

### 10.2 自动化等级

| 等级 | 行为 |
| --- | --- |
| 自动 | 专注到点自动进入休息倒计时 |
| 询问 | 到点弹出“开始休息/继续/结束” |
| 仅提醒 | 发提醒但保持当前正计时/超时状态 |
| 无 | 不生成休息提醒，适用于显式连续专注 |

推荐默认“询问”，而不是自动抢占用户当前操作。

### 10.3 休息期间

- 休息默认不绑定任务。
- 可以暂停、跳过或延长。
- 跳过休息应记录为用户选择，不应伪造已休息。
- 多次跳过可做本地温和提示，但不能阻止继续。
- 休息结束不应在用户不知情时自动开始下一任务；默认询问或按明确方案偏好。

---

## 11. 提醒、声音与可访问性

### 11.1 提醒

- 段开始前提醒：可选 0/5/10/15 分钟。
- 专注结束、休息结束、计划窗口结束分别可配置。
- 系统通知权限缺失时退化为应用内提醒。
- 声音可独立关闭，不能与系统通知绑定。
- 勿扰时段、演示/全屏时应尊重系统或用户设置。

### 11.2 可访问性

- 所有状态变化有 `aria-live` 文本，不只依赖颜色和声音。
- 正计时/倒计时切换有明确标签。
- 运行、暂停、休息、超时使用文字与图标双重表达。
- 减少动态效果设置下禁用非必要动画。
- 键盘可完成开始、暂停、跳过、选择任务和关闭提示。
- 不以每秒屏幕阅读器播报时间；按合理间隔或用户请求播报。

---

## 12. 边界场景规则

| 场景 | 推荐规则 |
| --- | --- |
| 时间窗口不足一个完整专注段 | 提示缩短、改用正计时或取消，不静默生成 3 分钟番茄 |
| 最后只剩少量时间 | 达到最小阈值则自适应专注，否则转为收尾/空白 |
| 跨午夜窗口 | 第一阶段允许但拆成两个日期块；周视图分别显示 |
| 夏令时切换 | 存绝对时间和时区；展示按当地时间，持续时长按可靠时钟 |
| 系统睡眠 | 短间隔恢复；长间隔要求用户确认实际结束点 |
| 应用崩溃/退出 | 恢复为待确认会话，不自动重复写事实 |
| 计划编辑中计时到点 | 计时事实优先，编辑草稿保留；提示处理到点事件 |
| 任务被删除但计时仍运行 | 不删除历史；当前会话转为“原任务已删除”归属，结束时提示 |
| 任务完成但还有未来时间块 | 询问取消、保留复习或重新分配 |
| 任务提前完成 | 选择下一任务、休息、收尾或结束窗口 |
| 任务超时 | 延长、顺延、停止或拆分，尊重锁定块和硬结束 |
| 用户修改系统时间 | 使用可靠时钟判断持续时长；异常时要求确认 |
| 连续点击开始 | 幂等，不能生成多个会话/临时任务 |
| 多窗口同时操作 | 单 writer + revision 冲突提示；最多一个 active session |
| 删除正在使用的类别 | 任务转入待归类，不默认转成“学习” |
| 批量完成 | 不连续弹出多个归类框；统一进入批量归类入口 |
| 正计时忘记停止一整晚 | 标记可疑区间并要求截断/确认，不全算专注 |
| 无任务且用户关闭自动建任务 | 允许真实的未归属计时，并在分析中单独显示 |

---

## 13. 拟议数据模型

以下仅用于明确职责，最终 wire/file schema 需由 ADR 审批。

```ts
type StudyTaskV2 = {
  id: string
  title: string
  status: 'open' | 'done' | 'cancelled'
  categoryId: string | null
  inbox: boolean
  notes?: string
  estimateMinutes?: number
  remainingEstimateMinutes?: number
  priority?: 'low' | 'normal' | 'high'
  dueAt?: string
  splittable: boolean
  minimumBlockMinutes?: number
  createdAt: string
  completedAt?: string
  revision: number
}

type ScheduleBlock = {
  id: string
  taskId: string | null
  kind: 'focus' | 'short_break' | 'long_break' | 'wrap_up'
  startAt: string
  endAt: string
  locked: boolean
  source: 'manual' | 'allocator' | 'quick_start'
  planId?: string
  planRevision?: number
  status: 'planned' | 'running' | 'completed' | 'skipped' | 'cancelled'
  revision: number
}

type TimerSession = {
  id: string
  taskId: string | null
  scheduleBlockId: string | null
  phase: 'focus' | 'short_break' | 'long_break' | 'wrap_up'
  clockMode: 'countdown' | 'countup'
  state: 'running' | 'paused' | 'completed' | 'cancelled' | 'needs_reconcile'
  targetSeconds: number | null
  startedAt: string
  endedAt?: string
  accumulatedActiveSeconds: number
  planSnapshot: TimerPlanV2 | null
  attributionReason?: 'explicit' | 'quick_start' | 'unattributed' | 'task_deleted'
}

// --- 以下为排程纯函数 I/O 草图（非 wire-final；与 §4.2 TimerPlanV2 字段名对齐）---

type TimeWindow = {
  startAt: string // ISO 或本地 wall-clock；时区策略由实现 ADR 决定
  endAt: string
  hardEnd: boolean // 默认 true：不得静默越过
  label?: string // 例如 "09:00–12:00"
}

type AllocationProposal = {
  window: TimeWindow
  planSnapshot: TimerPlanV2 // 本提案冻结使用的方案字段
  blocks: Array<{
    kind: 'focus' | 'short_break' | 'long_break' | 'wrap_up' | 'blank'
    startAt: string
    endAt: string
    taskId?: string | null
    locked?: boolean
  }>
  warnings: string[] // 实现阶段可改为结构化 code
  unscheduledTaskIds: string[]
  meta?: {
    utilizationRatio?: number
    policy: TimerPlanV2['windowFillPolicy']
  }
}

// pure, no I/O
// allocateTimeWindow(input) -> AllocationProposal
// input: { window, plan, tasks, lockedBlocks, now }
```

> **非 wire-final**：上列草图仅供 Phase 1 纯函数切片对齐职责；正式 schema / 序列化由实现 ADR 审批。不得据此冻结路径或备份文件名。  
> **实现取舍（Phase 1 切片）**：落地代码使用 `startAtMs` / `endAtMs` / `dueAtMs`（epoch ms，caller-local），并在 `ScheduleBlockSource` 增加 `migrated_v1`；与草图 ISO 字符串字段名的差异由实现 ADR 最终裁定。

### 13.1 为什么不继续把 schedule 塞进 Task

- 一个任务天然可能被拆成多个时间块。
- 时间块可以被拖动、取消或重排，但任务仍然存在。
- 休息和收尾也需要进入时间线，却不是任务。
- 计划时间与实际会话需要分别统计。
- 删除/完成任务时可以单独处理未来计划和历史事实。

---

## 14. 持久化与架构安排

### 14.1 canonical 与投影

规划数据已经超出临时 UI 偏好，应遵守“文件是真相源”：

- 任务、时间块、时钟方案和已结算会话的 canonical 数据应落在 Teaching workspace 的受控文件中。
- localStorage 只保留 UI 偏好、折叠状态、临时草稿或可重建缓存。
- SQLite 若参与，仅可作为可重建本地分析投影，不作为任务/排程权威，也不引入 FTS 产品搜索。
- 文件路径、schema、发布顺序、备份与迁移必须通过独立 ADR 决定；本规划不擅自冻结具体路径。

### 14.2 单 writer 与命令

建议由一个深模块封装复杂性：

```ts
interface StudyPlanningStore {
  readSnapshot(): StudyPlanningSnapshot
  applyCommand(command: StudyPlanningCommand, expectedRevision: number): StudyPlanningResult
}
```

命令闭集示例：

- `create_task`
- `update_task`
- `complete_task`
- `save_timer_plan`
- `apply_allocation_proposal`
- `start_timer_session`
- `pause_timer_session`
- `resume_timer_session`
- `finish_timer_session`
- `switch_session_task`
- `reconcile_stale_session`
- `quick_start`（协调建任务 + 块 + 会话；见 §14.3）

#### 命令信封草图（非 wire-final）

| command | key fields（草图） | notes |
| --- | --- | --- |
| `start_timer_session` | `taskId?`, `planId`, `mode`, `expectedRevision`, `actionId` | 同一空间最多一个 running session |
| `apply_allocation_proposal` | `proposalId`/`hash`, `expectedRevision` | 用户确认后才写入；提案本身无副作用 |
| `quick_start` | `title?`, `emptyStartPolicy`, `expectedRevision`, `actionId` | 部分失败状态须显式（§8.3 / §14.3） |
| `reconcile_stale_session` | `sessionId`, `userDecision`, `expectedRevision` | 不得静默把长睡眠算作专注 |

> **不是 wire-final**；StudyPlanningStore 落地时由实现 ADR 定信封、错误码与 effect 映射。

复杂排程应隐藏在纯 `allocateTimeWindow(input) -> AllocationProposal` 模块后；UI 不应散落计算循环、休息和尾段的规则。

### 14.3 一致性

- `quick_start` 的“建任务 + 建时间块 + 启动会话”应由一个命令协调，返回明确的部分失败状态。
- 所有 IPC 写操作带 `expectedRevision` 和 operation/action ID。
- exact retry 不得重复创建任务或会话。
- 历史会话 append/settlement 仍由唯一 writer 路径完成。
- fork/replay 不得重放真实计时副作用。

### 14.4 迁移

从当前 snapshot 迁移时：

- 现有任务保留 ID、标题、done、category。
- 单个 `schedule` 转为一个 `ScheduleBlock`。
- 现有方案转为 `TimerPlanV2`：默认无长休息或按兼容默认补齐，迁移报告必须明确。
- `simulationStartTime/EndTime` 只迁移为“常用窗口建议”，不得误当历史日程。
- 现有 active/paused timer 若不能可靠映射，进入 `needs_reconcile`，由用户确认。
- 类别独立 localStorage key 迁入 canonical 时需要去重、保留自定义颜色和稳定 ID。
- 迁移应可 dry-run、可备份、失败关闭；不得静默丢任务或时间事实。

---

## 15. 推荐模块与 seam

目标是通过少量 interface 隐藏复杂规则，而不是继续增大 `WorkbenchPomodoro.tsx`、`StudyTaskSchedulePage.tsx` 或 `useStudySession.ts`。

| 模块 | Interface 责任 | 主要隐藏的 implementation |
| --- | --- | --- |
| `timer-plan` | 规范化、验证、版本化方案 | 上限、默认值、兼容迁移 |
| `time-window-allocator` | 输入窗口、方案和任务，返回提案 | 循环、长休息、尾段、锁定块、任务拆分 |
| `study-planning-store` | 读 snapshot、按命令写入 | canonical 文件、revision、幂等、备份 |
| `timer-session-lifecycle` | 开始、暂停、恢复、切换、结束、恢复异常 | 可靠时钟、睡眠、事实分段 |
| `empty-start-policy` | 决定询问/临时任务/未归属 | 偏好、默认标题、一次性引导 |
| `task-classification-policy` | 决定是否提示归类 | inbox、完成、批量、opt-out |
| `task-timeline-projection` | 构建“现在/今日/全部”列表 | 排序、逾期、下一任务、完成折叠 |

删除 `time-window-allocator` 时，循环、尾段、长休息和冲突规则会散落到多个 UI；因此它应成为深模块。

---

## 16. 分阶段任务清单

### Phase 0 — 产品决策与架构门（P0）

- [x] **STC-001** 冻结六层领域术语和关系。 → **已冻结**：Task / TimeWindow / TimerPlan / AllocationProposal / ScheduleBlock / TimerSession；见 [ADR-0094](adr/0094-study-task-timer-planning-design-gate.md) + 本文 §2。
- [x] **STC-002** 确认 canonical 文件范围、schema 版本和 workspace 路径。 → **原则已冻结、路径未冻结**：workspace-scoped controlled files 为真相源；localStorage 非长期权威；SQLite 仅可重建分析；具体 path/schema/backup 留给实现 ADR（候选 `.studiumx/study-planning/` **仅建议**）。见 ADR-0094。
- [x] **STC-003** 新建 ADR：规划数据权威、单 writer、revision、迁移和恢复。 → **已完成**：[ADR-0094](adr/0094-study-task-timer-planning-design-gate.md)（design gate / decision freeze；无生产行为变更）。
- [x] **STC-004** 决定是否新增内置 `inbox` 类别，或使用 `categoryId: null`。 → **已冻结**：`categoryId: null` + `inbox: true`；内置非可删「待归类」为 **投影**，不是静默 `study` 默认。见 ADR-0094。
- [x] **STC-005** 决定无任务启动默认：每次询问、自动临时任务或未归属。 → **已冻结**：empty-start 默认 **`ask_every_time`**（可记偏好、设置可恢复）。见 ADR-0094。
- [x] **STC-006** 决定正在运行时修改方案的用户规则。 → **已冻结**：running 会话 **snapshot 冻结**；编辑只影响下一段；切换任务分段；重启/覆盖需确认。见 ADR-0094。
- [x] **STC-007** 决定系统通知、声音和休息自动化默认值。 → **已冻结**：番茄到点休息默认 **ask**；`sound` / `systemNotification` 独立开关；连续专注可显式设 `breakPolicy: none` / `reminder_only`，不得作番茄静默默认。见 ADR-0094。
- [x] **STC-008** 定义 V1→V2 dry-run 迁移报告与失败策略。 → **已冻结**：V1→V2 必须 **dry-run** + **fail-closed**；备份保留 **≥30 天** 产品推荐或用户确认擦除；精确路径 TBD（实现 ADR）。见 ADR-0094。
- [x] **STC-009** 更新 `CONTEXT.md` 采用最终术语，避免“Session”与教学 Session 混淆；计时领域建议始终使用 `TimerSession`。 → **已冻结术语**：计时领域始终 `TimerSession`，不可与教学 `LearningSession` / `Session` 混淆；见 CONTEXT.md TimerSession 词条 + ADR-0094。

**验收：** Phase 0 design gate **已关闭**——ADR-0094 与术语已冻结；未在实现前错误冻结具体文件路径；**生产 wiring / canonical 写路径尚未开始**（Phase 1 纯函数切片见下节与 §1.4）。

### Phase 1 — 纯领域模块与排程提案（P0）

- [x] **STC-101** 实现 `TimerPlanV2` 规范化与验证。 → 规则：§4.2 + Default values seed；字段与 §13 草图对齐 → **已落地**：`timer-plan.ts` + 单测（纯代码；UI 未 wire）
- [x] **STC-102** 实现 `allocateTimeWindow` 纯函数。 → 规则：§5 + §13（`TimeWindow` / `AllocationProposal` I/O） → **已落地**：`allocate-time-window.ts` + 单测
- [x] **STC-103** 支持 `complete_cycles` 和 `adaptive_final_focus`。 → 规则：§5.2 + 冻结 #4 / §19.4 → **已落地** + 单测
- [x] **STC-104** 支持短休息、每 N 轮长休息、收尾段。 → 规则：§4.2 + §5.1 + §10 + seed `wrapUpMinutes` → **已落地** + 单测
- [x] **STC-105** 支持锁定时间块和无重叠约束。 → 规则：§3.2 #2/#8 + §5.3 → **已落地** + 单测
- [x] **STC-106** 支持任务估时、拆分许可、最小块时长。 → 规则：§5.3 + 冻结 #8 / §19.8（默认 estimate null） → **已落地** + 单测（null 估时、非拆分跳过、minimumBlockMinutes）
- [x] **STC-107** 生成 warnings：窗口不足、剩余无法利用、超时、与锁定块冲突。 → 规则：§5.2–§5.4 + §12 + §13 `warnings` → **已落地** + 单测（window_too_short、remainder_below_minimum_final_focus、locked_overlap、unscheduled_tasks）
- [x] **STC-108** 建立 `Task 1:N ScheduleBlock` 模型与迁移 adapter。 → 规则：§13 + §13.1 + §7.3 → **已落地**（`schedule-block.ts` / `migrate-v1.ts` dry-run + 单测）

**验收：** 排程器无副作用；输入相同则输出确定；所有块有序、无重叠、默认不越过硬结束。  
（截至 2026-07-21：STC-101..108 已由 `tests/unit/study-planning-allocator.unit.test.ts` 验证；renderer / store **未** wire。）

### Phase 2 — 计时会话 V2（P0/P1）

- [x] **STC-201** 在生命周期中加入 `countdown` / `countup`。 → 规则：§6 + §4.2 `clockMode` → **纯模块已落地**（`timer-session-lifecycle.ts` + 单测；renderer 未 wire）
- [x] **STC-202** 支持目标正计时和开放式正计时。 → 规则：§6.2 → **已测**（open countup + target countup）
- [x] **STC-203** 方案快照冻结，编辑只影响下一段。 → 规则：§4.3 + ADR-0094 planSnapshot / 冻结项 STC-006 → **已测**（start 时 clone planSnapshot）
- [x] **STC-204** 支持任务切换时事实分段。 → 规则：§3.2 #7 + §6.3 → **已测**（`switchTimerSessionTask`）
- [x] **STC-205** 支持短休息、长休息、跳过、延长和收尾。 → 规则：§10 + 冻结 #3/#6 → **部分**：到点 `phase_prompt` + `startNextPhaseFromCompleted`（ask 确认）；跳过/延长 UI 未做
- [x] **STC-206** 支持系统睡眠、应用退出和 stale session reconcile。 → 规则：§6.3 + §12 + 冻结 #5（120 min）+ §14.2 `reconcile_stale_session` → **纯路径已测**（confirm/truncate/discard）；无 OS 集成
- [x] **STC-207** 保持一个 active session；重复命令幂等。 → 规则：§3.2 #1 + §14.2–§14.3 → **已测**（lifecycle assert + `StudyPlanningStore` actionId retry）
- [x] **STC-208** 保持现有本地 analytics 兼容并明确计划/实际口径。 → 规则：§14.1（SQLite 可重建投影）+ 产品地板 → **纯投影** `projectTaskPlanVsActual` 已测；**未**接现有 analytics ledger

**验收：** 正/倒计时均能暂停、恢复（纯函数层）；无重复会话；可疑长间隔不静默计入。**Renderer / durable file / OS sleep 钩子尚未 wire。**

### Phase 3 — 任务、清单详情与时间线（P1）

- [x] **STC-301** 统一 task store，清单/详情/周计划只传 ID。 → 规则：§7.4 + §14.2 sole-writer → **内存 `StudyPlanningStore` 统一 tasks/blocks**；**IPC + durable 已 wire**；renderer **partial**：planning-client dual-write create/complete/**update**（同 ID）+ schedule upsert + **migration commit 可用**；清单仍投影 V1 localStorage 缓存（hydrate sole-read 当 canonical 有任务）
- [x] **STC-302** 新增“现在、今日、待归类、全部、已完成”视图。 → 规则：§7.1 → **纯投影** `projectTaskTimeline` 已测；renderer **WorkbenchTasks** tabs via `planning-task-timeline-adapter`（V1 tasks → projection → 有序列表；默认今日）
- [x] **STC-303** 今日列表按时间排序且不破坏手动顺序。 → 规则：§7.2 + §3.2 #13 → **已测**（`manualOrder` 保留）
- [x] **STC-304** 任务详情显示估时、实际时间、未来/历史时间块。 → 规则：§7.3 + 冻结 #8 → **投影字段** planned/actual/blocks；UI 未做
- [x] **STC-305** 支持一个任务多个时间块。 → 规则：§7.3 + §13.1 → **模型+投影已测**
- [x] **STC-306** 完成任务时处理未来时间块。 → 规则：§7.3 + §12 + 冻结 #7 → **`applyCompleteTaskFutureBlocks` + store effect** 已测；renderer **FutureBlocksDecisionSheet** + complete dual-write decision follow-up（wire aliases）已测
- [ ] **STC-307** 周计划拖拽改为操作 `ScheduleBlock`，不是复制任务。 → 规则：§7.3 + §3.2 #8 → **仅** `upsert_schedule_block` 命令；renderer **partial**：week-drag → V1 update + dual-write `upsert_schedule_block`（`block:${taskId}:v1` 单块）；**multi-block 周 UI / 不经 V1 直写 block 未做**
- [x] **STC-308** 提供排程提案预览、差异和确认。 → 规则：§0 #8 + §5 + §13 `AllocationProposal` + §14.2 apply → **`diffScheduleBlocks` + `apply_allocation_proposal`** 已测；预览 UI 未做

**验收（纯层）：** 单 store 修订；时间线投影；完成+未来块决策 effect。**页面未共享 revision。**

### Phase 4 — 无任务启动与分类（P1）

- [x] **STC-401** 替换“静默第一条开放任务”为显式 empty-start policy。 → 规则：§8 + 冻结 #1 / §19.1 → **`resolveFocusStartAttribution` + EmptyStartSheet**（pick/quick/unattributed；废除 `window.confirm` 二选一）
- [x] **STC-402** 实现快速创建临时任务并启动。 → 规则：§8.1 + §14.2 `quick_start` + §14.3 → **store `quick_start` 已测**；UI 弹层可创建临时任务并 dual-write `source:quick_start`（TimerSession durable 仍属 Slice D）
- [x] **STC-403** 实现“无任务计时”并在分析中单列。 → 规则：§8.1 + §12 末行 → **unattributed session + planVsActual.unattributed**；启动路径已可无任务
- [x] **STC-404** 实现可恢复的记忆偏好。 → 规则：§8.2 → **`set_preferences.emptyStartPolicy`**；设置页未接
- [x] **STC-405** 新增待归类/收件箱。 → 规则：§9 + 冻结 #2 / §19.2 → **inbox 字段 + 投影**
- [x] **STC-406** 完成后非阻塞归类提示。 → 规则：§9.2 + §3.2 #12 → **effect `classification_prompt_suggested`；不阻塞 complete**
- [x] **STC-407** 支持“保持待归类、稍后、不再提示”。 → 规则：§9.2 → **`applyClassificationAction`**
- [x] **STC-408** 支持批量归类，批量完成不弹窗风暴。 → 规则：§9.2 + §12 批量完成 → **`batchClassifyTasks` + store `batch_classify_tasks`**；UI 未做

**验收（纯层）：** quick_start 最多一个任务；关归类不回滚完成。**产品 UI 仍走 V1 静默路径直至 wire。**

### Phase 5 — 时钟方案管理与长时间专注（P1）

- [x] **STC-501** 系统方案只读 + 复制为自定义。 → 规则：§4.1 内置目录 + §4.3 → **`listBuiltinTimerPlans` / `copyTimerPlanAsCustom` / store `copy_timer_plan`**
- [x] **STC-502** 方案重命名、复制、设默认、编辑和删除。 → 规则：§4.3 → **catalog helpers + save/delete/copy 命令**；UI 未做
- [x] **STC-503** 显示“当前会话使用的方案快照”和“下一段方案”。 → 规则：§4.3 + STC-203 / planSnapshot → **`projectActiveVsNextTimerPlan`**；UI 未做
- [x] **STC-504** 连续专注正计时。 → 规则：§4.1 B + §6.2 + 冻结 #6 → **lifecycle continuous countup（Phase 2）**
- [x] **STC-505** 30–240 分钟连续倒计时。 → 规则：§4.1 B → **`validateContinuousCountdownMinutes`**
- [x] **STC-506** 休息策略：自动、询问、仅提醒、无。 → 规则：§10.2 + 冻结 #3/#6 → **TimerPlanV2 breakPolicy + phase_prompt ask 门控**
- [x] **STC-507** 达到方案上限时返回错误，不静默丢弃方案。 → 规则：§4.3（>12 明确错误） → **store 拒绝 >12**
- [x] **STC-508** 增加 09:00–12:00 等常用窗口模板，但与 TimerPlan 分开保存。 → 规则：§4.2 + §5 + §13 `TimeWindow` → **`BUILTIN_TIME_WINDOW_TEMPLATES`**

**验收（纯层）：** 连续专注策略与方案上限/模板分离已测。**方案管理 UI 未 wire。**

### Phase 6 — 提醒、可访问性与体验抛光（P1/P2）

- [x] **STC-601** 应用内提醒和系统通知 fallback。 → 规则：§11.1 + §22.1 → **`resolveNotificationChannels`**（host 仍须接 OS）
- [x] **STC-602** 声音、系统通知、专注结束和休息结束独立开关。 → 规则：§11.1 + §4.2 notificationPolicy → **policy 字段驱动**
- [x] **STC-603** 键盘操作与 screen reader 状态文案。 → 规则：§11.2 → **`timerStatusAriaLabel`**；键盘路径 UI 未做
- [x] **STC-604** reduced-motion 与非颜色状态表达。 → 规则：§11.2 → **纯层无动画；UI 标记待做**
- [x] **STC-605** 勿扰/全屏尊重策略。 → 规则：§11.1 + §12 → **DND/fullscreen 分支已测**
- [x] **STC-606** 计划偏差提示：提前、超时、跳过休息。 → 规则：§5.4 + §12 + §17.4 → **`detectPlanDeviations`**
- [x] **STC-607** 本地复盘：计划时间、实际时间、未归属时间、休息完成率。 → 规则：§18 + 本地 analytics → **`projectLocalReviewStats`**

**验收（纯层）：** 无系统权限时仍可决策 in-app；无默认远程外发。**OS 通知 / a11y 组件未接。**

### Phase 7 — 高级排程（P2，产品信号触发）

- [x] **STC-701** 多窗口日计划。 → 规则：§5 + §13 TimeWindow → **`allocateMultiWindowDay`**
- [ ] **STC-702** 自定义节奏序列。 → 规则：§4.1 C 后续 + §21 → **明确未做**（待番茄+连续产品稳定）
- [ ] **STC-703** 重复任务/重复时间块。 → 规则：§7.3 → **未做**
- [ ] **STC-704** 跨日、时区旅行与 DST 高级编辑。 → 规则：§12 → **未做**
- [x] **STC-705** 提案比较：25/5、50/10、连续专注的利用率。 → 规则：§5 + meta.utilizationRatio → **`compareAllocationUtilization`**
- [x] **STC-706** 基于用户确认的历史估时建议；不自动改任务。 → 规则：§5.3 + 冻结 #8 → **`suggestEstimateMinutesFromHistory`（只建议）**
- [x] **STC-707** 冲突解决器和多任务拖拽重排。 → 规则：§5.3 + §7.3 → **`findScheduleConflicts` 冲突列表**；拖拽 UI 未做

**验收（纯层部分）：** 多窗口/比较/估时建议/冲突检测可用。**STC-702..704 与拖拽 UI 分期缺口见下。**

---

## 17. 测试矩阵

### 17.1 纯函数单元测试

- 25/5、50/10、90/15、连续专注。
- 每 2/3/4/8 轮长休息。
- 1–240 分钟窗口边界。
- 最后一段刚好等于、略小于、略大于最小阈值。
- 锁定块在开始、中间、结尾。
- 任务可拆/不可拆、估时不足/超出。
- 不变量性质测试：有序、无重叠、非负时长、默认不越界、总时长守恒。

#### 场景 ↔ STC 映射（审计锚点）

| 场景（保持上列用例） | 主要 STC / 冻结 | 实际覆盖（2026-07-21） |
| --- | --- | --- |
| 25/5 自适应尾段 | STC-102 / 103 / 104 | **已测**（`study-planning-allocator.unit.test.ts`） |
| 50/10 / 连续专注 / 长休息 every 2–3 | STC-102 / 104 | **已测**（50/10、continuous、longEvery 2/3） |
| 锁定块无重叠 | STC-105 | **已测** |
| 任务拆分 / 最小块 / null 估时 | STC-106 + 冻结 #8 | **已测**（null 估时、non-splittable 跳过、minimumBlockMinutes） |
| warnings（窗口不足、冲突、不可利用） | STC-107 | **已测**（window_too_short、remainder_below_minimum_final_focus、locked_overlap、unscheduled_tasks） |
| Task 1:N ScheduleBlock adapter | STC-108 | **已测**（validate + migrate dry-run + proposal→blocks） |
| 可疑正计时 120 分钟 | STC-206 + 冻结 #5 | 未实现 |
| empty-start 每次询问 | STC-401 + 冻结 #1 | **弹层+纯模型已测**（EmptyStartSheet；非 e2e 全路径） |
| inbox 归类 | STC-405 / 406 + 冻结 #2 | 未实现（migrate dry-run 投影有 inbox 字段） |

**§17.1 纯函数矩阵（Phase 1）：** 主路径已覆盖；可选加深：90/15、longEvery 8、1–240 分钟全扫描、性质 fuzz。

其余 §17.2–§17.4 场景在对应 Phase 验收中交叉核对；本表不替代完整用例列表。

### 17.2 生命周期测试

- 正计时开始/暂停/恢复/结束。
- 倒计时到点、跳过休息、延长休息。
- 修改方案不影响当前快照。
- 切任务产生两个事实段。
- 系统睡眠、时钟回拨、应用重启、崩溃恢复。
- stale session 选择保留、截断、丢弃。
- cancel/retry 不重复写会话。

### 17.3 持久化与 IPC

- V1→V2 dry-run 与真实迁移。
- categories 独立存储迁移。
- `expectedRevision` 冲突。
- action ID exact retry。
- quick start 原子/部分失败矩阵。
- 不可读文件备份恢复和 fail-closed。
- 多窗口并发写入只有一个 active session。

### 17.4 UI 测试

- 无任务、有开放任务、有选中任务三种启动流程。
- 完成待归类任务后的四个动作。
- “不再提示”可在设置恢复。
- 运行中编辑方案提示“下一段生效”。
- 今日清单排序与手动顺序不互相污染。
- 周计划拖拽只移动时间块。
- 任务完成后未来块处理。
- 通知被拒绝时 fallback。
- 键盘、焦点管理、aria-live、reduced-motion。

### 17.5 必跑门禁建议

涉及生产 TS 至少：

```bash
pnpm typecheck
pnpm test:unit
```

涉及 canonical 文件、IPC、writer、revision 或路径时叠加：

```bash
pnpm run check:security
pnpm run check:teaching-ipc-contract
pnpm run check:blocking-ci
```

若新增正式架构决定：

- 新增 ADR 并链入 `docs/adr/README.md`
- 更新相关 contract/check，而不是只补泛型覆盖率
- 如触达历史巨石，按 ADR-0075 peel，保持模块目标与 sole-writer 边界

---

## 18. 完成定义

功能不能仅以“计时器能动”为完成。完整完成定义：

- 用户能明确理解任务、时间块、方案和实际计时的区别。
- 09:00–12:00 可以生成可解释、可修改、可确认的专注/休息安排。
- 正计时、倒计时和连续专注都能可靠恢复。
- 无任务启动不会产生意外归属；快速创建能同步到清单与详情。
- 一个任务可跨多个时间块，计划与实际分别保留。
- 完成后归类可用、可跳过、可永久关闭并可恢复设置。
- 方案修改不篡改当前会话和历史。
- 睡眠、崩溃、并发和 retry 不重复记时、不丢任务。
- canonical 仍是受控本地文件；localStorage/SQLite 不是长期教学权威。
- 不新增默认远程 telemetry，不绕过 revision/sole-writer/effect 产品地板。
- 领域单元、生命周期、迁移、IPC 和关键 UI 测试全部通过。

---

## 19. Phase 0 决策冻结结果

以下条目原为开放决策，现已在 Phase 0 design gate 中关闭。

- **长期权威**：[ADR-0094](adr/0094-study-task-timer-planning-design-gate.md)；本文件 §0 / §16 / §19 展开细节。
- **`docs/_agent-work/phase0-freeze-package.md`** 仅为 workstream 编排包（ephemeral），**不是**长期 sole authority；不得与 ADR 并列为对等权威。
- 数值 seed（`minimumFinalFocusMinutes` 等）见 §4.2 Default values；路径 / schema 仍未冻结（#9 / #10）。

1. **已冻结**：无任务启动默认 **`ask_every_time`（每次询问）**；允许偏好记忆与设置恢复。
2. **已冻结**：待归类采用 **`categoryId: null` + `inbox: true`**（不是伪造 `study` 类别）。内置非可删「待归类」是 **投影**，自定义类别仍归用户。
3. **已冻结**：番茄到点默认休息策略 **`ask`（询问）**，不是自动进入休息。
4. **已冻结**：末段剩余时间：若 remaining ≥ `minimumFinalFocusMinutes` → **`adaptive_final_focus`**；否则 wrap_up / blank。默认 `windowFillPolicy`: **`adaptive_final_focus`**。数值 seed：`minimumFinalFocusMinutes = 15`（§4.2 Default values；非 path/schema 冻结）。
5. **已冻结（默认值文档化；实现后置）**：连续正计时可疑间隔默认 **120 分钟**；超出需用户确认 / 截断 / 丢弃并标 `needs_reconcile`。
6. **已冻结**：用户可完全关闭休息提醒——**仅**通过显式 continuous plan 的 `breakPolicy: none` / `reminder_only`；**不得**作为番茄静默默认。
7. **已冻结**：任务完成时若存在未来时间块 → **每次询问**（取消 / 保留为复习 / 改派）；无静默批量取消默认。
8. **已冻结**：默认 `estimateMinutes` 为 **empty/null**（不自动用方案 focus 分钟填入）。
9. **原则已冻结；路径延期到实现 ADR**：canonical 须 workspace-scoped controlled files；localStorage 非长期权威；SQLite 仅可重建分析。候选布局 `.studiumx/study-planning/` **仅建议**，**不**在本 ADR 冻结具体 path / 拆分 / 备份格式。
10. **策略已冻结；精确路径延期**：V1→V2 迁移后 localStorage 备份保留 **≥30 天** 产品推荐，或直到用户确认擦除；**fail-closed** + **dry-run** 必做；精确备份路径与回退命令留给实现 ADR。

---

## 20. 建议首个可交付切片

**设计门已授权；Phase 1 纯函数切片（条目 2–4 与条目 6 的单测部分）已落地；条目 5 UI 预览与可访问预览交互尚未实现。** Phase 0（含 [ADR-0094](adr/0094-study-task-timer-planning-design-gate.md)）已关闭。截至本规划日期 **未实现任何生产 wiring（UI / store / IPC / canonical 路径）**；Phase 1 纯领域模块与 STC-101..107 单测已落地于 `src/shared/study-planning/`（见 §1.4）。**不得**据此宣称面向用户的功能已交付。

不要第一步就重写周计划或整个计时器。建议首个切片只完成：

1. ~~ADR/design gate~~ → **已完成（ADR-0094）**；
2. `TimerPlanV2` 纯类型与验证 → **已落地**（`timer-plan.ts`）；
3. `allocateTimeWindow` 纯函数 → **已落地**（`allocate-time-window.ts`）；
4. 09:00–12:00 的 25/5 + 长休息 + 自适应尾段预览 → **纯函数结果已由单测验证**；**UI 预览未做**；
5. 不写 canonical、不启动真实计时，只在 UI 展示“排程提案” → **未完成**（无 renderer wiring；仍禁止写盘）；
6. 通过纯函数单测和可访问的预览交互验证产品规则 → **纯函数单测已完成**（STC-101..107）；**可访问预览交互未做**；STC-108 单测待补。

这能先回答最关键的问题——“一段可用时间怎样被专注、休息和任务合理填充”——同时不提前扰动现有生命周期、sole-writer 和数据迁移。**下一可交付小步：** 补 STC-108 单测；可选只读 UI 展示 `AllocationProposal`（仍不写 canonical）。

---

## 21. 延后至实现 ADR / 后续阶段

下列事项**故意不在本规划文档冻结**。**延期 ≠ 产品未决**：凡 Phase 0 已冻结的产品规则（§19）仍然有效。

| 延后项 | 归属 | 备注 |
| --- | --- | --- |
| 具体 canonical 路径 / 文件拆分 / 备份文件名 | 实现 ADR | 冻结 #9 / #10；STC-002 / 008 原则已定 |
| wire schema 版本与序列化字段 | 实现 ADR | §13 仅为职责草图，非 wire-final |
| StudyPlanningStore 命令信封与错误码 | 实现 ADR | §14.2 草图；落地时沉淀 |
| OS 通知权限 UX 细节 / 勿扰与全屏边界 | Phase 6 | §11 原则已写 |
| SQLite analytics schema | 实现侧 / 本地投影 | 仅可重建；非任务权威；禁止 FTS 产品搜索 |
| 自定义节奏序列编辑器 | Phase 7 / 产品信号 | §4.1 C |
| 迁移 crash/restart 失败矩阵细表 | 实现 ADR | dry-run + fail-closed + ≥30d 备份原则已冻结 |
| `allow_overrun` 高级默认与 UI 文案 | 后续产品调参 | 非默认策略 |
| 精确 reconcile UX 文案与选项布局 | Phase 2 实现 | 120 min 阈值已冻结 #5 |

---

## 22. 规划元信息

### 22.1 Non-goals（本规划轨不授权）

- 默认 shell / YOLO / MCP marketplace / 远程 telemetry / FTS 产品搜索
- 重写教学 `LearningSession` settlement 或绕过 sole-writer
- 将「静默自动休息」作为番茄默认（与冻结 #3 冲突）
- 在纯函数切片之前冻结具体 path / backup 文件名
- 无用户控制的 AI 自动类别猜测与静默写入

### 22.2 风险与缓解（简）

| 风险 | 缓解 |
| --- | --- |
| localStorage 权威蔓延 | 文件是真相源；迁移 dry-run + fail-closed；localStorage 仅偏好/草稿 |
| 双 writer / 双任务副本 | `StudyPlanningStore` sole-writer + `expectedRevision`；页面只传 ID |
| Session 命名回退 | 计时永远 `TimerSession`，不与 `LearningSession` 混用（STC-009） |
| 静默 auto-break / 静默绑定首任务 | 冻结 #3 / #1；UI 与偏好可恢复 |

### 22.3 依赖

| 文档 | 作用 |
| --- | --- |
| [ADR-0094](adr/0094-study-task-timer-planning-design-gate.md) | Phase 0 设计门与十项冻结 |
| [ADR-0003](adr/0003-critical-json-backups-and-verified-recovery.md) | 关键 JSON 备份与可验证恢复精神 |
| [ADR-0008](adr/0008-learning-session-ledger-as-canonical-teaching-process.md) | 教学 Session / ledger 权威；计时须与之消歧为 `TimerSession` |
| [ADR-0021](adr/0021-agent-run-state-machine-separate-from-session.md) | AgentRun 与 Session 状态机分离（防命名/生命周期混用） |
| [ADR-0023](adr/0023-teaching-turn-coordinator-host-and-blocking-ci.md) | sole-writer / 窄而硬 Blocking CI 精神 |
| [ADR-0075](adr/0075-module-size-policy-and-giant-peel.md) | 模块尺寸与 peel |
| [`CONTEXT.md`](../CONTEXT.md) Study planning language | 六层核心术语 |
| [`AGENTS.md`](../AGENTS.md) 产品地板 | 无 shell/YOLO/MCP/telemetry/FTS；文件真相；sole-writer |

> 链接以仓库 `docs/adr/` 实际文件名为准；不借此重开 Phase 0 产品决策。

### 22.4 规划文档状态与简短 changelog

- **Status**：Phase 0 closed；Phase 1–7 pure + store + durable + IPC landed；**renderer cutover partial** (tasks dual-write create/complete/update+schedule + migration + empty-start + hydrate + focus TimerSession dual-write + STC-306 future-blocks + STC-302 timeline list views, 2026-07-21)；§18 **not** satisfied；gaps: timer sole-read UI / per-tick advance publish / STC-307 multi-block UI / Plans / notifications / STC-702/703/704。
- **Changelog**：
  - 2026-07-21 — Renderer cutover STC-302 timeline UI：`planning-task-timeline-adapter` maps V1 tasks → `projectTaskTimeline` views；WorkbenchTasks 五视图 tabs + empty labels；OfficeWorkbench activeTimer for 现在；family 193 green；**§18 still open**。
  - 2026-07-21 — Renderer cutover updateTask dual-write：`planning-task-update-dual-write.ts` + `buildUpdateTaskCommand`/`updatePlanningTask`；`useStudySession.updateTask` → update_task + schedule upsert；Mon-first weekday boundary (`monFirstScheduleToIntervalMs`) + hydrate reverse；fix `v1ScheduleToIntervalMs` day delta (was 24 minutes)；family 185 green；**§18 still open**。
  - 2026-07-21 — Renderer cutover STC-306 future-blocks：`future-blocks-decision-sheet` pure normalize/model；`FutureBlocksDecisionSheet`；OfficeWorkbench Promise host；`useStudySession` complete → effect → ask → second `dualWriteCompleteTask` with decision；wire map cancel_blocks/keep_as_review→cancel/keep_review；store second-complete-with-decision 已测；family 172 green；**§18 still open**。
  - 2026-07-21 — Renderer cutover D partial：`planning-timer-dual-write.ts` start/pause/resume/finish → IPC；`useStudySession` focus 路径 dual-write（V1 仍为 UI clock）；不 thrash advance；store 单 running 不变量可拦截；timer dual-write 单测；family 160 green；**§18 still open**。
  - 2026-07-21 — Renderer cutover hydrate：`planning-hydrate.ts` sole-read project/merge；`useStudySession` effect on workspaceRoot；race-safe skip via expectedHostTasks + getCurrentHostTasks；canonical empty → keep V1 + migrationSuggested；timer/presence 仍 V1；hydrate 单测 + family 148 green；**§18 still open**。
  - 2026-07-21 — Renderer cutover C：`EmptyStartSheet` + `empty-start-sheet` pure model；OfficeWorkbench 异步 ask 宿主（pick/quick_start/unattributed）；`useStudySession` async empty-start + V1 quick_start create dual-write；单测 sheet model/UI；**§18 still open**。
  - 2026-07-21 — Renderer cutover B：`import_migration_commit` 进 StudyPlanningCommandType/store/IPC；`applyImportMigrationCommit` pure；durable 写 `backups/snapshot-…` + `migration-report-latest.json`；renderer `planning-migration.ts` dry-run→confirm→commit；`useStudySession.migrateV1ToCanonicalPlanning`；migration-commit 单测；family 126 green；**不自动擦除 localStorage**；§18 still open。
- 2026-07-21 — Renderer cutover A：planning-client + planning-dual-write；useStudySession create/complete → IPC durable；OfficeWorkbench workspaceRoot；study-planning-client 13 tests；family 112 green；§18 still open。
  - 2026-07-21 — Phase 3–7 pure helpers：timeline/empty-start/catalog/notification/advanced；store 扩展 apply/quick_start/batch/copy/delete；单测 79；诚实标注 UI/durable 缺口。
  - 2026-07-21 — Phase 2 纯层：`timer-session-lifecycle.ts`、`study-planning-store.ts`（内存 sole-writer / CAS / actionId）；单测 49 绿；STC-201..208 勾选（注明 UI/durable 缺口）。
  - 2026-07-21 — Phase 1 收尾：STC-108 单测补齐；allocator 加深 50/10、continuous、longEvery、non-splittable、min-block、warnings；尾段 `continue` 修 remainder 路径；路线图勾选 STC-108。
  - 2026-07-21 — 状态诚实化：对齐 `src/shared/study-planning/` 与 `tests/unit/study-planning-allocator.unit.test.ts`；勾选 STC-101..107；§1.4 / §13 / §17.1 / §20 / 页眉同步；STC-108 标为代码已落地、测试待补；无新 durable freeze，不新开 ADR。
  - 2026-07-21 — Phase 0 关闭：ADR-0094 + 十项冻结 + Phase 0 STC-001..009 勾选。
  - 2026-07-21 — 规划补全：seed 默认值、`TimeWindow`/`AllocationProposal` 草图、STC 规则锚点、测试映射、延后清单、non-goals/风险/依赖、文档状态。
  - 2026-07-21 — Phase 6–7 STC 规则锚点补全：STC-601..607 / STC-701..707 → 规则：…（与 Phase 1–5 风格一致）。
  - 2026-07-21 — 独立复核 polish：§9.1 内置类别中文与代码一致（锻炼 / exercise）；STC-203 冻结锚点措辞；无新 durable freeze，不新开 ADR。

