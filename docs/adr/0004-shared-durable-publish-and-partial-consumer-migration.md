# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **状态：** 已实施（部分 consumer migration；包含 C-4P6-S1 的受限基础、C-4P6-S2/C-4P6-S3/C-4P6-S4/C-4P6-S5/C-4P6-S6/C-4P6-S7 tests-only evidence、C-4P8-S1/S2/S3 foundation、C-4P8-S4 受控 `write_workspace_file` 文本文件 create / restricted-overwrite closure、经明确批准的 Windows direct-path non-CAS profile，以及 C-4P9-S2 audit 专用 durable append、P9-S3/P9-S4/P9-S5/P9-S6/P9-S7/P9-S8 tests-only evidence）
- **范围：** C-4、C-4P0、C-4P1、C-4P2A、C-4P2B、C-4P3、C-4P4、C-4P5、C-4P6-S1、C-4P6-S2（tests-only evidence）、C-4P6-S3（tests-only evidence）、C-4P6-S4（tests-only evidence）、C-4P6-S5（tests-only evidence）、C-4P6-S6（tests-only evidence）、C-4P6-S7（tests-only evidence）、C-4P7、C-4P8-S1、C-4P8-S2、C-4P8-S3、C-4P8-S4、Windows direct-path non-CAS profile、C-4P9-S2、C-4P9-S3（tests-only evidence）、C-4P9-S4（tests-only evidence）、C-4P9-S5（tests-only evidence）、C-4P9-S6（tests-only evidence）、C-4P9-S7（tests-only evidence）、C-4P9-S8（tests-only evidence）
- **证据提交：** `ca73537`、`5c0dd96`、`34c48f4`、`b8eb3ab`、`70afe1d`、`99bf6fe`、`f8ad99c`、`278f141`、`7292bf4`、`e02a086`、`9847842`、`1334513`、`0d55fd8`、`80f2fd0`、`e2ce36c`、`b46c8b2`、`bdcd6cb`、`56eabe6`、`54506d5`、`ed8d88a`、`9c452f3`、`0bbfdef`、`e84c813`、`4b30220`、`5f47382`、`c286a42`、`ab723a6`、`47393f9`、`c97146e`、`e821c69`、`ebd084c`、`5f931c9`、`145b671`、`816e403`、`d26bb83`、`bee173f`

## 决定

以共享 durable-file capability 承担经过审查的关键文件 replace / publish 语义，并逐项迁移 consumer；每个 consumer 保留自身的 canonical authority、路径约束和错误语义。C-4 的完成含义是“共享原语及下列 consumer 已迁移”，**不是所有 writer 已迁移**，也不构成跨文件事务。

`C-4P6-S1` 已实施的范围仅为 **严格有序发布与受控恢复基础**。它不是完整的 C-4P6；不提供跨文件事务或共同原子性，也不构成完整 durable closure。

## 已迁移 consumer 与验证入口

