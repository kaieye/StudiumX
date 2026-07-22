# ADR-0130：Study planning Phase 7 高级排程决策 + §18 residual 诚实政策

- **状态：** 已采纳（**决策 / residual 政策冻结**；本 ADR **不**宣称 STC-702..704 或 §18 产品已完整交付；实现切片须另立项并以代码 + 测试证据为准）
- **日期：** 2026-07-22
- **范围：** 路线图 Phase 7 高级项（**STC-702** 自定义节奏序列、**STC-703** 重复任务/重复时间块、**STC-704** 跨日 / 时区 / DST 高级编辑）的**产品与架构决策**；以及路线图 **§18 完成定义** 在「规划文档可关闭」与「产品完整交付」之间的 **residual 诚实政策**。
- **相关：**
  - Phase 0 产品与架构冻结：[ADR-0094](0094-study-task-timer-planning-design-gate.md)
  - 路径 / wire / Store 合同：[ADR-0117](0117-study-planning-store-paths-and-wire.md)
  - Renderer cutover / sole-authority 沉淀：[ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)（cutover 事实与 non-claims；本 ADR **不**重开 dual-write 细节）
  - 规划全文：[`docs/study-task-timer-planning-roadmap.md`](../study-task-timer-planning-roadmap.md)（§4.1 C、§7.3、§12、Phase 7 STC-701..707、§18、§21）
  - 模块尺寸：[ADR-0075](0075-module-size-policy-and-giant-peel.md)
  - sole-writer / revision 精神：[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)
  - TimerSession 命名消歧：[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)
- **证据提交：** 本 ADR（决策记录）。Phase 7 pure 实现、renderer wire 与 §18 关闭须各自 PR / 测试 / cutover 证据；**不得**仅因本 ADR 存在而勾选产品完成。

## 背景

截至 2026-07-22：

1. **Phase 0** 决策已由 [ADR-0094](0094-study-task-timer-planning-design-gate.md) 关闭；**路径 / wire / Store** 由 [ADR-0117](0117-study-planning-store-paths-and-wire.md) 冻结。
2. **Phase 1–7 共享纯领域** 大部分已落地（含 STC-701 / 705 / 706 / 707 纯层）；**durable host + product IPC + renderer dual-write / sole-read cutover** 已 partial 落地（见路线图 header 与 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)）。
3. 路线图 Phase 7 仍将 **STC-702 / 703 / 704** 标为开放或「待产品信号」；§21 将「自定义节奏序列**编辑器**」明确延后。
4. 路线图 **§18 完成定义** 仍写「功能不能仅以计时器能动为完成」的 **11 条产品地板**；header / changelog 持续写 **「§18 未满足 / still open」**，并列缺口：V1 localStorage 并存、STC-702..704、main `powerMonitor` deferred、深度 conflict auto-resolve 等。

风险：若将「规划文档关闭」或「pure 层补齐」误读为 **§18 产品完成**，会产生虚假产品声明。本 ADR 冻结 Phase 7 高级项的**实现顺序与不变量**，并冻结 **§18 residual 诚实政策**，使路线图可作为规划权威关闭，而不把 residual 洗成已交付。

## 决定

### 1. 总原则：路线图完成 ≠ §18 产品完成

| 声明 | 本 ADR 裁定 |
| --- | --- |
| 规划文档（roadmap）可关闭 / 可标记 planning-complete | **允许**，当 Phase 0–7 决策、STC 清单与 residual 表诚实、且本 ADR + 0094/0117/0129 可审计时 |
| §18 11 条全部产品完成 | **不允许**仅凭路线图关闭或 pure API 存在而宣称；须逐条有 **用户路径证据**（renderer + durable + 生命周期 + 测试） |
| Phase 7 STC-702..704 pure 落地 | **最多**算「领域层 / 单测完成」；**不算** §18 关闭，**不算**「自定义节奏编辑器 / 重复日历产品 / 旅行时区 UX」已交付 |
| partial renderer cutover（ADR-0129） | **partial 权威 demotion**；在 V1 自动擦除、main powerMonitor、深度 conflict resolve 等 residual 关闭前，**不得**宣称 sole-authority 终态或 §18 完成 |

**一句话：** *roadmap completion is a planning-document state; §18 is a product-evidence state.* 二者不得互换。

