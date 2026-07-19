# C-6：受控 legacy Memory 搬迁的安全、恢复与审计设计门槛（仅 design discovery）

**状态：仅 design discovery；不是功能或测试实现。** `5803176` 已实现 C-6A 的严格只读、aggregate-only preflight，但它不实现、不批准 copy、delete、move 或任何真实搬迁。C-6 整体和 controlled legacy Memory migration 仍未完成；本文不能作为启动、后台或自动迁移的授权。

> 后续工作的统一入口见 [本地数据待办](../local-data-todo.md)；已实施决定见 [ADR 索引](../adr/README.md)。

## 1. 已有 C-6A 事实与其局限

C-6A 复用 TeachingMemoryCatalog 的**同一次** descriptor-bound、no-follow discovery snapshot，仅向既有 diagnostics IPC/Settings 提供 aggregate preflight：flat eligible 数、已分区 selected source 数、duplicate blocker 数、recovery blocker 数和 `migrationReady` boolean。缺失 Memory root 时，它以 non-creating descriptor open 安全返回空 aggregate；不会创建 root，也不会改变父目录 entries 或 mtime。

这个边界有意不返回 record、canonical identifier、path、scope root、content、checksum/hash 或候选清单。它也不创建 private receipt、不保存迁移意图、不取得文件写权限、不复制/验证/删除文件，且没有 migration button、新 IPC command 或 renderer path input。

因此，C-6A 的 aggregate 只能回答“在**该次**只读 snapshot 中，是否存在可考虑的 legacy flat source”，不能回答“允许谁在何时迁移哪些文件”：

- `alreadyPartitioned` 只表示 selected scoped source 的 aggregate，不是 destination 健康证明；
- `eligible` 只适用于 selected flat source，且同一 canonical identifier 只有一个 accepted source、没有 duplicate/mutation-blocking state；
- 同 identifier 的 flat/scoped 多 source（无论 bytes 是否相同）、duplicate conflict、invalid JSON、scope mismatch、unsafe path、unknown partition、deep directory、symlink 或其他 recovery finding 都必须保持 blocker 语义；
- `migrationReady` 是无敏感信息的当时 aggregate，不是 durable authorization、无竞争锁、source 不变保证或删除许可；preflight 一旦 stale，必须重新做只读 discovery。

未来真实操作必须由 main process 根据可信应用状态重新建立 identity 与 scope：renderer 不能提供 root/path、canonical identifier、目标目录或任意 file handle。catalog discovery 的 source scope 只能用于候选发现；正式发布与删除前仍须用主进程可信 scope、当前 canonical record 和 descriptor-bound capability 再验证。

## 2. 非目标、不可违反的安全边界

本 design gate 不新增代码、IPC、preload API、UI 操作、后台任务、启动任务、native addon、文件格式或 canonical schema。现有 legacy tolerant read、CRUD、C-6 已分区 source 以及 C-6A diagnostics 都必须保持语义不变。

无论未来采用何种方案，均不得：

- 在 startup、background、定时任务、analytics、diagnostics 或普通 Memory read 中触发迁移；
- 从 renderer 接收 path、scope root、canonical identifier、destination、checksum 或任意特权文件 I/O 参数；
- 用 SQLite、summary 或 aggregate preflight 代替 canonical discovery、scope authorization 或 delete 决策；
- 覆盖已有 scoped destination，或把 duplicate 当作“可以修复”的正常状态；
- 在 UI、日志、audit、错误或 receipt 中泄露 raw content、canonical identifier、path、scope root、checksum/hash 或候选明细；
- 把 legacy delete 当作可自动回滚的操作，或借 C-2 retention policy 绕过单独的删除同意与恢复要求。

## 3. 备选方案矩阵（全部尚未获批准）

| 方案 | 好处 | 风险、前提与恢复语义 | 当前决定 |
|---|---|---|---|
| 保持 legacy read-only | 延续当前最安全的 tolerant read；没有新增写入或删除面。 | 无磁盘整理收益，但也不会制造 duplicate、误删或恢复债务。 | **当前默认**，持续支持。 |
| copy → internal checksum verify → explicit confirmation → delete legacy | 可在已验证复制后、经独立确认再收敛到 scoped canonical source。 | 需要完整的 descriptor-bound copy/delete capability、scope revalidation、durable phase recovery、非覆盖发布和不可逆删除政策。 | **待批准的推荐候选**；不是实现授权。 |
| copy-and-keep managed backup | 可降低 delete 后不可恢复风险。 | 备份不能继续处于 catalog discovery 范围而形成 duplicate；需要独立的受保护 hold/archive、retention、restore、容量和访问控制政策。 | 仅在产品/法律要求保留副本时讨论，尚未批准。 |
| 直接 move 或直接 delete | 实现表面较短。 | move 跨目录/崩溃并非整体原子；未验证 destination 或无确认的 delete 可不可逆丢失 data。 | **拒绝**。 |

推荐候选只是在真正需要结束 legacy 扁平布局、且产品批准 destructive step 时的最小顺序；在所有门槛关闭前，必须保持 legacy read-only。

## 4. 候选状态机与耐久性门槛

