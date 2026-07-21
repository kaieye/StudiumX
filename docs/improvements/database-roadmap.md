# Database 子系统改造清单（StudiumX × Marvis × ZCode）

> 对照主体：**StudiumX**（当前仓库）  
> 对照对象：  
> - **Marvis** 本机数据：`~/Library/Application Support/com.tencent.mac.marvis/MarvisData/User/*/database/`  
> - **ZCode** 本机数据：`~/.zcode/cli/db/db.sqlite`、`~/.zcode/v2/tasks-index.sqlite`  
> - **ZCode** 解包：`ref_project/Zcode`（v3.3.3）  
> 相关 ADR：0001 / 0002 / 0006 / 0038 / 0050 / 0051（以及 usage/audit 邻近决策）  
> 分层权威活文档：[`database-authority-model.md`](./database-authority-model.md)  
> 日期：2026-07-21  
> 状态：**改造建议清单 + 已落地切片索引**（本文件本身不构成实现授权；涉及 FTS/向量/写权威迁库等边界能力须先写新 ADR）

---

## 0. 结论与原则

### 0.1 一句话定位

| 产品 | Database 角色 | 写权威 | 读路径备注 |
| --- | --- | --- | --- |
| **StudiumX** | SQLite = 可丢弃 projection（list/analytics 优选读） | 文件系统（JSON / JSONL / Markdown / Memory） | projection ready 时列表/聚合可读库；详情正文读文件 |
| **Marvis** | SQLite = 会话 + 记忆 + 向量 + 事件主存储 | 多库 SQLite（+ Tantivy） | 内容与 stream 事件均在库 |
| **ZCode** | SQLite = 会话运行时 store + 任务索引 | CLI SQLite 为主；历史 JSON 旁路 | 双轨一致性有恢复技能 |

分层细则见 [`database-authority-model.md`](./database-authority-model.md)。

### 0.2 不可退让的边界（改造前置）

1. **教学写权威在文件**（ADR-0001 修订 / 0002）：教学资产、conversation 正文、LearningSession/Evidence/Memory 的**写权威**是文件或教学 JSONL；SQLite 不得成为其唯一/主写权威。
2. **Projection 可为优选读路径**：list metadata / analytics 在 complete+current 时优先 SQLite；drift/损坏必须 unavailable + 文件回退；库可删可重建。
3. **no-FTS 产品面默认关闭**（ADR-0001）：不得把 **analytics 同一库** 扩成用户可见全文搜索语料；独立检索索引须新 ADR（DB-P2-2）。
4. **canonical 永久保留**（ADR-0002）：不得借“索引优化”引入 age/size 物理删除 teaching canonical 数据。
5. **记忆破坏性迁移仍未批准**（ADR-0006 / 0038）：只允许 readonly dry-run / preflight。
6. **教学定位优先**：不把产品拉向通用 coding agent 平台；ZCode MCP/SSH/远程、Marvis 云同步不在本清单。

### 0.3 优先级定义

| 级 | 含义 | 是否需要新 ADR |
| --- | --- | --- |
| **P0** | 可直接在现有 ADR 内合入；提升可靠性/可支持性/观测性 | 通常否（可补小范围 ADR 记录） |
| **P1** | 值得立项；范围清晰，需设计评审与测试矩阵 | 建议写窄 ADR 或扩展既有 ADR |
| **P2** | 有价值但触及边界/产品面；默认不排期 | **必须**新 ADR + 重新开启条件 |

---

## 1. 证据摘要（本机 + 源码）

### 1.1 StudiumX

- 实现：`src/main/local-data-index/index.ts`、`schema-migration.ts`
- 依赖：`better-sqlite3`（懒加载）
- 文件：`studiumx-index.sqlite`（projection）
- 能力：rebuildable projection、checksumed migration、source fingerprint、query-time currentness、损坏 quarantine
- 记忆：文件 catalog + 进程内词法检索（ADR-0050），**非** SQLite FTS

### 1.2 Marvis（登录用户实库）

