# 本地数据待办

> 本文是本地数据**下一步工作的唯一入口**。已完成的架构决定及其证据见 [ADR 索引](adr/README.md)。
>
> 下列条目记录未完成范围及待批准的设计门；设计文档不是实现授权。个别条目会标明已实施的受限切片，但不得把该切片的建议、验证矩阵或候选 contract 扩大为 complete durable closure。

## 先决规则

1. 任何后续切片先在对应 design gate 获得 scope / owner / API 批准，再单独立项；不得直接修改其 writer 以“顺手迁移”。
2. canonical JSON、Markdown、JSONL、immutable record 和 Memory 文件仍是事实来源；projection、分区、sealing、summary、`.bak` 与 receipt 都不授权删除或替代事实来源。
3. 不得把 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 的部分 consumer migration（包括 C-4P6-S1）解释为全量 writer migration、完整 C-4P6 或跨文件事务，也不得把 [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 解释为全局 actionId / retry / receipt。

## C-4：仍未完成的 durable writer / closure 设计门

### P8：agent workspace tool durable publish

- 设计文档：[C-4P8 Workspace tool durable publish](plans/local-data-workspace-tool-durable-publish-design.md)
- **P8 未完成；S1、S2 和 S3 已实施。**S1 的 workspace descriptor foundation 证据为 `80f2fd0` / `e2ce36c`；S2 的 `b46c8b2` / `bdcd6cb` 只实现 internal descriptor-bound atomic `createNoOverwrite` foundation；S3 的 `56eabe6` / `54506d5` 只实现 internal descriptor-bound restricted-overwrite foundation。证据、受限语义与实际验证入口见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。
- **剩余且仍须另行获批：**仅 **S4** handler / API integration。
- **S3 已实施且仅限 internal foundation：**existing-only regular `nlink = 1`，descriptor-bound/no-follow，macOS `RENAME_SWAP` / Linux `RENAME_EXCHANGE` atomic swap，且非 CAS。candidate 使用 `0666 & umask`，再采用 old target normal mode `& 0777`；不承诺 special bits 或其它 metadata。swap 前失败保留 primary 并 cleanup/sync candidate；swap-success marker 后的错误为 `possibly_published`，顺序为 first `fsync` → old-alias unlink → second `fsync` → close。没有 pathname、ordinary rename 或 hardlink fallback。
- **S3 不是 tool migration：**无 handler、API、registry、IPC、renderer 或 UI integration。现有 `write_workspace_file` 保持 pathname-based `overwrite` boolean，并会在已有普通文件且 `overwrite: true` 时通过 pathname-based `writeFile()` 覆盖；它未接入 S3，不能作为 S3 证据或 durable overwrite/atomic swap 证据。internal `target_exists` / `possibly_published` 也不是 tool-facing stable contract。
- **实际验证与未关闭风险：**既有 macOS host-native 定向验证之外，`ed8d88a`（`test(data): enable Linux workspace native verification`）新增 GitHub Actions workflow，并将两套 native integration 的运行条件从 darwin-only 改为 `darwin || linux`。2026-07-19 的 [GitHub Actions run 29678781775](https://github.com/kaieye/StudiumX/actions/runs/29678781775) 在 `ubuntu-24.04` GitHub-hosted x64 Linux 上以 Node `22.23.1`、node-gyp `12.4.0` 本机构建 addon，日志确认产物 `build/Release/contained_durable_replace.node`；四个 P8 定向 unit files 为 **4 passed / 96 passed**，没有 skipped。该 workflow 的 typecheck、workspace write check、workspace path target check、security 与 `git diff --check` 也均成功。S2/S3 Linux source branch 因而不再是唯一证据，但记录仅覆盖**macOS 和这个指定 GitHub-hosted Ubuntu/Linux x64 host 的 S2/S3 internal native 定向验证**；它不是全量、跨平台、所有 Linux filesystem/kernel、Windows 支持或 tool durable write complete 的声明。
- 禁止越界：不得把 agent `write_workspace_file` 直接替换成 `replaceDurably()`；C-4P5 allowlisted Markdown service 与该任意受控工具 writer 是不同 scope。

### P9：session-audit durable append

- 设计文档：[C-4P9 Session-audit durable append](plans/local-data-session-audit-durable-append-design.md)
- **已实施且仅限 S2：**`4b30220` / `5f47382` 完成 **P9-S2 audit 专用 framed、legacy-compatible、fixed-file durable append**；证据与实际验证入口见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。
- **S2 已交付的最小范围：**仅固定 `.agent-sessions/<conversation-id>.jsonl`；不 rotation、不调用 generic `durable-jsonl`；per absolute audit path queue 覆盖 same-descriptor exact-byte read / validate / dedupe / framed append / file fsync+close，随后 audit directory、再 conversation parent directory durability confirmation。directory open/sync 仅五个 allowlist code 可降级为通用 warning；post-directory failure retry 会先 dedupe exact rows，之后才继续既有 ledger flow。
- **仍未完成：**C-4P9 整个 gate 未关闭。S2 不表示 generic JSONL migration、跨文件 transaction、ledger authority 或 archive save-order 变更、repair、rotation、IPC/UI 已实施；保留 design gate 中其余风险、验证矩阵与后续批准要求。
- 禁止越界：继续 **non-rotating**；不得接入 `appendDurableJsonlLine()` 的默认 month / size rotation，也不得将 C-4P1 archive publish 或 C-5E trace 计为完整 P9。不得以 S2 改变 ledger authority、JSON → Markdown → audit → 既有 ledger queue → final verify 的顺序，或扩大为其它 JSONL writer。

### P6：learning-outcome durable settlement 的剩余 close-out 设计门

- 设计文档：[C-4P6 Learning outcome durable settlement](plans/local-data-learning-outcome-durable-settlement-design.md)；已实施范围和提交证据见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。
- **已实施且仅限 S1：**`7292bf4` / `e02a086` 实现严格有序 publish、内置 ledger 的私有 writer-lock 覆盖、fail-closed injected load-only ledger，以及 authority-first controlled reconcile。它不是完整 settlement closure。
- **仍未完成：**完整 C-4P6 因 manifest publisher 的 durability/capability-policy 尚未闭合、crash / failure 矩阵尚未穷尽验证，必须继续保留在本待办；完成前还需运行验证。不得把 S1 的 41 项相关单元检查和 14 项集成检查解释为已消除整个矩阵或未来 C-4P6 风险。
- 禁止越界：S1 不授权跨文件事务或共同原子性、rollback、删除、通用 migration 或新的外部 API；不得将单一 overwrite durable write 或 S1 基础称为 settlement durable closure。

## C-5：尚未覆盖的用户动作 correlation 设计门

### P5H：workspace user mutation（mission-first）

- 设计文档：[C-5H Workspace 用户变更 correlation](plans/local-data-workspace-user-mutation-correlation-design.md)
- 当前未获产品 / API 批准，**不可直接实施** `mission_updated` correlation、actionId 或 private receipt。
- 首个候选范围仅为 mission-first；`lesson_style_applied` 的 settings second write 不能被悄然并入。

### P5I：direct-UI lesson generation

- 设计文档：[C-5I Direct-UI lesson generation correlation](plans/local-data-lesson-generation-user-action-correlation-design.md)
- 当前未获产品 / API 批准，**不可直接实施**。需先决定 actionId 生命周期、provider-authority private receipt、receipt retention / authority，以及 `success`、`reused`、`rejected`、`conflict`、`indeterminate` 结果语义。
- 禁止越界：仅覆盖 renderer direct UI 的 `generateLesson` / stream；不覆盖 agent `generate_lesson`、mission、lesson style 或 generic workspace writer。provider outcome unknown 时不得自动重跑。

## C-6：controlled legacy Memory 迁移设计门

- 设计文档：[C-6 受控 legacy Memory 搬迁](plans/local-data-memory-controlled-migration-design.md)
- 已有的 C-6A 只读 aggregate preflight 不授权真实迁移。未来必须先批准可信 main identity / scope、copy → 内部 checksum verify → explicit confirmation → delete、durability / recovery 与审计协议。
- 禁止越界：不得启动、后台或自动迁移，不得由 preflight 暴露或推导 candidate/path/content/hash。
