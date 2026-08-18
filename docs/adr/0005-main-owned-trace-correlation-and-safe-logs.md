# ADR-0005：以 main 生成的 trace 关联已覆盖写链，并保持安全日志边界

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** main 生成并规范化的 `traceId` 关联已覆盖持久化写链；日志保持安全 tagged text，不因本 ADR 变为全局 JSON logging。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0036](0036-mission-update-action-receipt-correlation.md)、[ADR-0037](0037-direct-ui-lesson-generation-action-correlation.md)
- **证据：** `tests/integration/trace-propagation.integration.test.ts` 及已覆盖链的各验证入口；提交 `55442ad`、`7a1ca7e`、`e849d51`、`dee70d6`、`d6a94a1`、`426eb6e`、`1bbdf7c`、`e63e051`

## 决定

traceId 由 main 生成并规范化为 opaque UUID，用于已覆盖持久化链的 correlation；renderer / IPC 不提供该身份。持久化和日志路径只接受规范 UUID，日志字段使用固定安全词表、脱敏、单行化和长度限制。现有日志保持安全的 tagged text 形式，不因此 ADR 变为全局 JSON logging。

## 已覆盖范围与验证入口

- `55442ad` 将安全 archive trace context 接入 conversation archive 路径。
- `7a1ca7e` 为 Memory CRUD mutation 增加 trace correlation；验证入口包括 `tests/unit/teaching-memory-catalog.unit.test.ts` 和 `tests/integration/trace-propagation.integration.test.ts`。
- `e849d51` 为 learning-session event 持久化增加 trace；验证入口包括 `tests/unit/learning-session-ledger.unit.test.ts`。
- `dee70d6` 为 `saveAgentConversation()` 的 conversation lifecycle event 增加 trace；验证入口包括 `tests/unit/teaching-workspace-lifecycle-jsonl.unit.test.ts`。
- `d6a94a1` 为 conversation audit JSONL header / entry 在有效 trace 时增加 trace；验证入口包括 `tests/unit/agent-conversation-session-audit.unit.test.ts`。
- `426eb6e` 为 forked conversation 相关事件增加 main-owned trace；验证入口包括 session-tree 与 legacy-nonmutating unit tests。
- `1bbdf7c` 与 `e63e051` 为 workspace activation 的 explicit / bootstrap create 与 first import lifecycle event 增加并补测 trace；验证入口包括 `tests/unit/teaching-workspace-activation-lifecycle.unit.test.ts`。

跨链的验证入口为 `tests/integration/trace-propagation.integration.test.ts`。

## 明确不包含

这不是全局 actionId、精确 retry、receipt、全局 transaction 或 IPC/UI 重设计。`mission_updated` 的 main-owned `traceId` 覆盖已由 [ADR-0036](0036-mission-update-action-receipt-correlation.md) 在 mission-first 切片内扩展，但 trace 仍不是 action identity 或 receipt。direct-UI `lesson_generated` 的 action/receipt 边界见 [ADR-0037](0037-direct-ui-lesson-generation-action-correlation.md)；`lesson_style_applied` 及其他未获 actionId/receipt 批准的 user actions 仍不在本 ADR 或 ADR-0036/0037 范围内。
