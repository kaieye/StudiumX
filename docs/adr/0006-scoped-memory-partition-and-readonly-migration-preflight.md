# ADR-0006：按 scope 分区 Memory，并只提供 aggregate-only readonly migration preflight

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** Memory 按稳定 scope hash 分区写入；仅暴露来自同一次 descriptor-bound discovery snapshot 的 aggregate-only readonly migration preflight。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)、[ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)
- **证据：** `tests/unit/teaching-memory-catalog.unit.test.ts`、`tests/unit/teaching-memory-recall.unit.test.ts`、`tests/unit/teaching-ipc-gateway.unit.test.ts`；提交 `26eca18`、`5803176`

## 决定

新的 Memory 写入按稳定 scope hash 分区，读取同时兼容 scoped 与 legacy flat 文件，并以 descriptor-relative、no-follow I/O 处理冲突与恢复边界。为评估 legacy flat Memory，只暴露来自同一次 descriptor-bound discovery snapshot 的 aggregate-only readonly preflight：eligible、already partitioned、duplicate/recovery blockers 和 `migrationReady`。


**平台 I/O profile 扩展（不改写本决定的分区/preflight 语义）：** Windows 上 memory catalog 的 descriptor-relative 路径由 [ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md) 以 `windows_direct_path_non_cas` 分层接替；POSIX 仍为 descriptor-relative。聊天热路径按 chat_hot_path_read 降级，权威写 fail-closed。

## 已落地范围与验证入口

- `26eca18` 实现 scope 分区写入、mixed scoped/flat tolerant read、重复冲突处理和受限 I/O。
- `5803176` 将 aggregate-only preflight 接入 catalog、recall、Settings diagnostics 和现有 diagnostics IPC；它不返回 candidate、路径、identifier、内容或 hash。
- 验证入口包括 `tests/unit/teaching-memory-catalog.unit.test.ts`、`tests/unit/teaching-memory-recall.unit.test.ts`、`tests/unit/teaching-ipc-gateway.unit.test.ts` 和 `tests/integration/teaching-analytics.integration.test.ts`。

## 明确不包含

没有 copy、checksum verify、explicit confirmation、delete legacy、迁移 UI / 新 IPC command、启动迁移、后台迁移或自动 resume。Readonly preflight 不构成 destructive authorization。main-only readonly dry-run intent/receipt preview 与 destructive migration 延期见 [ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)；不得将 preflight 或 dry-run 复用为 consent。
