# C-4P6 Learning outcome durable settlement：S1 已实施，S2…S188 tests-only evidence 已补，完整闭环仍待设计门

> **状态：C-4P6-S1 已实施，C-4P6-S2/S3/S4/S5/S6/S7/S8/S9/S10/S11/S12/S13/S14/S15/S16/S17/S18/S19/S20/S21/S22/S23/S24/S25/S26/S27/S28/S29/S30/S31/S32/S33/S34/S35/S36/S37/S38/S39/S40/S41/S42/S43/S44/S45/S46/S47/S48/S49/S50/S51/S52/S53/S54/S55/S56/S57/S58/S59/S60/S61/S62/S63/S64/S65/S66/S67/S68/S69/S70/S71/S72/S73/S74/S75/S76/S77/S78/S79/S80/S81/S82/S83/S84/S85/S86/S87/S88/S89/S90/S91/S92/S93/S94/S95/S96/S97/S98/S99/S100/S101/S102/S103/S104/S105/S106/S107/S108/S109/S110/S111/S112/S113/S114/S115/S116/S117/S118/S119/S120/S121/S122/S123/S124/S125/S126/S127/S128/S129/S130/S131/S132/S133/S134/S135/S136/S137/S138/S139/S140/S141/S142/S143/S144/S145/S146/S147/S148/S149/S150/S151/S152/S153/S154/S155/S156/S157/S158/S159/S160/S161/S162/S163/S164/S165/S166/S167/S168/S169/S170/S171/S172/S173/S174/S175/S176/S177/S178/S179/S180/S181/S182/S183/S184/S185/S186/S187/S188 已完成 tests-only evidence；C-4P6 尚未完整关闭，仍是待办。**提交 `7292bf4`（`fix(data): harden learning outcome settlement`）和 `e02a086`（`test(data): cover outcome settlement durability`）实现的仅是“严格有序发布与受控恢复基础”；`9847842`（`test(data): cover outcome publish crash recovery`）仅补齐单一 `after_outcome_publish` crash window 的测试证据；`1334513`（`test(data): cover outcome marker recovery`）仅补齐 settlement-marker durable rename 返回 `EIO` 后的受限 restart/reconcile 测试证据；`e821c69`（`test(data): cover settled outcome recovery`）仅补齐已有 `after_settlement_marker` 的一个独立中断的 settled recovery 测试证据；`ebd084c`（`test(data): cover pre-catalog outcome recovery`）仅补齐已有 `before_catalog_reconcile` 的一个独立中断的 settled recovery 测试证据；`145b671`（`test(data): cover post-stage-flush outcome recovery`）仅补齐 `after_stage_flush` interruption 后 fail-closed 不 promote incomplete projection 的测试证据；`d26bb83`（`test(data): cover after-record-publish recovery`）仅补齐 `after_record_publish` interruption 后 authority-first repaired recovery 的测试证据；`e743a3e`（`test(data): cover invalid settlement marker residual`）仅补齐 malformed settlement marker fail-closed 的测试证据；`a631a31`（`test(data): cover conflicting outcome projection residual`）仅补齐 settled 后 `outcome.json` 与 immutable record authority 分叉的 fail-closed residual 测试证据。`6bfffc5`（`test(data): cover conflicting manifest outcomeRef residual`）仅补齐 settled 后 completed `session.json` `outcomeRef` 与 immutable record authority 分叉的 fail-closed residual 测试证据。`4603601`（`test(data): cover invalid outcome symlink residual`）仅补齐 settled 后 `outcome.json` 为 non-file symlink 的 fail-closed residual 测试证据。`60b6791`（`test(data): cover invalid settlement marker symlink residual`）仅补齐 settled 后 `outcome-settlement.json` 为 non-file symlink 的 fail-closed residual 测试证据。`e1f0563`（`test(data): cover invalid session manifest symlink residual`）仅补齐 settled 后 `session.json` 为 non-file symlink 的 fail-closed residual 测试证据。`f90a863`（`test(data): cover invalid outcome directory residual`）仅补齐 settled 后 `outcome.json` 为 directory 的 fail-closed residual 测试证据。`5fb4f04`（`test(data): cover invalid settlement marker directory residual`）仅补齐 settled 后 `outcome-settlement.json` 为 directory 的 fail-closed residual 测试证据。`85840ae`（`test(data): cover invalid session manifest directory residual`）仅补齐 settled 后 `session.json` 为 directory 的 fail-closed residual 测试证据。`14fa960`（`test(data): cover invalid learning record directory residual`）仅补齐 settled 后 canonical learning record 为 directory 的 fail-closed residual 测试证据。`94e686f`（`test(data): cover invalid learning record symlink residual`）仅补齐 settled 后 canonical learning record 为 non-file symlink 的 fail-closed residual 测试证据。`f9e263f`（`test(data): cover invalid learning record content residual`）仅补齐 settled 后 canonical learning record 为 regular file 但 content 无效/无法通过 parse-validation 的 fail-closed residual 测试证据。`412acc5`（`test(data): cover invalid normalized settlement marker residual`）仅补齐 settled 后 well-formed 但 normalizeMarker 失败的 settlement marker fail-closed residual 测试证据。`9e47eed`（`test(data): cover invalid learning record metadata residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record metadata（`schemaVersion` 1→2）fail-closed residual 测试证据。`a947d4c`（`test(data): cover invalid learning record metadata identity residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record metadata identity（`recordId` 非 canonical）fail-closed residual 测试证据。`a6d693f`（`test(data): cover invalid learning record assessment residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment metadata（`assessment.contentSha256` 非 64-hex）fail-closed residual 测试证据。`2fdf59f`（`test(data): cover invalid learning record assessment path residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record assessment path（`assessment.relativePath` 为空串）fail-closed residual 测试证据。`e7440cc`（`test(data): cover invalid learning record body prefix residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record body prefix（markdown heading 与 outcomeKind 不一致）fail-closed residual 测试证据；`80788b1`（`test(data): cover empty learning record evidence residual`）仅补齐 settled 后 well-formed 但 empty 的 canonical learning-record `evidenceEventIds` fail-closed residual 测试证据；`fdc2d22`（`test(data): cover invalid learning record evaluatorVersion residual`）仅补齐 settled 后 well-formed 但 invalid 的 canonical learning-record `evaluatorVersion`（null）fail-closed residual 测试证据；`eb2fbf6`（`test(data): cover mismatched learning record sessionId residual`）仅补齐 settled 后 well-formed 但 mismatched 的 canonical learning-record `sessionId` fail-closed residual 测试证据。`74120a7`（`test(data): cover non-canonical learning record operationId residual`）仅补齐 well-formed non-canonical canonical learning-record operationId residual 的 tests-only evidence；`3d74522`（`test(data): cover zero learning record evaluatorVersion residual`）仅补齐 well-formed zero canonical learning-record evaluatorVersion residual 的 tests-only evidence；`cc50e40`（`test(data): cover string learning record evaluatorVersion residual`）仅补齐 well-formed string canonical learning-record evaluatorVersion residual 的 tests-only evidence；`b7087f2`（`test(data): cover non-integer learning record evaluatorVersion residual`）仅补齐 well-formed non-integer canonical learning-record evaluatorVersion residual 的 tests-only evidence；`a85718a`（`test(data): cover non-writing learning record outcomeKind residual`）仅补齐 well-formed non-writing canonical learning-record outcomeKind residual 的 tests-only evidence；`6f550b2`（`test(data): cover needs_practice learning record outcomeKind residual`）仅补齐 well-formed needs_practice canonical learning-record outcomeKind residual 的 tests-only evidence；`65527ef`（`test(data): cover unknown learning record outcomeKind residual`）仅补齐 unknown canonical learning-record outcomeKind residual 的 tests-only evidence；`8467c76`（`test(data): cover negative learning record evaluatorVersion residual`）仅补齐 well-formed negative canonical learning-record evaluatorVersion residual 的 tests-only evidence；`dd4ce9a`（`test(data): cover empty learning record outcomeId residual`）仅补齐 well-formed empty canonical learning-record outcomeId residual 的 tests-only evidence；`11299c2`（`test(data): cover non-hex learning record assessment sha residual`）仅补齐 well-formed 64-char non-hex assessment contentSha256 residual 的 tests-only evidence；`20da409`（`test(data): cover null learning record assessment residual`）仅补齐 well-formed null assessment residual 的 tests-only evidence；`e71a7c2`（`test(data): cover uppercase learning record assessment sha residual`）仅补齐 well-formed 64-char uppercase-hex assessment contentSha256 residual 的 tests-only evidence；`0cf87ef`（`test(data): cover non-array learning record evidence residual`）仅补齐 well-formed non-array evidenceEventIds residual 的 tests-only evidence；本文记录该事实、剩余设计门和禁止越界的边界；它不把 S1 宣称为跨文件事务或共同原子性 或完整 durable closure。

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

### S61 tests-only residual：missing schemaVersion key

`7a6c057`（`test(data): cover missing learning record schemaVersion residual`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，补齐 settled 后 well-formed 但 missing `schemaVersion` key residual：其它 metadata/body 仍合法，仅删除 `schemaVersion`，使严格 schemaVersion 校验失败；restart `reconcile()` → `review_required` + `missing_record`；不 rewrite authority、不修复 schemaVersion、不 evaluate；同 operation commit → `conflict/review_required`。无生产语义改动。



### S62 tests-only evidence：well-formed empty-object assessment residual

`8b31234`（`test(data): cover empty-object learning record assessment residual`）仅修改测试，补齐 settled 后 well-formed 但 empty-object `assessment`（`{}`）fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S63 tests-only evidence：well-formed missing outcomeId key residual

`2b951b0`（`test(data): cover missing learning record outcomeId residual`）仅修改测试，补齐 settled 后 well-formed 但 missing `outcomeId` key fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S64 tests-only evidence：well-formed missing operationId key residual

`71e7927`（`test(data): cover missing learning record operationId residual`）仅修改测试，补齐 settled 后 well-formed 但 missing `operationId` key fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S65 tests-only evidence：well-formed missing sessionId key residual

`4145db8`（`test(data): cover missing learning record sessionId residual`）仅修改测试，补齐 settled 后 well-formed 但 missing `sessionId` key fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S66 tests-only evidence：well-formed missing evidenceEventIds key residual

`4145db8` 引入 missing `evidenceEventIds` key residual；`c3efedc`（`test(data): harden missing evidenceEventIds residual asserts`）收紧断言。`stringArray` 在 key 缺失时 throw → fail closed：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S67 tests-only evidence：well-formed missing evaluatorVersion key residual

`7d5754e`（`test(data): cover missing learning record evaluatorVersion residual`）仅修改测试，补齐 settled 后 well-formed 但 missing `evaluatorVersion` key fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S68 tests-only evidence：well-formed missing outcomeKind key residual

`7d5754e` 同提交补齐 settled 后 well-formed 但 missing `outcomeKind` key fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S69 tests-only evidence：well-formed missing recordId key residual

`12abeab`（`test(data): cover missing recordId and null schemaVersion residuals`）仅修改测试，补齐 settled 后 well-formed 但 missing `recordId` key fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S70 tests-only evidence：well-formed null schemaVersion residual

`12abeab` 同提交补齐 settled 后 well-formed 但 `schemaVersion: null` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S71 tests-only evidence：well-formed string schemaVersion residual

`c0d1a20`（`test(data): cover string schemaVersion and whitespace assessment sha residuals`）仅修改测试，补齐 settled 后 well-formed 但 string `schemaVersion` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S72 tests-only evidence：well-formed whitespace-only assessment contentSha256 residual

`c0d1a20` 同提交补齐 settled 后 well-formed 但 whitespace-only `assessment.contentSha256` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S73 tests-only evidence：well-formed boolean schemaVersion residual

`6af9dbc`（`test(data): cover boolean schemaVersion and null assessment sha residuals`）仅修改测试，补齐 settled 后 well-formed 但 boolean `schemaVersion` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S74 tests-only evidence：well-formed null assessment contentSha256 residual

`6af9dbc` 同提交补齐 settled 后 well-formed 但 `assessment.contentSha256: null` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S75 tests-only evidence：well-formed non-integer numeric schemaVersion residual

`e49f745`（`test(data): cover float schemaVersion and null assessment path residuals`）仅修改测试，补齐 settled 后 well-formed 但 non-integer numeric `schemaVersion`（`1.5`）fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S76 tests-only evidence：well-formed null assessment relativePath residual

`e49f745` 同提交补齐 settled 后 well-formed 但 `assessment.relativePath: null` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S77 tests-only evidence：well-formed number assessment contentSha256 residual

`6b31876`（`test(data): cover number assessment sha and boolean path residuals`）仅修改测试，补齐 settled 后 well-formed 但 number `assessment.contentSha256` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S78 tests-only evidence：well-formed boolean assessment relativePath residual

`6b31876` 同提交补齐 settled 后 well-formed 但 boolean `assessment.relativePath` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S79 tests-only evidence：well-formed boolean assessment contentSha256 residual

`15eab32`（`test(data): cover boolean assessment sha and number path residuals`）仅修改测试，补齐 settled 后 well-formed 但 boolean `assessment.contentSha256` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S80 tests-only evidence：well-formed number assessment relativePath residual

`15eab32` 同提交补齐 settled 后 well-formed 但 number `assessment.relativePath` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S81 tests-only evidence：well-formed short lowercase-hex assessment contentSha256 residual

`a040d22`（`test(data): cover short assessment sha and array schemaVersion residuals`）仅修改测试，补齐 settled 后 well-formed 但 63-char lowercase-hex `assessment.contentSha256` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S82 tests-only evidence：well-formed array schemaVersion residual

`a040d22` 同提交补齐 settled 后 well-formed 但 array `schemaVersion` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S83 tests-only evidence：well-formed long lowercase-hex assessment contentSha256 residual

`23d404c`（`test(data): cover long assessment sha and object schemaVersion residuals`）仅修改测试，补齐 settled 后 well-formed 但 65-char lowercase-hex `assessment.contentSha256` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S84 tests-only evidence：well-formed object schemaVersion residual

`23d404c` 同提交补齐 settled 后 well-formed 但 object `schemaVersion` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S85 tests-only evidence：well-formed leading metadata garbage residual

`a5f4993`（`test(data): cover leading metadata garbage and missing suffix residuals`）仅修改测试，补齐 settled 后 metadata 前 leading garbage（`start !== 0`）fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S86 tests-only evidence：well-formed missing metadata suffix residual

`a5f4993` 同提交补齐 settled 后 missing metadata suffix（`end < 0`）fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S87 tests-only evidence：well-formed malformed metadata JSON residual

`d141920`（`test(data): cover malformed metadata JSON and missing body newline residuals`）仅修改测试，补齐 settled 后 malformed metadata JSON（`JSON.parse` throw）fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S88 tests-only evidence：well-formed missing newline after metadata suffix residual

`d141920` 同提交补齐 settled 后 metadata suffix 与 body heading 缺少必需换行 fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S89 tests-only evidence：well-formed null outcomeId residual

`55f3c58`（`test(data): cover null outcomeId and false schemaVersion residuals`）仅修改测试，补齐 settled 后 well-formed 但 null `outcomeId` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S90 tests-only evidence：well-formed false schemaVersion residual

`55f3c58` 同提交补齐 settled 后 well-formed 但 false `schemaVersion` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S91 tests-only evidence：well-formed null operationId residual

`7ea4ac3`（`test(data): cover null operationId and null sessionId residuals`）仅修改测试，补齐 settled 后 well-formed 但 null `operationId` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S92 tests-only evidence：well-formed null sessionId residual

`7ea4ac3` 同提交补齐 settled 后 well-formed 但 null `sessionId` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S93 tests-only evidence：well-formed null recordId residual

`995545a`（`test(data): cover null recordId and number outcomeId residuals`）仅修改测试，补齐 settled 后 well-formed 但 null `recordId` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S94 tests-only evidence：well-formed number outcomeId residual

`995545a` 同提交补齐 settled 后 well-formed 但 number `outcomeId` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S95 tests-only evidence：well-formed number operationId residual

`e90301a`（`test(data): cover number operationId and boolean sessionId residuals`）仅修改测试，补齐 settled 后 well-formed 但 number `operationId` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S96 tests-only evidence：well-formed boolean sessionId residual

`e90301a` 同提交补齐 settled 后 well-formed 但 boolean `sessionId` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S97 tests-only evidence：well-formed null outcomeKind residual

`69fc5be`（`test(data): cover null outcomeKind and missing body residuals`）仅修改测试，补齐 settled 后 well-formed 但 null `outcomeKind` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S98 tests-only evidence：well-formed missing body after metadata residual

`69fc5be` 同提交补齐 settled 后 well-formed metadata 但整段 markdown body 缺失 fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S99 tests-only evidence：well-formed empty-file learning-record residual

`c21dd08`（`test(data): cover empty-file record and number outcomeKind residuals`）仅修改测试，补齐 settled 后 zero-byte regular-file learning-record fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S100 tests-only evidence：well-formed number outcomeKind residual

`c21dd08` 同提交补齐 settled 后 well-formed 但 number `outcomeKind` fail-closed residual：`reconcile()` → `review_required` + `missing_record`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S101 tests-only evidence：well-formed null settlement-marker outcomeId residual

`3084e41`（`test(data): cover null marker outcomeId and array marker residuals`）仅修改测试，补齐 settled 后 well-formed 但 settlement marker `outcomeId: null` fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S102 tests-only evidence：well-formed array settlement-marker residual

`3084e41` 同提交补齐 settled 后 well-formed JSON array settlement marker fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S103 tests-only evidence：well-formed null settlement-marker operationId residual

`cf4c3a7`（`test(data): cover null marker operationId and record-presence residuals`）仅修改测试，补齐 settled 后 well-formed 但 settlement marker `operationId: null` fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S104 tests-only evidence：well-formed settlement-marker record-presence mismatch residual

`cf4c3a7` 同提交补齐 settled 后 writing `kind` 但 `record: null` settlement marker fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S105 tests-only evidence：well-formed null settlement-marker sessionId residual

`4084509`（`test(data): cover null marker sessionId and empty-evidence residuals`）仅修改测试，补齐 settled 后 well-formed 但 settlement marker `sessionId: null` fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S106 tests-only evidence：well-formed empty settlement-marker evidence for writing kind residual

`4084509` 同提交补齐 settled 后 writing kind 但 `evidenceEventIds: []` settlement marker fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S107 tests-only evidence：well-formed null settlement-marker evaluatorVersion residual

`a1a8272`（`test(data): cover null marker evaluatorVersion and record-identity residuals`）仅修改测试，补齐 settled 后 well-formed 但 settlement marker `evaluatorVersion: null` fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S108 tests-only evidence：well-formed settlement-marker record identity mismatch residual

`a1a8272` 同提交补齐 settled 后 writing kind 但 marker.record.recordId 与 canonical identity 不一致 fail-closed residual：`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S109 tests-only evidence：well-formed non-canonical settlement-marker operationId residual

