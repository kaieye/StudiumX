# ADR-0012：以确定性 NextTeachingStepPlanner 决定后续教学动作

- **状态：** 已实施（深模块及定向自动化；不代表完整 P0 发布链已证明）
- **范围：** `NextTeachingStepPlanner`、受限 next-step union、evidence-backed learner explanation
- **证据提交：** `eda17c3`、`e7445e2`

## 决定

后续教学动作由 `NextTeachingStepPlanner` 从已结算 outcome、Evidence 与教学上下文中导出受限的 typed decision，而不是让任意调用方通过自由文本 prompt 推断“下一步”。

Planner 输出稳定的动作类别及其 Evidence references、理由和学习者可理解的简短说明。它可以选择继续、对比并重试、复习、请求澄清或完成课程等教学动作；不能直接执行工具、写 Learning record、修改 Session 或把模型文本当作事实。

该边界使错误回答、纠正后的回答和幂等重放具有可测试的确定性：`needs_practice` 不会被包装为完成，纠正后的 outcome 才可推进，序列化结果在相同输入下保持稳定。

## 已实施范围与验证入口

`eda17c3` 引入 planner 及 shared next-step types，`e7445e2` 合入主线。`teaching-loop-resolver` 消费该决策以连接后续教学流程。

```powershell
pnpm exec vitest run --project unit tests/unit/next-teaching-step-planner.unit.test.ts
pnpm exec vitest run --project integration tests/integration/next-teaching-step-planner.integration.test.ts
node scripts/check-next-teaching-step-planner.mjs
```

## 不变量

- decision 必须引用支撑它的 outcome / Evidence，而非仅含自由文本。
- planner 是纯教学决策边界；不拥有 durable writer、provider 调用或 UI 状态。
- 不能从 `needs_practice`、`not_evidenced` 或缺失事实推出“已掌握”。
- 稳定输入产生稳定的 typed decision 与 JSON 表示。

## 不包含

- 本 ADR 不决定怎样评估 Evidence 或怎样提交 outcome / record，见 ADR-0011。
- 本 ADR 不构成 main-process coordinator 或任意 Agent run 状态机。
- 本 ADR 不声明默认 renderer 路径已经接入全部 planner/presentation 流程。
