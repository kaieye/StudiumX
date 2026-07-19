# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **状态：** 已实施（部分 consumer migration；包含 C-4P6-S1 的受限基础与 C-4P6-S2 tests-only evidence、C-4P8-S1/S2/S3 foundation 与 C-4P8-S4 受控 `write_workspace_file` 文本文件 create / restricted-overwrite closure，以及 C-4P9-S2 audit 专用 durable append、P9-S3/P9-S4/P9-S5 tests-only evidence）
- **范围：** C-4、C-4P0、C-4P1、C-4P2A、C-4P2B、C-4P3、C-4P4、C-4P5、C-4P6-S1、C-4P6-S2（tests-only evidence）、C-4P7、C-4P8-S1、C-4P8-S2、C-4P8-S3、C-4P8-S4、C-4P9-S2、C-4P9-S3（tests-only evidence）、C-4P9-S4（tests-only evidence）、C-4P9-S5（tests-only evidence）
- **证据提交：** `ca73537`、`5c0dd96`、`34c48f4`、`b8eb3ab`、`70afe1d`、`99bf6fe`、`f8ad99c`、`278f141`、`7292bf4`、`e02a086`、`9847842`、`0d55fd8`、`80f2fd0`、`e2ce36c`、`b46c8b2`、`bdcd6cb`、`56eabe6`、`54506d5`、`ed8d88a`、`9c452f3`、`0bbfdef`、`e84c813`、`4b30220`、`5f47382`、`c286a42`、`ab723a6`、`47393f9`

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
| C-4P7 `0d55fd8` | private `MusicCookieStore` cookie state | `tests/unit/music-cookie-store-durable.unit.test.ts` |
| C-4P8-S1 `80f2fd0`、`e2ce36c` | workspace descriptor foundation：可信既有 workspace root 绑定、descriptor-bound parent traversal 与 final-leaf inspection | 下列 C-4P8 最终定向验证 |
| C-4P8-S2 `b46c8b2`、`bdcd6cb` | internal descriptor-bound atomic `createNoOverwrite` foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S3 `56eabe6`、`54506d5` | internal descriptor-bound restricted-overwrite foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S4 `0bbfdef`、`e84c813` | 受控 `write_workspace_file` 文本文件 create / restricted-overwrite handler integration、稳定结果和同 toolCallId journal replay | `tests/unit/workspace-write-tool.unit.test.ts` 与下列最终定向验证 |
| C-4P9-S2 `4b30220`、`5f47382` | 固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append；不 rotation、不迁移其它 JSONL | 下列 C-4P9-S2/S3/S4 验证命令 |
| C-4P9-S3 `c286a42` | **tests-only historical evidence**：补齐 P9-S2 的 partial-write 与 archive-level failure/retry 定向证据：fixed-file non-rotating audit append 的 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动 | 2 个 unit 文件、61 tests passed；另有当时本主会话的 typecheck、security check、diff check |
| C-4P9-S4 `ab723a6` | **tests-only evidence**：仅覆盖 archive save 层首个 audit write 注入 `EIO`、audit 0 bytes 时的 short-circuit/retry；JSON/Markdown 保留、ledger 未执行，clean retry 后每个 canonical audit row 恰一条、ledger 恰一条；无生产语义改动 | `tests/unit/agent-conversation-archive-durable.unit.test.ts`；1 file、27 tests passed |
| C-4P9-S5 `47393f9` | **tests-only evidence**：仅修改测试，未修改 production code；Sol review approved。对 audit directory 与 conversation parent directory 的 `open`/`sync` 做 capability symmetry 定向证据：五个 allowlist code `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 各覆盖两层、两种操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 返回 `EINVAL` 仍 fatal；无 production/API/schema/order 变化 | 单独：`tests/unit/agent-conversation-session-audit.unit.test.ts`，1 file、51 tests passed；与 archive durable 共同运行，2 files、78 tests passed；另通过 typecheck、security check、diff check |

共享原语和关键状态备份的验证也由 `tests/unit/durable-file.unit.test.ts` 覆盖。

## C-4P6-S2：outcome publish crash-recovery tests-only evidence

`9847842`（`test(data): cover outcome publish crash recovery`）仅修改 `tests/unit/learning-outcome-committer.unit.test.ts`，且 Sol final review approved；没有 production/API/schema/path/order 变化。它只覆盖单一 `after_outcome_publish` crash window，不是 manifest capability-policy alignment、其它 crash windows / failure matrix、跨文件 transaction、rollback/delete/migration/API/operations validation 或完整 C-4P6 closure。

- 初次 commit 返回 `retryable_failure/reconciliation_required`；record 与 matching outcome 存在，manifest 为 `active` / `outcomeRef: null`，marker 缺失，且未继续 manifest、marker 或 catalog-success。
- 重启后的 reconcile 使用 immutable record authority，返回 `repaired`，不重新运行 evaluator、不重写 outcome，并按 manifest → marker 发布。第二次 reconcile 返回 `settled`，record/outcome/manifest/marker 四份 bytes 稳定；同一 operation 返回 `already_committed`，四份 bytes 仍稳定。
- 实际验证：`pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`（1 file / 28 tests passed）；`pnpm run typecheck`、`pnpm run check:security`、`git diff --check` 均通过。


## C-4P8：已关闭的受控 workspace-tool scope

C-4P8 的 S1 至 S4 已在**受控 `write_workspace_file` 文本文件 create / restricted-overwrite scope**关闭。S1 的 workspace descriptor foundation 证据为 `80f2fd0` / `e2ce36c`；S2 的 `b46c8b2` / `bdcd6cb` 提供 descriptor-bound atomic `createNoOverwrite`；S3 的 `56eabe6` / `54506d5` 提供 descriptor-bound restricted overwrite；S4 的 handler/API integration 与定向测试为 `0bbfdef` / `e84c813`。

### S4 请求、发布和稳定结果 contract

- 请求保持为 `{path, content, overwrite?}`。`overwrite` 缺省或为 `false` 时走 S2 no-clobber create：目标不存在时创建，目标已存在时返回 `target_exists`，不覆盖已有内容。`overwrite: true` 时，目标不存在仍走 S2 create；目标已存在且是 `nlink = 1` 的 regular file 才走 S3 restricted overwrite。directory、symlink、hardlink、FIFO、device、socket 和其它 non-regular target 均返回 `path_rejected`，不运行任一 publisher。
- `overwrite: true` 的竞争结果也属于稳定 contract：预检时 absent 但 S2 发布时已有目标出现，返回 `target_exists`；预检时为合格 regular file、但 S3 发布前目标消失、类型改变或不再满足 `nlink = 1` regular 条件，返回 `target_changed`。
- 对外稳定 code 仅为：`request_rejected`、`path_rejected`、`containment_unavailable`、`target_exists`、`target_changed`、`prepublication_failed`、`possibly_published`。结果不得暴露 raw internal error、absolute path、payload/content、descriptor path 或 temporary name。
- `possibly_published` 仅以 descriptor-bound canonical regular leaf 的**完整字节 reread**确认；字节完全一致时返回 `possiblyPublished: true`、`canonicalRead: 'exact'` 和 `retryable: false`。无法确认时返回 `code: 'possibly_published'` 与 `retryable: false`。
- 任何失败（包括 `target_exists`、`target_changed`、`prepublication_failed` 和 `possibly_published`）都不得自动 retry、rollback 或删除 canonical target；`possibly_published` 也不得被解释为“未执行”。
- journal 以同一 `toolCallId` replay 已记录结果；replay 不发生第二次 publish。该保证只覆盖此 tool 的记录/replay 边界，不扩大为全局 actionId、receipt 或跨工具 idempotency 协议。

S3 的实现仍是 descriptor-bound/no-follow、same-parent publication；restricted overwrite 只接受既有 `nlink = 1` regular leaf，采用 macOS `RENAME_SWAP` 或 Linux `RENAME_EXCHANGE`，不是 CAS，也不提供版本匹配、合并或 lost-update 防护。candidate 以 `0666 & umask` 创建，并采用旧 target normal mode `& 0777`；不承诺 special bits、owner/group、ACL、xattr、birth time 或其它 metadata 的完整保留。

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
- IPC、renderer/UI、prompt、tool registry 或 permission model 的变更；
- workspace registry、touch/save registry、conversation audit、generic JSONL、repair、migration、backup、retention 或 schema change；
- Windows、所有 Linux filesystem/kernel，或 fully cross-platform support 的宣称；
- 完整 metadata preservation。

C-4P5 的 allowlisted Markdown service 是不同 consumer；其 allowlist/service contract 不由 C-4P8 继承或替代。

## C-4P9-S2 实施与 P9-S3/S4/S5 evidence 验证入口

C-4P9 只实施了最小切片 S2；P9-S3、P9-S4 与 P9-S5 都是严格 tests-only evidence slice。S2 证据提交为 `4b30220`（`feat(data): add durable session audit append`）和 `5f47382`（`test(data): cover durable session audit append`）。S3 的 `c286a42`（`test(data): cover audit durable append recovery`）保留实际历史证据：partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory 与 conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动。S4 的 `ab723a6`（`test(data): cover audit pre-write short-circuit`）仅覆盖 archive save 层首个 audit write 注入 `EIO` 且 audit 0 bytes：JSON/Markdown 保留、ledger 未执行；clean retry 后每个 canonical audit row 恰一条、ledger 恰一条。S5 的 `47393f9`（`test(data): cover audit directory capability symmetry`）仅修改测试，未修改 production code；Sol review approved。它对 audit directory 与 conversation parent directory 的 `open`/`sync` 做 capability symmetry 定向证据：五个 allowlist code 各覆盖两层、两种操作，共 20 cases；每个成功且恰好一条固定通用 warning，warning 不泄露路径、内容、conversation/header/entry ID 或 trace；parent-directory `close` 的 `EINVAL` 仍 fatal。S5 无 production/API/schema/order 变化，不是完整 capability matrix，也不是生产功能。以下是受限 evidence 的实际验证命令和结果，不是完整 suite 的声明：

**P9-S3 的历史 evidence 与 P9-S4 的单一 pre-write short-circuit/retry evidence 均已记录；C-4P9 仍未关闭。**

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
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check
```

