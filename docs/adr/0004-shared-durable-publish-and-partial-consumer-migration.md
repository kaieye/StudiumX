# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **状态：** 已实施（部分 consumer migration）。C-4P6 仅有 S1 的生产基础；S2…S194 是 tests-only evidence。**受限 macOS/APFS P6 profile 已由 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 结项**，不是开放可分派实现工作。C-4P8-S1…S4 的受控 `write_workspace_file` scope 已关闭（含获批的 Windows direct-path non-CAS profile）；**Windows strict 以 ADR-0021 结项为 no-go / unsupported**。C-4P9 仅有 S2 的 audit 专用 durable append，S3…S45 为 tests-only evidence；**fixed-file audit boundary 已由 ADR-0021 结项且不扩张**。部分 consumer migration 本身仍是本 ADR 的历史边界：未被审查的 writer 未迁移。
- **范围：** C-4、C-4P0…P5、C-4P6-S1，以及 C-4P6-S2…S194（tests-only）；C-4P7；C-4P8-S1…S4 和 Windows direct-path non-CAS profile；C-4P9-S2，以及 C-4P9-S3…S45（tests-only）。P6 / P8 Windows strict / P9 扩展的结项权威见 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md)。
- **历史证据：** 各已迁移 consumer 的实施提交和验证入口见下表。P6 生产基础为 `7292bf4` / `e02a086`；早期 tests-only 切片为 `9847842` / `1334513`；其后的 P6 tests-only historical range 为 `e821c69`…`c1fb162`。

## 背景

关键本地数据 writer 曾分别实现 publish、append、path containment 与失败处理，容易让局部成功被误解为统一 durability、跨文件 transaction 或所有平台同等保证。需要一个共享 capability，同时仍让每个 consumer 明确自己的 canonical authority、路径限制、平台 profile 与恢复语义；未被审查和验证的 writer 不能因共享实现存在而自动获得该保证。

## 决定

以共享 durable-file capability 承担经过审查的关键文件 replace / publish 语义，并逐项迁移 consumer；每个 consumer 保留自身的 canonical authority、路径约束和错误语义。C-4 的完成含义是“共享原语及下列 consumer 已迁移”，**不是所有 writer 已迁移**，也不构成跨文件事务。

`C-4P6-S1` 已实施的范围仅为 **严格有序发布与受控恢复基础**。它不是完整的 C-4P6；不提供跨文件事务或共同原子性，也不构成完整 durable closure。P6 后续以受限 macOS/APFS profile 结项的权威决定见 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md)。

## 后果与实施边界

- 新 consumer 必须逐项审查并单独迁移；共享原语、既有测试或某一 consumer 的 close-out 都不授权扩大到其它 writer。
- 每个 consumer 继续拥有自身的 canonical authority、路径约束、错误结果与恢复顺序；失败、可能已发布或无法证明的状态不得被通用地自动 retry、rollback、delete 或报为成功。
- 本 ADR 的 production 范围、tests-only historical evidence 与 **out-of-scope / future-gated non-claims** 必须分开阅读。P6 受限 profile、P8 Windows strict no-go 与 P9 fixed-file 不扩张，已由 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 结项；这些不再是当前可分派的 local-data 实现切片。任何更强 durability、transaction、generic JSONL、Windows strict、IPC/UI 或 public-result 扩张，都必须由**新的 ADR** 重新定义 profile 与证据门槛，而不是把本文件或历史 design gate 当作开放待办。

