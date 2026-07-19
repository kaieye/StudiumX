# C-2 Physical Retention：控制、恢复与审计设计门槛（仅 design discovery）

**状态：仅 design discovery；不是功能或测试实现，不能标记 C-2 retention 完成。**

本文只为未来可能发生的 canonical 数据物理 retention（删除、截断或其他不可逆回收）定义产品、安全、恢复和审计的前置门槛。它不授权任何启动时、后台、定时或用户点击后自动删除；不修改业务代码、测试、配置或现有数据格式。当前唯一结论是：在这些门槛经产品、法律/合规和安全审查批准并由独立实现切片验证前，**physical retention 未实施且不得执行**。

C-2 已实施决定见 [ADR-0002：UTC 分区、无损 JSONL 分段与摘要 projection](../adr/0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)；待批准工作统一见 [本地数据待办](../local-data-todo.md)。本文件只记录“**C-2 design gate recorded**”，不改变待办边界，也不把分区、分段或摘要投影解释为删除授权。

> 后续工作的统一入口见 [本地数据待办](../local-data-todo.md)；已实施决定见 [ADR 索引](../adr/README.md)。

## 1. 当前事实与为什么它们不授权删除

### 1.1 Canonical source 仍是事实来源

- **会话 JSON/Markdown**：新会话可按 UTC `YYYY/MM` 放置，reader 同时容忍 legacy flat 与分区布局；日期目录只是发现和组织边界，不能使旧月内容自动过期，也不能改变 JSON/Markdown 的 canonical 地位。
- **JSONL ledger**：`learning-work.jsonl`、workspace lifecycle 等 logical source 由严格识别的 sealed segments 加当前 active 文件按顺序串联构成。50 MiB 或跨 UTC 月的 rotation 是 fsync 后的无损 rename；sealed segment 仍保留原始行和顺序，仍是 canonical source，不是可清理 projection。
- **会话 audit、learning-work/其他 ledger 与相关 artifact**：它们与会话事实/工作证据的既有读取、审计或恢复语义绑定；当前没有 retention writer、删除协议或跨 artifact 一致性承诺。
- **C-2C summary projection**：对显式选择、符合条件的 archived conversation 生成可重建的、脱敏且有界的 overview；它可 stale、缺失或损坏而不影响 canonical reader。`timeCompacting`、summary 和其 provenance 不能替代原始 turns、JSON、Markdown、audit 或 ledger，更不是物理回收授权。
- **SQLite 与其他索引/projection**：可重建、可失败/回退的派生视图，不是事实来源；不得以索引或 summary 的存在、查询成功或空间估算作为删除 canonical 的依据。

因此，UTC 分区、sealed segments、摘要投影只降低发现/追加/概览成本；它们没有用户同意、法律依据、可恢复副本、跨文件完成性或不可逆删除的确认语义。

### 1.2 兼容与历史边界

legacy flat/分区会话、旧 active JSONL、sealed+active 混合 JSONL、历史 source 与 tolerant reader 均继续受支持。未来任何 retention 方案都不得把“未被新 inventory 识别”“summary 不存在”“projection stale”或“索引缺行”当作可删除理由；也不得通过扫描/repair/backfill 改写 legacy canonical bytes。

## 2. 非目标与冻结范围

在另行批准前，下列分类**一律不允许由 retention 删除、截断、压缩、重序列化或搬迁**：

| 分类 | 当前地位 | 本设计阶段的处理 |
|---|---|---|
| canonical JSONL（active 与全部严格识别 sealed segments） | 事实来源 | 不删、不截断、不 gzip、不按月清理。 |
| 会话 canonical JSON/Markdown（含 UTC 分区和 legacy 布局） | 事实来源 | 不删、不以 summary/archive 替代。 |
| per-conversation audit JSONL、learning-work/workspace lifecycle ledger、evidence/artifact | 事实/审计/恢复相关来源 | 不删、不做静默清理或跨 source rewrite。 |
| SQLite、history index、C-2C summary 等 projection | 可重建派生物 | retention 不将其当 canonical 替代，也不把“先删 projection”伪装成 retention 实现；其独立重建/隔离规则保持原状。 |

