# 本地数据待办

> 本文是本地数据**下一步工作的唯一入口**。已完成的架构决定及其证据见 [ADR 索引](adr/README.md)。
>
> 下列条目只记录未完成范围及待批准的设计门；设计文档不是实现授权。已关闭 scope、已实施切片和历史验证证据均沉淀在 ADR，不在此重复维护。

## 先决规则

1. 任何后续切片先在对应 design gate 获得 scope / owner / API 批准，再单独立项；不得直接修改其 writer 以“顺手迁移”。
2. canonical JSON、Markdown、JSONL、immutable record 和 Memory 文件仍是事实来源；projection、分区、sealing、summary、`.bak` 与 receipt 都不授权删除或替代事实来源。
3. [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 记录的是**部分** consumer migration；它不表示所有 writer 已迁移，也不表示完整 C-4P6、完整 C-4P9 或跨文件事务已经完成。不得把 [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 解释为全局 actionId / retry / receipt。

## C-4：仍未完成的其它 durable writer / closure 设计门

### P8：Windows strict durable profile

- 受控 `write_workspace_file` scope 和 Windows direct-path non-CAS profile 均已关闭并沉淀在 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。本待办只保留**尚未实现的 strict profile**。
- 若将来要求 POSIX-equivalent Windows strict profile，必须先获得可审计的 Windows/NTFS S3 identity-precondition primitive；再单独设计并实施 HANDLE-relative、reparse-point/junction-safe traversal、atomic no-overwrite / exchange、file/directory durability 和 adversarial host-native CI。现有 direct-path profile 不得被当作该 gate 的完成。

### P9：session-audit durable append

- 设计文档：[C-4P9 Session-audit durable append](plans/local-data-session-audit-durable-append-design.md)。已实施 scope 与 tests-only evidence 见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)；P9 完整 close-out 仍未关闭。
- **待批准的后续范围：**generic JSONL migration、完整 file/directory capability 与 failure matrix、跨文件 transaction、repair、rotation、IPC/UI、operations validation，以及 Windows / power-loss profile。
- 不得以任何后续切片改变 ledger authority 或 archive save order；不得接入默认 month / size rotation，也不得把 archive publish 或 trace correlation 计为完整 P9。

### P6：learning-outcome durable settlement 的剩余 close-out 设计门

- 设计文档：[C-4P6 Learning outcome durable settlement](plans/local-data-learning-outcome-durable-settlement-design.md)。已实施 scope 与历史证据见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)；P6 close-out 未关闭。
- **待推进的 blockers：**
  1. 定义 manifest durability capability，以及 manifest `open` / `write` / `fsync` / `close` 的 failure semantics。
  2. 明确 crash / recovery state machine 的状态、转换与边界。
  3. 处理尚无 cross-file transaction、common atomicity、rollback 或 delete 语义的边界。
  4. 完成 migration、API、IPC 与 operations validation。
  5. 关闭 Windows native `fsync` 与 power-loss 验证。

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
