# C-4P6 Learning outcome durable settlement：S1 已实施，S2/S3/S4/S5/S6/S7/S8/S9/S10/S11/S12/S13/S14/S15/S16/S17/S18/S19/S20/S21/S22/S23/S24/S25/S26/S27/S28/S29/S30/S31/S32/S33/S34/S35/S36/S37/S38/S39/S40/S41 tests-only evidence 已补，完整闭环仍待设计门

> **状态：C-4P6-S1 已实施，C-4P6-S2/S3/S4/S5/S6/S7/S8/S9/S10/S11/S12/S13/S14/S15/S16/S17/S18/S19/S20/S21/S22/S23/S24/S25/S26/S27/S28/S29/S30/S31/S32/S33/S34/S35/S36/S37/S38/S39/S40/S41/S42/S43/S44/S45/S46/S47/S48/S49/S50/S51/S52/S53/S54/S55/S56/S57/S58/S59/S60 已完成 tests-only evidence；C-4P6 尚未完整关闭，仍是待办。**提交 `7292bf4`（`fix(data): harden learning outcome settlement`）和 `e02a086`（`test(data): cover outcome settlement durability`）实现的仅是“严格有序发布与受控恢复基础”；`9847842`（`test(data): cover outcome publish crash recovery`）仅补齐单一 `after_outcome_publish` crash window 的测试证据；`1334513`（`test(data): cover outcome marker recovery`）仅补齐 settlement-marker durable rename 返回 `EIO` 后的受限 restart/reconcile 测试证据；`e821c69`（`test(data): cover settled outcome recovery`）仅补齐已有 `after_settlement_marker` 的一个独立中断的 settled recovery 测试证据；`ebd084c`（`test(data): cover pre-catalog outcome recovery`）仅补齐已有 `before_catalog_reconcile` 的一个独立中断的 settled recovery 测试证据；`145b671`（`test(data): cover post-stage-flush outcome recovery`）仅补齐 `after_stage_flush` interruption 后 fail-closed 不 promote incomplete projection 的测试证据；`d26bb83`（`test(data): cover after-record-publish recovery`）仅补齐 `after_record_publish` interruption 后 authority-first repaired recovery 的测试证据；`e743a3e`（`test(data): cover invalid settlement marker residual`）仅补齐 malformed settlement marker fail-closed 的测试证据；`a631a31`（`test(data): cover conflicting outcome projection residual`）仅补齐 settled 后 `outcome.json` 与 immutable record authority 分叉的 fail-closed residual 测试证据。`6bfffc5`（`test(data): cover conflicting manifest outcomeRef residual`）仅补齐 settled 后 completed `session.json` `outcomeRef` 与 immutable record authority 分叉的 fail-closed residual 测试证据。`4603601`（`test(data): cover invalid outcome symlink residual`）仅补齐 settled 后 `outcome.json` 为 non-file symlink 的 fail-closed residual 测试证据。`60b6791`（`test(data): cover invalid settlement marker symlink residual`）仅补齐 settled 后 `outcome-settlement.json` 为 non-file symlink 的 fail-closed residual 测试证据。`e1f0563`（`test(data): cover invalid session manifest symlink residual`）仅补齐 settled 后 `session.json` 为 non-file symlink 的 fail-closed residual 测试证据。`f90a863`（`test(data): cover invalid outcome directory residual`）仅补齐 settled 后 `outcome.json` 为 directory 的 fail-closed residual 测试证据。`5fb4f04`（`test(data): cover invalid settlement marker directory residual`）仅补齐 settled 后 `outcome-settlement.json` 为 directory 的 fail-closed residual 测试证据。`85840ae`（`test(data): cover invalid session manifest directory residual`）仅补齐 settled 后 `session.json` 为 directory 的 fail-closed residual 测试证据。`14fa960`（`test(data): cover invalid learning record directory residual`）仅补齐 settled 后 canonical learning record 为 directory 的 fail-closed residual 测试证据。`94e686f`（`test(data): cover invalid learning record symlink residual`）仅补齐 settled 后 canonical learning record 为 non-file symlink 的 fail-closed residual 测试证据。`f9e263f`（`test(data): cover invalid learning record content residual`）仅补齐 settled 后 canonical learning record 为 regular file 但 content 无效/无法通过 parse-validation 的 fail-closed residual 测试证据。`412acc5`（`test(data): cover invalid normalized settlement marker residual`）仅补齐 settled 后 well-formed 但 normalizeMarker 失败的 settlement marker fail-closed residual 测试证据。`9e47eed`（`test(data): cover invalid learning record metadata residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record metadata（`schemaVersion` 1→2）fail-closed residual 测试证据。`a947d4c`（`test(data): cover invalid learning record metadata identity residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record metadata identity（`recordId` 非 canonical）fail-closed residual 测试证据。`a6d693f`（`test(data): cover invalid learning record assessment residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment metadata（`assessment.contentSha256` 非 64-hex）fail-closed residual 测试证据。`2fdf59f`（`test(data): cover invalid learning record assessment path residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment path（`assessment.relativePath` 为空串）fail-closed residual 测试证据。`e7440cc`（`test(data): cover invalid learning record body prefix residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record body prefix（markdown heading 与 outcomeKind 不一致）fail-closed residual 测试证据；`80788b1`（`test(data): cover empty learning record evidence residual`）仅补齐 settled 后 well-formed 但 empty 的 canonical learning-record `evidenceEventIds` fail-closed residual 测试证据；`fdc2d22`（`test(data): cover invalid learning record evaluatorVersion residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record `evaluatorVersion`（null）fail-closed residual 测试证据；`eb2fbf6`（`test(data): cover mismatched learning record sessionId residual`）仅补齐 settled 后 well-formed 但 mismatched 的 canonical learning-record `sessionId` fail-closed residual 测试证据。`74120a7`（`test(data): cover non-canonical learning record operationId residual`）仅补齐 well-formed non-canonical canonical learning-record operationId residual 的 tests-only evidence；`3d74522`（`test(data): cover zero learning record evaluatorVersion residual`）仅补齐 well-formed zero canonical learning-record evaluatorVersion residual 的 tests-only evidence；`cc50e40`（`test(data): cover string learning record evaluatorVersion residual`）仅补齐 well-formed string canonical learning-record evaluatorVersion residual 的 tests-only evidence；`b7087f2`（`test(data): cover non-integer learning record evaluatorVersion residual`）仅补齐 well-formed non-integer canonical learning-record evaluatorVersion residual 的 tests-only evidence；`a85718a`（`test(data): cover non-writing learning record outcomeKind residual`）仅补齐 well-formed non-writing canonical learning-record outcomeKind residual 的 tests-only evidence；`6f550b2`（`test(data): cover needs_practice learning record outcomeKind residual`）仅补齐 well-formed needs_practice canonical learning-record outcomeKind residual 的 tests-only evidence；`65527ef`（`test(data): cover unknown learning record outcomeKind residual`）仅补齐 unknown canonical learning-record outcomeKind residual 的 tests-only evidence；`8467c76`（`test(data): cover negative learning record evaluatorVersion residual`）仅补齐 well-formed negative canonical learning-record evaluatorVersion residual 的 tests-only evidence；`dd4ce9a`（`test(data): cover empty learning record outcomeId residual`）仅补齐 well-formed empty canonical learning-record outcomeId residual 的 tests-only evidence；`11299c2`（`test(data): cover non-hex learning record assessment sha residual`）仅补齐 well-formed 64-char non-hex assessment contentSha256 residual 的 tests-only evidence；`20da409`（`test(data): cover null learning record assessment residual`）仅补齐 well-formed null assessment residual 的 tests-only evidence；`e71a7c2`（`test(data): cover uppercase learning record assessment sha residual`）仅补齐 well-formed 64-char uppercase-hex assessment contentSha256 residual 的 tests-only evidence；`0cf87ef`（`test(data): cover non-array learning record evidence residual`）仅补齐 well-formed non-array evidenceEventIds residual 的 tests-only evidence；本文记录该事实、剩余设计门和禁止越界的边界；它不把 S1 宣称为跨文件事务或共同原子性 或完整 durable closure。

