# ADR-0124：Database 分层权威、P2 边界、验收总闸与切片闭环

- **状态：** 已实施（政策 / 文档权威；非新 schema）
- **日期：** 2026-07-21
- **范围：** 写/读权威分层；DB-P2-1…4 触发与拒绝闸；任何 LocalDataIndex / projection / usage 相关 PR 的六大验收闸；P0/P1/OPT 切片诚实状态
- **相关：** [ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)、[ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md)、[ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0034](0034-redacted-support-bundle.md)、[ADR-0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md)、[ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)、[ADR-0122](0122-usage-ledger-as-canonical-observability.md)、[ADR-0123](0123-runtime-session-store.md)
- **证据来源（已删除的活草稿，政策以本 ADR 为准）：** 曾位于 `docs/improvements/database-{authority-model,p2-boundaries,acceptance-gates,roadmap}.md`（2026-07-21 收敛）
- **对照主体：** StudiumX；对照对象曾为 Marvis 本机库与 ZCode CLI/tasks-index（证据摘要见 §6）

---

## 0. 为什么要本 ADR

早期叙述容易把两件事绑死：

1. **教学工作区可迁移**（Mission / Lesson / Learning record 是文件）——产品成功标准。
2. **SQLite 几乎不配做任何读/写权威**——过度推广。

实现已让 projection 成为 list / analytics 的**优选读路径**（文件是 fallback 与 content 权威）。政策必须诚实对齐实现，并用可执行闸门约束 PR，而不是用分散的 improvements 草稿。

本 ADR **不**单独授权实现 FTS、向量、写权威迁库或 runtime store 生产 schema；那些边界见 §3–§4 与既有 ADR。

---

## 1. 分层权威（写权威 vs 读偏好）

| 数据类 | 写权威（Source of Truth） | 优选读路径 | 可丢弃？ | 备注 |
| --- | --- | --- | --- | --- |
| Mission / Lesson HTML / Resource / Reference | 工作区文件 | 文件 | **否**（canonical） | 教学资产；git / 打包 / 迁移 |
| LearningSession ledger / Evidence / Outcome marker | JSONL / 文件 ledger | 文件（projection 仅摘要） | **否** | 结算权威；SQLite **永不**替代 |
| Memory catalog records | Memory 文件 | 文件 catalog；词法检索进程内 | **否**（文件） | projection **不存 content** |
| Agent conversation **正文** transcript | 会话 JSON / Markdown 文件 | **文件**（详情 content） | **否** | 可审计、可 redaction 写入 |
| Conversation **列表** metadata（title/updated/pinned/archived/count） | 文件（写入时） | **SQLite projection 优先**；incomplete → 文件扫描 | 投影 **是** | `listConversations` + FS fallback |
| Learning-work / usage / approval receipts | Append-only JSONL | JSONL 扫描或 projection 聚合 | usage/receipt 诊断级可 purge；learning-work 见 ADR-0002 | usage 正交教学 outcome（ADR-0122） |
| Analytics aggregates / doctor index diagnostics | 派生 | SQLite projection | **是** | 损坏 quarantine + rebuild |
| Runtime turn 中间态（未 durable） | 进程内存 / 未来可选 runtime store | 内存 | **是** | ADR-0123 **Proposed / 未实施**；**当前未授权** SQLite runtime SoT |

### 1.1 三条硬规则

1. **教学资产与 learner evidence 的写权威永远是文件**（或教学 JSONL ledger）。删除文件后，任何 SQLite 行都不得成为「仍可恢复的真相」。
2. **Projection 可以是优选读路径**，但必须：currentness 校验、drift → unavailable、损坏 quarantine、canonical 字节不变。
3. **Observability（usage）与 teaching outcome 正交**：usage 解释成本/延迟/失败分类，不解释「是否学会」。

### 1.2 与实现的诚实对齐（2026-07-21）

