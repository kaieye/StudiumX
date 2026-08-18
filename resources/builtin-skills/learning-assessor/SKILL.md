---
name: learning-assessor
description: Provides comprehensive guidance for learning assessment including assessment creation, evaluation methods, and assessment best practices. Use when the user asks about learning assessment, needs to create assessments, evaluate learning, or implement assessment strategies.
---

> **编排契约**（host registry 为准 · [ADR-0014](../../../docs/adr/0014-teaching-kernel-and-skill-authority.md)）
>
> - **角色：** `teaching_strategy`
> - **阶段：** `diagnose, elicit`
> - **消费：** `LearningObjective, LearnerLevel`
> - **产出：** `AssessmentRubric, ElicitationPlan`
> - **产物范围：** `—`
> - **前置依赖：** `—`
> - **完成门槛：** `LearningObjective` 与 `LearnerLevel` 已知；只在交付可执行的 rubric / `ElicitationPlan`（或明确「未知 / 待验证」）后完成，真实结论仍须经过 host 的 Evidence gate。
> - **非职责：** 不写 learner Evidence；不提交 outcome；不判定掌握度；rubric 与参考答案都不是 learner 表现记录。
>
> 本块是文档，不是信任权威；与 host registry 冲突时以 registry 为准。

# 学习评估技能

## 概述

本技能承担**三个互相独立的职责**，请在每次使用前明确自己在做哪一个：

1. **Assessment Authoring** — 生成题目、rubric、参考答案（产出 `AssessmentRubric`）
2. **Elicitation Strategy** — 在教学 turn 中决定如何让学习者展示理解（产出 `ElicitationPlan`）
3. **Evidence Interpretation Hint** — 向 evaluator 提供 rubric 作为解读依据，**不**直接写 Evidence 或 outcome

**关键词**: 学习评估、测验设计、评分标准、rubric、诱发提问、学习分析

## 🚫 红线（先读这一节）

- **rubric 是评估工具，不是 Evidence。** 写出一份评分量规，不产生任何学习者表现记录。
- **模型生成的参考答案不是 learner response。** 参考答案是标准，不是学习者说过的话；不得把它当成学习者的作答来解读或统计。
- **学习报告必须引用 canonical Session / Evidence。** 任何关于学习者表现的陈述，都要能追到真实的 `sessionId` + Evidence 记录（`eventId` / `sequence`）；追不到就不能写。
- **没有证据时只能说「未知 / 待验证」，不能推断「已掌握」。** 生成过题、判过参考答案、verifier 通过——都不等于学习者掌握了。宁可留空，不要编造掌握度。

## 职责一：Assessment Authoring

生成可交付的评估工具。输入 `LearningObjective` + `LearnerLevel`，输出题目与 rubric。

### 题目设计原则

1. **目标对齐**：每道题都要挂在一条明确的学习目标上；挂不上就删掉
2. **难度梯度**：覆盖不同认知层次（记忆、理解、应用、分析、评价、创造）
3. **清晰明确**：表述无歧义，不靠语言技巧制造难度
4. **公平性**：不依赖与目标无关的背景知识
5. **有效性**：真正测到目标能力，而不是测记忆力或读题速度
6. **可溯源**：每题标注来源单元 ID，答错时能指回复习位置

### Rubric 结构

- **评估维度**：要评估的具体方面（每个维度对应一条学习目标）
- **表现等级**：各水平的**可观察行为**描述，不用「较好 / 一般」这类主观词
- **评分标准**：每个等级的判定依据，两位评分者读完应得出同一结论
- **权重分配**：各维度权重及理由

参考答案与解析随题目一并给出，并**显式标注**为「标准答案（模型生成，非学习者作答）」。

## 职责二：Elicitation Strategy

在教学 turn 中决定**如何让学习者展示理解**，产出 `ElicitationPlan`。这一职责的产物是提问策略，不是分数。

- **选择诱发形式**：复述、举例、预测结果、找反例、教回给别人、改错、迁移到新情境
- **匹配当前水平**：`LearnerLevel` 低时先要「能说出关键要素」，高时要「能判断边界与例外」
- **一次一个焦点**：一轮只诱发一个概念，混问会让回答无法归因
- **留出失败空间**：题目要能暴露误解，只会得到「对」的提问没有诊断价值
- **预设误解分支**：为常见 misconception 预先准备追问，一旦命中就深入而不是直接纠正

`ElicitationPlan` 建议格式：

```markdown
**目标概念**：{LearningObjective 引用}
**诱发形式**：举例 / 预测 / 改错 / ...
**提问**：{实际要说的话}
**期望要素**：回答中应出现的关键要素（用于后续解读，不预填结论）
**若命中误解 X**：追问 {…}
```

## 职责三：Evidence Interpretation Hint

把 rubric 交给 evaluator 作为解读依据——**到此为止**。

- 本技能**只提供标准**：维度、等级描述、关键要素清单
- 本技能**不写** Evidence、**不提交** outcome、**不更新** ledger、**不判定** mastery
- 真实的学习者作答由 host 的 canonical 路径记录（`responseDigest` + `provenance`）；本技能既不生成也不改写它
- 需要在报告中引用表现时，引用 Evidence 的**标识与 provenance**（`sessionId` / `eventId` / `sequence`），不复述敏感正文
- 证据缺失时，报告对应位置写「未知 / 待验证」，并说明需要什么样的证据才能推进

## 输出格式

评估工具交付应包含：

- **评估目标**：对应的学习目标（逐条列出）
- **职责标注**：本次产出属于 Authoring / Elicitation / Interpretation Hint 中的哪一个
- **评估方式**：使用的方法与形式
- **评估标准**：rubric 全文（维度 / 等级 / 权重）
- **评估题目**：题目 + 来源单元 ID + 标准答案（标注为模型生成）
- **证据说明**：本产出**不含**任何学习者表现记录

## 最佳实践

- 多种评估方式并用，避免单一题型
- 形成性评估贴近教学过程，及时反馈
- 评级描述写成可观察行为，保证不同评分者一致
- 反馈指向下一步动作，而不是只给结论
- 鼓励自我评估与同伴评估，但它们同样不是 canonical Evidence

## 反模式

- **把 rubric 或参考答案写进学习报告，当成学习者表现**——最严重的错误。
- **凭「题目已生成」推断「已掌握」**——生成产物与学习成果无关。
- **一轮问多个概念**——回答无法归因到具体误解。
- **等级描述用主观形容词**——不同评分者得出不同结论，rubric 失效。
- **报告里出现无法追溯到 Session / Evidence 的表现陈述**——一律改写为「未知 / 待验证」。