`db9e76c`（`test(data): cover non-canonical marker operationId and invalid record sha residuals`）仅修改测试，补齐 settled 后 well-formed 但 settlement marker non-canonical `operationId` fail-closed residual：`normalizeMarker` via `requireOperationId` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S110 tests-only evidence：well-formed invalid settlement-marker record contentSha256 residual

`db9e76c` 同提交补齐 settled 后 writing kind 但 `marker.record.contentSha256` 非合法 digest fail-closed residual：`normalizeMarker` via `normalizeRecordRef` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S111 tests-only evidence：well-formed settlement-marker record relativePath mismatch residual

`ede6d29`（`test(data): cover marker record path mismatch and non-array evidence residuals`）仅修改测试，补齐 settled 后 writing kind 但 `marker.record.relativePath` 与 canonical session path 不一致 fail-closed residual：`normalizeMarker` identity check 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S112 tests-only evidence：well-formed non-array settlement-marker evidenceEventIds residual

`ede6d29` 同提交补齐 settled 后 well-formed 但 `evidenceEventIds` 为 non-array fail-closed residual：`normalizeMarker` via `stringArray` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S113 tests-only evidence：well-formed null settlement-marker kind residual

`46ad7ca`（`test(data): cover null marker kind and array marker record residuals`）仅修改测试，补齐 settled 后 well-formed 但 settlement marker `kind: null` fail-closed residual：`normalizeMarker` via `outcomeKind` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S114 tests-only evidence：well-formed array settlement-marker record residual

