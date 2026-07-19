# C-4P8 Workspace tool durable publish：设计门（S1/S2 已实施；S3/S4 仍待批准）

> **状态：C-4P8 未完成。**S1 descriptor-bound foundation 已由 `80f2fd0`（`feat(data): add workspace descriptor foundation`）与 `e2ce36c`（`test(data): cover workspace descriptor foundation`）实施。S2 已由 `b46c8b2`（`feat(data): add workspace create no-overwrite`）与 `bdcd6cb`（`test(data): cover workspace create no-overwrite`）实施，范围仅为 **internal descriptor-bound atomic `createNoOverwrite` foundation**。S3 restricted overwrite 与 S4 handler/API integration 均未实施、未批准。本文保留它们的设计门和 Linux 验证风险；它不授权改变现有工具行为，也不宣称 P8 complete。

相关但不同的已实施 consumer 是 C-4P5 `TeachingWorkspaceDocuments` 的 allowlisted workspace Markdown publish。C-4P8 不继承 C-4P5 的 allowlist/service contract，也不能以 C-4P5 的测试或 shared `replaceDurably()` 通过作为 C-4P8 已迁移的证据。

> 后续工作的唯一入口见 [本地数据待办](../local-data-todo.md)；已实施决定及验证证据见 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。

## 已实施的 S1：descriptor-bound foundation（仍保留）

1. 只绑定既有、可信的 workspace root；不会从不可信 target pathname 创建 workspace root。
2. parent traversal 是 descriptor-bound、no-follow traversal；root 绑定后不退回 pathname traversal。workspace parent 的创建遵循 `0777 & umask` 的普通 mkdir 语义。
3. final leaf 以 no-follow inspect 分类为 absent、regular（mode、linkCount）、directory、symlink 或 other。
4. 提供 typed internal seam、operation records 与 internal errors；它们不是 tool/API 的稳定 contract。
5. capability 在不受支持的平台或不可用时 fail closed。

S1 本身不写 payload 或 temporary candidate、不发布文件，也不包含 workspace tool handler、registry、IPC、renderer 或 API 变更。

## 已实施的 S2：internal `createNoOverwrite` foundation（受限范围）

S2 在 S1 绑定的可信 workspace root 中实现 internal-only 的单文件 create protocol：在 **same parent descriptor** 下创建 temporary candidate，写入精确 UTF-8 bytes、file `fsync`、close，然后以 descriptor-relative exclusive rename 将 candidate 发布为 final name。

- macOS native primitive 为 `renameatx_np(..., RENAME_EXCL)`；Linux source path 为 `renameat2(..., RENAME_NOREPLACE)`。
- 缺少所需 atomic no-clobber primitive 时 fail closed。实现**不**使用 hardlink、`linkat`、pathname fallback、ordinary `rename` fallback 或“先检查再 rename”。
- existing final（无论 preflight 已存在，还是 publication race 中出现）均统一给 internal `target_exists`；竞争方 bytes 不得被 clobber。S2 不引入 existing target 的 overwrite/type-policy。
- publication 成功后，directory `fsync`、directory close 或 completion 失败统一以 internal `possibly_published` 报告：final 可能已存在，调用方不得将其当作“没有执行”。
- directory `fsync` 仅 `EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR` 五个 errno 可降级为一个 generic、无敏感信息的 warning；其它 I/O 或 close 错误仍为 fatal。warning 不含 workspace absolute path、parent descriptor path、temporary name、payload/content 或 raw I/O text。
- publication 使用 rename，不保留 temporary alias；S2 定向测试覆盖竞争 `EEXIST`、清理、post-publication `possibly_published`、five-code downgrade、existing regular/hardlink/directory/symlink/FIFO 和 native concurrent create。

S2 的 `target_exists`、`possibly_published` 与其它 error kinds 都是 internal protocol 分类，**不是** tool/API stable contract。它没有接入 handler、tool registry、IPC、renderer 或 API。当前 `write_workspace_file` 仍完全未接入，现有 handler 不变，且不支持 overwrite。

## 本轮验证边界与未关闭 Linux 风险

