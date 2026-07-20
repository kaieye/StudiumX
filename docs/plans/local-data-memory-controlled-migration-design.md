# C-6：受控 legacy Memory 搬迁设计门、恢复协议与验收计划

> **状态：阶段 2（main-only readonly dry-run）已实施；destructive migration 延期、未批准、未实现。** 已实施：scope 分区、flat/scoped 兼容读取、aggregate-only readonly preflight（[ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md)），以及 main-only readonly dry-run intent/receipt preview（[ADR-0022](../adr/0022-memory-readonly-migration-dry-run-and-destructive-deferral.md)）。Stages 0–1、3–6 保留为未批准设计门，**不是**可分派实现任务；`docs/local-data-todo.md` 已不再将 C-6 列为开放实现工作流。本文**不是**启动、后台、自动或 UI 迁移的授权；readonly preflight/dry-run 不构成 destructive consent。

## 1. 问题、目标与非目标

### 1.1 要解决的问题

旧版 Memory 将记录以 flat JSON 文件保存在 Memory root；新的写入按记录的稳定 scope 分区。长期同时保留两个布局会使 scope 隔离、冲突处理和运维恢复都依赖兼容读取。C-6 的唯一目标是：在明确授权的一次性受控操作中，将**当前可证明唯一、合法且属于获授权 scope 的 legacy flat canonical record**复制到其现行 scoped canonical 位置，并且只有在复制、持久化、验证、确认及再次校验全部成功后，才考虑删除对应 legacy source。

迁移必须保留以下不变量：

- 移动前、取消后、失败后和未决状态下，legacy Memory 继续可读；不能因迁移而丢失已选中的 canonical record。
- scoped destination 由 main 根据已验证 record 推导；不得把 renderer、SQLite projection、历史 preflight、缓存结果或用户输入的路径当作 authority。
- 不覆盖已有 scoped destination，不合并同 ID 的多个 source，也不将 duplicate 视为可自动修复的正常状态。
- 多文件 copy/publish/delete 不是跨文件事务；任何无法证明的 I/O 结果均不得报告为成功，也不得自动 delete、rollback、resume 或 cleanup。

### 1.2 明确不在范围内

本设计不改变 Memory record 的业务语义、scope 规则或 normal CRUD；不改写 record 内容来“格式化”历史数据；不将 SQLite/index、summary、backup、hold、receipt 或 audit 变成 canonical authority。以下项目均排除：

- startup、background、定时任务、analytics、diagnostics、普通 `list/find/recall` 或 Settings 刷新触发的迁移；
- 迁移按钮、candidate 列表、单条路径/ID/内容/哈希明细，或 renderer 提供任何特权文件 I/O 参数；
- 无确认 copy、直接 rename/move loop、覆盖写 destination、自动 duplicate 修复、自动 legacy delete；
- 将 private hold/backup 放进普通 Memory catalog discovery 范围，或用 retention 绕过单独的删除同意、legal hold、恢复与审计要求；
- 把 [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) 的 `traceId` 扩展为 migration identity、精确 retry key、receipt key 或全局事务身份。

## 2. 现状与证据边界（压缩）

已实施范围权威记录见 [ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md)。**真实 destructive migration 未获批准、未实现。**

| 已实施能力 | 含义 | 不构成 |
|---|---|---|
| 新写入进入 scoped partition；flat/scoped 兼容读取 | 迁移期间须保留 tolerant read，直至独立 legacy EOL 决策 | 自动搬迁或 legacy 自行消失 |
| 同 ID 不同 bytes → `duplicate_conflict`；bytes 相同仍拒绝 mutation | duplicate 是迁移 blocker | 可按 selected source 删除 |
| scoped record 改变 partition 被拒绝 | 迁移只可保持既有 scope | scope relocation 授权 |
| descriptor-relative、no-follow root/parent I/O | 未来 copy/publish/delete 必须沿用或加强 | pathname fallback 授权 |
| Windows Memory descriptor capability fail closed | 必须定义 per-platform profile | 不支持平台上的真实迁移 |
| `diagnosticsSnapshot()` aggregate-only readonly preflight + main-only dry-run intent/receipt | 可显示 eligible/blocked 计数与 `migrationReady` 布尔；dry-run 提供短期 aggregate intent/receipt preview（ADR-0022） | consent、authorization、reservation、delete permission 或可复用为 destructive authority 的 snapshot/intent |

