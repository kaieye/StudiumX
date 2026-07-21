# ADR-0001：将 SQLite 限定为可重建投影，并采用分层权威

- **状态：** 已实施；**2026-07-21 修订** — 对齐「分层权威」与 list/analytics 优选读路径；no-FTS 默认产品面仍关闭
- **范围：** C-1 可重建 SQLite analytics / list metadata projection 及其 no-FTS 边界
- **证据提交：** `d9de382`（`feat(data): add rebuildable SQLite analytics index`）及后续 LocalDataIndex 演进
- **政策总闸 / 分层权威：** [ADR-0124](0124-database-layered-authority-and-pr-gates.md)

## 决定

引入 `studiumx-index.sqlite` 作为本地数据的 **可重建 projection**，而不是教学资产或 learner evidence 的写权威。

索引记录 source checksum / migration 状态；当索引缺失、损坏、schema 不支持或发现 source drift 时，可以隔离或重建索引。业务在 incomplete/unavailable 时回退到 canonical JSON、JSONL 和 Markdown。

### 分层权威（2026-07-21 明确）

| 层 | 角色 |
| --- | --- |
| **写权威** | 教学资产、conversation **正文**、LearningSession / Evidence / Memory **文件或教学 JSONL** |
| **优选读路径** | 在 projection `ready` 且 current 时，**允许** list metadata 与 analytics 聚合优先读 SQLite |
| **详情 content** | 始终以文件为准；projection 不得充当 transcript / memory 正文 SoT |
| **可丢弃** | 删除 `studiumx-index.sqlite*` 必须可重建；不得要求用户备份投影才能恢复工作区 |

旧措辞「SQLite 只是可有可无的 analytics 装饰」**已废弃**：实现中 `listConversations`、usage analytics adapter 等已将 projection 作为优选读路径，文件为 fallback。

### no-FTS 默认边界

C-1 **默认不授权** 用户可见全文搜索产品面，也不得把 analytics 同一库扩成 searchable/query-facing corpus。

以下仍 **未实施且默认未获授权**：

- FTS5 / Tantivy 产品搜索、snippet/highlight、跨域自由文本检索 UI；
- 为搜索而把 prompt、turn content、tool payload、secret、raw Memory content 编入 query 语料；
- 因查询在 UI/API/日志中返回 content snippet、敏感 path、checksum 作为检索结果展示。

**重新开启检索索引** 不要求放弃文件写权威；要求 **独立 disposable 索引文件** + 新 ADR + 经验证用户任务（见 [ADR-0124](0124-database-layered-authority-and-pr-gates.md) DB-P2-2）。不得 silently 把 analytics 库改成搜索引擎。

## 已落地范围与验证入口

`src/main/local-data-index/` 的 index 与 schema migration，实现启动接入、list 索引、usage 投影、损坏隔离与文件回退。验证代码位于 `tests/unit/local-data-index.unit.test.ts` 与相关 integration analytics 测试，覆盖 migration、损坏隔离、source drift 和回退读取等场景。

### Projection 路径列与 preferred-read（DB-OPT-1 沉淀）

| 项 | 决定 |
| --- | --- |
| **写权威** | 仍在文件；projection 行 **不得** 因 `absolute_path` 成为 durable SoT |
| **absolute_path** | 列可保留兼容；**新 rebuild 写入空串**；hydrate / preferred-read 用 **relative_path + workspace root** 解析，不依赖主机绝对路径 |
| **旧行** | migration 可清空历史绝对路径；Gate 3 / support redaction 对齐 |
| **preferred-read** | list/analytics 在 `ready` 且 current 时优先读 SQLite；路径解析失败或 drift → 文件 fallback，不把库路径当权威恢复源 |

### Multi-workspace rebuild 性能（DB-P1-4 / DB-OPT-2 沉淀）