## 已迁移 consumer、实现范围与验证入口

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
| C-4P6-S2…S194 `9847842`、`1334513`、`e821c69`…`c1fb162` | **tests-only historical evidence**：S2 覆盖单一 `after_outcome_publish` restart/reconcile，S3 覆盖 settlement-marker durable-rename `EIO` 后仅补 marker；S4…S194 在同一 learning-outcome unit suite 中累积 ordered-publish interruption、marker/record/manifest 的冲突或非安全输入、stage/publish/ledger failure，以及 commit 前 session/event validation 的 fail-closed residual。没有 production/API/schema/path/order 改动；这些测试不构成完整 P6 closure。 | `pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`；历史定向基线为 1 file、219 tests passed |
| C-4P7 `0d55fd8` | private `MusicCookieStore` cookie state | `tests/unit/music-cookie-store-durable.unit.test.ts` |
| C-4P8-S1 `80f2fd0`、`e2ce36c` | workspace descriptor foundation：可信既有 workspace root 绑定、descriptor-bound parent traversal 与 final-leaf inspection | 下列 C-4P8 最终定向验证 |
| C-4P8-S2 `b46c8b2`、`bdcd6cb` | internal descriptor-bound atomic `createNoOverwrite` foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S3 `56eabe6`、`54506d5` | internal descriptor-bound restricted-overwrite foundation | 下列 C-4P8 最终定向验证 |
| C-4P8-S4 `0bbfdef`、`e84c813` | 受控 `write_workspace_file` 文本文件 create / restricted-overwrite handler integration、稳定结果和同 toolCallId journal replay | `tests/unit/workspace-write-tool.unit.test.ts` 与下列最终定向验证 |
| C-4P9-S2 `4b30220`、`5f47382` | 固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append；不 rotation、不迁移其它 JSONL | 下列 C-4P9 evidence summary |
| C-4P9-S3…S45 `c286a42`…`33a914a` | **tests-only historical evidence**：覆盖 fixed-file audit append 的 partial/torn-tail/dedupe recovery、archive failure/retry、capability downgrade/fail-closed、ledger residual、concurrency/conflict、archive publish short-circuit，以及 audit I/O/transfer failure；无 production/API/schema/path/order 改动，不能扩大 S2 scope 或把 S2…S45 误读为 generic JSONL / rotation / repair 已交付。代表性提交见下列 summary。 | `tests/unit/agent-conversation-session-audit.unit.test.ts`、`tests/unit/agent-conversation-archive-durable.unit.test.ts`；可信历史定向基线为 S3 的 2 files、61 tests passed（非当前或累积计数） |

共享原语和关键状态备份的验证也由 `tests/unit/durable-file.unit.test.ts` 覆盖。

## C-4P6-S2…S194：tests-only historical evidence summary（受限 profile 已由 ADR-0021 结项）

`C-4P6-S1`（`7292bf4` / `e02a086`）是唯一已实施的 production foundation：learning-outcome 的严格有序 publish、受控 reconcile 与失败关闭。相关历史验证覆盖 41 项 unit 和 14 项 integration；该数字只说明 S1 的有限验证，不是完整 C-4P6 矩阵。

`C-4P6-S2…S194` 均为**仅修改测试的历史证据切片**，不改变 production/API/schema/path/order。保留的关键历史锚点是：S2 `9847842` 的单一 `after_outcome_publish` restart/reconcile；S3 `1334513` 的 settlement-marker durable-rename `EIO` 后仅补 marker（不是泛化 `after_manifest_publish`）；以及 S4…S194 `e821c69`…`c1fb162` 对有序发布中断、marker/record/manifest 非安全或冲突状态、stage/publish/ledger failure、以及 commit 前 session/event 校验的 fail-closed residual 的累积覆盖。

- **历史定向测试基线：**`pnpm exec vitest run --project unit tests/unit/learning-outcome-committer.unit.test.ts`，1 file、**219 tests passed**。这是该定向 unit suite 的历史基线，不是 full suite，也不是完整 durability / failure-matrix 证明。
- **已证实的边界：**这些 residual 证明特定注入点下的 fail-closed、受控 reconcile 或不重写行为；不新增 production contract。S3 不等同于泛化 `after_manifest_publish` 或完整 manifest failure matrix。
- **Phase 0 已冻结（决策 only）：**[ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md) 选定 `P6-macOS-local-APFS-strict-candidate` 为首个目标 profile，并冻结 participant inventory、public-result 不扩展、Windows non-strict 与 directory-sync 不对齐事实。
- **Phase 1 已落地（实现 + unit，非 universal close-out）：**共享 directory-sync soft allowlist；committer outcome/marker 经 Session parent containment 后再 durable replace；ledger 不再 soft-downgrade `EPERM|EACCES`；immutable record 仍 strict。详见 ADR-0020 后果补充与 [P6 历史计划](../plans/local-data-learning-outcome-durable-settlement-design.md)。
- **受限 profile 结项（ADR-0021）：**`P6-macOS-local-APFS-strict-candidate` 的有序 settlement/reconcile、fresh-process crash/restart 验证与 operations runbook 已作为该工作线 close-out evidence 被接受；权威见 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md)。结项验证入口：

