# C-4P9 Session-audit durable append：可实施设计、边界与验收门

> **状态：未关闭；本文是后续切片的设计基线，不是实现授权，也不宣告 C-4P9 complete。**
>
> V1 wire、identity、exact-retry 与有限 authority 见 [ADR-0019](../adr/0019-session-audit-v1-wire-contract-and-limited-authority.md)。S2 生产 durable append 与 S3…S45 tests-only 证据见 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 和 [ADR 索引中的 P9 证据说明](../adr/README.md)。待办入口：[本地数据待办（P9）](../local-data-todo.md)。本文件不维护已关闭实现细节或测试台账。

## 1. 目标、非目标与当前事实

### 1.1 目标

在不改变既有会话 archive 的事实来源、保存顺序或用户可见语义的前提下，为每个 conversation 的 session audit 定义一个可证明的 append 边界。该边界必须回答：**写了哪些审计事件、何时可称完成、失败后哪些字节可能已存在、如何安全重试、以及在什么平台/运行方式下该结论成立。**

本设计的最终交付不是“调用过 `fsync`”，而是下列可验证的 contract：

1. 对同一 canonical audit row 的 retry 不重复写入，也不修改已有字节；
2. 冲突、损坏、未知 I/O 结果和不支持的平台能力不会被报告为完整 durable success；
3. archive JSON、Markdown、audit 与 learning-work ledger 的顺序、authority 和残留状态对调用方、运维和测试都明确；
4. 留存、隐私、权限和诊断不因 durable append 被削弱；
5. 声称支持的每个 host/filesystem profile 都有相应的 failure、restart 和 operations evidence。

### 1.2 当前已实现的、可依赖的事实

已实施事实压缩为 ADR 链接，close-out 工作不得把它们扩大解读：

| 主题 | 权威记录 |
|---|---|
| V1 wire、identity、ordering、exact-retry、legacy-tolerant read、有限 authority | [ADR-0019](../adr/0019-session-audit-v1-wire-contract-and-limited-authority.md) |
| S2 fixed-file durable append 生产边界；S3…S45 tests-only residual | [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) |
| main-owned trace correlation（audit 可选 `traceId`） | [ADR-0005](../adr/0005-main-owned-trace-correlation-and-safe-logs.md) |
| 新持久化 history 脱敏 | [ADR-0007](../adr/0007-persisted-user-history-redaction.md) |

**对本 close-out 仍重要的缺口摘要：**

- 仅本进程同路径串行；无跨进程 multi-writer 承诺。
- directory sync 降级 warning ≠ parent-directory / power-loss 证明。
- archive save 顺序是 ordered best-effort，不是跨文件 transaction。
- 定向 unit 覆盖 fixed-file / dedupe / conflict / torn-tail 等，不证明 generic JSONL、rotation、repair、Windows native durability 或真实断电恢复。

代码入口：`src/main/agent-conversation-session-audit.ts`、`src/main/agent-conversation-archive.ts`。

### 1.3 明确非目标

除非先按第 9 节批准独立切片，P9 不得：

- 迁移其它 JSONL writer，或把 `src/main/durable-jsonl.ts` 的 ledger segmentation 自动施加给 session audit；
- 更改 audit schema/version、header、entry ID、`parentId`、row ordering、legacy tolerant read，或 backfill / normalization / rewrite 旧 bytes；
- 按月份、大小、年龄或容量自动 rotation、sealing、cleanup、retention、compaction、deletion、purge、quarantine、restore 或 repair；
- 改变 JSON/Markdown/audit/ledger 的 archive save order，改变 ledger ownership，或把多个 rename、队列或锁描述为 transaction；
- 新增 trace identity、action ID、receipt、通用 idempotency model、IPC、preload API、renderer UI 或 operator repair command；
- 把 [ADR-0003](../adr/0003-critical-json-backups-and-verified-recovery.md) 的关键 JSON `.bak` 机制扩展到 audit JSONL，或将 audit 作为 SQLite projection 的输入而未单独审查。

## 2. 审计事件边界与数据契约

### 2.1 何时生成、何时写入

