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
3. 路线图 Phase 7 曾将 **STC-702 / 703 / 704** 标为开放或「待产品信号」；实施后 honesty 为 **pure + partial UI landed**（编辑器 / 最小规则 / zone wire），完整 polish 与 product-signal 仍 residual（见 §5.1）。
4. 路线图 **§18 完成定义** 仍写「功能不能仅以计时器能动为完成」的 **11 条产品地板**；header 持续写 **「§18 未满足 / not satisfied」**。诚实缺口（2026-07-22，post G/H）：V1 dual-authority **partial (demote UX + cold-start unit)**（full e2e cold-start 仍开；auto ≥30d 仍禁）、STC-702..704 **partial UI**（polish 仍开）、main `powerMonitor` **信号桥 + unit recovery matrix landed**（e2e 矩阵仍开）、STC-707 **partial (host wire)**（pure+CTA+`StudyTaskSchedulePage` host landed；**仍非 silent default**；product-signal residual 仍开）等。

风险：若将「规划文档关闭」或「pure 层补齐」误读为 **§18 产品完成**，会产生虚假产品声明。本 ADR 冻结 Phase 7 高级项的**实现顺序与不变量**，并冻结 **§18 residual 诚实政策**，使路线图可作为规划权威关闭，而不把 residual 洗成已交付。

## 决定

### 1. 总原则：路线图完成 ≠ §18 产品完成

| 声明 | 本 ADR 裁定 |
| --- | --- |
| 规划文档（roadmap）可关闭 / 可标记 planning-complete | **允许**，当 Phase 0–7 决策、STC 清单与 residual 表诚实、且本 ADR + 0094/0117/0129 可审计时 |
| §18 11 条全部产品完成 | **不允许**仅凭路线图关闭或 pure API 存在而宣称；须逐条有 **用户路径证据**（renderer + durable + 生命周期 + 测试） |
| Phase 7 STC-702..704 pure 落地 | **最多**算「领域层 / 单测完成」；**不算** §18 关闭，**不算**「自定义节奏编辑器 / 重复日历产品 / 旅行时区 UX」已交付 |
| partial renderer cutover（ADR-0129） | **partial 权威 demotion**；在 V1 sole-authority 终态 / full e2e cold-start、完整 sleep/crash **e2e** 矩阵、STC-702..704 polish、STC-707 **product-signal**（host wire 已 partial）等 residual 关闭前，**不得**宣称 sole-authority 终态或 §18 完成（power 信号桥 / unit matrix / demote UX / cold-start unit / host wire / partial UI **alone 不够**） |

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

**Non-claim：** pure expand 或 **最小规则+confirm expand partial UI** **≠** 完整重复日历产品 / 规则持久化完成 / §18 关闭。

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

**Non-claim：** pure DST/midnight helpers 或 **块 timeZone + 周 overnight multi-chip partial** **≠** 旅行设置页 / 一键 rezone / §18 关闭；**禁止**静默 whole-week rezone 默认。

### 5. §18 residual 诚实表（pure + partial renderer vs 仍开放）

路线图 §18 共 11 条。下列裁定 **不**替代路线图原文，只冻结「规划关闭时如何诚实标注」。

