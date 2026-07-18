# 本地数据存储对比与改进候选

> 状态：分析记录；候选已在 `database` 分支获得最小实施切片时，仍保留其原始问题、取舍与边界，并在第 3 节标注已验证范围与未实施扩展。
> 调研日期：2026-07-16
> 调研方法：对本机 Zcode / Codex / Marvis 的本地存储目录做只读检查 + 对 StudiumX 主进程持久层做静态审查
> 对比对象：`~/.zcode/`、`~/Library/Application Support/Zcode/`、`~/.codex/`、`~/Library/Application Support/com.tencent.mac.marvis/`
> 文档目的：记录三工具的存储模式与 StudiumX 现状的差距，集中列出可落地的改进候选，供优先级与范围取舍。本文是分析记录与候选清单，**不是完成声明，也不是实施计划**；确定要推进的候选应另起执行计划文档。
> 唯一事实来源：代码现状以 `file_path:line` 引用为准；本机工具存储以实际目录内容为准。若未来实现细节与本文冲突，以代码与实际存储为准。

---

## 0. 如何使用这份文档

候选项使用以下选择状态（与 `pet-next-stage-roadmap.md` 一致）；它表示是否进入实施计划，**不等于候选的全部设想已经完成**。具体交付范围、提交和验证证据见第 3 节的“实施审计”。

- `[ ]` 候选：尚未决定。
- `[x]` 已选择：进入后续实施计划。
- `[-]` 暂缓：保留设计，但当前不实施。
- `[!]` 放弃：明确不实施。

优先级含义：

- **P0**：建议下一步优先实施，能验证关键领域模型或规避主要产品风险。
- **P1**：有明确用户价值，适合在 P0 稳定后实施。
- **P2**：体验增强或基础设施补强，不阻塞核心产品路径。

取舍时建议同时决定：是否实施、是否只做最小垂直切片、是否接受候选中列出的默认方案。

---

## 1. 三工具存储模式速览

| 维度 | **Zcode** | **Codex** | **Marvis**（腾讯 `com.tencent.mac.marvis`） |
|---|---|---|---|
| 主数据目录 | `~/.zcode/v2/` + `~/Library/Application Support/Zcode/session/`(Chromium) | `~/.codex/` | `~/Library/Application Support/com.tencent.mac.marvis/` |
| 会话存储 | **SQLite** `cli/db/db.sqlite`：`session`/`message`/`session_entry`/`part` 表，FK 级联删除 | **JSONL** `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`，按日期分区，append-only | `Knowledgebase/` 内容目录 |
| 结构化数据 | `tasks-index.sqlite`（任务/分组，软删除+部分索引） | **SQLite+WAL**：`logs_2`/`goals_1`/`memories_1`/`state_5` | `db/` + `Cache.db`(WAL) |
| 日志 | `logs/YYYY-MM-DD.log` **按天轮转**，结构化 `[ts][level][pid][tag]` | SQLite `logs_2.sqlite`（实测 1.9GB，无轮转膨胀） | Chromium Crashpad |
| 配置 | `config.json` + `setting.json` + `credentials.json`(分离) | `config.toml` + `auth.json`(600) | `config.toml` |
| Schema 迁移 | **`schema_migration` 表**（id+checksum+app_version+time_applied） | 数字后缀滚动 `logs_2`/`state_5`/`goals_1`/`memories_1` | — |
| 关键文件备份 | `bot-state.v2.json`(版本化) | `.codex-global-state.json` **+ `.bak`** | — |
| 模块化 | `cli/` 与 `v2/` 分层 | sessions/logs/memories/goals/state/plugins/skills 子目录 | **按子系统拆分**：Host/Knowledgebase/Agent/Service 各有 plist + cache + support 目录 |
| 追踪 | `session.trace_id` 贯穿 | `session_meta` 含 session_id | — |
| 用量分析 | `input_history`/`tool_usage`/`turn_usage`/`model_usage` 表 | `history.jsonl` | — |
| 凭证 | `credentials.json`(分离) | `auth.json`(600 明文) | Chromium Cookies |

### 1.1 关键实测细节