一个 `AgentConversationRecord` 在 archive durable boundary 已经过 `sanitizePersistedAgentConversationRecord()`；artifact promotion 完成后，才从该持久化 record 构建 audit header 与 entries。每次 archive save 以**该次 sanitized record 的完整可生成 row 集合**为 append 输入，而不是暴露给 renderer 的增量 audit API。

因此，audit 的事件边界是“一个已通过 archive preflight 的 conversation record 在保存时所代表的 session snapshot”。它不是 provider request log、原始工具 payload log、用户操作 receipt，也不是 learning-work ledger 的替代。audit append 成功仅说明该 audit row 集合经过本节 contract 处理；它不单独决定 JSON/Markdown archive 是否可见，更不覆盖 ledger 的 snapshot identity authority。

### 2.2 V1 wire contract（保持不变）

V1 header/entry 类型、UTF-8 JSONL framing、legacy-tolerant read 与“不 rewrite/backfill/normalize 旧 bytes”已由 [ADR-0019](../adr/0019-session-audit-v1-wire-contract-and-limited-authority.md) 固定。后续 P9 切片默认**不得**改变该 wire；若确需 schema/version 变更，必须先完成第 7 节兼容矩阵与独立批准，不能静默附带 rewrite。

### 2.3 身份、顺序和重复处理

Identity、ordering、exact-retry 与 conflict fail-closed 规则已由 [ADR-0019](../adr/0019-session-audit-v1-wire-contract-and-limited-authority.md) 固定，并仍是任何泛化前的回归基准。后续切片额外约束：

- 不得排序、合并、重新编号或为“美化”无缺失 row 的文件写入换行/rewrite；
- 不得把 tolerant read 扩大为接受任意字段增删；
- 任何新 event type、字段、identity 规则或 sanitizer 输出变化，必须先有版本兼容矩阵（旧 reader × 新 writer、旧 writer × 新 reader、mixed retry），并以新增 version 或明确兼容 decode 实现；不能借用 V1 tolerant reader 静默改变 contract。

## 3. 持久化、分区与 authority

### 3.1 当前分区决定

session audit 的物理 partition 就是其 conversation placement：一个 conversation 对应一个 fixed `.jsonl` 文件，位于该 conversation 的目录下。conversation 的 UTC `YYYY/MM` placement 及 legacy flat read compatibility 已由 [ADR-0002](../adr/0002-utc-partitioned-segmented-jsonl-and-summary-projections.md) 决定；P9 不另建按月 audit partition，也不创建 active/sealed audit segments。

`learning-work.jsonl` 的 active/sealed segment discovery、50 MiB / UTC month rotation 是其 own logical-ledger contract，不能作为 audit rotation 的依据。`src/main/durable-jsonl.ts` 的存在不表示 audit 已迁移到 generic API。

### 3.2 authority 表

有限 authority 已由 [ADR-0019](../adr/0019-session-audit-v1-wire-contract-and-limited-authority.md) 固定。P9 close-out 不得改变的结论：

| 参与者 | 作用 | 不得改变 |
| --- | --- | --- |
| artifact / archive JSON / Markdown | canonical 或 promotion 事实 | audit 成功不能修复、覆盖或替代它们 |
| session audit JSONL | append-only session evidence | 不单独决定 archive 发布成功或 ledger authority |
| learning-work ledger | snapshot identity / trace collision gate | audit 不得改变 ledger ID、trace conflict 或 ownership |
| SQLite index / summary | 可重建 projection | 不能成为 audit 写入/留存/删除/恢复 authority |

Archive save 返回前的 verification 是一致性检查，**不是**四者共同原子提交。

### 3.3 rotation、sealing、backup 与 repair 的决定门

当前设计选择**不为 P9 引入** rotation、sealing、segment discovery、`.bak`、自动 repair 或 migration rewrite。原因不是这些能力永远不需要，而是它们会改变 fixed-file discovery、history/artifact protection、verification、failure surface 与 deletion/lifecycle 边界。