真实实现必须把迁移视为多文件、非整体原子的受控协议，而不是 rename loop。以下状态机只定义将来需验证的顺序；本轮没有任何状态实现或持久化。

| 阶段 | 允许动作 | 必须成立的条件 | 失败/恢复语义 |
|---|---|---|---|
| `read_only` | 正常 legacy/scoped tolerant read 与 C-6A preflight。 | 无写 capability、无 intent。 | 永远可停留；不能隐式进入下一阶段。 |
| `preflight_snapshot` | 以现有 descriptor-bound、no-follow discovery 读取 aggregate。 | blocker 为零、存在 eligible aggregate；snapshot 仅为本次判断。 | root 缺失、recovery/duplicate 或 snapshot stale 时安全退出，不写入。 |
| `intent_prepared` | main process 从可信用户/运维动作、当前授权 scope 和最新 discovery 建立一次性 intent。 | intent 绑定 policy/version、issued/expiry、授权类别、aggregate expectation 与不可猜测 operation handle；receipt/state 不含 identifier、path、content、checksum/hash 或候选映射。 | 任何 scope/时间/manifest 变化使 intent 失效；必须回到 preflight，不可复用。 |
| `copy_to_private_hold` | 在 main-only descriptor-bound、no-follow capability 下，把候选从受限 source 复制到不被 catalog 发现的私有 hold。 | destination 由主进程派生、exclusive create、无 overwrite；临时文件完成 file fsync 后才可原子发布到 hold，并同步相关目录。 | disk-full、I/O、symlink、external edit、duplicate 或 copy partial 时不 delete source；只允许安全清理未发布 temp，已发布 hold 进入 recovery-required，不自动发布/删除。 |
| `hold_verified` | 对复制产物作内部 checksum verify，必要时 reread destination。 | checksum 仅在受限 main-memory/capability 内使用；不得进入 UI、普通日志、aggregate receipt 或 audit。还须重验 source/destination descriptor identity。 | verify 不一致或 source stale 时保留 source，hold 不得被当 canonical；停止并要求新的只读 preflight。 |
| `confirmation_required` | 向获授权主体呈现最小 aggregate 和不可逆 delete 的后果。 | 必须是独立、明确、非默认的确认；不是 Settings 刷新、预检 `migrationReady` 或旧确认的推断。 | 取消/超时保持 legacy；hold 的处理遵循已批准的显式 cleanup/hold policy，不自动 delete source。 |
| `publish_and_delete` | 确认后重新做 scope/source/destination/staleness 检查；将 verified hold 以非覆盖、durable 顺序发布到 scoped destination，再 descriptor-bound delete legacy。 | publish 成功、destination verify 与当前 source revalidation 都必须先于 legacy delete；每项 delete 都需记录准确 phase，不能用 aggregate 假设成功。 | publish 后 delete 前 crash/外部编辑会形成 recovery-required duplicate；重启不得自动完成 delete。部分 delete 是不可逆 partial outcome，必须停下并显式恢复/重试，不得盲目继续。 |
| `finalized` | 仅在所有已确认项按协议完成且 durable finalization 写入后结束。 | final receipt 只含 operation handle、phase、时间、aggregate outcome/status 与 policy version。 | finalization 写失败不代表可重删或可回滚 source；保留安全、非敏感 failure 状态并进入人工/受控恢复。 |

### Staleness、并发、重试、resume、rollback 与 cleanup

- C-6A snapshot、intent、copy 和确认之间的任一外部写入都可能使候选 stale。任何 phase transition 都必须重新运行 descriptor-bound discovery 与 scope revalidation；不能凭首次 aggregate 或 renderer 缓存继续。
- 同一 Memory root/scope 的 concurrent migration 必须以 main-owned、scope-bound operation serialization 或等价互斥处理。未获得锁/lease 时返回非敏感 busy，不得并发 copy、publish 或 delete。
- retry 必须幂等且 fail-closed：仅能重新评估当前 canonical source、hold ownership、destination absence/verified state 与 intent/confirmation；不允许根据名称猜测、覆盖 destination 或自动删除 legacy。
- 崩溃、进程终止、disk-full、partial copy、checksum mismatch、external edit、unexpected duplicate、权限错误和 delete 中断都不能触发启动时 resume。默认恢复动作是保持 legacy readable、隔离/保留未确认 hold，并要求新的显式、可信 main-process recovery flow。
- delete 前可以放弃 intent；delete 后不能把“copy 仍在”当作 rollback。restore 必须是另一个获批准的、可审计操作，而不是 migration 自动回滚。任何 hold/archive cleanup 都不能删除 legacy，且必须受独立的 retention/legal policy 与安全 ownership proof 约束。
- 由于 private receipt/state 被要求不保存 identifier、path、content 或 checksum/hash，可靠的跨崩溃逐项 resume/cleanup 目前存在能力缺口。未提出经审查的最小化 ownership/provenance 设计前，未来实现不得承诺自动续跑、逐项恢复或自动清理已发布 destination。

## 5. Copy、publish 与 delete 的具体安全约束

