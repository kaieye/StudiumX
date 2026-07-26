# ADR-0161：TodayQueue 今日学习队列（纯聚合投影,三表面单源）

- **状态：** Proposed（设计草案,未实施 — 2026-07-26）
- **日期：** 2026-07-26
- **范围：** 聚合"到期复习 + planner 下一步 + 今日 Study task"的 TodayQueue 纯投影；确定性排序与每日复习上限；教学对话入口卡片、自习室 FocusContract 默认值 / SR-305 深链、Pet 通知源三个表面的单源消费。**不**新增写权威,**不**改变计时与教学 Session 的术语边界。
- **关联：** [teaching-chain-evaluation-and-optimization.md](../teaching-chain-evaluation-and-optimization.md)（§3.2 G3/G8、§4 O7）；[ADR-0012](0012-deterministic-next-teaching-step-planner.md)；[ADR-0094](0094-study-task-timer-planning-design-gate.md)（TimerSession ≠ LearningSession）；[ADR-0117](0117-study-planning-store-paths-and-wire.md)；[ADR-0129](0129-study-planning-renderer-cutover-and-sole-authority.md)；[study-room-improvement-plan.md](../study-room-improvement-plan.md)（SR-104 / SR-305 / FocusContract）；[pet-next-stage-roadmap.md](../pet-next-stage-roadmap.md)（通知与安静模式约束）；ADR-0154（到期复习投影,同批设计草案）

## 1. 问题

用户第 2 天起打开 app 没有"今天该学什么"的明确答案（评估文档 G3/G8）：planner 的下一步存在于领域层但用户看不见;flashcards 生成了无人消费,Pet 的 `lesson-review-due` 是不读 ledger 的 24 小时固定阈值;planner 下一步（教学）、今日 Todo（Pet）、ScheduleBlock（排程）三者互不知晓。动机层激励的是"专注时长"而不是"学习行为"——自习室与 Pet 设计再完整,没有教学内容供给,激励包做完也只是空转。

## 2. 决策

### 2.1 TodayQueue：纯聚合投影,零新权威

```ts
TodayQueue = 到期复习（ADR-0154 投影,每日 3–5 项硬上限）
           + planner 下一步（ADR-0012 typed decision）
           + 今日 Study task（既有 study planning store）
```

- 每项带 `{ kind: 'review_due' | 'continue_course' | 'study_task', sourceRef, deepLink, title }`。
- **确定性排序**：复习债 > 继续课程 > 自由任务（"先还债再借新债"）;同 kind 内按到期时间/planner 理由/任务既有顺序稳定排序;同输入同队列,可重算。

### 2.2 三个表面消费同一队列

1. **教学对话入口卡片**：冷启动第一眼可见队首与理由,一键进入。
2. **自习室**："一键开自习"的 FocusContract 默认值从"当前任务标题"升级为**队列首项**（SR-104 的自然延伸）;经 SR-305 深链从任务/合同直达 Lesson / 教学对话（只读 catalog,不双写 outcome）。
3. **Pet 通知源**：Lesson Review / Learning Progress 通知直接消费队列,**替换** 24h 固定阈值逻辑;Pet 通知仍是可重建投影,不是真相来源。

### 2.3 边界与节制

- **队列零写权**：完成一项 = 各自领域的既有完成语义（复习 = 结算链、任务 = Study task 完成、继续课程 = 教学轮）,队列随之重算、跨三表面一致消失;禁止队列文件成为任何结算输入。
- **计时 ≠ 教学 Session**：TimerSession / LearningSession / Study task 术语边界不动（ADR-0094）;自习室计时事实不因深链冒充教学事实。
- **每日复习 3–5 项硬上限**;通知遵守 Pet 既有**安静模式**;逾期不惩罚、**无 streak 绑架**——不复刻"从学习搭档变成任务告警器"的反模式（评估文档 §7 风险表）。
- 队列为空时呈现诚实空态（"今日无到期项"）,不制造伪任务填充。

## 3. 非目标 / 红线

1. 零新权威、零写权：不写 ledger / outcome / record / Study task,不引入第二状态机;settlement sole-writer 与 evidence-gating 不变（ADR-0011/0018/0023、0010/0016）。
2. planner 保持纯函数;队列只消费其 typed decision,不反向驱动 planner 写入（ADR-0012/0151）。
3. SR-305 深链只读 catalog / snapshot,不双写 outcome;Pet 通知不因队列获得改变业务 run 的权力。
4. 本地优先：无默认远程 telemetry;不触碰同意门控记忆;不引入 FTS / 向量库。
5. 不在本 ADR 交付激励包（streak/badges/D-day）——先有"今天该学什么",再谈激励,顺序不可反。
6. **本 ADR 为设计草案：队列投影与三表面接线均无实现代码,不宣称已实施。**

## 4. 验证入口（实施时兑现；当前无代码）

本 ADR 合入不改变任何生产行为。实施切片须至少落地：

- 队列纯函数单测：确定性排序、3–5 项复习上限、同输入同队列。
- 表面一致性测试：完成队首项后,入口卡片 / 自习室默认值 / Pet 通知三表面一致更新。
- 安静模式测试：quiet 期间队列不产生新通知,quiet 结束不批量重播过期通知。
- 深链 fail-closed 测试：目标 Lesson / Session 缺失时深链显式失败,不伪造入口、不自动创建 Session。
- 冷启动验收：打开 app 30 秒内看到队列并能一键进入首项（评估文档 §4 O7 验收）。
- 术语门禁：队列项不把 TimerSession 事实标注为 LearningSession（沿用 ADR-0094 既有检查精神）。

## 5. 一句话

**TodayQueue 是零写权的纯聚合投影：到期复习（每日 3–5 项）> 继续课程 > 自由任务的确定性排序,教学对话入口、自习室 FocusContract/SR-305 深链、Pet 通知三个表面消费同一队列;完成语义归各领域,遵守安静模式,无 streak 绑架,计时与教学 Session 边界不动。**