若未来产品明确需要它们，必须先由单独批准的 generic JSONL / audit compatibility proposal 定义：逻辑 source ID、active/segment 命名和严格 discovery、rotation trigger、seal 前 file/directory durability、reader ordering、mixed-version readers、segment checksum/manifest 是否存在、capacity stop behavior、repair 的唯一 authority、字节保留/损失政策、operator authorization 和审计记录。没有该决定，任何按文件大小/月份的 audit 分段都是越界。

`.bak` 同样不是默认 fallback：ADR-0003 只批准关键 JSON 的 verified recovery，不授权其它事实文件。对 audit bytes 的损坏，默认动作是停止自动写入并保留现场，不覆盖 canonical file，不从 archive/SQLite/ledger 自动重建，也不删除“坏尾部”。

## 4. 并发、原子性与失败恢复

### 4.1 并发模型

现状的同进程 per-path queue 是唯一已实现的 serialization。它保证同一规范绝对 path 的两个 save 不会并行执行 read/dedupe/append/sync/close；队列前一项失败后，后一项仍会运行。它**不**提供：跨路径顺序、跨进程/多 Electron instance exclusion、网络文件系统协调，或文件级 advisory/mandatory lock。

完整 P9 在声称 cross-process support 前必须二选一并记录 profile：

- **single-writer profile：**产品和启动模型能证明每 workspace 仅一个 main process writer；第二个 writer 被阻止或以稳定 `writer_unavailable` 失败。验收必须含两个真实进程的负面测试；或
- **coordinated multi-process profile：**另行实现并审查可恢复的 OS-level lock / lease protocol，明确 lock identity、wait/cancel、owner crash、stale lease、NFS/SMB 不支持、retry 和 diagnostics。仅有 Node 内存 `Map` 不可作为该 profile 的证据。

在作出选择前，文档和产品不得宣称 audit cross-process safe。

### 4.2 append 的原子性边界

单一 append operation 不是“整批 row 原子提交”：它可能需要多次 `write()`，并可能在任意一次之后失败。当前安全属性是**append-only prefix preservation + framed retry dedupe**，而不是 all-or-nothing。`O_APPEND`、per-path queue、file `sync()` 和目录同步也不构成与 JSON、Markdown 或 ledger 的共同原子性。

每个后续实现必须按下表暴露/记录内部 disposition；未批准 IPC/UI 前，这些是 main-internal contract 与 runbook 状态，不得新增公共 surface：

| 阶段 | 成功后可知事实 | 失败时的 disposition | 唯一允许的自动动作 |
| --- | --- | --- | --- |
| `mkdir` / pre-open inspection | 可能仅创建了目录；尚未证明 audit row 写入 | `not_appended`（对 audit row）或 `precondition_failed` | 不重写；仅将失败返回调用者 |
| `open`、post-open `stat`、exact read、identity check | 已取得 descriptor 或读取了 bytes；尚未写新 row | `not_appended`、`conflict` 或 `read_unknown` | conflict/read_unknown 停止；不可猜测或 repair |
| 首次至最后一次 `write` | 已有任意 prefix 可能落盘 | `possibly_appended` | 不 rollback/delete/truncate；仅允许以**同一 canonical input**显式 retry，由 dedupe 检查恢复 |
| file `sync` 或 `close` | 全部 bytes 可能已写，durability/descriptor release 未证实 | `possibly_appended` | 同上；不得报告 success |
| audit / parent directory `open`、`sync`、`close` | file 已成功 `sync`/`close`；parent metadata durability 可能未知 | `file_synced_directory_unknown`；allowlist downgrade 为 `file_synced_directory_unsupported` | 返回受控失败或受控 degraded state；不得叫作 full durable success |
| 所有要求的 file 与 directory 边界完成 | 仅在批准 profile 的语义内完成 durable append | `durably_appended` | 可继续下一个 ordered archive stage |

当前 production API 尚未将上述 disposition typed 化；现状对 allowlisted directory downgrade 只发固定 warning 后 resolve。为了不误报，未来 close-out 必须把该现状明确映射为 profile-limited/degraded result，或提供经 host-native 验证的等价 durability primitive。不得把不支持行为标为 full durable success。