| 切片 | 已迁移范围 | 主要验证入口 |
| --- | --- | --- |
| C-4P0 `5c0dd96` | canonical `.studiumx/progress.json` review publish | `tests/unit/teaching-workspace-review-durable.unit.test.ts` |
| C-4P1 `34c48f4` | conversation archive canonical JSON / Markdown publish | `tests/unit/agent-conversation-archive-durable.unit.test.ts` |
| C-4P2A `b8eb3ab` | workspace `MISSION.md` | `tests/unit/teaching-workspace-mission-durable.unit.test.ts` |
| C-4P2B `70afe1d` | workspace `assets/lesson.css` | `tests/unit/teaching-workspace-lesson-style-durable.unit.test.ts` |
| C-4P3 `99bf6fe` | cross-workspace change history `history.json` | `tests/unit/teaching-workspace-change-history-durable.unit.test.ts`、`tests/integration/teaching-workspace-change-audit.integration.test.ts` |
| C-4P4 `f8ad99c` | `.agent-sessions/session-open-state.v1.json` sidecar | `tests/unit/agent-conversation-session-tree-durable.unit.test.ts` |
| C-4P5 `278f141` | `TeachingWorkspaceDocuments` allowlisted workspace Markdown | `tests/unit/teaching-workspace-documents-durable.unit.test.ts`、`tests/integration/teaching-workspace-documents.integration.test.ts` |
| C-4P6-S1 `7292bf4`、`e02a086` | learning-outcome 的严格有序 publish、受控 reconcile 与失败关闭基础 | `tests/unit/learning-outcome-committer.unit.test.ts`、`tests/unit/teaching-workspace-outcome-commit.unit.test.ts`；相关提交覆盖 41 项单元检查和 14 项集成检查 |
| C-4P6-S2 `9847842` | **tests-only evidence**：仅覆盖单一 `after_outcome_publish` crash window 的重启恢复；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、28 tests passed；另通过 typecheck、security check、diff check |
| C-4P6-S3 `1334513` | **tests-only evidence**：现有 settlement-marker durable rename 返回 `EIO` 后，immutable record、`outcome.json` 与已 `completed` 的 manifest 存在而 marker 为 `ENOENT`；重启 reconcile 以 immutable record authority 仅发布 marker，evaluator / `createId` 不重跑，record/outcome/manifest 不重写；第二次 reconcile 与同 operation replay 的四份 canonical bytes 稳定。该提交只扩展同一个既有 unit `it`，不是新增 test count；无 production/API/schema/path/order 变化 | 同一 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；仍为 1 file、28 tests passed；另通过 typecheck、security check、diff check |
| C-4P6-S4 `e821c69` | **tests-only evidence**：新增独立 `it`，仅覆盖已有 `after_settlement_marker` 的一次中断；marker 的 canonical rename 在当前平台 capability policy 规定的 durable primitive 完成后可见，且未到达 `before_catalog_reconcile`；restart `reconcile()` 返回 `settled` 而不是 `repaired`，recovery 不调用 evaluator / `createId`，不产生 durable write / rename / publish，immutable record、outcome、completed manifest、marker 四份 canonical bytes 稳定；同 operation replay 返回 `already_committed`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、29 tests passed |
| C-4P6-S5 `ebd084c` | **tests-only evidence**：新增独立 `it`，仅覆盖已有 `before_catalog_reconcile` 的一次中断；`injectedPoints` 完整有序前缀为 `after_stage_flush` → `after_record_publish` → `after_outcome_publish` → `after_settlement_marker` → `before_catalog_reconcile`；初次 commit 返回 `retryable_failure/reconciliation_required` 且四份 durable 产物已存在；restart `reconcile()` 返回 `settled` 而不是 `repaired`，recovery 不调用 evaluator / `createId`，不产生 durable write / rename / publish，四份 canonical bytes 稳定；同 operation replay 返回 `already_committed`；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、30 tests passed |
| C-4P6-S6 `145b671` | **tests-only evidence**：新增独立 `it`，仅覆盖 `after_stage_flush` 中断；stage 保留而 record/outcome/marker 缺失，manifest 保持 active；restart reconcile 为 `pending` 且无 durable write；同 operation re-commit fail closed 于既有 exclusive stage，不 promote incomplete projections；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、31 tests passed |
| C-4P6-S7 `d26bb83` | **tests-only evidence**：新增独立 `it`，仅覆盖 `after_record_publish` 中断；immutable record 已存在而 outcome/marker 缺失、manifest 仍 active；restart `reconcile()` 返回 `repaired`（authority-first，不重跑 evaluator / `createId`），随后 manifest → marker；第二次 reconcile 为 `settled`，同 operation 为 `already_committed`，四份 canonical bytes 稳定；无 production/API/schema/path/order 变化 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；1 file、32 tests passed |
| C-4P7 `0d55fd8` | private `MusicCookieStore` cookie state | `tests/unit/music-cookie-store-durable.unit.test.ts` |
| C-4P8-S1 `80f2fd0`、`e2ce36c` | workspace descriptor foundation：可信既有 workspace root 绑定、descriptor-bound parent traversal 与 final-leaf inspection | 下列 C-4P8 最终定向验证 |
| C-4P8-S2 `b46c8b2`、`bdcd6cb` | internal descriptor-bound atomic `createNoOverwrite` foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S3 `56eabe6`、`54506d5` | internal descriptor-bound restricted-overwrite foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S4 `0bbfdef`、`e84c813` | 受控 `write_workspace_file` 文本文件 create / restricted-overwrite handler integration、稳定结果和同 toolCallId journal replay | `tests/unit/workspace-write-tool.unit.test.ts` 与下列最终定向验证 |
| C-4P9-S2 `4b30220`、`5f47382` | 固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append；不 rotation、不迁移其它 JSONL | 下列 C-4P9-S2/S3/S4 验证命令 |
| C-4P9-S3 `c286a42` | **tests-only historical evidence**：补齐 P9-S2 的 partial-write 与 archive-level failure/retry 定向证据：fixed-file non-rotating audit append 的 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动 | 2 个 unit 文件、61 tests passed；另有当时本主会话的 typecheck、security check、diff check |
| C-4P9-S4 `ab723a6` | **tests-only evidence**：仅覆盖 archive save 层首个 audit write 注入 `EIO`、audit 0 bytes 时的 short-circuit/retry；JSON/Markdown 保留、ledger 未执行，clean retry 后每个 canonical audit row 恰一条、ledger 恰一条；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、27 tests passed |
| C-4P9-S5 `47393f9` | **tests-only evidence**：仅修改测试，未修改 production code；Sol review approved。对 audit directory 与 conversation parent directory 的 `open`/`sync` 做 capability symmetry 定向证据：五个 allowlist code `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 各覆盖两层、两种操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 返回 `EINVAL` 仍 fatal；无 production/API/schema/order 变化 | 单独：`tests/unit/agent-conversation-session-audit.unit.test.ts`，1 file、51 tests passed；与 archive durable 共同运行，2 files、78 tests passed；另通过 typecheck、security check、diff check |
| C-4P9-S6 `5f931c9` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，加强 ledger-own failure residual：audit 在 ledger 失败后保留期望 header 与 canonical entry IDs 且不 rollback；retry 保持 exact audit bytes、不写 audit、恰一条 ledger 行；随后 idempotent save 保持 audit 与 ledger bytes 不变；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、27 tests passed |
| C-4P9-S7 `816e403` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 concurrent identical same-save residual：per-path queue 线性化，两路并发 append 同一 record 时仅一个 open lifecycle、一个 session header、entry IDs 唯一，exact bytes 与单次顺序 write 一致；无生产语义改动 | `tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、52 tests passed |
| C-4P9-S8 `bee173f` | **tests-only evidence**：仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 on-disk 同 identity 但 trace 分叉时 fail closed：throw `Conversation session audit contains divergent duplicate records.`，poisoned bytes 不变，无额外 write/rewrite；无生产语义改动 | `tests/unit/agent-conversation-session-audit.unit.test.ts`；1 file、53 tests passed |

