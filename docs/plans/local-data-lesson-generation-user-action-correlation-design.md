# C-5I：Direct-UI lesson generation lifecycle / user-action correlation 设计门槛（未实现）

> **状态：未获产品/API 批准；没有 direct-UI `actionId`、private receipt 或 exact-retry 实现。**
>
> 本文只保留 C-5I 尚未关闭的设计决定和验收边界。已经实施的 durable publish、受限 recovery、部分 trace correlation 及其历史测试证据不在这里重复：分别以 [ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 与 [ADR-0005：main-owned trace correlation 与安全日志](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) 为准。后续任务分配入口见[本地数据待办](../local-data-todo.md)。

## 1. 唯一范围与当前未关闭状态

C-5I 只讨论 renderer direct UI 的 `generateLesson()` / `generateLessonStream()` submit 经 IPC 到 main `generateAndPersistLesson()` 后，如何在 response 丢失、stream 断连、renderer reload、crash 或部分 durable failure 时，对**同一次用户动作**给出安全且稳定的结果。

当前实现的 direct payload 只有业务输入（`workspaceId`、`prompt`、可选 `courseName` / `messages`）：没有 caller-provided `actionId`。renderer `lessonGenerationRunId` 是本地 UI run/notification 状态，不经 IPC、结束后清空，不能作为跨 reload retry identity；gateway stream id 只是 transport invocation 标识。现有 lesson/artifact/session、publisher journal、lifecycle event、trace、registry 或 provider 标识都不是 direct-UI caller receipt，也不能区分“相同 prompt 的第二次 submit”与“第一次 submit 的重试”。

direct UI 和 agent tool 会复用部分 generation/persistence 实现，但这不授予它们同一 action authority 或 retry contract。`ADR-0005` 当前也明确不包含 direct-UI `lesson_generated` 的 trace coverage。因此 C-5I 仍是独立的 direct-UI-only gate；不得把已有 durable/reconciliation 能力、局部测试或 trace support 解释为 exact retry、全局 transaction 或 completion。

## 2. 排除项

本 gate 不覆盖或不默认改变：

- agent `generate_lesson`、agent run/tool retry、turn-local attempted/failure 记录；
- C-5H `mission_updated`、`lesson_style_applied`、`write_workspace_file`、allowlisted Markdown writer 或任何其他 lifecycle producer；
- provider/UI redesign、跨 workspace/global transaction、global receipt registry 或通用 idempotency framework；
- C-4 durable publish、artifact journal/reconciliation、C-5C ledger、C-5E audit JSONL 的既有语义、扫描、回填、迁移或重写历史数据。

## 3. 实现前必须批准的 contract

在修改 IPC/type/renderer/main/storage 前，产品、API、privacy 与运维 owner 必须共同批准：

1. **actionId 生命周期与绑定。** renderer 在何时生成、哪些 lost-response/reconnect/reload 情况可以复用、何时丢弃；同一 actionId 如何绑定 workspace、operation kind 和首次请求，而不持久化 raw prompt、messages 或 content hash。语义不能证明一致时必须是明确的 `conflict` 或 `indeterminate`，不得按 prompt/content 相似度 dedupe。
2. **稳定结果与 UI 语义。** API 需要批准稳定 disposition（至少覆盖成功复用、拒绝、冲突、状态不明）及 UI 对 loading、reconnect、reload、manual recovery 和重新提交的行为。相同 prompt 但不同 actionId 是两个独立用户动作。
3. **private receipt authority。** schema/version、workspace-private placement、访问权限、retention/cleanup、损坏处理、同 action 并发 serialization，以及 prepare/reconcile/finalize 的 authoritative phase。receipt 是 recovery aid，不能伪装为 artifact journal、lesson/index/lifecycle/registry/change-history 的事实来源。
4. **provider authority 与成本。** receipt 是否在 provider call 前准备、何时允许同 action 再入 provider；只要无法证明 provider outcome，默认必须返回获批的 `indeterminate` 或其他 fail-closed 结果，不能自动重跑。
5. **recovery table 与运维边界。** 对 artifact/session 已 committed、index/lifecycle/history/registry 尚未确认、receipt 缺失或损坏、外部修改、crash/restart/concurrency 的逐 phase read/reconcile/continue/conflict/indeterminate 规则，以及诊断、保留和人工恢复责任。

未完成这些批准前，不得新增 actionId/receipt，也不得用 main random UUID、trace、stream id、artifact transaction id、lesson id 或 lifecycle event id 冒充 caller identity。

## 4. 不可突破的 authority、隐私与恢复边界

- actionId 若获批，只能是 direct UI submit 的 opaque、non-secret token；main 验证其形状、namespace、workspace binding、operation kind 与 reuse policy。renderer/agent 不得提供 trace、声明 action completed 或写 private receipt。
- trace 仍由 main 生成，且只作为获批 lifecycle diagnostic correlation metadata；它不是 action identity、receipt key、dedupe/query/filter key。C-5I 不得借实现 action retry 扩大 `ADR-0005` 的 coverage。
- receipt/action handling 不得持久化或输出 raw prompt、messages、rendered lesson、artifact bytes/content hash、provider secret/API key/request id、agent secret 或 trace-derived secret；actionId 不得进入 user-visible files、lifecycle/logger diagnostics、analytics 或 generic error text。
- artifact journal/reconciliation 只能按既有 authority 处理 publication safety，不能回答“是否安全重跑 provider”或替代 stable caller result。正常 Lesson/session/artifact set 已 committed 时，不得为 retry 生成 duplicate artifacts、回滚或改写 canonical bytes。
- receipt 缺失/损坏、payload mismatch、external mutation，或无法证明 artifact/index/lifecycle 状态时必须 fail closed 为已批准的 `conflict` / `indeterminate`；不得覆盖外部修改、删除 canonical artifacts、重写 JSONL，或自动 dedupe。
- legacy no-receipt workspace 及 legacy journals/index/lessons/lifecycle rows 保持兼容行为；不得为 C-5I 扫描、补 trace、回填或自动修复。

## 5. 获批实现后的最小范围与验收

最小切片只能修改 direct UI `generateLesson` / `generateLessonStream` 的 request/result contract、其 parser/gateway/preload、direct renderer callers，以及受限的 main private receipt/recovery seam；不得扩散至 agent、style、MISSION 或 generic writers。

批准后的测试与操作验收至少证明：

- lost IPC response、stream reconnect、renderer reload、restart 和同 action 并发 submit 不重复 provider call、artifact publication、lifecycle row 或 registry side effect，并返回同一稳定 disposition；
- provider outcome unknown、receipt 损坏/缺失、payload conflict、external mutation 采用批准的 fail-closed disposition，而非自动 rerun provider 或 content dedupe；
- artifact/session 已 committed 而 index、lifecycle、change history、registry 或 response 未确认时，只能按已批准的 receipt-aware reconciliation 补可证明缺失的步骤；不得 duplicate、rollback 或重写 canonical artifacts/JSONL；
- 对 artifact/journal、index、lifecycle append 的 post-write/close/directory-sync uncertainty、history、registry、receipt 各阶段执行 I/O fault/crash 注入；
- actionId validation、renderer trace rejection、receipt private path/permissions、日志与诊断脱敏、legacy compatibility 及 scope isolation 均有测试；
- 在目标平台与实际运维环境验证 recovery、observability、retention/cleanup、人工恢复和 provider-cost policy；unit fault injection 不能单独关闭这些验收项。

## 6. Approval gate

**当前结论：NO-GO。** C-5I 仅有设计发现，尚无 action-scoped identity、receipt authority、stable result vocabulary、provider unknown-outcome policy 或批准的 recovery table。实施前必须完成第 3 节的 owner approval，并将最终架构决定沉淀为 ADR；届时再更新本计划和[本地数据待办](../local-data-todo.md)，而不是把设计候选误写成已实施能力。
