# ADR-0017：Recordless Learning Outcome 仅以 marker 为 settlement authority

- **状态：** 已实施（recordless marker-only settlement 与定向自动化；不代表 C-4P6 durability close-out 或 P0 发布闭环完成）
- **范围：** `needs_practice` / `not_evidenced` 的 settlement authority、`outcome-settlement.json` marker-only 路径、restart/retry 的 marker 校验与 public result
- **证据提交：** `0acaaa4`、`0692732`、`7292bf4`

## 决定

`needs_practice` 与 `not_evidenced` 是 **recordless** outcome kind。它们**不得**创建正式 Learning record、`outcome.json` 或 completed Session manifest。

对这两类 kind，合法且 matching 的 `learning-sessions/<sessionId>/outcome-settlement.json`（`record: null`）是当前**唯一** durable settlement authority。Committer 在 Session writer lock 内：

1. 先 `reconcile()`；
2. 若同一 `operationId` 已存在合法 settled recordless marker，则只校验并返回受控结果，不重写 marker、不补写 record/outcome/manifest；
3. 若尚无 authority，仅 durable-replace 发布该 marker，然后返回 learner-safe result。

`not_evidenced` 的 public result 固定为 `insufficient_evidence`，不得因 restart、retry、文件“看起来存在”或 recovery 升级为 `established` / `misconception_corrected`，也不得自动伪造 outcome 或 Session completion。

无 immutable record 时，`reconcile()` **不得**从 marker 推断、合成或 promote 出 `outcome.json`、completed Session 或 Learning record。若 marker 声称 writing kind、带非空 `record`、Session 已 completed，或已存在 outcome envelope 等与 recordless contract 冲突的组合，必须进入 `review_required`，而不是补写缺失文件。

本决定细化 [ADR-0011](0011-evidence-gated-learning-outcome-settlement.md) 中“只有 `established` / `misconception_corrected` 可创建正式 Learning record”的边界；不改变 Evidence 门控、assessment trust 或 sole-writer cutover。

## 已实施范围与验证入口

- `0acaaa4` 引入 `LearningOutcomeCommitter` 与 settlement marker。
- `0692732` 将 recordless / insufficient outcomes 落到 marker-only settlement，并固定 `not_evidenced` → `insufficient_evidence`。
- `7292bf4` 加固 settlement / reconcile：无 immutable record 时仅承认合法 recordless marker；冲突组合进入 review，不合成缺失 participant。

主要代码与验证入口：

- `src/main/learning-outcome-committer.ts`：`writesLearningRecord()`、recordless `commit()` 分支、无 record 时的 `reconcileLocked()` marker-only 路径
- `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`
- `pnpm exec vitest run --project integration tests/integration/learning-outcome-commit.integration.test.ts tests/integration/teaching-app-learning-outcome-commit.integration.test.ts`

共享 durable publish 的受限 I/O 基础仍由 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) 定义。C-4P6 的 platform profile、完整 crash/power-loss matrix 与 operations close-out **未**因本 ADR 关闭。

## 不变量

- Recordless kind 的 durable effect 最多是 matching `outcome-settlement.json`（`record: null`）；不得创建 Learning record、`outcome.json` 或 completed Session。
- 合法 recordless marker 是 recordless settlement 的唯一 authority；stage、catalog、UI 状态和“文件存在”都不是 authority。
- 同一 `operationId` 的 retry/restart 只能验证既有 marker 并返回受控结果，不得发布第二条 settlement，也不得 promote 为 record-writing outcome。
- `not_evidenced` 永远映射为 `insufficient_evidence`；不可信 assessment、缺失证据或冲突不得升级为掌握。
- Marker 与现存 Session/outcome/record 状态冲突时 fail closed 进入 `review_required`，禁止 rewrite、delete、rollback 或重新 evaluate 来“修齐”。

## 不包含

- 本 ADR 不关闭 C-4P6，不证明 marker replace 的完整 directory durability、Windows power-loss 或 host-native crash matrix。
- 本 ADR 不授权跨文件 transaction、从 marker promote 到 formal record、自动 fabrication，或改变 evaluator/Evidence/IPC public schema。
- 本 ADR 不把 catalog presence、stage 文件或 Session events 解释为 recordless settlement authority。
- Record-writing kind（`established` / `misconception_corrected`）的有序发布与 record-authoritative reconcile 仍以 [ADR-0011](0011-evidence-gated-learning-outcome-settlement.md) 为准。

## 相关 ADR

- [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)
- [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)
- [ADR-0010](0010-evidence-gated-learning-record-cutover.md)
- [ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)
- [ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)