### 4.3 archive crash/retry 状态机

正常顺序仍是 `artifacts → JSON → Markdown → audit → ledger → verification`。可观察的 crash/residual 只可按 ordered best-effort 解释：

| 已完成的最后一步 | restart 时可能存在 | 权威解释与允许动作 |
| --- | --- | --- |
| preflight / artifact promotion 前 | 无新 canonical archive；可能有受自身规则保护的 staged/artifact state | 不以 audit 判断；遵循 artifact/archive 既有流程 |
| JSON | 新 JSON、旧/缺失 Markdown、无新 audit/ledger | 不自动 rollback JSON；同 record retry 继续既有顺序 |
| Markdown | 新 JSON + Markdown、无新 audit/ledger | 不视为 archive+audit transaction；同 record retry |
| audit write/sync/dir failure | JSON + Markdown；audit 可缺失、完整、或含 torn/partial tail；无新 ledger | 保留 audit bytes；只用相同 record retry 进行 dedupe/reconciliation |
| audit completed、ledger 尚未完成 | JSON + Markdown + audit；ledger 可能缺失 | ledger 保持 own identity/trace checks；retry 不能生成新 trace 或新 audit identity |
| ledger completed、verification failure | 四类文件可能均存在但调用结果失败 | 只做 read/verify；不得 rollback/delete；通过既有 identity/dedupe 重新运行后才能确认 |

“same record retry”意味着传入的 canonical IDs、body、trace state 和 archive placement 必须仍满足第 2 节。body/trace conflict、未知 read、越界路径或损坏都不是 blind retry 的许可。任何要在 restart 时自动调度 reconcile 的方案，必须先单独定义触发者、输入认证、停止条件、operator approval、日志脱敏和不会跨越 C-2/C-3 lifecycle 边界的证明。

## 5. 留存、隐私与安全

### 5.1 留存与备份

依据 ADR-0002，canonical local teaching data（包括 canonical JSONL）无限期保留；P9 不授予基于年龄、大小或磁盘压力的 audit 删除、截断、压缩或自动 cleanup。容量不足是受控写失败/运营告警条件，不是丢弃 audit bytes 的理由。

audit 不自动获得 `.bak`、restore 或 quarantine。既有 critical-JSON backup 的 approved scope 不覆盖 audit；任何新的 audit backup/restore 设计必须另行说明 backup 是副本而非 authority、加密/访问、完整性验证、restore 是否追加还是替换、重复处理与用户/操作员授权。在此之前，损坏审计文件保留原样并停止自动修复。

### 5.2 隐私数据契约

audit 是持久化数据，不是安全日志。它包含 redacted title、content/arguments preview、source/child-run/compaction/context/usage/tool diagnostic 的受限元数据，因而仍可能包含个人或敏感业务信息。当前边界为：archive 和 audit 写入前使用 persisted-history sanitizer；secret text 经 agent secret redaction；trace ID 仅接受 normalized UUID；artifact 只记录受限 reference/preview，而不把大工具结果直接塞入 audit。该边界与 [ADR-0007](../adr/0007-persisted-user-history-redaction.md) 一致，但不能被解读为“audit 从不含敏感数据”。

后续变更必须满足：

- 不得新增 raw prompt、完整 turn/tool payload、secret、provider/request identifier、绝对路径、原始 artifact 内容、未脱敏 Memory 内容或可还原它们的 locator/hash 到 audit、metric、warning、error 或 support bundle；
- 新字段先经过 typed sanitizer，并给出最大长度、字符/换行处理、redaction proof 和 legacy compatibility 测试；
- `traceId` 仅作 correlation，不得成为用户输入或跨系统个人标识；
- diagnostic 只能使用稳定 code、stage、host capability class 和计数；不得记录 conversation/header/entry ID、文件 path、title、payload、secret 或原始 errno message；
- 后台 repair、backup、export、support collection 或 SQLite ingestion 均是新的 privacy surface，需单独批准。

### 5.3 文件与路径安全

