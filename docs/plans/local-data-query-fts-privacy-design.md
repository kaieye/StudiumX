# C-1 FTS/query：隐私、授权与可重建设计门槛（仅 design discovery）

**状态：仅 design discovery；不是功能或测试实现。** C-1 的可重建 SQLite projection 已实施，但 FTS、用户可见检索和新的 query API/IPC 均未实施。本文不批准任何索引字段、查询入口或 UI，也不能将 C-1 FTS/query 标记为完成。

## 1. 当前事实与非授权结论

当前 C-1 将本地 canonical 文件的有限信息投影到可丢弃、可重建的 SQLite 数据库，并只把它作为 main-process `learning-analytics` 的可选读取 adapter：索引不可用、未完成、损坏或 source manifest 不再匹配时，既有 consumer 必须回退到 canonical 文件 reader。当前 projection 的 schema migration、source fingerprint/currentness 检查和损坏隔离服务于这一可再建边界，而不是建立新的事实来源。

因此，SQLite **不能**：

- 替代 canonical JSON、JSONL 或 Markdown，或替代既有详情读取；
- 作为 scope、workspace、Memory 可见性或任何授权裁决的依据；
- 将 stale、partial、drift 或 corrupt projection 伪装成完整查询结果；
- 因为计划 FTS/query 而修改 canonical 文件格式、字段、位置或写入时序。

现有 C-1 projection 为 rebuild/currentness 保存 locator/provenance 一类内部信息；这不授权将其变为可搜索语料、用户可见结果或 renderer 输入。当前 renderer 中已有局部列表筛选和资源页的 client-side 文本匹配，它们不是 C-1 FTS，也不构成跨 canonical data 的用户检索 contract。Settings 中的 Memory scope 筛选同样不是全文检索。

**source drift / corrupt index 的结论：** 任何未来查询只能在 projection 已验证为 current/complete 时作为优化读取；索引损坏、不可打开、重建中、source drift、当前性验证失败或 canonical resolution 失败时，必须按已批准的 query semantics 回退 canonical scan，或明确返回不可用/不完整状态，绝不可把索引缺失解释为没有结果。

## 2. 范围、非目标与敏感数据冻结

本 design gate 仅讨论未来是否以及如何提出独立实现切片。它不新增代码、数据库 migration、IPC channel、preload API、renderer route、后台任务或启动时索引行为。

在获得单独批准前，以下 artifact 都仍按现有 canonical/派生边界处理：

| Artifact 分类 | 当前边界 | 本设计的限制 |
|---|---|---|
| 会话 canonical JSON 与 Markdown | canonical detail/history source | 不可由 FTS 取代，不得为搜索而改写或添加全文副本。 |
| Memory canonical records（含 legacy tolerant read） | catalog/CRUD 事实来源 | 不可由 SQLite 决定可见性、详情或授权；不得以搜索为由改变 legacy tolerance。 |
| learning-work 等 canonical JSONL/segments | ledger 事实来源 | 不可用摘要或 SQLite 代替读取；不得以索引为由截断、删除或重写。 |
| SQLite projection、summary projection、analytics aggregates | 可重建派生数据 | 可隔离、删除和重建；不能反向成为 canonical，也不能授权 retention/redaction。 |
| audit/ledger/provenance | 受既有语义约束的记录 | 不得被扩展为记录查询原文、结果详情或敏感 locator 的检索日志。 |

未来 FTS/query 语料和 query-facing projection **不得**索引或 tokenise 下列数据：prompt、会话 turn content、tool payload、secret、provider/request identifier、file path、raw Memory content，以及能够还原这些数据的派生文本。不得向 UI/API 返回 snippet、highlight、relevance score、path、canonical identifier、content 或 checksum/hash。不得仅为了 FTS 修改 canonical schema 或文件布局。

若未来需要有限字段，候选仅能是经产品批准的、bounded 的非内容 metadata（例如固定 scope enum、生命周期状态或时间 bucket）。任意自由文本 tag 都必须先经过独立的敏感性/分类政策审查；未被列入受控 taxonomy 的 tag 视为潜在内容，不能进入 query corpus。即使字段获准，也必须由 main process 使用可信上下文做 scope/authorization 决定、从 canonical source 再验证可用性，并能完全由 canonical source 重建；UI/API 不得接收 raw source text、locator、identifier 或 hash。