共享原语和关键状态备份的验证也由 `tests/unit/durable-file.unit.test.ts` 覆盖。

## C-4P6-S2：outcome publish crash-recovery tests-only evidence

`9847842`（`test(data): cover outcome publish crash recovery`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，且 Sol final review approved；没有 production/API/schema/path/order 变化。它只覆盖单一 `after_outcome_publish` crash window，不是 manifest capability-policy alignment、其它 crash windows / failure matrix、跨文件 transaction、rollback/delete/migration/API/operations validation 或完整 C-4P6 closure。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；record 与 matching outcome 存在，manifest 为 `active` / `outcomeRef: null`，marker 缺失，且未继续 manifest、marker 或 catalog-success。
- 重启后的 reconcile 使用 immutable record authority，返回 `repaired`，不重新运行 evaluator、不重写 outcome，并按 manifest → marker 发布。第二次 reconcile 返回 `settled`，record/outcome/manifest/marker 四份 bytes 稳定；同一 operation 返回 `already_committed`，四份 bytes 仍稳定。
- 实际验证：`pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed）；`pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 均通过。

## C-4P6-S3：settlement-marker final rename EIO 的 tests-only evidence

`1334513`（`test(data): cover outcome marker recovery`）仅扩展 `tests/unit/learning-outcome-committer.unit.test.ts` 中同一个既有 unit `it`；没有 production/API/schema/path/order 变化，也没有新增 test count。它只记录 settlement-marker durable rename 返回 `EIO` 的单一 failure/restart/reconcile 场景：

