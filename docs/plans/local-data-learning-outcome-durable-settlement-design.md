# C-4P6 Learning outcome durable settlement：设计门（未实施）

> **状态：仅 design gate / 只读审计结论。**本文不实现、不批准也不宣称完成 learning-outcome settlement 的 durable migration；不改代码、测试、canonical schema 或既有结果语义。C-4 仍只是部分 consumer 的逐项迁移，C-4P6 只为未来获得批准后的单独实现切片建立安全门槛。

## 1. 范围与当前审计结论

本设计针对 evaluator-derived Learning outcome 的主进程写入链：stage、immutable Learning record、session `outcome.json`、Learning Session manifest、operation settlement marker，以及最终 catalog read。它不把 catalog 当作 canonical settlement authority，也不把这些多个文件称为 atomic transaction。

只读审计发现，当前 `src/main/learning-outcome-committer.ts` 仍有本地耐久 helper，而非已批准的 shared `replaceDurably()` adoption：

- `durableAtomicReplace()` 在 rename 后调用本地 `syncDirectory()`；后者会吞掉 directory open 与 sync 错误。因此在支持 directory fsync 的平台上，失败可能被当作成功继续。
- `publishImmutable()` 在 link、parent directory sync 或 stage cleanup 抛错后，若最终 record bytes 恰好可读且匹配预期内容，会返回成功；这也可能吞掉 **post-link** 的 directory durability failure。
- 上述是**审计风险**，不是本设计门已经修复的行为，也不是 C-4P6 已迁移、已测试或已具备 durable closure 的证据。

未来实现必须保留既有 schema、canonical path、reader compatibility 与 `0600` file-mode 契约，除非另一个经过批准的设计明确改变它们。

## 2. Canonical authority 与幂等性边界

未来 reconciliation/commit 的 authority 必须按 record 分支是否存在严格分开：

| 情形 | 规范 authority（由高到低） | 不得作为 authority 的内容 |
|---|---|---|
| **会写 immutable Learning record 的分支** | immutable Learning record → `outcome.json` + manifest → settlement marker | catalog presence、stage 文件、仅 marker |
| **不会写 record 的分支** | settlement marker 是唯一的 operation settlement / idempotency authority | catalog read、缺失的 record、manifest 单独状态 |

含义如下：

- 有 record 时，immutable record 是恢复与冲突判断的第一事实；`outcome.json` 与 manifest 是其 session projection；marker 用于 operation identity/settlement projection，不能反过来覆盖有效 record。
- 无 record 时，不得从 catalog、`outcome.json` 或 manifest 猜测“已 settled”；仅有效 marker 可证明 operation settlement 并支撑 idempotency。
- catalog 仅在全部必要 canonical publish 已完成后读取，用于返回已有可见性事实；它不授权 commit、repair 或成功结果。

### 已指定的 completed-manifest 异常路径（设计决定）

若 manifest 已显示 completed、`outcome.json` 缺失或损坏、但存在有效 immutable record，则未来批准的实现采用 **record-first controlled repair**：先校验 record 与 session/outcome identity、内容与路径约束一致，再受控地重建 `outcome.json`、完成 manifest projection，并补齐 marker。若任一校验失败、存在冲突 marker，或 repair 不能证明安全性，结果固定为 `review_required`。

这是一项**设计决定**；它禁止把该状态留作未定义异常，也不授权泛化的自动覆盖、删除或回滚。

## 3. 推荐的有序 publish 模型（待批准）

推荐未来仅在同一受控 commit/reconcile scope 内按以下顺序推进：

1. **stage durable publish**；
2. **immutable record durable publish**；
3. **`outcome.json` durable publish**；
4. **manifest completion**；
5. **settlement marker durable publish**；
6. **catalog read**。

这是具有明确可恢复点的**有序协议，不是多文件事务**：不能承诺共同原子性、post-rename rollback 或任意跨文件锁定。每一项 canonical write 只有在前一项成功并确认后才可继续；catalog read 永远排在最后。

对于无-record 分支，stage/record/outcome/manifest 步骤不应被虚构执行；marker durable publish 是唯一 settlement/idempotency write，之后才可 catalog read 与返回既有成功语义。

## 4. Durable failure、降级与 immutable-record 闭环