> 后续工作的统一入口见 [本地数据待办](../local-data-todo.md)；已实施决定与提交证据见 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。

## 1. S1 已实施范围与证据

S1 覆盖 evaluator-derived Learning outcome 的主进程写入链：stage、immutable Learning record、session `outcome.json`、Learning Session manifest、operation settlement marker，以及最终 catalog read。catalog 仍不是 canonical settlement authority；多个文件不构成 transaction，也不具备共同 atomicity。

| 已实施项目 | S1 的受限事实 |
| --- | --- |
| 并发 / owner 基础 | 内置 `FileLearningSessionLedger` 私有复用既有 filesystem writer lock，锁覆盖完整 commit / reconcile 生命周期；公开 `LearningSessionLedger` API 未扩展。注入的 load-only ledger 会在 canonical write 前 fail closed：commit 返回可重试 `temporarily_unavailable`，reconcile 返回 `review_required`。 |
| 有 record 的顺序 | stage → immutable record（不 replace link）→ `outcome.json` → manifest → settlement marker → catalog。任何前项未被确认，不能继续后项 canonical write。 |
| 无 record 的顺序 | 仍为 marker-only；不虚构 stage、record、outcome 或 manifest 写入，marker 后才可 catalog read 并返回既有成功语义。 |
| 可变文件 durability | `outcome.json` 与 marker 使用共享 `replaceDurably`。仅 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 可作为 directory-fsync capability downgrade；warning 为通用且非敏感信息。其它 I/O、open、sync、close 错误为 fatal。 |
| immutable record durability | link 后 parent-directory 失败、匹配 `EEXIST` 路径和 stage cleanup 错误为 fatal；link 成功后不得用 matching-bytes 抑制错误。canonical record 的 parent / leaf containment 与 symlink 安全检查 fail closed。 |
| 受控恢复 | reconcile 为 authority-first：仅有效 immutable record 可按 `outcome.json` → manifest → marker 修复缺失 projection，不能覆盖冲突。状态不安全或不一致时返回 `review_required`；authority-first reconcile 不清理 stage。 |

`e02a086` 的相关测试覆盖 41 项单元检查和 14 项集成检查。该数字是 S1 的有限验证证据，**不是**“所有设计矩阵、所有 crash/failure 风险或整个 C-4P6 均已覆盖”的断言。

### S2 tests-only evidence：单一 `after_outcome_publish` crash window

`9847842` 仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，没有 production/API/schema/path/order 变化，且 Sol final review approved。该证据只覆盖 `after_outcome_publish` 这一单一 crash window：

- 初次 commit 返回 `retryable_failure/reconciliation_required`；record 与 matching outcome 存在，manifest 仍为 `active` / `outcomeRef: null`，marker 缺失，且未继续 manifest、marker 或 catalog-success。
- 重启后的 reconcile 使用 immutable record authority，返回 `repaired`，不重新运行 evaluator、不重写 outcome，并按 manifest → marker 发布。
- 第二次 reconcile 返回 `settled`，record/outcome/manifest/marker 四份 bytes 稳定；同一 operation 返回 `already_committed`，四份 bytes 仍稳定。

实际验证入口与结果：`pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed）；`pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 均通过。

### S3 tests-only evidence：settlement-marker final rename `EIO`

`1334513` 只扩展 `tests/unit/learning-outcome-committer.unit.test.ts` 中同一个既有 unit `it`，不是新增 test count；没有 production/API/schema/path/order 变化。它严格限于现有 settlement-marker durable rename 返回 `EIO` 的 failure/restart/reconcile 场景：

- 初次 commit 返回 `retryable_failure/reconciliation_required`；immutable record、`outcome.json` 与已 `completed` 的 manifest 存在，marker 为 `ENOENT`。
- 重启后的 reconcile 以 immutable record authority 仅发布 marker；evaluator / `createId` 不重跑，record/outcome/manifest 不重写。
- 第二次 reconcile 返回 `settled`，同 operation replay 返回 `already_committed`；record/outcome/manifest/marker 四份 canonical bytes 稳定。

该 S3 验证仍为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed，不是新增 test count）；`pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 通过。S3 不是泛化 `after_manifest_publish`、完整 manifest failure matrix、生产功能或完整 C-4P6 closure。

### S4 tests-only evidence：已有 `after_settlement_marker` interruption 的 settled recovery

`e821c69`（`test(data): cover settled outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化，也不表示 S4 改了生产逻辑。它严格限于已有 `after_settlement_marker` 的一个独立中断：marker 的 canonical rename 在当前平台 capability policy 规定的 durable primitive 完成后可见，且 `before_catalog_reconcile` 未到达。