`46ad7ca` 同提交补齐 settled 后 writing kind 但 `marker.record` 为 JSON array fail-closed residual：`normalizeMarker` via `normalizeRecordRef` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S115 tests-only evidence：well-formed non-string settlement-marker evidenceEventIds item residual

`cb5c780`（`test(data): cover non-string marker evidence item and unknown kind residuals`）仅修改测试，补齐 settled 后 well-formed 但 `evidenceEventIds` 含 non-string item fail-closed residual：`normalizeMarker` via `stringArray` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S116 tests-only evidence：well-formed unknown settlement-marker kind residual

`cb5c780` 同提交补齐 settled 后 well-formed 但 unknown non-null `kind` fail-closed residual：`normalizeMarker` via `outcomeKind` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S117 tests-only evidence：well-formed missing settlement-marker record contentSha256 key residual

`c5fe645`（`test(data): cover missing marker record sha and whitespace evidence residuals`）仅修改测试，补齐 settled 后 writing kind 但 `marker.record` 缺 `contentSha256` key fail-closed residual：`normalizeMarker` via `normalizeRecordRef` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S118 tests-only evidence：well-formed whitespace-only settlement-marker evidenceEventIds item residual

`c5fe645` 同提交补齐 settled 后 well-formed 但 `evidenceEventIds` 含 whitespace-only item fail-closed residual：`normalizeMarker` via `stringArray` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S119 tests-only evidence：well-formed zero settlement-marker evaluatorVersion residual

`b6dab25`（`test(data): cover zero marker evaluatorVersion and missing path residuals`）仅修改测试，补齐 settled 后 well-formed 但 settlement marker `evaluatorVersion: 0` fail-closed residual：`normalizeMarker` via `number()` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S120 tests-only evidence：well-formed missing settlement-marker record relativePath key residual

`b6dab25` 同提交补齐 settled 后 writing kind 但 `marker.record` 缺 `relativePath` key fail-closed residual：`normalizeMarker` via `normalizeRecordRef` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S121 tests-only evidence：well-formed missing settlement-marker record recordId key residual

`f031948`（`test(data): cover missing marker recordId and null record sha residuals`）仅修改测试，补齐 settled 后 writing kind 但 `marker.record` 缺 `recordId` key fail-closed residual：`normalizeMarker` via `normalizeRecordRef` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S122 tests-only evidence：well-formed null settlement-marker record contentSha256 residual

`f031948` 同提交补齐 settled 后 writing kind 但 `marker.record.contentSha256: null` fail-closed residual：`normalizeMarker` via `normalizeRecordRef`/`text()` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S123 tests-only evidence：well-formed non-writing settlement-marker kind with record residual

`e62a962`（`test(data): cover non-writing kind with record and missing schema residuals`）仅修改测试，补齐 settled 后 non-writing `kind: needs_practice` 但 non-null `record` fail-closed residual：`normalizeMarker` record-presence check 拒绝（inverse of writing-kind + record:null）；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S124 tests-only evidence：well-formed missing settlement-marker schemaVersion key residual

`e62a962` 同提交补齐 settled 后 otherwise well-formed 但缺 `schemaVersion` key fail-closed residual：`normalizeMarker` schemaVersion 检查拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S125 tests-only evidence：well-formed null settlement-marker schemaVersion residual

`9d47153`（`test(data): cover null marker schemaVersion and missing evidence residuals`）仅修改测试，补齐 settled 后 well-formed 但 `schemaVersion: null` fail-closed residual：`normalizeMarker` schemaVersion 检查拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S126 tests-only evidence：well-formed missing settlement-marker evidenceEventIds key residual

`9d47153` 同提交补齐 settled 后 well-formed 但缺 `evidenceEventIds` key fail-closed residual：`normalizeMarker` via `stringArray` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。


### S127 tests-only evidence：well-formed Windows device-name settlement-marker sessionId residual

`8dedd2d`（`test(data): cover device-name marker sessionId and missing outcomeId residuals`）仅修改测试，补齐 settled 后 well-formed 但 `sessionId: "CON"`（Windows device-name）fail-closed residual：`text()` 成功后 `requireLearningSessionId` / `isLearningSessionId` 因 `WINDOWS_DEVICE_NAME_PATTERN` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S128 tests-only evidence：well-formed missing settlement-marker outcomeId key residual

