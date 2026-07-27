# ADR-0158：Model-assisted GradingCandidate——解释性证据的受限结算路径

- **状态：** Proposed（设计草案,未实施 — 2026-07-26）
- **日期：** 2026-07-26
- **范围：** 为对话中的解释/应用类学习者响应（既有 `learner_response_recorded` / `conversation_evidence_recorded` 通道）设计 model-assisted **GradingCandidate**：模型按 sidecar 预置 rubric 产出的结构化评分候选,作为**辅助证据**参与结算。**不**改变 committer 确定性核心、sole-writer、assessment 信任边界或任何生产行为。
- **关联：** [ADR-0009](0009-typed-lesson-interaction-evidence.md)；[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)；[ADR-0014](0014-learner-safe-teaching-turn-presentation.md)（`show_source`）；[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)；[ADR-0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)；[ADR-0077](0077-teaching-turn-review-candidates.md)（候选须人可见的同构哲学）；[ADR-0157](0157-learning-outcome-strength-and-consolidation.md)；ADR-0154（复习排期,同批设计草案）

## 1. 问题

prompt 与 kernel 要求学习者"回忆、判断、解释、应用",但 evaluator 只结算 `quiz_answered` 的再认题型;`learner_response_recorded` / `conversation_evidence_recorded` 有完整录入与身份校验,却被 `unsupported_evidence` 全弃——**对话证据有存储、无结算路径**（评估文档 G1）。按 ICAP 框架,解释/生成/应用恰是学习效果最高的行为,当前却对掌握状态零贡献：模型被激励"多出客观题"而非"多要解释",学习者最有价值的努力不被系统看见。难点在于：解释性回答无法用静态文法确定性判分,而 LLM 评分绝不能成为 settlement 判据——否则"模型说学会了"会借道复活。

## 2. 决策

### 2.1 GradingCandidate：typed、绑定、不可信输入

模型可在教学轮内对一条已记录的学习者响应产出 **GradingCandidate**（Zod 校验的封闭结构）：

- `candidateId`、Session/Lesson binding（与 Evidence identity 同源）；
- `evidenceRef`：所评学习者原文的 **digest 引用**（不内嵌正文）；
- `rubricItemId` + `rubricDigest`：指向 **assessment sidecar 内预置的 rubric 条目**；
- `verdict`：封闭枚举 `met | partially_met | not_met | unclear`（无自由文本分值）；
- `provenance`：provider/model/turn 标识,标记 `model_assisted: true`。

**信任分层（ADR-0016 的关系）**：rubric 条目由 lesson 生成时写入 sidecar、受 digest 绑定,是**可信静态 artifact**（0016 静态文法的扩展,不是放宽）;模型对 rubric 的**判定**是不可信候选输入。绑定/digest/schema 任一不满足即整条 candidate 丢弃,fail-closed,结算行为与今日一致。

### 2.2 结算参与方式：白名单三种,仅此三种

candidate 作为辅助证据,只允许：

1. 为 `needs_practice` 细化归因（哪条 rubric 未达成）;
2. 为 `provisional`（ADR-0157）提供**有上限的加权**——加权只影响派生强度/复习排期的置信,**不能替代**任何确定性客观复验；
3. 触发复习排期（经 ADR-0154 投影提前该目标的 nextDue）。

### 2.3 学习者可见、可申诉

- candidate 经 learner-safe 投影呈现,依据（rubric 条目 + 学习者原文引用）通过既有封闭 TeachingCommand **`show_source`** 语义查看（ADR-0014,不新增 composer 命令）。
- 学习者可申诉：标记 `disputed` 后该 candidate 不再参与任何派生;原始 Evidence 与已结算 outcome 不删除、不改写。与 ADR-0077"候选须人可见、无人批不生效"哲学同构。

## 3. 非目标 / 红线

1. **GradingCandidate 单独永远不产生 `established` / `misconception_corrected`**;LLM 评分永远不是 sole 判据（评估文档 §7 第一风险）。
2. **不**改 committer 确定性核心：committer 不解析模型自由文本;candidate 缺失/无效时结算路径与现状完全一致;sole-writer 与窄 IPC 不变（ADR-0011/0018/0023）。
3. **不**放宽 evidence-gating：candidate 是辅助证据,不是 Evidence 的替代;`not_evidenced` → `insufficient_evidence` 映射不变（ADR-0010/0016/0018）。
4. planner 纯函数边界不变（ADR-0012/0151）;candidate 不直接驱动 planner 动作,只经结算/投影事实间接进入。
5. 本地优先：无默认远程 telemetry;不触碰同意门控 memory;不引入 FTS / 向量库;rubric 评分不外发。
6. **本 ADR 为设计草案：不存在实现代码,加权上限等参数须在实施 ADR/Mastery Policy（ADR-0160）中定值。**

## 4. 验证入口（实施时兑现；当前无代码）

本 ADR 合入不改变任何生产行为。实施切片须至少落地：

- candidate schema/绑定单测：digest 不匹配、rubric 缺失、未知 verdict 一律丢弃且不影响既有结算。
- 结算白名单单测：仅 (a) 归因细化、(b) 有上限加权、(c) 复习排期三种效果;构造"仅 candidate 无客观证据"用例断言**不产生** `established`。
- 加权上限测试：构造极端数量的 candidate,断言派生强度增量不越过 Mastery Policy（ADR-0160）定值的上限。
- 脱敏测试：candidate 及其投影不内嵌学习者原文正文,仅 digest 引用;rubric 条目不得被解释为 active content（ADR-0016 精神）。
- 端到端：一条对话解释被记录 → candidate 挂到 outcome 归因 → `show_source` 可见 → `disputed` 后派生剔除。

## 5. 一句话

**解释性证据获得受限结算路径：模型按 sidecar 预置 rubric 产出带 provenance、learner 可见可申诉的 GradingCandidate,只能细化归因、给 provisional 有上限加权、触发复习排期——单独永不产生 `established`,committer 确定性核心与 sole-writer 分毫不动。**