- 初次 commit 返回 `retryable_failure/reconciliation_required`；immutable record、`outcome.json` 与已 `completed` 的 manifest 存在，settlement marker 为 `ENOENT`，且 evaluator 只运行一次。
- 重启后的 reconcile 以 immutable record authority 仅发布缺失 marker；不重新运行 evaluator 或 `createId`，不重写 record、outcome 或 manifest。
- 第二次 reconcile 返回 `settled`；同 operation replay 返回 `already_committed`；record/outcome/manifest/marker 四份 canonical bytes 在两次检查中保持稳定。

实际验证仍为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed，不是新增 test count）；`pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 均通过。S3 不是泛化 `after_manifest_publish` 证据、完整 manifest failure matrix、生产功能或完整 C-4P6 closure。

## C-4P6-S4：settled outcome recovery 的 tests-only evidence

`e821c69`（`test(data): cover settled outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化，也不表示 S4 改了生产逻辑。它严格限于已有 `after_settlement_marker` 的一个独立中断：marker 的 canonical rename 在当前平台 capability policy 规定的 durable primitive 完成后可见，且测试确认未到达 `before_catalog_reconcile`。

- restart `reconcile()` 直接返回 `settled`，不是 `repaired`。
- recovery 不调用 evaluator 或 `createId`，不执行 durable write / rename / publish；immutable record、`outcome.json`、`completed` manifest 与 marker 四份 canonical bytes 稳定。
- 同 operation replay 返回 `already_committed`，recovery 仍不产生 durable operation，四份 canonical bytes 继续稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 29 tests passed）。S4 不是完整 C-4P6、完整 catalog/manifest/crash matrix、transaction、rollback、delete、migration、API、operations validation 或 Windows native fsync/power-loss closure。



## C-4P6-S5：pre-catalog-reconcile interruption 的 tests-only evidence

`ebd084c`（`test(data): cover pre-catalog outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化，也不表示 S5 改了生产逻辑。它严格限于已有 `before_catalog_reconcile` 的一个独立中断：marker 已发布，且 `inject` 在 catalog read 前抛出。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；immutable record、`outcome.json`、已 `completed` 的 manifest 与 marker 四份 durable 产物已存在；`injectedPoints` 完整有序前缀包含 `before_catalog_reconcile`。
- restart `reconcile()` 直接返回 `settled`，不是 `repaired`。
- recovery 不调用 evaluator 或 `createId`，不执行 durable write / rename / publish；四份 canonical bytes 稳定。
- 第二次 reconcile 仍为 `settled`；同 operation replay 返回 `already_committed`，四份 canonical bytes 继续稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 30 tests passed）。S5 不是完整 C-4P6、完整 catalog/manifest/crash matrix、transaction、rollback、delete、migration、API、operations validation 或 Windows native fsync/power-loss closure。


## C-4P6-S6：post-stage-flush interruption 的 tests-only evidence

`145b671`（`test(data): cover post-stage-flush outcome recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于已有 `after_stage_flush` 的一个独立中断：stage 已 flush，immutable record 及后续 projection 尚未发布。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；仅 `after_stage_flush` 被 inject。
- stage 保留；record/outcome/marker 为 `ENOENT`；manifest 保持 crash 前 active 字节。
- restart `reconcile()` 返回 `pending`，无 durable write。
- 同 operation re-commit fail closed 于既有 exclusive-create stage，再次返回 `retryable_failure/reconciliation_required`，不 promote incomplete projections。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 31 tests passed）。S6 不是完整 C-4P6 或 stage cleanup/repair 生产功能。

## C-4P6-S7：after-record-publish interruption 的 tests-only evidence

`d26bb83`（`test(data): cover after-record-publish recovery`）只修改 `tests/unit/learning-outcome-committer.unit.test.ts`，新增一个独立的 `it`；没有 production/API/schema/path/order 变化。它严格限于已有 `after_record_publish` 的一个独立中断：immutable record 已 publish，outcome / manifest / marker 尚未发布。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；`injectedPoints` 为 `['after_stage_flush', 'after_record_publish']`；evaluation 仅一次。
- record 已存在；outcome / marker 为 `ENOENT`；manifest 保持 crash 前 active 字节；ledger 仍 `active` / `outcomeRef: null`。
- restart `reconcile()` 返回 `repaired`（authority-first，不重跑 evaluator / `createId`），不重写 record；随后 manifest → marker。
- 第二次 reconcile 为 `settled`；同 operation 为 `already_committed`；record / outcome / manifest / marker 四份 canonical bytes 稳定。