相关代码：`src/main/teaching-memory-catalog.ts`、`src/main/teaching-memory-catalog/record-file.ts`。基线验证入口见第 11 节；它们**不**验证未来 destructive migration。

共享 durable primitive 不等于跨文件事务，见 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md)；trace 安全边界见 [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md)。

## 3. 目标架构与 authority

### 3.1 durable authority 与布局

真实迁移若获批，canonical authority 仍是单个 Memory record JSON 文件；迁移不是 schema migration，也不得改变该 record 的 bytes、ID、content、tags、timestamps、tombstone 或 scope。候选协议采用 **byte-preserving copy**：destination 使用已存在的 canonical encoded record filename，内容为经内部验证的 source bytes。这样 source/destination 的一致性可以在 main 的受限 capability 内验证，而不把内容或 digest 暴露到 UI、日志、普通 receipt 或 audit。

目标布局沿用当前格式：

- `user` scope 的 target partition 是 `_global`；
- `workspace` / `project` 的 partition 名由 main 对已规范化的 scope root 计算稳定 SHA-256 base64url digest，并带 `.v1`；
- target leaf 是由 record ID 编码得到的 canonical `memory-*.json` 名；
- catalog 只认可 root-flat 文件以及已识别 partition 的一层 canonical leaf；symlink、deep directory、未识别 partition、非 regular leaf、文件名不匹配、invalid JSON/record、scope mismatch 都是 recovery/security issue，而不是可迁移输入。

该布局是内部实现细节；renderer 不接收或展示 partition、scope root、leaf、fingerprint、hash 或 locator。

### 3.2 main-only operation boundary

未来 operation 必须由 main 创建并持有。请求边界只能传达经批准的高层用户动作；main 自行取得可信调用身份、当前 access scope 和 catalog root，再执行当次 discovery。下列值一律由 main 派生并保持私有：source descriptor、target partition/leaf、hold location、记录 fingerprint/checksum、lease、recovery provenance 和任何 canonical locator。

operation 必须绑定到：

1. 当前可信身份与当前授权 scope；
2. 一次性、明确、可取消且会过期的 intent；
3. 当次 descriptor-bound discovery 所证明的唯一 accepted source 和 target absence；
4. 若涉及 delete，则独立于 preflight 的 destructive confirmation。

Settings 刷新、`migrationReady`、历史 confirmation、重启、自动 retry、renderer reload、trace、analytics 状态或同内容记录都不能推导以上任何绑定。

### 3.3 串行化与并发

同一 Memory root 与授权 scope 上，main 必须持有 scope-bound、main-owned serialization/lease（或经评审的等价互斥）覆盖 intent 创建至最终处置。无法取得 lease 时返回稳定、非敏感的 `busy`；不得并发 copy、publish、delete 或通过“最后写入者胜出”处理冲突。lease 失效、进程崩溃、外部修改、意外 duplicate、source/target 重现或不能重新建立授权时，operation 转为 `indeterminate` 或 `recovery_required`，而非继续执行。

## 4. 数据模型、隔离与最小化

### 4.1 record 与 scope 隔离规则

Memory record 当前包含 `id`、`content`、`scope`、可选 `workspace`/`project`、tags、confidence、时间字段和可选 main-owned `traceId` 等业务字段。迁移只能接受 catalog 已规范化且完整性校验通过的 record：workspace scope 必须有 workspace root，project scope 必须有 project root；target partition 必须与该 record 的 current scope 完全一致。不得由 source 文件所在目录、renderer path、SQLite row、旧 partition 或用户选择替代这一判定。