- restart `reconcile()` 返回 `settled`，而不是 `repaired`。
- recovery 不调用 evaluator / `createId`，不做 durable write / rename / publish；immutable record、`outcome.json`、`completed` manifest 与 marker 四份 canonical bytes 稳定。
- 同 operation replay 返回 `already_committed`；recovery 仍无 durable operation，四份 canonical bytes 继续稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 29 tests passed）。S4 不是完整 C-4P6、完整 catalog/manifest/crash matrix、transaction、rollback、delete、migration、API、operations validation 或 Windows native fsync/power-loss closure。


### S5 tests-only evidence：已有 `before_catalog_reconcile` interruption 的 settled recovery

`ebd084c`（`test(data): cover pre-catalog outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化，也不表示 S5 改了生产逻辑。它严格限于已有 `before_catalog_reconcile` 的一个独立中断：marker 已发布，且 `inject` 在 catalog read 前抛出；`injectedPoints` 完整有序前缀为 `after_stage_flush` → `after_record_publish` → `after_outcome_publish` → `after_settlement_marker` → `before_catalog_reconcile`。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；immutable record、`outcome.json`、已 `completed` 的 manifest 与 marker 四份 durable 产物已存在。
- restart `reconcile()` 直接返回 `settled`，不是 `repaired`。
- recovery 不调用 evaluator 或 `createId`，不执行 durable write / rename / publish；四份 canonical bytes 稳定。
- 第二次 reconcile 仍为 `settled`；同 operation replay 返回 `already_committed`，recovery 仍不产生 durable operation，四份 canonical bytes 继续稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 30 tests passed）。S5 不是完整 C-4P6、完整 catalog/manifest/crash matrix、transaction、rollback、delete、migration、API、operations validation 或 Windows native fsync/power-loss closure。


### S6 tests-only evidence：`after_stage_flush` interruption 的 fail-closed recovery

`145b671`（`test(data): cover post-stage-flush outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于已有 `after_stage_flush` 的一个独立中断：stage 已 durable flush，immutable record / outcome / manifest / marker 尚未发布。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；`injectedPoints` 仅为 `['after_stage_flush']`。
- stage 文件保留；canonical record、`outcome.json`、marker 为 `ENOENT`；manifest 保持 crash 前 active 字节。
- restart `reconcile()` 返回 `pending`（无 record authority），不 durable write。
- 同 operation re-commit 再次 evaluate 后因既有 exclusive-create stage 失败而 fail closed，返回 `retryable_failure/reconciliation_required`，不 promote incomplete projections。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 31 tests passed）。S6 不是完整 C-4P6，也不是 stage cleanup/repair 生产功能。

### S7 tests-only evidence：`after_record_publish` interruption 的 authority-first repaired recovery

`d26bb83`（`test(data): cover after-record-publish recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于已有 `after_record_publish` 的一个独立中断：immutable record 已 durable publish，outcome / manifest / marker 尚未发布。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；`injectedPoints` 为 `['after_stage_flush', 'after_record_publish']`；evaluation 仅一次。
- record bytes 已存在；outcome / marker 为 `ENOENT`；manifest 保持 crash 前 active 形态；ledger 仍 `active` / `outcomeRef: null`。
- restart `reconcile()` 返回 `repaired`（authority-first，不重跑 evaluator / `createId`），不重写 record；随后完成 manifest → marker 发布。
- 第二次 reconcile 为 `settled`；同 operation commit 为 `already_committed`；record / outcome / manifest / marker 四份 canonical bytes 稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 32 tests passed）。S7 不是完整 C-4P6、完整 crash matrix、transaction、rollback、delete、migration、API、operations validation 或 Windows native fsync/power-loss closure。

### S8 tests-only evidence：malformed settlement marker 的 fail-closed residual

`e743a3e`（`test(data): cover invalid settlement marker residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后 poison 为 malformed `outcome-settlement.json` 的 authority residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`；marker 读为 invalid 时 `marker: null`。
- 不 rewrite poisoned marker、record、outcome 或 manifest；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`，不 false success。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 33 tests passed）。S8 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S9 tests-only evidence：conflicting outcome.json vs record authority 的 fail-closed residual

`a631a31`（`test(data): cover conflicting outcome projection residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后仅 poison `outcome.json` 为与 immutable record 不匹配的 valid-looking projection residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `conflicting_outcome`。
- 不 rewrite poisoned outcome、record、manifest 或 marker；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`，不 false success。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 34 tests passed）。S9 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S10 tests-only evidence：conflicting completed session outcomeRef vs record authority 的 fail-closed residual

`6bfffc5`（`test(data): cover conflicting manifest outcomeRef residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后仅 poison completed `session.json` 的 `outcomeRef` 身份字段（record / `outcome.json` / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `conflicting_outcome`。
- 不 rewrite poisoned manifest、record、outcome 或 marker；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`，不 false success。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 35 tests passed）。S10 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S11 tests-only evidence：invalid non-file outcome.json symlink 的 fail-closed residual

`4603601`（`test(data): cover invalid outcome symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `outcome.json` 替换为 non-file symlink（record / completed manifest / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`。
- 不 rewrite record、manifest 或 marker；不把 symlink 修复为 regular file；recovery 不调用 evaluator / `createId`；无 durable write。
- 同 operation `commit` 返回 `conflict/review_required`，不 false success。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 36 tests passed）。S11 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。







### S12 tests-only evidence：invalid non-file settlement-marker symlink 的 fail-closed residual

`60b6791`（`test(data): cover invalid settlement marker symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `outcome-settlement.json` 替换为 non-file symlink（record / outcome.json / completed manifest 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`
- 不 rewrite record / outcome / manifest，不把 symlink 修复为 regular file
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 37 tests passed）。S12 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。


### S13 tests-only evidence：invalid non-file session.json manifest symlink 的 fail-closed residual

`e1f0563`（`test(data): cover invalid session manifest symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `session.json` 替换为 non-file symlink（record / outcome.json / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`
- 不 rewrite record / outcome / marker，不把 symlink 修复为 regular file
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 38 tests passed）。S13 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。


### S14 tests-only evidence：invalid outcome.json directory 的 fail-closed residual

