# ADR-0130：Study planning Phase 7 高级排程决策 + §18 residual 诚实政策

- **决策状态：** accepted
- **实施状态：** not_started
- **实施说明：** 已采纳（**决策 / residual 政策冻结**；本 ADR **不**宣称 STC-702..704 或 §18 产品已完整交付；实现切片须另立项并以代码 + 测试证据为准）
- **日期：** 2026-07-22
- **范围：** 路线图 Phase 7 高级项（**STC-702** 自定义节奏序列、**STC-703** 重复任务/重复时间块、**STC-704** 跨日 / 时区 / DST 高级编辑）的**产品与架构决策**；以及路线图 **§18 完成定义** 在「规划文档可关闭」与「产品完整交付」之间的 **residual 诚实政策**。
- **取代：** 无
- **被取代：** 无
- **相关：** 
  - Phase 0 产品与架构冻结：[ADR-0094](0094-study-task-timer-planning-design-gate.md)
  - 路径 / wire / Store 合同：[ADR-0117](0117-study-planning-store-paths-and-wire.md)
  - Renderer cutover / sole-authority 沉淀：[ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)（cutover 事实与 non-claims；本 ADR **不**重开 dual-write 细节）
  - 模块尺寸：[ADR-0075](0075-module-size-policy-and-giant-peel.md)
  - sole-writer / revision 精神：[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)
  - TimerSession 命名消歧：[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)
- **证据：** 本 ADR（决策记录）。Phase 7 pure 实现、renderer wire 与 §18 关闭须各自 PR / 测试 / cutover 证据；**不得**仅因本 ADR 存在而勾选产品完成。


> **长度说明：** 本 ADR 的 §5/§5.1/§5.3 是 §18/STC residual 的诚实状态与 product-close 政策本体（11 条状态表 + 逐条关闭触发），属于不可压缩的治理内容；历史 IMPL 记录已移至 `docs/adr/evidence/ADR-0130.md`。

## 背景

截至 2026-07-22：

1. **Phase 0** 决策已由 [ADR-0094](0094-study-task-timer-planning-design-gate.md) 关闭；**路径 / wire / Store** 由 [ADR-0117](0117-study-planning-store-paths-and-wire.md) 冻结。
2. **Phase 1–7 共享纯领域** 大部分已落地（含 STC-701 / 705 / 706 / 707 纯层）；**durable host + product IPC + renderer dual-write / sole-read cutover** 已 partial 落地（见路线图 header 与 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)）。
3. 路线图 Phase 7 曾将 **STC-702 / 703 / 704** 标为开放或「待产品信号」；实施后 honesty：**STC-702/703** 为 pure + partial UI landed（编辑器 / 最小规则；product polish residual 见 §5.1）；**STC-704 旅行时区产品已移除（2026-07-22）**（pure zone/DST/overnight helpers + 块级 optional `timeZone` 保留；**不**再当 open product residual / partial closer）。
4. 路线图 **§18 完成定义** 仍写「功能不能仅以计时器能动为完成」的 **11 条产品地板**；header 持续写 **「§18 未满足 / not satisfied」**。诚实缺口（2026-07-22，post Wave9 AE/AF/AG）：V1 dual-authority **partial (demote UX click-path e2e + cold-start e2e landed)**（auto ≥30d 仍禁；**≠** sole-authority 终态 / §18）、STC-702/703 **partial/closer**（product polish residual；**不** flip landed-complete）、STC-704 **travel-settings product removed (2026-07-22)**（仍保留块级 optional `timeZone` + overnight projection + create stamp + DST helpers；**≠** 旅行时区产品；**≠** §18）、sleep/crash **improved partial (Electron kill-9 + same-process IPC thrash + dual-process Path B thrash e2e + e2e-proxy)**（dual-window product surface **N/A**；Path B thrash **landed** 仍≠ §18 #8 全关）、STC-707 **landed (opt-in shipped; silent default banned)**（仍≠§18）等。