access scope 同时是读取隔离和迁移授权边界：user record 可全局访问；workspace/project record 只能在规范化后的对应 workspace/project access 下访问。跨 scope、scope root 不一致、partition/record 不一致或 source 不唯一均 fail closed；不得复制到“更宽” scope、merge 多 source 或借 migration 修复历史 scope 数据。

### 4.2 intent、receipt、hold 与 recovery provenance

真实迁移需要三类互不替代的数据，且必须在实现前获得 privacy/operations owner 批准：

| 数据 | 最小职责 | 不得承担的职责与禁止字段 |
| --- | --- | --- |
| 内存中的 operation context | 在单次 main operation 内持有 descriptor、内部验证材料、lease、当前 phase 和重新校验结果。 | 不得从 renderer 反序列化 locator/hash；进程重启后不得把内存状态当成可安全 resume 的证据。 |
| private receipt | 以 opaque operation identity、有限 phase/status、时间和必要的非内容性授权/确认事实表达**已证实**状态。 | 不是 Memory authority、锁、事务日志或自动恢复指令；不得保存 content、canonical ID、path、scope root、checksum/hash、候选清单、raw I/O error 或可枚举 locator；如经 ADR-0005 边界批准保留 trace，它只能作 diagnostic correlation，不能作 operation/retry/dedupe/receipt identity。 |
| private hold 与最小 provenance contract | 在 delete 前保留独立、受访问控制且不被 normal catalog discovery 扫描的 source bytes；支持经批准的人工恢复。 | 不是第二个 catalog-discoverable canonical copy；不能凭 receipt 的 phase 猜测 ownership，也不能自动 cleanup、自动 restore 或绕过 legal hold。 |

receipt 不能同时满足“完全不保存 locator/identifier/hash”和“跨崩溃逐项找回、验证、cleanup”的需求。因此，跨重启的 hold ownership、provenance、retention/locking、加密/访问控制（若适用）以及人工恢复定位方式必须形成单独的最小化 contract 并接受审查；在它未被批准前，不能实现自动 resume、自动 cleanup 或逐项恢复。该问题是设计 blocker，不可由更多 aggregate preflight 字段解决。

### 4.3 公开结果与审计边界

最终 API/UI vocabulary 必须由产品 owner 批准；候选仅限稳定、不可枚举的高层结果，例如 `not_authorized`、`not_ready`、`busy`、`cancelled`、`blocked`、`indeterminate`、`recovery_required`、`completed`、`partial_delete`。是否暴露 `completed` 以及其含义必须与 delete/hold policy 一同决定。

公开 UI、日志、diagnostics、audit、error 和 receipt 都不得含 raw content、canonical ID、source/destination path、scope root、partition、checksum/hash、候选数量之外的可关联明细，或 raw OS error。audit 只应记录获批准的最小 operation correlation、phase/result、actor/owner 与保留期；不得写入 normal Memory record、analytics payload 或通用 error text。

## 5. 前置检查、受控协议与状态语义

### 5.1 每次 destructive operation 的 preflight

一次 `migrationReady` 诊断不是操作资格。创建 intent 时、copy 前、confirmation 后、publish 前和 delete 前均需重新执行当次 descriptor-bound discovery 与 scope authorization。至少检查：

1. 当前平台具备获批准的 descriptor-relative no-follow read/copy/create/publish/delete/directory-sync profile；否则 fail closed；
2. root、source parent、target parent 和 leaf 均通过受限遍历；不存在 unsafe/deep/symlink/unknown-layout/recovery issue；
3. source 是唯一 accepted flat source；没有 equal 或 different duplicate、mutation-blocking ID、scope mismatch 或 source drift；
4. record 仍合法，授权 identity/scope 仍匹配，target partition/leaf 仍由 current record 派生；
5. target 不存在；任何 scoped target（即使 bytes 相同）都按 duplicate/recovery path 停止，绝不 overwrite；
6. hold policy、容量、access control、retention、legal hold 和人工恢复 owner 已满足；
7. destructive confirmation 仍有效、未取消，且确认绑定到当前 revalidated intent，不能被 old preflight 或 old receipt 复用。