`f90a863`（`test(data): cover invalid outcome directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `outcome.json` 替换为 directory（非 symlink；record / completed manifest / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`
- 不 rewrite record/manifest/marker，不把 directory 修复为 regular file
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 39 tests passed）。S14 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S15 tests-only evidence：invalid settlement-marker directory 的 fail-closed residual

`5fb4f04`（`test(data): cover invalid settlement marker directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `outcome-settlement.json` 替换为 directory（非 symlink，可含 junk 内容；record / outcome.json / completed manifest 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`
- 不 rewrite record/outcome/manifest，不把 directory 修复为 regular file
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 40 tests passed）。S15 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S16 tests-only evidence：invalid session.json directory 的 fail-closed residual

`85840ae`（`test(data): cover invalid session manifest directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `session.json` 替换为 directory（非 symlink，可含 junk 内容；record / outcome.json / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`
- 不 rewrite record/outcome/marker，不把 directory 修复为 regular file
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 41 tests passed）。S16 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S17 tests-only evidence：invalid canonical learning-record directory 的 fail-closed residual

`14fa960`（`test(data): cover invalid learning record directory residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 替换为 directory（非 symlink，可含 junk 内容；outcome.json / session.json / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 directory 修复为 regular file
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 42 tests passed）。S17 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S18 tests-only evidence：invalid canonical learning-record non-file symlink 的 fail-closed residual

`94e686f`（`test(data): cover invalid learning record symlink residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 替换为 non-file symlink（outcome.json / session.json / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 symlink 修复为 regular file
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 43 tests passed）。S18 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S19 tests-only evidence：invalid canonical learning-record content 的 fail-closed residual

`f9e263f`（`test(data): cover invalid learning record content residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file 但覆写为 invalid content（缺少 metadata / 无法通过 parse-validation；outcome.json / session.json / settlement marker 保持匹配）的 residual：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 invalid content 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 poisoned 内容

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 44 tests passed）。S19 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S20 tests-only evidence：well-formed but invalid settlement marker（normalizeMarker fail）的 fail-closed residual

`412acc5`（`test(data): cover invalid normalized settlement marker residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 `outcome-settlement.json` 覆写为 well-formed JSON 但 `schemaVersion` 非权威版本（`{"schemaVersion":2}`），使 `normalizeMarker` 失败；canonical record / outcome.json / session.json 保持匹配：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `invalid_settlement_marker`
- 不 rewrite record/outcome/manifest/marker
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 45 tests passed）。S20 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S21 tests-only evidence：well-formed but invalid canonical learning-record metadata 的 fail-closed residual

`9e47eed`（`test(data): cover invalid learning record metadata residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file，但将其 metadata 中 `schemaVersion` 从权威 `1` 改为 `2`（well-formed metadata 但 `readCanonicalRecord` schema 校验失败）；outcome.json / session.json / settlement marker 保持匹配：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 invalid metadata 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 poisoned metadata

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 46 tests passed）。S21 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S22 tests-only evidence：well-formed but invalid canonical learning-record metadata identity 的 fail-closed residual

`a947d4c`（`test(data): cover invalid learning record metadata identity residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于 durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file，且 `schemaVersion` 仍为权威 `1`，但将其 metadata 中 `recordId` 改为非 canonical 值，使 `readCanonicalRecord` identity 校验失败；outcome.json / session.json / settlement marker 保持匹配：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 invalid metadata identity 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 poisoned metadata identity

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 47 tests passed）。S22 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。


### S23 tests-only evidence：well-formed but invalid canonical learning-record assessment metadata 的 fail-closed residual

`a6d693f`（`test(data): cover invalid learning record assessment residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于：settlement durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file，且 `schemaVersion` 仍为权威 `1`、`recordId` 仍为 canonical，但将其 metadata 中 `assessment.contentSha256` 改为非 64-hex 短串，使 `isVerifiedAssessment` / `readCanonicalRecord` 校验失败；outcome.json / session.json / settlement marker 保持匹配：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 invalid assessment 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 poisoned assessment metadata

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 48 tests passed）。S23 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。


### S24 tests-only evidence：well-formed but invalid canonical learning-record assessment path 的 fail-closed residual

`2fdf59f`（`test(data): cover invalid learning record assessment path residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于：settlement durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file，且 `schemaVersion` 仍为权威 `1`、`recordId` 仍为 canonical、`assessment.contentSha256` 仍为 64-hex，但将 `assessment.relativePath` 改为空串，使 `isVerifiedAssessment` / `readCanonicalRecord` 校验失败；outcome.json / session.json / settlement marker 保持匹配：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 invalid assessment path 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 poisoned assessment path

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 49 tests passed）。S24 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。


### S25 tests-only evidence：well-formed but invalid canonical learning-record body prefix 的 fail-closed residual

`e7440cc`（`test(data): cover invalid learning record body prefix residual`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于：settlement durable 已 settled 后将 canonical `learning-records/outcome-<sessionId>.md` 保持为 regular file，metadata JSON 字段仍 well-formed/canonical（含 `schemaVersion:1`、canonical `recordId`、`outcomeKind:established`），但将 markdown body 必选前缀 `# Learning outcome: established\n` 改为不匹配 heading，使 `readCanonicalRecord` 的 body-prefix 校验失败；outcome.json / session.json / settlement marker 保持匹配：