`8dedd2d` 同提交补齐 settled 后 well-formed 但缺 `outcomeId` key fail-closed residual：`normalizeMarker` via `text()` 拒绝；`reconcile()` → `review_required` + `invalid_settlement_marker`；authority bytes 不变；不 evaluate / `createId`；同 operation commit → `conflict/review_required`。不扩大为 complete durable closure。

### S129 tests-only evidence：durable stage write fail-closed residual

`be90d6c`（`test(data): cover stage write and sync fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `durableStage` 在 stage **write** 失败时的 fail-closed residual：注入 `write:${stagePath}` `EIO` 后 `commit` → `retryable_failure/reconciliation_required`；不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`；不进入 record link 后 projection 路径。不扩大为 complete durable closure。

### S130 tests-only evidence：durable stage sync fail-closed residual

`be90d6c` 同提交补齐 ordered publication 中 `durableStage` 在 stage **sync** 失败时的 fail-closed residual：注入 `sync:${stagePath}` `EIO` 后 `commit` → `retryable_failure/reconciliation_required`；不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`；不进入 record link 后 projection 路径。不扩大为 complete durable closure。

### S131 tests-only evidence：durable stage open fail-closed residual

`9721a0d`（`test(data): cover stage open and close fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `durableStage` 在 stage **open** 失败时的 fail-closed residual：注入 `open:wx:${stagePath}` `EIO` 后 `commit` → `retryable_failure/reconciliation_required`；不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`；不进入 record link 后 projection 路径。不扩大为 complete durable closure。

### S132 tests-only evidence：durable stage close fail-closed residual

`9721a0d` 同提交补齐 ordered publication 中 `durableStage` 在 stage **close** 失败时的 fail-closed residual：注入 `close:${stagePath}` `EIO` 后 `commit` → `retryable_failure/reconciliation_required`；不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`；不进入 record link 后 projection 路径。不扩大为 complete durable closure。

### S133 tests-only evidence：durable stage mkdir EIO fail-closed residual

`7a928e3`（`test(data): cover stage mkdir EIO and ENOSPC fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `durableStage` 在 stage parent **mkdir** 失败（`EIO`）时的 fail-closed residual：注入 `mkdir:${stageDirectory}` `EIO` 后 `commit` → `retryable_failure/reconciliation_required`；不 open stage、不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`。不扩大为 complete durable closure。

### S134 tests-only evidence：durable stage mkdir ENOSPC fail-closed residual

`7a928e3` 同提交补齐 ordered publication 中 `durableStage` 在 stage parent **mkdir** 失败（`ENOSPC`）时的 fail-closed residual：注入 `mkdir:${stageDirectory}` `ENOSPC` 后 `commit` → `retryable_failure/reconciliation_required`；不 open stage、不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`。不扩大为 complete durable closure。


### S135 tests-only evidence：durable record-parent mkdir EIO fail-closed residual

`d2dfbd3`（`test(data): cover record-parent mkdir EIO and ENOSPC fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `publishImmutable` 在 **learning-records parent mkdir** 失败（`EIO`）时的 fail-closed residual：预创建 stage 目录使 `durableStage` 完成，注入 `mkdir:${recordsDirectory}` `EIO` 后 `commit` → `retryable_failure/reconciliation_required`；stage 保留、不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`。不扩大为 complete durable closure。

### S136 tests-only evidence：durable record-parent mkdir ENOSPC fail-closed residual

`d2dfbd3` 同提交补齐 ordered publication 中 `publishImmutable` 在 **learning-records parent mkdir** 失败（`ENOSPC`）时的 fail-closed residual：预创建 stage 目录使 `durableStage` 完成，注入 `mkdir:${recordsDirectory}` `ENOSPC` 后 `commit` → `retryable_failure/reconciliation_required`；stage 保留、不 publish immutable record / `outcome.json` / settlement marker；manifest 保持 active 且 `outcomeRef: null`。不扩大为 complete durable closure。


### S137 tests-only evidence：durable outcome temp open fail-closed residual

`ac1e204`（`test(data): cover outcome temp open and write fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `replaceDurably(outcome.json)` 在 **temp open** 失败（`EIO`）时的 fail-closed residual：immutable record 已 publish 后注入 `open:wx:.outcome.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；record 保留、outcome/marker 未 publish；manifest 保持 active 且 `outcomeRef: null`；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。

### S138 tests-only evidence：durable outcome temp write fail-closed residual

`ac1e204` 同提交补齐 ordered publication 中 `replaceDurably(outcome.json)` 在 **temp write** 失败（`EIO`）时的 fail-closed residual：immutable record 已 publish 后注入 `write:.outcome.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；record 保留、outcome/marker 未 publish；manifest 保持 active 且 `outcomeRef: null`；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。


### S139 tests-only evidence：durable outcome temp sync fail-closed residual

`03d0284`（`test(data): cover outcome temp sync and close fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `replaceDurably(outcome.json)` 在 **temp sync** 失败（`EIO`）时的 fail-closed residual：immutable record 已 publish 后注入 `sync:.outcome.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；record 保留、outcome/marker 未 publish；manifest 保持 active 且 `outcomeRef: null`；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。

### S140 tests-only evidence：durable outcome temp close fail-closed residual

`03d0284` 同提交补齐 ordered publication 中 `replaceDurably(outcome.json)` 在 **temp close** 失败（`EIO`）时的 fail-closed residual：immutable record 已 publish 后注入 `close:.outcome.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；record 保留、outcome/marker 未 publish；manifest 保持 active 且 `outcomeRef: null`；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。


### S141 tests-only evidence：durable marker temp open fail-closed residual

`188b4d8`（`test(data): cover marker temp open and write fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `replaceDurably(outcome-settlement.json)` 在 **temp open** 失败（`EIO`）时的 fail-closed residual：record / outcome / completed manifest 已存在后注入 `open:wx:.outcome-settlement.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；marker 未 publish；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。

### S142 tests-only evidence：durable marker temp write fail-closed residual

`188b4d8` 同提交补齐 ordered publication 中 `replaceDurably(outcome-settlement.json)` 在 **temp write** 失败（`EIO`）时的 fail-closed residual：record / outcome / completed manifest 已存在后注入 `write:.outcome-settlement.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；marker 未 publish；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。


### S143 tests-only evidence：durable marker temp sync fail-closed residual

`a66c5ee`（`test(data): cover marker temp sync and close fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `replaceDurably(outcome-settlement.json)` 在 **temp sync** 失败（`EIO`）时的 fail-closed residual：record / outcome / completed manifest 已存在后注入 `sync:.outcome-settlement.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；marker 未 publish；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。

### S144 tests-only evidence：durable marker temp close fail-closed residual

`a66c5ee` 同提交补齐 ordered publication 中 `replaceDurably(outcome-settlement.json)` 在 **temp close** 失败（`EIO`）时的 fail-closed residual：record / outcome / completed manifest 已存在后注入 `close:.outcome-settlement.json.*.tmp` `EIO`；`commit` → `retryable_failure/reconciliation_required`；marker 未 publish；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。

### S145 tests-only evidence：durable outcome post-rename directory open fail-closed residual

`e6af9b9`（`test(data): cover post-rename directory open fail-closed residuals`）仅修改测试，补齐 ordered publication 中 `replaceDurably(outcome.json)` 在 **rename 成功后 session directory open** 失败（`EIO`）时的 fail-closed residual：immutable record 与 outcome 已 publish 后注入 `open:r:<sessionDir>` `EIO`；`commit` → `retryable_failure/reconciliation_required`；record/outcome 保留，marker 未 publish；manifest 保持 active 且 `outcomeRef: null`；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。

### S146 tests-only evidence：durable marker post-rename directory open fail-closed residual

`e6af9b9` 同提交补齐 ordered publication 中 `replaceDurably(outcome-settlement.json)` 在 **rename 成功后 session directory open** 失败（`EIO`）时的 fail-closed residual：record/outcome/completed manifest 与 marker 已 publish 后注入 marker rename 之后的 `open:r:<sessionDir>` `EIO`；`commit` → `retryable_failure/reconciliation_required`；session 已 completed；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。


### S147 tests-only evidence：durable marker post-rename directory sync fail-closed residual