preflight 发现 blocker 时不创建 Memory 文件、不移动文件、不删除 source；只返回最小 public result，并让 operations owner 通过获批渠道处理 recovery。

### 5.2 候选 phase protocol（获批后才可实现）

以下是唯一可评审的顺序；任何简化为 pathname rename loop、先 delete 再 copy 或自动重试 delete 的实现均不合格。

```text
trusted authorization
  → fresh descriptor-bound discovery + scope/duplicate/recovery validation
  → private intent + scope lease
  → private temp exclusive create
  → byte-preserving copy → file fsync → internal verify
  → durable private-hold publish + directory sync
  → explicit destructive confirmation
  → fresh discovery + authorization + source/target revalidation
  → durable non-overwrite scoped publish + directory sync
  → descriptor-bound legacy delete + required directory sync
  → final private receipt / operations disposition
```

具体语义如下：

- **copy/verify：**只从已绑定 source descriptor 读取，只向 main 派生的 private temp 写入；temp 必须 exclusive create，完成 write、file `fsync`、checked close 后，在受限边界内比较 source 与 copy。verification material 不得离开该 capability。
- **hold：**验证通过后才可 publish private hold；其 publish 也要求 non-overwrite、目录持久化和已批准的 close-error 语义。hold publish 成功不表示 migration 成功，更不授权 delete。
- **confirmation：**confirmation 发生在 hold 已被可靠保存之后，且单独、明确、默认拒绝、可撤销、会过期。它必须说明 destructive legacy delete 的后果及恢复/retention policy；不能由 UI ready 状态或 retry 自动补齐。
- **destination publish：**确认后必须重新 discovery；仅当 source 仍是同一已验证唯一 source 且 target 仍不存在时，才在已绑定 scoped parent 中以 no-overwrite publish，并同步 target directory。publish/dir-sync/close 任一结果未知时，不得声明 target 已完成或继续 delete。
- **delete：**只有 destination publication 可证明、所有重新校验仍通过且 confirmation 有效，才可在仍绑定的 legacy parent 上删除 exact source leaf，并按平台 profile 同步 parent directory。delete 后的 close/sync 失败、partial deletion 或外部变化都不是成功。
- **receipt：**每个 phase 只能在它声称的 durable fact 已证实后写入。receipt 不得把“可能已 publish/delete”压缩为 completed，也不承诺跨文件 atomicity、exact retry、自动 rollback 或 cleanup。

## 6. 失败、取消、回滚与恢复

### 6.1 不可逆边界

legacy delete 是不可逆的 destructive step，不能被当作普通 rollback。即便有 private hold，恢复也涉及 ownership、legal hold、access control、目标是否已被后续修改及 non-overwrite 冲突；因此恢复必须是独立、受控、经批准的 operation，不是 retry 中的自动动作。

| 观察到的阶段/故障 | 自动允许动作 | 必须禁止的动作 | 对外/运维 disposition |
| --- | --- | --- | --- |
| intent 前或 validation 失败 | 不写 Memory；释放内存态 lease。 | 依据旧 snapshot 重试、创建 root/target、删除任何 source。 | `blocked` / `not_ready` / `not_authorized`。 |
| temp copy、verify、hold publish 前失败或取消 | 保留 legacy 可读；仅在能证明 temp 由本 operation 所有且仍在已绑定 private parent 时，按 policy 清理 temp。 | 删除 legacy、发布 target、把 cleanup 失败吞成成功。 | `cancelled` 或 `indeterminate`；无法证明 temp ownership 则 `recovery_required`。 |
| hold durable 后、confirmation 前取消/过期 | legacy 保持；hold 按已批准 retention/legal-hold policy 管理。 | 自动删除 hold、自动继续、把 hold 当 canonical target。 | `cancelled`，operations 可见但不泄露 locator。 |
| confirmation 后、target publish 前失败 | legacy 保持；不自动续跑。 | 因已确认就重试 copy/delete，或删除 hold。 | `indeterminate` / `recovery_required`，需重新授权与完整 revalidation。 |
| target publish 后、legacy delete 前崩溃/失败/外部修改 | 保留两侧；停止并冻结为 duplicate/recovery case。 | 自动选择任一副本、覆盖、自动删除 legacy 或 target。 | `recovery_required`。 |
| delete 返回未知、目录 sync/close 失败或 partial delete | 停止；保留所有尚可读取的证据与 hold。 | 假设 delete 成功、盲目再 delete、自动 restore/rollback。 | `partial_delete` 或 `indeterminate`，进入人工恢复。 |
| final receipt 失败/损坏 | 不凭内存或文件名猜测最终状态；重新 discovery。 | 将 canonical state 报告为 completed、自动 cleanup。 | `indeterminate` / `recovery_required`。 |

