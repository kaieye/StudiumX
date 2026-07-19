# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **状态：** 已实施（部分 consumer migration；包含 C-4P6-S1 的受限基础、C-4P8-S1 descriptor foundation、C-4P8-S2 internal `createNoOverwrite` foundation、C-4P8-S3 internal restricted-overwrite foundation，以及 C-4P9-S2 audit 专用 durable append）
- **范围：** C-4、C-4P0、C-4P1、C-4P2A、C-4P2B、C-4P3、C-4P4、C-4P5、C-4P6-S1、C-4P7、C-4P8-S1、C-4P8-S2、C-4P8-S3、C-4P9-S2
- **证据提交：** `ca73537`、`5c0dd96`、`34c48f4`、`b8eb3ab`、`70afe1d`、`99bf6fe`、`f8ad99c`、`278f141`、`7292bf4`、`e02a086`、`0d55fd8`、`80f2fd0`、`e2ce36c`、`b46c8b2`、`bdcd6cb`、`56eabe6`、`54506d5`、`4b30220`、`5f47382`

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
| C-4P7 `0d55fd8` | private `MusicCookieStore` cookie state | `tests/unit/music-cookie-store-durable.unit.test.ts` |
| C-4P8-S1 `80f2fd0`、`e2ce36c` | 仅 workspace descriptor foundation：可信既有 workspace root 绑定、descriptor-bound parent traversal 与 final-leaf inspection；不发布文件 | 下列已实际执行的 C-4P8-S1 验证命令 |
| C-4P8-S2 `b46c8b2`、`bdcd6cb` | 仅 internal descriptor-bound atomic `createNoOverwrite` foundation；不是 handler/API migration，也不实现 S3 restricted overwrite | 下列已实际执行的 C-4P8-S2 验证命令 |
| C-4P8-S3 `56eabe6`、`54506d5` | 仅 internal descriptor-bound restricted-overwrite foundation；不是 handler/API migration | 下列已实际执行的 C-4P8-S3 验证命令 |
| C-4P9-S2 `4b30220`、`5f47382` | 固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append；不 rotation、不迁移其它 JSONL | 下列已实际执行的 C-4P9-S2 验证命令 |

共享原语和关键状态备份的验证也由 `tests/unit/durable-file.unit.test.ts` 覆盖。

### C-4P8-S1 实际验证入口

C-4P8-S1 的证据提交为 `80f2fd0`（`feat(data): add workspace descriptor foundation`）和 `e2ce36c`（`test(data): cover workspace descriptor foundation`）。S1 的证据仍保留；它只覆盖可信既有 workspace root 的 descriptor-bound traversal 与 final-leaf inspection，不发布文件。

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit tests/unit/contained-durable-directory.unit.test.ts tests/unit/workspace-contained-directory.unit.test.ts
pnpm run check:workspace-write-tool
node scripts/check-workspace-path-target.mjs
pnpm run typecheck
pnpm run check:security
```

### C-4P8-S2 实际验证入口与未关闭证据

C-4P8-S2 的证据提交为 `b46c8b2`（`feat(data): add workspace create no-overwrite`）和 `bdcd6cb`（`test(data): cover workspace create no-overwrite`）。本轮在**当前 macOS host-built addon**上实际执行了下列定向验证：三个 unit 文件共 **60 tests**，以及 build、workspace-tool、path-target、typecheck、security 与 diff 检查。它们不是全量测试声明。

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit tests/unit/contained-durable-directory.unit.test.ts tests/unit/workspace-contained-directory.unit.test.ts tests/unit/workspace-contained-create-no-overwrite.unit.test.ts
pnpm run check:workspace-write-tool
node scripts/check-workspace-path-target.mjs
pnpm run typecheck
pnpm run check:security
git diff --check
```