- **Zcode `cli/db/db.sqlite` schema**（实测 `.schema`）：含 `schema_migration`、`session`(带 `time_archived`/`time_compacting`/`parent_id`/`trace_id`)、`message`(FK `session_id on delete cascade`)、`session_entry`/`session_task_link`/`session_target`、`input_history`/`tool_usage`/`turn_usage`/`model_usage`、`local_setting`/`permission`/`todo`、`part`、`workflow_definition`/`workflow_run`/`workflow_event`/`workflow_activity`。
- **Zcode `tasks-index.sqlite`**：`tasks` 表带 `deleted`/`archived`/`pinned` 标志，并有部分索引 `CREATE INDEX ... WHERE deleted = 0`。
- **Zcode 日志格式**：`[2026-07-11 15:03:09.927] [info] [pid:85425] [main] [crash-capture] ...`，含时间戳/级别/pid/线程/tag。
- **Zcode crash**：`crash/live`(暂存) + `crash/archive`(归档) 两段式。
- **Codex 会话文件**：每行 `{timestamp, type, payload}`，事件类型含 `session_meta`/`input_text`/`response_item`/`event_msg`/`turn_context`/`token_count` 等，append-only，按 `YYYY/MM/DD/` 分区。
- **Codex `logs_2.sqlite` 实测 1.9GB**：WAL 模式，**无轮转/留存**，是「日志库无界膨胀」的反面教材。
- **Codex `history.jsonl`**：每行 `{session_id, ts, text}` 记录用户输入历史（注意：实测中发现该文件内含明文 API key 残留，StudiumX 应引以为戒——用户输入历史需脱敏）。
- **Marvis**：`config.toml` + `Knowledgebase/` + `icon_cache/`(105 项) + `db/` + `Documents/`；Preferences 按子系统拆分为 `MarvisHost.plist`/`MarvisKnowledgebase.plist`/`MarvisAgent.plist`/`MarvisService.plist`；Caches 同样按子系统拆分。

---

## 2. StudiumX 现状

### 2.1 存储根

- **appDataRoot** = `app.getPath('userData')`（`src/main/index.ts:205-207`），持有：settings、workspace 注册表、全局 memory 目录、临时会话、日志、跨工作区变更历史。
- **workspaceRoot** = `~/Documents/StudiumX Workspaces/<id>`（默认，可配置），持有：lessons、会话、learning-sessions ledger、`.teachos/`、`.studiumx/`、`.agent-sessions/`。
- 依赖盘点：**45 个依赖中零数据库/存储库**（无 sqlite/prisma/drizzle/knex/electron-store/lowdb 等）。

### 2.2 当前各存储实现

| 数据 | 位置 | 格式 | 写入方式 | 文件:行 |
|---|---|---|---|---|
| 会话存档 | `<root>/conversation(s)/chat-<ts>-<slug>.json` + `.md` | JSON+MD，每会话一套 | 原子写（temp+rename），**写后重读校验** | `src/main/agent-conversation-archive.ts:53-228` |
| 会话命名 | `chat-<YYYYMMDD-HHMMSS>-<slug>` | — | 单目录平铺，**无日期分区** | `src/main/teaching-agent-conversations.ts:90-103, 308` |
| 日志 | `<userData>/studiumx.log` | 纯文本 `${ISO} [level] ${msg}` | 队列+append，**已轮转+按 retentionDays 清理** | `src/main/logger.ts:9-152` |
| Memory catalog | `<userData>/memory/memory-<base64url(id)>.json` | 每记录一 JSON，平铺单目录 | 原子写+tombstone | `src/main/teaching-memory-catalog/record-file.ts:16-77` |
| Learning session ledger | `<workspaceRoot>/learning-sessions/<id>/` | manifest.json + events/ 每事件一文件 + outcome.json | **mkdir 锁+fsync+目录同步** | `src/main/learning-session-ledger.ts:1546-1897` |
| Learning-work ledger | `<workspaceRoot>/.studiumx/learning-work.jsonl` | append-only JSONL | `open(a,0o600)`+`file.sync()`，进程内串行 | `src/main/learning-work-ledger.ts:10-90` |
| Settings + 密钥 | `<userData>/studiumx-settings.json` | JSON，**safeStorage 加密** | 原子写 0o600，损坏改名 `.invalid-<stamp>` | `src/main/teaching-settings.ts:10-265` |
| Workspace 注册表 | `<userData>/studiumx-workspaces.json` | JSON | 原子写 | `src/main/teaching-workspace/activation-lifecycle.ts:249-272` |
| Workspace 生命周期 | `<workspaceRoot>/.teachos/sessions.jsonl` | append-only JSONL | **裸 appendFile，无锁无 fsync** | `src/main/teaching-workspace/lifecycle.ts:156-159` |
| Agent run state | `<root>/.agent-sessions/{runs,...}` | JSON，**内容寻址 checkpoint** | `atomicPrivateJson`(wx+0o600)，损坏隔离 `.corrupt-<stamp>` | `src/main/ai/agent-run-persistence.ts:428-449` |
| Artifact 留存 | tool-results/child-transcripts/... | — | **90 天/512MB/24h 宽限+审计 jsonl**（按需触发） | `src/main/agent-artifact-lifecycle.ts:20-22, 884-918` |
| 通用原子写原语 | — | — | `atomicWriteFile`：`writeFile`+`rename`，**无 fsync** | `src/main/teaching-workspace/lifecycle.ts:166-171` |

