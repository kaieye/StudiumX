# 本地数据 ADR 索引

本目录记录已经在 `database` 分支实现并有 Git 提交证据的本地数据架构决定。ADR 描述已落地的范围、验证入口和明确边界；它们不授权未批准的后续实现。

后续工作、设计门和实施顺序统一见 [本地数据待办](../local-data-todo.md)。

| ADR | 主题 | 已实现范围 |
| --- | --- | --- |
| [ADR-0001](0001-rebuildable-sqlite-projection.md) | C-1 可重建 SQLite projection | SQLite 仅作为可再建分析投影，并保留文件扫描回退。 |
| [ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md) | C-2 分区、分段与摘要 projection | UTC 月分区、无损 sealed JSONL 分段、显式会话摘要 projection。 |
| [ADR-0003](0003-critical-json-backups-and-verified-recovery.md) | C-3 关键 JSON 备份与恢复 | `.bak` 备份及 verified read recovery。 |
| [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) | C-4 durable publish | 共享 durable publish 原语及已迁移的部分 consumer。 |
| [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md) | C-5 trace correlation | main 生成的 trace correlation 与安全日志边界。 |
| [ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md) | C-6 Memory | scope 分区及 aggregate-only readonly migration preflight。 |
| [ADR-0007](0007-persisted-user-history-redaction.md) | C-7 历史数据脱敏 | 新持久化 conversation/history projection 的脱敏边界。 |