风险：若将「规划文档关闭」或「pure 层补齐」误读为 **§18 产品完成**，会产生虚假产品声明。本 ADR 冻结 Phase 7 高级项的**实现顺序与不变量**，并冻结 **§18 residual 诚实政策**，使路线图可作为规划权威关闭，而不把 residual 洗成已交付。

## 决定

### 1. 总原则：路线图完成 ≠ §18 产品完成

| 声明 | 本 ADR 裁定 |
| --- | --- |
| 规划文档（roadmap）可关闭 / 可标记 planning-complete | **允许**，当 Phase 0–7 决策、STC 清单与 residual 表诚实、且本 ADR + 0094/0117/0129 可审计时 |
| §18 11 条全部产品完成 | **不允许**仅凭路线图关闭或 pure API 存在而宣称；须逐条有 **用户路径证据**（renderer + durable + 生命周期 + 测试） |
| Phase 7 STC-702..704 pure 落地 | **最多**算「领域层 / 单测完成」；**不算** §18 关闭；STC-704 **旅行时区产品已撤回**；**不算**「自定义节奏编辑器 / 重复日历产品」仅因 pure 而交付 |
| partial renderer cutover（ADR-0129） | **partial 权威 demotion**；在 V1 sole-authority 终态、sleep/crash **matrix product-close**（dual-window product **N/A**；Path B thrash e2e **已 landed** 仍≠ bullet 8 全关）与 STC-702/703 product polish 等 residual 关闭前，**不得**宣称 sole-authority 终态或 §18 完成（cold-start e2e + demote UX click-path e2e + kill-9 + Path A thrash + Path B thrash e2e **已 landed** 仍≠关 §18；STC-707 opt-in product-signal 已 landed 仍≠§18；**STC-704 旅行时区产品已移除 / allocation 产品已移除**；power 信号桥 / unit / e2e-proxy / thrash pack / partial UI **alone 不够**） |

**一句话：** *roadmap completion is a planning-document state; §18 is a product-evidence state.* 二者不得互换。



### 2a. Continuous 子模式（open / target / exam）— 2026-07-23 补记

产品将「连续专注」细分为 durable `TimerPlanV2.continuousMode?: 'open' | 'target' | 'exam'`（shared `timer-plan.ts`）。V1 dual-write cache（`StudyTimerPlan`）同步可选 `continuousMode`，`continuousTarget` 仅作 **exam 兼容布尔**（`true` ⇔ exam）。Open 无 focus 目标；target 有 focusMinutes；exam 为考试墙仿真（默认 180 分种子）。**禁止**仅用 `clockMode === 'countup' && !continuousTarget` 推断 open（会吞掉 target countup）。实现锚：`continuousModeFromV1`、`createOpenContinuousPlan` / `createExamSimulationPlan` / `createTargetContinuousPlan`。

### 2. STC-702 — 自定义节奏序列（Custom rhythm）

**对齐：** 路线图 §4.1 C、§21「自定义节奏序列编辑器」、Phase 7 STC-702。

| 项 | 冻结值 |
| --- | --- |
| **首切片形态** | **纯序列（pure sequence）优先**：有序步骤列表，每步 `kind` ∈ `{ focus, short_break, long_break, wrap_up }` + 正整数 `minutes`（或等价 duration 字段） |
| **禁止首切片** | **任意拖拽自由编辑器**、自由图 / 树状状态机、无界组合爆炸的「可视化工作流」 |
| **与既有方案** | 必须与现有 **pomodoro** / **continuous** `TimerPlanV2` **共存且不破坏**（`allocateTimeWindow` 产品路径已于 2026-07-22 移除）；自定义节奏是 **kind / sequence 扩展**，不得静默改写内置 `classic_25_5` / `deep_50_10` / continuous 语义 |
| **校验** | fail-closed：空序列、未知 kind、非正时长、非法相邻规则 → 拒绝；**禁止**静默生成 3 分钟番茄式退化 |
| **运行语义** | 运行中 / 历史 **TimerSession 仍冻结 `planSnapshot`**（ADR-0094 架构原则）；编辑序列只影响**下一段 / 新会话** |
| **UI 编辑器** | **ordered list 最小编辑器允许 partial 落地**（非 freeform；IMPL-C）；**full polish / 产品信号门禁**仍须番茄循环 + 连续专注路径稳定（与 §4.1 C 精神一致）。pure API + 单测可先于 UI；**partial UI ≠ §18** |
| **产品信号（UI 开闸）** | 下列同时满足才可立项序列编辑器 UI（仍须独立 PR，不由本 ADR 自动授权）：(a) pomodoro focus→break ask 路径稳定；(b) continuous countup / countdown 与 breakPolicy 产品路径稳定；(c) 无大面积 TimerSession dual-write 回归 |

