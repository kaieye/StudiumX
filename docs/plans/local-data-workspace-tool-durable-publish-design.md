# C-4P8 Workspace tool durable publish：已关闭的历史设计

> **状态：已关闭（历史设计）。**gpt-5.6-sol 已作 CLOSE_P8 决定：C-4P8 仅在受控 `write_workspace_file` 的文本文件 create / restricted-overwrite scope 关闭。本文保留 S1–S4 的决策历史、边界和非目标；当前实施事实、提交证据和验证入口以 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 为准。它不是下一步工作入口，也不授权把此 scope 扩大为所有 writer migration 或完整 C-4 closure。

S1 的 workspace descriptor foundation 由 `80f2fd0` / `e2ce36c` 实施；S2 的 internal descriptor-bound atomic `createNoOverwrite` 由 `b46c8b2` / `bdcd6cb` 实施；S3 的 internal descriptor-bound restricted overwrite 由 `56eabe6` / `54506d5` 实施；S4 handler/API integration 由 `0bbfdef` / `e84c813` 实施并完成本设计所限定的 tool scope。

相关但不同的已实施 consumer 是 C-4P5 `TeachingWorkspaceDocuments` 的 allowlisted workspace Markdown publish。C-4P8 不继承 C-4P5 的 allowlist/service contract，也不能以 C-4P5 的测试或 shared `replaceDurably()` 通过作为 C-4P8 的证据。

## 后续收敛：runtime platform capability policy

本历史设计关闭后，runtime 采用两个明确不同的 profile。POSIX 继续只在实际 descriptor-relative durable capability 可用时注册 `write_workspace_file`，addon 不可加载时仍 fail closed；它绝不退回 pathname write。2026-07-19 Windows host-native/SDK audit 确认：`NtCreateFile` 的 `RootDirectory`、`OBJ_DONT_REPARSE` 和 `FILE_OPEN_REPARSE_POINT` 可作为 HANDLE-relative/no-follow S1/S2 的候选，但已审计的 `FileRenameInfo[/Ex]` 与 `ReplaceFileW` 不提供“expected target file ID 仍匹配才替换”的 compare-and-swap / exchange。先检查 file ID 再做 handle-relative replacement 仍有 race，不能满足原先的 target-identity precondition。

因此在同日获得用户明确批准后，Windows 实现一个**不同的 root-constrained direct-path profile**，参考 `codex-rust` 的“上层 sandbox/root policy + `write`”分层：上层只接受 workspace 内相对路径，进行既有 symlink/realpath containment 检查；S2 用 `wx` create-no-clobber，S3 只对既有 `nlink = 1` regular file 以 non-creating `r+` direct handle truncate/write/sync，成功后 exact reread。它保留 tool 的审批、journal replay、隐私化稳定 error 与 fail-closed 前置检查，但**不是** descriptor/HANDLE-bound traversal、target-file-ID CAS、POSIX atomic exchange、directory-fsync durability 或 Windows strict containment 声称。external reparse/leaf replacement race 超出该 profile 的安全保证；不得把它描述为 Windows durable publish。

其它不支持的 host 仍不注册 write definition/handler，稳定返回 `{ available: false, code: 'containment_unavailable', message: '当前平台无法安全发布工作区文件。' }`。Windows 上 profile 可用时，既有 `full_access`、`based_on_approval` 和 `request_approval` 正常适用。当前实施事实和验证入口仍以 ADR-0004 为准。

> 未完成工作的唯一入口见 [本地数据待办](../local-data-todo.md)。

## 历史 S1：descriptor-bound foundation

1. 只绑定既有、可信的 workspace root；不会从不可信 target pathname 创建 workspace root。
2. parent traversal 是 descriptor-bound、no-follow traversal；root 绑定后不退回 pathname traversal。workspace parent 的创建遵循 `0777 & umask` 的普通 mkdir 语义。
3. final leaf 以 no-follow inspect 分类为 absent、regular（mode、linkCount）、directory、symlink 或 other。
4. typed internal seam、operation records 与 internal errors 不构成 tool/API 的稳定 contract。
5. capability 在不受支持的平台或不可用时 fail closed。

S1 本身不写 payload 或 temporary candidate、不发布文件，也不单独构成 handler、registry、IPC、renderer 或 API 变更。

## 历史 S2/S3：内部发布 foundation