### 2. STC-702 — 自定义节奏序列（Custom rhythm）

**对齐：** 路线图 §4.1 C、§21「自定义节奏序列编辑器」、Phase 7 STC-702。

| 项 | 冻结值 |
| --- | --- |
| **首切片形态** | **纯序列（pure sequence）优先**：有序步骤列表，每步 `kind` ∈ `{ focus, short_break, long_break, wrap_up }` + 正整数 `minutes`（或等价 duration 字段） |
| **禁止首切片** | **任意拖拽自由编辑器**、自由图 / 树状状态机、无界组合爆炸的「可视化工作流」 |
| **与既有方案** | 必须与现有 **pomodoro** / **continuous** `TimerPlanV2` 及 `allocateTimeWindow` **共存且不破坏**；自定义节奏是 **kind / sequence 扩展**，不得静默改写内置 `classic_25_5` / `deep_50_10` / continuous 语义 |
| **校验** | fail-closed：空序列、未知 kind、非正时长、非法相邻规则 → 拒绝；**禁止**静默生成 3 分钟番茄式退化 |
| **运行语义** | 运行中 / 历史 **TimerSession 仍冻结 `planSnapshot`**（ADR-0094 架构原则）；编辑序列只影响**下一段 / 新会话** |
| **UI 编辑器** | **显式延期**，直至 **番茄循环 + 连续专注产品路径稳定**（产品信号触发；与 §4.1 C / §21 一致）。pure API + 单测可先于 UI 落地 |
| **产品信号（UI 开闸）** | 下列同时满足才可立项序列编辑器 UI（仍须独立 PR，不由本 ADR 自动授权）：(a) pomodoro focus→break ask 路径稳定；(b) continuous countup / countdown 与 breakPolicy 产品路径稳定；(c) 无大面积 TimerSession dual-write 回归 |

**Non-claim：** pure sequence 模块存在 **≠** 用户可在设置里编排自定义节奏。

### 3. STC-703 — 重复任务 / 重复时间块（Recurrence）

**对齐：** 路线图 §7.3、Phase 7 STC-703。

| 项 | 冻结值 |
| --- | --- |
| **模型** | **纯展开（pure expand）**：权威存 **recurrence rule + 可选 materialization 窗口**；给定窗口 → 确定性展开为具体 `ScheduleBlock[]`（或等价投影） |
| **任务身份** | **禁止静默复制 Task**：拖拽/展开时间块 **不得** 静默克隆任务实体；一任务多块仍是 **1 Task : N ScheduleBlock**（§7.3） |
| **历史事实** | **历史 TimerSession 对任务 / 块的引用不可变**；改 recurrence / 删规则 **不得** 改写已结束会话的时长、归属 ID 或 `planSnapshot`（ADR-0094 关键不变量 5–6、14） |
| **锁定与冲突** | 用户 **locked** 块不可被自动展开覆盖；重叠 fail-closed，产出 **警告 / 冲突列表**（可复用 `findScheduleConflicts` 精神），**不得**静默移动锁定块 |
| **计划 vs 实际** | 展开结果是 **计划层**；实际仍只来自 TimerSession；**禁止**用实际超时反向改 recurrence 规则或历史块 |
| **产品 UI** | 完整「重复日历」产品 UI **产品信号触发**；pure expand/validate 可先落地 |

**Non-claim：** pure expand API **≠** 用户可见的重复任务 / 系列编辑器。

### 4. STC-704 — 跨日、时区旅行与 DST 高级编辑

**对齐：** 路线图 §12（跨午夜 / 夏令时）、Phase 7 STC-704、ADR-0094 冻结精神 #5（可疑间隔用可靠时钟，不静默记专注）。