**Non-claim：** pure sequence 模块或 **partial ordered editor** 存在 **≠** custom rhythm 产品全完成 / §18 关闭；**禁止** freeform drag 编辑器。

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

**Non-claim：** pure expand、规则 persist、或 **series edit sheet partial** **≠** 完整重复日历产品 / 月份网格 polish / §18 关闭；**禁止**默认 auto-expand / 静默任务克隆。

### 4. STC-704 — 跨日 / 时区 / DST 高级编辑（旅行时区产品已撤回）

**对齐：** 路线图 §12（跨午夜 / 夏令时）、Phase 7 STC-704、ADR-0094 冻结精神 #5（可疑间隔用可靠时钟，不静默记专注）。

| 项 | 冻结值 |
| --- | --- |
| **存储** | 权威时间为 **epoch ms**（与 ADR-0117 wire 一致）；timezone **awareness** 在纯层以 **显式 zone id / offset 上下文** 参与 wall-clock 投影，不得仅存模糊本地字符串当唯一权威 |
| **跨午夜** | 跨午夜窗口 **允许**；周 / 日投影须 **拆成按本地日期的 date blocks**（§12：第一阶段允许但拆成两个日期块；周视图分别显示） |
| **DST** | 持续时长按 **可靠时钟差（epoch 差）** 计算；展示按 **当地 wall-clock**；对 **ambiguous / nonexistent** 本地时间 fail-closed 或显式消歧 helper，**禁止**静默吞掉 1h 或生成非法段 |
| **纯 helper 范围** | `splitAcrossMidnight`、wall-clock reproject、ambiguous/nonexistent 检测、week projection split — **纯函数优先** |
| **高级旅行 UX** | **Product decision 2026-07-22：撤回**「旅行时区设置 / rezone / durable `defaultTimeZone`」产品面；**不**再作为 residual deliverable。pure zone/DST/overnight helpers 与块级 optional `timeZone` **保留** |
| **OS 时钟 / 睡眠** | pure helpers **不**替代 main `powerMonitor` / 系统睡眠钩子；睡眠恢复仍遵循冻结 #5 + STC-206 residual（见 §5） |

**Non-claim / product decision (2026-07-22)：** pure DST/midnight helpers、块 timeZone + overnight multi-chip **保留**；**旅行设置 sheet / rezone / `defaultTimeZone` prefs 产品面已从代码与 residual 表移除**，**禁止**静默 whole-week rezone；**≠** §18 关闭。

### 5. §18 residual 诚实表（pure + partial renderer vs 仍开放）

路线图 §18 共 11 条。下列裁定冻结 §18 在「规划文档已删除」之后如何诚实标注（**不**宣称产品完成）。

