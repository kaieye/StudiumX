# ADR-0157：Learning Outcome 强度分级（provisional → consolidated）

- **决策状态：** proposed
- **实施状态：** not_started
- **实施说明：** Proposed（设计草案,未实施 — 2026-07-26）
- **日期：** 2026-07-26
- **范围：** 为 `established` outcome 引入 strength 维度（`provisional` / `consolidated`）的领域设计；复验事件与 RetentionProjection 的派生语义；`NextTeachingStepPlanner` 对 `provisional` 的保守推进；evaluator 判据的 `evaluatorVersion` 递增机制。**不**改变四分类 outcome union、settlement sole-writer、既有 record 文件或任何生产行为。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0009](0009-typed-lesson-interaction-evidence.md)；[ADR-0010](0010-evidence-gated-learning-record-cutover.md)；[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)；[ADR-0012](0012-deterministic-next-teaching-step-planner.md)；[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)；[ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)；[ADR-0029](0029-learning-branch-projection.md)；[ADR-0154](0154-spaced-review-scheduler-and-review-due-planner-action.md)（间隔复习调度器,部分实施;本 ADR 的 RetentionProjection 构建于其上）；[ADR-0160](0160-teaching-turn-behavior-contract.md)（Mastery Policy 治理）
- **证据：** 未实施（Proposed，2026-07-26 设计草案）；领域设计与约束见本 ADR 正文。

## 1. 问题

当前 mastery 判定是一次性的：该课客观题最新一轮全对 + assessment artifact 完整即 `established`,写入 record 后系统永远相信它（评估文档 G2）。这恰好落进 kernel 自己警告的陷阱——fluency strength 造成的掌握幻觉：当场表现（performance）≠ 学习（learning）,无间隔的成功检索对 storage strength 贡献很小。后果是 learning record 系统性高估掌握,planner 基于虚高 outcome 越推越快、地基越走越空；学习者 30 天后回看"已掌握"清单会与自身感受冲突,损害本产品最核心的诚实性资产。

## 2. 决策

### 2.1 strength 是 payload 维度,不改四分类 union

- outcome kind 仍为 `established | misconception_corrected | needs_practice | not_evidenced`,recordless 语义（ADR-0018）不变。
- `established` 的 outcome payload 新增 `strength: 'provisional' | 'consolidated'`：
  - **provisional**：当场（同一 Session 轮次内）达到既有 mastery 判据（客观题全对 + artifact 可信）。首次结算恒为 `provisional`。
  - **consolidated**：在距初次 `established` 结算 **≥1 个间隔日**（跨 UTC 日界且间隔 ≥24 小时,防时区抖动）之后,对同一课/objective 的复验中再次成功检索。

### 2.2 复验是 Evidence,不是第二次结算写入

- 复验交互复用既有通道：经 `LessonInteractionRecorder` 追加到**原 canonical Session**（ADR-0009 已支持多次 attempt 为独立原始事实）,评分仍只信 digest 绑定的 assessment sidecar（ADR-0016）。
- **原始 outcome record 保持 immutable**：不重写 `outcome.json`、record 或 settlement marker（与 ADR-0029"不改 canonical outcome 历史"一致）。
- **当前强度是派生态**：由 RetentionProjection（ADR-0154 的 review scheduler 管线）从 ledger 事件流重算得出（`provisional / consolidated / decayed` 等）,投影文件损坏即重算,与 ledger 冲突时以重算为准。投影不是第二权威,不得成为结算输入。

### 2.3 planner 对 provisional 更保守

- `NextTeachingStepPlanner` 输入扩展 strength 事实（仍为纯函数,ADR-0012）：`provisional` **允许** `continue_next_session`,但 decision payload 须附带"该课目标存在复习债"的 typed 理由,该课/objective 由 ADR-0154 投影自动排入复习队列。
- 不得从 `provisional` 单独推出 `consolidated`;不得因复验失败改写既有 record（复验失败只影响派生强度与复习排期）。

### 2.4 evaluatorVersion 递增机制

- strength 判定规则属于 evaluator/committer 判据变更：引入本设计时 `evaluatorVersion`（现由 committer 随 record 持久化,`learning-outcome-committer.ts`）**必须递增**,并在 Mastery Policy（ADR-0160）中登记变更说明。
- 旧版本 record（无 `strength` 字段）**保守解释为 `provisional`**,不回填、不迁移、不批量重写。

## 3. 非目标 / 红线

1. **不**改变 settlement sole-writer：Evidence / outcome / record 仍仅由 committer 经既有窄 IPC 路径写入（ADR-0011/0018/0023）;本设计零新写者。
2. **不**放宽 evidence-gating：`consolidated` 只能来自 digest 绑定 assessment 的确定性复验证据,模型自述、UI 状态、"文件看起来存在"均不算（ADR-0010/0016）。
3. **不**触碰 recordless 语义：`needs_practice` / `not_evidenced` 仍 marker-only,不因 strength 引入被升级（ADR-0018）。
4. planner 保持纯函数、零 I/O、零 durable 写权（ADR-0012/0151）。
5. RetentionProjection 是可重建投影,禁止长成第二权威或结算输入（评估文档 §7 风险表）。
6. 本地优先：无默认远程 telemetry;strength 源于 Evidence 而非记忆,**不**触碰同意门控 learner profile / memory;**不**引入 FTS / 向量库。
7. **本 ADR 为设计草案：不存在实现代码,不宣称任何行为已实施。**

## 4. 验证入口（实施时兑现；当前无代码）

本 ADR 合入不改变任何生产行为。实施切片须至少落地：

- strength 派生纯函数单测：同一 ledger 事件流重算得到相同强度;间隔日边界（<24h / 跨日界）判定确定性。
- committer 单测：`evaluatorVersion` 递增;旧 record 无 strength 字段回退 `provisional`;复验不产生第二份 record。
- 端到端 Golden：第 1 天 `established(provisional)` → 第 ≥2 天复验成功 → 投影呈现 `consolidated`,原始 record 字节不变。
- 幂等测试：同一 `operationId` 重放不发布第二条 settlement,复验事件重放不重复累计强度（沿 ADR-0011/0018 既有语义）。
- 冲突测试：投影与 ledger 不一致时以 ledger 重算为准,投影不得回写。
- planner 单测：`provisional` 输入下 `continue_next_session` 决策附带复习债理由。

## 5. 一句话

**"学会"从此有强度：当场全对只是 `provisional`,跨 ≥1 个间隔日的复验成功才是 `consolidated`;原始 record 永不改写,当前强度由 RetentionProjection 重算派生,planner 对 `provisional` 保守推进,判据变更以 `evaluatorVersion` 递增可追溯。**