| 项 | 冻结值 |
| --- | --- |
| **存储** | 权威时间为 **epoch ms**（与 ADR-0117 wire 一致）；timezone **awareness** 在纯层以 **显式 zone id / offset 上下文** 参与 wall-clock 投影，不得仅存模糊本地字符串当唯一权威 |
| **跨午夜** | 跨午夜窗口 **允许**；周 / 日投影须 **拆成按本地日期的 date blocks**（§12：第一阶段允许但拆成两个日期块；周视图分别显示） |
| **DST** | 持续时长按 **可靠时钟差（epoch 差）** 计算；展示按 **当地 wall-clock**；对 **ambiguous / nonexistent** 本地时间 fail-closed 或显式消歧 helper，**禁止**静默吞掉 1h 或生成非法段 |
| **纯 helper 范围** | `splitAcrossMidnight`、wall-clock reproject、ambiguous/nonexistent 检测、week projection split — **纯函数优先** |
| **高级旅行 UX** | 「跨时区旅行 / 一键改 zone 重排整周」等 **高级产品 UX = 产品信号触发**；**不**因 pure helper 存在而默认交付 |
| **OS 时钟 / 睡眠** | pure helpers **不**替代 main `powerMonitor` / 系统睡眠钩子；睡眠恢复仍遵循冻结 #5 + STC-206 residual（见 §5） |

**Non-claim：** pure DST/midnight helpers **≠** 旅行模式设置页或自动跨区重排。

### 5. §18 residual 诚实表（pure + partial renderer vs 仍开放）

路线图 §18 共 11 条。下列裁定 **不**替代路线图原文，只冻结「规划关闭时如何诚实标注」。

| # | §18 要点（压缩） | 截至本 ADR 的诚实状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 用户理解任务 / 块 / 方案 / 实际计时之别 | **partial** | 术语与 UI 文案在 cutover 中增强；仍依赖教育与 partial UI，**未**宣称全产品教学完成 |
| 2 | 09:00–12:00 可解释可确认安排 | **partial（偏强）** | pure `allocateTimeWindow` + STC-308 proposal preview 产品路径已接；仍非「所有入口一致」 |
| 3 | 正/倒计时与连续专注可靠恢复 | **partial** | TimerSession dual-write + sole-read + reconcile UX + renderer visibility/pagehide；**main `powerMonitor` 仍开** |
| 4 | 无任务启动无意外归属 | **partial** | empty-start sheet + 冻结 #1；V1 路径残余须持续防回归 |
| 5 | 一任务多块；计划与实际分开 | **partial（偏强）** | multi-block editor + TimerSession 权威 demotion partial；analytics/live counters 已 demote 但仍与 V1 缓存并存 |
| 6 | 完成后归类可跳过 / 永不 / 可恢复 | **partial（偏强）** | classification + batch + prefs dual-write 已接 |
| 7 | 改方案不篡改当前与历史 | **partial（偏强）** | `planSnapshot` + active-vs-next UI；须保持不变量测试 |
| 8 | 睡眠 / 崩溃 / 并发 / retry 不重复记时 | **partial / residual 开** | reconcile + renderer sleep hooks；**main powerMonitor deferred**；崩溃矩阵未宣称全覆盖 |
| 9 | canonical 受控文件；localStorage 非长期权威 | **partial / residual 开** | ADR-0117 路径已落地 durable；**V1 localStorage 仍并存**；migration **不自动擦除** |
| 10 | 无默认远程 telemetry；不绕过 sole-writer / revision | **满足（纪律）** | 产品地板未放宽；须持续门禁，**不是** §18 其他条的替代 |
| 11 | 领域 / 生命周期 / 迁移 / IPC / 关键 UI 测试 | **partial** | 大量 unit 绿；**不等于** §18 全产品 e2e 或 release-audit |

#### 5.1 明确仍开放的 residual（默认不因 roadmap close 而消失）

| Residual | 状态 | 关闭触发（全部满足后才可立项关闭，并更新路线图 + 必要时修订本 ADR） |
| --- | --- | --- |
| **V1 localStorage 并存 / 自动擦除** | **open** | 用户确认或 ≥30 天策略（ADR-0094 #10 / ADR-0117 §4–5）+ fail-closed 擦除路径 + 无 silent wipe + 测试 |
| **main `powerMonitor`（OS 睡眠/恢复）** | **open（deferred）** | 产品信号 + main 钩子设计 + 与 STC-206 reconcile 合同；renderer visibility/pagehide **不算**关闭本项 |
| **STC-707 深度 conflict auto-resolve（自动错开写回）** | **open** | 产品信号；须尊重 locked 块与 hard end；默认仍是列表/banner + 用户编辑，**禁止**静默自动错开为默认 |
| **STC-702 UI 序列编辑器** | **open** | §2 产品信号；(pure 可先) |
| **STC-703 重复产品 UI** | **open** | §3；(pure expand 可先) |
| **STC-704 旅行 / 高级 zone UX** | **open** | §4；(pure helpers 可先) |
| **§18 整体「产品完成」徽章** | **open** | 上表 1–11 无关键 residual 且有定向证据；**不得**用 pure-only 或 partial cutover 代替 |

