# Database P2 边界与触发闸（DB-P2-1…4）

> 权威清单入口：[`database-roadmap.md`](./database-roadmap.md) §5 / §6  
> 本文件是 **P2 边界的活文档**：默认不排期、不可分派为实现，除非满足本节触发条件并经独立 ADR 批准。  
> 日期：2026-07-21  
> 状态：**边界护栏**（不构成实现授权）

相关 ADR：

- [ADR-0001](../adr/0001-rebuildable-sqlite-projection.md) — SQLite 可重建投影 + 分层权威；**no-FTS 默认**
- [database-authority-model.md](./database-authority-model.md) — 写/读权威分层与 DB-OPT 优化锚点
- [ADR-0002](../adr/0002-utc-partitioned-segmented-jsonl-and-summary-projections.md) — canonical 永久保留
- [ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) / [ADR-0038](../adr/0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) — Memory 破坏性迁移延期
- [ADR-0050](../adr/0050-lexical-memory-search-and-synthetic-memory.md) — 词法记忆检索（零 LLM、无 FTS）；DB-OPT-7 Evidence-only 锚点
- [ADR-0052](../adr/0052-runtime-session-store.md) — 可选 runtime session store **设计 only**（DB-OPT-6；**非** DB-P2-3 写权威授权）
- [ADR-0039](../adr/0039-teaching-adoption-closeout-and-signal-triggered-p2.md) — 信号触发 P2 先例（产品面）

任何 Database 相关 PR 的合并验收见 [`database-acceptance-gates.md`](./database-acceptance-gates.md)（roadmap §8 活清单）。

---

## 0. 总原则

| 规则 | 说明 |
| --- | --- |
| **默认不排期** | DB-P2-1/2/3/4 不得出现在 sprint backlog 为「可分派实现」 |
| **文件写权威** | 教学资产 / conversation 正文 / LearningSession / Memory 文件不得被 SQLite 取代为写权威；projection 可为优选读路径 |
| **禁止静默上线** | 不得以「feature flag 默认关」绕过 ADR；flag 也不等于授权 |
| **必须新 ADR** | DB-P2-3 **拒绝写权威迁库**仍成立；可选 runtime store / FTS / 向量等另案均需独立 design gate + 新 ADR + 证据 |
| **禁止 forbidden 实现** | 不得引入向量 embedding 写入、analytics 库 FTS 语料、**会话正文/教学 ledger 的 SQLite 写权威**、workflow run 编排权威入库 |

---

## 1. 状态总表