`020f78a`（`test(data): cover marker post-rename directory sync/close residuals`）仅修改测试，补齐 ordered publication 中 `replaceDurably(outcome-settlement.json)` 在 **rename 成功后 session directory sync** 失败（`EIO`）时的 fail-closed residual：record/outcome/completed manifest 与 marker 已 publish 后注入 marker rename 之后的 `sync:<sessionDir>` `EIO`；`commit` → `retryable_failure/reconciliation_required`；session 已 completed；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。

### S148 tests-only evidence：durable marker post-rename directory close fail-closed residual

`020f78a` 同提交补齐 ordered publication 中 `replaceDurably(outcome-settlement.json)` 在 **rename 成功后 session directory close** 失败（`EIO`）时的 fail-closed residual：record/outcome/completed manifest 与 marker 已 publish 后注入 marker rename 之后的 `close:<sessionDir>` `EIO`；`commit` → `retryable_failure/reconciliation_required`；session 已 completed；私有 errno 细节不泄漏到结果。不扩大为 complete durable closure。


### S149 tests-only evidence：ledger complete after_state_loaded fail-closed residual

`4910654`（`test(data): cover manifest complete fail-closed ledger residuals`）仅修改测试，补齐 ordered publication 中 outcome publish 之后、`scope.complete()` 在 **after_state_loaded**（`operation: complete`）fault 时的 fail-closed residual：record/outcome 已 publish；`commit` → `retryable_failure/reconciliation_required`；manifest 保持 active 且 `outcomeRef: null`；marker 未 publish；私有 fault 细节不泄漏到结果。不扩大为 complete durable closure 或完整 manifest open/write/fsync/close matrix。

### S150 tests-only evidence：ledger complete after_stage_sync fail-closed residual

`4910654` 同提交补齐 `scope.complete()` 在 **after_stage_sync**（`operation: complete`，path 含 `.manifest-stage-`）fault 时的 fail-closed residual：record/outcome 已 publish；`commit` → `retryable_failure/reconciliation_required`；manifest 保持 active；未 rename 的 `.manifest-stage-*` residual 可保留；marker 未 publish；私有 fault 细节不泄漏到结果。不扩大为 complete durable closure 或完整 manifest capability matrix。


### S151 tests-only evidence：ledger complete after_file_stat pre-write fail-closed residual

`9461405`（`test(data): cover complete after_file_stat fail-closed residuals`）仅修改测试，补齐 `scope.complete()` 在 **写 completed manifest 之前** 的 `after_file_stat`（`operation: complete`，`outcome.json`）fault residual：record/outcome 已 publish；`commit` → `retryable_failure/reconciliation_required`；manifest 保持 active 且 `outcomeRef: null`；marker 未 publish；私有 fault 细节不泄漏到结果。不扩大为完整 manifest capability matrix。

### S152 tests-only evidence：ledger complete after_file_stat post-write fail-closed residual

`9461405` 同提交补齐 `scope.complete()` 在 **写 completed manifest 之后二次 validateCommittedOutcome** 的 `after_file_stat`（`operation: complete`，`outcome.json`）fault residual：record/outcome/completed manifest 已 publish；`commit` → `retryable_failure/reconciliation_required`；marker 未 publish；私有 fault 细节不泄漏到结果。不扩大为完整 durable closure。

### S153 tests-only evidence：ledger complete after_file_stat on session.json load fail-closed residual

`e9b882d`（`test(data): cover complete after_file_stat session residual loads`）仅修改测试，补齐 ordered publication 中 **outcome publish 之后、manifest complete 写前**，`completeUnlocked` 加载 `session.json` 时的 `after_file_stat`（`operation: complete`）fault residual：record/outcome 已存在；`commit` → `retryable_failure/reconciliation_required`；manifest 保持 active 且 `outcomeRef: null`；marker 未 publish；私有 fault 文案不得泄漏到 result JSON。无生产语义改动。

### S154 tests-only evidence：ledger complete after_file_stat on session event load fail-closed residual

`e9b882d` 同提交补齐 **同一 complete 路径** 在 `session.json` 之后加载 durable event 文件时的 `after_file_stat`（`operation: complete`，path 含 `/events/`）fault residual：record/outcome 已存在；manifest 保持 active；marker 未 publish。无生产语义改动。

### S155 tests-only evidence：commit pre-write after_writer_lock_acquired fail-closed residual

`176bc8a`（`test(data): cover pre-write ledger fault short-circuit residuals`）仅修改测试，补齐 **任何 durable publish 之前** ledger writer lock 获取后 `after_writer_lock_acquired`（`operation: repair`）fault residual：`commit` → `retryable_failure/temporarily_unavailable`；record/outcome/marker 均不存在；manifest 保持 active；私有 fault 文案不得泄漏。无生产语义改动。

### S156 tests-only evidence：commit pre-write repair after_file_stat on session.json fail-closed residual

`176bc8a` 同提交补齐 **reconcile 阶段** `operation: repair` 加载 `session.json` 时的 `after_file_stat` fault residual：同样在任何 stage/record/outcome 写之前 fail closed → `temporarily_unavailable`；无 durable residual。无生产语义改动。

### S157 tests-only evidence：commit pre-write lagging eventCount projection conflict residual

`c054d4c`（`test(data): cover pre-write eventCount projection conflict residuals`）仅修改测试，补齐 **任何 durable publish 之前** session manifest `eventCount` 落后于 durable event files 的 projection conflict residual：`loadForOutcomeReconciliation`（`repairManifest=false`）fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；lagging manifest 原样保留。无生产语义改动。

### S158 tests-only evidence：commit pre-write advanced eventCount projection conflict residual

`c054d4c` 同提交补齐 **任何 durable publish 之前** session manifest `eventCount` 超过 durable event files 的 projection conflict residual：同样 fail closed → `conflict/review_required`；不调用 evaluator；无 durable publish residual。无生产语义改动。

### S159 tests-only evidence：commit pre-write active session non-null outcomeRef residual

`8fe9df7`（`test(data): cover pre-write session manifest identity residuals`）仅修改测试，补齐 **任何 durable publish 之前** active `session.json` 携带 non-null `outcomeRef` 的 identity residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S160 tests-only evidence：commit pre-write session version-behind-canonical-facts residual

`8fe9df7` 同提交补齐 **任何 durable publish 之前** `session.json` `version` 落后于 `1 + eventCount` 的 identity residual：同样 fail closed → `conflict/review_required`；不调用 evaluator；无 durable publish residual。无生产语义改动。

### S161 tests-only evidence：commit pre-write active session non-null completedAt residual

`e7d86d0`（`test(data): cover pre-write session manifest parse residuals`）仅修改测试，补齐 **任何 durable publish 之前** active `session.json` 携带 non-null `completedAt` 的 identity residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S162 tests-only evidence：commit pre-write malformed session.json residual

`e7d86d0` 同提交补齐 **任何 durable publish 之前** malformed `session.json` JSON residual：同样 fail closed → `conflict/review_required`；不调用 evaluator；malformed bytes 原样保留；无 durable publish residual。无生产语义改动。

### S163 tests-only evidence：commit pre-write completed session missing completedAt residual

`3538b00`（`test(data): cover pre-write completed-missing-completedAt and schema residuals`）仅修改测试，补齐 **任何 durable publish 之前** `status: completed` 但 `completedAt: null`（且 `outcomeRef: null`）的 identity residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S164 tests-only evidence：commit pre-write unsupported session schemaVersion residual

`3538b00` 同提交补齐 **任何 durable publish 之前** unsupported `schemaVersion: 2` residual：`parseManifest` 经 `unknown_session_schema` → `corrupt_session` fail closed → `conflict/review_required`；不调用 evaluator；corrupt manifest 原样保留；无 durable publish residual。无生产语义改动。

### S165 tests-only evidence：commit pre-write completed session missing outcomeRef residual

`e28cce4`（`test(data): cover pre-write completed-missing-outcomeRef and timestamp residuals`）仅修改测试，补齐 **任何 durable publish 之前** `status: completed` 且 valid `completedAt` 但 `outcomeRef: null` 的 identity residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S166 tests-only evidence：commit pre-write session updatedAt-precedes-createdAt residual

`e28cce4` 同提交补齐 **任何 durable publish 之前** `updatedAt < createdAt` timestamp residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；corrupt manifest 原样保留；无 durable publish residual。无生产语义改动。

