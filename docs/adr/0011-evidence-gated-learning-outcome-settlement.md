# ADR-0011：通过受控 Outcome Committer 结算学习结果

- **状态：** 已实施（模块、窄 IPC 与定向自动化已落地；不代表 P0 发布闭环已证明完成）
- **范围：** `LearningOutcomeCommitter`、证据门控、canonical outcome / Learning record 的有序发布、reconcile、窄 IPC sole-writer cutover
- **证据提交：** `0acaaa4`、`061df11`、`0692732`、`7292bf4`、`e02a086`、`734314e`、`c9c9005`

## 决定

学习结果必须由 `LearningOutcomeCommitter` 在 Evidence 的基础上结算；renderer、Lesson 生成器、catalog、planner 和 UI 都不得直接写正式 Learning record。

Committer 将判定与 durable effect 分开：`evaluate` 形成受限的 outcome 决定，`commit` 在稳定 operation identity 下执行有序 canonical 发布，`reconcile` 处理 canonical 文件已发布而 catalog/projection 尚未同步的状态。canonical outcome / record 是权威事实，catalog 是可修复 projection；无法确认副作用是否完成时保守进入 `review_required` / reconcile，而不是盲目重试写入。

只有 `established` 与 `misconception_corrected` 可以创建正式 Learning record。`needs_practice`、`not_evidenced` 以及不可信或冲突的输入只能产生受限 outcome/诊断，不能被投影成“已掌握”。正式写入由 main-process 窄 IPC 路径接管，应用侧没有第二个 record writer。

## 已实施范围与验证入口

- `0acaaa4` 引入 outcome committer；后续提交补充 operation 幂等、冲突和恢复语义。
- `7292bf4`、`e02a086` 将 ordered durable publish、reconcile 和失败关闭路径加固到当前实现。
- `734314e`、`c9c9005` 将提交接入受限教学 IPC，并拒绝不安全 identity；`check-teaching-app-commit-cutover.mjs` 验证 App sole-writer cutover。
- 共享 durable publish 的受限基础仍由 ADR-0004 定义；本 ADR 只定义该基础在 outcome 结算中的 authority 与语义。

主要验证入口：

```powershell
pnpm run check:learning-outcome-evaluator
pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-outcome-commit.integration.test.ts tests/integration/teaching-app-learning-outcome-commit.integration.test.ts
node scripts/check-learning-record-evidence-gate.mjs
node scripts/check-teaching-app-commit-cutover.mjs
```

三个旧的 committer/recovery/read-repair 静态 checker 仍匹配重构前源码形态，当前不是可通过的发布 gate；它们需要以等价或更强的验证回写，不能据此把本 ADR 解释为 P0 release complete。

## 不变量

- 每个 outcome / record 都可追溯到 Session、Lesson、Evidence、规则或 evaluator version 与 operation identity。
- 相同 operation 的重放不创建第二份 record；不同真实 attempt 保持为独立 Evidence。
- canonical record 发布成功是“已提交”的必要条件；catalog 不一致只能显示待确认/可修复状态，不能回写或覆盖 canonical 文件。
- 任何不可信 assessment、缺失证据、冲突或未知写入状态都不会自动升级为 `established`。

## 不包含

- 本 ADR 不把定向模块/IPC 测试等同于完整 Electron crash/restart Golden E2E 或 P0 发布批准。
- 本 ADR 不定义下一教学动作、prompt context、学习者呈现或 P1 coordinator。
- 本 ADR 不授权从 Lesson 的 expected answer、`learningRecordNote`、模型自述或 UI 乐观状态创建 record；该 cutover 见 ADR-0010。