| 实现事实 | 文档含义 |
| --- | --- |
| `conversation_projection` + list indexes + FS fallback | 列表读路径分层已落地 |
| `turn_projection_json` 存 turn 骨架；hydrate 时 content 置空 | 详情正文仍以文件为准 |
| `usage_projection` + `usage/*.jsonl` | JSONL 写权威；SQLite 可选聚合 |
| `memory_projection` 有 kind/status、无 content | 记忆正文文件 SoT |
| `absolute_path` 列保留但新写入为空；hydrate 不依赖主机绝对路径 | **DB-OPT-1 Done** |
| 默认真全量 DELETE+INSERT rebuild；可选会话增量骨架（test/opt-in） | **DB-OPT-2 骨架 Done**；失败降级全量；见 ADR-0001 |
| `usage_projection` + TTFT/retry/truncated/error_type | **DB-OPT-3 Done** |
| doctor `diagnostics().usage` 段/invalid 计数 | **DB-OPT-4 Done** |
| CHECK：conversation `scope`；usage `kind`/`status`；memory `status`（**非** memory.kind / usage.approval_status） | **DB-OPT-5 Done** |
| runtime session store | **DB-OPT-6 Design-complete / unimplemented** — ADR-0123 Proposed |

### 1.3 PR 速查

| 问题 | 期望答案 |
| --- | --- |
| 教学资产写权威？ | 文件 |
| 列表可以读 SQLite 吗？ | 可以，当且仅当 projection complete+current；否则文件 |
| 详情正文读 SQLite 吗？ | **否**（content 以文件为准） |
| 库删了？ | rebuild 或跳过 analytics；业务主路径仍可用 |
| 可以做 runtime SQLite 吗？ | 仅 ADR-0123 实现授权后；且文件仍是 export/resume 权威 |

---

## 2. 验收总闸（任何 Database 相关 PR）

### 2.1 何时必须填写

PR 触及下列任一路径或主题时，作者与审查者须在 PR 描述中勾选本节闸门：

- `src/main/local-data-index/**`
- `studiumx-index.sqlite` / analytics adapter / projection schema migration
- usage / approval receipt / memory projection 相关持久化
- doctor / support-bundle 中与 index 诊断相关的输出
- 本 ADR 或相邻 database 政策变更
- 任何「借鉴 Marvis / ZCode database」的实现 PR

纯文档 typo 且不改变闸门语义时，可声明 `Database-gates: n/a (docs typo only)`。

### 2.2 六大强制闸

合并前必须 **全部为真**。每一项给出「如何证明」；不得只写「LGTM」。

#### Gate 1 — Canonical 不变性

- [ ] **声明**：projection quarantine / rebuild / migration **不修改** JSON / JSONL / Memory 源文件字节（除该 PR 明确授权且有业务写入路径的变更）。
- [ ] **证明**：unit 或 integration 对比 quarantine/rebuild 前后 canonical 文件 bytes / checksum；或说明为何本 PR 不触及 rebuild 路径并指出既有测试仍覆盖。
- [ ] **拒绝**：借「索引优化」改写、搬迁或物理删除 canonical。

#### Gate 2 — Drift 安全

- [ ] **声明**：source fingerprint / mtime / checksum 变更后，adapter **不得** 静默返回 `ready` 的 stale 数据。
- [ ] **证明**：存在覆盖 source drift → unavailable / rebuild 调度 / 文件回退 的测试，或本 PR 未改 currentness 逻辑且链接既有用例。
- [ ] **拒绝**：为了「体验顺滑」缓存过期 projection 而不标记 incomplete/unavailable。

#### Gate 3 — 无秘密进索引

- [ ] **声明**：usage / projection / receipt / doctor / support-bundle **默认** 不落 API key、raw prompt、完整 tool 敏感 args、未脱敏绝对路径（政策允许的 digest 除外）。
- [ ] **证明**：schema 字段审查说明 + 相关 redaction 测试 / `check:security` 仍适用；新增列有 allowlist 注释。
- [ ] **拒绝**：调试方便把 prompt 正文或密钥写入 SQLite。

#### Gate 4 — 失败可降级

- [ ] **声明**：native `better-sqlite3` 不可用、migration 冲突、或 index `unavailable` 时，**产品主路径仍可用**（文件扫描 / 跳过 analytics / doctor 可读错误）。
- [ ] **证明**：fallback 测试或手动矩阵说明；CI 在 native 缺失环境不把主路径打成硬失败（除非该 PR 明确只修 native 构建）。
- [ ] **拒绝**：index 成为打开 workspace 或完成 turn 的硬依赖。

#### Gate 5 — 政策对齐

