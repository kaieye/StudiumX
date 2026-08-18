# ADR-0154：间隔复习调度投影与 planner `review_due` 动作

- **决策状态：** accepted
- **实施状态：** partial
- **实施说明：** **部分实施**（2026-07-27）：纯调度投影 + ledger scan 适配器 + planner 动作扩展 + Pet 复习投影切换 + Teaching Reader 的受控 `review_due` 入口已落地;bridge 已喂 dueCount;TodayQueue 消费（ADR-0161）residual。**Pet 功能范围冻结，当前语义不再扩展。**
- **日期：** 2026-07-26
- **范围：** 把 spacing（间隔复习）从 `teach` kernel 的原则文本升级为系统行为:确定性复习调度投影、`NextTeachingStepPlanner` 动作 union 扩展（修订 [ADR-0012](0012-deterministic-next-teaching-step-planner.md)）、Teaching Reader 的 canonical `review_due` 入口，以及 Pet `lesson-review-due` 切换到共享调度器并保持既有语义。**不**新增 settlement 写者,**不**改 outcome 历史,**不**把 Pet 扩展为 canonical review-history、ReviewView、TodayQueue 或通知/激励产品面。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md);[ADR-0009](0009-typed-lesson-interaction-evidence.md);[ADR-0012](0012-deterministic-next-teaching-step-planner.md);[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)（信号触发升级模式）;[ADR-0157](0157-learning-outcome-strength-and-consolidation.md)（Proposed,消费本调度器）;[ADR-0161](0161-today-learning-queue-projection.md)（Proposed）
- **证据：** `src/shared/review-scheduler.ts`（纯投影）;`src/main/review-schedule-facts.ts`（ledger scan → 调度事实适配器）;`src/main/next-teaching-step-planner.ts` + `src/shared/teaching-types/next-teaching-step.ts`（`review_due` / `spaced_review_due`,可选 `review.dueCount` 事实）;`src/main/teaching-loop-facts.ts` / `teaching-loop-fact-source.ts` / `teaching-loop-resolver.ts`（可选 review 事实透传）;`src/main/teaching-turn-coordinator-host.ts` + `src/shared/teaching-types/teaching-presentation.ts`（count-only snapshot 与 CAS action）;`src/main/skill-orchestration-authority-bridge.ts`（chat 路径喂真实 dueCount）;`src/renderer/src/teaching-turn-presentation.ts`（Teaching Reader 显示动作）;`src/renderer/src/views/pet/lesson-review-due.ts`（v2:消费共享调度器,v1 语义逐字节保持）;测试 `tests/unit/review-scheduler.unit.test.ts`、`tests/unit/review-schedule-facts.unit.test.ts`、`tests/unit/next-teaching-step-planner.unit.test.ts`、`tests/unit/teaching-turn-coordinator-host.unit.test.ts`（spaced review 块）

## 1. 问题

1. 链路终点是「写入 learning record」,没有任何模块回答「何时复习」——flashcards 生成后无人消费,Pet 的到期规则是「满 24 小时即到期」的固定阈值且不读 ledger。
2. kernel 原则（storage strength、spacing）没有系统行为支撑;`established` 一次性判定后系统永远相信它,与遗忘曲线冲突。
3. planner 动作 union 只有即时纠错与推进,没有「先还复习债再学新课」的决策通道。

## 2. 决策

### 2.1 纯调度投影（`deriveReviewSchedule`）

- 确定性、零 I/O、零依赖、可重建:同输入（items + 显式 `now`）→ 同调度;caller 拥有全部 I/O 与时间。
- **固定间隔阶梯 v1:`[1, 3, 7, 21, 60]` 天,零参数。** 规则:连续答对 streak 沿阶梯上行;最新一次答错 → `lapsed` 并回到基础间隔;无历史 → 以 anchor（如 lesson createdAt）+ 基础间隔进入 `new`;非法时间戳整条排除（fail-soft,不发明时间事实）。
- 每次派生的 `dueNow` 上限默认 5 条（复习是提醒,不是债务墙）;`dueCount` 保留真实总数。
- 自适应参数（FSRS 式）**不**在本 ADR 授权范围:需 ≥3 个可复现的「固定阶梯显著失准」案例 + 新 ADR（对齐 ADR-0050 的信号触发门槛模式）。