#### 5.2 可由 pure + partial renderer **支撑但不关闭 §18** 的项

- STC-701 / 705 / 706 / 707（冲突**列表** + 周视图 banner / 拖拽芯片）— pure + partial UI **已支撑** Phase 7「验收（纯层部分）」；**不**关闭深度 auto-resolve residual。
- dual-write + sole-read hydrate、TimerSession analytics/focus demotion、migration banner、empty-start、classification — **支撑** cutover progress（ADR-0129）；**不**关闭 V1 并存 residual。

### 6. 实现约束（与 0094 / 0117 / 0129 叠加）

1. **不**新冻结 canonical 路径 / schemaVersion 超 ADR-0117；schema bump 须新 ADR 或 0117 修订节。
2. **不**引入默认 shell / YOLO / MCP marketplace / 远程 telemetry / 产品 FTS。
3. **不**改变 TeachingTurnCoordinator / LearningSession settlement；计时写路径仍经 StudyPlanningStore + `expectedRevision`。
4. 新 pure 模块遵守 ADR-0075；禁止继续胀大 `WorkbenchPomodoro` / `useStudySession` / `StudyTaskSchedulePage` 而不 peel。
5. Phase 7 pure 导出优先落在 `src/shared/study-planning/` barrel；renderer wire 另 PR。

## 明确不包含 / non-claims

本 ADR **不**：

- 宣称 **§18 产品完成** 或「任务/计时一体化已全面交付」；
- 宣称 **STC-702 / 703 / 704** 用户功能已上线（无论 pure 是否已合入）；
- 授权 **任意拖拽序列编辑器**、**静默任务复制**、**静默自动错开冲突**、或 **默认自动擦除 V1 localStorage**；
- 授权 main `powerMonitor` 实现细节（仅记录为 deferred residual + 触发条件）；
- 修改 ADR-0094 十项产品冻结值，或扩大 ADR-0117 路径 / 命令闭集（命令可增但须兼容既有语义）；
- 替代 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md) 对 cutover 事实的描述；
- 要求 Agent 6 以外的代理编辑 `docs/adr/README.md` 或路线图正文（索引 / 路线图勾选由编排方负责）。

## 后果

1. 规划轨可将路线图标为 **planning-complete**，但 changelog / header **必须**保留 §18 residual 诚实句（或显式指向本 ADR §5），**禁止**删除「§18 still open」类事实而不提供关闭证据。
2. 工程分派：STC-702/703/704 **允许 pure-first**；UI / 旅行 UX / powerMonitor / V1 擦除 / 深度 resolve **默认不排期**，直至触发条件满足。
3. 审计时：若仅见 pure 模块或本 ADR，结论应为 **「决策已冻 + residual 仍开」**，不得写「Phase 7 / §18 done」。
4. 关闭任一 residual 时：更新路线图对应 checkbox / residual 表，并在 PR 中引用本 ADR 触发条件；重大语义变化另立 ADR。

## 权威分工

| 文档 | 角色 |
| --- | --- |
| **ADR-0094** | Phase 0 产品十项 + 六层模型 + 关键不变量 |
| **ADR-0117** | 路径 / wire v1 / Store 命令信封 / 迁移策略 |
| **ADR-0129** | Renderer cutover / dual-write / sole-read / 已落地 partial 权威 demotion 与 non-claims |
| **本 ADR-0130** | Phase 7 高级项决策顺序 + §18 residual 诚实政策 |
| **路线图** | STC 清单、场景矩阵、changelog；**不得**与上述 ADR 冻结值冲突；冲突以 ADR 为准 |

---

**一句话：** Phase 7 高级能力 pure-first、UI 与深度自动化产品信号触发；路线图可关、§18 不可假装关；V1 并存、powerMonitor、深度 conflict resolve 与 702–704 产品 UI 仍是带触发条件的 residual。
