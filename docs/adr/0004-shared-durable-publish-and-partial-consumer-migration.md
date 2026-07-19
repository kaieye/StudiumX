# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **状态：** 已实施（部分 consumer migration；包含 C-4P6-S1 的受限基础、C-4P8-S1/S2/S3 foundation 与 C-4P8-S4 受控 `write_workspace_file` 文本文件 create / restricted-overwrite closure，以及 C-4P9-S2 audit 专用 durable append 与 P9-S3 tests-only evidence）
- **范围：** C-4、C-4P0、C-4P1、C-4P2A、C-4P2B、C-4P3、C-4P4、C-4P5、C-4P6-S1、C-4P7、C-4P8-S1、C-4P8-S2、C-4P8-S3、C-4P8-S4、C-4P9-S2、C-4P9-S3（tests-only evidence）
- **证据提交：** `ca73537`、`5c0dd96`、`34c48f4`、`b8eb3ab`、`70afe1d`、`99bf6fe`、`f8ad99c`、`278f141`、`7292bf4`、`e02a086`、`0d55fd8`、`80f2fd0`、`e2ce36c`、`b46c8b2`、`bdcd6cb`、`56eabe6`、`54506d5`、`ed8d88a`、`9c452f3`、`0bbfdef`、`e84c813`、`4b30220`、`5f47382`、`c286a42`

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
| C-4P8-S1 `80f2fd0`、`e2ce36c` | workspace descriptor foundation：可信既有 workspace root 绑定、descriptor-bound parent traversal 与 final-leaf inspection | 下列 C-4P8 最终定向验证 |
| C-4P8-S2 `b46c8b2`、`bdcd6cb` | internal descriptor-bound atomic `createNoOverwrite` foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S3 `56eabe6`、`54506d5` | internal descriptor-bound restricted-overwrite foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S4 `0bbfdef`、`e84c813` | 受控 `write_workspace_file` 文本文件 create / restricted-overwrite handler integration、稳定结果和同 toolCallId journal replay | `tests/unit/workspace-write-tool.unit.test.ts` 与下列最终定向验证 |
| C-4P9-S2 `4b30220`、`5f47382` | 固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append；不 rotation、不迁移其它 JSONL | 下列 C-4P9-S2/S3 验证命令 |
| C-4P9-S3 `c286a42` | **tests-only evidence**：补齐 P9-S2 的 partial-write 与 archive-level failure/retry 定向证据：fixed-file non-rotating audit append 的 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动 | 2 个 unit 文件、61 tests passed；另有本主会话的 typecheck、security check、diff check |

共享原语和关键状态备份的验证也由 `tests/unit/durable-file.unit.test.ts` 覆盖。

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

### Runtime 平台 capability 与产品边界

本轮选择 **capability-aware fail-closed 产品策略**，而非声称已经实现 Windows 原生 durable publish。native addon 目前只有 host-built POSIX 的 descriptor-relative/no-follow 实现；Windows 分支明确拒绝 descriptor-relative traversal，且没有 `HANDLE`-relative / reparse-point-safe 等价实现。因此任何不可用 host（包括 Windows，或 POSIX host 上 addon 不可加载）都**不得**退回 pathname `writeFile`、`rename`、先 `lstat` 后写或任何其它 TOCTOU 方案。

- `getWorkspaceWriteToolAvailability()` 将底层 capability 映射成稳定的产品状态：可用时仅返回 `{ available: true }`；不可用时返回 `{ available: false, code: 'containment_unavailable', message: '当前平台无法安全发布工作区文件。' }`，不携带本地路径、loader、errno、descriptor 或 temporary-name 细节。
- `buildDefaultRegistry()` 只有在调用方已请求 workspace write、workspace read 已启用且该 capability 可用时才注册 `write_workspace_file`。不可用时所有只读 workspace 工具保持注册，但 write definition 和 handler 均不存在；这会在模型调用和 permission UI 之前阻止请求，因而不会出现“已批准写入”随后才安全失败的产品承诺，也不会为该 tool 创建 operation journal 条目。
- `settings.tools.approvalMode` 仍是已注册 writer 的唯一审批模型：`full_access`、`based_on_approval` 与 `request_approval` 的已有语义不变；capability 不可用时三者都没有可审批的 workspace write。没有重新引入 `workspaceWritePermission` 运行时字段。
- 直接调用内部 handler 时，下层 publisher 仍保持稳定的 `containment_unavailable` fail-closed result；这只是防御纵深，不是产品暴露路径。

