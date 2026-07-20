# C-5H：Workspace 用户变更 correlation（mission-first 已实施）

> **状态：mission-first 首个切片已实施。** 长期有效决定见 [ADR-0022](../adr/0022-mission-update-action-receipt-correlation.md)。
>
> 本文不再是开放实现入口。`lesson_style_applied` 与其它 producer 仍排除；若要覆盖 style 或 CAS UI，必须另立 design gate + ADR。

## 权威入口

| 主题 | 文档 |
| --- | --- |
| mission actionId / receipt / exact-retry | [ADR-0022](../adr/0022-mission-update-action-receipt-correlation.md) |
| durable publish 边界 | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) |
| main-owned trace 边界 | [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) |
| 分派入口 | [本地数据待办](../local-data-todo.md)（当前无开放 C-5H 切片） |

## 明确排除（仍有效）

- `lesson_style_applied`、CSS scaffold/repair、generic workspace writer、agent mutations
- CAS UI / expected-revision protocol、跨文件 transaction、跨进程 exclusive ownership
- legacy lifecycle backfill / repair / prompt redaction