```
User/{uid}/database/
├── data.db           # conversations / messages / agui_events / approvals / llm_token_usage / checkpoints
├── memory.db         # conversation_detail / user_profile / kv_store
├── memory_vector.db  # sqlite-vec vec0 float[512] × episodic/experience/semantic
└── tantivy_index/    # 三类记忆全文索引
```

规模样例：~3 会话 / 184 messages / **17746 agui_events** / 95 token rows / 6 experience_memory。

### 1.3 ZCode

```
~/.zcode/cli/db/db.sqlite      # 18 tables, 13 migrations (session/message/part/usage/workflow...)
~/.zcode/v2/tasks-index.sqlite # tasks + groups + partial indexes (pinned/archived/deleted)
```

亮点：checksum + app_version migration；model/tool/turn usage 一等公民；workflow run/activity/event/task_link；fs fault injection 含 `sqliteOpen`/`sqliteRun`。

---

## 2. 改造清单总表

| ID | 项 | 优先级 | 主要借鉴 | 触及边界 |
| --- | --- | --- | --- | --- |
| DB-P0-1 | Projection migration 元数据增强 | P0 | ZCode | 无 |
| DB-P0-2 | Doctor / support-bundle 暴露 index 状态 | P0 | ZCode 可支持性 | 无 |
| DB-P0-3 | Usage/observability projection（可选 adapter） | P0 | ZCode usage 表 | 无（只投影） |
| DB-P0-4 | 审批 / 人批 durable receipt 文件化 | P0 | Marvis approvals | 无 |
| DB-P0-5 | LocalDataIndex 故障注入与边界测试补齐 | P0 | ZCode fs fault | 无 |
| DB-P0-6 | Session/resume 列表索引友好字段 | P0 | ZCode tasks-index | 无 |
| DB-P1-1 | Token/tool/turn usage 细粒度 ledger | P1 | ZCode | 建议窄 ADR |
| DB-P1-2 | Memory 分层概念落到 catalog 元数据 | P1 | Marvis 三层记忆 | 建议窄 ADR |
| DB-P1-3 | 教学 event 密度策略与 segment 预算 | P1 | Marvis events 反例 | 建议扩展 0002 |
| DB-P1-4 | 多 workspace projection 查询性能 | P1 | 自研 | 否 |
| DB-P1-5 | Backup/export 清单含 projection 可丢声明 | P1 | 自研+两边运维 | 否 |
| DB-P2-1 | 可选向量记忆 projection | P2 | Marvis sqlite-vec | **必须新 ADR** |
| DB-P2-2 | 可选 Tantivy/FTS 记忆索引 | P2 | Marvis Tantivy | **必须新 ADR；冲突 0001** |
| DB-P2-3 | 会话/教学**写权威**迁入 SQLite | P2 | Marvis/ZCode | **拒绝写权威迁库**；runtime store 另见 authority model |
| DB-P2-4 | Workflow run 树入库 | P2 | ZCode workflow | 信号触发；教学编排未证明 |

---

## 3. P0 — 可直接推进

### DB-P0-1：Projection migration 元数据增强

**现状**  
`schema_migration(id, checksum, applied_at)` 已有 checksum 不可变语义。

**借鉴**  
ZCode：`schema_migration(id, checksum, app_version, time_applied)`。

**改造**

1. 扩展 migration 记录字段（向后兼容）：
   - `app_version TEXT`
   - `applied_by TEXT`（如 `local-data-index`）
   - 可选 `sql_bytes INTEGER`
2. 保持“历史 migration SQL 不可改；冲突硬失败”语义。
3. Doctor 输出已应用 migration 列表与 checksum 摘要（无 SQL 正文）。

**验收**

- unit：旧库打开后补齐新列；checksum mismatch 仍抛 `SchemaMigrationChecksumConflict`
- 不改 projection 表业务列语义

**非目标**

- 不引入自动 destructive repair 以外的“修复向导”UI

---

### DB-P0-2：Doctor / support-bundle 暴露 index 状态