| 项 | 决定 |
| --- | --- |
| **生产默认** | `LocalDataIndex.rebuild()` **全量** DELETE 各 projection 表再 INSERT（manifest fingerprint + multi-boundary currentness） |
| **DB-OPT-2 骨架** | 纯函数 `planIncrementalRebuild({ previous, next, forceFull? })`；可选 test-hook `enableIncrementalConversationRebuild` 仅会话表增量，**仍全量刷新**其它 projection 表；失败必须降级全量 |
| **何时扩大增量** | fixture L 证明 ≥2× wall-time 收益且 incomplete/unavailable 不恶化；feature flag 默认关；独立 PR + Gate 1–6 |
| **非目标** | 默认不开启多表生产增量；不为本项引入 FTS 或第二套 durable 索引格式 |

实现入口：`src/main/local-data-index/index.ts`（`rebuild`、`planIncrementalRebuild`）。

### Backup / export 与可丢弃投影（DB-P1-5 沉淀）

| 类 | 路径示例 | 操作 |
| --- | --- | --- |
| **Must backup** | 工作区 `MISSION.md`、`courses/**`、`learning-sessions/**`、`memory/**`、`.studiumx/learning-work*.jsonl`、approval receipts；app-data settings/registry（**须脱敏密钥**） | 真实备份必含 |
| **Disposable** | `studiumx-index.sqlite*`（含 wal/shm/quarantined）、analytics `*.sqlite*`、Electron Cache、diagnostic logs | 可删；rebuild 从文件真相恢复 |
| **Export 默认** | `includeProjections: false` | 排除 projection；opt-in 仅 debug，且标记 `untrustedProjection: true`，**不得**当权威恢复 |

权威模块：`src/shared/backup-export-policy.ts`（`decideWorkspaceExportPath`、`isDisposableProjectionPath`、`formatBackupPolicySummary` 等）。Doctor / GUIDE / `docs/CONFIG_PATHS.md` 引用该模块。Support bundle 仍走 ADR-0034（consent + redaction）。

验证：

```bash
pnpm exec vitest run --project unit tests/unit/backup-export-policy.unit.test.ts
pnpm exec vitest run --project unit tests/unit/local-data-index.unit.test.ts
```

## 不包含 / non-claims

- SQLite **不**替代详情正文读取、canonical 文件写入或提交成功依据。
- SQLite **不**成为 LearningSession / Evidence / Outcome 的结算权威。
- Projection 列 **`absolute_path` 不是 durable 权威**；空值 + relative hydrate 是预期，不得因路径列恢复教学正文。
- Preferred-read **不是** write authority：list/analytics 可优先读库，写与详情 content 仍以文件为准。
- 本 ADR **不**授权将会话正文主写权威迁入 SQLite（见 DB-P2-3 与 [ADR-0123](0123-runtime-session-store.md) 边界；0123 仅为 Proposed / 未实施设计）。
- 本 ADR **不**授权可选 runtime session store 的生产 schema/writer；讨论见 ADR-0123，实现须另案且文件仍是 export/resume 权威。
- 现有 projection 的 currentness、canonical fallback、schema migration、source fingerprint 和损坏隔离服务于可重建边界，**不**表示搜索能力已经实现。
- 备份/export 政策 **不**授权把 projection 当作教学真相恢复源。

## 修订说明（2026-07-21）

挑战结论：产品需要的是 **教学可迁移（文件写权威）**，不是 **「SQLite 永不参与读路径」**。
本修订把 ADR 从「投影几乎无权威」改为「写权威在文件；读路径可分层」。政策总闸、P2 边界与切片状态见 [ADR-0124](0124-database-layered-authority-and-pr-gates.md)。

| 日期 | 说明 |
| --- | --- |
| 2026-07-21 | 分层权威修订；对齐 list/analytics 优选读 |
| 2026-07-21 | 沉淀 DB-P1-4/OPT-2 rebuild 默认与骨架；沉淀 DB-P1-5 backup/export 可丢弃声明（自 `docs/improvements/*`） |
| 2026-07-21 | 沉淀 DB-OPT-1：`absolute_path` 非 durable 权威；新 rebuild 写空 + relative hydrate 与 preferred-read 一致 |
| 2026-07-21 | 活文档指针改挂 ADR-0124；删除 `docs/improvements/database-*` 草稿 |