| # | §18 要点（压缩） | 截至本 ADR 的诚实状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 用户理解任务 / 块 / 方案 / 实际计时之别 | **partial** | 术语与 UI 文案在 cutover 中增强；仍依赖教育与 partial UI，**未**宣称全产品教学完成 |
| 2 | 09:00–12:00 可解释可确认安排 | **partial（偏弱；allocation 产品已撤）** | `morning_0900_1200` TimeWindow 模板仍在；**`allocateTimeWindow` / AllocationProposal preview / `apply_allocation_proposal` 产品路径已于 2026-07-22 移除**；手动排程 + 时钟方案 catalog 保留；**≠** §18 satisfied |
| 3 | 正/倒计时与连续专注可靠恢复 | **partial (improved)** | TimerSession dual-write + sole-read + reconcile UX + renderer visibility/pagehide + **main `powerMonitor` 信号桥 landed**（`teach:system-power`；pin 仍 renderer）+ unit recovery matrix + **Electron kill-9 e2e + same-process IPC thrash e2e + dual-process Path B thrash e2e**；完整 bullet / product-close 仍开（见 #8；**≠** §18） |
| 4 | 无任务启动无意外归属 | **partial** | empty-start sheet + 冻结 #1；V1 路径残余须持续防回归 |
| 5 | 一任务多块；计划与实际分开 | **partial（偏强）** | multi-block editor + TimerSession 权威 demotion partial；analytics/live counters 已 demote 但仍与 V1 缓存并存 |
| 6 | 完成后归类可跳过 / 永不 / 可恢复 | **partial（偏强）** | classification + batch + prefs dual-write 已接 |
| 7 | 改方案不篡改当前与历史 | **partial（偏强）** | `planSnapshot` + active-vs-next UI；须保持不变量测试 |
| 8 | 睡眠 / 崩溃 / 并发 / retry 不重复记时 | **open / improved partial (Electron kill-9 + same-process IPC thrash + dual-process Path B thrash e2e + e2e-proxy)** | reconcile + renderer sleep hooks + **main powerMonitor 信号桥 landed** + **unit / product-path recovery matrix** + **Electron kill-9 single-process e2e**（IMPL-W）+ **same-process concurrent IPC thrash e2e**（IMPL-AA Path A：`study-planning-timer-thrash.e2e.spec.ts`）+ **dual-process Path B thrash e2e landed**（IMPL-AE：`study-planning-timer-thrash-dual-process.e2e.spec.ts`；不同 userData + `importWorkspacePath` 共享 disk；reload-before-apply + real-disk apply lock）；**dual-window product surface N/A**；**禁止**因 thrash pack / 信号桥 / unit 宣称 bullet 8 全关 / §18 关闭 |
| 9 | canonical 受控文件；localStorage 非长期权威 | **partial (demote UX click-path e2e + cold-start e2e landed)** | ADR-0117 durable + sole-read；**explicit V1 demote UX landed**；**cold-start unit + e2e-proxy + true multi-process Electron cold-start e2e landed**（`study-planning-v1-cold-start.e2e.spec.ts`；Wave7 V-FIX2）；**demote UX click-path e2e landed**（IMPL-AF：`study-planning-v1-demote-ux.e2e.spec.ts` — hybrid seed → 真实 sheet confirm `归档并停止本地权威` → marker/presence-only → forceKill sole-read；dismiss `关闭` 不写 marker）；migration **不自动擦除**；auto ≥30d 仍 open；**≠** sole-authority 终态 / §18 |
| 10 | 无默认远程 telemetry；不绕过 sole-writer / revision | **满足（纪律）** | 产品地板未放宽；须持续门禁，**不是** §18 其他条的替代 |
| 11 | 领域 / 生命周期 / 迁移 / IPC / 关键 UI 测试 | **partial** | 大量 unit 绿；**不等于** §18 全产品 e2e 或 release-audit |

> 后续 IMPL-* 历史合入记录（IMPL-Z … IMPL-AQ、IMPL-PRODUCT-REMOVE-ALLOC-TRAVEL）
> 已归档至 `docs/adr/evidence/ADR-0130.md`。这些实现记录**不单独关闭** §18
> bullet；关闭政策见 §5.3。

#### 5.1 明确仍开放的 residual（默认不因 roadmap close 而消失）

