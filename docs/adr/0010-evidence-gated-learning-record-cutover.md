# ADR-0010：Learning record 必须证据门控，并切断 Lesson 生成自动写入

- **状态：** 已实施（语义 cutover；完整 outcome / record settlement 的 authority 见 ADR-0011）
- **范围：** Lesson 生成、`learningRecordNote` 降级、renderer 自动写入移除
- **证据提交：** `1710743`

## 决定

生成、打开或阅读 Lesson 不是学习结果，模型自述也不是学习证据。因此 Lesson 生成路径不得自动创建或更新正式 Learning record。

为兼容既有 Lesson schema，`learningRecordNote` 保留为待验证的 expected evidence / rubric 文本：它可以描述学习者尚需展示什么，但不得宣称已掌握，且不会触发 Learning record 写入。正式 Learning record 只能在证据充分、领域 outcome 已由专用提交路径确认后产生；UI 乐观状态、renderer、Lesson preview 和预期答案均不能成为该副作用的替代入口。

## 已实施范围与验证入口

`1710743` 修改 Lesson prompt、renderer、artifact/generation 接线与 schema 使用方式，移除由 Lesson plan 自动写正式 Learning record 的路径，并增加针对 cutover 的检查与单元测试。

主要验证入口：

```powershell
pnpm run check:lesson-record-cutover
pnpm exec vitest run --project unit tests/unit/lesson-outcome-cutover.unit.test.ts
pnpm exec vitest run --project integration tests/integration/teaching-lesson-artifacts.integration.test.ts
```

## 不变量

- 仅生成、打开或展示 Lesson 不得产生“已掌握”或正式 Learning record。
- expected answer、assessment rubric 与 `learningRecordNote` 都是待验证输入，不是 outcome 或 record。
- 必须由 Evidence 驱动的 outcome / record 提交才能产生正式记录；typed Evidence 的事实边界见 ADR-0009。
- 任何 catalog 或 UI projection 失败都不得使自动记录路径复活。

## 不包含

- 本 ADR 不定义 `LearningOutcomeCommitter` 的 outcome 分类、有序发布、reconcile 或 IPC authority；这些已实施范围见 ADR-0011。
- 本 ADR 不把 outcome settlement 的定向自动化单独等同于完整发布证明；崩溃恢复矩阵与 Golden E2E 关闭记录见 ADR-0017。
- 共享 durable publish 的受限 LearningOutcome 存储基础仍按 ADR-0004 的范围解释；不得将其与本语义 cutover 混为一谈。
- 本 ADR 不授权将 `learningRecordNote` 重新解释为模型生成的掌握结论，或恢复任何绕过证据门控的写入路径。