| # | §18 要点（压缩） | 截至本 ADR 的诚实状态 | 说明 |
| --- | --- | --- | --- |
| 1 | 用户理解任务 / 块 / 方案 / 实际计时之别 | **partial** | 术语与 UI 文案在 cutover 中增强；仍依赖教育与 partial UI，**未**宣称全产品教学完成 |
| 2 | 09:00–12:00 可解释可确认安排 | **partial（偏强）** | pure `allocateTimeWindow` + STC-308 proposal preview 产品路径已接；仍非「所有入口一致」 |
| 3 | 正/倒计时与连续专注可靠恢复 | **partial (improved)** | TimerSession dual-write + sole-read + reconcile UX + renderer visibility/pagehide + **main `powerMonitor` 信号桥 landed**（`teach:system-power`；pin 仍 renderer）+ unit recovery matrix；完整 sleep/crash **e2e** 矩阵仍开 |
| 4 | 无任务启动无意外归属 | **partial** | empty-start sheet + 冻结 #1；V1 路径残余须持续防回归 |
| 5 | 一任务多块；计划与实际分开 | **partial（偏强）** | multi-block editor + TimerSession 权威 demotion partial；analytics/live counters 已 demote 但仍与 V1 缓存并存 |
| 6 | 完成后归类可跳过 / 永不 / 可恢复 | **partial（偏强）** | classification + batch + prefs dual-write 已接 |
| 7 | 改方案不篡改当前与历史 | **partial（偏强）** | `planSnapshot` + active-vs-next UI；须保持不变量测试 |
| 8 | 睡眠 / 崩溃 / 并发 / retry 不重复记时 | **open / improved partial** | reconcile + renderer sleep hooks + **main powerMonitor 信号桥 landed** + **unit recovery matrix**；crash/kill-9/多窗 thrash **e2e** **未关**；**禁止**因信号桥或 unit 矩阵宣称 bullet 8 全关 |
| 9 | canonical 受控文件；localStorage 非长期权威 | **partial (demote UX + cold-start unit)** | ADR-0117 durable + sole-read；**explicit V1 demote UX landed**（backup→erase、demote marker、presence-only persist）；**cold-start unit landed**（`shouldReseedV1TasksFromDefaults` / `allowEmpty`：demoted empty V1 不 default-reseed / 不 co-write task authority；IMPL-H）；migration **不自动擦除**；full e2e cold-start 与 auto ≥30d 仍 open；**≠** sole-authority 终态 |
| 10 | 无默认远程 telemetry；不绕过 sole-writer / revision | **满足（纪律）** | 产品地板未放宽；须持续门禁，**不是** §18 其他条的替代 |
| 11 | 领域 / 生命周期 / 迁移 / IPC / 关键 UI 测试 | **partial** | 大量 unit 绿；**不等于** §18 全产品 e2e 或 release-audit |

#### 5.1 明确仍开放的 residual（默认不因 roadmap close 而消失）

> **2026-07-22 honesty sync（IMPL-A..I + G host + H cold-start landed；K re-sync）：** 下列状态反映 **代码 + impl-g/h/i 报告** 可证明的 partial；**不**因 partial / host wire / unit 证据关闭 §18。产品信号 polish、full e2e cold-start、完整 crash e2e 矩阵仍 open。

| Residual | 状态 | 关闭触发（全部满足后才可立项关闭，并更新路线图 + 必要时修订本 ADR） |
| --- | --- | --- |
| **V1 localStorage 并存 / 自动擦除** | **partial (demote UX + cold-start unit)** | Explicit demote confirm + backup-first + demote marker + presence-only persist **landed**（IMPL-A）；**cold-start non-resurrection unit landed**（IMPL-H：`shouldReseedV1TasksFromDefaults` / `normalizeStudyTasks({ allowEmpty })` / demoted `readStudySnapshot`；empty demoted V1 不 reseed defaults）；**仍开**：full e2e cold-start product path、auto ≥30d 策略 UX、无 silent wipe 纪律；migration 永不 erase |
| **main `powerMonitor`（OS 睡眠/恢复）** | **landed (signal bridge)** / matrix residual | `teach:system-power` + preload + renderer map 至 STC-206 wake **landed**（IMPL-B；见 ADR-0129 §4）；**unit recovery matrix landed**（IMPL-I）；pin 仍 renderer dual-write；**完整 sleep/crash e2e 矩阵 ≠ 关闭** |
| **STC-707 深度 conflict auto-resolve（自动错开写回）** | **partial (host wire)** | pure `proposeScheduleConflictResolve` + banner「预览错开→确认应用」**landed**（IMPL-F）；**host wire landed**（IMPL-G：`planning-schedule-conflict-resolve-host` + `StudyTaskSchedulePage` `resolvePreview` / `onApplyResolve` sequential dual-write CAS + local refresh；host-wire unit）；**仍非 silent default**；product-signal residual 仍开；**禁止**静默自动错开为默认；尊重 locked / hard end |
| **STC-702 UI 序列编辑器** | **partial** | ordered list 编辑器 + V1↔V2 dual-write + session `rhythmStepIndex` + store fail-closed **landed**（IMPL-C；**非** freeform drag）；product-signal polish / 番茄+连续稳定性仍开；**≠** §18 |
| **STC-703 重复产品 UI** | **partial** | 最小规则编辑 + dry-run preview + confirm sequential upsert **landed**（IMPL-D）；durable recurrenceRules 命令/字段 + 完整重复日历 UI 仍开；无 silent task clone |
| **STC-704 旅行 / 高级 zone UX** | **partial** | 块级 optional `timeZone` + 周 overnight multi-chip + labels-only mismatch tooltip **landed**（IMPL-E）；旅行设置页 / 一键 rezone 仍 open（禁止静默 rezone 默认） |
| **§18 整体「产品完成」徽章** | **open / not satisfied** | 上表 1–11 无关键 residual 且有定向证据；**不得**用 pure-only、partial UI、unit matrix 或 power 信号桥 alone 代替 |