> **2026-07-22 honesty sync（post Wave9 AE/AF/AG）：** 下列状态反映 **代码 + impl 报告** 可证明的 partial/landed；**不**因 partial / host wire / unit / e2e-proxy / kill-9 / Path A thrash / Path B thrash / demote UX e2e 证据关闭 §18。STC-707 opt-in product-signal **已 landed**（静默默认仍禁）仍≠§18；V1 **demote UX click-path e2e + cold-start e2e landed** 仍≠ sole-authority 终态；sleep/crash **kill-9 + same-process IPC thrash + dual-process Path B thrash e2e landed** / dual-window product **N/A** / **≠ §18 #8 全关**；702–703 product polish residual 仍 open；**STC-704 旅行时区产品已移除（2026-07-22）**（块 zone/DST/overnight helpers 保留；**≠** §18）；**allocation-from-plan 产品已移除**（§18 #2 偏弱 residual）。

| Residual | 状态 | 关闭触发（全部满足后才可立项关闭，并修订本 ADR residual 表；原路线图已删除） |
| --- | --- | --- |
| **V1 localStorage 并存 / 自动擦除** | **partial (demote UX click-path e2e + cold-start e2e landed)** | Explicit demote confirm + backup-first + demote marker + presence-only persist **landed**（IMPL-A）；cold-start non-resurrection unit **landed**（IMPL-H）；**e2e-proxy product-path suite landed**（IMPL-P）；**true multi-process Electron cold-start e2e landed**（Wave7 V-FIX2：`study-planning-v1-cold-start.e2e.spec.ts` seed demote→forceKill→relaunch→canonical sole-read）；**demote UX click-path e2e landed**（IMPL-AF：`study-planning-v1-demote-ux.e2e.spec.ts` confirm/dismiss anchors）；**仍开**：auto ≥30d 策略 UX、无 silent wipe 纪律；migration 永不 erase；**≠** sole-authority 终态 / §18 |
| **main `powerMonitor` + sleep/crash 矩阵** | **landed (signal bridge)** / matrix residual (**improved partial**) | `teach:system-power` + preload + renderer map 至 STC-206 wake **landed**（IMPL-B；见 ADR-0129 §4）；unit recovery matrix **landed**（IMPL-I）；**product-path recovery matrix landed**（IMPL-Q）；**Electron kill-9 single-process e2e landed**（IMPL-W：`study-planning-timer-recovery.e2e.spec.ts`）；**same-process IPC thrash e2e landed**（IMPL-AA Path A：`study-planning-timer-thrash.e2e.spec.ts`；durable `applyChain` CAS serialization）；**dual-process Path B thrash e2e landed**（IMPL-AE：`study-planning-timer-thrash-dual-process.e2e.spec.ts`；reload-before-apply + real-disk apply lock）；pin 仍 renderer dual-write；**dual-window product surface N/A**（no study multi-window API；same-userData second instance still single-instance locked）；**≠** §18 #8 全关 |
| **STC-707 深度 conflict auto-resolve（自动错开写回）** | **landed (opt-in shipped; silent default banned)** | pure + banner CTA + host wire **landed**（IMPL-F/G）；**product-signal freeze landed**（IMPL-U：opt-in「预览错开→确认应用」为日程页默认上线能力；`STC_707_PRODUCT_SIGNAL` + product-signal unit；**禁止**静默自动错开；尊重 locked / hard end）；**≠** §18 全完成 |
| **STC-702 UI 序列编辑器** | **improved partial / product-signal polish landed** | ordered list 编辑器 + V1↔V2 dual-write + session `rhythmStepIndex` + store fail-closed **landed**（IMPL-C；**非** freeform drag）；product-path polish **landed**（IMPL-R：`study-planning-custom-rhythm-product-path.unit.test.ts`）；番茄+连续共存 / 进一步 UX polish residual only；**≠** §18 |
| **STC-703 重复产品 UI** | **partial (closer)** | 最小规则编辑 + dry-run preview + confirm sequential upsert **landed**（IMPL-D）；rules persist + host 投影 **landed**（IMPL-L/N）；**series edit UI landed**（IMPL-S：`RecurrenceSeriesEditSheet` + series-ui pure/tests）；**禁止**静默任务克隆 / 默认 auto-expand；月份网格/产品 polish residual only；**≠** §18 |
| **STC-704 旅行时区产品** | **removed (2026-07-22)** | 用户产品决策：**移除**旅行设置 sheet / rezone / prefs deep-link / durable `defaultTimeZone` / host wire。**保留**块级 optional `timeZone` + overnight multi-chip + create stamp + timezone-DST pure helpers + `confirmOverwriteTimeZone` 写策略（无产品 UI）。**禁止**静默整周 rezone。**≠** §18；**不**把移除误标为 §18 关闭 |
| **§18 整体「产品完成」徽章** | **open / not satisfied** | 上表 1–11 无关键 residual 且有定向证据；**不得**用 pure-only、partial UI、unit matrix 或 power 信号桥 alone 代替 |