1. **Descriptor boundary：** source、private hold 与 scoped destination 必须从受信的 root descriptor 逐段打开、拒绝 symlink/unsafe/deep/unknown layout，且不允许 fallback pathname scanner。copy 与 delete 所用 capability 必须在操作期间保持 no-follow 边界，而不是只在 preflight 检查一次。
2. **Source/destination constrain：** destination 只能由当前 canonical record 的已验证 scope 规则在 main process 派生；不得跨 scope relocation，不得接受 renderer 指定位置。legacy source 与 target scoped source 若同时存在、或任何 accepted source count 大于一，必须停止而不是覆盖/合并。
3. **耐久顺序：** private temp exclusive create → copy → file fsync → internal verify → durable hold publish/目录同步 → explicit confirmation → fresh revalidation → durable non-overwrite scoped publish/目录同步 → legacy delete → final receipt。跨文件系统或跨多 record 操作没有整体原子性，receipt phase 只能记录真实完成状态。
4. **Backup 与 cleanup：** copy-and-keep 只能保留在不参与 normal catalog discovery 的受保护区域；不得以发现范围内的第二个 canonical copy 当 backup。backup/hold 不是删除 legacy 的替代授权，也不能被自动清理。
5. **Deletion 不可恢复：** 用户确认文案、产品 policy 和 audit 都必须明确 legacy delete 的不可逆性及可用 restore 保障（若有）。没有获批 backup/hold policy 时，不得声称 delete 后可恢复。

## 6. UI、consent、legal/retention 与 audit

当前 Settings/diagnostics 只能继续显示 C-6A 的 aggregate preflight，不能加入迁移按钮或候选明细。若未来另行批准 UI，它也只能显示最小 aggregate、当前不可用/blocked/ready 状态、确认所需的后果和 policy version；不得显示 path、identifier、content、checksum/hash、原始 blocker 细节或任何可枚举 source 的列表。

未来 destructive confirmation 必须：

- 由获授权主体在可信 main-owned scope 上显式触发，具有清晰的不可逆 delete 提示、有效期与取消路径；
- 不从历史 preflight、自动 retry、设置切换、启动恢复或 renderer 传入参数推断 consent；
- 先满足适用的用户同意、组织 policy、legal hold、retention 与备份要求；未满足时一律不 copy/delete；
- 产生最小 audit：事件类别、operation handle、policy/version、时间、phase、aggregate outcome/status。audit/log/telemetry/error 不得记录 raw content、identifier、path、scope root、checksum/hash、candidate count 与 source/destination mapping 的可重建形式。

## 7. 实施前提、能力缺口与未来最小 safe slice

任何真实 migration 之前至少需要单独批准并证明：

1. main-only trusted identity/scope authorization 和一次性 confirmation binding；
2. 可测试的 descriptor-relative no-follow copy、exclusive destination create、durable publish、descriptor-bound delete 与目录同步 capability；不具备的平台必须 fail closed，不能退回不受约束的 path I/O；
3. 既满足数据最小化、又足以处理 crash/duplicate/hold ownership 的 private recovery model。当前 aggregate-only C-6A 不能提供逐项 resume 所需映射；
4. 非覆盖 duplicate policy、hold/archive access/retention/cleanup policy、legal hold 与 delete irreversibility policy；
5. fuzz/fixture 驱动的安全测试，覆盖 unsafe/deep/symlink/unknown partition、same-identifier equal/different duplicate、scope mismatch、source drift、external edit、concurrency、disk-full、crash at every phase、partial copy/delete、retry/idempotency、legacy tolerant read 与所有日志/UI/audit 的非泄露。

在上述门槛获批前，唯一可讨论的最小 safe slice 是 **main-only dry-run intent/receipt preview**：它重新做只读 preflight，验证 trusted scope，并仅生成/显示短期 aggregate-only intent 状态；不 copy、不创建 hold、不 publish、不 delete、不新增 renderer path input。可选的 “copy to private hold without delete” 比 dry-run 风险更高，必须在单独评审中先解决 hold ownership、crash cleanup 与 legal/retention policy，不能由本文自动授权。

未来 dry-run slice 的验证至少应证明：canonical Memory bytes、mtime 和目录布局不变；缺失 root 不创建；aggregate/receipt/UI/log 不含敏感 locator 或内容；stale/duplicate/recovery blocker/authorization failure fail closed；并发 intent 不扩大 scope；以及没有 startup/background/autoretry path。

## 8. 需要产品/用户决定的问题（最多两项）

1. 是否存在明确的用户/运维需求，足以接受受控 legacy delete；若存在，默认是 delete 后不保留副本，还是必须使用受保护、可恢复的 managed backup/hold？
2. 哪些用户/运维角色、scope 与 legal/retention/consent 条件可以发起确认，以及发生 partial delete 后允许的人工恢复责任与时限是什么？

## 9. 交接结论

**C-6 controlled migration design gate recorded。** `5803176` 的 C-6A 仍只是严格只读、aggregate-only preflight；C-6 已分区/legacy tolerant read 的现状不变。真实 controlled migration、copy、checksum verify、explicit confirmation、legacy delete、跨崩溃 resume/cleanup、迁移 UI/IPC 都仍未实现且未获批准。