### 2.3 StudiumX 已有的优势（勿误改）

- **写入安全领先三工具**：learning-session ledger 有 mkdir 文件锁 + owner.json + 陈旧锁恢复（`kill(pid,0)` 探活 + 锁重命名保留诊断，封顶 32）+ fsync + 目录同步（`learning-session-ledger.ts:1774-1897`）。
- **写后校验**：会话存档写完 4 个产物后重读校验字节/摘要（`agent-conversation-archive.ts:177-228`）。
- **内容寻址 checkpoint**（sha256，`agent-conversation-checkpoints.ts`）。
- **safeStorage 加密密钥** + 不可用时保留旧密文 + 持久化前脱敏（`redactAgentSecretText`）。
- **软删除 tombstone** + **artifact 留存子系统**（Codex 都没做到）。
- **单实例锁**结构上避免多进程竞态（`index.ts:194`）。

---

## 3. 改进候选

> 原始短板集中在「读」这一侧：纯文件无索引、无集中 schema 迁移、JSONL/会话无分段/分区、关键状态无备份。以下候选的最小切片已在 `database` 分支实施；本节保留最初的问题和默认取舍，同时把“已经实现”与“尚未实施”分开记录。

### 3.0 `database` 分支实施审计（2026-07-18；纳入代码提交 `d6a94a1`）

审计范围是 `main..database` 的原有八个数据提交及后续 C-5B `7a1ca7e`、C-5C `e849d51`、C-5D `dee70d6`、C-5E `d6a94a1`；`d6a94a1` 是本次记录的**代码提交**（不是本文档修改后的当前 HEAD）。“已实施”只表示下表所述切片已由相应代码提交实现，并由列出的测试与本次定向验证覆盖，**不把候选中的可选/破坏性扩展误记为完成**。