### 6.2 crash/restart 原则

重启、崩溃、断电、进程终止、disk-full、权限改变、external edit、unexpected duplicate、source drift 和未知 native error 都默认 fail closed。startup 只能保持现有 legacy tolerant read；它不能扫描 hold 并续跑、不能根据 receipt 删除任何东西、不能自动清理或恢复。后续人工/受控 recovery 的最小顺序是：重新建立授权与 lease → fresh descriptor discovery → 验证 current canonical states、hold ownership 与 retention/legal hold → 返回 approved disposition。若不能证明任一步，保持 `recovery_required`。

## 7. 兼容性与上线约束

1. **读取兼容：**在真实 migration 的所有阶段以及停止/回退后，catalog 必须继续读取 legacy flat 和 scoped source；duplicate 仍按当前 fail-closed catalog 规则处理。没有单独批准的 legacy retirement 决策前，不得移除 flat discovery 或 tolerant read。
2. **写入兼容：**normal CRUD 继续遵循当前 source-preserving 和 scope-relocation refusal 语义；迁移不得偷偷改变任一普通 create/update/delete 的 IPC/API、结果或 side effect。
3. **IPC/UI 兼容：**首个技术切片不得改变既有 diagnostics payload 的 aggregate-only contract，也不得将 path/ID/content/hash 加入 Settings、analytics、preload 或 renderer state。真实 migration API 需另行批准，且只接受高层 action，不能接受 path/target/checksum。
4. **平台兼容：**每个支持平台与文件系统必须有明确 capability profile，包含 no-follow traversal、exclusive temp/create-no-overwrite、file/directory sync、descriptor-bound unlink、close error 和 crash semantics。任何未被证明的平台/profile 必须返回 stable fail-closed result；不能用非受限 `fs` pathname fallback。现有 Windows Memory capability fail-closed 不是 Windows migration 支持的证明。
5. **版本兼容：**partition `.v1`、record schema 和 canonical filename 的改变不属于本 C-6 计划。若将来需要格式升级，必须另立 design gate，不能在 migration copy 中暗中转换 bytes。

## 8. 运维、隐私与合规风险

| 风险 | 必须的控制与停止条件 |
| --- | --- |
| 误删或 partial delete | delete 前持久化并验证 private hold；由明确 owner 批准 confirmation、retention、legal hold 和人工恢复 SLA。任何未知 delete/sync/close 立即停止。 |
| scope 越界 / TOCTOU / symlink | main-only authorization；每次 phase transition fresh descriptor-bound discovery；逐段 no-follow；scope-bound lease；无 pathname fallback。 |
| duplicate 或外部编辑 | equal/different duplicate、target 已存在、source fingerprint/drift、scope mismatch 都停止并进入 recovery，不 merge、不覆盖、不自动选择。 |
| hold 成为数据泄露面 | hold 位于 catalog discovery 外，最小权限/ownership/retention/locking 必须先获批；禁止普通 UI、analytics、日志和索引扫描；禁止把它当“第二 canonical”。 |
| 审计/诊断反向泄露 | 只保留最小 opaque correlation、phase/result；统一脱敏/长度/单行限制；禁止 content、locator、scope root、ID、partition、digest、raw OS error。 |
| 容量与磁盘耗尽 | 在 copy 前评估获批准的容量阈值；write/fsync/dir-sync failure 立即停止。不得为释放空间先删除 legacy 或 hold。 |
| 法务、保留与用户预期 | destructive confirmation 文案、hold/receipt retention、legal hold、访问主体、恢复责任和时限必须由产品/隐私/运维 owner 书面批准；没有批准即保持 read-only。 |
| 可观测性不足 | runbook 必须覆盖 `blocked`、`busy`、`indeterminate`、`recovery_required`、`partial_delete` 的 owner、升级路径、审计保留和人工恢复入口；不得依赖可枚举诊断。 |