## C-4P9-S2 已实施的受限语义

- 仅替换固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit append boundary；不 rotation，且不调用或迁移到 generic `durable-jsonl`。
- 模块私有 queue 按**规范化绝对 audit path**串行化；同一路径在一个 descriptor 生命周期内完成 exact-byte read、canonical/legacy validate、dedupe/conflict 判定、framed append、file `fsync` 与 `close`。
- 缺失 canonical rows 才追加：保留已有 raw bytes，并仅在既有非空末字节不是 LF 时添加一个隔离 LF；legacy trace-free/malformed-trace rows 可兼容读取，既有 trace write-once 行不回填、不重写。
- file close 后按 audit directory、再 conversation parent directory 的子到父顺序确认 durability。directory `open`/`sync` 仅 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 可降级为通用 warning；其它错误及任何 close failure 均 fatal。
- post-directory failure 会使 save reject 且不回滚；retry 先重新读取、dedupe exact rows，再允许既有 ledger flow 继续。

这不关闭 C-4P9，也不表示完整 capability matrix、generic JSONL migration、跨文件 transaction、ledger authority/save-order 改造、repair、rotation 或 IPC/UI 已交付。P9-S3 的历史定向 unit 结果仍必须记为 **61 tests passed**；当前 P9-S5 本切片的结果是 **51 tests passed**，与 archive durable 共同运行是 **78 tests passed**，不要混用这些历史与当前数字。未完成工作仍见[本地数据待办](../local-data-todo.md)。