| 候选 | 当前已实施切片与提交 | 当前代码与测试证据 | 仍未实施或明确留给后续的扩展 |
|---|---|---|---|
| C-1 | `d9de382`：`studiumx-index.sqlite` 可再建 SQLite 投影、checksum migration、analytics 可选 adapter 与文件扫描回退。 | `src/main/local-data-index/index.ts:61-170, 174-333`；`src/main/local-data-index/schema-migration.ts:38-57`；启动/消费在 `src/main/index.ts:259-294`、`src/main/teaching/services/learning-analytics.ts:466-467`。`tests/unit/local-data-index.unit.test.ts:56-396` 覆盖迁移、损坏隔离、source drift 与不写入 canonical；`tests/integration/teaching-analytics.integration.test.ts:277-355` 覆盖回退。 | FTS5/全文检索没有进入切片；SQLite 仍不是事实来源，也没有以它替代详情读取。 |
| C-2 | `d23b272`（C-2A UTC `YYYY/MM` 会话分区）、`549f4f8`（C-2B 50 MiB/月界无损 sealed JSONL）、`07dfbfb`（C-2C 显式摘要投影）。 | 分区读写/扫描：`src/main/teaching-workspace.ts:781-807`、`src/main/teaching-agent-conversations.ts:944-967, 1042-1104`；分段：`src/main/durable-jsonl.ts:4-118, 123-205`、`src/main/learning-work-ledger.ts:61-96`、`src/main/teaching-workspace/lifecycle.ts:158-168`；摘要：`src/main/agent-conversation-summary-projection.ts:46-179, 253-306`。测试：`tests/unit/teaching-agent-conversations.unit.test.ts:261-320`、`tests/unit/durable-jsonl.unit.test.ts:29-128`、`tests/unit/agent-conversation-summary-projection.unit.test.ts:69-302`。 | 物理 retention/删旧月、截断/删除 JSONL、自动摘要/压缩调度均未实施；原 JSON/Markdown/JSONL 继续是 canonical。 |
| C-3 | `ca73537`：settings、workspace registry/index 的保留 `.bak` 与经验证读取恢复。 | `src/main/persistence/durable-file.ts:104-205`；consumer 在 `src/main/teaching-settings.ts`、`src/main/teaching-workspace/activation-lifecycle.ts`、`src/main/teaching-workspace/lifecycle.ts`。`tests/unit/durable-file.unit.test.ts:99-246` 与 `tests/unit/teaching-durable-state.unit.test.ts:37-215`。 | 不做 memory 目录整体备份；恢复不会自动重写健康/损坏 canonical。 |
| C-4 | `ca73537`：共享 private durable replace（temp → file fsync → rename → directory fsync；仅窄 capability error 降级）。 | `src/main/persistence/durable-file.ts:81-103, 214-312`；Memory record writer 在 `src/main/teaching-memory-catalog/record-file.ts`。`tests/unit/durable-file.unit.test.ts:99-205` 覆盖调用顺序、失败清理与权限/I/O fail-closed。 | 高频日志/append-only JSONL 不被强制改成逐条 directory fsync；不支持平台仅按既定 capability 策略降级。 |
| C-5 | `55442ad`：conversation save trace；`7a1ca7e`：C-5B Memory CRUD trace；`e849d51`：C-5C learning-session trace；`dee70d6`：C-5D conversation lifecycle trace；**`d6a94a1`：C-5E conversation audit JSONL trace**。C-5E 仅把既有、由 main 生成的 archive-save trace 关联到 audit sidecar：header 的 optional `traceId` 是 sidecar **首次初始化**的 trace，write-once；entry 的 optional `traceId` 是该行**首次 durable append**时的 trace。 | C-5E：`src/main/agent-conversation-session-audit.ts`。新写 header/entry 仅条件性写入 normalized lowercase UUID，malformed 或 secret-like 值不落盘；header continuation/retry 不覆盖或回填，legacy no-trace/malformed header 不修复。continuation 只让新增 rows 使用新 trace，既有 rows（含无 trace 或历史 malformed trace）不改写。trace 不进入 audit ID/hash/parent/dedupe，audit version 保持 `1`；reader/parser 继续 tolerant。单测：`tests/unit/agent-conversation-session-audit.unit.test.ts`；integration 以 conversation identity/path 而非 JSONL 行序关联 canonical、ledger、lifecycle 与 audit：`tests/integration/trace-propagation.integration.test.ts`。C-5D/C-5C 证据维持原有边界。 | **learning-session ledger、saveAgentConversation lifecycle 子例和 conversation audit JSONL 已从 C-5 remaining queue 移除。**仍未覆盖 fork、其它 lifecycle producers 或其它 user actions；这些写域需另行设计。C-5E 不解决既有 audit read+append concurrency，日志仍是 tagged text，不是 JSON。 |
| C-6 | `26eca18`：Memory 新写入按 scope 的稳定 hash 分区；mixed scoped/flat legacy 读取、重复冲突处理和 descriptor-relative no-follow durable I/O。 | `src/main/teaching-memory-catalog.ts:85-153`、`src/main/teaching-memory-catalog/record-file.ts:204-220`、`src/main/persistence/contained-durable-directory.ts:175-228`。`tests/unit/teaching-memory-catalog.unit.test.ts:58-262` 与 `tests/unit/contained-durable-directory.unit.test.ts:38-183`。 | 首次启动不会搬迁 legacy flat files；受控 copy → checksum → 明确确认后的 legacy 清理仍未实施。 |
| C-7 | `a302814`：所有新持久化 conversation/history projection 经 typed sanitizer；secret-only 内容省略、mixed prose 脱敏、sanitized parent proof，legacy source 不自动重写。 | `src/shared/agent-persisted-history.ts:65-131, 173-336`；archive/index consumers 在 `src/main/agent-conversation-archive.ts`、`src/main/agent-conversation-history.ts`、`src/main/local-data-index/index.ts`。`tests/unit/agent-persisted-history.unit.test.ts:42-277`、`tests/unit/agent-secret-redaction.unit.test.ts:32-219`、`tests/unit/agent-conversation-legacy-nonmutating.unit.test.ts:31-32`。 | 不新增独立 raw history JSONL；不自动扫描、删除或重写历史 raw artifacts。若将来需要历史敏感数据处置，必须单独走安全流程。 |

