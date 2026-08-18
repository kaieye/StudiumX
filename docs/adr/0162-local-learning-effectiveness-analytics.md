# ADR-0162：本地学习效果分析（learner 侧指标页签 + 系统侧 doctor facts）

- **决策状态：** proposed
- **实施状态：** not_started
- **实施说明：** Proposed（设计草案,未实施 — 2026-07-26）
- **日期：** 2026-07-26
- **范围：** 从 LearningSession ledger 与 RetentionProjection/MasteryProjection 派生的本地学习效果指标（封闭 allow-list）；StudyAnalyticsPage 新增"学习效果"页签；teaching doctor facts 扩展。**不**引入远程 telemetry、全站对比或任何新写权威。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)；[ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)；[ADR-0034](0034-redacted-support-bundle.md)；[ADR-0093](0093-teaching-doctor-multi-collector-facts.md)；[ADR-0104](0104-teaching-doctor-session-outcome-scan-collectors.md)；[ADR-0122](0122-usage-ledger-as-canonical-observability.md)（正交性）；[ADR-0157](0157-learning-outcome-strength-and-consolidation.md)；[ADR-0159](0159-learning-objectives-and-mastery-projection.md)；[ADR-0160](0160-teaching-turn-behavior-contract.md)；[ADR-0161](0161-today-learning-queue-projection.md)；ADR-0154（RetentionProjection,同批设计草案）
- **证据：** 未实施（Proposed，2026-07-26 设计草案）；本地学习效果指标设计见本 ADR 正文。

## 1. 问题

教学效果不可度量,改进没有反馈回路（评估文档 G9）：usage ledger 明确与 LearningSession 正交（token/工具观测,ADR-0122）,StudyAnalyticsPage 只有专注分析;没有掌握率、复习命中率、遗忘率、Elicit 率等任何本地学习效果指标。kernel/prompt/planner/调度算法的任何改动都无法回答"教学效果变好了吗",产品迭代只能凭感觉。本地优先 ≠ 不度量，也 ≠ 禁止用户显式开启的跨设备同步——本地、可脱敏、用户可见的学习分析，以及经同意的派生摘要同步，都与仓库红线兼容；它们不能反向成为制定下一步教学计划的 authority（ADR-0167）。

## 2. 决策

### 2.1 指标目录（封闭 allow-list,标识符与计数级,不带正文）

| 侧 | 指标 | 来源 |
| --- | --- | --- |
| 学习者侧 | 各 course 掌握进度（objective 粒度） | MasteryProjection（ADR-0159） |
| 学习者侧 | 复习命中率（到期复习的首次答对率） | ledger Evidence + ADR-0154 投影 |
| 学习者侧 | provisional → consolidated 转化率 | outcome strength（ADR-0157）+ RetentionProjection |
| 学习者侧 | 遗忘回退率（consolidated → decayed） | RetentionProjection |
| 系统侧 | 每教学轮 Elicit 率（Turn Shape 合规聚合） | TurnShapeReport 本地诊断（ADR-0160） |
| 系统侧 | 每 Session Evidence 数 | ledger |
| 系统侧 | planner 动作分布、`established` 中 provisional 停留时长 | settled outcomes + planner decisions |

指标均为标识符、计数或比率;分母不足时显式输出 `not_enough_data`,不外推、不平滑造数。

### 2.2 派生与权威边界

- 全部指标由**纯投影**从 ledger + 既有投影（RetentionProjection / MasteryProjection / Turn Shape 诊断）派生;**全部可由 ledger 重算**,投影文件损坏即重建,不回写任何 canonical 事实。
- 与 usage ledger（ADR-0122）保持**正交**：不合并语料、不互为权威;学习效果解释"学没学会",usage 解释"花了多少 token/时长"。

### 2.3 呈现

1. **StudyAnalyticsPage 新增"学习效果"页签**（与既有专注分析并列）：learner 侧指标,course/objective 粒度,用户可见、措辞非评判性。
2. **teaching doctor facts 扩展**：系统侧指标经 ADR-0093 的 multi-collector 缝挂接为新 collector（沿 ADR-0104 Session/outcome 扫描 collector 的既有模式）,脱敏后可进 support bundle（ADR-0034）。
3. **用途**：kernel/调度/planner 改动后,用同一份本地报告做前后对比,与 ADR-0160 的本地教学回归互为印证。

## 3. 非目标 / 红线

1. **无远程 telemetry**：一切计算与呈现在本地,默认零上报（仓库产品地板红线）;**无全站对比**,不存在"与其他用户比较"的数据通路。
2. **不向学习者展示焦虑性对比指标**：无排名、无同侪对比、无逾期羞辱;系统侧指标只进 doctor/诊断面,不进 learner 页签。
3. 分析投影零写权:不是 Evidence、不是 outcome、不是结算输入;settlement sole-writer 与 evidence-gating 不变（ADR-0011/0018/0023、0010/0016）。
4. planner 纯函数不变（ADR-0012/0151）;指标不反向驱动结算或教学行为,只供人读与回归对比。
5. 不把 analytics SQLite 扩成 FTS / 用户可见搜索语料,不引入向量库（ADR-0001/0050 既有红线）;不触碰同意门控记忆;报告不含 learner 正文、prompt 正文或 provider payload（ADR-0013/0034 精神）。
6. **本 ADR 为设计草案：指标管线、页签与 collector 均无实现代码,不宣称已实施。**

## 4. 验证入口（实施时兑现；当前无代码）

本 ADR 合入不改变任何生产行为。实施切片须至少落地：

- 指标纯函数单测：同一 ledger 重算同指标;allow-list 之外字段不得出现在输出。
- 重算等价测试：删除分析投影文件后全量重建与增量结果一致。
- 前后对比测试：固定合成 ledger fixture 上,仅调度/kernel 参数变化时只有预期指标移动（回归基线）。
- 脱敏测试：doctor facts / support bundle 输出不含 learner 正文与路径泄露。
- UI 测试：学习效果页签仅渲染 learner 侧指标;系统侧指标不出现在 learner 面。

## 5. 一句话

**给教学迭代装上本地的眼睛：从 ledger 与 retention/mastery 投影派生掌握进度、复习命中率、consolidated 转化率、遗忘回退率与 Elicit 率等封闭指标,learner 侧进 StudyAnalyticsPage 新页签、系统侧进 doctor facts——全部可由 ledger 重算,零写权,无远程 telemetry,无全站对比,无焦虑性指标。**