## 3. 备选方案矩阵（全部未获批准）

| 方案 | 可提供的价值 | 主要隐私/一致性风险与前置条件 | 当前决定 |
|---|---|---|---|
| 保持现状：不做 FTS | 保留已实施 analytics projection 与 canonical reader fallback，零新增检索面。 | 不能满足尚未被证实的用户检索需求，但没有新增内容索引或暴露面。 | **推荐的当前默认**；已实施状态保持不变。 |
| metadata/tags filter only | 若真实需求仅是按受控分类、scope 或时间范围缩小列表，可提供最小只读预览。 | 必须先批准 metadata taxonomy、scope semantics、结果隐私形状与 canonical revalidation；free-form tags 不可默认索引。 | 可作为获批后的最小候选，尚未批准或实现。 |
| conversation full-text FTS | 可能支持在历史会话中找回文字。 | 会话 turn、prompt、标题及工具相关文本可能敏感；需要明确的内容授权、redaction、tokenizer、删除和结果泄露模型。现阶段不满足。 | 不批准。 |
| Memory FTS | 可能支持按记忆文字发现条目。 | raw Memory content、legacy layouts、scope 与可见性使内容索引和结果泄露风险更高；SQLite 不能作可见性裁决。 | 不批准。 |
| 跨域统一检索 | 可能把会话、Memory、ledger 等汇集为单一体验。 | 跨 domain 的 permission、retention、freshness 和关联泄露风险最大，且会放大 identifier/path/content exposure。 | 不批准；不能由本 C-1 slice 推导。 |

推荐不是对 metadata filter 的自动授权：在真实检索需求、最小数据集和可接受的隐私模型尚未确认前，应维持 no-FTS。任何替代方案都必须作为新的、窄范围提案重新获批。

## 4. 实施前必须关闭的决策门槛

### 4.1 Query semantics、permission/scope 与 canonical resolution

1. 明确定义用户任务、允许的 filter/operator、空结果、不可用、partial/stale 的可区分语义，以及固定的最大结果/聚合粒度；不得把 “无结果” 与 “不可验证” 混为一类。
2. 定义可信 scope 来源。renderer 不得提交 root path、canonical identifier 或任意 locator；main process 必须依据已授权的活跃上下文重新计算可查询 scope。索引 row 的 scope 只可用于候选缩小，不能作为最终授权结论。
3. 定义 result-to-canonical resolution：任何未来可打开的详情必须在 main process 重新读取/验证 canonical source、tombstone 与当前 scope 后才允许继续。未通过验证的候选不可展示为可访问，也不得把 raw identifier 回传 renderer。最小 preview 不应包含详情 resolution。
4. 明确跨 workspace、temporary conversation、legacy Memory、deleted/disabled state 的语义，避免不同 domain 的同名 metadata 被错误关联。

### 4.2 Freshness、stale/rebuild 与 tombstone/deletion

1. 定义 source manifest/currentness 的检查位置、索引状态向调用方呈现的非敏感状态，以及 rebuild 时的行为。query 不得触发 canonical rewrite、retention、migration 或无界后台重建。
2. 对 source drift、索引损坏、migration conflict、SQLite native binding 不可用、并发写入、磁盘满和应用崩溃，定义可审计的 fallback / unavailable 行为。优先 canonical scan 或明确拒绝；绝不以过期 row 作肯定授权。
3. 定义 tombstone、delete、redaction、retention 和 legacy tolerant read 的投影失效规则。canonical 删除/禁用/脱敏的有效状态必须先于查询结果；投影不能延长已撤回内容的 discoverability。
4. 明确 rebuild 的幂等性及 source-to-projection parity 范围。允许丢弃 projection 并从 canonical 重建，但不得将 SQLite 当作恢复丢失 canonical artifact 的来源。

### 4.3 隐私、redaction/retention 与 query logging/audit

