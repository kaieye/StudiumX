# C-4P6 Learning outcome durable settlement（已结项）

> **状态：已结项。** 受限 close-out 已沉淀为 [ADR-0021](../adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md)。
>
> 本文不再是开放实现入口，也不扩张为 Windows strict、transaction、reboot 或 power-loss claim。

## 权威入口

| 主题 | 文档 |
| --- | --- |
| P6/P8/P9 结项决定 | [ADR-0021](../adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md) |
| Phase 0 profile / failure matrix | [ADR-0020](../adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md) |
| 共享 durable publish 与历史证据 | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) |
| settlement authority | [ADR-0011](../adr/0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0018](../adr/0018-recordless-learning-outcome-marker-only-settlement-authority.md) |
| 运维 runbook | [C-4P6 durable settlement runbook](../operations/c4p6-learning-outcome-durable-settlement-runbook.md) |
| 分派入口 | [本地数据待办](../local-data-todo.md)（当前无开放 P6 切片） |

若要扩大 OS、filesystem、durability claim、writer 或 public result，必须新建 ADR 并附 matching host-native/operations evidence。