此前 committed-baseline acceptance evidence（C-5B 在该次运行后加入，现已提交为 `7a1ca7e`；其代码/测试位置已单列，未在该 baseline 中虚报为已由本次命令重跑）：

```bash
# 19 unit files: 129 passed
pnpm exec vitest run --project unit tests/unit/local-data-index.unit.test.ts tests/unit/teaching-agent-conversations.unit.test.ts tests/unit/teaching-workspace-agent-session-tree.unit.test.ts tests/unit/teaching-workspace-item-lifecycle-executor.unit.test.ts tests/unit/durable-jsonl.unit.test.ts tests/unit/agent-conversation-archive-ledger-segments.unit.test.ts tests/unit/learning-work-ledger.unit.test.ts tests/unit/teaching-workspace-lifecycle-jsonl.unit.test.ts tests/unit/durable-file.unit.test.ts tests/unit/teaching-durable-state.unit.test.ts tests/unit/agent-conversation-summary-projection.unit.test.ts tests/unit/contained-durable-directory.unit.test.ts tests/unit/teaching-memory-catalog.unit.test.ts tests/unit/trace-context.unit.test.ts tests/unit/logger.unit.test.ts tests/unit/agent-persisted-history.unit.test.ts tests/unit/agent-secret-redaction.unit.test.ts tests/unit/agent-conversation-history.unit.test.ts tests/unit/agent-conversation-legacy-nonmutating.unit.test.ts

# 2 integration files: 18 passed
pnpm exec vitest run --project integration tests/integration/teaching-analytics.integration.test.ts tests/integration/trace-propagation.integration.test.ts
pnpm run check:learning-work-reconcile
pnpm run check:security
```

C-5D (`dee70d6`) 的验证证据另行记录如下；这些结果只证明已覆盖的 conversation lifecycle 子例，不把 C-1、C-2、C-6 的未完成扩展写成完成：

```bash
# 105 unit files / 761 tests
pnpm run test:unit -- tests/unit/teaching-workspace-lifecycle-jsonl.unit.test.ts

# 1 integration file / 3 tests
pnpm exec vitest run --project integration tests/integration/trace-propagation.integration.test.ts

pnpm run typecheck
pnpm run check:security
git diff --check -- docs/local-data-storage-improvement-roadmap.md docs/plans/local-data-storage-implementation-plan.md
```

C-5E (`d6a94a1`，代码提交) 的验证证据如下；结果只覆盖 conversation audit JSONL trace 子例，**不**宣告 fork、其它 lifecycle producers、其它 user actions、C-2 retention、C-1 FTS/query 或 C-6 controlled migration 已完成：

