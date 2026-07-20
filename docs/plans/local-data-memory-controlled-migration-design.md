# C-6：受控 legacy Memory 搬迁（destructive 延期设计门）

> **状态：阶段 2（main-only readonly dry-run）已实施；destructive migration 延期、未批准、未实现。**
>
> **不是**可分派实现任务，也不是启动/后台/自动/UI 迁移授权。readonly preflight/dry-run 不构成 destructive consent。

## 权威入口（已沉淀）

| 主题 | 文档 |
| --- | --- |
| scope 分区 + flat/scoped 兼容读取 + aggregate-only readonly preflight | [ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) |
| main-only readonly dry-run intent/receipt；destructive 延期前提与验证入口 | [ADR-0024](../adr/0024-memory-readonly-migration-dry-run-and-destructive-deferral.md) |
| 当前分派状态 | [本地数据待办](../local-data-todo.md)（destructive C-6 仅作延期依赖） |

## 本设计门仅保留：重新立项 destructive 前须满足的未批准范围

下列内容**尚未批准实现**；完整前提列表以 [ADR-0024 第 3 节](../adr/0024-memory-readonly-migration-dry-run-and-destructive-deferral.md) 为准。获批前不得分派 copy/hold/publish/delete：

1. main-only trusted identity/scope authorization 与一次性、显式、可取消的 confirmation binding；
2. 目标平台 descriptor-relative no-follow copy、exclusive destination create、durable publish、descriptor-bound delete、directory sync（不支持则 fail closed，无 unrestricted path I/O fallback）；
3. non-overwrite duplicate policy、private hold/backup ownership/retention/cleanup/legal hold、partial-delete 人工恢复责任；
4. 多文件 phase contract 与仅记录可证明 phase 的 private receipt（不得声称跨文件 atomicity）；
5. data-minimal audit/diagnostics、host-native/fuzz 安全矩阵与 operations runbook。

若产品需要上述能力，必须**新建独立 ADR** 并附 matching evidence；不得把本文件或 dry-run 结果解释为授权。