- restart `reconcile()` 返回 `review_required`，diagnostics 含 `missing_record`
- 不 rewrite outcome/manifest/marker，不把 invalid body prefix 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit 返回 `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 poisoned body prefix

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 50 tests passed）。S25 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S26 tests-only residual：empty evidenceEventIds

`80788b1`（`test(data): cover empty learning record evidence residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `evidenceEventIds` residual：metadata 其它字段与 body prefix 仍合法/canonical，仅将 `evidenceEventIds` 置为 `[]`，使 `readCanonicalRecord` 拒绝；outcome.json / session.json / settlement marker 保持匹配：
- restart `reconcile()` → `review_required` + `missing_record`
- 不 rewrite outcome/manifest/marker，不把 empty evidence 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit → `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 empty evidenceEventIds

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 51 tests passed）。S26 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S27 tests-only residual：invalid evaluatorVersion

`fdc2d22`（`test(data): cover invalid learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 invalid 的 canonical learning-record `evaluatorVersion` residual：其它 metadata 字段与 body prefix 仍合法/canonical，仅将 `evaluatorVersion` 置为 `null`，使 `number()` / `readCanonicalRecord` 拒绝；outcome.json / session.json / settlement marker 保持匹配：
- restart `reconcile()` → `review_required` + `missing_record`
- 不 rewrite outcome/manifest/marker，不把 null evaluatorVersion 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit → `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 null evaluatorVersion

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 52 tests passed）。S27 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。

### S28 tests-only residual：mismatched sessionId

`eb2fbf6`（`test(data): cover mismatched learning record sessionId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 mismatched 的 canonical learning-record `sessionId` residual：path/recordId/body 仍对应当前 session，仅 metadata `sessionId` 与 path session 不一致，使 `readCanonicalRecord` 拒绝；outcome.json / session.json / settlement marker 保持匹配：
- restart `reconcile()` → `review_required` + `missing_record`
- 不 rewrite outcome/manifest/marker，不把 mismatched sessionId 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation commit → `conflict/review_required`
- poisoned record 仍为 regular file，bytes 保持 mismatched sessionId

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 53 tests passed）。S28 不是完整 C-4P6、完整 authority/conflict matrix、transaction、rollback、delete、migration、API 或 operations validation。




### S29 tests-only residual：non-canonical operationId

`74120a7`（`test(data): cover non-canonical learning record operationId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-canonical 的 canonical learning-record `operationId` residual：其它 metadata/body 仍合法，仅 stored `operationId` 为 upper/mixed case，使 `requireOperationId` 规范化后与 stored 不一致，使 `readCanonicalRecord` 拒绝；outcome.json / session.json / settlement marker 保持匹配：
- restart `reconcile()` → `review_required` + `missing_record`
- 不 rewrite outcome/manifest/marker，不把 non-canonical operationId 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation 再次 `commit` → `conflict/review_required`
- 无生产语义改动；1 file / 54 tests passed

该 slice 不是完整 C-4P6 closure。

### S30 tests-only residual：zero evaluatorVersion

`3d74522`（`test(data): cover zero learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 zero 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: 0`，使 `number()`/`readCanonicalRecord` 拒绝；outcome.json / session.json / settlement marker 保持匹配：
- restart `reconcile()` → `review_required` + `missing_record`
- 不 rewrite outcome/manifest/marker，不把 zero evaluatorVersion 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation 再次 `commit` → `conflict/review_required`
- 无生产语义改动；1 file / 55 tests passed

该 slice 不是完整 C-4P6 closure。

### S31 tests-only residual：string evaluatorVersion

`cc50e40`（`test(data): cover string learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 string 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: "1"`，使 `number()`/`readCanonicalRecord` 拒绝；outcome.json / session.json / settlement marker 保持匹配：
- restart `reconcile()` → `review_required` + `missing_record`
- 不 rewrite outcome/manifest/marker，不把 string evaluatorVersion 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation 再次 `commit` → `conflict/review_required`
- 无生产语义改动；1 file / 56 tests passed

该 slice 不是完整 C-4P6 closure。

### S32 tests-only residual：non-integer evaluatorVersion

`b7087f2`（`test(data): cover non-integer learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-integer 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: 1.5`，使 `number()`/`readCanonicalRecord` 拒绝；outcome.json / session.json / settlement marker 保持匹配：
- restart `reconcile()` → `review_required` + `missing_record`
- 不 rewrite outcome/manifest/marker，不把 non-integer evaluatorVersion 修复为 valid record
- 不调用 evaluator / `createId`
- 同 operation 再次 `commit` → `conflict/review_required`
- 无生产语义改动；1 file / 57 tests passed

该 slice 不是完整 C-4P6 closure。

### S33 tests-only residual：non-writing outcomeKind

`a85718a`（`test(data): cover non-writing learning record outcomeKind residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-writing 的 canonical learning-record `outcomeKind` residual：其它 metadata/body 仍合法，仅将 metadata `outcomeKind` 与 body heading 设为 `not_evidenced`，使 `writesLearningRecord(kind)` 为 false 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。


### S34 tests-only residual：needs_practice outcomeKind

`6f550b2`（`test(data): cover needs_practice learning record outcomeKind residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-writing 的 canonical learning-record `outcomeKind` residual：其它 metadata/body 仍合法，仅将 metadata `outcomeKind` 与 body heading 设为 `needs_practice`，使 `writesLearningRecord(kind)` 为 false 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。


### S35 tests-only residual：unknown outcomeKind

`65527ef`（`test(data): cover unknown learning record outcomeKind residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 unknown 的 canonical learning-record `outcomeKind` residual：其它 metadata/body 仍合法，仅将 metadata `outcomeKind` 与 body heading 设为 `unknown_kind`，使 `outcomeKind()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeKind、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。


### S36 tests-only residual：negative evaluatorVersion

`8467c76`（`test(data): cover negative learning record evaluatorVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 negative 的 canonical learning-record `evaluatorVersion` residual：其它 metadata/body 仍合法，仅 `evaluatorVersion: -1`，使 `number()`/`readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evaluatorVersion、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S37 tests-only residual：empty outcomeId

`dd4ce9a`（`test(data): cover empty learning record outcomeId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `outcomeId` residual：其它 metadata/body 仍合法，仅 `outcomeId: ""`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S38 tests-only residual：64-char non-hex assessment contentSha256

`11299c2`（`test(data): cover non-hex learning record assessment sha residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 64-char non-hex 的 assessment `contentSha256` residual：其它 metadata/body 仍合法，仅 `contentSha256` 为 `g`×64，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S39 tests-only residual：null assessment

`20da409`（`test(data): cover null learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 null 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: null`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S40 tests-only residual：64-char uppercase-hex assessment contentSha256

`e71a7c2`（`test(data): cover uppercase learning record assessment sha residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 64-char uppercase-hex 的 assessment `contentSha256` residual：其它 metadata/body 仍合法，仅 `contentSha256` 为 `A`×64，使 `isVerifiedAssessment` 拒绝（regex 要求 lowercase）；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S41 tests-only residual：non-array evidenceEventIds

`0cf87ef`（`test(data): cover non-array learning record evidence residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-array 的 `evidenceEventIds` residual：其它 metadata/body 仍合法，仅 `evidenceEventIds: null`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S42 tests-only residual：blank evidenceEventIds item

`96b63ac`（`test(data): cover blank learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 blank 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[""]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S43 tests-only residual：empty recordId