#### 5.2 可由 pure + partial renderer **支撑但不关闭 §18** 的项

- STC-701 / 705 / 706 — pure + 周视图 banner / 拖拽芯片 **已支撑**；**不**关闭深度 auto-resolve。
- STC-707 — pure + banner opt-in CTA + host wire + **product-signal freeze landed**（IMPL-F/G/U；opt-in 默认上线；静默默认仍禁）；**不**单独关闭 §18。
- STC-702 / 703 — pure + **partial/product UI**（序列编辑器 polish / series edit sheet）**支撑** Phase 7 进度；**不**关 product polish residual 与 §18。
- STC-704 — pure zone/DST/overnight + 块级 optional `timeZone` **支撑** 显示/拆分；**旅行时区产品面已移除（2026-07-22）**。
- dual-write + sole-read hydrate、TimerSession analytics/focus demotion、migration banner、**V1 demote UX + cold-start unit + Electron cold-start e2e + demote UX click-path e2e**、empty-start、classification、main powerMonitor **信号桥**、**unit recovery matrix + kill-9 e2e + same-process IPC thrash e2e + dual-process Path B thrash e2e** — **支撑** cutover / recovery progress（ADR-0129）；**不**关闭 V1 sole-authority 终态、§18 #8 product-close（dual-window N/A；thrash pack ≠ full close）或 §18。

#### 5.3 Product-close evidence policy（§18 bullets 1–9 / 11 — freeze；仍 not satisfied）

**Purpose.** Freeze an **auditable close-policy** so roadmap residual cannot be fake-closed by more engineering waves alone (thrash pack green, suite green, peel hygiene, demote e2e alone, or inventing multi-window UI). **§18 overall remains `not satisfied`.** Only bullet **#10** is discipline-satisfied.

**Global non-flips (always):**

| Class of landed evidence | Flips a §18 bullet / overall? |
| --- | --- |
| Product-path unit suite green (`study-planning-section18-product-path.unit.test.ts`) | **No** — freezes anchors only |
| Thrash pack (kill-9 + Path A same-process + Path B dual-process e2e) | **No** — ≠ bullet 8 full close; dual-window product surface **N/A** |
| Peel / ADR-0075 hygiene (e.g. travel-ui peel) | **No** — engineering hygiene only |
| Demote UX click-path e2e / cold-start e2e alone | **No** — ≠ sole-authority 终态 / ≠ bullet 9 satisfied |
| Partial UI / pure-only / host wire / e2e-proxy alone | **No** |
| Inventing multi-window UI or dual-window product thrash | **Forbidden / N/A** — no study multi-window API; do not invent |
| Auto ≥30d silent V1 wipe | **Banned** — remains banned unless a **future explicit confirm UX** lands (user-visible confirm + backup-first; never silent) |
| Engineering waves whose only goal is to force §18 complete | **Out of scope** — track is **converged to polish + this product-close policy** |

**Per-bullet flip requirements (still-open 1–9 and 11):** status columns stay as in §5 table until **all** required product evidence lands and roadmap + this ADR are updated in the same honesty PR.

