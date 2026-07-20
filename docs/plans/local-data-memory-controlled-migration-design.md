# C-6：受控 legacy Memory 搬迁（destructive 延期设计门）

> **状态：阶段 2（main-only readonly dry-run）已实施；destructive migration 延期、未批准、未实现。**
>
> 已实施范围以 [ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) 与 [ADR-0024](../adr/0024-memory-readonly-migration-dry-run-and-destructive-deferral.md) 为准。本文**只**保留 destructive/controlled migration 的未批准设计门；**不是**可分派实现任务，也不是启动/后台/自动/UI 迁移授权。readonly preflight/dry-run 不构成 destructive consent。

## 1. 已沉淀到 ADR 的决定（请勿在此重复实现）

| 已实施/结项 | 权威 |
| --- | --- |
| scope 分区 + flat/scoped 兼容读取 + aggregate-only readonly preflight | [ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) |
| main-only readonly dry-run intent/receipt preview；destructive 延期 | [ADR-0024](../adr/0024-memory-readonly-migration-dry-run-and-destructive-deferral.md) |
| 分派入口 | [本地数据待办](../local-data-todo.md)（destructive C-6 仅作延期依赖） |

## 2. 明确不在范围内（仍有效）

- 启动、后台、settings 刷新或 analytics 触发的自动迁移
- renderer 提供 path/root/target/checksum 作为 authority
- 覆盖已有 scoped destination、合并同 ID 多 source、把 duplicate 当可自动修复常态
- 将 preflight/dry-run/`intentId` 当作 destructive consent、retry key 或 recovery authority
- 声称跨文件 transaction / 共同原子性 / power-loss 完整迁移

## 3. Destructive / controlled migration 重新立项前提

在以下全部由**独立 ADR** + owner 批准并附 matching evidence 之前，不得分派 copy/hold/publish/delete 实现：

1. main-only trusted identity/scope authorization 与一次性、显式、可取消的 confirmation binding；
2. 目标平台 descriptor-relative no-follow copy、exclusive destination create、durable publish、descriptor-bound delete、directory sync；不支持则 fail closed，无 unrestricted path I/O fallback；
3. non-overwrite duplicate policy、private hold/backup ownership/retention/cleanup/legal hold、partial-delete 人工恢复责任；
4. 多文件 phase contract 与仅记录可证明 phase 的 private receipt（不得声称跨文件 atomicity）；
5. data-minimal audit/diagnostics、host-native/fuzz 安全矩阵与 operations runbook。

## 4. 若获批后的目标不变量（设计门，非实现授权）

- 移动前、取消后、失败后和未决状态下，legacy Memory 继续可读；不能因迁移丢失已选中的 canonical record。
- scoped destination 由 main 根据已验证 record 推导；不得把 renderer、SQLite projection、历史 preflight、缓存结果或用户输入路径当作 authority。
- 不覆盖已有 scoped destination；不合并同 ID 的多个 source。
- 多文件 copy/publish/delete 不是跨文件事务；任何无法证明的 I/O 结果均不得报告为成功，也不得自动 retry/rollback/delete。

## 5. 当前验证入口（仅复核已实施 dry-run / 分区基线）

```sh
pnpm run build:contained-durable-replace

pnpm exec vitest run --project unit \
  tests/unit/teaching-memory-migration-dry-run.unit.test.ts \
  tests/unit/teaching-memory-catalog.unit.test.ts \
  tests/unit/teaching-memory-recall.unit.test.ts \
  tests/unit/teaching-ipc-gateway.unit.test.ts

pnpm run typecheck
```

这些命令**不**验证未来 destructive 迁移。真实 copy/delete 必须另附第 3 节证据与新 ADR。
