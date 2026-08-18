# ADR-0167：教学权威与可同步用户状态边界

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** **已采纳（2026-07-31）**
- **日期：** 2026-07-31
- **范围：** “文件是教学真相源 / teaching authority / local-wins / 本地优先”术语的精确定义；用户账户、等级经验、偏好、规划和分析摘要的同步边界
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0094](0094-study-task-timer-planning-design-gate.md)、[ADR-0117](0117-study-planning-store-paths-and-wire.md)、[ADR-0162](0162-local-learning-effectiveness-analytics.md)
- **证据：** 术语与边界定义见本 ADR 正文；落地由引用它的 ADR（ADR-0008、0094、0117、0162 等）与 `AGENTS.md` 产品地板承担。

## 1. 背景

过去的“文件是教学真相源”“本地优先”和“服务端不是教学权威”表述，意在保护 AI 指导学习时的教学决策链路：系统必须根据当前学习进度、既有答题表现、Evidence、Outcome 与 Review 制定下一步学习计划，且不能由同步副本、分析投影或运行记录反向篡改这条链路。

这些表述不得被扩大解释为“任何用户数据都不得多端同步”。特别是等级、经验、每日经验额度、外观/偏好、任务规划快照和经同意的派生分析摘要，都可能是用户需要跨设备保持一致的产品状态；它们不因可同步而成为教学权威。

## 2. 决策：两类数据、两条边界

### 2.1 教学决策事实（Teaching Authority Plane）

下列数据仅指向 AI 的学习诊断、下一步教学计划、复习安排和 Outcome settlement：

- 工作区中的 Mission、课程、资源、学习记录及其 canonical 文件；
- `LearningSession`、typed Evidence、learner facts、Outcome、Review 与相关 revision / settlement 约束；
- 用于判断“学生现在会什么、应学什么、下一步怎么教”的答题与学习表现。

对这类数据：文件 / canonical ledger 是教学真相源；同步归档、SQLite、analytics、agent run、UI 缓存和服务端副本不得覆盖、伪造或成为 AI 制定教学计划的替代依据。`local-wins` 若用于教学资产，只描述这一类冲突与回写限制。

### 2.2 可同步用户产品状态（Syncable User State Plane）

下列数据不属于教学决策事实，可以在用户显式开启账号/同步后进行多端同步：

- 等级、总经验、每日经验上限与按来源的当日经验计数；
- 任务、日程、计时方案等个人规划状态；
- 用户偏好、界面/陪伴状态、设备状态；
- 经同意上传的派生学习分析摘要。

同步服务可以存储、CAS 合并、分发并恢复这些状态。它不可以借此写入或改写 Teaching Authority Plane，也不可以把等级经验当作答题正确性、掌握度、Evidence、Outcome、Review 排程或下一步教学计划的依据。

## 3. 隐私与同步语义

“本地优先 / 无默认 remote telemetry”准确含义是：**不得静默上传、不得默认 phone-home、不得收集原始计时或教学事件流**；它不是对用户显式开启的同步功能的禁止。

可同步状态仍须遵守各域的 wire contract、`revision` CAS、`actionId` 幂等、最小化数据与用户同意。经验数据的跨设备同步应发送已结算的状态或受限派生摘要，而不是把服务端升级为 XP 规则、教学 Outcome 或学习计划的裁判。

## 4. 实施状态与后续约束

本 ADR 澄清产品和文档边界；它**不声称**现有 Server 已经存储等级经验。要新增 Server 的 progression 记录、API 或迁移，须在对应同步契约中显式定义版本、冲突 / 幂等、隐私同意、迁移和多端恢复行为，并保持本 ADR 的双平面隔离。

此后文档中的“教学真相源”“teaching authority”“local-wins”和“本地优先”均按本 ADR 解释；若某处描述的是不同实体或冲突策略，必须明确写出实体范围，不能用上述术语泛化禁止用户产品状态同步。
