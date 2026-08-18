# ADR-0031：高级技术 Inspector（默认对学习者隐藏）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** `inspectTeachingTech(input)` 组装 events / effects / projection_report / run_lifecycle / capability 诊断视图；默认 `learner_hidden`，字符串经 secret redaction。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0030](0030-session-resume-picker.md)
- **证据：** `src/shared/teaching-types/tech-inspector.ts`、`src/main/tech-inspector.ts`、`scripts/check-tech-inspector.mjs`、`tests/unit/tech-inspector.unit.test.ts`；提交 `2341549`、merge `81cee1d`

## 决定

技术诊断与学习者呈现分离。`inspectTeachingTech(input)`：

- `mode: 'learner_hidden'`（默认）→ 不返回诊断细节，status=`hidden`
- `mode: 'diagnostic'` → 组装 sections（events / effects / projection_report / run_lifecycle / capability），字符串经 secret redaction

输入为调用方预规范化的摘要，禁止夹带 raw provider payload 或 learner answers。模块只读、无文件系统写入。

## 已实施范围与验证入口

- `src/shared/teaching-types/tech-inspector.ts`
- `src/main/tech-inspector.ts`
- `scripts/check-tech-inspector.mjs`

```powershell
pnpm run check:tech-inspector
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/tech-inspector.unit.test.ts
```

## 不变量

- 默认对学习者隐藏。
- 诊断视图仍须脱敏；不得自动 repair。
- 不把 tech findings 提升为 outcome / Learning record。

## 不包含

- 不授权 renderer toggle / IPC 主机接线（后续可薄封装）。
- 不替代 TeachingDoctor / WorkspaceInspector（ADR-0027）。