实际定向验证为 `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 32 tests passed）。S7 不是完整 C-4P6 或 stage cleanup/repair 生产功能。

## C-4P8：已关闭的受控 workspace-tool scope

C-4P8 的 S1 至 S4 已在**受控 `write_workspace_file` 文本文件 create / restricted-overwrite scope**关闭。S1 的 workspace descriptor foundation 证据为 `80f2fd0` / `e2ce36c`；S2 的 `b46c8b2` / `bdcd6cb` 和 S3 的 `56eabe6` / `54506d5` 仍是 POSIX descriptor-bound foundation；S4 的 handler/API integration 与定向测试为 `0bbfdef` / `e84c813`。2026-07-19 经明确批准后，Windows 另实现 root-constrained direct-path profile；它不把 Windows 冒充为该 descriptor-bound foundation。

### S4 请求、发布和稳定结果 contract

- 请求保持为 `{path, content, overwrite?}`。`overwrite` 缺省或为 `false` 时走 S2 no-clobber create：目标不存在时创建，目标已存在时返回 `target_exists`，不覆盖已有内容。`overwrite: true` 时，目标不存在仍走 S2 create；目标已存在且是 `nlink = 1` 的 regular file 才走 S3 restricted overwrite。directory、symlink、hardlink、FIFO、device、socket 和其它 non-regular target 均返回 `path_rejected`，不运行任一 publisher。
- `overwrite: true` 的竞争结果也属于稳定 contract：预检时 absent 但 S2 发布时已有目标出现，返回 `target_exists`；预检时为合格 regular file、但 S3 发布前目标消失、类型改变或不再满足 `nlink = 1` regular 条件，返回 `target_changed`。
- 对外稳定 code 仅为：`request_rejected`、`path_rejected`、`containment_unavailable`、`target_exists`、`target_changed`、`prepublication_failed`、`possibly_published`。结果不得暴露 raw internal error、absolute path、payload/content、descriptor path 或 temporary name。
- `possibly_published` 只以当前 profile 的 canonical regular leaf 完整字节 reread 确认：POSIX 使用 descriptor-bound read；Windows direct-path profile 使用再次进行 root/realpath containment 检查后的 direct-path read。字节完全一致时返回 `possiblyPublished: true`、`canonicalRead: 'exact'` 和 `retryable: false`；无法确认时返回 `code: 'possibly_published'` 与 `retryable: false`。
- 任何失败（包括 `target_exists`、`target_changed`、`prepublication_failed` 和 `possibly_published`）都不得自动 retry、rollback 或删除 canonical target；`possibly_published` 也不得被解释为“未执行”。
- journal 以同一 `toolCallId` replay 已记录结果；replay 不发生第二次 publish。该保证只覆盖此 tool 的记录/replay 边界，不扩大为全局 actionId、receipt 或跨工具 idempotency 协议。

POSIX 的 S3 仍是 descriptor-bound/no-follow、same-parent publication；restricted overwrite 只接受既有 `nlink = 1` regular leaf，采用 macOS `RENAME_SWAP` 或 Linux `RENAME_EXCHANGE`，不是 CAS，也不提供版本匹配、合并或 lost-update 防护。candidate 以 `0666 & umask` 创建，并采用旧 target normal mode `& 0777`；不承诺 special bits、owner/group、ACL、xattr、birth time 或其它 metadata 的完整保留。Windows S3 则是下文定义的 direct-path non-CAS profile，不能推断有 POSIX swap 的原子发布或 metadata-preservation 行为。

### Runtime 平台 capability 与产品边界

POSIX 和 Windows 使用**不同且显式命名的 capability profile**：

- **POSIX descriptor profile：**native addon 以 descriptor-relative/no-follow traversal 和 S2/S3 的 temporary + atomic publish 实现严格路径绑定；POSIX addon 不可加载时仍 fail closed，绝不退回 pathname write。
- **Windows direct-path profile（2026-07-19 经用户明确批准）：**参考 `codex-rust` 的分层方式：上层先把相对路径约束在可信 workspace root，并执行已有 symlink/realpath containment 检查；随后使用正常的 direct-path 文件 API。S2 使用 `wx` 的 no-clobber create，S3 仅对既有 `nlink = 1` regular target 以非创建式 `r+` handle truncate/write/sync。每次成功写入均进行 exact reread；任何不确定结果不 retry/rollback，而按现有 `possibly_published` 规则报告。

Windows profile **不是** descriptor-bound/HANDLE-relative traversal，也不是 target-file-ID compare-and-swap：external actor 若在检查与 direct-path open/write 之间替换 parent reparse point 或 final leaf，不属于它能证明安全的范围。它同样不提供 POSIX same-parent atomic exchange、directory `fsync` durability 或完整 metadata preservation。该限制是 Windows API audit 的结论，也是批准 direct-path S3 contract 的前提；代码、测试和产品文字均不得把它称为 strict containment、CAS 或 Windows durable publish。

- `getWorkspaceWriteToolAvailability()` 将两种可用 profile 映射为相同稳定的 `{ available: true }`；其它 host 仍返回 `{ available: false, code: 'containment_unavailable', message: '当前平台无法安全发布工作区文件。' }`，不携带本地路径、loader、errno、descriptor 或 temporary-name 细节。
- `buildDefaultRegistry()` 仍只在调用方已请求 workspace write、workspace read 已启用且当前 profile 可用时注册 `write_workspace_file`。不可用 host 的只读 workspace tools 保持注册，write definition 和 handler 均不存在；不会创建审批或 operation journal 条目。
- `settings.tools.approvalMode` 对已注册 writer 的语义不变。Windows direct-path writer 和 POSIX writer 都走既有审批、operation journal 与 same-`toolCallId` replay；后者仍避免第二次 publish。
- 直接调用内部 handler 时，profile 无法绑定或预条件不满足时仍只返回稳定、无本地细节的 error code。

### 2026-07-19 Windows host-native feasibility audit（阻塞证据，不是 Windows support）

在 Windows host（Windows SDK `10.0.26100.0`、Node `24.13.0`、VS 2022 Build Tools）实际重建当前 native addon；它能编译，但现有 `_WIN32` 分支仍明确拒绝 descriptor-relative traversal。审计当时没有据此打开 writer gate，也没有把“addon 可编译”误记为 Windows strict publish 证据；后续 direct-path profile 是单独、明确较弱的产品决定。

在 Microsoft SDK headers 和 Microsoft 文档允许的范围内，已核验 `NtCreateFile` 的 `RootDirectory`、`OBJ_DONT_REPARSE`、`FILE_OPEN_REPARSE_POINT` 与 `FILE_CREATE` 可用于 HANDLE-relative/no-follow traversal 与 S2 create-new；`GetFileInformationByHandleEx` 可提供 reparse、directory、link-count 和 file-ID 检查；`FlushFileBuffers` 可用于已打开 file/directory handle 的 flush。可是 `SetFileInformationByHandle(FileRenameInfo[/Ex])`、`ReplaceFileW` 以及相关 rename API 都没有“仅在期望 file ID 仍是当前 target 时替换”的 compare-and-swap / exchange parameter。持有 target handle 并拒绝 delete sharing 会阻止攻击者替换，却也会阻止替换发布；在 publish 前释放则重新引入 inspect-to-publish race。

对可替代机制的第二轮审计也没有得到例外：`CreateFileTransacted` / `MoveFileTransacted` 是 pathname-based TxF API，未提供 expected file-ID 参数，且 TxF 已被 Microsoft 标记为不建议新开发使用、未来版本可能不可用；`FileDispositionInfoEx`、`FileLinkInformation[Ex]`、`OpenFileById`、object-ID / CSV revision FSCTL 仅提供 delete/link、按 ID 打开或 metadata 查询/管理，均不是带 expected identity 的 replacement CAS。oplock、share mode 与 `LockFileEx` 也只是可被 break 的缓存/打开协调或 byte-range 锁，不能在任意并发 publisher 面前维持 namespace target identity。

因此，已审计的 Windows API 不能证明原先严格 S3 所要求的“existing single-link regular、target identity unchanged、atomic restricted overwrite”同时成立。尤其不能把“先以 HANDLE 检查，再以 handle-relative rename replace”描述为 target-changed-safe；它仍可能替换检查后被并发换入的 leaf。该结论保留不变。随后在 2026-07-19 获得明确授权后，产品选择的是一个**不同的** Windows direct-path non-CAS contract：允许 root-constrained pathname write，但不将它当作 strict containment 或 identity-safe replacement。

若未来要交付与 POSIX 相当的 Windows strict profile，仍需要可审计且能提供该原子 identity precondition 的 Windows/NTFS publish primitive；仅增加 HANDLE-relative S1/S2 不足以达到该标准。当前 Windows direct-path profile 是经批准的较弱合同，不修改下方既有 macOS/Linux descriptor 验证记录。

### 最终本地验证和 Linux host-native 记录

最终本地验证在 macOS 上构建 native addon，并实际执行以下五个 unit 文件，共 **123 tests passed**；另通过 typecheck、workspace write tool check、agent-operation idempotency check、workspace path target check、security check 和 diff check。这是定向验证记录，**不是 full suite** 声明。

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit tests/unit/contained-durable-directory.unit.test.ts tests/unit/workspace-contained-directory.unit.test.ts tests/unit/workspace-contained-create-no-overwrite.unit.test.ts tests/unit/workspace-contained-restricted-overwrite.unit.test.ts tests/unit/workspace-write-tool.unit.test.ts
pnpm run typecheck
pnpm run check:workspace-write-tool
pnpm run check:agent-operation-idempotency
node scripts/check-workspace-path-target.mjs
pnpm run check:security
git diff --check
```