### 2.2 证据来源:只读 ledger scan 适配器

- `deriveReviewScheduleFromScan`:从 canonical session 的 typed `quiz_answered` / `flashcard_rated` 事件派生 per-item 历史（identity 校验对齐 evaluator 的保守姿态;malformed 跳过）。flashcard 评分折叠:`again → incorrect`,其余 → correct（粗粒度 v1,记录在案）。
- **只有有真实交互历史（或 ledger 快照提供 anchor）的 item 进入调度;不为未练习过的内容发明复习项**（未练习内容的覆盖属 ADR-0159 掌握度模型）。

### 2.3 planner 动作扩展（修订 ADR-0012 的动作 union）

- `NextTeachingStepFacts` 新增**可选** `review: { dueCount }`（仅计数,永不携带 item payload）;动作 union 增加 `review_due`,理由 `spaced_review_due`。
- 决策位置:**只在其余环节健康时触发**——排在 legacy/资源/`contrast_and_retry`/证据与 outcome 异常检查**之后**,`no_next_goal` 与 `continue_next_session` **之前**。即:即时纠错永远优先于复习债;复习债优先于学新课（interleaving 的最小实现）。
- **严格向后兼容:未提供 review 事实时,决策表逐字节不变**;`safeInputSummary.review` 仅在事实提供时出现。schemaVersion 保持 1——任何将向 planner 供给 review 事实的新 caller,必须先确认其消费方处理 `review_due`。

### 2.4 消费面（本 ADR 已接线部分）

- chat 路径:authority bridge 在 loop 事实中喂真实 `dueCount` → snapshot nextStep 可为 `review_due` → 经既有 authorityEcho 进入 skill 编排计划投影。
- Teaching Reader：host 以同一 canonical ledger scan 重建 review schedule，并仅把 planner 的 `review_due` 映射为固定 learner copy；action 用 opaque operation ID + `expectedRevision` fail-closed 校验。接受后只启动固定 review teaching intent，新的作答仍必须经 Evidence → evaluator → committer / `TeachingTurnCoordinator` 结算。snapshot 不含 dueCount、item ID、时间戳、路径或 planner diagnostics；不实现 ReviewView、TodayQueue 或 Pet 接线。
- Pet:`lesson-review-due` 改为消费共享调度器（renderer 输入无 per-attempt 时间戳,以 createdAt 为 anchor 的种子模式**逐字节复刻 v1 行为**）。当前 Pet 功能到此为止；不接入 canonical snapshot IPC、真实逐 item 历史、ReviewView、TodayQueue 或新的通知/激励功能。

## 3. 非目标 / 红线

1. 调度器是**可重建投影,不是第二权威**:不写 LearningSessionLedger、不创建/修改 outcome、不改 record;与 ledger 冲突时以重算为准;调度文件永不作为结算输入。
2. settlement sole-writer（[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)/[0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)/[0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)）不变;evidence-gating 不变;复习完成 = 正常 Evidence → evaluator → committer 路径,无捷径。
3. 本地优先:无远程 telemetry;无 FTS/向量库;同意门控记忆边界不变。
4. 不实施每日复习通知节流策略；Pet 维持既有行为且不新增通知能力。
5. 逾期不惩罚:无 streak 绑架、无罚金语义。

## 4. 验证入口

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/review-scheduler.unit.test.ts tests/unit/review-schedule-facts.unit.test.ts tests/unit/next-teaching-step-planner.unit.test.ts tests/unit/lesson-review-due.unit.test.ts
```

## 5. 一句话

**复习时机成为确定性投影事实:阶梯化间隔、只读派生、可重建;planner 学会「先还债再借新债」,而结算权威一寸未动。**