**现状**  
`LocalDataIndex.status` = `ready | building | incomplete | unavailable | closed`，issues 可查，但可支持面未系统化。

**借鉴**  
ZCode process monitor / export logs；StudiumX 既有 doctor / redacted support-bundle ADR。

**改造**

1. Doctor 增加只读段：
   - index path 存在性（**不**默认打印绝对路径到用户可见 UI 时可红acted）
   - status / reason
   - migration ids
   - last `rebuilt_at` / `complete` flag
   - issue counts by code（`source_drift` / `read_failed` / …）
2. Support-bundle：附带 **aggregate-only** index diagnostics；禁止打包完整 conversation/memory 正文 projection 行。
3. 明确文案：`studiumx-index.sqlite` 可安全删除并由 rebuild 恢复。

**验收**

- doctor 在 unavailable / incomplete / ready 三态有稳定输出
- support-bundle 红action 检查通过

---

### DB-P0-3：Usage / observability 可选 projection

**现状**  
教学侧有 learning analytics / token-evidence 路径；缺少 ZCode 级 model/tool/turn 细表。

**借鉴**  
ZCode `model_usage` / `tool_usage` / `turn_usage` 字段粒度（TTFT、retry、cache、side_effect、truncated…）。

**改造（克制版）**

1. **不**把 usage 当真相源；优先：
   - 已有 JSONL/ledger 为 canonical（若已写）
   - 或新建 **append-only JSONL usage ledger** + 可选 SQLite projection
2. 最小字段集（首期）：
   - provider/model、status、started/completed、duration_ms
   - input/output/reasoning/cache tokens
   - tool_name、read_only/destructive、approval_status、truncated
   - trace_id / turn_id / conversation_id（opaque）
3. analytics adapter 只读；renderer 仅聚合面板，不暴露 raw payload。

**验收**

- projection 损坏不影响 turn 成功路径
- 无 secret / prompt 正文进入 usage 表

**非目标**

- 不做云同步 billing；不做 ZCode 全量 error taxonomy 一次搬空

---

### DB-P0-4：人批 / 审批 durable receipt 文件化

**现状**  
工具人批在运行时门控（effect policy / registry）；Marvis 有 `approvals` 表持久化。

**借鉴**  
Marvis approvals 字段：tool_call_id、tool_name、status、reason、decided_at、metadata。

**改造**

1. 对 **高风险** 与 **合成记忆 remember/forget** 等强制人批动作，写 **append-only receipt 文件**（建议 workspace 或 app-data 下 JSONL）。
2. 字段：decision、tool、effect、trace_id、timestamp、redacted args digest（**非**完整敏感 args）。
3. 可选：LocalDataIndex 增加 `approval_projection`（可重建）；默认可不做。

**验收**

- 与 ADR-0048 write policy / audit correlation 一致
- receipt 永不成为授权令牌复用（一次一用语义）

---

### DB-P0-5：LocalDataIndex 故障注入与边界测试补齐

**现状**  
已有 testHooks（currentness / precommit / final ready / adapter query）。

**借鉴**  
ZCode fs fault injector：`sqliteOpen` / `sqliteRun` 等可注入。

**改造**

1. 扩展 hooks 或 env-only test injector：
   - open 失败、integrity 失败、migration checksum conflict
   - rebuild 中途 source drift（已有方向）
   - WAL/lock busy 超时
2. 矩阵写入 `tests/unit/local-data-index*.test.ts` / integration analytics。
3. CI 保持 native 缺失时的 fallback 路径覆盖。

**验收**

- 损坏 projection 被 quarantine，canonical 文件字节不变
- adapter 在 drift 后返回 unavailable 并触发 rebuild 调度

---

### DB-P0-6：Session / resume 列表索引友好字段

**现状**  
会话列表多来自文件系统扫描；ADR-0030 session resume picker 已有产品面。

**借鉴**  
ZCode `tasks`：`pinned` / `archived` / `deleted` + partial index + `searchable_text`（应用层）。

**改造**