`ed8d88a` / `9c452f3` 记录的现有 Linux host-native 证据来自 2026-07-19 的 [GitHub Actions run 29678781775](https://github.com/kaieye/StudiumX/actions/runs/29678781775)：GitHub-hosted `ubuntu-24.04` x64、Node `22.23.1`，本机构建 addon，并完成当时四个 P8 native 定向 unit files（**4 passed / 96 passed**、没有 skipped）。这证明该指定 Ubuntu host 上的 S2/S3 native branch 已有 hosted 证据；它不是所有 Linux filesystem/kernel、所有 Linux host、Windows 或 fully cross-platform 的声明。

### 固定 scope 与非目标

C-4P8 的关闭不改变 C-4 的 global partial-writer limitation，也不授权：

- 迁移所有 writer，或把任意 writer 都接到此 tool / durable operation；
- 跨文件 transaction、共同原子性、CAS 或 lost-update protection；
- IPC、renderer/UI、prompt 或 approvalMode 语义的变更；本轮仅增加 profile-aware registry eligibility，不把 Windows direct-path profile 伪装为 POSIX native capability；
- workspace registry、touch/save registry、conversation audit、generic JSONL、repair、migration、backup、retention 或 schema change；
- POSIX-equivalent Windows strict containment/CAS、所有 Linux filesystem/kernel，或 fully cross-platform support 的宣称；
- 完整 metadata preservation。

C-4P5 的 allowlisted Markdown service 是不同 consumer；其 allowlist/service contract 不由 C-4P8 继承或替代。

## C-4P9-S2 实施与 P9-S3/S4/S5/S6/S7/S8 evidence 验证入口

C-4P9 只实施了最小切片 S2；P9-S3、P9-S4、P9-S5、P9-S6、P9-S7 与 P9-S8 都是严格 tests-only evidence slice。S2 证据提交为 `4b30220`（`feat(data): add durable session audit append`）和 `5f47382`（`test(data): cover durable session audit append`）。S3 的 `c286a42`（`test(data): cover audit durable append recovery`）保留实际历史证据：partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory 与 conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动。S4 的 `ab723a6`（`test(data): cover audit pre-write short-circuit`）仅覆盖 archive save 层首个 audit write 注入 `EIO` 且 audit 0 bytes：JSON/Markdown 保留、ledger 未执行；clean retry 后每个 canonical audit row 恰一条、ledger 恰一条。S5 的 `47393f9`（`test(data): cover audit directory capability symmetry`）仅修改测试，未修改 production code；Sol review approved。它对 audit directory 与 conversation parent directory 的 `open`/`sync` 做 capability symmetry 定向证据：五个 allowlist code 各覆盖两层、两种操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 的 `EINVAL` 仍 fatal。S5 无 production/API/schema/order 变化，不是完整 capability matrix，也不是生产功能。以下是受限 evidence 的实际验证命令和结果，不是完整 suite 的声明：

**P9-S3 的历史 evidence、P9-S4 的单一 pre-write short-circuit/retry evidence、P9-S5 的 directory capability symmetry evidence 与 P9-S6 的 ledger-own failure residual evidence 与 P9-S7 的 concurrent identical same-save evidence 与 P9-S8 的 divergent-trace conflict fail-closed evidence 均已记录；C-4P9 仍未关闭。**

```sh
# P9-S3 historical evidence: 2 files, 61 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check

# P9-S4: 1 file, 27 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts

# P9-S5 current slice: 1 file, 51 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts

# P9-S5 current slice with archive durable: 2 files, 78 tests passed

# P9-S6 ledger-own failure residual: 1 file, 27 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts

# P9-S7 concurrent identical same-save: 1 file, 52 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts

# P9-S8 divergent-trace conflict: 1 file, 53 tests passed
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check
```

## C-4P9-S8：divergent-trace conflict 的 tests-only evidence

`bee173f`（`test(data): cover audit divergent-trace conflict`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 trace conflict 不得误作 exact dedupe residual：on-disk 同 identity 但 `traceId` 分叉的两行，retry 同 record 必须 throw `Conversation session audit contains divergent duplicate records.`，poisoned bytes 不变，无额外 `write:`、无 rewrite。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`（1 file / 53 tests passed）。S8 不是完整 trace/legacy matrix 或 C-4P9 gate closure。

## C-4P9-S7：concurrent identical same-save 的 tests-only evidence

`816e403`（`test(data): cover concurrent identical audit saves`）仅修改 `tests/unit/agent-conversation-session-audit.unit.test.ts`，补齐 concurrent identical same-save residual：per-path queue 线性化，两路并发 append 同一 record 时仅一个 open lifecycle、一个 session header、entry IDs 唯一，exact bytes 与单次顺序 write 一致。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts`（1 file / 52 tests passed）。S7 不是完整 concurrency matrix 或 C-4P9 gate closure。

## C-4P9-S6：ledger-own failure residual 的 tests-only evidence

`5f931c9`（`test(data): cover audit ledger failure recovery`）仅修改 `tests/unit/agent-conversation-archive-durable.unit.test.ts`，加强既有 ledger-own failure residual：audit 在 ledger 失败后保留期望 header 与 canonical entry IDs 且不 rollback；retry 保持 exact audit bytes、不写 audit、恰一条 ledger 行；随后 idempotent save 保持 audit 与 ledger bytes 不变。验证为 `pnpm exec vitest run --project unit tests/unit/agent-conversation-archive-durable.unit.test.ts`（1 file / 27 tests passed）。S6 不是完整 C-4P9、完整 residual matrix、generic JSONL、rotation、事务或 IPC/UI。

## C-4P9-S2 已实施的受限语义

- 仅替换固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit append boundary；不 rotation，且不调用或迁移到 generic `durable-jsonl`。
- 模块私有 queue 按**规范化绝对 audit path**串行化；同一路径在一个 descriptor 生命周期内完成 exact-byte read、canonical/legacy validate、dedupe/conflict 判定、framed append、file `fsync` 与 `close`。
- 缺失 canonical rows 才追加：保留已有 raw bytes，并仅在既有非空末字节不是 LF 时添加一个隔离 LF；legacy trace-free/malformed-trace rows 可兼容读取，既有 trace write-once 行不回填、不重写。
- file close 后按 audit directory、再 conversation parent directory 的子到父顺序确认 durability。directory `open`/`sync` 仅 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 可降级为通用 warning；其它错误及任何 close failure 均 fatal。
- post-directory failure 会使 save reject 且不回滚；retry 先重新读取、dedupe exact rows，再允许既有 ledger flow 继续。

这不关闭 C-4P9，也不表示完整 capability matrix、generic JSONL migration、跨文件 transaction、ledger authority/save-order 改造、repair、rotation 或 IPC/UI 已交付。P9-S3 的历史定向 unit 结果仍必须记为 **61 tests passed**；P9-S5 本切片 **51**、P9-S7 **52**、P9-S8 **53** 都是各自切片时的定向计数，不要混用历史与当前数字。未完成工作仍见[本地数据待办](../local-data-todo.md)。
