# Database 分层权威模型（活文档）

> 权威入口：本文件定义 **写路径 / 读路径 / 可丢弃性** 的分层，供优化 backlog 与 PR 审查引用。  
> 相关：[`database-roadmap.md`](./database-roadmap.md)、[`database-p2-boundaries.md`](./database-p2-boundaries.md)、[`database-acceptance-gates.md`](./database-acceptance-gates.md)、[ADR-0001](../adr/0001-rebuildable-sqlite-projection.md)、[ADR-0002](../adr/0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)、[ADR-0050](../adr/0050-lexical-memory-search-and-synthetic-memory.md)、[ADR-0051](../adr/0051-usage-ledger-as-canonical-observability.md)、[ADR-0052](../adr/0052-runtime-session-store.md)（DB-OPT-6 设计 only）  
> 日期：2026-07-21  
> 状态：**政策权威**（修订 ADR-0001 过度绝对的措辞；**不**单独授权实现）

---

## 0. 为什么要分层

早期叙述容易把两件事绑死：

1. **教学工作区可迁移**（Mission / Lesson / Learning record 是文件）——这是产品成功标准（`MISSION.md`）。
2. **SQLite 几乎不配做任何读/写权威**——这是过度推广。

Marvis 实库显示：SQLite 全能主存产品爽，但事件膨胀与隐私面会爆。  
ZCode 显示：schema 纪律与 usage 极强，但会话 SoT + 历史 JSON 双轨有一致性税。  
StudiumX 实现**已经**让 projection 成为 list / analytics 的**优选读路径**（文件是 fallback 与 content 权威）。文档必须诚实对齐实现，而不是用 ADR 编号当盾牌。

---

## 1. 分层表（写权威 vs 读偏好）

| 数据类 | 写权威（Source of Truth） | 优选读路径 | 可丢弃？ | 备注 |
| --- | --- | --- | --- | --- |
| Mission / Lesson HTML / Resource / Reference | 工作区文件 | 文件 | **否**（canonical） | 教学资产；git / 打包 / 迁移 |
| LearningSession ledger / Evidence / Outcome marker | JSONL / 文件 ledger | 文件（projection 仅摘要） | **否** | 结算权威；SQLite **永不**替代 |
| Memory catalog records | Memory 文件 | 文件 catalog；词法检索进程内 | **否**（文件） | projection **不存 content** |
| Agent conversation **正文** transcript | 会话 JSON / Markdown 文件 | **文件**（详情 content） | **否** | 可审计、可 redaction 写入 |
| Conversation **列表** metadata（title/updated/pinned/archived/count） | 文件（写入时） | **SQLite projection 优先**；incomplete → 文件扫描 | 投影 **是** | 见 `listConversations` |
| Learning-work / usage / approval receipts | Append-only JSONL | JSONL 扫描或 projection 聚合 | usage/receipt 诊断级可 purge；learning-work 见 ADR-0002 | usage 正交教学 outcome（ADR-0051） |
| Analytics aggregates / doctor index diagnostics | 派生 | SQLite projection | **是** | 损坏 quarantine + rebuild |
| Runtime turn 中间态（未 durable） | 进程内存 / 未来可选 runtime store | 内存 | **是** | 见 §3；**当前未授权** SQLite runtime SoT |

### 1.1 三条硬规则

1. **教学资产与 learner evidence 的写权威永远是文件**（或教学 JSONL ledger）。删除文件后，任何 SQLite 行都不得成为「仍可恢复的真相」。
2. **Projection 可以是优选读路径**，但必须：currentness 校验、drift → unavailable、损坏 quarantine、canonical 字节不变。
3. **Observability（usage）与 teaching outcome 正交**：usage 解释成本/延迟/失败分类，不解释「是否学会」。

---

## 2. 与实现的诚实对齐（2026-07-21）

| 实现事实 | 文档含义 |
| --- | --- |
| `conversation_projection` + list indexes + FS fallback | 列表读路径分层已落地；不是「纯装饰 analytics」 |
| `turn_projection_json` 存 turn 骨架（role/tool 名/usage 元数据），hydrate 时 content 置空 | 详情 **正文** 仍以文件为准；投影不可当 transcript SoT |
| `usage_projection` + `usage/*.jsonl` | JSONL 写权威；SQLite 可选聚合 |
| `memory_projection` 有 kind/status、无 content | 记忆正文文件 SoT |
| `absolute_path` 列保留但新写入为空；hydrate 不依赖主机绝对路径 | **DB-OPT-1 Done**：Gate 3 / support 红action 对齐 |
| 默认真全量 DELETE+INSERT rebuild；可选会话增量骨架（test/opt-in） | **DB-OPT-2 骨架 Done**：失败降级全量；见 [ADR-0001](../adr/0001-rebuildable-sqlite-projection.md) |
| `usage_projection` + TTFT/retry/truncated/error_type | **DB-OPT-3 Done**；JSONL 写权威 |
| doctor `diagnostics().usage` 段/invalid 计数 | **DB-OPT-4 Done** |
| CHECK on scope/kind/status | **DB-OPT-5 Done** |
| runtime session store | **DB-OPT-6**：**Design-complete / unimplemented** — [ADR-0052](../adr/0052-runtime-session-store.md) Proposed；无生产 schema/writer |