Windows 上的真实行为因此是：不暴露 `write_workspace_file`、不显示该 tool 的审批请求、不创建或覆盖目标，且不泄露 native 细节。Linux（以及现有 POSIX native branch）保持 S2/S3 真正发布、对抗性拒绝、same-`toolCallId` completed replay 不二次发布及 `possibly_published` exact canonical-read 恢复语义。Windows 原生实现若要进入后续工作，必须先独立设计和验证 HANDLE-relative traversal、reparse point/junction 处理、no-overwrite 与 restricted-overwrite 的原子/durability 语义，以及 host-native adversarial CI；在此之前这个 registry gate 不得被绕过。

### 2026-07-19 Windows host-native feasibility audit（阻塞证据，不是 Windows support）

本轮在 Windows host（Windows SDK `10.0.26100.0`、Node `24.13.0`、VS 2022 Build Tools）实际重建了当前 native addon；它能编译，但现有 `_WIN32` 分支仍明确拒绝 descriptor-relative traversal，因而**没有**把 writer gate 打开，也没有把“addon 可编译”误记为 Windows publish 证据。

在 Microsoft SDK headers 和 Microsoft 文档允许的范围内，已核验 `NtCreateFile` 的 `RootDirectory`、`OBJ_DONT_REPARSE`、`FILE_OPEN_REPARSE_POINT` 与 `FILE_CREATE` 可用于 HANDLE-relative/no-follow traversal 与 S2 create-new；`GetFileInformationByHandleEx` 可提供 reparse、directory、link-count 和 file-ID 检查；`FlushFileBuffers` 可用于已打开 file/directory handle 的 flush。可是 `SetFileInformationByHandle(FileRenameInfo[/Ex])`、`ReplaceFileW` 以及相关 rename API 都没有“仅在期望 file ID 仍是当前 target 时替换”的 compare-and-swap / exchange parameter。持有 target handle 并拒绝 delete sharing 会阻止攻击者替换，却也会阻止替换发布；在 publish 前释放则重新引入 inspect-to-publish race。

因此，使用已审计的 Windows API 不能证明**本次 Windows 任务所要求**的 S3 “existing single-link regular、target identity unchanged、atomic restricted overwrite”同时成立。尤其不能把“先以 HANDLE 检查，再以 handle-relative rename replace”描述为 target-changed-safe；它仍可能替换检查后被并发换入的 leaf。为保持 fail-closed，本轮没有加入 pathname fallback、没有用 `MoveFileEx` / `ReplaceFile` / preflight `lstat` 充当安全基础，也没有使 `getWorkspaceWriteToolAvailability()`、registry 或 approval flow 在 Windows 上变为可用。

要解除该 gate，需要一个可审计且能提供该原子 identity precondition 的 Windows/NTFS publish primitive（或经批准改变 S3 contract 的新设计）；仅增加 HANDLE-relative S1/S2 不足以安全暴露当前同时提供 S2 和 S3 的 writer。这个结论不修改下方既有 macOS/Linux 验证记录。

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
- IPC、renderer/UI、prompt 或 approvalMode 语义的变更；本轮仅把既有 registry 的 write eligibility 与真实 native capability 对齐；
- workspace registry、touch/save registry、conversation audit、generic JSONL、repair、migration、backup、retention 或 schema change；
- Windows、所有 Linux filesystem/kernel，或 fully cross-platform support 的宣称；
- 完整 metadata preservation。

C-4P5 的 allowlisted Markdown service 是不同 consumer；其 allowlist/service contract 不由 C-4P8 继承或替代。

## C-4P9-S2 实施与 P9-S3 evidence 验证入口

C-4P9 只实施了最小切片 S2；P9-S3 是严格 tests-only evidence slice。S2 证据提交为 `4b30220`（`feat(data): add durable session audit append`）和 `5f47382`（`test(data): cover durable session audit append`）；S3 证据提交为 `c286a42`（`test(data): cover audit durable append recovery`）。P9-S3 补齐 P9-S2 的 partial-write 与 archive-level failure/retry 定向证据：fixed-file non-rotating audit append 的 partial prefix、torn-tail framing、dedupe recovery，以及 archive-level audit file `sync`/`close`、audit directory `open`/`sync`/`close`、conversation parent directory `open`/`sync`/`close` failure 后的 clean retry；无生产语义改动。以下是本次受限 evidence slice 的实际验证命令和结果，不是完整 suite 的声明：

**P9-S3 tests-only evidence slice 已完成，并补齐 P9-S2 的 partial-write 与 archive-level failure/retry 定向证据；C-4P9 仍未关闭。**

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
- post-directory failure 会使 save reject 且不回滚；retry 先重新读取、dedupe exact rows，再允许既有 ledger flow 继续。

这不关闭 C-4P9，也不表示 generic JSONL migration、跨文件 transaction、ledger authority/save-order 改造、repair、rotation 或 IPC/UI 已交付。未完成工作仍见[本地数据待办](../local-data-todo.md)。