1. 在 **conversation summary projection**（文件侧或 SQLite projection 侧）保证列表字段稳定：
   - updated_at、pinned/archived（若产品已有）、message_count、title（已 redaction）
2. SQLite `conversation_projection` 补列表查询索引（若缺失）：
   - `(scope, updated_at DESC)` 或 `(workspace_id, updated_at DESC)`
3. **不做** FTS；列表过滤继续 metadata-first。

**验收**

- resume picker 在 incomplete index 时回退文件扫描
- 无 snippet/highlight 产品面

---

## 4. P1 — 建议立项

### DB-P1-1：Token / tool / turn usage 细粒度 ledger

**动机**  
教学诊断、成本感知、失败分类需要比当前 analytics 更细的 turn 级数据。

**方案**

1. **设计权威已落地：** [ADR-0051](../adr/0051-usage-ledger-as-canonical-observability.md)（`usage-ledger-as-canonical-observability`）
2. Canonical：append-only JSONL（UTC 分区 / sealed segment 复用 ADR-0002 / `durable-jsonl`）
3. Projection：SQLite 可选表，字段对齐 ZCode 子集；损坏不挡 turn 成功路径
4. 与 learning-session ledger **正交**（usage ≠ learning outcome）
5. Retention 默认：诊断级，跟随 logger 政策（**非** teaching permanent；见 ADR-0051 §5）
6. Redaction：allowlisted 标量 + opaque correlation；renderer 仅聚合面板
7. 与 **DB-P0-3** 分工：P0-3 = 最小 writer/projection 实现；P1-1 = 本 ADR 设计 gate（不争抢实现文件）

**开放问题（已关闭于 ADR-0051）**

- ~~retention~~ → 诊断级 mtime purge，默认跟随 `settings.log.retentionDays`
- ~~renderer 展示粒度与 redaction~~ → 聚合 only；无 raw payload

---

### DB-P1-2：Memory 分层元数据（概念借鉴 Marvis，实现不换真相源）

**动机**  
Marvis 的 episodic / experience / semantic 分层对“教学经验 / 学习者事实 / 会话情节”有表达力。

**方案**

1. 在 **TeachingMemoryRecord** 增加可选 `memoryKind` 或稳定 tags 约定：
   - `learner-profile` / `teaching-experience` / `episodic-session` / `teaching-synthetic`（已有）
2. catalog 与词法检索可按 kind 过滤
3. `memory_projection` 增加 `kind` / `status` 列便于 analytics（仍 **不存 content** 若政策要求）
4. consolidate/purge **不做自动静默**；任何合并策略需人批 + 新 ADR

**非目标**

- 不引入 sqlite-vec / Tantivy
- 不把 experience 自动从会话全量抽取进记忆（防隐私与膨胀）

---


> **DB-P1-3-5 合批交付（本 worktree）**：策略模块 `src/shared/event-density-policy.ts` / `src/shared/backup-export-policy.ts`；learning-work / session ledger guards；export 默认排除 projection。政策已沉淀：[ADR-0002](../adr/0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)（event density）、[ADR-0001](../adr/0001-rebuildable-sqlite-projection.md)（rebuild 默认 + backup/export）。**生产默认**仍为全量 DELETE+INSERT rebuild；**DB-OPT-2** 仅有 `planIncrementalRebuild` + test-hook 会话增量骨架（失败→全量；非多表生产默认；L fixture 门槛见 ADR-0001）。
### DB-P1-3：教学事件密度策略（从 Marvis 反例学习）

**动机**  
Marvis 3 会话 1.7 万 events → 体积与锁竞争风险。

**方案**

1. 审计现有 JSONL event 种类：哪些必须 durable，哪些仅 debug
2. 分层：
   - **canonical teaching events**（影响 outcome / evidence）
   - **operational debug events**（可进 diagnostic logs，可 mtime purge）
3. 文档化每类 event 的 max rate / payload budget
4. 禁止“为了回放方便把 token stream 全量落库”

**验收**

- 明确清单 + 测试防止 debug 事件写进 learning-work canonical ledger

---