S2 在 S1 绑定的可信 workspace root 中，在 **same parent descriptor** 下创建 temporary candidate、写入精确 UTF-8 bytes、file `fsync`、close，并以 descriptor-relative exclusive rename 发布 final name。macOS 使用 `renameatx_np(..., RENAME_EXCL)`；Linux 使用 `renameat2(..., RENAME_NOREPLACE)`。缺少 primitive 时 fail closed；不使用 hardlink、`linkat`、pathname fallback、ordinary `rename` fallback 或“先检查再 rename”。existing final 的 S2 结果为 internal `target_exists`。

S3 只 replacement 既有 `nlink = 1` regular leaf。目录、symlink、hardlink、FIFO、device、socket 和其它 non-regular target 都 fail closed。它以 descriptor-bound/no-follow、same-parent atomic swap 实现：macOS `renameatx_np(..., RENAME_SWAP)`，Linux `renameat2(..., RENAME_EXCHANGE)`；不使用 pathname、ordinary rename 或 hardlink fallback。

S3 candidate 以 `0666 & umask` 创建，并在发布前采用旧 target normal mode `& 0777`。不承诺 setuid/setgid/sticky special bits、inode/hardlink identity、owner/group、ACL、xattr、birth time 或其它 metadata 的完整保留。S3 不是 CAS：没有版本匹配、合并或 lost-update protection，也不承诺检测/阻止 validation 与 publication 间的 external concurrent mutation。

swap 前失败保留 primary target，并 cleanup/sync candidate；swap-success marker 后错误为 internal `possibly_published`。成功 swap 后按首次 directory `fsync` → old-alias unlink → 第二次 directory `fsync` → close 的顺序执行；不得 rollback、删除 canonical target 或以旧内容再次覆盖。

## 已实现的 S4：tool contract 与恢复边界

`write_workspace_file` 的请求保持 `{path, content, overwrite?}`：

- `overwrite` 缺省或为 `false` 时使用 S2 no-clobber create：目标不存在时创建，目标已存在时返回 `target_exists`，不覆盖已有内容；
- `overwrite: true` 时，目标不存在仍使用 S2 create；目标已存在且是 `nlink = 1` 的 regular file 才使用 S3 restricted overwrite；
- directory、symlink、hardlink、FIFO、device、socket 和其它 non-regular target 均返回 `path_rejected`，不运行任一 publisher；预检时 absent 但发布时已有目标出现返回 `target_exists`，原本合格的 regular target 在 S3 前消失、类型改变或不再满足条件返回 `target_changed`；
- 任何失败（包括 `target_exists`、`target_changed`、`prepublication_failed` 和 `possibly_published`）都不得自动 retry、rollback 或删除 canonical target；`possibly_published` 也不得被解释为“未执行”。

稳定 code 为 `request_rejected`、`path_rejected`、`containment_unavailable`、`target_exists`、`target_changed`、`prepublication_failed`、`possibly_published`。tool result 不得泄露 raw internal error、absolute path、payload/content、descriptor path 或 temporary name。

`possibly_published` 在 POSIX 只通过 descriptor-bound canonical regular leaf 的完整字节 reread 处理；Windows direct-path profile 通过再次 realpath-contained 的 direct-path reread 处理：完全一致时返回 `possiblyPublished: true`、`canonicalRead: 'exact'`、`retryable: false`；无法确认时返回 `code: 'possibly_published'`、`retryable: false`。journal 对相同 `toolCallId` replay 已记录结果，避免第二次 publish。

## 已记录验证

最终本地验证在 macOS 构建 native addon，并运行五个定向 unit 文件共 **123 tests passed**：

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

这不是 full suite。`ed8d88a` / `9c452f3` 还记录了 2026-07-19 GitHub-hosted `ubuntu-24.04` x64、Node `22.23.1` 上 S2/S3 native branch 的本机构建和四个 P8 定向 unit files（**4 passed / 96 passed**、没有 skipped）；该 hosted evidence 不代表所有 Linux filesystem/kernel、Windows 或 fully cross-platform 支持。

## 固定非目标

本设计关闭的范围不包括：

- 所有 writer migration、其它 workspace writer 或 C-4P5 allowlisted document service 的替代；
- 跨文件 transaction、共同原子性、CAS 或 lost-update protection；
- trace / traceId、全局 actionId、receipt 或跨工具 idempotency 协议；
- IPC、renderer/UI、prompt 或 approvalMode 语义变更；本轮只增加 profile-aware eligibility，不把 Windows direct-path profile 伪装为 POSIX native capability；
- workspace registry、touch/save registry、conversation audit、generic JSONL、migration、repair、历史扫描/回填、backup、retention 或 schema change；
- POSIX-equivalent Windows strict containment/CAS、fully cross-platform 支持或 metadata full preservation。