现有 leaf protection 是 `lstat` regular-file check 加 `O_NOFOLLOW` open 后 `stat`；它能拒绝已知 non-file target 和 leaf symlink race，但不等于 descriptor-relative root containment 或跨平台 CAS。新设计不得将它宣传为 strict containment，尤其不得把它外推至 Windows、reparse point、parent replacement、跨进程竞争或 network filesystem。

创建权限沿用 `0666` + `umask`，不得暗中改成更宽松的 mode；若产品要求更严格的 audit ACL/encryption/key management，需单独的平台安全设计和 migration plan。所有 repair/backup/operator 权限也必须最小化，并在 main process 中校验，不能从 renderer 传递任意路径。

## 6. 平台 capability、观测与运营

### 6.1 capability profile

每一个被声明支持的 profile 至少要记录 OS 版本、Node/Electron runtime、filesystem、local/removable/network storage 类别以及以下矩阵的 supported/degraded/fatal 结果：`mkdir`、path inspection、file open/stat/read/write/fsync/close、audit-directory open/sync/close、parent-directory open/sync/close、rename/replace（若未来引入 rotation）、process crash 与 restart。

- POSIX 目录同步只在实际 host/filesystem 测试后才可成为该 profile 的 durability evidence；allowlist errno 不等于所有 POSIX filesystem 支持。
- 当前 Windows/Node profile 没有可据以宣称 directory `fsync` 或 power-loss durability 的证据。Windows 应明确为 unsupported/degraded，直到完成 host-native HANDLE/file flush/close/error 行为审计和 adversarial validation。
- 普通 unit mock、一次 `fsync` 成功、或文件最终存在，都不足以推出 power-loss durability。任何此类声明要先有获批 fault model，并按目标平台执行 crash/restart 或真实 reboot/power-loss 测试。

### 6.2 隐私安全的观测

实现前先定义并批准一个低基数、无内容的 internal observability schema。例如仅允许记录：`audit_append_attempt_total{result,stage,profile}`、`audit_append_degraded_total{reason}`、`audit_append_conflict_total{kind}`、`audit_append_reconcile_total{result}`、`audit_append_duration_ms` 和 capacity threshold state。字段值必须是有限词表，且不得以 path/ID/trace/error message 作为 label。

当前没有获批的 audit durability IPC/UI。若未来需要显示状态，renderer 只可接收稳定、可本地化的 state/code（例如 `completed`、`degraded`、`conflict`、`needs_review`、`writer_unavailable`），不能收到 raw filesystem error、绝对/相对路径、payload 或 audit identity。每个 state 都要说明是否可 retry、是否可能已写入、是否需要 operator review。

### 6.3 runbook 与停止条件

批准的切片必须指定 implementation owner、operations owner、support escalation 和 release owner，并随代码交付 runbook。runbook 至少包括：新安装、升级、downgrade refusal、磁盘满/permission denied、allowlisted directory downgrade、unknown I/O、partial/torn tail、identity conflict、双进程 writer、应用异常退出、backup/restore（如另行批准）和 capacity alarm。

以下任一情况必须停止自动推进、保留原 bytes 并进入 review：canonical-body 或 trace conflict、read/parse identity 不可证明、file target 非 regular/symlink、unknown/stalled transfer、close failure、未声明 capability、跨进程 writer、任何 repair/restore 前置条件不满足。runbook 不得用 truncate、overwrite、delete、自动 backfill 或“再写一次不同 record”处理这些状态。

## 7. 迁移与兼容计划

当前没有 audit schema/path migration；因此第一条迁移规则是**不迁移**。legacy flat conversation placement、旧 trace-free/malformed row、legacy header/turn shape 都继续 read-tolerant，且不得因读取而写回新格式。

若将来获批改变路径、version、segment layout、权限、encryption、backup 或 reader，则必须按以下顺序交付：