本文件不创建 retention policy setting、后台 scheduler、IPC command、删除按钮、路径输入、导出格式或 quarantine 目录；不改变 C-2A/B/C 的 reader/writer、history 和 legacy tolerant read。

## 3. 方案比较与推荐候选

| 方案 | 空间回收 | 恢复/审计特性 | 当前结论 |
|---|---:|---|---|
| 不做物理删除；仅 UTC 分区、无损 segments、summary/projection | 无 | 风险最低；事实来源不变 | **当前推荐且已生效的默认。** |
| 用户主动 archive-only | 通常无（仅新增可携带副本或标记） | 可让用户整理/导出，但 source 留在原位 | 可作为未来产品探索；必须不暗示 archive 已删除或可替代 canonical。 |
| 可恢复 quarantine / hold | 延后而非立即回收 | 可提供 restore window、明确 hold 与审计；设计复杂 | **唯一可进一步评估的物理回收候选**，但需满足第 4 节所有批准条件后才能实现。 |
| 直接 delete / truncate canonical | 有 | 恢复窗口为零或不可证明；跨 artifact 失败风险高 | **当前拒绝。** 只有满足更高法律、产品、恢复、并发和独立安全审查门槛后，才可重新提出独立 RFC。 |

推荐候选不是“开始 quarantine”：当前批准范围仍只有第一行。若以后需要回收，应先批准 read-only inventory / policy preview，再由独立 RFC 评估用户主动 archive-only 与可恢复 hold；直接 delete/truncate 不能作为首个实现切片。

## 4. 任何破坏性方案必须先获批的控制门槛

以下要求是实施前的**全部**入口条件，不是当前功能承诺。

### 4.1 Policy、同意与授权

1. policy 必须明确数据分类、适用账户/工作区范围、年龄/容量计算口径、例外、hold、默认值和版本；默认不得启用物理回收。
2. 需有用户可理解的 preview：仅展示 aggregate 分类、年龄 bucket、预计影响和 restore window；在同一确认界面明确说明 canonical、不可恢复时点及取消路径。不得以首次启动、更新安装、隐蔽 setting 或 summary 生成视为同意。
3. 需要适用的用户同意、管理员授权、法律/合规保留要求与 legal hold 决策；任何 hold、争议、未确认身份或政策冲突都必须阻止回收而非例外放行。
4. 权限模型必须由 main-process trusted identity 决定；renderer 不提供文件路径、record ID、内容、hash、payload 或“应删除列表”。

### 4.2 恢复、可发现性与安全审计

1. 若采用 hold/quarantine，必须先定义固定 restore window、何时开始计时、谁可 restore、何时永久 purge，以及恢复后 reader/index/projection 如何重新发现 source。window 内不得有后台最终删除。
2. restore 必须是显式、可观察、幂等的受控操作；找不到、损坏、冲突、legacy 混合或 source drift 时 fail closed，不能用 projection/SQLite/summarized metadata 补造 canonical。
3. 审计只记录安全的 aggregate metadata：policy version、artifact class、状态转换、时间、授权类型、结果类别、数量/容量 bucket 与错误类别。**不得记录或日志化 raw content、prompt、payload、record ID、source path、checksum/hash、对话标题或可还原 source 列表。** 如恢复实现需要内部关联，必须使用受保护的 main-only opaque handle，且该映射不得进入 renderer、普通日志或 analytics。
4. UI、诊断和 audit 必须让用户能发现 pending hold、restore deadline、policy status 与失败的 aggregate reason；不能把实际 candidate 列表或内容暴露给不具备读取权限的界面。

### 4.3 Durable order、故障与并发