### DB-P1-4：多 workspace projection 查询性能

**方案**

1. 测量 rebuild 时间与 adapter 查询（fixture 多 workspace）
2. 评估：
   - 增量 rebuild（按 source_key fingerprint）vs 全量 DELETE+INSERT
   - 连接 busy_timeout / 单写者队列
3. 保持 disposable 语义：增量失败可降级全量 rebuild

---

### DB-P1-5：Backup / export 文档与清单

**方案**

1. 在 `docs/GUIDE*.md` / doctor 输出中明确：
   - **必须备份**：workspace 文件、Memory 文件、settings（脱敏说明）
   - **可丢弃**：`studiumx-index.sqlite*`、cache、quarantined projections
2. export 工具默认排除 projection；可选 include 仅用于调试且标记 untrusted

---

## 5. P2 — 默认不排期 / 需新 ADR

> **活文档：** 触发条件、won't-do、PR 拒绝信号见 [`database-p2-boundaries.md`](./database-p2-boundaries.md)。  
> 本节省略为摘要；政策变更以活文档为准并回写本节。


### DB-P2-1：可选向量记忆 projection

**借鉴**  
Marvis `memory_vector.db` + `vec0(embedding float[512])`。

**若开启，硬条件**

1. 新 ADR：向量只是 projection；删除/授权仍看文件 catalog
2. embedding 不进入 system prefix；仅 tool 检索路径
3. 模型/维度/迁移策略写死；扩展模块缺失时 **安全降级** 到词法检索
4. 隐私审查：哪些 memoryKind 可嵌入；默认排除 secret-bearing
5. 与 ADR-0050 词法检索并存时的 ranking 契约

**默认建议**  
教学场景优先把词法检索与 synthetic memory 做稳；向量等用户任务证明后再开。

---

### DB-P2-2：可选 FTS / Tantivy 记忆索引

**直接冲突**  
ADR-0001 no-FTS 产品面。

**重新开启条件（摘自 0001 精神）**

1. 经验证的用户任务（非“有了更好”）
2. metadata-first 审查先于 content index
3. 独立 ADR 明确：语料范围、红action、snippet 政策、audit 禁止项
4. **禁止** 用 analytics 同一库直接变搜索引擎；应独立 disposable index 文件

---

### DB-P2-3：会话/教学 **写权威** 迁入 SQLite — **拒绝项（写权威）**

**拒绝**：conversation 正文 / LearningSession / Evidence / Memory 的唯一或主写权威迁入 SQLite（含「库为主、文件为导出」）。

**不拒绝**：projection 优选读路径；usage/approval JSONL；**可选 runtime session store 设计**（须独立新 ADR，见 authority model §3.2 / DB-OPT-6）。

**写权威迁库**仅当产品顶层重定位（放弃文件教学写权威）后另起顶层 ADR。细节闸：[`database-p2-boundaries.md`](./database-p2-boundaries.md) §4。

---

### DB-P2-4：Workflow run 树入库

**借鉴**  
ZCode `workflow_run` / `activity` / `event` / `session_task_link`。

**触发信号**

- 教学出现稳定的多 agent / 多阶段 mission orchestration 产品需求
- 现有 teaching-turn / session protocol 无法表达预算与子会话树

**若做**

- 仍建议 JSONL canonical + SQLite projection
- 状态机 CHECK 约束可借鉴 ZCode
- 不默认开放 script workflow 用户脚本面

---

## 6. 明确不借清单（won't borrow）

| 项 | 来源 | 原因 |
| --- | --- | --- |
| SQLite 作为会话/教学**写权威**（唯一或主真相） | Marvis/ZCode | 违背可迁移文件工作区；runtime cache 另案 |
| 全量 AG-UI / token stream 落库 | Marvis | 事件膨胀、隐私、IO |
| AK/SK 明文表 | Marvis `aksks` | 安全模型不可接受 |
| 把 analytics 库改 FTS 语料 | — | ADR-0001 |
| 默认 Mem0 类云记忆 | 生态 | 本地教学 / 隐私 |
| MCP 市场与远程控制状态库 | ZCode | 产品非目标 |
| 基于 age/size 删 canonical | 任何“运维便利” | ADR-0002 |