未来批准的实现必须使用 shared durable primitive 或经同等审查的共享能力，并遵守：

- 在支持该能力的平台上，任何 write、file fsync、file close、rename/link、parent directory open/sync/close 的 durable failure，均**不得**返回 `committed` 或 `insufficient_evidence`，也不得继续后续 canonical write。
- rename/link 后若最终 bytes 已存在，文件可作为 complete-but-unacknowledged 留存；不得自动 rollback、删除或覆盖。调用方应返回既有 retryable / reconciliation result，由下一次受控 reconcile 处理。
- 仅 shared directory capability allowlist 的五个 code 可降级：`EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR`。降级 warning 必须通用且不带 path、record ID、内容或 hash。其它 permission、I/O、unknown 与 close error 都 fatal。
- immutable record 在 link 成功后若 parent directory fsync/open/close 失败，失败必须向上传播；**不得**仅因最终 bytes 可读而吞错。此要求必须纳入未来同一 scope；若只迁移 overwrite writer，则该切片只能称为 *overwrite adoption*，绝不可称为 settlement durable closure。

## 5. Owner、并发与恢复设计门槛

`outcome.json` owner 与 ledger/manifest writer lock 目前没有获得批准的统一方案。实施前必须作出明确、可测试的设计选择：同一 session 的 outcome publish、manifest completion、marker repair 由谁串行化，以及该 lock 的生命周期与 crash 后释放语义。不得把单 writer、queue 或 lock 的存在误写成多文件 atomic transaction。

恢复必须以 authority 表驱动，而非凭“最后一个存在的文件”猜测。特别是：

- record 分支发现有效 record 时，优先进入 record-first reconciliation；必要 projection 的 repair 必须受控、幂等且不覆盖冲突 identity；
- 无-record 分支以 marker operation ID 进行幂等判定；缺 marker 不能冒充已 settlement；
- marker、outcome、manifest、record 互相矛盾、损坏或越界时，返回既有 retryable/reconciliation result 或 `review_required`，而不是继续 canonical write；
- stage cleanup 仅能在 authority/recovery 判定后进行，不能用 cleanup 掩盖未确认 publish。

## 6. 批准后才可实施的测试矩阵

代码获批前不新增测试。本设计要求未来实现提供窄的 I/O injection seam，覆盖真实 durable operations 的顺序、错误传播与不泄漏 warning；至少包括：

| 测试类别 | 最低验证 |
|---|---|
| `outcome.json` | pre-rename 与 post-rename directory failure、file/dir close failure、旧 bytes 与 temp cleanup、不会继续 manifest/marker、不会返回 `committed` / `insufficient_evidence` |
| 能力降级 | 仅 `EINVAL` / `ENOSYS` / `ENOTSUP` / `EOPNOTSUPP` / `EISDIR` 成功降级且 warning 无 path；其余错误 fatal |
| 无-record settlement | marker durable success 才幂等；marker failure 不返回成功；重复 operation 的 marker idempotency |
| record-marker repair | valid record 的 marker repair、冲突 marker → `review_required`、marker 不得压过 record authority |
| immutable record | link 后 parent directory failure 必须阻断 outcome/manifest/marker；不能因 record bytes 可读吞错 |
| crash windows | `after_stage_flush`、`after_record_publish`、`after_outcome_publish`、`after_settlement_marker`、`before_catalog_reconcile` 后重启/reconcile 的确定性结果 |
| corrupt state | completed manifest + missing/corrupt outcome + valid record 的 record-first controlled repair；不能安全校验时 `review_required` |
| compatibility | schema、canonical path、`0600` mode、reader compatibility 与不泄漏 path/record ID/content/hash 的 warning/log 行为 |

这些是未来 acceptance criteria，而非本次已运行的测试或通过证据。

## 7. 批准前的边界

C-4P6 不授权代码迁移、canonical rewrite、自动 repair、删除、retention 改动或新的外部交互面。只有在 owner/lock 决策、shared primitive capability、authority/reconciliation contract、I/O seam 与上述测试矩阵均被明确批准后，才可拆出一个新的、受限 implementation slice；在此之前，路线图与实施计划只登记 **“C-4P6 design gate recorded / next approved follow-up”**。