| ID | 项 | 状态 | 重议门槛 |
| --- | --- | --- | --- |
| **DB-P2-1** | 可选向量记忆 projection | **信号触发；默认不排期** | 新 ADR + 全部硬条件 |
| **DB-P2-2** | 可选 Tantivy/FTS 记忆索引 | **信号触发；默认不排期；冲突 ADR-0001** | 新 ADR 明确覆盖 no-FTS 重开 + 全部硬条件 |
| **DB-P2-3** | 会话/**教学**写权威迁入 SQLite | **won't do（写权威）** | 写权威迁库仅当产品重定位；**可选 runtime store** 见 §4.5（须新 ADR，非本项默许） |
| **DB-P2-4** | Workflow run 树入库 | **信号触发；默认不排期** | 教学编排产品需求证明 + 新 ADR |

---

## 2. DB-P2-1 — 可选向量记忆 projection

### 2.1 当前决定

- **不实现** sqlite-vec / embedding 表 / 向量检索产品路径。
- 记忆检索继续以 ADR-0050 **词法检索** + 文件 catalog 为准。
- 借鉴对象（Marvis `memory_vector.db`）仅作对照，**不是**移植清单。

### 2.2 重新开启硬条件（须全部满足）

1. **经验证的用户任务**：教学场景中词法检索已无法完成、且有可复现失败用例（非「有了更好」）。
2. **独立新 ADR**：标题建议含 `vector-memory-projection`；明确「向量只是 disposable projection」。
3. **删除/授权仍看文件 catalog**：embedding 行不得成为 remember/forget 或 visibility 的权威。
4. **不进 system prefix**（对齐 ADR-0044）：embedding / 检索片段不得进入稳定 system 前缀。
5. **仅 tool 检索路径**：可选 `memory_search` 后端插件，默认失败时 **安全降级** 到词法检索。
6. **模型/维度/迁移写死**：扩展模块缺失时产品主路径仍可用。
7. **隐私审查**：按 `memoryKind` allowlist；默认排除 secret-bearing / raw prompt / API key。
8. **与 ADR-0050 并存的 ranking 契约**：文档化 lexical vs vector 合并规则；禁止 silent swap。
9. **通过** [`database-acceptance-gates.md`](./database-acceptance-gates.md) 全部闸门。

### 2.3 明确非目标（开启后仍禁止）

- 不以向量库替代 Memory 文件 SoT
- 不把 embedding 写入 learning ledger / settlement
- 不做默认云端 embedding 服务

### 2.4 PR / 实现拒绝信号

若 diff 出现下列任一且 **无** 已合并的新 ADR 链接，**必须拒绝合并**：

- `sqlite-vec` / `vec0` / embedding 列写入 production path
- 新增 vector index 文件作为默认依赖
- 将 embedding 结果注入 system prompt / settlement

---

## 3. DB-P2-2 — 可选 FTS / Tantivy 记忆索引

### 3.1 当前决定

- **直接冲突** [ADR-0001](../adr/0001-rebuildable-sqlite-projection.md) no-FTS 产品面。
- **不实现** FTS5、Tantivy、用户可见全文搜索、snippet/highlight 产品面。
- analytics 用 `studiumx-index.sqlite` **禁止**扩成 query-facing corpus。

### 3.2 重新开启硬条件（须全部满足）

1. **经验证的用户任务**（非探索性「可能更好」）。
2. **metadata-first 审查先于 content index**（ADR-0001 重开条件）。
3. **独立新 ADR** 必须写清：
   - 语料范围（哪些文件/字段可索引）
   - 红action 与 snippet 政策（默认 **禁止** 返回 raw content/path/secret）
   - audit 禁止项（不得记录查询原文与敏感 locator）
   - 明确 **覆盖/修订** ADR-0001 no-FTS 的哪一段，而不是 silently ignore
4. **独立 disposable index 文件**（不得与 analytics 同一库直接变搜索引擎）。
5. **禁止** 用 projection 行作为授权/详情读取/删除裁决依据。
6. **通过** 验收总闸。

### 3.3 PR / 实现拒绝信号

无新 ADR 时拒绝：

- `CREATE VIRTUAL TABLE … USING fts`
- Tantivy / full-text product UI/IPC
- search snippet / highlight / relevance score 用户可见面
- 将 conversation/memory 正文编入 analytics SQLite 作搜索语料

---

## 4. DB-P2-3 — 会话/教学 **写权威** 迁入 SQLite — **won't do（写权威）**

> 活模型：[`database-authority-model.md`](./database-authority-model.md)  
> **拆分**：本项拒绝的是 **写权威迁库**；**不等于**拒绝「projection 优选读路径」或「未来可选 runtime cache（须新 ADR）」。

### 4.1 决定（拒绝项）

**当前产品定位下明确拒绝**：

1. 将 conversation **正文** / LearningSession / Evidence / Memory **文件写权威** 迁入 SQLite；
2. 采用「SQLite 为唯一或主真相、文件仅为导出」；
3. 删除 canonical 文件后，仍宣称可从 SQLite **完整恢复**教学/会话真相。

**不在本项拒绝范围内（已允许或另案）：**

- projection 作为 list metadata / analytics 的**优选读路径**（ADR-0001 修订 + authority model）；
- usage / approval 的 JSONL 写权威 + 可选 SQLite 投影；
- **可选 runtime session store**（仅性能缓存；export/resume 仍以文件为准）——见 §4.5，**须独立新 ADR**，本项 won't-do **不**默许实现。

### 4.2 原因

- 教学工作区成功标准是 **可迁移文件**（`MISSION.md`），不是「打开 App 才能拿到会话」
- Marvis 事件膨胀与 ZCode 双轨一致性证明：会话 SQLite SoT 有产品税
- 削弱 doctor / backup / git-friendly 审查路径

### 4.3 写权威迁库的唯一可重议前提

仅当 **产品顶层重定位**（书面放弃「文件工作区为教学写权威」）并经：

1. 产品 mission 修订（`MISSION.md` / 顶层产品 ADR）
2. 替换 ADR-0001/0002 **写权威**边界的独立顶层 ADR（不是本清单 P2 小补丁）
3. 迁移/双写/回滚与审计方案完整评审

否则对 **写权威迁库** **永不实现**。Feature flag、实验分支或「先双写再切主权威」**不构成**授权。

### 4.4 PR / 实现拒绝信号（写权威）

无产品重定位 ADR 时拒绝：

- conversation / message / part **主写存储**改为 SQLite-authoritative
- LearningSessionLedger / Evidence / Outcome **权威**迁库
- 「删除文件后仍以 SQLite 为可恢复真相」
- 将 projection 行升级为 settlement / 授权 / 删除裁决依据

### 4.5 可选 runtime session store（**不是** DB-P2-3 默许）

| | |
| --- | --- |
| **状态** | **未授权实现**；**DB-OPT-6 Design-complete / unimplemented** — 设计见 [ADR-0052](../adr/0052-runtime-session-store.md) Proposed；**无生产 schema/writer** |
| **允许讨论的形状** | 高 churn 运行时状态的 disposable SQLite **缓存**；turn 成功路径 durable 仍落文件；库可删并由文件重建 |
| **硬门槛** | 实现须遵守 ADR-0052（export/resume **文件权威**；一致性/双写/故障矩阵）；通过验收总闸；**不得**用本项覆盖 won't-do 写权威迁库 |
| **拒绝信号（无实现授权）** | 以 runtime 为名落地 message/part 主表并停止写会话文件；或删文件后仍从 runtime 库恢复正文 |


---

## 5. DB-P2-4 — Workflow run 树入库

### 5.1 当前决定

- **不实现** ZCode 风格 `workflow_run` / `activity` / `event` / `session_task_link` 入库。
- 教学编排继续以既有 teaching-turn / session protocol / ledger 表达（见 ADR-0008、0021、0040、0047）。

### 5.2 触发信号（须同时出现）

1. 教学产品出现 **稳定的** 多 agent / 多阶段 mission orchestration 需求（可演示、可验收，不是设计草图）。
2. 现有 teaching-turn / session protocol **已证明无法** 表达预算与子会话树（有失败案例与影响面说明）。
3. 独立新 ADR：优先 **JSONL canonical + 可选 SQLite projection**；状态机 CHECK 可借鉴 ZCode，但不得默认开放用户脚本 workflow 面。
4. 通过验收总闸；不得让 workflow 表成为 settlement 旁路。

### 5.3 明确非目标

- 不开放 script workflow 用户脚本面
- 不以 workflow SQLite 替代 LearningSessionLedger
- 不把 AG-UI / token stream 全量落库

### 5.4 PR / 实现拒绝信号

无新 ADR + 触发证据时拒绝：

- 新增 workflow_run 类生产表并作为编排权威
- 通用 multi-agent 编排平台化（亦受 ADR-0039 约束）

---

## 6. 与 §6 won't-borrow 的关系

[`database-roadmap.md`](./database-roadmap.md) §6 的「明确不借清单」仍然有效。本文件把其中与 P2 相关的项落成 **可执行的触发/拒绝闸**，便于 PR 审查引用，而不重复发明第二套优先级。

| won't-borrow 项 | 对应闸 |
| --- | --- |
| SQLite 作为会话/教学**写权威**（唯一或主真相） | DB-P2-3 won't do（写权威）；runtime store 另见 §4.5 |
| 把 analytics 库改 FTS 语料 | DB-P2-2 |
| 全量 AG-UI / token stream 落库 | DB-P2-4 非目标 + 验收闸「无秘密/无正文膨胀」 |
| 基于 age/size 删 canonical | 验收闸 + ADR-0002（与 P2 无关，仍禁止） |

---

## 7. 维护规则

1. 修改本文件中的触发条件 = 政策变更，须在 PR 中说明，并更新 roadmap 变更记录。
2. 不得在本文件中「顺便」加入实现伪代码或 schema 迁移 SQL 作为默认路径。
3. 单元测试 `tests/unit/database-pr-gates.unit.test.ts` 锁定关键短语与交叉链接存在性。

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-21 | 初版：固化 DB-P2-1…4 为 wont-do / 信号触发闸；无实现授权 |

| 2026-07-21 | 修订：拆分 DB-P2-3「写权威迁库」与「可选 runtime store」；对齐分层权威模型 |
| 2026-07-21 | §4.5 交叉链 [ADR-0052](../adr/0052-runtime-session-store.md) / DB-OPT-6 Design-complete；写权威 won't-do / 永不实现 / 优选读 不变 |