---


---

## 6.5 优化 backlog（DB-OPT，基于分层权威修订）

> 完整说明见 [`database-authority-model.md`](./database-authority-model.md) §4。  
> 下列项供**下一阶段项目优化**直接引用；实现 PR 仍须过验收闸。

| ID | 项 | 优先级 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| **DB-OPT-1** | 去掉/降级 projection `absolute_path` | P0 | **Done**（2026-07-21） | 新 rebuild 写空 `absolute_path`；hydrate 用 relative；migration 清空旧绝对路径；Gate 3 |
| **DB-OPT-2** | per-source 增量 rebuild 骨架 | P1 | **Done（骨架）**（2026-07-21） | [ADR-0001](../adr/0001-rebuildable-sqlite-projection.md)：`planIncrementalRebuild` + test-hook 会话增量；**默认仍全量**；失败降级全量；非多表生产默认 |
| **DB-OPT-3** | usage 字段向 ZCode 再靠一档 | P1 | **Done**（2026-07-21） | `ttftMs` / `retryCount` / `truncated` / `errorType`；JSONL 写权威；无 secret |
| **DB-OPT-4** | doctor 暴露 usage segment/invalid 计数 | P0 | **Done**（2026-07-21） | `LocalDataIndex.diagnostics().usage` + doctor evidence；无路径/行原文 |
| **DB-OPT-5** | projection status/kind DB CHECK | P1 | **Done**（2026-07-21） | conversation scope / usage kind·status / memory status CHECK |
| **DB-OPT-6** | runtime session store **设计 ADR** | P2 设计 | **Design-complete / unimplemented** | [ADR-0052](../adr/0052-runtime-session-store.md) Proposed；**无生产 schema/writer** |
| **DB-OPT-7** | 词法失败用例 → FTS/向量审查 | 信号 | **Evidence-only** | [ADR-0050](../adr/0050-lexical-memory-search-and-synthetic-memory.md) 证据表；暂无触发信号 |

**建议优化顺序（执行时）**

```text
OPT Wave A（正确性/隐私）
  DB-OPT-1 absolute_path
  DB-OPT-4 doctor usage diagnostics

OPT Wave B（观测与约束）
  DB-OPT-3 usage fields
  DB-OPT-5 CHECK constraints

OPT Wave C（性能与设计）
  DB-OPT-2 incremental rebuild skeleton
  DB-OPT-6 runtime store design ADR（仅文档）
  DB-OPT-7 证据收集
```

## 7. 建议实施顺序（当进入执行）

```text
Wave 0（文档/护栏）
  DB-P2-docs P2 边界 + §8 验收活清单（已文档化）
  DB-P0-2 doctor/support-bundle
  DB-P0-5 故障注入测试
  DB-P1-5 backup 说明

Wave 1（观测与审计）
  DB-P0-1 migration 元数据
  DB-P0-3 usage projection 最小集
  DB-P0-4 人批 receipt
  → DB-P1-1 完整 usage ledger ADR-0051（设计 gate 已完成）

Wave 2（列表与记忆元数据）
  DB-P0-6 resume/list 索引
  DB-P1-2 memory kind 元数据
  DB-P1-3 event 密度策略
  DB-P1-4 多 workspace 性能（默认全量；OPT-2 骨架已有，生产增量须 L 证据）

Wave 3（信号触发）
  DB-P2-1 / P2-2 / P2-4 仅在新 ADR + 用户任务证明后
```

---

## 8. 验收总闸（任何 DB 相关 PR）

> **活清单（权威勾选版）：** [`database-acceptance-gates.md`](./database-acceptance-gates.md)  
> **P2 边界闸：** [`database-p2-boundaries.md`](./database-p2-boundaries.md)  
> 贡献者入口：根目录 `CONTRIBUTING.md`「Database PR gates」。

合并前必须全部为真（摘要；证据写法见活清单）：