`307c34a`（`test(data): cover empty learning record recordId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `recordId` residual：其它 metadata/body 仍合法，仅 `recordId: ""`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 recordId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S44 tests-only residual：empty operationId

`659f9ac`（`test(data): cover empty learning record operationId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 canonical learning-record `operationId` residual：其它 metadata/body 仍合法，仅 `operationId: ""`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 operationId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S45 tests-only residual：array assessment

`802b62e`（`test(data): cover array learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 array 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: []`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S46 tests-only residual：missing assessment key

`f990f7f`（`test(data): cover missing learning record assessment key residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing assessment key residual：其它 metadata/body 仍合法，仅删除 `assessment` key，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S47 tests-only residual：non-string evidenceEventIds item

`bcea176`（`test(data): cover non-string learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 non-string 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[1]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S48 tests-only residual：whitespace-only evidenceEventIds item

`df111a0`（`test(data): cover whitespace learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[" "]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S49 tests-only residual：whitespace-only outcomeId

`f6b13e1`（`test(data): cover whitespace learning record outcomeId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `outcomeId` residual：其它 metadata/body 仍合法，仅 `outcomeId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 outcomeId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S50 tests-only residual：boolean assessment

`d59da4e`（`test(data): cover boolean learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 boolean 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: false`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S51 tests-only residual：whitespace-only operationId

`2d5d84b`（`test(data): cover whitespace learning record operationId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `operationId` residual：其它 metadata/body 仍合法，仅 `operationId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 operationId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S52 tests-only residual：number assessment

`05c852e`（`test(data): cover number learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 number 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: 1`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S53 tests-only residual：whitespace-only recordId

`eee9b34`（`test(data): cover whitespace learning record recordId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `recordId` residual：其它 metadata/body 仍合法，仅 `recordId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 recordId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S54 tests-only residual：string assessment

`1a481c4`（`test(data): cover string learning record assessment residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 string 的 assessment residual：其它 metadata/body 仍合法，仅 `assessment: "not-an-assessment-object"`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S55 tests-only residual：whitespace-only sessionId

`1c2585f`（`test(data): cover whitespace learning record sessionId residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 canonical learning-record `sessionId` residual：其它 metadata/body 仍合法，仅 `sessionId: " "`，使 `text()` 返回 null 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 sessionId、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S56 tests-only residual：whitespace-only assessment relativePath

`4ba78fc`（`test(data): cover whitespace assessment relativePath residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 whitespace-only 的 assessment `relativePath` residual：其它 metadata/body 仍合法，仅 `assessment.relativePath: " "`，使 `text()` 返回 null 且 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment path、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S57 tests-only residual：missing assessment contentSha256 key

`685b54b`（`test(data): cover missing assessment contentSha256 residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing assessment `contentSha256` key residual：其它 metadata/body 仍合法，仅删除 `assessment.contentSha256`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S58 tests-only residual：null evidenceEventIds item

`421f5a0`（`test(data): cover null learning record evidence item residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 null 的 evidenceEventIds item residual：其它 metadata/body 仍合法，仅 `evidenceEventIds:[null]`，使 `stringArray` throw 且 `readCanonicalRecord` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 evidence、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S59 tests-only residual：missing assessment relativePath key

`e986993`（`test(data): cover missing assessment relativePath residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing assessment `relativePath` key residual：其它 metadata/body 仍合法，仅删除 `assessment.relativePath` 并保留 `contentSha256`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。

### S60 tests-only residual：empty assessment contentSha256

`bc43e30`（`test(data): cover empty assessment contentSha256 residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 empty 的 assessment `contentSha256` residual：其它 metadata/body 仍合法，仅 `assessment.contentSha256: ""`，使 `isVerifiedAssessment` 拒绝；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 assessment、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。



## 2. Canonical authority 与幂等性边界

S1 实施并保留以下 authority 关系：

| 情形 | authority（由高到低） | 不得作为 authority 的内容 |
|---|---|---|
| **会写 immutable Learning record 的分支** | immutable Learning record → `outcome.json` + manifest → settlement marker | catalog presence、stage 文件、仅 marker |
| **不会写 record 的分支** | settlement marker 是唯一的 operation settlement / idempotency authority | catalog read、缺失的 record、manifest 单独状态 |

有 record 时，record 是恢复和冲突判断的第一事实，`outcome.json` 与 manifest 是 session projection，marker 是 operation identity / settlement projection，不能反过来覆盖有效 record。无 record 时，只有有效 marker 能证明 operation settlement；catalog 只在必要 canonical publish 完成后读取，不授权 commit、repair 或成功结果。

已实施的 repair 限于“有效 immutable record 修复缺失 projection”，且顺序为 outcome → manifest → marker。冲突 identity、损坏、越界或其他不能安全证明的状态固定进入 `review_required`，不执行泛化覆盖、回滚或删除。

## 3. S1 的 durability 与失败边界

S1 将可变文件的 replace 与 immutable record 的不可覆盖 publish 分开处理：

- 可变 `outcome.json` / marker 的 capability downgrade 只接受上述五个 code；不在 allowlist 的 permission、I/O、unknown、open、sync 或 close 失败均为 fatal，且不能继续后续 canonical write。
- immutable record 的 link 成功并不掩盖 parent directory open / sync / close 失败；匹配 `EEXIST` 和 stage cleanup 的错误同样传播为 fatal。不会因最终 record bytes 可读或匹配而报告成功。
- stage、record、outcome、manifest、marker 是有序可恢复点，而非共同提交点。因此 S1 不承诺 post-rename rollback、共同原子可见性或任意跨文件锁定。

## 4. S1/S2/S3/S4/S5/S6/S7/S8/S9/S10/S11/S12/S13/S14/S15/S16/S17/S18/S19/S20/S21/S22 未关闭的 C-4P6 范围

