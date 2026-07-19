# C-4P6 Learning outcome durable settlement：S1 已实施，S2/S3/S4/S5 tests-only evidence 已补，完整闭环仍待设计门

> **状态：C-4P6-S1 已实施，C-4P6-S2/S3/S4/S5 已完成 tests-only evidence；C-4P6 尚未完整关闭，仍是待办。**提交 `7292bf4`（`fix(data): harden learning outcome settlement`）和 `e02a086`（`test(data): cover outcome settlement durability`）实现的仅是“严格有序发布与受控恢复基础”；`9847842`（`test(data): cover outcome publish crash recovery`）仅补齐单一 `after_outcome_publish` crash window 的测试证据；`1334513`（`test(data): cover outcome marker recovery`）仅补齐 settlement-marker durable rename 返回 `EIO` 后的受限 restart/reconcile 测试证据；`e821c69`（`test(data): cover settled outcome recovery`）仅补齐已有 `after_settlement_marker` 的一个独立中断的 settled recovery 测试证据；`ebd084c`（`test(data): cover pre-catalog outcome recovery`）仅补齐已有 `before_catalog_reconcile` 的一个独立中断的 settled recovery 测试证据。本文记录该事实、剩余设计门和禁止越界的边界；它不把 S1 宣称为跨文件事务或共同原子性 或完整 durable closure。

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

## 4. S1/S2/S3/S4/S5 未关闭的 C-4P6 范围

C-4P6 因 manifest publisher 的 durability/capability-policy 尚未闭合、manifest `open` / `write` / `fsync` / `close` 的完整矩阵尚未验证，且除 S2 的 `after_outcome_publish`、S3 的 marker final rename `EIO` 、S4 的已有 `after_settlement_marker` settled recovery 与 S5 的已有 `before_catalog_reconcile` settled recovery 定向场景外的 crash / failure 矩阵尚未穷尽验证，必须继续作为不完整待办保留，直至未来获得批准并完成剩余 close-out。至少仍包括：

1. **manifest publisher capability-policy 对齐：**确认并落实 manifest publisher 与 shared durable capability 的策略边界，而不是从 S1 的 outcome / marker 行为外推。
2. **穷尽的 crash / failure 设计矩阵：**S1 测试不宣称覆盖所有 crash window、文件/目录 open-sync-close 组合、冲突与损坏状态；未来需要针对完整 scope 明确 acceptance criteria 和结果语义。
3. **运行验证：**完整 close-out 仍需实际运行 / 运维验证，而不是仅依据提交或有限单元、集成检查。

以下内容仍不在 S1/S2/S3/S4/S5 或本 design gate 的授权范围内：跨文件事务或共同原子性、rollback、删除、general migration、canonical rewrite、retention 改动，以及新的外部 API；S4/S5 也不是完整 catalog/manifest/crash matrix、operations validation 或 Windows native fsync/power-loss closure。C-4P8 和 C-4P9 也完全未受本切片改变。

## 5. 剩余设计矩阵（不是已通过证据）

未来 close-out 需单独批准范围、owner 与 API，并以不扩大 S1 的方式审查至少下列矩阵：

| 类别 | 剩余验证要求 |
|---|---|
| manifest capability-policy | manifest publisher 的 durable capability、allowlist、错误传播和与 S1 顺序的明确对齐 |
| crash windows | S2 仅提供 `after_outcome_publish` 的重启 / reconcile 定向证据；S3 仅提供 settlement-marker final rename 返回 `EIO` 后的 restart/reconcile 定向证据；S4 仅提供已有 `after_settlement_marker` interruption 后 restart `reconcile()` 为 `settled` 的定向证据；S5 仅提供已有 `before_catalog_reconcile` interruption 后 restart `reconcile()` 为 `settled` 的定向证据；这不等同于泛化 `after_manifest_publish`。`after_stage_flush`、`after_record_publish`、manifest `open` / `write` / `fsync` / `close` 及其它 failure combinations 仍待验证 |
| 失败传播 | write、file fsync、file close、rename / link、parent directory open / sync / close 与 cleanup failure 不得被成功结果掩盖 |
| authority / conflict | valid record 的受控 repair、冲突 marker / projection、corrupt 或越界状态均不覆盖且安全地进入既有 retryable / `review_required` 语义 |
| compatibility / operations | schema、canonical path、`0600` mode、reader compatibility、非敏感 warning / log，以及可操作的运行验证 |

该矩阵是未来 acceptance criteria；S2 仅关闭 `after_outcome_publish` 这一条定向 evidence，S3 仅关闭 marker final rename `EIO` 这一条定向 evidence，S4 仅关闭已有 `after_settlement_marker` settled recovery 这一条定向 evidence，S5 仅关闭已有 `before_catalog_reconcile` settled recovery 这一条定向 evidence，不是泛化 `after_manifest_publish`、完整 manifest failure matrix、生产功能或对 `7292bf4` / `e02a086` / `9847842` / `1334513` / `e821c69` / `ebd084c` 已经完全满足的声明。

## 6. 后续实施前边界

任何后续 P6 切片都必须先单独获得 scope / owner / API 批准，并明确其与 S1 的关系；不得借 S1 直接扩大为自动 repair、删除、rollback、迁移或外部接口改动。没有获得这类批准和完整验证前，路线图只能表述为：**“C-4P6-S1 implemented; C-4P6-S2 tests-only evidence for `after_outcome_publish` recorded; C-4P6-S3 tests-only evidence for settlement-marker final rename `EIO` recorded; C-4P6-S4 tests-only evidence for settled recovery after `after_settlement_marker` recorded; C-4P6-S5 tests-only evidence for settled recovery after `before_catalog_reconcile` recorded; full P6 close-out remains pending.”**