1. 必须有显式 durable state machine（至少 plan → prepared → held/restorable → restored 或 purge-eligible → purged/failed），每一步的可见性、重试和终止条件均须在独立 RFC 中定义；不能依靠内存 flag 或“本次扫描已完成”。
2. 在任何 canonical 删除/截断前，必须先完成并验证可恢复状态，并以同一受控 storage boundary durable publish；跨目录/卷操作不能假定 rename 原子。file 与相关 directory durability、权限、containment/no-follow、manifest/receipt 完整性都要明确验证。
3. disk-full、fsync/rename failure、crash、进程重启、权限变化、外部文件修改、部分 artifact 缺失或读写失败时：停止在可恢复状态、报告安全 aggregate failure，并由 durable state reconciliation 决定是否可 resume；不得为“腾空间”跳过验证或直接删除 source。
4. 必须定义与 archive/save、JSONL append/rotation、projection rebuild、SQLite rebuild、restore 和并发 UI 请求的互斥/lease 策略。候选快照在执行前改变、writer 活跃、跨进程单实例假设不成立或锁丢失时必须 fail closed；重试不得重复删除、重复恢复或改变未选对象。
5. 任何最终 purge 必须有独立、可审计的第二次 explicit confirmation，并在 restore window 结束、hold 检查通过、恢复状态完整且所有前置验证成功后才可考虑；本文件不批准该步骤。

## 5. 未来可批准的最小 safe slice（仍未实现）

最小候选只能是 **read-only retention inventory + UI policy preview**：

- 仅从既有 canonical discovery/read seam 计算 aggregate artifact class、UTC age bucket、数量/容量 bucket、legacy/mixed-layout blockers 和 policy readiness；不创建任何持久化 inventory、quarantine、receipt 或 index。
- renderer 仅见 aggregate preview 和“physical retention 未启用”的状态；无 candidate 路径/ID/内容/hash、无删除/restore/purge action、无 renderer path input、无新增后台任务。
- preview 不能把 summary、SQLite、archive-only 标记或 age bucket 解释为删除 eligibility；它只暴露未来产品评审所需的非敏感容量/风险信号。

### 5.1 批准后实现的 verification matrix

| 验证面 | 需要证明的结果 |
|---|---|
| Strict read-only | inventory/preview 前后 canonical JSONL、JSON、Markdown、audit、ledger 的 bytes、mtime、目录 entries/layout 完全不变；不存在的 root/可选目录不会被创建。 |
| Source completeness | active+sealed、UTC+legacy、course/temporary/managed scope、mixed/duplicate/invalid source 都遵循既有 reader 语义；不以 projection/SQLite 决策。 |
| Privacy | IPC/UI/audit/log fixture 不含 raw content、prompt、payload、record ID、path、checksum/hash 或 source list；仅 aggregate。 |
| Failure/concurrency | 读权限、损坏 source、scanner failure、并发 writer/rotation、disk-full/crash simulation 均不产生 source 写入或删改。 |
| Product safety | preview 明示未启用，不能触发 destructive action；无 consent/authorization/hold 时绝不进入任何 destructive state。 |

只有该 read-only slice 独立批准并验证后，才能讨论 hold/quarantine 的实现；它本身也不授权下一步物理回收。

## 6. 仍需产品/用户决策（最多两项）

1. 是否存在经法律/合规确认的、用户可理解的 retention 目标（按何种 artifact class、时间或容量口径），以及默认是否永久保留？
2. 若未来允许回收，用户可接受的 restore window、hold/恢复授权主体和最终 purge 的二次确认形式是什么？

## 7. 交接结论

- **已记录：C-2 retention control/recovery design gate。**
- **未实施：任何 physical retention、quarantine、hold、archive-only 工具、删除、截断、压缩、自动启动迁移或后台任务。**
- C-2A UTC 分区、C-2B 无损 JSONL segments、C-2C summary projection 继续保持原来的 canonical/兼容边界；它们不构成 delete authorization。