### S167 tests-only evidence：commit pre-write session completedAt-before-createdAt residual

`755628b`（`test(data): cover pre-write completedAt window and invalid status residuals`）仅修改测试，补齐 **任何 durable publish 之前** completed `session.json` 的 `completedAt < createdAt` window residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S168 tests-only evidence：commit pre-write invalid session status residual

`755628b` 同提交补齐 **任何 durable publish 之前** invalid `status: legacy_read_only` residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；corrupt manifest 原样保留；无 durable publish residual。无生产语义改动。

### S169 tests-only evidence：commit pre-write session.json directory residual

`a695f3e`（`test(data): cover pre-write session.json directory and symlink residuals`）仅修改测试，补齐 **任何 durable publish 之前** `session.json` 为 directory 的 type residual：`readStableRegularFile` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；directory residual 原样保留。无生产语义改动。

### S170 tests-only evidence：commit pre-write session.json non-file symlink residual

`a695f3e` 同提交补齐 **任何 durable publish 之前** `session.json` 为 non-file symlink 的 type residual：同样 fail closed → `conflict/review_required`；不调用 evaluator；symlink residual 原样保留；无 durable publish residual。无生产语义改动。

### S171 tests-only evidence：commit pre-write session id-directory mismatch residual

`cbf8ae9`（`test(data): cover pre-write session id mismatch and identity flag residuals`）仅修改测试，补齐 **任何 durable publish 之前** `session.json` `id` 与 directory 不一致的 identity residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S172 tests-only evidence：commit pre-write invalid canonical identity flags residual

`cbf8ae9` 同提交补齐 **任何 durable publish 之前** `source: legacy_lesson` / `readOnly: true` identity residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；corrupt manifest 原样保留；无 durable publish residual。无生产语义改动。

### S173 tests-only evidence：commit pre-write session completedAt-after-updatedAt residual

`169fa85`（`test(data): cover pre-write completedAt-after-updatedAt and non-object residuals`）仅修改测试，补齐 **任何 durable publish 之前** completed `session.json` 的 `completedAt > updatedAt` window residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S174 tests-only evidence：commit pre-write non-object session.json residual

`169fa85` 同提交补齐 **任何 durable publish 之前** well-formed JSON array（non-object）`session.json` residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；non-object bytes 原样保留；无 durable publish residual。无生产语义改动。

### S175 tests-only evidence：commit pre-write conversationRefs-not-array residual