Linux 的 S2/S3 host-native rename 现有真实验证为 2026-07-19 [GitHub Actions run 29678781775](https://github.com/kaieye/StudiumX/actions/runs/29678781775)：指定 GitHub-hosted `ubuntu-24.04` x64 host 成功完成本机构建与四个 P8 定向 unit files（**4 passed / 96 passed**、没有 skipped）。这补充了 S2 `renameat2(..., RENAME_NOREPLACE)` 与 S3 `renameat2(..., RENAME_EXCHANGE)` 的源码证据，但不替代更广泛的验收；不能将 P8-S2、P8-S3 或 C-4P8 表述为跨平台完成，也不表示所有 Linux filesystem/kernel 或 Windows 支持。

### C-4P8-S2 已实施的受限语义

- 已实施的仅是 **internal descriptor-bound atomic `createNoOverwrite` foundation**。它绑定可信既有 workspace root，并在同一个已绑定 parent descriptor 下创建 temporary candidate、写入、file `fsync`、close，再以 exclusive rename 发布到 final name。
- macOS 使用 `renameatx_np(..., RENAME_EXCL)`；Linux 使用 `renameat2(..., RENAME_NOREPLACE)`。若宿主/文件系统没有所需 primitive，则 fail closed；不会退回 hardlink、`linkat`、pathname fallback、普通 `rename` 或“先检查再 rename”。
- publication 时已有 final target（包括 preflight 已见或竞争中出现的 existing final）统一得到 internal `target_exists`；竞争方 bytes 不被 clobber。S2 不把 leaf type 差异扩展为 overwrite policy。
- publication 成功后，如 directory `fsync`、directory close 或 completion 过程失败，internal 结果为 `possibly_published`：final bytes 可能已发布，不得把该结果解释为“尚未执行”。directory `fsync` 只有 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 五个 capability errno 可降级，并仅发出不含路径、临时名、payload 或原始 I/O 文本的 generic warning；其余错误 fail closed。
- S2 没有 handler、tool registry、IPC、renderer 或 API integration；internal error kinds 不是 tool/API stable contract。`write_workspace_file` 未接入 S2：它已有 pathname-based `overwrite` boolean，并会在已有普通文件且 `overwrite: true` 时通过 pathname-based `writeFile()` 覆盖；这不是 S2/S3 durable publication 的证据。

C-4P8 整体仍未完成：S3 restricted overwrite 已作为 internal foundation 实施，并有 macOS 与指定 GitHub-hosted `ubuntu-24.04` x64 host 的定向验证；S4 handler/API integration 仍未实施、未批准。不得将 S1/S2/S3 或上述定向验证解释为 workspace tool durable write 已交付。

## C-4P9-S2 实际验证入口

C-4P9 只实施了最小切片 S2；证据提交为 `4b30220`（`feat(data): add durable session audit append`）和 `5f47382`（`test(data): cover durable session audit append`）。以下是该受限切片已实际执行的验证命令；它们不是完整 suite 的声明：

```sh
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
- post-directory failure 会使 save reject 且不回滚；retry 先重新读取、dedupe exact rows，再允许既有 ledger flow 继续。ledger authority、其 queue/identity 语义、archive save 顺序和 final verify 均未改变。

S2 不构成整个 C-4P9 gate completed：它不迁移 generic JSONL、不是跨文件 transaction，不改变 ledger authority 或 save 顺序，不做 repair/rotation，也不涉及 IPC/UI。

## C-4P6-S1 已实施的受限语义

- 内置 `FileLearningSessionLedger` 在私有实现中复用既有 filesystem writer lock，锁覆盖完整 commit / reconcile 生命周期；公开 `LearningSessionLedger` API 没有扩展。注入的仅加载（load-only）ledger 在任何 canonical write 之前 fail closed：commit 返回可重试的 `temporarily_unavailable`，reconcile 返回 `review_required`。
- 有 record 的严格顺序为：stage → immutable record（不 replace link）→ `outcome.json` → manifest → settlement marker → catalog。无 record 分支仍是 marker-only，不虚构前述 record/projection 写入。
- 可变的 outcome / marker 通过共享 `replaceDurably` 发布，并沿用 directory-fsync capability 的五个允许降级 code：`EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR`。降级 warning 为通用、非敏感信息；不在 allowlist 内的 I/O、open、sync 或 close 错误均为 fatal。
- immutable record 的 link 后 parent-directory 失败、匹配 `EEXIST` 路径以及 stage cleanup 错误均为 fatal；link 成功后不得再用 matching-bytes 抑制错误。canonical record 的 parent / leaf containment 与 symlink 安全检查 fail closed。
- reconcile 以 authority-first 进行：仅有效 immutable record 可以按 `outcome.json` → manifest → marker 的顺序修复缺失 projection，绝不覆盖冲突；不安全或不一致状态返回 `review_required`。authority-first reconcile 不进行 stage cleanup。

上述测试数量只说明该受限 S1 的相关覆盖；**不表示**设计矩阵中的全部 crash/failure 情形、后续 C-4P6 风险或任何未来切片已经消除。

## C-4P8-S1 已实施的受限语义

- 只在**既有且可信的** workspace root 上绑定 capability；S1 不会从不可信 target pathname 创建 workspace root。
- 解析后的 parent component 使用 descriptor-bound、no-follow traversal；workspace parent 仅在请求时创建，遵循 `0777 & umask` 的普通 mkdir 语义。root 绑定后不退回 pathname traversal。
- final leaf 以 no-follow inspect 分类为 absent、regular（记录 mode 与 linkCount）、directory、symlink 或 other；S1 只暴露检查结果，尚未把其作为 create 或 overwrite publication 的操作语义。
- 提供窄的 typed internal seam、operation record 与 internal error kinds；它们不是 tool/API 的稳定错误 contract。
- 仅支持 macOS/Linux 的 host-built capability；其它平台或 native capability 不可用时 fail closed。

S1 **不包含** workspace tool handler、registry、IPC、renderer 或 API 变更；不写 payload 或 temp，不实现 durable publisher、atomic no-clobber 或 restricted overwrite，也没有 tool-facing stable errors 或 `possibly_published`。当前 `write_workspace_file` 未接入 S1/S2/S3。

## C-4P8-S3 已实施的受限语义与验证入口

S3 的证据提交为 `56eabe6`（`feat(data): add workspace restricted overwrite foundation`）和 `54506d5`（`test(data): cover workspace restricted overwrite`）。它是 strict internal-only restricted-overwrite foundation：没有 handler、API、tool registry、IPC、renderer 或 UI integration，也不改变 `write_workspace_file`。现有 `write_workspace_file` 保持 pathname-based `overwrite` boolean 和 pathname-based `writeFile()` 覆盖；它没有接入 S3，不能作为 S3 的实现或验证证据。

- 仅可 replacement existing-only regular `nlink = 1` target；absent、hardlink、directory、symlink、device、FIFO、socket 与其它 non-regular target fail closed。parent/final 均 descriptor-bound、no-follow；禁止 pathname fallback、ordinary `rename` fallback、hardlink/`linkat` fallback，也不能以 pre/post `realpath` 代替 publication。
- candidate 以 `0666 & umask` 创建，随后采用 old target normal mode `& 0777`；不恢复/复制 setuid/setgid/sticky special bits，也不承诺 inode、hardlink、owner/group、ACL、xattr、birth time 或其它 metadata。
- 在 same parent descriptor 下 atomic swap：macOS 使用 `renameatx_np(..., RENAME_SWAP)`；Linux 使用 `renameat2(..., RENAME_EXCHANGE)`。它不是 CAS，不承诺 version match、lost-update 防护或 external concurrent mutation 检测/阻止。
- prepublication failure 保留 primary target，并 cleanup/sync candidate。只有 swap-success marker 后的 error 是已发布状态，必须为 internal `possibly_published`；之后的顺序为 first directory `fsync` → old-alias unlink → second directory `fsync` → close，不得 rollback、删除 canonical target 或以旧内容再次覆盖，retry 不得把它当作未执行。

既有本会话实际在当前 macOS host-built addon 上运行：

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit tests/unit/contained-durable-directory.unit.test.ts tests/unit/workspace-contained-directory.unit.test.ts tests/unit/workspace-contained-create-no-overwrite.unit.test.ts tests/unit/workspace-contained-restricted-overwrite.unit.test.ts
pnpm run typecheck
pnpm run check:workspace-write-tool
node scripts/check-workspace-path-target.mjs
pnpm run check:security
git diff --check
```

四个定向 unit 文件 **96 tests passed**；其中 S3 文件有 **36 tests**，并包含 macOS real native integration。

随后，`ed8d88a`（`test(data): enable Linux workspace native verification`）新增 GitHub Actions workflow，并把两套 native integration 的运行条件从 darwin-only 改为 `darwin || linux`。2026-07-19 的 [GitHub Actions run 29678781775](https://github.com/kaieye/StudiumX/actions/runs/29678781775) 在 `ubuntu-24.04` GitHub-hosted x64 Linux 上运行：Node `22.23.1`、node-gyp `12.4.0` 本机构建 addon，日志确认 `build/Release/contained_durable_replace.node`；四个 P8 定向 unit files 为 **4 passed / 96 passed**，没有 skipped；typecheck、workspace write check、workspace path target check、security 与 `git diff --check` 均成功。

这使 S2/S3 的 Linux source branch 不再是唯一证据，但只记录**macOS 和这个指定 GitHub-hosted Ubuntu/Linux x64 host 的 S2/S3 internal native 定向验证**。它不是全量或跨平台证明，不表示所有 Linux filesystem/kernel 或 Windows 支持，也不表示 tool durable write complete。S3 的 internal 分类不是 tool/API stable contract。

## 明确不包含与后续门槛

- **C-4P6 仍未完整关闭，仍是待办。**S1 未提供跨文件事务或共同原子性、rollback、删除、通用 migration 或新的外部 API。完整 P6 close-out 仍需单独批准并验证 manifest publisher 的 capability-policy 对齐、穷尽的 crash / failure 设计矩阵及运行验证。
- **C-4P8 仍未完成，仍是待办。**S1 descriptor foundation、仅 internal 的 S2 atomic `createNoOverwrite` foundation 与仅 internal 的 S3 restricted-overwrite foundation 已实施；S4 handler / API integration 仍未实施、未批准。S2/S3 不是 C-4P5 的 allowlisted document service。当前 `write_workspace_file` 有 pathname-based `overwrite` boolean，并在已有普通文件且 `overwrite: true` 时通过 pathname-based `writeFile()` 覆盖；它未接入 S3，不能作为 durable overwrite、atomic swap 或 S3 验证的证据。已记录的 Linux 证据仅为指定 GitHub-hosted `ubuntu-24.04` x64 host 上的 S2/S3 internal native 定向验证，不得泛化为跨平台、所有 Linux filesystem/kernel、Windows 或 tool durable write complete。
- **C-4P9 仍未完整关闭，仍是待办。**仅 P9-S2 已实施：固定 audit 文件的专用 framed、legacy-compatible durable append。它不是 generic JSONL migration、跨文件 transaction、ledger authority/save-order 变更、repair、rotation 或 IPC/UI；C-4P1 之外的剩余 P9 风险与 design gate 仍须保留。
- 高频日志不因本 ADR 自动改为逐条 fsync。

这些未完成范围、获批前置条件和 design gate 统一见[本地数据待办](../local-data-todo.md)。