```bash
# 106 files / 766 tests
pnpm run test:unit -- tests/unit/agent-conversation-session-audit.unit.test.ts

# passed
pnpm run check:agent-conversation-audit-metadata

# 1 file / 4 tests
pnpm exec vitest run --project integration tests/integration/trace-propagation.integration.test.ts

# passed
pnpm run typecheck

# 11 checks passed
pnpm run check:security

# passed
git diff --check
```

### `[x]` C-1 引入 SQLite 作为可查询索引（学 Zcode/Codex） — **P0**

**问题**：会话用「一个 JSON 文件 + `.index.json`」、记忆用「单 `memory/` 平铺目录 + 读时全扫过滤」（`inTeachingMemoryScope`）。列/筛/排序会话、按 tag 查记忆、做学习分析都要 O(n) 目录扫描 + 逐个 parse JSON。项目已有 `learning-analytics` 模块与 workbench 分析视图，正需要查询能力。

**建议方案**：
- 加 `better-sqlite3` 依赖，建 `studiumx-index.sqlite`（放 appDataRoot），作为**只读索引**镜像会话/记忆/用量的元数据（不动 JSON 源文件，避免双写一致性重负）。
- 关键学 Zcode：
  - `schema_migration` 表（id+checksum+app_version+time_applied）——集中、可审计的有序迁移，取代现在散落在各 loader 的 `schemaVersion:1|2` 与一次性 `app-data-migration-plan`。
  - 部分索引 `CREATE INDEX ... WHERE deleted=0`——「最近活跃会话」查询秒出。
  - 可选 FTS5 做会话/记忆全文检索。
- **现在数据还少（`conversations/` 为空），是引入成本最低的窗口。**

**默认值取舍**：索引是否只读镜像（推荐，低风险）还是逐步迁移为事实来源（高风险，需双写）。

### `[x]` C-2 给无界 JSONL 与会话加留存/分区（学 Codex 日期分区 + Zcode 压缩） — **P0**

**问题**：`sessions.jsonl`、`learning-work.jsonl`、每会话 `.jsonl` 审计日志**无任何轮转/截断**；会话是 tombstone 不删文件。这正是 Codex `logs_2.sqlite` 涨到 1.9GB 的同类病。

**建议方案**：
- 会话目录按日期分区：`conversation/YYYY/MM/chat-...json`（Codex 的 `YYYY/MM/DD/` 模式），天然提供「删旧月」修剪边界，避免单目录上千文件拖慢列举与备份。
- JSONL 账本按大小/日期切分 + 留存窗口（日志已有 `purgeOldLogs`，照搬到 ledger）。
- 给 session 元数据加 `time_compacting`（Zcode）——旧会话压缩成摘要投影，原始归档。

**默认值取舍**：分区粒度 `YYYY/MM`（推荐）还是 `YYYY/MM/DD`；JSONL 切分阈值（按大小如 50MB 还是按月）。

### `[x]` C-3 关键状态文件保留 `.bak`（学 Codex `.bak`） — **P1**

**问题**：`studiumx-workspaces.json`（工作区注册表）、记忆索引等无保留备份，损坏=丢失工作区地图。现仅 settings 在损坏时改名 `.invalid-<stamp>`，以及 history-index 替换时的瞬时 `.bak` 交换（不保留）。

**建议方案**：每次原子写关键 JSON 时把上一版 rename 成 `<name>.bak`（保留最近一份）。Codex `.codex-global-state.json.bak` 即此模式，成本极低。

**默认值取舍**：保留几份（1 份推荐）；是否对 memory 目录也做整体 `.bak`（否，记录级 tombstone 已够）。

### `[x]` C-4 统一持久化写入原语（补 fsync 一致性） — **P2**

**问题**：最常用的 `atomicWriteFile`（`lifecycle.ts:166-170`）**无 fsync**，断电后 rename 完成、内核未落盘会丢文件。而 ledger 做对了（`durableAtomicReplaceFile` 带 fsync + 目录同步，`learning-session-ledger.ts:1646-1674`）。**同项目内持久性强弱不一致**是隐患。