---

## 3. 什么仍然拒绝 / 什么可以重议

### 3.1 当前拒绝（won't do）

| ID | 拒绝内容 |
| --- | --- |
| **DB-P2-3** | 将 **教学资产 / conversation 正文 / LearningSession evidence** 的**唯一或主写权威**迁入 SQLite（含「SQLite 为主、文件仅为导出」） |
| — | analytics 同一库变 FTS 语料、snippet 产品面（无新 ADR） |
| — | 全量 AG-UI / token stream 落 durable 教学账本 |
| — | AK/SK 明文表、secret/prompt 进 projection |

### 3.2 可重议（必须新 ADR + 证据；不是 backlog 默许）

| 主题 | 允许讨论的形状 | 硬门槛 |
| --- | --- | --- |
| **可选 runtime session store** | 高 churn 运行时状态的 SQLite **缓存**；export/resume **仍以文件为权威**；库可删并由文件重建 | 新 ADR；双写/导出契约；不得让删文件后库仍「可恢复真相」 |
| **独立 FTS / Tantivy** | 独立 disposable 索引文件；metadata-first；无 raw prompt 语料 | 覆盖 ADR-0001 no-FTS 段落的新 ADR + 用户任务证据 |
| **向量记忆 projection** | disposable embedding；tool 检索路径；降级词法 | DB-P2-1 硬条件 |
| **Usage 长期保留 opt-in** | workspace 级永久 usage JSONL（仍非 settlement） | 新 ADR；默认仍诊断级 |

> **注意**：可选 runtime store **不是**「会话真相源迁入 SQLite」。前者服务性能；后者放弃文件工作区可迁移性。两者在 DB-P2-3 中必须拆开（见 `database-p2-boundaries.md`）。

---

## 4. 优化 backlog 锚点（供项目优化引用）

下列 ID 是 **文档承认的优化锚点**（已闭环项标 Done / 骨架 / 设计 only / Evidence-only；**不是**「仍全部未做」）。实现 PR 仍须过验收闸；本文件不代替实现 PR。未列生产实现的：OPT-6 **仅设计**、OPT-7 **仅证据**、OPT-2 生产默认仍全量。

| ID | 项 | 优先级建议 | 状态（诚实） |
| --- | --- | --- | --- |
| **DB-OPT-1** | projection 去掉或降级 `absolute_path` 持久化 | P0 | **Done** — relative + empty absolute_path |
| **DB-OPT-2** | per-source 增量 rebuild 骨架（默认可仍全量） | P1 | **Done（骨架）** — 失败降级全量；生产默认 full |
| **DB-OPT-3** | usage 字段向 ZCode 再靠一档（TTFT/retry/truncated/error_type） | P1 | **Done** |
| **DB-OPT-4** | doctor 暴露 usage segment / invalid 行计数 | P0 | **Done** |
| **DB-OPT-5** | projection status/kind 等 DB CHECK 约束 | P1 | **Done** |
| **DB-OPT-6** | 可选 runtime session store **设计 ADR**（非实现） | P2 设计 | **Design-complete / unimplemented** — [ADR-0052](../adr/0052-runtime-session-store.md) Proposed；**无生产 schema/writer** |
| **DB-OPT-7** | 词法检索失败用例收集 → 决定是否开 FTS/向量审查 | 信号 | **Evidence-only** — [ADR-0050](../adr/0050-lexical-memory-search-and-synthetic-memory.md) 证据表；暂无触发信号 |

---

## 5. PR 速查

| 问题 | 期望答案 |
| --- | --- |
| 教学资产写权威？ | 文件 |
| 列表可以读 SQLite 吗？ | 可以，当且仅当 projection complete+current；否则文件 |
| 详情正文读 SQLite 吗？ | **否**（content 以文件为准） |
| 库删了？ | rebuild 或跳过 analytics；业务主路径仍可用 |
| 可以做 runtime SQLite 吗？ | 仅新 ADR 后；且文件仍是 export/resume 权威 |

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-21 | 初版：挑战 ADR-0001 过度绝对措辞；对齐 list/analytics 优选读路径；拆分 P2-3 与 runtime store；列出 DB-OPT-* 优化锚点 |
| 2026-07-21 | OPT 闭环：§2/§4 对齐 DB-OPT-1…7 实现/设计/证据状态 |
| 2026-07-21 | 相关链补 ADR-0050/0052；OPT-6/7 诚实状态不变 |