| # | Current status (do not flip here) | Product evidence required to flip toward satisfied | Currently landed evidence that is **insufficient** alone |
| --- | --- | --- | --- |
| 1 | **partial** | User-path evidence that task / block / plan / actual-timer distinction is consistent **across primary entry points** (empty-start, schedule, task detail, timer shell) with copy + non-regression UI tests tied to those surfaces | Facet copy + product-path suite anchors |
| 2 | **partial（偏弱；allocation 产品已撤）** | User-path evidence that 09:00–12:00 (or equivalent) focus/break arrangement is **explainable + confirmable** under current product surfaces (manual schedule + timer plans + TimeWindow templates; **no** allocate-from-plan product) without silent write on blank/locked | Historical `allocateTimeWindow` + proposal preview product-path **removed 2026-07-22**; template-only residual **insufficient** to claim satisfied |
| 3 | **partial (improved)** | Positive / countdown / continuous **reliable recovery** under the same product-close bar as #8 (user-visible reconcile; no double-count); not just start/pause lifecycle unit | TimerSession dual-write + sole-read + power bridge + thrash pack partials (see #8) |
| 4 | **partial** | Empty-start + quick-create paths **never** silently bind first open task; V1 residual paths covered by regression product evidence | empty-start sheet + attribution pure; V1 path residual still open |
| 5 | **partial（偏强）** | Multi-block task editor + plan-vs-actual stats remain sole-read coherent after V1 demotion paths; no V1 shell re-authority | multi-block editor + detail stats; V1 shell residual |
| 6 | **partial（偏强）** | Classification skip / never / restore prefs path product-polished and durable prefs dual-write stable under sole-read | classification sheet + prefs dual-write product-path |
| 7 | **partial（偏强）** | Active-vs-next / `planSnapshot` freeze holds under catalog edit + recovery; invariant tests remain green on product path | planSnapshot + active-vs-next UI; must keep invariants |
| 8 | **open / improved partial** | Sleep / crash / concurrent / retry **matrix product-close**: durable sole-read + CAS fail-closed under real lifecycle, user-visible reconcile when needed; **dual-window product thrash remains N/A** (do **not** invent multi-window UI; Path A+B thrash pack does **not** auto-satisfy this bullet) | kill-9 + Path A thrash + Path B dual-process thrash + power bridge + suite pure #8 freeze — **landed but ≠ full close** |
| 9 | **partial (closer)** | Explicit demote + cold-start non-resurrection **plus** sole-authority end-state product path; **auto ≥30d silent wipe stays banned** unless future **explicit confirm UX** lands | demote UX e2e + cold-start e2e + demote pure gates — **landed but ≠ satisfied / ≠ sole-authority 终态** |
| 11 | **partial** | Domain + lifecycle + migration + IPC + critical UI coverage agreed as **product-close bar** for residual bullets (not generic coverage fashion); full release-audit **not** required for every PR but **is** required before overall §18 badge | Broad unit suite + targeted e2e; **≠** overall §18 complete |

**Engineering track status (2026-07-22 / IMPL-AO):** study-planning roadmap engineering residual is **converged to polish + product-close policy** (this subsection). Further feature invention solely to force §18 complete is **out of scope**. Closing any bullet still requires the product evidence above, roadmap honesty update, and ADR residual row update — not another thrash-only wave.


### 6. 实现约束（与 0094 / 0117 / 0129 叠加）

1. **不**新冻结 canonical 路径 / schemaVersion 超 ADR-0117；schema bump 须新 ADR 或 0117 修订节。
2. **不**引入默认 shell / YOLO / MCP marketplace / 远程 telemetry / 产品 FTS。
3. **不**改变 TeachingTurnCoordinator / LearningSession settlement；计时写路径仍经 StudyPlanningStore + `expectedRevision`。
4. 新 pure 模块遵守 ADR-0075；禁止继续胀大 `WorkbenchPomodoro` / `useStudySession` / `StudyTaskSchedulePage` 而不 peel。
5. Phase 7 pure 导出优先落在 `src/shared/study-planning/` barrel；renderer wire 另 PR。

## 明确不包含 / non-claims

本 ADR **不**：

