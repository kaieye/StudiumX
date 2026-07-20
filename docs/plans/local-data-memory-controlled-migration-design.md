# C-6：受控 legacy Memory 搬迁的安全、恢复与审计设计门（未关闭）

**状态：真实 controlled legacy Memory migration 尚未获批、尚未实现。** 已完成的 scope 分区和 C-6A aggregate-only readonly preflight 已沉淀到 [ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md)，本计划不重复其实现细节、测试历史或诊断字段。它们均不授权 copy、move、delete、迁移 UI/IPC、启动/后台迁移或自动 resume。

> 后续工作统一入口见 [本地数据待办](../local-data-todo.md)。本文只记录真实迁移仍需关闭的设计门，不能作为启动、后台或自动迁移的授权。

## 1. 不可违反的范围和安全边界

任何未来方案都必须保持 legacy Memory 可读，并且不得：

- 在 startup、background、定时任务、analytics、diagnostics 或普通 Memory read 中触发迁移；
- 从 renderer 接收 path、scope root、canonical identifier、destination、checksum 或任何特权文件 I/O 参数；
- 以 SQLite、summary、旧 preflight 或缓存结果取代当前 canonical discovery、scope authorization 或 delete 决策；
- 覆盖已有 scoped destination，或把 duplicate 当作可自动修复的正常状态；
- 在 UI、日志、audit、错误或 receipt 中泄露 raw content、canonical identifier、path、scope root、checksum/hash 或可枚举候选明细；
- 把 legacy delete 当作可自动 rollback 的操作，或借 retention policy 绕过单独的删除同意、legal hold 与恢复要求。

## 2. 待批准的产品与数据治理决定

在任何实现立项前，产品/运维 owner 必须明确：

1. 是否存在足以接受 destructive legacy delete 的用户或运维需求；若存在，默认是 delete 后不保留副本，还是采用受保护、可恢复的 managed hold/backup。
2. 哪些角色和 trusted scope 可以发起一次性、可取消的确认，以及适用的 consent、retention、legal hold、容量、访问控制与 partial-delete 人工恢复责任/时限。
3. stable result vocabulary、private receipt 的 authority/placement/retention/locking，以及 receipt 能记录的最小非敏感 phase/status。receipt 不能成为 Memory canonical authority，也不能承诺跨文件 transaction、exact retry、自动 rollback 或自动 cleanup。

在这些决定批准前，**保持 legacy read-only 是唯一可用行为**。直接 move、直接 delete、无确认 copy，以及将第二份 catalog-discoverable canonical copy 当作 backup 都不可接受。

## 3. 若获批准后的候选协议（尚非实现授权）

若第 2 节的 destructive operation 获批准，候选顺序只能是受控的多文件协议，而不是 rename loop：

1. main process 以可信身份、当前 scope 和新的 descriptor-bound discovery 建立一次性 intent；旧 aggregate、缓存、renderer 状态或历史确认均不能复用。
2. 重新确认 accepted source 唯一、目标不存在、scope 一致且没有 unsafe/deep/symlink/unknown-layout、duplicate、recovery 或 source-drift blocker。
3. 仅由 main 从可信 root descriptor 派生 source、private hold 和 scoped destination；所有逐段打开、copy、publish 与 delete 必须保持 descriptor-relative no-follow 边界，不能退回 pathname I/O。
4. private temp exclusive create → copy → file `fsync` → 内部 verify → durable private-hold publish/目录同步；verify 材料只留在受限 capability 内，不进入 UI、普通日志、aggregate receipt 或 audit。
5. 获授权主体作独立、明确、非默认且可过期/取消的 destructive confirmation；confirmation 不得由 Settings 刷新、preflight ready、自动 retry 或启动恢复推断。
6. confirmation 后重新 discovery 和 revalidation，随后 durable non-overwrite scoped publish/目录同步 → descriptor-bound legacy delete → durable final receipt。

private hold/backup 必须位于 normal catalog discovery 范围外，并有单独批准的 ownership、retention、legal-hold、restore、cleanup 与访问控制政策。跨文件系统或多 record 没有整体 atomicity；receipt 只能表达已证实的 phase，不能将未知 I/O 结果视为成功。

## 4. 失败、并发与恢复门槛

- intent、copy 与 confirmation 之间的外部写入均可使操作 stale；任何 phase transition 都要重新执行 descriptor-bound discovery 和 scope revalidation。
- 同一 Memory root/scope 的操作需要 main-owned、scope-bound serialization 或等价互斥；无法取得 lease 时返回非敏感 `busy`，不得并发 copy、publish 或 delete。
- retry 必须 fail closed：只可重新评估当前 canonical source、hold ownership、destination absence/verified state、intent 与 confirmation；不得按名称猜测、覆盖 destination 或自动 delete legacy。
- crash、进程终止、disk-full、partial copy、verify mismatch、external edit、unexpected duplicate、权限错误和 delete 中断都不得触发 startup 自动 resume。默认结果是保留 legacy 可读，并把未确认或无法证明 ownership 的 hold 置为 recovery-required。
- publish 后 delete 前崩溃/外部编辑会产生 recovery-required duplicate；partial delete 是不可逆 partial outcome，必须停止并进入经批准的人工或受控恢复，不能盲目继续。
- 由于最小化 receipt 不得保存 locator/content/checksum，跨崩溃逐项 resume 或 cleanup 需要额外的最小化 ownership/provenance contract；在该 contract 被审查前，禁止承诺自动续跑、逐项恢复或自动清理。

## 5. 实施前的能力与验收证据

任何真实迁移都必须先单独批准并证明：

1. main-only trusted identity/scope authorization 和一次性 confirmation binding；
2. 可测试的 descriptor-relative no-follow copy、exclusive destination create、durable publish、descriptor-bound delete 及目录同步能力；不具备的平台必须 fail closed，不能回退为不受约束的 path I/O；
3. non-overwrite duplicate policy、hold/archive 的 ownership/retention/cleanup、legal hold 与 delete irreversibility policy；
4. 可覆盖 crash、duplicate、hold ownership 的私有 recovery model，而非用 aggregate preflight 伪造逐项映射；
5. fuzz/fixture 安全测试，覆盖 unsafe/deep/symlink/unknown partition、same-identifier equal/different duplicate、scope mismatch、source drift、external edit、concurrency、disk-full、每阶段 crash、partial copy/delete、retry/idempotency、legacy tolerant read 与 UI/log/audit 非泄露；
6. 明确的 operations runbook：blocked、busy、indeterminate、recovery-required 与 partial-delete 的负责人、审计保留和人工恢复入口。

## 6. 批准前唯一可讨论的最小 safe slice

唯一可讨论的安全切片是 **main-only dry-run intent/receipt preview**：重新执行只读 discovery 和 trusted-scope validation，仅产生短期 aggregate-only intent 状态；不 copy、不创建 hold、不 publish、不 delete，也不新增 renderer path input。它需要单独立项，并证明 canonical Memory bytes、mtime 和目录布局不变，缺失 root 不创建，且 UI/log/audit 不泄露 locator 或内容；它不构成真实迁移授权。
