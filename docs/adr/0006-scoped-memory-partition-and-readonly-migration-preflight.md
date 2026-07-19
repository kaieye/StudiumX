# ADR-0006：按 scope 分区 Memory，并只提供 aggregate-only readonly migration preflight

- **状态：** 已实施（分区与只读预检；非真实迁移）
- **范围：** C-6、C-6A
- **证据提交：** `26eca18`、`5803176`

## 决定

新的 Memory 写入按稳定 scope hash 分区，读取同时兼容 scoped 与 legacy flat 文件，并以 descriptor-relative、no-follow I/O 处理冲突与恢复边界。为评估 legacy flat Memory，只暴露来自同一次 descriptor-bound discovery snapshot 的 aggregate-only readonly preflight：eligible、already partitioned、duplicate/recovery blockers 和 `migrationReady`。

## 已落地范围与验证入口

- `26eca18` 实现 scope 分区写入、mixed scoped/flat tolerant read、重复冲突处理和受限 I/O。
- `5803176` 将 aggregate-only preflight 接入 catalog、recall、Settings diagnostics 和现有 diagnostics IPC；它不返回 candidate、路径、identifier、内容或 hash。
- 验证入口包括 `tests/unit/teaching-memory-catalog.unit.test.ts`、`tests/unit/teaching-memory-recall.unit.test.ts`、`tests/unit/teaching-ipc-gateway.unit.test.ts` 和 `tests/integration/teaching-analytics.integration.test.ts`。

## 明确不包含

没有 copy、checksum verify、explicit confirmation、delete legacy、迁移 UI / 新 IPC command、启动迁移、后台迁移或自动 resume。真实 controlled migration 必须先通过设计门；见[本地数据待办](../local-data-todo.md)。