1. **read-only inventory：**只扫描候选 audit 文件，输出脱敏 aggregate（file count、byte count、version/shape count、failure code count）；不修改 bytes、不把路径/ID 写日志。
2. **兼容矩阵：**明确 old/new reader、old/new writer、mixed retry、legacy flat/UTC placement、missing trace/header field、torn tail、unsupported version 的结果。新 reader 必须在新 writer 之前发布；不支持版本 fail closed 并可诊断。
3. **无损切换 protocol：**定义唯一 writer、cutover marker（若需要）、是否 dual-read、禁止 dual-write 的理由、停机/恢复、verify 和 rollback prohibition。不得把 copy+rename 当作 audit transaction。
4. **dry-run 与 stop conditions：**先在 production-shaped copy 上验证 byte preservation、row identity、ordering 和 disk headroom；任一 conflict、unreadable source、capacity 不足或 profile 不支持都停止，不自动 repair。
5. **受控 rollout 与 downgrade：**明确 feature flag/版本 gate、canary、成功/失败 telemetry、旧版本遇到新布局时的安全失败，以及已发布新格式不能以 silent rewrite 回退。

任何 physical recovery、archive restore 或 byte-level repair 仍需独立 lifecycle/security approval；本节不提供该授权。

## 8. 分阶段任务与依赖

每阶段都应是独立 issue/PR；未完成前一阶段不得把后续阶段合入为“顺手修复”。

| 阶段 | 交付物 | 前置依赖 | 明确不做 |
| --- | --- | --- | --- |
| P9-0：冻结事实 | 本设计经 owner/security/operations review；把当前 S2 和 tests-only evidence 与本文件对齐 | ADR-0004、ADR-0002、ADR-0003、ADR-0007 | 代码、schema、IPC 变更 |
| P9-1：contract tests | V1 golden fixtures、identity/trace conflict、legacy/torn-tail、exact-byte/no-rewrite、archive residual state matrix；测试只补缺口 | P9-0 批准 | generic JSONL migration、rotation/repair |
| P9-2：capability/result design | 逐 host profile 的 I/O matrix；typed main-internal result/disposition 和 privacy-safe diagnostic vocabulary；决定 single-writer 或提出 multi-process protocol | P9-1、平台/operations owner | 未批准的 UI/IPC；将 degraded 当 full durable |
| P9-3：受控实现切片 | 只实现 P9-2 获批的最小 production delta，并保留 archive order/ledger ownership；必要时增加 host-native adapters | P9-2 设计批准 | 跨文件 transaction、rollback/delete、其它 writer 迁移 |
| P9-4：operations validation | Linux/macOS/Windows（仅被声明支持者）真实 filesystem、restart/failure injection、two-process/negative tests、capacity/runbook/rollout evidence | P9-3 | 从 mock 结果宣称 power-loss |
| P9-5：可选 generic JSONL proposal | 独立 ADR/design：audit 是否真的需要 segments/rotation/repair/backup；完成 migration/reader/operator protocol | P9-4 证明 fixed-file profile；单独产品需求 | 自动把 ledger `durable-jsonl` 套到 audit |
| P9-6：close-out review | requirement-by-requirement evidence audit，更新 todo/ADR status 的批准 PR | P9-0…P9-4；P9-5 仅在其需求获批时 | 以提交数或定向 unit 绿灯替代 closure |

P9-5 是条件阶段：若产品不批准 audit rotation/repair，它应保持“不实施”，而不是为了关闭 P9 人为引入 lifecycle 风险。若本地数据待办仍把 generic JSONL/rotation/repair 作为 complete 的必要输入，则 close-out reviewer 必须明确选择“批准并完成 P9-5”或“修订该成功定义”；不能静默忽略该要求。

## 9. 精确验收标准与关闭门

只有所有适用条目都具备当前工作树、测试/运行记录或批准文档的直接证据时，才可将 P9 标记为完成：

### 9.1 数据与兼容

- [ ] fixture 覆盖 V1 header 与全部九类当前 entry，并逐字节验证 first write 的 JSONL/order；每个 row 都有确定的 `id`/`parentId`/trace 规则。
- [ ] retry 在正常、short-write、torn-tail、legacy header、legacy `metadataVersion` omission、trace-free row 下只 append 缺失 canonical row；exact retry 的完整原 bytes 不变。
- [ ] 同 ID 的 canonical-body/type/trace-state conflict 失败且原 bytes 不变；malformed/unknown row 被保留而不获得 identity。
- [ ] 任何 schema/path/version 改动都有已执行的兼容矩阵与新旧 reader/writer evidence；没有 silent backfill/rewrite。