C-4P6 因 manifest publisher 的 durability/capability-policy 尚未闭合、manifest `open` / `write` / `fsync` / `close` 的完整矩阵尚未验证，且除 S2 的 `after_outcome_publish`、S3 的 marker final rename `EIO` 、S4 的已有 `after_settlement_marker` settled recovery 、S5 的已有 `before_catalog_reconcile` settled recovery 与 S6 的 `after_stage_flush` fail-closed 定向场景、S7 的 `after_record_publish` authority-first repaired recovery 定向场景、S8 的 malformed settlement marker fail-closed 定向场景、S9 的 conflicting outcome.json fail-closed 定向场景、S10 的 conflicting completed session outcomeRef fail-closed 定向场景、S11 的 invalid non-file outcome.json symlink fail-closed 定向场景、S12 的 invalid non-file settlement-marker symlink fail-closed 定向场景、S13 的 invalid non-file session.json manifest symlink fail-closed 定向场景、S14 的 invalid outcome.json directory fail-closed 定向场景、S15 的 invalid settlement-marker directory fail-closed 定向场景、S16 的 invalid session.json directory fail-closed 定向场景、S17 的 invalid canonical learning-record directory fail-closed 定向场景、S18 的 invalid canonical learning-record non-file symlink fail-closed 定向场景、S19 的 invalid canonical learning-record content fail-closed 定向场景、S20 的 well-formed invalid settlement marker fail-closed 定向场景、S21 的 well-formed invalid canonical learning-record metadata fail-closed 定向场景、S22 的 well-formed invalid canonical learning-record metadata identity fail-closed 定向场景外的 crash / failure 矩阵尚未穷尽验证，必须继续作为不完整待办保留，直至未来获得批准并完成剩余 close-out。至少仍包括：

1. **manifest publisher capability-policy 对齐：**确认并落实 manifest publisher 与 shared durable capability 的策略边界，而不是从 S1 的 outcome / marker 行为外推。
2. **穷尽的 crash / failure 设计矩阵：**S1 测试不宣称覆盖所有 crash window、文件/目录 open-sync-close 组合、冲突与损坏状态；未来需要针对完整 scope 明确 acceptance criteria 和结果语义。
3. **运行验证：**完整 close-out 仍需实际运行 / 运维验证，而不是仅依据提交或有限单元、集成检查。

以下内容仍不在 S1/S2/S3/S4/S5/S6/S7/S8/S9/S10/S11/S12/S13/S14/S15/S16/S17/S18/S19/S20/S21/S22 或本 design gate 的授权范围内：跨文件事务或共同原子性、rollback、删除、general migration、canonical rewrite、retention 改动，以及新的外部 API；S4/S5/S6/S7/S8/S9/S10/S11/S12/S13/S14/S15/S16/S17/S18/S19/S20/S21/S22 也不是完整 catalog/manifest/crash matrix、operations validation 或 Windows native fsync/power-loss closure。C-4P8 和 C-4P9 也完全未受本切片改变。

## 5. 剩余设计矩阵（不是已通过证据）

未来 close-out 需单独批准范围、owner 与 API，并以不扩大 S1 的方式审查至少下列矩阵：

| 类别 | 剩余验证要求 |
|---|---|
| manifest capability-policy | manifest publisher 的 durable capability、allowlist、错误传播和与 S1 顺序的明确对齐 |
| crash windows | S2 仅提供 `after_outcome_publish` 的重启 / reconcile 定向证据；S3 仅提供 settlement-marker final rename 返回 `EIO` 后的 restart/reconcile 定向证据；S4 仅提供已有 `after_settlement_marker` interruption 后 restart `reconcile()` 为 `settled` 的定向证据；S5 仅提供已有 `before_catalog_reconcile` interruption 后 restart `reconcile()` 为 `settled` 的定向证据；S6 仅提供 `after_stage_flush` interruption 后 stage 保留、projection 不 promote、reconcile 为 `pending`、同 operation re-commit fail-closed 的定向证据；S7 仅提供 `after_record_publish` interruption 后 restart `reconcile()` 为 `repaired` 再 `settled`、不 reevaluate 的定向 evidence；这不等同于泛化 `after_manifest_publish`。manifest `open` / `write` / `fsync` / `close` 及其它 failure combinations 仍待验证 |
| 失败传播 | write、file fsync、file close、rename / link、parent directory open / sync / close 与 cleanup failure 不得被成功结果掩盖 |
| authority / conflict | valid record 的受控 repair、冲突 marker / projection、corrupt 或越界状态均不覆盖且安全地进入既有 retryable / `review_required` 语义；S8 仅提供 malformed settlement marker → `invalid_settlement_marker` fail-closed 的定向 evidence；S9 仅提供 mismatched `outcome.json` → `conflicting_outcome` fail-closed 的定向 evidence；S10 仅提供 mismatched completed session `outcomeRef` → `conflicting_outcome` fail-closed 的定向 evidence；S11 仅提供 invalid non-file `outcome.json` symlink → `review_required` fail-closed 的定向 evidence；S12 仅提供 invalid non-file settlement marker symlink → `invalid_settlement_marker` fail-closed 的定向 evidence；S13 仅提供 invalid non-file session.json manifest symlink → `review_required` fail-closed 的定向 evidence；S14–S16 仅提供 invalid directory residual（outcome/marker/manifest）fail-closed 的定向 evidence；S17–S18 仅提供 invalid canonical learning-record directory/symlink → `missing_record` fail-closed 的定向 evidence；S19 仅提供 invalid canonical learning-record content → `missing_record` fail-closed 的定向 evidence；S20 仅提供 well-formed invalid settlement marker → `invalid_settlement_marker` fail-closed 的定向 evidence；S21 仅提供 well-formed invalid canonical learning-record metadata → `missing_record` fail-closed 的定向 evidence；S22 仅提供 well-formed invalid canonical learning-record metadata identity → `missing_record` fail-closed 的定向 evidence，不等于完整 authority/conflict matrix |
| compatibility / operations | schema、canonical path、`0600` mode、reader compatibility、非敏感 warning / log，以及可操作的运行验证 |

