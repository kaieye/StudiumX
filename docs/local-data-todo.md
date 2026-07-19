# 本地数据待办

> 本文是本地数据**下一步工作的唯一入口**。已完成的架构决定及其证据见 [ADR 索引](adr/README.md)。
>
> 下列条目均为待批准、未实施的设计门；设计文档不是实现授权。不得把其中的建议、验证矩阵或候选 contract 记作已完成代码、测试或 durable closure。

## 先决规则

1. 任何切片先在对应 design gate 获得 scope / owner / API 批准，再单独立项；不得直接修改其 writer 以“顺手迁移”。
2. canonical JSON、Markdown、JSONL、immutable record 和 Memory 文件仍是事实来源；projection、分区、sealing、summary、`.bak` 与 receipt 都不授权删除或替代事实来源。
3. 不得把 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 的部分 consumer migration 解释为全量 writer migration，也不得把 [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 解释为全局 actionId / retry / receipt。

## C-1：FTS/query 隐私与授权设计门

- 设计文档：[C-1 FTS/query：隐私、授权与可重建设计门槛](plans/local-data-query-fts-privacy-design.md)
- 未实施：FTS、全文检索 API、授权范围、查询结果脱敏与 privacy contract。
- 禁止越界：不能以现有 SQLite projection 为由直接开放全文查询或扩大数据暴露面。

## C-2：留存控制、删除与恢复设计门

- 设计文档：[C-2 retention control / recovery](plans/local-data-retention-control-recovery-design.md)
- 未实施：physical retention、canonical compaction、删除、用户控制、恢复与审计协议。
- 禁止越界：UTC 月分区、50 MiB sealing 和 summary projection 都不构成删除授权；sealed JSONL 仍是 canonical logical source 的组成部分。

## C-4：尚未迁移的 durable writer 设计门

### P8：agent workspace tool durable publish

- 设计文档：[C-4P8 Workspace tool durable publish](plans/local-data-workspace-tool-durable-publish-design.md)
- **获批后的最小顺序：**
  1. **S1** descriptor-bound foundation；
  2. **S2** atomic `createNoOverwrite`；
  3. **S3** restricted overwrite；
  4. **S4** handler / API integration。
- 禁止越界：不得把 agent `write_workspace_file` 直接替换成 `replaceDurably()`；C-4P5 allowlisted Markdown service 与该任意受控工具 writer 是不同 scope。

### P9：session-audit durable append

- 设计文档：[C-4P9 Session-audit durable append](plans/local-data-session-audit-durable-append-design.md)
- 推荐的获批后首个切片是 **P9-S2 framed、legacy-compatible、fixed-file durable append**，并保留每个 conversation audit 的固定单文件语义。
- 禁止越界：必须 **non-rotating**；不得接入 `appendDurableJsonlLine()` 的默认 month / size rotation，也不得将 C-4P1 archive publish 或 C-5E trace 计为 P9 完成。实现前仍需明确 per-path queue、safe newline / torn-tail policy、ID / trace conflict、post-directory-failure retry、capability allowlist 与 archive → ledger 顺序。

### P6：learning-outcome durable settlement

- 设计文档：[C-4P6 Learning outcome durable settlement](plans/local-data-learning-outcome-durable-settlement-design.md)
- 当前仅有审计与设计约束，**不可直接实施**。先决问题包括 immutable record post-link parent-directory failure、record authority、outcome / manifest / marker 有序 publish、record-first controlled repair、writer lock 与 I/O seam。
- 禁止越界：不得将单一 overwrite durable write 称为 settlement durable closure 或多文件事务。

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