### 9.2 持久化与失败

- [ ] 对每个声明支持的 capability profile，`mkdir`、inspection、open、stat、read、short/invalid/stalled transfer、write、file sync、file close、两级 directory open/sync/close 都有 expected result、stable diagnostic code、可能写入状态和唯一 recovery action。
- [ ] 所有未知 errno、unknown error、zero/negative/stalled transfer、non-regular target、symlink、close failure 都 fail closed；没有 raw sensitive diagnostic。
- [ ] 只有 file 和要求的 directory durability 均证明完成时才返回 full durable result；directory unsupported 明确为 profile-limited/degraded，而不是成功措辞。
- [ ] restart matrix 覆盖第 4.3 节每一个 archive 边界，验证 JSON/Markdown/audit/ledger 的实际 residual、retry 行为和禁止 rollback/delete。
- [ ] 同路径并发、不同路径不全局阻塞和 failure-after-queue 的行为有回归测试；cross-process 要么有真实两进程 exclusion/recovery evidence，要么由产品/runtime 明确拒绝且有负面测试。

### 9.3 留存、隐私与安全

- [ ] 所有自动路径均不删除、截断、压缩、rotation、repair、backup/restore audit bytes；任何例外都有独立批准的 lifecycle/security design。
- [ ] sanitizer/redaction、preview limit、trace normalization 和日志/metric schema 有测试，证明不写 raw secret、payload、path、ID/trace 或原始 filesystem error 到 diagnostics。
- [ ] 路径/leaf security claims 精确限定在实际 primitive；未把 `O_NOFOLLOW` + `lstat` 说成 strict containment/CAS/Windows reparse safety。创建 mode 与 `umask` contract 有测试。

### 9.4 平台与运行

- [ ] 每个支持 profile 记录 OS、filesystem、runtime、storage assumptions、host-native test command 和结果；未验证 profile 明确 unsupported/degraded。
- [ ] 若任何文档或产品声称 crash/power-loss durability，已有该 profile 的获批 fault model 与对应 restart/reboot/power-loss evidence；否则相关措辞被移除。
- [ ] runbook、capacity threshold、alert/metric owner、incident stop conditions、upgrade/downgrade 和 operations acceptance 已由指定 owner 演练或签署。
- [ ] 如引入 IPC/UI，已审查权限、stable states、privacy-safe messages、caller retry semantics 与 renderer integration；未引入时验证其仍不存在。

### 9.5 关闭证据

- [ ] 执行并记录当前适用的 targeted unit、integration、host-native/restart 和 operations tests；报告命令、环境、通过数、跳过项与未覆盖 profile，而不是只引用历史提交。
- [ ] 对照本文件第 1 至 9 节逐项审查，确认没有把 tests-only evidence、generic ledger behavior、`fsync` 调用或文件存在性扩大成 transaction/repair/rotation/power-loss 结论。
- [ ] close-out PR 同步更新 [本地数据待办](../local-data-todo.md)、本文件状态和（若形成已采纳架构决定）对应 ADR；若任一门未满足，P9 保持未关闭。

## 10. 当前阻塞与下一步批准输入

截至本文更新，P9 仍缺少：完整 host/filesystem capability matrix、typed public/internal degraded/unknown semantics、跨进程 writer 选择、archive crash/reconcile protocol 的 operations evidence、Windows native/power-loss evidence，以及 generic JSONL/rotation/repair 是否应成为 audit scope 的独立决定。当前实现和历史定向测试不能补足这些项。

任何下一切片在改代码前必须提交并获批以下最小输入：目标 platform/storage profile、single/multi-process writer choice、public result/retry contract、完整 failure/crash matrix、privacy/observability vocabulary、是否涉及 schema/path/IPC/lifecycle、测试层级与 operations owner。获批后只执行对应阶段；未获批项继续按本文件的禁止边界处理。