## 9. 分阶段工作项与验收门

每个阶段须单独立项，列出 scope、决策 owner、实现 owner、API/产品 contract、operations owner、平台 profile 与停止条件；完成一个阶段不自动授权下一阶段。

| 阶段 | 可分配事项 | 明确排除 | 进入下一阶段的可验证验收 |
| --- | --- | --- | --- |
| 0. 治理与 contract | 批准 destructive need、trusted identity/scope、confirmation、public result vocabulary、hold/receipt/provenance、retention/legal hold、人工恢复 owner/SLA。 | 任何代码、UI、copy、hold 或 delete。 | 书面 contract 覆盖本文第 4、6、8 节，尤其 receipt/provenance 的分离与 partial-delete 责任。 |
| 1. capability 与 fault model | 审计并测试目标平台的 descriptor-relative read/copy/temp/non-overwrite publish/unlink/file+directory sync/close；形成 crash/failure matrix。 | 用现有 replace primitive 或 unit mock 推导全协议已安全；pathname fallback。 | 对每项 native primitive 有 supported/degraded/fatal 语义；不支持即 fail closed；host-native/文件系统证据覆盖关键错误点。 |
| 2. main-only readonly intent preview（**已实施**，[ADR-0022](../adr/0022-memory-readonly-migration-dry-run-and-destructive-deferral.md)） | 在 fresh readonly discovery + trusted-scope validation 后生成短期 aggregate-only intent preview。 | copy、hold、publish、delete、新 renderer path input、迁移按钮/候选明细。 | missing root 不创建；canonical bytes/mtime/layout 不变；UI/log/audit 无 locator/content；intent 不可复用为 destructive consent。已由 dry-run 单元测试覆盖。 |
| 3. private hold 与 recovery foundation | 实现已批准的 private temp/hold、最小 provenance、lease、phase/receipt 和 recovery disposition，先不 delete。 | 自动 resume/cleanup/restore；把 hold 放入 catalog；destination/legacy 删除。 | 每个 crash point 可返回证明不足时的 `recovery_required`；hold 访问/retention 合规；recovery 不枚举 records。 |
| 4. controlled publish + confirmation | 加入 main-only confirmation binding、fresh revalidation、scoped no-overwrite publish 与最终 receipt；保持 legacy source。 | legacy delete、批量/后台执行、overwrite/merge。 | source bytes 和 destination bytes 在受限边界验证一致；target existed/source drift/duplicate 均不写入或停止；legacy tolerant read 不变。 |
| 5. destructive delete pilot | 在获批 cohort/平台上执行 descriptor-bound delete、directory sync、ops review 和人工恢复演练。 | 自动 rollout、自动 retry/delete/resume、把 hold 当永久无成本备份。 | 每阶段 crash/disk-full/permission/external edit/partial delete 均按本文第 6 节停住；审计、runbook、legal-hold 和恢复演练通过。 |
| 6. rollout 与长期兼容评审 | 受控观察、容量/异常监控、review recovery cases，并单独评审何时（若有）能停止 legacy tolerant read。 | 用迁移计数宣布 data retirement；删除 hold/legacy 的批量 cleanup。 | operations owner 确认无未决 recovery，且另一个 ADR/设计门批准 legacy end-of-life；否则继续兼容读取。 |