本轮实际验证的是当前 **macOS host-built addon**：

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit tests/unit/contained-durable-directory.unit.test.ts tests/unit/workspace-contained-directory.unit.test.ts tests/unit/workspace-contained-create-no-overwrite.unit.test.ts
pnpm run check:workspace-write-tool
node scripts/check-workspace-path-target.mjs
pnpm run typecheck
pnpm run check:security
git diff --check
```

三个定向 unit 文件共 **60 tests**。这不是全量 suite，也不是跨平台声明。尤其是 Linux `renameat2(..., RENAME_NOREPLACE)` 的 host-native exclusive-rename 行为本轮没有真实验证；源码存在 Linux 路径不能代替 Linux host-native build 与 targeted test。仓库没有 `.github` CI 目录，因此没有可引用的仓库内 Linux CI 覆盖。该 Linux 验证必须作为后续验收保留，P8 不得被称为跨平台完成。

## 固定 scope 与非目标

若 S4 将来获批，consumer scope 才会是 agent workspace tool 的任意受控单个文本文件写入：输入先通过现有 workspace policy 与受控相对路径解析，随后才可能在 workspace-root descriptor capability 内调用已批准的 operation。

它不等于、也不扩展为：

- C-4P5 `TeachingWorkspaceDocuments` 的 allowlisted document service；
- trace / traceId、actionId、receipt 或任何 correlation/idempotency 协议；
- IPC、renderer/UI、tool registry 暴露或权限模型变更；
- workspace registry、touch/save registry、conversation audit、JSONL append、transactions 或跨文件原子性；
- migration、repair、历史扫描/回填、backup、retention 或 schema change；
- 任何其它 workspace writer 的迁移。

## S3 设计门：restricted overwrite（未实施、未批准）

S3 必须是独立于 S2 的 operation。它只能对 descriptor-bound type/policy 验证后允许的 target replacement；它不是 CAS，也不承诺检测、合并或阻止 validation 与 publication 间的 external concurrent mutation。任何需要版本匹配、lost-update 防护或 action/receipt 语义的 feature 必须另立设计。

S3 获批前必须明确：

1. existing regular、hardlink、directory、symlink、device/FIFO/socket 的 type 与 hardlink policy；S2 对 existing final 的统一 `target_exists` 不等于 S3 批准了任何 overwrite；
2. temp-alias cleanup、首次/最终 parent-directory `fsync`（包括是否需要第二次 sync）、success acknowledgement 和 failure recovery；
3. 新建 `0666 & umask`、overwrite 后普通 permission bits，以及不恢复 setuid/setgid/sticky 的承诺边界；
4. descriptor-bound parent/final symlink swap、child traversal swap、capability unavailable 的 fail-closed behavior；不得 pathname fallback；
5. 可控 I/O seam 和针对 write/file sync/close/publication/directory sync/close/cleanup 的确定性 failure matrix。

## S4 设计门：handler / API integration（未实施、未批准）

S4 不能通过“让 `write_workspace_file` 改用 `replaceDurably()`”获得。获批前必须保留当前 handler 行为，并明确：

1. 是否暴露 create、overwrite 或两者；若暴露 overwrite，必须先有已批准的 S3；
2. stable、安全的 external error/result contract，至少区分 request/relative-path policy rejection、containment unavailable 或 path/type rejection、`target_exists`、pre-publication failure 与 `possibly_published`；不得泄露 absolute path、descriptor path、temporary name、payload/content 或 raw native error；
3. `possibly_published` 的 UX/API：不得自动重试成“尚未执行”，必须定义 canonical re-read、显式 retry 条件，以及 retry 不绕过 no-clobber contract；
4. handler privacy 与 compatibility regression，包括 no-overwrite、path containment、只读 registry/enablement policy；S4 才能决定是否以及如何将 internal classifications 映射为 external values。

## 后续验收与批准顺序

C-4P8 现在不是“无实施”，但仍不能关闭。后续必须按 **S3 → S4** 继续，且每个切片都要独立获 scope / owner / API 批准。Linux host-native exclusive rename 验证也是未关闭验收项；若没有真实 Linux host build 和定向测试，就不得把 source-level `renameat2` 路径视为 cross-platform completion。

在这些批准和验证完成前，任何直接替换为 `replaceDurably()`、只补 pre/post `realpath`、或把 S2 internal foundation 接入 `write_workspace_file` 的改动，都不得称为 C-4P8 complete、workspace tool durable write delivered 或 handler migration。
