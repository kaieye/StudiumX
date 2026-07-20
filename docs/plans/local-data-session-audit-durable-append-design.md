# C-4P9 Session-audit durable append（已结项 fixed-file scope）

> **状态：已结项（不扩张现有 fixed-file audit boundary）。** 结项决定见 [ADR-0021](../adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md)。
>
> 本文不再是开放实现入口。若要扩张为 strict durable profile、generic JSONL、repair、rotation、cross-process multi-writer、archive transaction 或 public IPC/UI，必须新建独立 ADR。

## 权威入口

| 主题 | 文档 |
| --- | --- |
| P9 结项（不扩张） | [ADR-0021](../adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md) |
| V1 wire / exact-retry / 有限 authority | [ADR-0019](../adr/0019-session-audit-v1-wire-contract-and-limited-authority.md) |
| 已实施 append 与 tests-only 证据边界 | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) |
| 分派入口 | [本地数据待办](../local-data-todo.md)（当前无开放 P9 切片） |