- [ ] **声明**：不引入 analytics 库 FTS 产品面；不引入 canonical 物理删除（age/size）；不绕过工具 effect lattice；不把 SQLite 当教学/会话**写权威**（projection 优选读路径允许；见 §1）。
- [ ] **证明**：对照 §3；若触及 P2 能力，必须有 **已合并** 新 ADR 链接，否则标为 won't-do / out-of-scope。
- [ ] **拒绝**：DB-P2-1/2/3/4 的 forbidden 实现（见 §3 拒绝信号）。

#### Gate 6 — 测试

- [ ] **声明**：unit + 必要 integration；涉及 migration 时覆盖 checksum 冲突。
- [ ] **证明**：列出命令与结果（至少 targeted vitest；推荐 `pnpm run test:unit -- tests/unit/local-data-index.unit.test.ts` 或本 PR 对应文件）。
- [ ] **拒绝**：仅改 production 无测试、或只靠手动点一点。

### 2.3 PR 描述可复制块

```markdown
### Database acceptance gates (ADR-0124)

- [ ] Gate 1 Canonical immutability — evidence: …
- [ ] Gate 2 Drift safety — evidence: …
- [ ] Gate 3 No secrets in index — evidence: …
- [ ] Gate 4 Degrade on failure — evidence: …
- [ ] Gate 5 Policy alignment (no analytics FTS / no canonical purge / no SQLite teaching write-SoT / effect lattice / layered authority) — evidence: …
- [ ] Gate 6 Tests (unit + migration checksum if touched) — evidence: …

P2 boundary check (see ADR-0124 §3):
- [ ] Does **not** implement DB-P2-1 vector memory without new ADR
- [ ] Does **not** implement DB-P2-2 FTS/Tantivy without new ADR overriding ADR-0001
- [ ] Does **not** implement DB-P2-3 SQLite teaching/session **write** source-of-truth (won't do; runtime store needs separate ADR)
- [ ] Does **not** implement DB-P2-4 workflow-run tree store without trigger + new ADR
```

### 2.4 审查速查

| 问题 | 期望答案 |
| --- | --- |
| 写权威是文件还是 SQLite？ | **写权威=文件**（教学/正文/ledger）；list/analytics 可读 projection |
| 损坏 index 怎么办？ | quarantine + rebuild；canonical 不动 |
| native 挂了？ | 主路径仍可用 |
| 有搜索/向量/workflow 入库吗？ | 默认否；有则要新 ADR + 本清单全绿 |
| 有 secret/prompt 进投影吗？ | 否 |

### 2.5 与 CI 的关系

| 层 | 作用 |
| --- | --- |
| 本 ADR §2 | 人工 + PR 模板约束；政策权威 |
| `tests/unit/database-pr-gates.unit.test.ts` | 锁定本 ADR 关键条款仍存在 |
| `pnpm run check:security` 等 | 既有隐私/路径硬门；不替代本清单 |
| Blocking CI | 保持窄门（ADR-0023 / 0045）；**不**因本清单自动跑全量 database suite |

### 2.6 维护规则

1. 新增第 7 条闸门时：更新本 ADR、单元测试断言、PR 模板指针。
2. 不得删除六大闸；只能收紧或拆分子检查项。

---

## 3. P2 边界与触发闸（DB-P2-1…4）

### 3.0 总原则

| 规则 | 说明 |
| --- | --- |
| **默认不排期** | DB-P2-1/2/3/4 不得出现在 sprint backlog 为「可分派实现」 |
| **文件写权威** | 教学资产 / conversation 正文 / LearningSession / Memory 文件不得被 SQLite 取代为写权威；projection 可为优选读路径 |
| **禁止静默上线** | 不得以「feature flag 默认关」绕过 ADR；flag 也不等于授权 |
| **必须新 ADR** | DB-P2-3 **拒绝写权威迁库**仍成立；可选 runtime store / FTS / 向量等另案均需独立 design gate + 新 ADR + 证据 |
| **禁止 forbidden 实现** | 不得引入向量 embedding 写入、analytics 库 FTS 语料、**会话正文/教学 ledger 的 SQLite 写权威**、workflow run 编排权威入库 |

### 3.1 状态总表

