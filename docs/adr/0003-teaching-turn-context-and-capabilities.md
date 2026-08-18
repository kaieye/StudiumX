# ADR-0003：教学 Turn 的规划、上下文与能力边界

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** teaching-turn

## 背景

下一步教学行动需要综合 Session 状态、Evidence、可用能力与受限上下文。若 planner、context assembler 或 capability discovery 同时承担写入，就会形成绕过 ledger 与 settlement 的隐式权威。

## 决定

- `NextTeachingStepPlanner` 对 canonical 教学事实执行确定性、只读规划；相同输入应产生可解释的相同计划，且计划本身不是 outcome。
- `TeachingContextAssembler` 只组装带 provenance 的有界上下文；缺失或超限内容显式降级，不通过无界拼接改变教学权威。
- `TeachingCapabilityCatalog` 只报告 readiness 与限制；能力元数据不授权执行，也不证明某项教学效果已发生。
- planner、assembler 与 catalog 都不得写 LearningSession、Evidence、Outcome、memory 或 learner profile。
- presentation 可以隐藏内部细节，但不得改变计划、Evidence 或能力不可用的事实。

## 边界与后果

- 教学计划是可重算派生物，不是 canonical 学习记录。
- capability discovery 仍受工具 effect、approval、trust 与路径围栏约束。
- provider 上下文限制可以改变装配结果，不能静默伪造完整上下文。
- 改变 planner 权威或允许这些组件写教学事实需要新的 ADR。

## 实施锚点

- [NextTeachingStepPlanner](../../src/main/next-teaching-step-planner.ts)
- [TeachingContextAssembler](../../src/main/teaching-context-assembler.ts)
- [TeachingCapabilityCatalog](../../src/main/teaching-capability-catalog.ts)
