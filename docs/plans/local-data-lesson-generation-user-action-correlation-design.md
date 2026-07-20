# C-5I：Direct-UI lesson generation 用户动作关联（首个切片已实施）

> **状态：首个切片已实施。** 长期有效决定见 [ADR-0023](../adr/0023-direct-ui-lesson-generation-action-correlation.md)。
>
> 本文不再是开放实现入口。更深 projection recovery、retention worker、multi-platform ops evidence 不在已实施范围内；若需要必须新 workflow + ADR。

## 权威入口

| 主题 | 文档 |
| --- | --- |
| direct-UI actionId / receipt / status / exact-retry | [ADR-0023](../adr/0023-direct-ui-lesson-generation-action-correlation.md) |
| durable publish / artifact journal 边界 | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) |
| main-owned trace 边界（direct-UI lesson_generated 仍未覆盖） | [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) |
| 教学事件协议 | [ADR-0015](../adr/0015-canonical-teaching-event-protocol.md) |
| 分派入口 | [本地数据待办](../local-data-todo.md)（当前无开放 C-5I 切片） |

## 明确排除（仍有效）

- agent `generate_lesson` / `generateAndPersistLesson` 不走 direct action protocol
- mission / lesson style / content-hash dedupe / 全局 exactly-once 声明
- 完整 index/lifecycle/history/registry 逐相补写 recovery 与 background retention worker