- 宣称 **§18 产品完成** 或「任务/计时一体化已全面交付」；
- 宣称 **STC-702 / 703** 产品 **全完成** 或 §18 关闭（partial ordered editor / 最小规则 expand **允许诚实 partial**，**不等于**上线完成徽章）；**不**把 **STC-704 旅行时区产品 removed** 或 pure zone/DST helpers 误标为 travel 产品交付 / §18 关闭；
- 授权 **任意拖拽序列编辑器**、**静默任务复制**、**静默自动错开冲突**、或 **默认自动擦除 V1 localStorage**；
- 把 main `powerMonitor` **信号桥**、unit recovery matrix、kill-9 single-process e2e、same-process IPC thrash e2e 或 dual-process Path B thrash e2e 误标为完整 sleep/crash **矩阵 / §18 #8** 关闭（桥 + unit + kill-9 + Path A + Path B thrash 已落地；**dual-window product surface N/A**；thrash pack **≠** bullet 8 全关 / §18）；
- 修改 ADR-0094 十项产品冻结值，或扩大 ADR-0117 路径 / 命令闭集（命令可增但须兼容既有语义）；
- 替代 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md) 对 cutover 事实的描述；
- 要求代理编辑 `docs/adr/README.md` 索引时须与本 ADR 族一致（路线图正文已删除，不再勾选）。

## 后果

1. 规划轨可将路线图标为 **planning-complete**，但 changelog / header **必须**保留 §18 residual 诚实句（或显式指向本 ADR §5），**禁止**删除「§18 still open」类事实而不提供关闭证据。
2. 工程分派：STC-702/703 **允许 pure-first + partial UI**（已落地者不重复当零起点；Wave7/9 closer ≠ landed-complete）；V1 sole-authority 终态 / auto ≥30d、§18 #8 product-close（thrash pack **已 landed** 仍≠全关）、702–703 product polish residual **默认不排期为关闭**；STC-704 **旅行时区产品已移除**、allocation-from-plan **已移除**（**≠** 因移除而关 §18；**禁止** re-open 为 product residual）；直至其他 residual 触发条件与证据满足（cold-start e2e / demote UX e2e / kill-9 / Path A thrash / Path B thrash **已 landed** 仍≠关 §18）；STC-707 product-signal **已 landed**（opt-in 默认上线；静默默认仍禁）仍≠§18。
3. 审计时：若仅见 pure 模块或本 ADR，结论应为 **「决策已冻 + residual 仍开」**，不得写「Phase 7 / §18 done」。
4. 关闭任一 residual 时：在 PR 中引用本 ADR 触发条件并更新本 ADR residual 表（路线图文档已删除，不再维护）；重大语义变化另立 ADR。

## 权威分工

| 文档 | 角色 |
| --- | --- |
| **ADR-0094** | Phase 0 产品十项 + 六层模型 + 关键不变量 |
| **ADR-0117** | 路径 / wire v1 / Store 命令信封 / 迁移策略 |
| **ADR-0129** | Renderer cutover / dual-write / sole-read / 已落地 partial 权威 demotion 与 non-claims |
| **本 ADR-0130** | Phase 7 高级项决策顺序 + §18 residual 诚实政策 |
| **（原路线图 / `_agent-work` 编排产物）** | **已删除 / 已清理**（2026-07-22）；历史 STC/场景/changelog 不再保留本地副本；**活权威**为本 ADR 族（0094/0117/0129/0130）；冲突以 ADR 为准 |
---

**一句话：** Phase 7 高级能力 pure-first + partial UI 已进展；路线图可关、§18 **not satisfied** 不可假装关；V1 demote UX e2e + cold-start e2e / power 信号桥 / kill-9 + Path A thrash + Path B thrash e2e / 702–703 partial UI **支撑进度但不关闭 residual**；STC-704 旅行时区产品与 allocation-from-plan 产品 **已移除（2026-07-22）**（**≠** §18 关闭；**禁止** re-open；post-removal honesty freeze **IMPL-AQ**）；STC-707 opt-in product-signal **已 landed**（静默默认仍禁）仍≠§18；dual-window product surface **N/A**、§18 #8 product-close、sole-authority 终态与 702–703 product polish 仍是带触发条件的 residual；**product-close evidence policy 见 §5.3**（IMPL-AO；engineering track closed/converged — thrash/suite/peel alone 不够）。
