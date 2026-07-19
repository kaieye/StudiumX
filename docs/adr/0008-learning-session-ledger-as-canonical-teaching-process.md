# ADR-0008：将 LearningSession 作为独立教学过程，并由 LearningSessionLedger 持久化

- **状态：** 已实施（P0 教学事实基线；不代表 P0 教学闭环已完成）
- **范围：** LearningSession 身份、canonical ledger、legacy projection、恢复与幂等 append receipt
- **证据提交：** `20ae4e9`、`1052aa2`、`f4f7e40`

## 决定

`LearningSession` 是一次真实学习过程的领域对象，不是 Agent run、旧 workspace `SessionEvent`，也不是单个 Lesson 目录的别名。它拥有稳定的 Session identity，并把 Lesson、conversation 与后续教学事实的引用收敛到同一 canonical Session。

Session 的 canonical 读写由 `LearningSessionLedger` 负责。调用方通过其公开接口打开、加载和追加 Session 事实；文件布局、schema 校验、event / operation 幂等、receipt、恢复、隔离及 legacy projection 均留在 ledger 内部。catalog、UI 与旧 Lesson 视图是可修复 projection，不能反向改写 canonical Session 事实。

## 已实施范围与验证入口

- `20ae4e9` 引入 `src/main/learning-session-ledger.ts`、共享 `LearningSession` 类型和 canonical Session 持久化，并接入 Lesson / workspace 生命周期。
- `1052aa2` 加固 ledger 恢复路径。
- `f4f7e40` 加入原子 append receipt，保证重复 event / operation 不制造第二份教学事实。

主要验证入口：

```powershell
pnpm run check:learning-session-ledger
pnpm exec vitest run --project unit tests/unit/learning-session-ledger.unit.test.ts tests/unit/learning-session-ledger-review.unit.test.ts tests/unit/learning-session-outcome.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-session-ledger.integration.test.ts
```

## 不变量

- 新学习步骤使用稳定 Session identity；同一 event / operation 的重放不得产生重复事实。
- canonical Session 成功与否不依赖 catalog、renderer 或其他 projection 的成功；这些 projection 可在之后修复。
- legacy Lesson 只能经显式 adapter 作为只读 Session projection，不能成为新的 canonical 写入旁路。
- Session 的持久化边界与可重建 projection 的通用原则一致；参见 ADR-0001 和 ADR-0002。

## 不包含

- 本 ADR 不完成 `LearningOutcomeCommitter`、下一教学动作、上下文组装、教学 UI 或 Golden E2E。
- 本 ADR 不授权把 Agent run、workspace lifecycle event 或任意 Lesson 文件重新定义为 LearningSession。
- 本 ADR 不引入第二套 Session store 或以 catalog 取代 canonical ledger。
