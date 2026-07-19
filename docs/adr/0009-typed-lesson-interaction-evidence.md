# ADR-0009：将 Lesson 互动记录为可追溯的 typed Evidence

- **状态：** 已实施（P0 教学事实基线；不代表 outcome 判定或 record 提交已经完成）
- **范围：** LessonInteraction、EvidenceReceipt、原子写入、幂等重放、preview 与 canonical Session 绑定
- **证据提交：** `17343d3`、`4d4e39b`、`c45d444`、`6521cb8`、`216e6fa`

## 决定

学习者回答、检索练习和 conversation 中可采集的互动，记录为带稳定 identity 与 provenance 的 typed `LessonInteraction` / Evidence，而不是由 renderer、自由文本或聚合进度推断为“已经掌握”。

`LessonInteractionRecorder` 是写入边界：它把 Evidence 追加到所属 canonical LearningSession，并返回权威 `EvidenceReceipt`。同一 event identity 的重放必须幂等；不同 attempt 保持为独立原始事实。preview 的互动必须绑定到 canonical Session，legacy review/progress 只有通过显式 projection 才能进入该模型。

Evidence 是原始、可追溯的学习者交互事实；它本身既不是 `LearningOutcome`，也不是正式 `LearningRecord`。

## 已实施范围与验证入口

- `17343d3` 引入 recorder、共享 interaction 类型、preview bridge 与基础集成测试。
- `4d4e39b` 将 evidence receipt 写入收紧为原子路径；`c45d444` 对齐 receipt guard。
- `6521cb8` 将 preview Evidence 绑定到 canonical Session。
- `216e6fa` 覆盖 preview Evidence lifecycle。

主要验证入口：

```powershell
pnpm run check:teaching-evidence
pnpm exec vitest run --project unit tests/unit/lesson-interaction-recorder.unit.test.tsx
pnpm exec vitest run --project integration tests/integration/lesson-interaction-recorder.integration.test.ts
```

## 不变量

- Evidence 必须包含稳定 event / Session / Lesson / item identity，以及足以追溯输入 surface 与 artifact 的 provenance。
- 相同 event 的重复提交返回同一权威 receipt，不重复写入；多个真实 attempt 不被合并为单条“掌握”结论。
- renderer、模型自述和自由文本不得绕过 recorder 宣布 outcome 或 Learning record。
- canonical Session 仍为事实来源；catalog、preview 与 review progress 均为下游 projection。

## 不包含

- 本 ADR 不定义 Evidence 的评分、`established` 判定或 Learning record 发布。
- 本 ADR 不授权存储 raw reasoning，也不把任意 HTML / preview 内容视为权威 Evidence。
- 本 ADR 不替代后续 outcome committer、planner、context、presentation 或 Golden E2E 的工作。