## 10. 必测安全矩阵与完成条件

未来实现必须增加 host-native 与 fixture/fuzz 测试；现有 aggregate preflight 测试不能替代它们。最小矩阵应覆盖：

- discovery：缺失 root、unsafe root、symlink、deep directory、unknown partition、non-regular leaf、invalid JSON/record、file-name mismatch、scope mismatch；
- source selection：flat only、scoped only、same-ID equal duplicate、different-byte duplicate、target pre-exists、accepted source 非唯一、tombstone/disabled record 与 source drift；
- authorization：renderer 不能传 root/path/target/checksum，scope mismatch、stale/expired/cancelled confirmation、旧 preflight/intent/receipt、lease busy/lease loss；
- durability：temp exclusive create、partial/negative/stalled read/write、file `fsync`/close、verify mismatch、hold publish、target no-overwrite publish、每次 directory sync/close、disk-full、permission/lock/antivirus（适用平台）；
- crash/recovery：每个 phase 前后崩溃，target publish 后 delete 前、delete 返回未知、partial delete、receipt 缺失/损坏、hold ownership 无法证明、external edit/restart；
- compatibility/privacy：flat/scoped tolerant read、normal CRUD 不触发 relocation、analytics/Settings/IPC 的 aggregate-only shape，以及 UI/log/audit/receipt/错误序列化均不含 content/path/root/ID/hash/locator。

C-6 只有在以下全部由当前证据证明时才可关闭：

1. 第 9 节各已批准阶段的 owner 决策、platform capability profile、代码与 runbook 均已交付；
2. 对每一项失败矩阵，public result、canonical authority、允许的唯一 recovery action 和人工责任均已定义并通过测试/演练；
3. 所有 destructive delete 都有有效 confirmation、已证明的 hold/provenance、fresh authorization/revalidation 和 non-overwrite target publish 证据；
4. 不支持/未知/冲突状态在所有平台均 fail closed，无 startup/background/automatic resume 或 pathname fallback；
5. 兼容读取、scope 隔离、非泄露 diagnostics/audit 及 normal CRUD 回归均通过；
6. 隐私、retention、legal hold、capacity、audit 和 partial-delete recovery 已由相应 owner 验收。

在上述证据齐备前，**destructive C-6 保持未关闭且不可分派为实现**（[ADR-0022](../adr/0022-memory-readonly-migration-dry-run-and-destructive-deferral.md)）。当前已实施且可用的行为是：scope partition、legacy tolerant read、aggregate-only readonly preflight，以及 main-only readonly dry-run intent/receipt preview。阶段 2 验收已满足；不得据此推断 copy/hold/publish/delete 已授权。

## 11. 当前基线验证与实施后验证入口

本文件不声称这些命令验证了未来 destructive 迁移；它们复核分区/preflight 基线与阶段 2 dry-run。实施真实迁移时，必须为第 10 节新增定向测试和 host-native/operations 证据。

```sh
pnpm run build:contained-durable-replace

pnpm exec vitest run --project unit \
  tests/unit/teaching-memory-migration-dry-run.unit.test.ts \
  tests/unit/teaching-memory-catalog.unit.test.ts \
  tests/unit/teaching-memory-recall.unit.test.ts \
  tests/unit/teaching-ipc-gateway.unit.test.ts

pnpm exec vitest run --project integration \
  tests/integration/teaching-analytics.integration.test.ts

pnpm run typecheck
```

审阅时应同时核对：[ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) 与 [ADR-0022](../adr/0022-memory-readonly-migration-dry-run-and-destructive-deferral.md) 的已实施/未包含边界、[ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 的“共享 durable primitive 不等于跨文件事务”限制、[ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) 的 trace 安全边界。destructive migration 不在 [本地数据待办](../local-data-todo.md) 的可分派开放列表中；重新立项须满足 ADR-0022 第 3 节前提。