```sh
node scripts/verify-c4p6-host-native.mjs
pnpm exec vitest run --project integration \
  tests/integration/learning-outcome-committer-process.integration.test.ts
```

该结项只适用于 verifier 输出的本机 internal APFS repository 与 fixture volume。它不宣称跨文件 transaction、共同原子性、Windows strict、网络/可移动存储、reboot durability 或 power-loss durability。未知 publish 后状态仍按既有 `reconciliation_required` / `review_required` fail closed；不新增 public IPC result。
- **明确 non-claims / future-gated（非当前开放待办）：**
  1. 跨文件 transaction / common atomicity、rollback 与 delete 语义（明确不在范围，不得借 close-out 引入）；
  2. 超出已结项 macOS/APFS profile 的 host-native 证据、Windows power-loss / strict，或其它 OS/filesystem/durability claim；
  3. 新的 migration、public API 扩张或 operations validation，若其声明超过 ADR-0021 已接受的受限 profile。

因此，不得从 S1、S2…S194、Phase 0 决策、Phase 1 unit residual 或受限 profile 结项推断跨文件原子性、通用 host-native settlement，或 Windows power-loss / strict closure。扩大到新的 OS、filesystem、durability claim、writer 或 public result，必须**新建 ADR** 并重新提供匹配声明的 host-native/operations evidence；历史 design / runbook 仅作已结项 profile 的证据与操作参考，不再是可分派实现任务入口。Phase 0 背景见 [ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md)；结项权威见 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md)。

## C-4P8：已关闭的受控 workspace-tool scope

C-4P8 的 S1 至 S4 已在**受控 `write_workspace_file` 文本文件 create / restricted-overwrite scope**关闭。S1 的 workspace descriptor foundation 证据为 `80f2fd0` / `e2ce36c`；S2 的 `b46c8b2` / `bdcd6cb` 和 S3 的 `56eabe6` / `54506d5` 仍是 POSIX descriptor-bound foundation；S4 的 handler/API integration 与定向测试为 `0bbfdef` / `e84c813`。2026-07-19 经明确批准后，Windows 另实现 root-constrained direct-path profile；它不把 Windows 冒充为该 descriptor-bound foundation。**Windows strict proposal 已由 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 结项为 unsupported / no-go**；这不移除已批准的 Windows direct-path non-CAS scope，也不把它重新命名为 strict。

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

[ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 进一步把当前 Windows/NTFS strict proposal 结项为 **unsupported / no-go**：不实现替代的 pathname fallback、preflight-only CAS 或 strict-success result。若未来要交付与 POSIX 相当的 Windows strict profile，仍需要可审计且能在实际 publish 点施加 expected final-leaf identity precondition 的 Windows/NTFS publish primitive，并在**独立新 ADR** 中给出 HANDLE-relative/reparse proof、flush/close contract 与目标 Windows host-native evidence；仅增加 HANDLE-relative S1/S2 不足以达到该标准。当前 Windows direct-path profile 是经批准的较弱合同，不修改下方既有 macOS/Linux descriptor 验证记录。

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

## C-4P9：生产范围、历史 evidence 与 fixed-file 结项边界

**C-4P9 的 V1 fixed-file audit boundary 已由 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 结项，且不扩张。** 生产实现仅为 P9-S2；P9-S3…S45 均为随后累积的 **tests-only historical evidence**，没有 production/API/schema/path/order 改动，也不应被解释为 generic JSONL migration、rotation/repair 交付，或更强 durable profile。

### P9-S2 已实施的受限生产语义

- 仅替换固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit append boundary：framed、legacy-compatible、fixed-file durable append；不 rotation，且不调用或迁移到 generic `durable-jsonl`。
- 模块私有 queue 按规范化绝对 audit path 串行化；同一路径在一个 descriptor 生命周期内完成 exact-byte read、canonical/legacy validation、dedupe/conflict 判定、framed append、file `fsync` 与 `close`。
- 仅追加缺失的 canonical rows：保留既有 raw bytes；仅在既有非空末字节不是 LF 时插入隔离 LF；legacy trace-free/malformed-trace rows 可读取，既有 trace write-once 行不回填或重写。
- file close 后，按 audit directory、再 conversation parent directory 的子到父顺序确认 durability。directory `open`/`sync` 的 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 可降级为固定通用 warning；其它错误及任何 `close` failure 均 fatal。
- post-directory failure 会使 save reject 而不回滚；retry 重新读取并 exact-row dedupe，之后才允许既有 ledger flow 继续。

### P9-S3…S45 的压缩历史 evidence

这些切片只为既有 S2 及 archive save 行为补充定向单元测试。代表性 evidence 为：

- **`c286a42`（S3）与 `ab723a6`（S4）：** fixed-file non-rotating append 的 partial prefix、torn-tail framing、dedupe recovery，以及首个 audit write `EIO` 和 archive-level failure/retry 的 short-circuit；历史定向基线为下列两个 unit 文件 **2 files、61 tests passed**。这是切片当时的记录，并非当前或累积计数。
- **`47393f9`（S5）：** audit directory 与 conversation parent directory 的 `open`/`sync` capability allowlist 对称性、通用 warning 不泄露敏感内容，以及 `close` 仍 fatal。
- **`5f931c9`、`816e403`、`bee173f`、`dcb9bae`（S6…S9）：** ledger failure 后的 retry/idempotency、并发相同 append 的线性化，以及 divergent trace 或同 ID canonical-body conflict 的 fail-closed 行为。
- **`9d54c5e`…`be460a4`（S10…S14）：** JSON/Markdown publish 后的 directory failure 与 audit/ledger short-circuit residual；这些是 archive-order 的定向回归测试，不是跨文件事务实现。
- **`8779879`…`33a914a`（S15…S45）：** audit file/directory 操作的 fatal-error、unknown-error、non-file target、partial/negative transfer 和 read/write stall 的 fail-closed residual。

历史验证入口：

```sh
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
```

### 明确 non-claims / future-gated（非当前开放待办）

[ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 不批准把现有 fixed-file audit boundary 扩张为下列能力；它们是 **out-of-scope / future-gated non-claims**，不是仍可分派的 local-data 实现切片：

1. **通用 JSONL、rotation 与 repair：** 将 audit 专用 fixed-file append 扩展为经审查的 generic JSONL capability，并定义 rotation、损坏恢复/repair 与迁移边界。
2. **完整 capability matrix：** 为文件、目录和平台差异建立完整的 supported/degraded/fatal 能力矩阵，而非仅保留当前定向 errno evidence。
3. **跨文件语义：** 跨文件 transaction/恢复模型、ledger authority，以及 archive JSON、Markdown、audit 和 ledger 的权威性与顺序约束。
4. **IPC/UI：** 调用方 IPC contract、UI 状态/错误呈现和端到端 consumer integration。
5. **运维验证：** observability、metrics/logging、rollout、backfill/repair runbook 和实际环境验证，若其声明超过现有 V1 fixed-file boundary。
6. **平台与断电限制：** 目标平台、文件系统与 power-loss/crash 一致性；不能以当前 unit fault injection 代替该验证，也不能把 directory-sync warning 误读为 strict/power-loss proof。

现有 audit 仍是 per-conversation、append-only、ordered-best-effort 的 session evidence：进程内同路径 queue 不是跨进程 exclusion；audit outcome 也不决定 JSON、Markdown 或 learning-work ledger 的 authority。该边界不要求新增 writer 行为或 caller disposition。

若产品需要上述任何扩张，必须由**新的 ADR** 先定义 profile、single-/multi-writer protocol、failure/recovery matrix、archive caller disposition、privacy/operations owner 和所声明 profile 的 host-native evidence；不得把本 ADR 的历史 evidence 或 ADR-0021 结项解释为这些能力已经实现或仍是当前开放待办。
