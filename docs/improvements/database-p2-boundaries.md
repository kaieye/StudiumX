# Database P2 边界与触发闸（DB-P2-1…4）

> 权威清单入口：[`database-roadmap.md`](./database-roadmap.md) §5 / §6  
> 本文件是 **P2 边界的活文档**：默认不排期、不可分派为实现，除非满足本节触发条件并经独立 ADR 批准。  
> 日期：2026-07-21  
> 状态：**边界护栏**（不构成实现授权）

相关 ADR：

- [ADR-0001](../adr/0001-rebuildable-sqlite-projection.md) — SQLite 仅 rebuildable projection；**no-FTS**
- [ADR-0002](../adr/0002-utc-partitioned-segmented-jsonl-and-summary-projections.md) — canonical 永久保留
- [ADR-0006](../adr/0006-scoped-memory-partition-and-readonly-migration-preflight.md) / [ADR-0038](../adr/0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) — Memory 破坏性迁移延期
- [ADR-0050](../adr/0050-lexical-memory-search-and-synthetic-memory.md) — 词法记忆检索（零 LLM、无 FTS）
- [ADR-0039](../adr/0039-teaching-adoption-closeout-and-signal-triggered-p2.md) — 信号触发 P2 先例（产品面）

任何 Database 相关 PR 的合并验收见 [`database-acceptance-gates.md`](./database-acceptance-gates.md)（roadmap §8 活清单）。

---

## 0. 总原则

| 规则 | 说明 |
| --- | --- |
| **默认不排期** | DB-P2-1/2/3/4 不得出现在 sprint backlog 为「可分派实现」 |
| **文件真相源** | SQLite / 向量 / FTS / workflow 表都不得取代 JSON/JSONL/Markdown/Memory 文件 |
| **禁止静默上线** | 不得以「feature flag 默认关」绕过 ADR；flag 也不等于授权 |
| **必须新 ADR** | 除 **DB-P2-3（拒绝项）** 外，任何重议都需要独立 design gate + 新 ADR + 用户任务证据 |
| **禁止 forbidden 实现** | 本目录文档与脚本不得引入向量 embedding 写入、FTS schema、会话 SQLite SoT、workflow run 入库实现 |

---

## 1. 状态总表

| ID | 项 | 状态 | 重议门槛 |
| --- | --- | --- | --- |
| **DB-P2-1** | 可选向量记忆 projection | **信号触发；默认不排期** | 新 ADR + 全部硬条件 |
| **DB-P2-2** | 可选 Tantivy/FTS 记忆索引 | **信号触发；默认不排期；冲突 ADR-0001** | 新 ADR 明确覆盖 no-FTS 重开 + 全部硬条件 |
| **DB-P2-3** | 会话真相源迁入 SQLite | **won't do（明确拒绝）** | 仅当产品重定位（放弃文件工作区真相）后另起顶层 ADR |
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

## 4. DB-P2-3 — 会话真相源迁入 SQLite — **won't do**

### 4.1 决定（拒绝项）

**当前产品定位下明确拒绝**：不得将 conversation / session / message 的权威存储迁入 SQLite（或「SQLite 为主、文件为导出」）。

### 4.2 原因

- 与 ADR-0001 / 0002 **文件真相 + 永久保留 + 可审计 diff** 冲突
- Marvis / ZCode 会话库优势服务「通用 agent 产品」，不是教学工作区文件 SoT
- 会削弱 doctor / backup / git-friendly 审查路径

### 4.3 唯一可重议前提

仅当 **产品顶层重定位**（书面放弃「文件工作区为教学真相」）并经：

1. 产品 mission 修订（`MISSION.md` / 顶层产品 ADR）
2. 替换 ADR-0001/0002 边界的独立顶层 ADR（不是本清单 P2 小补丁）
3. 迁移/双写/回滚与审计方案完整评审

否则 **永不实现**。Feature flag、实验分支或「先双写再切」**不构成**授权。

### 4.4 PR / 实现拒绝信号

拒绝任何将下列对象改为 SQLite-authoritative 的 PR（无产品重定位 ADR）：

- conversation / message / part 主存储
- LearningSessionLedger 权威迁库
- 「删除文件后仍以 SQLite 为可恢复真相」

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
| SQLite 作为会话唯一真相 | DB-P2-3 won't do |
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