该矩阵是未来 acceptance criteria；S2 仅关闭 `after_outcome_publish` 这一条定向 evidence，S3 仅关闭 marker final rename `EIO` 这一条定向 evidence，S4 仅关闭已有 `after_settlement_marker` settled recovery 这一条定向 evidence，S5 仅关闭已有 `before_catalog_reconcile` settled recovery 这一条定向 evidence，S6 仅关闭 `after_stage_flush` fail-closed recovery 这一条定向 evidence，S7 仅关闭 `after_record_publish` authority-first repaired recovery 这一条定向 evidence，S8 仅关闭 malformed settlement marker fail-closed 这一条定向 evidence，S9 仅关闭 mismatched `outcome.json` vs record authority fail-closed 这一条定向 evidence，S10 仅关闭 mismatched completed session `outcomeRef` vs record authority fail-closed 这一条定向 evidence，S11 仅关闭 invalid non-file `outcome.json` symlink fail-closed 这一条定向 evidence，S12 仅关闭 invalid non-file settlement-marker symlink fail-closed 这一条定向 evidence，S13 仅关闭 invalid non-file session.json manifest symlink fail-closed 这一条定向 evidence；S14–S18 仅关闭对应 invalid path-type residual 定向 evidence；S19 仅关闭 invalid canonical learning-record content fail-closed 这一条定向 evidence；S20 仅关闭 well-formed invalid settlement marker fail-closed 这一条定向 evidence；S21 仅关闭 well-formed invalid canonical learning-record metadata fail-closed 这一条定向 evidence；S22 仅关闭 well-formed invalid canonical learning-record metadata identity fail-closed 这一条定向 evidence，不是泛化 `after_manifest_publish`、完整 manifest failure matrix、生产功能或对 `7292bf4` / `e02a086` / `9847842` / `1334513` / `e821c69` / `ebd084c` / `145b671` / `d26bb83` / `e743a3e` / `a631a31` / `6bfffc5` / `4603601` / `60b6791` / `e1f0563` 已经完全满足的声明。

## 6. 后续实施前边界

任何后续 P6 切片都必须先单独获得 scope / owner / API 批准，并明确其与 S1 的关系；不得借 S1 直接扩大为自动 repair、删除、rollback、迁移或外部接口改动。没有获得这类批准和完整验证前，路线图只能表述为：**“C-4P6-S1 implemented; C-4P6-S2 tests-only evidence for `after_outcome_publish` recorded; C-4P6-S3 tests-only evidence for settlement-marker final rename `EIO` recorded; C-4P6-S4 tests-only evidence for settled recovery after `after_settlement_marker` recorded; C-4P6-S5 tests-only evidence for settled recovery after `before_catalog_reconcile` recorded; C-4P6-S6 tests-only evidence for fail-closed recovery after `after_stage_flush` recorded; C-4P6-S7 tests-only evidence for authority-first repaired recovery after `after_record_publish` recorded; C-4P6-S8 tests-only evidence for malformed settlement marker fail-closed residual recorded; C-4P6-S9 tests-only evidence for conflicting outcome.json vs record authority fail-closed residual recorded; C-4P6-S10 tests-only evidence for conflicting completed session outcomeRef fail-closed residual recorded; C-4P6-S11 tests-only evidence for invalid non-file outcome.json symlink fail-closed residual recorded; C-4P6-S12 tests-only evidence for invalid non-file settlement-marker symlink fail-closed residual recorded; C-4P6-S13 tests-only evidence for invalid non-file session.json manifest symlink fail-closed residual recorded; C-4P6-S14/S15/S16 tests-only evidence for invalid outcome/marker/manifest directory fail-closed residual recorded; C-4P6-S17 tests-only evidence for invalid canonical learning-record directory fail-closed residual recorded; C-4P6-S18 tests-only evidence for invalid non-file canonical learning-record symlink fail-closed residual recorded; C-4P6-S19 tests-only evidence for invalid canonical learning-record content fail-closed residual recorded; C-4P6-S20 tests-only evidence for well-formed invalid settlement marker fail-closed residual recorded; C-4P6-S21 tests-only evidence for well-formed invalid canonical learning-record metadata fail-closed residual recorded; C-4P6-S22 tests-only evidence for well-formed invalid canonical learning-record metadata identity fail-closed residual recorded; C-4P6-S23/S24/S25/S26/S27/S28/S29/S30/S31/S32 tests-only residual evidence recorded through non-integer evaluatorVersion; C-4P6-S33 tests-only residual evidence for non-writing canonical learning-record outcomeKind residual recorded; C-4P6-S34 tests-only residual evidence for needs_practice canonical learning-record outcomeKind residual recorded; C-4P6-S35 tests-only residual evidence for unknown canonical learning-record outcomeKind residual recorded; C-4P6-S36 tests-only residual evidence for negative canonical learning-record evaluatorVersion residual recorded; C-4P6-S37 tests-only residual evidence for empty canonical learning-record outcomeId residual recorded; C-4P6-S38 tests-only residual evidence for 64-char non-hex assessment contentSha256 residual recorded; C-4P6-S39 tests-only residual evidence for null assessment residual recorded; C-4P6-S40 tests-only residual evidence for 64-char uppercase-hex assessment contentSha256 residual recorded; C-4P6-S41 tests-only residual evidence for non-array evidenceEventIds residual recorded; C-4P6-S42 tests-only residual evidence for blank evidenceEventIds item residual recorded; C-4P6-S43 tests-only residual evidence for empty recordId residual recorded; C-4P6-S44 tests-only residual evidence for empty operationId residual recorded; C-4P6-S45 tests-only residual evidence for array assessment residual recorded; C-4P6-S46 tests-only residual evidence for missing assessment key residual recorded; C-4P6-S47 tests-only residual evidence for non-string evidenceEventIds item residual recorded; C-4P6-S48 tests-only residual evidence for whitespace-only evidenceEventIds item residual recorded; C-4P6-S49 tests-only residual evidence for whitespace-only outcomeId residual recorded; C-4P6-S50 tests-only residual evidence for boolean assessment residual recorded; C-4P6-S51 tests-only residual evidence for whitespace-only operationId residual recorded; C-4P6-S52 tests-only residual evidence for number assessment residual recorded; C-4P6-S53 tests-only residual evidence for whitespace-only recordId residual recorded; C-4P6-S54 tests-only residual evidence for string assessment residual recorded; C-4P6-S55 tests-only residual evidence for whitespace-only sessionId residual recorded; C-4P6-S56 tests-only residual evidence for whitespace-only assessment relativePath residual recorded; C-4P6-S57 tests-only residual evidence for missing assessment contentSha256 key residual recorded; C-4P6-S58 tests-only residual evidence for null evidenceEventIds item residual recorded; C-4P6-S59 tests-only residual evidence for missing assessment relativePath key residual recorded; C-4P6-S60 tests-only residual evidence for empty assessment contentSha256 residual recorded; full P6 close-out remains pending.”**
