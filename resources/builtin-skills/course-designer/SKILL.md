---
name: course-designer
description: Provides comprehensive guidance for course design including curriculum development, learning objectives, and course structure. Use when the user asks about course design, needs to design courses, create learning objectives, or structure educational content.
---

> **编排契约**（host registry 为准 · [ADR-0151](../../../docs/adr/0151-teaching-kernel-and-skill-orchestration.md) / [ADR-0163](../../../docs/adr/0163-teaching-capability-selection-and-plan-preview.md)）
>
> - **角色：** `workflow_router`
> - **阶段：** `ground, artifact_authoring`
> - **消费：** `CourseBrief`
> - **产出：** `CourseWorkflowPlan`
> - **产物范围：** `—`
> - **前置依赖：** `—`
> - **非职责：** 只产出阶段计划与路由说明；不替代下游 producer 实现；**不会**自动激活或执行未安装的子 skill；不写 learner Evidence。
>
> 本块是文档，不是信任权威；与 host registry 冲突时以 registry 为准。

# 课程设计技能（兼容路由）

## 概述

本技能是课程设计入口的**兼容路由层**。它接收 `CourseBrief`（主题、受众、时长、约束），判断用户当前处在哪一步，产出 `CourseWorkflowPlan`——一份「下一步该用哪个 skill、为什么、需要先补什么输入」的路由说明。

**本技能不再自己生成完整课程结构。** 大纲归 `course-outline-design`，讲义与素材归 `course-content-authoring`。本技能若重复实现它们，就会与它们争夺同一产物范围，触发 host registry 的 lead writer 冲突判定，并让用户拿到两份互相打架的课程骨架。

**关键词**: 课程设计、教学大纲、学习目标、教学计划、课程规划、教育设计

## 路由决策表

| 用户当前状态 | 判断依据 | 路由到 |
|---|---|---|
| 只有主题 / 受众，没有任何结构 | 说不出天数、模块划分或单元清单 | `course-outline-design` |
| 已有稳定 outline，需要讲义 / 素材 / 测验 | outline 文件存在且单元 ID 已稳定 | `course-content-authoring` |
| 只是询问教学设计原则 | 问的是「学习目标怎么写」「Bloom 怎么用」这类知识问题 | advisory mode（本技能直接回答，不产出产物） |

判不准时**先问一个澄清问题**（「现在手上有大纲了吗？」），不要凭猜测把用户送进错误阶段——走错阶段的代价是整份大纲返工。

### 路由 1：无结构 → `course-outline-design`

先把 `CourseBrief` 补全到可交接的程度，再交棒：

- **目标受众**：先备知识、角色、人数
- **总时长与切分**：几天、每天几小时
- **成果定义**：结课时学习者应当能做什么（行为动词，不是「了解」）
- **硬约束**：设备、场地、是否需要线上同步

交接话术：说明「结构骨架由 `course-outline-design` 产出；它稳定之前不要开始写讲义，否则每次回改都会级联多个文件」。

### 路由 2：已有 outline → `course-content-authoring`

确认 outline 已稳定（单元 ID 不再变动），再交棒。此时本技能**不要**改写 outline，也不要预写讲义片段——单元 ID 会成为下游的持久键。

若 outline 存在但明显残缺（缺学习目标、单元无编号、天数与主题表对不上），先回到路由 1 修补，再往下走。

### 路由 3：仅问原则 → advisory mode

用户只想要教学设计知识时，**直接回答，不生成任何文件、不建目录、不产出产物**。可用的顾问知识：

- **学习目标**：用 Bloom 认知层次（记忆 / 理解 / 应用 / 分析 / 评价 / 创造）选动词，确保可观测、可测量；避免「熟悉」「掌握」这类无法验证的措辞。
- **目标—评估对齐**：每条学习目标都要有对应的评估方式；无法评估的目标要么改写，要么删掉。
- **递进关系**：先建立前置概念，再引入依赖它的概念；把跨模块的依赖显式画出来。
- **形成性 vs 总结性**：过程中的小检核用于调整教学，结课评估用于判定成果，两者不要混用同一套标准。
- **活动多样性**：讲解、演示、练习、讨论、项目各有适用场景；单一形式会让不同学习风格的人掉队。

需要更细的评估工具（题目、rubric、参考答案）时，指向 `learning-assessor`；需要成体系的资源（课件、练习集、案例、学习指南）时，指向 `teaching-resource-generator`。

## `CourseWorkflowPlan` 输出格式

```markdown
## 课程工作流计划

**输入摘要（CourseBrief）**：主题 / 受众 / 时长 / 约束
**当前阶段判定**：无结构 | 已有 outline | 仅咨询
**下一步**：`course-outline-design`
**理由**：一句话说明为什么是这个阶段
**交接前需补齐**：列出缺失的 brief 字段（没有则写「无」）
**后续序列**：course-outline-design → course-content-authoring →（可选）teaching-site 管线
```

计划是**说明**，不是执行。是否走下一步由用户决定；本技能不代替用户启动任何后续 skill。

## 能力边界

### ✅ 适用场景

- 用户对课程设计的诉求笼统、说不清自己在哪一步
- 需要判断该先做大纲还是先写讲义
- 需要教学设计原则的顾问式回答

### ❌ 不适用场景

- 直接产出完整大纲 / 讲义（交给 `course-outline-design` / `course-content-authoring`）
- 出题、写 rubric、定评分标准（交给 `learning-assessor`）
- 判定学习者掌握度、写 learner Evidence 或提交 outcome（本技能永不做）

## 反模式

- **绕过 outline 直接写讲义**——单元 ID 未稳定，后续每次回改都级联多个文件。
- **本技能自行输出一份「完整课程结构」**——与下游 producer 产物范围重叠，用户拿到两份不一致的骨架。
- **顾问问题被当成生产任务**——用户只想问原则，却被生成一堆文件。
- **依据不足就路由**——brief 缺受众或时长时应当先问，而不是替用户假设。
- **在路由说明里夹带掌握度判断**——本技能看不到 Evidence，任何「学习者已掌握 X」的措辞都是编造。