1. **Canonical 不变性**：测试证明 projection quarantine/rebuild 不修改 JSON/JSONL/Memory 源文件字节（除明确授权的业务写入）。
2. **Drift 安全**：source 变更后 adapter 不得静默返回 stale ready 数据。
3. **无秘密进索引**：usage/projection/receipt 无 API key、无 raw prompt 默认落库。
4. **失败可降级**：native sqlite 不可用时产品主路径仍可用（文件扫描 / 跳过 analytics）。
5. **政策对齐**：不引入 analytics 库 FTS 产品面、不引入 canonical 物理删除、不绕过工具 effect lattice；不把 SQLite 当教学/会话**写权威**；不实现未授权的 DB-P2-1…4；分层权威见 database-authority-model.md。
6. **测试**：unit + 必要 integration；迁移 checksum 冲突覆盖。

与活清单冲突时以活清单为准，并在同一变更中回写本摘要。

---

## 9. 参考路径

### StudiumX

- `src/main/local-data-index/index.ts`
- `src/main/local-data-index/schema-migration.ts`
- `src/main/teaching-memory.ts`
- `src/main/ai/teaching-lexical-search.ts`
- `docs/adr/0001-rebuildable-sqlite-projection.md`（含 rebuild 默认/OPT-2 骨架 + backup/export）
- `docs/adr/0002-utc-partitioned-segmented-jsonl-and-summary-projections.md`（含 event density）
- `docs/adr/0050-lexical-memory-search-and-synthetic-memory.md`（含 OPT-7 证据表）
- `docs/adr/0051-usage-ledger-as-canonical-observability.md`
- `docs/adr/0052-runtime-session-store.md`（OPT-6 设计 only）
- `docs/improvements/database-authority-model.md`（分层权威 + DB-OPT）
- `docs/improvements/database-p2-boundaries.md`（P2 触发/won't-do 活文档）
- `docs/improvements/database-acceptance-gates.md`（§8 验收活清单）
- `tests/unit/database-pr-gates.unit.test.ts`（文档闸契约测试）
- ZCode 对照笔记曾位于 `docs/improvements/Zcode.md`（2026-07-21 删除；证据摘要见本文件 §1.3 / §9）

### Marvis（本机）

- `~/Library/Application Support/com.tencent.mac.marvis/MarvisData/User/<uid>/database/data.db`
- `.../memory.db`
- `.../memory_vector.db`
- `.../tantivy_index/{episodic,experience,semantic}_memory/`

### ZCode（本机 + 解包）

- `~/.zcode/cli/db/db.sqlite`
- `~/.zcode/v2/tasks-index.sqlite`
- `ref_project/Zcode/Contents/Resources/glm/zcode.cjs`（session migrations / store）
- `ref_project/Zcode/Contents/Resources/app/out/host/index.js`（tasks-index 路径等）

---

## 10. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-21 | 初版：基于三方 database 实库/schema/源码对照产出 P0/P1/P2 改造清单 |
| 2026-07-21 | DB-P2-docs：落地 P2 边界活文档 + §8 验收活清单；§5/§8/§9 增加交叉链接；无 forbidden 实现 |
| 2026-07-21 | 修订：分层权威模型；DB-P2-3 拆写权威 vs runtime store；新增 DB-OPT-1…7 优化 backlog |
| 2026-07-21 | DB-OPT-1…7 闭环：absolute_path、doctor usage、usage 字段、CHECK、增量骨架、ADR-0052、词法证据文档 |
| 2026-07-21 | improvements 收敛：已落实政策沉淀进 ADR-0001/0002/0034/0050；删除 event-density / backup-export / multi-workspace-perf / lexical-evidence / Zcode 草稿 |
| 2026-07-21 | §6.5 OPT-2 证据链补 [ADR-0001](../adr/0001-rebuildable-sqlite-projection.md)；确认 OPT-6 Design-complete/unimplemented→0052、OPT-7 Evidence-only→0050、§8→acceptance-gates；无删除文档活跃链接 |