1. 批准前先完成字段级 data classification；禁止项见第 2 节。任何看似 metadata 的自由文本都先按敏感数据处理，不得因 tokenizer/embedding/normalization 而降级为低风险。
2. 定义 redaction 与 retention 对索引的优先级、传播时限和失败语义。不能用 summary、SQLite 或 audit 复制品规避 canonical 的删除/脱敏政策；本设计也不授权任何物理删除。
3. 查询日志默认不记录 query string、raw identifier、path、content、snippet、score、hash、payload 或结果列表。如运维确需审计，只能在单独批准后记录最小 aggregate：事件类别、时间、粗粒度 outcome/status、受限计数 bucket 与软件状态；不得记录能重建用户查询或数据位置的信息。
4. 定义诊断、错误信息与 telemetry 的脱敏要求；索引错误不能把 canonical path、原文或秘密带到 renderer 或常规日志。

### 4.4 中文 tokenizer/normalization、abuse 与性能

1. 在任何全文方案前，选择并验证中文分词与 Unicode normalization 规则：简繁、全半角、大小写、标点、混合拉丁字符和版本升级必须具备确定、可重建的语义。不得为评估 tokenizer 收集真实内容 telemetry。
2. 定义 query 长度、filter 组合、分页/返回量、超时、取消、并发与资源上限，避免高代价 pattern、重复 rebuild 或 UI 卡顿。
3. 定义滥用与可推断性风险：频繁或组合查询不得成为枚举私有 scope、tombstone 或历史内容的侧信道。结果计数、错误差异与 timing 都需纳入威胁模型。
4. 所有性能评价应使用合成、非敏感 corpus；压测数据、trace 与 failure artifact 不得携带真实 prompt、Memory content、path 或 identifier。

## 5. 获批后可提出的最小 safe slice（仍未实施）

在上述门槛全部批准后，最小候选是 **metadata filter 的只读 query preview**，而不是 FTS：只处理获批的受控 enum/状态/时间 bucket，并向 UI 提供固定、非敏感 aggregate（例如 availability、freshness 状态和受限计数）。它不返回条目列表、canonical identifier、path、content、hash、snippet、highlight 或 score；也不打开详情、不创建 migration button、不改变 SQLite/canonical schema，并且不能触发自动索引、自动删除、迁移或 repair。

该候选须另立实现计划并先定义 API/UI contract；本次不新增任何 API、IPC 或代码。只有在 main process 已根据可信活动上下文授权、projection currentness 已验证、并可随时回退 canonical read 的前提下，才可评估它。

### 未来 slice 的 verification matrix

| 验证维度 | 获批实现必须证明的性质 |
|---|---|
| Canonical 不变量 | preview/query 前后 canonical JSON、JSONL、Markdown、Memory layout 与 existing legacy-tolerant read 语义不因查询而变化。 |
| Projection 可重建性 | 删除或隔离 SQLite projection 后，canonical source 不受影响；重建只产生派生数据，结果 aggregate 语义保持一致。 |
| Freshness 与 fallback | source drift、partial rebuild、corrupt/unavailable index、并发写入和 crash 均不会返回伪完整结果；按批准语义回退或显示非敏感 unavailable/stale。 |
| Scope/authorization | renderer 无法通过 path、raw identifier 或伪造 scope 扩大可见面；每次候选使用前重新验证可信 scope 与 canonical state。 |
| Privacy contract | API/UI、错误、日志和 audit 均不含 raw content、prompt、payload、secret、provider/request identifier、path、canonical identifier、hash、snippet、highlight 或 score。 |
| Tombstone/redaction/retention | 删除、禁用、脱敏或 retention policy 生效时，结果不会继续可发现；index rebuild 与失效可重复、幂等。 |
| 中文与性能/abuse | 对合成非敏感数据，normalization/tokenizer 语义可重复；长度、成本、并发、取消、结果上限和枚举防护满足批准的限制。 |

## 6. 需要产品/用户决定的问题（最多两项）

1. 是否存在经验证的用户任务，足以超过 no-FTS 的隐私与维护成本；若有，最小可接受体验是否仅为受控 metadata aggregate preview？
2. 用户是否同意将哪些**受控、非自由文本** metadata 用于本机 discoverability，以及应由何种 scope/consent UI 明示、撤回和解释？

## 7. 交接结论

**C-1 FTS/query design gate recorded。** 当前仅完成 C-1 SQLite projection 的既有最小切片和本设计门槛记录；真实 FTS、用户可见搜索、跨域检索以及新的 query API/IPC 均仍 pending、未实现。后续只有在本文件的产品、隐私、授权、恢复和验证门槛获批后，才能以新的最小切片讨论实现。
