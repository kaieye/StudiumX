# ADR-0159：LearningObjective 与 MasteryProjection（目标粒度掌握度 + diagnose 前测）

- **状态：** Proposed（设计草案,未实施 — 2026-07-26）
- **日期：** 2026-07-26
- **范围：** CourseDefinition schema v2 的 LearningObjective 扩展；quiz/flashcard item 与 objectiveId 的 sidecar 绑定；按 objective 聚合的 MasteryProjection 纯投影；diagnose 前测（只评估、不讲解的特殊 lesson）；mastery 摘要的预算化 turn-tail 注入。**不**改变 CourseDefinition 的非权威地位、settlement 链路或任何生产行为。
- **关联：** [teaching-chain-evaluation-and-optimization.md](../teaching-chain-evaluation-and-optimization.md)（§3.2 G5、§4 O4）；[ADR-0012](0012-deterministic-next-teaching-step-planner.md)；[ADR-0013](0013-budgeted-provenance-aware-teaching-context.md)；[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)；[ADR-0026](0026-course-definition-durable-session-order.md)；[ADR-0044](0044-teaching-prompt-cache-contract.md)；[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)（无 FTS/向量的检索红线）；[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)（`diagnose` stage）；[ADR-0157](0157-learning-outcome-strength-and-consolidation.md)；ADR-0154（RetentionProjection,同批设计草案）

## 1. 问题

系统没有"学习者当前会什么"的结构化事实：learner profile 只是 ≤6 条同意门控自由文本,水平证据散落在 learning-records 自由 markdown 与 ledger quiz 事件里,无任何结构聚合;编排 stage 枚举里有 `diagnose` 却没有流程真正执行前测;CourseDefinition 只有固定有序 Session 槽位,无 objective 概念,掌握无从映射（评估文档 G5）。结果是 ZPD 判断整体委托给 LLM 每轮即兴发挥,跨 Session 难度校准、跳课/补课、"已建立的能力不再从零讲解"都缺乏事实依据。

## 2. 决策

### 2.1 CourseDefinition schema v2：LearningObjective

- `COURSE_DEFINITION_SCHEMA_VERSION = 2`：每个 Session 槽位可选声明 **1–3 个** `LearningObjective { objectiveId, behavior }`——`objectiveId` 稳定且 course 内唯一;`behavior` 为一句话**可观察行为描述**（"能解释/能写出/能判断…"）。
- **向后兼容**：v1 文件继续可读,lazy materialize 不强制迁移;无 objective 的旧数据一律**回退 lesson 粒度**聚合。CourseDefinition 仍非 settlement authority（ADR-0026 不变）。

### 2.2 item ↔ objective 绑定（写入 assessment sidecar）

lesson 生成时要求每个 quiz/flashcard item 标注 `objectiveId`,写入 assessment sidecar 并被 digest 覆盖（ADR-0016 信任边界内的字段扩展）;缺失 objectiveId 合法,该 item 落回 lesson 粒度。

### 2.3 MasteryProjection：纯投影,零写权

按 objective 聚合 Evidence + settled outcomes + retention（ADR-0154/0157 共享派生管线）：

```ts
{ objectiveId, state: 'not_started' | 'in_progress' | 'provisional' | 'consolidated' | 'decayed',
  evidenceRefs /* identity only,不带正文 */, lastVerifiedAt }
```

确定性、可重建,投影文件损坏即重算;与 ledger 冲突以重算为准;**永不**成为结算输入或第二权威。

### 2.4 diagnose 前测 = 只有评估、没有讲解的特殊 lesson

- placement 复用**现有 lesson/sidecar/结算全链**（零新权威）：用户开新 course 或自述"学过一些"时,编排进入 `diagnose` stage（ADR-0151 词表已有）→ 生成 5–8 题跨 objective、无讲解正文的前测 lesson → 交互经既有 recorder/evaluator/committer 按普通 Evidence 结算 → MasteryProjection 立即有初值。
- 前测**可跳过**,仅在上述两种场景提议,不把 instant_help 拖入前测（评估文档 §7"过度 gate 化"风险）。

### 2.5 注入与分工：画像管"怎么教",掌握度管"教什么"

mastery 摘要以**预算化 allow-list** 进 turn-tail（ADR-0013 机制复用;不进 stable prefix,守 ADR-0044）,标识符级如"已 consolidated: a,b;decayed: c;未学: d,e"。它与 learner profile 分工明确：profile（同意门控自由文本）管**怎么教**（语气/例子/偏好）,MasteryProjection（源于 Evidence,非 memory）管**教什么**——后续 Session 顺序与难度先由模型消费投影校准,确定性跳课规则留待后续 ADR。

## 3. 非目标 / 红线

1. settlement sole-writer 与 evidence-gating 不变：前测与日常评估同链结算,objective 不开辟第二结算路径（ADR-0011/0016/0018/0023）。
2. planner 保持纯函数;MasteryProjection 只能作为其输入事实,不得由投影反写 ledger（ADR-0012/0151）。
3. CourseDefinition 不升级为 LearningSession/Evidence/Outcome 权威;文件系统仍是 Lesson 发现真相源（ADR-0026）。
4. **不**因掌握度模型引入 embedding/向量库/FTS：objective 粒度确定性聚合已够用,维持 ADR-0050 与 0001 的信号触发门槛。
5. 本地优先无默认 telemetry;**不**触碰同意门控记忆——掌握度源于结算证据,反而降低对画像记忆的依赖。
6. **本 ADR 为设计草案：schema v2、投影与前测均无实现代码,不宣称已实施。**

## 4. 验证入口（实施时兑现；当前无代码）

本 ADR 合入不改变任何生产行为。实施切片须至少落地：

- schema v2 单测：v1 读入兼容、objectiveId 唯一性校验、无 objective 回退 lesson 粒度。
- MasteryProjection 单测：同一 ledger 重算同投影;state 迁移（含 `decayed`）确定性。
- 端到端：前测 lesson → 普通 Evidence 结算 → 投影初值 → 下一课 prompt 含预算化 mastery 摘要;"已 consolidated 的 objective 不再从零讲解"进入 prompt 合同测试。

## 5. 一句话

**CourseDefinition v2 让每个 Session 声明 1–3 个可观察 LearningObjective,item 经 sidecar 绑定 objectiveId,MasteryProjection 纯投影聚合出 not_started→consolidated/decayed 的目标粒度掌握态;前测是"只评估不讲解"的特殊 lesson 复用全链结算——画像管"怎么教",掌握度管"教什么",旧数据回退 lesson 粒度。**