| ID | 项 | 状态 | 重议门槛 |
| --- | --- | --- | --- |
| **DB-P2-1** | 可选向量记忆 projection | **信号触发；默认不排期** | 新 ADR + 全部硬条件 |
| **DB-P2-2** | 可选 Tantivy/FTS 记忆索引 | **信号触发；默认不排期；冲突 ADR-0001** | 新 ADR 明确覆盖 no-FTS 重开 + 全部硬条件 |
| **DB-P2-3** | 会话/**教学**写权威迁入 SQLite | **won't do（写权威）** | 写权威迁库仅当产品重定位；**可选 runtime store** 见 §3.4（须新 ADR，非本项默许） |
| **DB-P2-4** | Workflow run 树入库 | **信号触发；默认不排期** | 教学编排产品需求证明 + 新 ADR |

### 3.2 DB-P2-1 — 可选向量记忆 projection

**当前决定：** 不实现 sqlite-vec / embedding 表 / 向量检索产品路径。记忆检索继续以 ADR-0050 词法检索 + 文件 catalog 为准。

**重新开启硬条件（须全部满足）：**

1. 经验证的用户任务：词法检索已无法完成、且有可复现失败用例（非「有了更好」）。
2. 独立新 ADR：向量只是 disposable projection。
3. 删除/授权仍看文件 catalog；embedding 行不得成为 remember/forget 或 visibility 的权威。
4. 不进 system prefix（对齐 ADR-0044）。
5. 仅 tool 检索路径；默认失败时安全降级到词法检索。
6. 模型/维度/迁移写死；扩展模块缺失时产品主路径仍可用。
7. 隐私审查：按 `memoryKind` allowlist；默认排除 secret-bearing / raw prompt / API key。
8. 与 ADR-0050 并存的 ranking 契约；禁止 silent swap。
9. 通过 §2 全部闸门。

**PR 拒绝信号（无新 ADR）：** `sqlite-vec` / `vec0` / embedding 列写入 production path；默认依赖 vector index；embedding 注入 system prompt / settlement。

### 3.3 DB-P2-2 — 可选 FTS / Tantivy

**当前决定：** 直接冲突 ADR-0001 no-FTS。不实现 FTS5、Tantivy、用户可见全文搜索、snippet/highlight。analytics 用 `studiumx-index.sqlite` **禁止**扩成 query-facing corpus。

**重新开启硬条件：** 经验证用户任务；metadata-first 审查先于 content index；独立新 ADR 写清语料范围、redaction/snippet 政策、audit 禁止项、明确覆盖 ADR-0001 no-FTS 哪一段；**独立 disposable index 文件**；禁止用 projection 行作授权/详情/删除裁决；通过 §2。

**PR 拒绝信号（无新 ADR）：** `CREATE VIRTUAL TABLE … USING fts`；Tantivy / full-text product UI/IPC；search snippet/highlight 用户可见面；conversation/memory 正文编入 analytics SQLite 作搜索语料。

### 3.4 DB-P2-3 — 会话/教学 **写权威** 迁入 SQLite — **won't do（写权威）**

**拒绝：**

1. 将 conversation **正文** / LearningSession / Evidence / Memory **文件写权威** 迁入 SQLite；
2. 采用「SQLite 为唯一或主真相、文件仅为导出」；
3. 删除 canonical 文件后，仍宣称可从 SQLite **完整恢复**教学/会话真相。

**不在拒绝范围内：**

- projection 作为 list metadata / analytics 的**优选读路径**；
- usage / approval 的 JSONL 写权威 + 可选 SQLite 投影；
- **可选 runtime session store**（仅性能缓存；export/resume 仍以文件为准）——见 ADR-0123，**须独立实现授权**，本项 won't-do **不**默许实现。

**写权威迁库的唯一可重议前提：** 产品顶层重定位（书面放弃「文件工作区为教学写权威」）+ mission 修订 + 替换 ADR-0001/0002 写权威边界的顶层 ADR + 完整迁移/回滚评审。否则对写权威迁库 **永不实现**。Feature flag /「先双写再切主权威」**不构成**授权。

**PR 拒绝信号：** conversation / message / part 主写存储改为 SQLite-authoritative；LearningSessionLedger / Evidence / Outcome 权威迁库；删除文件后仍以 SQLite 为可恢复真相；将 projection 行升级为 settlement / 授权 / 删除裁决依据。

**可选 runtime session store（不是 DB-P2-3 默许）：**

| | |
| --- | --- |
| **状态** | **未授权实现**；DB-OPT-6 Design-complete / unimplemented — [ADR-0123](0123-runtime-session-store.md) Proposed；**无生产 schema/writer** |
| **允许讨论的形状** | 高 churn 运行时状态的 disposable SQLite **缓存**；turn 成功路径 durable 仍落文件；库可删并由文件重建 |
| **硬门槛** | 实现须遵守 ADR-0123；通过 §2；**不得**用本项覆盖 won't-do 写权威迁库 |
| **拒绝信号** | 以 runtime 为名落地 message/part 主表并停止写会话文件；或删文件后仍从 runtime 库恢复正文 |

### 3.5 DB-P2-4 — Workflow run 树入库

**当前决定：** 不实现 ZCode 风格 `workflow_run` / `activity` / `event` / `session_task_link` 入库。教学编排继续以 teaching-turn / session protocol / ledger 表达（ADR-0008、0021、0040、0047）。

**触发信号（须同时出现）：** 稳定的多 agent / 多阶段 mission orchestration 产品需求；现有 protocol 已证明无法表达预算与子会话树；独立新 ADR 优先 JSONL canonical + 可选 SQLite projection；通过 §2；不得让 workflow 表成为 settlement 旁路。

**非目标：** 不开放 script workflow 用户脚本面；不以 workflow SQLite 替代 LearningSessionLedger；不把 AG-UI / token stream 全量落库。

**PR 拒绝信号：** 无新 ADR + 触发证据时新增 workflow_run 类生产表并作为编排权威；通用 multi-agent 编排平台化（亦受 ADR-0039 约束）。

### 3.6 won't-borrow（明确不借）

| 项 | 来源 | 原因 / 闸 |
| --- | --- | --- |
| SQLite 作为会话/教学**写权威** | Marvis/ZCode | DB-P2-3 won't do；runtime cache 另案 ADR-0123 |
| 全量 AG-UI / token stream 落库 | Marvis | 事件膨胀、隐私、IO；P2-4 非目标 |
| AK/SK 明文表 | Marvis `aksks` | 安全模型不可接受 |
| 把 analytics 库改 FTS 语料 | — | ADR-0001 / DB-P2-2 |
| 默认 Mem0 类云记忆 | 生态 | 本地教学 / 隐私 |
| MCP 市场与远程控制状态库 | ZCode | 产品非目标 |
| 基于 age/size 删 canonical | 任何“运维便利” | ADR-0002 |

---

## 4. 切片闭环状态（P0 / P1 / OPT）

> 本表是 **诚实索引**：Done / 骨架 / 设计 only / Evidence-only。**不是**「仍全部未做」的 backlog。实现 PR 仍须过 §2。

### 4.1 P0 — 已实现（2026-07-21 前后）

| ID | 项 | 状态 | 落点摘要 |
| --- | --- | --- | --- |
| **DB-P0-1** | Projection migration 元数据增强 | **Done** | `schema_migration`：`app_version` / `applied_by` / `sql_bytes`；checksum 不可变 |
| **DB-P0-2** | Doctor / support-bundle 暴露 index 状态 | **Done** | `LocalDataIndex.diagnostics()`；aggregate-only；ADR-0034 红action |
| **DB-P0-3** | Usage/observability 可选 projection | **Done**（最小集） | `usage-ledger.ts` + `usage_projection`；设计权威 ADR-0122 |
| **DB-P0-4** | 审批 durable receipt 文件化 | **Done** | `.studiumx/approval-receipts.jsonl`；`approval-receipt.ts`；非授权令牌 |
| **DB-P0-5** | LocalDataIndex 故障注入 | **Done** | `testHooks.injectFault`（open/migrate/integrity/busy 等） |
| **DB-P0-6** | Session/resume 列表友好字段 | **Done** | `pinned` / `archived` + list index + FS fallback |

### 4.2 P1

| ID | 项 | 状态 | 落点摘要 |
| --- | --- | --- | --- |
| **DB-P1-1** | Token/tool/turn usage 细粒度 ledger | **设计 Done + 最小实现 via P0-3** | ADR-0122 |
| **DB-P1-2** | Memory 分层元数据 | **Done** | `memoryKind` catalog / projection；文件 SoT |
| **DB-P1-3** | 教学 event 密度策略 | **Done** | `event-density-policy.ts`；沉淀 ADR-0002 |
| **DB-P1-4** | 多 workspace rebuild 性能 | **骨架 Done；生产默认全量** | `planIncrementalRebuild`；ADR-0001；扩大须 L 证据 |
| **DB-P1-5** | Backup/export 可丢弃声明 | **Done** | `backup-export-policy.ts`；沉淀 ADR-0001 |

### 4.3 OPT

| ID | 项 | 状态 |
| --- | --- | --- |
| **DB-OPT-1** | 去掉/降级 `absolute_path` 持久化 | **Done** |
| **DB-OPT-2** | per-source 增量 rebuild 骨架 | **Done（骨架）**；生产默认 full |
| **DB-OPT-3** | usage 字段 TTFT/retry/truncated/error_type | **Done** |
| **DB-OPT-4** | doctor usage segment/invalid 计数 | **Done** |
| **DB-OPT-5** | projection DB CHECK（conversation.scope；usage.kind/status；memory.status） | **Done** |
| **DB-OPT-6** | runtime session store 设计 ADR | **Design-complete / unimplemented** → ADR-0123 |
| **DB-OPT-7** | 词法失败用例 → FTS/向量审查 | **Evidence-only** → ADR-0050 证据表；暂无触发信号 |

### 4.4 当前开放实现切片

- **无**开放 local-data / database 实现切片可分派。
- **延期（非 database 本表）：** C-6 destructive Memory migration — 见 ADR-0038。
- **设计 only：** ADR-0123 runtime store（实现须另案 + §2 + 不得覆盖 DB-P2-3）。
- **证据 only：** ADR-0050 词法失败表；不足则不开启 P2-1/2 审查。

---

## 5. 与既有 ADR 的分工

| 主题 | 权威 ADR |
| --- | --- |
| 可重建 projection / no-FTS / rebuild 默认 / backup 可丢弃 / absolute_path | ADR-0001 |
| canonical 永久保留 / JSONL 分段 / event density | ADR-0002 |
| Support bundle 同意 + redaction | ADR-0034 |
| 词法检索 / 合成记忆 / OPT-7 证据 | ADR-0050 |
| Usage ledger 设计 | ADR-0122 |
| Runtime store 设计 only | ADR-0123 |
| **分层权威 + 六闸 + P2 触发/拒绝 + 切片状态** | **本 ADR（0053）** |

---

## 6. 对照证据摘要（历史）

### StudiumX

- 实现：`src/main/local-data-index/`、`usage-ledger.ts`、`ai/tools/approval-receipt.ts`、`shared/event-density-policy.ts`、`shared/backup-export-policy.ts`
- 文件：`studiumx-index.sqlite`（projection）
- 记忆：文件 catalog + 进程内词法检索（ADR-0050），**非** SQLite FTS

### Marvis（对照，非移植清单）

- 多库 SQLite + Tantivy；会话/记忆/向量/事件主存储；事件膨胀样例曾达 ~1.7 万 agui_events / 少量会话。

### ZCode（对照）

- CLI SQLite 会话 store + tasks-index；checksum migration、usage 一等公民、fs fault injection 可借鉴；双轨一致性有税。

---

## 7. 不变量 / non-claims

1. 本 ADR **不**授权 DB-P2-1…4 的 forbidden 实现。
2. 本 ADR **不**把「优选读路径」写成「写权威迁库」。
3. 本 ADR **不**要求 Blocking CI 自动扩全量 database suite。
4. 删除 `docs/improvements/database-*.md` 后，**以本文件为政策权威**；贡献入口见 `CONTRIBUTING.md`「Database PR gates」。
5. 单元测试 `tests/unit/database-pr-gates.unit.test.ts` 锁定本 ADR 关键短语与交叉链接。

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-21 | 初版：自 `docs/improvements/database-*` 收敛；分层权威 + 六闸 + P2 边界 + P0/P1/OPT 诚实状态；删除 improvements 草稿 |
