# C-4P9 Session-audit durable append：未关闭的设计门

> **状态：未关闭。** 已实施 scope、提交与 tests-only historical evidence 见 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md)；它们不构成 C-4P9 complete durable closure。

## 范围与红线

- 本文件只定义 P9 尚未解决的设计与批准门。下一步工作的唯一入口是 [本地数据待办](../local-data-todo.md#p9session-audit-durable-append)。
- 不得把 P9 扩大为其它 JSONL writer、archive、artifact、checkpoint、ledger 或 workspace writer 的迁移。
- 既有 audit schema/version、headers、entry IDs、`parentId`、ordering、历史字节、legacy tolerant read、删除/history/artifact 语义仍须保持；未经单独批准，不得 backfill、normalization、rewrite、retention change 或 automatic cleanup。
- 不得改变当前 archive save order 或 ledger ownership；P9 不授权新的 trace identity、action ID、receipt 或通用 idempotency model。

## 待批准的设计门

1. **Generic JSONL migration、rotation 与 repair。** 先定义获批的 generic API 与 audit-specific compatibility contract。任何 rotation、sealing 或 segment discovery 都必须证明保持 fixed-file audit、history、artifact protection、verification 与 deletion 语义。repair 还须定义 authority、trigger、字节保留/损失政策、恢复与 operator controls。
2. **完整 capability 与 failure semantics。** 完成 file/directory `mkdir`、path inspection、`open`、`stat`、`read`、partial/invalid transfer、`write`、`fsync` 与 `close` 的 capability profile 和 residual matrix；定义 fatal / degraded 分界及 stable、privacy-safe diagnostics，禁止将 unsupported behavior 报为 durable success。
3. **跨文件 transaction 与 archive/ledger authority。** 任何超出有序 best-effort 的承诺都需要明确 crash/retry state machine，并定义 JSON、Markdown、audit 与 ledger 的 authority、partial-publish visibility、reconciliation、idempotency、final verification 和 rollback prohibition，且不得悄然改变 archive order 或 ledger ownership。
4. **IPC/UI。** repair、migration、rotation、conflict resolution 或 durability-status UI/IPC 均未获批准。未来 surface 必须定义权限、stable/privacy-safe states 与 errors、partial publish 的用户可见后果、retry 行为及 caller compatibility。
5. **Operations validation。** 在更广 closure 前，定义 owner、runbook、observability（不得泄露 audit data）、upgrade/rollback、capacity/retention、concurrency、failure injection 与可复现实收标准。定向 unit evidence 不等同于 operations validation 或 full-suite closure。
6. **Windows 与 power-loss claims。** Windows profile 需要 host-native capability analysis、明确 file/directory flush/error semantics 和 adversarial CI。任何 power-loss 声明都需要获批 fault model 及平台对应的 crash/recovery 或 power-loss validation；普通 unit tests 和 `fsync` 调用不足以证明该结论。

## 实施前输入

任何后续切片必须先获批 scope、owner、public result/retry semantics、platform profile、failure/crash matrix、测试层级与 operations owner；批准后再单独立项。本文不构成实现授权或 P9 close-out。
