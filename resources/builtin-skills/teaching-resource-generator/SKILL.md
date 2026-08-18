---
name: teaching-resource-generator
description: Provides comprehensive guidance for generating teaching resources including courseware, exercises, case studies, and learning guides. Use when the user asks about generating teaching materials, creating courseware, designing exercises, or developing educational content.
---

> **编排契约**（host registry 为准 · [ADR-0014](../../../docs/adr/0014-teaching-kernel-and-skill-authority.md)）
>
> - **角色：** `artifact_producer`
> - **阶段：** `artifact_authoring`
> - **消费：** `LearningObjective, LearnerLevel, Misconception, CourseContent`
> - **产出：** `LessonAsset, ExerciseSet`（可具体交付为 `CaseStudy`、`StudyGuide`）
> - **产物范围：** `lesson-assets/**`, `course-package/day*/content.md`
> - **前置依赖：** `—`
> - **完成门槛：** `LearningObjective` 已知且 lead-writer 冲突已排除；薄弱点驱动时必须保留 Evidence identity / provenance 引用，资源本身不能充当学习结果。
> - **非职责：** 不写 learner Evidence；不提交 outcome；不自行判定 mastery；不与 `course-content-authoring` 同时写同一文件。
>
> 本块是文档，不是信任权威；与 host registry 冲突时以 registry 为准。

# 教学资源生成技能

## 概述

本技能是**资源 producer**：把 typed facts 转成学习者能直接使用的教学资源。它不做诊断、不做判定、不做路由——只生产资源。

**关键词**: 教学资源生成、课件、练习题、教学案例、学习指南

## 输入：typed facts

生成前先确认拿到了哪些事实；缺失的部分**明确标注为假设**，不要静默补齐。

| 输入 | 用途 | 缺失时 |
|---|---|---|
| `LearningObjective` | 决定资源要达成什么 | 必需——缺失时先问，不要凭主题猜目标 |
| `LearnerLevel` | 决定深度、术语密度、脚手架多少 | 标注假设水平并在产物开头写明 |
| `Misconception` | 决定纠错练习与反例的靶子 | 跳过纠错类资源，不要虚构误解 |
| `CourseContent` | 保证与既有讲义一致、不重复不冲突 | 只生成独立资源，不要改写未读过的内容 |

## 输出：资源类型

- **LessonAsset** — 课件骨架、讲解要点、图示需求、互动环节
- **ExerciseSet** — 练习集（选择 / 填空 / 简答 / 编程 / 改错），含答案解析与难度梯度
- **CaseStudy** — 实践场景、分步指导、示例、思考题
- **StudyGuide** — 学习路线图、知识点清单、自测清单、参考资料

每份产物开头声明：目标（引用 `LearningObjective`）、适用水平、类型、与哪份 `CourseContent` 对齐。

## 写入边界（硬规则）

产物范围是 `lesson-assets/**` 与 `course-package/day*/content.md`。后者与 `course-content-authoring` **重叠**，host 会把同一 stage 内的双 lead writer 判定为冲突。

- **默认写 `lesson-assets/**`**——独立资源放这里，永不与他人抢位
- **只有在 `course-content-authoring` 未在同一 stage 领写时**，才可写 `course-package/day*/content.md`
- **绝不同时写同一文件**——两个 producer 交替写同一份 `content.md` 会互相覆盖，且没人知道哪一版是权威
- 不确定谁在领写时，写到 `lesson-assets/**` 并在交付说明里指出可合并的位置，由用户决定

## Evidence 引用规则（薄弱点驱动的资源）

当资源是**依据学习者薄弱点**生成时：

- **必须保留所依据 Evidence 的 identity / provenance 引用**：`sessionId`、`eventId`、`sequence`
- **不复制敏感正文**：不抄学习者原话、原始作答、`responseDigest` 之外的任何正文
- 引用形式示例：`> 依据：session {sessionId} 的 evidence {eventId}（seq {sequence}）——概念「X」上的误解`
- **不自行判定 mastery**：可以写「针对误解 X 的强化练习」，不可以写「学习者尚未掌握 X」——掌握度判定不属于本技能
- 没有 Evidence 支撑时，资源按通用难点设计，并明确写「非基于个人学习记录」

## 生成流程

1. **确认输入** — 对照上表列出已有 / 缺失的 typed facts，缺 `LearningObjective` 先问
2. **确认写入位置** — 检查是否与 `course-content-authoring` 存在 lead writer 冲突
3. **设计结构** — 按目标拆分内容块，规划难度梯度与互动点
4. **产出内容** — 写实质内容；练习给完整解析，案例给可执行步骤
5. **标注溯源** — 声明目标引用、Evidence 引用（若有）、假设项

## 最佳实践

- 内容与学习目标严格对齐，删掉「有用但不在目标里」的部分
- 语言难度匹配 `LearnerLevel`，术语首次出现时给定义
- 练习按认知层次递进，不要一上来就是综合题
- 每个练习都给反馈路径：答错时指回该复习哪个知识点
- 与既有 `CourseContent` 保持术语一致，不引入同义异名

## 反模式

- **在资源里下掌握度结论**——「学习者已掌握 X」是 Evidence 才能支撑的判断，本技能永不做。
- **把生成的练习和答案当成学习者表现记录**——生成产物不是 Evidence。
- **与 `course-content-authoring` 抢写同一份 `content.md`**——互相覆盖，权威版本丢失。
- **复制学习者原始作答到资源正文里**——只留 identity / provenance 引用。
- **凭主题猜学习目标**——目标缺失就问，猜错会让整份资源偏离。
- **虚构误解来凑纠错练习**——没有 `Misconception` 就不生成纠错类资源。