`0453921`（`test(data): cover pre-write conversationRefs and unknown-key residuals`）仅修改测试，补齐 **任何 durable publish 之前** `conversationRefs` 非数组 residual：`parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；corrupt manifest 原样保留。无生产语义改动。

### S176 tests-only evidence：commit pre-write unknown session manifest key residual

`0453921` 同提交补齐 **任何 durable publish 之前** unknown top-level key residual：`assertOnlyKeys` → `parseManifest` fail closed → `conflict/review_required`；不调用 evaluator；corrupt manifest 原样保留；无 durable publish residual。无生产语义改动。

### S177 tests-only evidence：commit pre-write malformed durable session event JSON residual

`b4654c6`（`test(data): cover pre-write durable event JSON and filename residuals`）仅修改测试，补齐 **任何 durable publish 之前** durable event file malformed JSON residual：`readAndParseEvent` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；malformed event bytes 原样保留。无生产语义改动。

### S178 tests-only evidence：commit pre-write durable session event filename/eventId mismatch residual

`b4654c6` 同提交补齐 **任何 durable publish 之前** event filename ≠ `sha256(eventId).json` residual：`readSessionEvents` fail closed → `conflict/review_required`；不调用 evaluator；mismatched event bytes 原样保留；无 durable publish residual。无生产语义改动。

### S179 tests-only evidence：commit pre-write non-object durable session event JSON residual

`41971be`（`test(data): cover pre-write event non-object and sessionId mismatch residuals`）仅修改测试，补齐 **任何 durable publish 之前** well-formed JSON array（non-object）event residual：`parseEvent` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；non-object event bytes 原样保留。无生产语义改动。

### S180 tests-only evidence：commit pre-write durable session event sessionId mismatch residual

`41971be` 同提交补齐 **任何 durable publish 之前** event body `sessionId` 与 owning directory 不一致 residual：`parseEvent` fail closed → `conflict/review_required`；不调用 evaluator；corrupt event bytes 原样保留；无 durable publish residual。无生产语义改动。

### S181 tests-only evidence：commit pre-write unknown session events-directory entry residual

`50a19b3`（`test(data): cover pre-write unknown event entry and event-directory residuals`）仅修改测试，补齐 **任何 durable publish 之前** events directory 含 unknown/non-canonical entry residual：`readSessionEvents` fail closed → `conflict/review_required`；不调用 evaluator；record/outcome/marker 均不存在；unknown entry 原样保留。无生产语义改动。

### S182 tests-only evidence：commit pre-write durable session event path-as-directory residual

`50a19b3` 同提交补齐 **任何 durable publish 之前** durable event path 为 directory residual：`readSessionEvents` fail closed → `conflict/review_required`；不调用 evaluator；directory residual 原样保留；无 durable publish residual。无生产语义改动。


### S183 tests-only evidence：commit pre-write durable session event unknown-key residual

`40acf50`（`test(data): cover pre-write event unknown-key and event-symlink residuals`）补齐 **任何 durable publish 之前** durable session event body 携带 unknown key residual：`readSessionEvents` / event parse fail closed → `conflict/review_required`；不调用 evaluator；poison event bytes 原样保留；record/outcome/marker 均为 `ENOENT`；无 durable publish residual。无生产语义改动。

### S184 tests-only evidence：commit pre-write durable session event path non-file symlink residual

`40acf50` 同提交补齐 **任何 durable publish 之前** durable session event path 为 non-file symlink residual：`readSessionEvents` fail closed → `conflict/review_required`；不调用 evaluator；symlink residual 原样保留；record/outcome/marker 均为 `ENOENT`；无 durable publish residual。无生产语义改动。

### S185 tests-only evidence：commit pre-write durable session event unsupported schemaVersion residual

`961a832`（`test(data): cover pre-write event schemaVersion and kind residuals`）补齐 **任何 durable publish 之前** durable session event unsupported `schemaVersion` residual：`parseEvent` / `normalizeEventInput` fail closed → `conflict/review_required`；不调用 evaluator；poison event bytes 原样保留；record/outcome/marker 均为 `ENOENT`；无 durable publish residual。无生产语义改动。

### S186 tests-only evidence：commit pre-write durable session event unsupported kind residual

`961a832` 同提交补齐 **任何 durable publish 之前** durable session event unsupported `kind` residual：`parseEvent` / `normalizeEventInput` fail closed → `conflict/review_required`；不调用 evaluator；poison event bytes 原样保留；record/outcome/marker 均为 `ENOENT`；无 durable publish residual。无生产语义改动。

### S187 tests-only evidence：commit pre-write durable session event non-object payload residual

`d9d368d`（`test(data): cover pre-write event payload and traceId residuals`）补齐 **任何 durable publish 之前** durable session event non-object `payload` residual：`parseEvent` / `normalizeEventInput` fail closed → `conflict/review_required`；不调用 evaluator；poison event bytes 原样保留；record/outcome/marker 均为 `ENOENT`；无 durable publish residual。无生产语义改动。

### S188 tests-only evidence：commit pre-write durable session event malformed present traceId residual

`d9d368d` 同提交补齐 **任何 durable publish 之前** durable session event malformed present `traceId` residual：persisted path must not reclassify damaged trace as trace-free；fail closed → `conflict/review_required`；不调用 evaluator；poison event bytes 原样保留；record/outcome/marker 均为 `ENOENT`；无 durable publish residual。无生产语义改动。

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

任何后续 P6 切片都必须先单独获得 scope / owner / API 批准，并明确其与 S1 的关系；不得借 S1 直接扩大为自动 repair、删除、rollback、迁移或外部接口改动。没有获得这类批准和完整验证前，路线图只能表述为：**“C-4P6-S1 implemented; C-4P6-S2 tests-only evidence for `after_outcome_publish` recorded; C-4P6-S3 tests-only evidence for settlement-marker final rename `EIO` recorded; C-4P6-S4 tests-only evidence for settled recovery after `after_settlement_marker` recorded; C-4P6-S5 tests-only evidence for settled recovery after `before_catalog_reconcile` recorded; C-4P6-S6 tests-only evidence for fail-closed recovery after `after_stage_flush` recorded; C-4P6-S7 tests-only evidence for authority-first repaired recovery after `after_record_publish` recorded; C-4P6-S8 tests-only evidence for malformed settlement marker fail-closed residual recorded; C-4P6-S9 tests-only evidence for conflicting outcome.json vs record authority fail-closed residual recorded; C-4P6-S10 tests-only evidence for conflicting completed session outcomeRef fail-closed residual recorded; C-4P6-S11 tests-only evidence for invalid non-file outcome.json symlink fail-closed residual recorded; C-4P6-S12 tests-only evidence for invalid non-file settlement-marker symlink fail-closed residual recorded; C-4P6-S13 tests-only evidence for invalid non-file session.json manifest symlink fail-closed residual recorded; C-4P6-S14/S15/S16 tests-only evidence for invalid outcome/marker/manifest directory fail-closed residual recorded; C-4P6-S17 tests-only evidence for invalid canonical learning-record directory fail-closed residual recorded; C-4P6-S18 tests-only evidence for invalid non-file canonical learning-record symlink fail-closed residual recorded; C-4P6-S19 tests-only evidence for invalid canonical learning-record content fail-closed residual recorded; C-4P6-S20 tests-only evidence for well-formed invalid settlement marker fail-closed residual recorded; C-4P6-S21 tests-only evidence for well-formed invalid canonical learning-record metadata fail-closed residual recorded; C-4P6-S22 tests-only evidence for well-formed invalid canonical learning-record metadata identity fail-closed residual recorded; C-4P6-S23/S24/S25/S26/S27/S28/S29/S30/S31/S32 tests-only residual evidence recorded through non-integer evaluatorVersion; C-4P6-S33 tests-only residual evidence for non-writing canonical learning-record outcomeKind residual recorded; C-4P6-S34 tests-only residual evidence for needs_practice canonical learning-record outcomeKind residual recorded; C-4P6-S35 tests-only residual evidence for unknown canonical learning-record outcomeKind residual recorded; C-4P6-S36 tests-only residual evidence for negative canonical learning-record evaluatorVersion residual recorded; C-4P6-S37 tests-only residual evidence for empty canonical learning-record outcomeId residual recorded; C-4P6-S38 tests-only residual evidence for 64-char non-hex assessment contentSha256 residual recorded; C-4P6-S39 tests-only residual evidence for null assessment residual recorded; C-4P6-S40 tests-only residual evidence for 64-char uppercase-hex assessment contentSha256 residual recorded; C-4P6-S41 tests-only residual evidence for non-array evidenceEventIds residual recorded; C-4P6-S42 tests-only residual evidence for blank evidenceEventIds item residual recorded; C-4P6-S43 tests-only residual evidence for empty recordId residual recorded; C-4P6-S44 tests-only residual evidence for empty operationId residual recorded; C-4P6-S45 tests-only residual evidence for array assessment residual recorded; C-4P6-S46 tests-only residual evidence for missing assessment key residual recorded; C-4P6-S47 tests-only residual evidence for non-string evidenceEventIds item residual recorded; C-4P6-S48 tests-only residual evidence for whitespace-only evidenceEventIds item residual recorded; C-4P6-S49 tests-only residual evidence for whitespace-only outcomeId residual recorded; C-4P6-S50 tests-only residual evidence for boolean assessment residual recorded; C-4P6-S51 tests-only residual evidence for whitespace-only operationId residual recorded; C-4P6-S52 tests-only residual evidence for number assessment residual recorded; C-4P6-S53 tests-only residual evidence for whitespace-only recordId residual recorded; C-4P6-S54 tests-only residual evidence for string assessment residual recorded; C-4P6-S55 tests-only residual evidence for whitespace-only sessionId residual recorded; C-4P6-S56 tests-only residual evidence for whitespace-only assessment relativePath residual recorded; C-4P6-S57 tests-only residual evidence for missing assessment contentSha256 key residual recorded; C-4P6-S58 tests-only residual evidence for null evidenceEventIds item residual recorded; C-4P6-S59 tests-only residual evidence for missing assessment relativePath key residual recorded; C-4P6-S60 tests-only residual evidence for empty assessment contentSha256 residual recorded; C-4P6-S61 tests-only residual evidence for missing schemaVersion key residual recorded; C-4P6-S62 tests-only residual evidence for empty-object assessment residual recorded; C-4P6-S63 tests-only residual evidence for missing outcomeId key residual recorded; C-4P6-S64 tests-only residual evidence for missing operationId key residual recorded; C-4P6-S65 tests-only residual evidence for missing sessionId key residual recorded; C-4P6-S66 tests-only residual evidence for missing evidenceEventIds key residual recorded; C-4P6-S67 tests-only residual evidence for missing evaluatorVersion key residual recorded; C-4P6-S68 tests-only residual evidence for missing outcomeKind key residual recorded; C-4P6-S69 tests-only residual evidence for missing recordId key residual recorded; C-4P6-S70 tests-only residual evidence for null schemaVersion residual recorded; C-4P6-S71 tests-only residual evidence for string schemaVersion residual recorded; C-4P6-S72 tests-only residual evidence for whitespace-only assessment contentSha256 residual recorded; C-4P6-S73 tests-only residual evidence for boolean schemaVersion residual recorded; C-4P6-S74 tests-only residual evidence for null assessment contentSha256 residual recorded; C-4P6-S75 tests-only residual evidence for non-integer numeric schemaVersion residual recorded; C-4P6-S76 tests-only residual evidence for null assessment relativePath residual recorded; C-4P6-S77 tests-only residual evidence for number assessment contentSha256 residual recorded; C-4P6-S78 tests-only residual evidence for boolean assessment relativePath residual recorded; C-4P6-S79 tests-only residual evidence for boolean assessment contentSha256 residual recorded; C-4P6-S80 tests-only residual evidence for number assessment relativePath residual recorded; C-4P6-S81 tests-only residual evidence for short lowercase-hex assessment contentSha256 residual recorded; C-4P6-S82 tests-only residual evidence for array schemaVersion residual recorded; C-4P6-S83 tests-only residual evidence for long lowercase-hex assessment contentSha256 residual recorded; C-4P6-S84 tests-only residual evidence for object schemaVersion residual recorded; C-4P6-S85 tests-only residual evidence for leading metadata garbage residual recorded; C-4P6-S86 tests-only residual evidence for missing metadata suffix residual recorded; C-4P6-S87 tests-only residual evidence for malformed metadata JSON residual recorded; C-4P6-S88 tests-only residual evidence for missing newline after metadata suffix residual recorded; C-4P6-S89 tests-only residual evidence for null outcomeId residual recorded; C-4P6-S90 tests-only residual evidence for false schemaVersion residual recorded; C-4P6-S91 tests-only residual evidence for null operationId residual recorded; C-4P6-S92 tests-only residual evidence for null sessionId residual recorded; C-4P6-S93 tests-only residual evidence for null recordId residual recorded; C-4P6-S94 tests-only residual evidence for number outcomeId residual recorded; C-4P6-S95 tests-only residual evidence for number operationId residual recorded; C-4P6-S96 tests-only residual evidence for boolean sessionId residual recorded; C-4P6-S97 tests-only residual evidence for null outcomeKind residual recorded; C-4P6-S98 tests-only residual evidence for missing body after metadata residual recorded; C-4P6-S99 tests-only residual evidence for empty-file learning-record residual recorded; C-4P6-S100 tests-only residual evidence for number outcomeKind residual recorded; C-4P6-S101 tests-only residual evidence for null settlement-marker outcomeId residual recorded; C-4P6-S102 tests-only residual evidence for array settlement-marker residual recorded; C-4P6-S103 tests-only residual evidence for null settlement-marker operationId residual recorded; C-4P6-S104 tests-only residual evidence for settlement-marker record-presence mismatch residual recorded; C-4P6-S105 tests-only residual evidence for null settlement-marker sessionId residual recorded; C-4P6-S106 tests-only residual evidence for empty settlement-marker evidence for writing kind residual recorded; C-4P6-S107 tests-only residual evidence for null settlement-marker evaluatorVersion residual recorded; C-4P6-S108 tests-only residual evidence for settlement-marker record identity mismatch residual recorded; C-4P6-S109 tests-only residual evidence for non-canonical settlement-marker operationId residual recorded; C-4P6-S110 tests-only residual evidence for invalid settlement-marker record contentSha256 residual recorded; C-4P6-S111 tests-only residual evidence for settlement-marker record relativePath mismatch residual recorded; C-4P6-S112 tests-only residual evidence for non-array settlement-marker evidenceEventIds residual recorded; C-4P6-S113 tests-only residual evidence for null settlement-marker kind residual recorded; C-4P6-S114 tests-only residual evidence for array settlement-marker record residual recorded; C-4P6-S115 tests-only residual evidence for non-string settlement-marker evidenceEventIds item residual recorded; C-4P6-S116 tests-only residual evidence for unknown settlement-marker kind residual recorded; C-4P6-S117 tests-only residual evidence for missing settlement-marker record contentSha256 key residual recorded; C-4P6-S118 tests-only residual evidence for whitespace-only settlement-marker evidenceEventIds item residual recorded; C-4P6-S119 tests-only residual evidence for zero settlement-marker evaluatorVersion residual recorded; C-4P6-S120 tests-only residual evidence for missing settlement-marker record relativePath key residual recorded; C-4P6-S121 tests-only residual evidence for missing settlement-marker record recordId key residual recorded; C-4P6-S122 tests-only residual evidence for null settlement-marker record contentSha256 residual recorded; C-4P6-S123 tests-only residual evidence for non-writing settlement-marker kind with record residual recorded; C-4P6-S124 tests-only residual evidence for missing settlement-marker schemaVersion key residual recorded; C-4P6-S125 tests-only residual evidence for null settlement-marker schemaVersion residual recorded; C-4P6-S126 tests-only residual evidence for missing settlement-marker evidenceEventIds key residual recorded; C-4P6-S127 tests-only residual evidence for Windows device-name settlement-marker sessionId residual recorded; C-4P6-S128 tests-only residual evidence for missing settlement-marker outcomeId key residual recorded; C-4P6-S129 tests-only residual evidence for durable stage write fail-closed residual recorded; C-4P6-S130 tests-only residual evidence for durable stage sync fail-closed residual recorded; C-4P6-S131 tests-only residual evidence for durable stage open fail-closed residual recorded; C-4P6-S132 tests-only residual evidence for durable stage close fail-closed residual recorded; C-4P6-S133 tests-only residual evidence for durable stage mkdir EIO fail-closed residual recorded; C-4P6-S134 tests-only residual evidence for durable stage mkdir ENOSPC fail-closed residual recorded; C-4P6-S135 tests-only residual evidence for durable record-parent mkdir EIO fail-closed residual recorded; C-4P6-S136 tests-only residual evidence for durable record-parent mkdir ENOSPC fail-closed residual recorded; C-4P6-S137 tests-only residual evidence for durable outcome temp open fail-closed residual recorded; C-4P6-S138 tests-only residual evidence for durable outcome temp write fail-closed residual recorded; C-4P6-S139 tests-only residual evidence for durable outcome temp sync fail-closed residual recorded; C-4P6-S140 tests-only residual evidence for durable outcome temp close fail-closed residual recorded; C-4P6-S141 tests-only residual evidence for durable marker temp open fail-closed residual recorded; C-4P6-S142 tests-only residual evidence for durable marker temp write fail-closed residual recorded; C-4P6-S143 tests-only residual evidence for durable marker temp sync fail-closed residual recorded; C-4P6-S144 tests-only residual evidence for durable marker temp close fail-closed residual recorded; C-4P6-S145 tests-only residual evidence for durable outcome post-rename directory open fail-closed residual recorded; C-4P6-S146 tests-only residual evidence for durable marker post-rename directory open fail-closed residual recorded; C-4P6-S147 tests-only residual evidence for durable marker post-rename directory sync fail-closed residual recorded; C-4P6-S148 tests-only residual evidence for durable marker post-rename directory close fail-closed residual recorded; C-4P6-S149 tests-only residual evidence for ledger complete after_state_loaded fail-closed residual recorded; C-4P6-S150 tests-only residual evidence for ledger complete after_stage_sync fail-closed residual recorded; C-4P6-S151 tests-only residual evidence for ledger complete after_file_stat pre-write fail-closed residual recorded; C-4P6-S152 tests-only residual evidence for ledger complete after_file_stat post-write fail-closed residual recorded; C-4P6-S153 tests-only residual evidence for ledger complete after_file_stat on session.json load fail-closed residual recorded; C-4P6-S154 tests-only residual evidence for ledger complete after_file_stat on session event load fail-closed residual recorded; C-4P6-S155 tests-only residual evidence for commit pre-write after_writer_lock_acquired fail-closed residual recorded; C-4P6-S156 tests-only residual evidence for commit pre-write repair after_file_stat on session.json fail-closed residual recorded; C-4P6-S157 tests-only residual evidence for commit pre-write lagging eventCount projection conflict residual recorded; C-4P6-S158 tests-only residual evidence for commit pre-write advanced eventCount projection conflict residual recorded; C-4P6-S159 tests-only residual evidence for commit pre-write active session non-null outcomeRef residual recorded; C-4P6-S160 tests-only residual evidence for commit pre-write session version-behind-canonical-facts residual recorded; C-4P6-S161 tests-only residual evidence for commit pre-write active session non-null completedAt residual recorded; C-4P6-S162 tests-only residual evidence for commit pre-write malformed session.json residual recorded; C-4P6-S163 tests-only residual evidence for commit pre-write completed session missing completedAt residual recorded; C-4P6-S164 tests-only residual evidence for commit pre-write unsupported session schemaVersion residual recorded; C-4P6-S165 tests-only residual evidence for commit pre-write completed session missing outcomeRef residual recorded; C-4P6-S166 tests-only residual evidence for commit pre-write session updatedAt-precedes-createdAt residual recorded; C-4P6-S167 tests-only residual evidence for commit pre-write session completedAt-before-createdAt residual recorded; C-4P6-S168 tests-only residual evidence for commit pre-write invalid session status residual recorded; C-4P6-S169 tests-only residual evidence for commit pre-write session.json directory residual recorded; C-4P6-S170 tests-only residual evidence for commit pre-write session.json non-file symlink residual recorded; C-4P6-S171 tests-only residual evidence for commit pre-write session id-directory mismatch residual recorded; C-4P6-S172 tests-only residual evidence for commit pre-write invalid canonical identity flags residual recorded; C-4P6-S173 tests-only residual evidence for commit pre-write session completedAt-after-updatedAt residual recorded; C-4P6-S174 tests-only residual evidence for commit pre-write non-object session.json residual recorded; C-4P6-S175 tests-only residual evidence for commit pre-write conversationRefs-not-array residual recorded; C-4P6-S176 tests-only residual evidence for commit pre-write unknown session manifest key residual recorded; C-4P6-S177 tests-only residual evidence for commit pre-write malformed durable session event JSON residual recorded; C-4P6-S178 tests-only residual evidence for commit pre-write durable session event filename/eventId mismatch residual recorded; C-4P6-S179 tests-only residual evidence for commit pre-write non-object durable session event JSON residual recorded; C-4P6-S180 tests-only residual evidence for commit pre-write durable session event sessionId mismatch residual recorded; C-4P6-S181 tests-only residual evidence for commit pre-write unknown session events-directory entry residual recorded; C-4P6-S182 tests-only residual evidence for commit pre-write durable session event path-as-directory residual recorded; C-4P6-S183 tests-only residual evidence for commit pre-write durable session event unknown-key residual recorded; C-4P6-S184 tests-only residual evidence for commit pre-write durable session event path non-file symlink residual recorded; C-4P6-S185 tests-only residual evidence for commit pre-write durable session event unsupported schemaVersion residual recorded; C-4P6-S186 tests-only residual evidence for commit pre-write durable session event unsupported kind residual recorded; C-4P6-S187 tests-only residual evidence for commit pre-write durable session event non-object payload residual recorded; C-4P6-S188 tests-only residual evidence for commit pre-write durable session event malformed present traceId residual recorded; full P6 close-out remains pending.”**