#### 5.2 可由 pure + partial renderer **支撑但不关闭 §18** 的项

- STC-701 / 705 / 706 — pure + 周视图 banner / 拖拽芯片 **已支撑**；**不**关闭深度 auto-resolve。
- STC-707 — pure propose + banner opt-in CTA + **host wire partial** **支撑**（IMPL-F+G）；**仍非 silent default**；**不**因 host wire 关 product-signal residual 或 §18。
- STC-702 / 703 / 704 — pure + **partial UI**（序列编辑器 / 最小规则 expand / 块 zone+周 overnight）**支撑** Phase 7 进度；**不**关 product-signal polish 与 §18。
- dual-write + sole-read hydrate、TimerSession analytics/focus demotion、migration banner、**V1 demote UX + cold-start unit**、empty-start、classification、main powerMonitor **信号桥**、**unit recovery matrix** — **支撑** cutover / recovery progress（ADR-0129）；**不**关闭 V1 sole-authority 终态、full e2e cold-start、完整 crash **e2e** 矩阵或 §18。

### 6. 实现约束（与 0094 / 0117 / 0129 叠加）

1. **不**新冻结 canonical 路径 / schemaVersion 超 ADR-0117；schema bump 须新 ADR 或 0117 修订节。
2. **不**引入默认 shell / YOLO / MCP marketplace / 远程 telemetry / 产品 FTS。
3. **不**改变 TeachingTurnCoordinator / LearningSession settlement；计时写路径仍经 StudyPlanningStore + `expectedRevision`。
4. 新 pure 模块遵守 ADR-0075；禁止继续胀大 `WorkbenchPomodoro` / `useStudySession` / `StudyTaskSchedulePage` 而不 peel。
5. Phase 7 pure 导出优先落在 `src/shared/study-planning/` barrel；renderer wire 另 PR。

## 明确不包含 / non-claims

本 ADR **不**：

- 宣称 **§18 产品完成** 或「任务/计时一体化已全面交付」；
- 宣称 **STC-702 / 703 / 704** 产品 **全完成** 或 §18 关闭（partial ordered editor / 最小规则 expand / zone wire **允许诚实 partial**，**不等于**上线完成徽章）；
- 授权 **任意拖拽序列编辑器**、**静默任务复制**、**静默自动错开冲突**、或 **默认自动擦除 V1 localStorage**；
- 把 main `powerMonitor` **信号桥**或 unit recovery matrix 误标为完整 sleep/crash **e2e** 矩阵关闭（桥 + unit 已落地见 ADR-0129 §4；e2e residual 仍开）；
- 修改 ADR-0094 十项产品冻结值，或扩大 ADR-0117 路径 / 命令闭集（命令可增但须兼容既有语义）；
- 替代 [ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md) 对 cutover 事实的描述；
- 要求 Agent 6 以外的代理编辑 `docs/adr/README.md` 或路线图正文（索引 / 路线图勾选由编排方负责）。

## 后果

1. 规划轨可将路线图标为 **planning-complete**，但 changelog / header **必须**保留 §18 residual 诚实句（或显式指向本 ADR §5），**禁止**删除「§18 still open」类事实而不提供关闭证据。
2. 工程分派：STC-702/703/704 **允许 pure-first + partial UI**（已落地者不重复当零起点）；旅行设置 / auto-rezone、完整 crash **e2e** 矩阵、V1 sole-authority 终态 / full e2e cold-start、STC-707 **product-signal**（host wire 已 partial） **默认不排期为关闭**，直至触发条件与证据满足。
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

**一句话：** Phase 7 高级能力 pure-first + partial UI 已进展；路线图可关、§18 **not satisfied** 不可假装关；V1 demote + cold-start unit / power 信号桥 / unit recovery matrix / STC-707 host wire / 702–704 partial UI **支撑进度但不关闭 residual**；full e2e cold-start、完整 crash e2e、STC-707 product-signal 与 product polish 仍是带触发条件的 residual。