**建议方案**：把 `durableAtomicReplaceFile` 抽成共享原语，替换 `lifecycle.ts` 与 `teaching-settings.ts:260-265` 的写入调用。一处改，全局提升。

**默认值取舍**：是否对所有原子写都 fsync（推荐对关键状态文件开启，日志等高频可关）；是否做目录 fsync（推荐，平台拒绝时优雅降级，ledger 已有此降级逻辑）。

### `[x]` C-5 跨存储 traceId + 结构化日志（学 Zcode `trace_id` / 日志 tag） — **P2**

**问题**：会话有 `sessionId`/`branchId`，但日志行（`logger.ts:35` 纯文本）与各 ledger 之间无同一 trace 串起，无法复盘「这次用户操作横跨了哪些存储」。

**建议方案**：
- 每次用户动作/会话生成 `traceId`，写进日志行、ledger 条目、memory、session 元数据（学 Zcode `session.trace_id`）。
- 日志升级为结构化（带 tag 如 `[main][crash-capture]`，学 Zcode）或 JSON，便于 `learning-analytics` 直接消费。

**默认值取舍**：日志格式 JSON（机器友好）还是带 tag 的纯文本（grep 友好，推荐先上 tag+traceId，JSON 留后续）。

### `[x]` C-6 记忆目录按 scope 分区（学 Marvis Knowledgebase / Codex memories） — **P2**

**问题**：所有记忆记录平铺 `<userData>/memory/`，按 workspace/project 路径在内存里过滤。量大后扫描成本线性增长。

**建议方案**：按 workspace 分目录（`memory/<workspaceId>/`），或直接走 C-1 的 SQLite 索引。Marvis 把 Knowledgebase 当一等公民目录、Codex 用独立 `memories_1.sqlite`，均说明「记忆/知识库应独立成区」。

**默认值取舍**：分区（推荐，与现有 workspaceRoot 模型一致）还是仅走 C-1 索引。

### `[x]` C-7 用户输入历史脱敏（学 Codex `history.jsonl` 反面教训） — **P2**

**问题**：Codex `history.jsonl` 实测内含明文 API key 残留。若 StudiumX 未来引入用户输入历史记录，需从设计阶段脱敏。

**建议方案**：任何用户输入历史落盘前过 `redactAgentSecretText`（已存在，`agent-run-persistence.ts`）；密钥类输入不入历史。

---

## 4. 建议取舍顺序

1. 先定 **C-1（SQLite 索引+迁移表）** 与 **C-2（留存/分区）** 的范围——两者趁数据量小落地成本最低，且共同决定后续 schema 演进与留存基线。
2. 再定 **C-3（.bak）** 与 **C-4（fsync 统一）**——基础设施补强，可一次性小切片完成。
3. **C-5/C-6/C-7** 为体验/可观测性增强，可在 C-1 落地后视 `learning-analytics` 需求排期。

> 推进任一候选时，应另起执行计划文档（置于 `docs/plans/`），含 file:line 落点、迁移步骤、最小垂直切片与验收门禁。

---

## 5. 下一迭代队列（仅未实施工作）

1. **C-5 trace 后续设计**：conversation、Memory CRUD、learning-session ledger、`saveAgentConversation()` 的 `agent_conversation_recorded` workspace lifecycle 子例与 conversation audit JSONL 已分别由 `55442ad`、`7a1ca7e`、`e849d51`、`dee70d6`、`d6a94a1` 覆盖。仍需为 **fork、其它 lifecycle producers 与其它 user actions**（需设计）另行定义写域、trusted identity、retry/idempotency 和安全日志边界；不要回写历史 source。
2. **C-2 留存策略的独立安全设计**：如确有磁盘回收需求，先制定 retention、用户可见控制、恢复与审计方案；不得把现有无损分段/摘要投影当作已获准删除事实文件。
3. **C-1 FTS5 或额外查询面**：仅在实际检索需求得到确认后，按可再建、安全 projection 的边界另立切片。
4. **C-6 受控 legacy 搬迁工具**：仅可采用 copy → checksum verify → 用户/运维明确确认 → 删除 legacy 的流程；当前启动路径不搬迁。
