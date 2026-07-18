# 本地数据存储改进实施计划

> 基线：`database` 分支，审查日期为 2026-07-17。本文把 `docs/local-data-storage-improvement-roadmap.md` 的候选转化为可实施切片；文件与行号以该基线为准，实施前必须重新核对实际代码。
>
> **限定写域（本文档除外由后续实现 owner 执行）：** 本计划不改变事实来源的定义，也不要求修改路线图的勾选状态。实施 PR 必须小而独立，并在开始时以 `git status --short` 和目标文件当前内容为准，不能覆盖并行 agent 的改动。

## 1. 已决定的架构与不可违反的约束

### 1.1 原始实施顺序（保留为计划记录）

```text
C-2A → C-2B → C-1 → C-3 / C-4 → C-2C → C-5 / C-6 / C-7
```

`C-3` 与 `C-4` 可在 C-1 完成后并行，但 C-3 使用的备份语义与 C-4 的耐久写原语必须由同一 owner 对齐；`C-5`、`C-6`、`C-7` 也可并行，前提是各自不改写其他项的深层实现。

### 1.2 事实来源、投影与删除红线

| 类别 | 事实来源（canonical） | 可再建投影 | 禁止事项 |
|---|---|---|---|
| 会话 | workspace 中的会话 JSON、Markdown 与审计 JSONL | SQLite 行、日期分区发现清单、摘要/压缩结果 | 不以 SQLite 或摘要替换、截断、删除原 JSON/Markdown/审计 |
| 学习工作与生命周期 | active `learning-work.jsonl` / `sessions.jsonl` 加其严格 sealed siblings 的有序 JSONL source | SQLite 行、统计、摘要 projection | 不因 retention 或 compaction 删除、截断、重写 raw JSONL；C-2B 仅允许无损 active→sealed rename |
| Memory | `<userData>/memory/**/*.json` | SQLite 行、按 scope 的目录布局 | 不把索引作为唯一可读路径；不自动删除 legacy 文件 |
| 关键状态 | settings、workspace registry、workspace index | `.bak` | `.bak` 绝不成为唯一副本；恢复不应静默覆盖可读 canonical 文件 |

**C-1 的“只读索引”含义：** `studiumx-index.sqlite` 本身会被 indexer 写入，但业务写入不得先写 SQLite 再写文件，也不得把 SQLite 当提交成功的依据。任一投影丢失、损坏或 schema 不支持时，删除/隔离投影并从 JSON/JSONL/Markdown 重建即可。

**C-2 的“留存/压缩”边界：** 本阶段不实施破坏性 retention。C-2B 唯一允许的事实文件变更是 fsync 后的无损 active→sealed JSONL rename；它保留完整 logical source。除此以外，切分后的统计、归档和所有压缩均为带 source hash/byte-range 的**投影**；原 JSON/JSONL/Markdown 继续是读取、恢复和审计的依据。空间回收、物理删除及对用户可见的 retention 开关不在本计划范围内，必须另立安全评审与迁移计划。

### 1.3 通用上线与回滚规则

1. 每一切片先提交可独立运行的测试，再接入生产调用点；不在同一 PR 混入 UI、IPC 大重构或事实文件格式破坏性升级。
2. 新读取路径必须是“投影优先、事实回退”：索引/投影缺失、滞后、校验失败、锁冲突或 SQLite 不可打开时，记录脱敏诊断并回退当前文件读取实现。
3. 除 C-2B 的无损 raw JSONL sealing 外，所有新投影均带 `projectionVersion`、`sourcePath`、`sourceSha256`（或 JSONL `sourceStartByte/sourceEndByte`）、`createdAt`；重跑必须幂等。
4. 上线前对临时 workspace 和至少一个 legacy 布局 workspace 跑迁移演练；任何不认识的数据、重复 id 或 source hash 不一致都应隔离/报错，不能“猜测后修复”。
5. 回滚只允许：停用新 writer/reader、移走或删除**可再建投影**、从 `.bak` 做显式恢复。不得用回滚脚本删除或降级 JSON/JSONL/Markdown 事实来源。

### 1.4 推荐的验证命令基线

所有切片至少运行：

```bash
pnpm run typecheck
pnpm run test:unit -- --runInBand # 若 Vitest 参数不兼容，改为只运行本切片列出的测试文件
pnpm run test:integration
pnpm run build
git diff --check
```

为避免全量 suite 的不确定性掩盖目标错误，每个切片还必须运行其“验收门禁”中的定向 `vitest`/`check:*` 命令。原有流程已经提供 `check:agent-conversation-*`、`check:learning-work-reconcile`、`check:app-data-migration`、`check:security`、`check:analytics` 等门禁，应优先复用而不是复制另一套检查器。


### 1.5 `database` 实施审计（2026-07-18；纳入代码提交 `426eb6e`）

原始顺序已完成最小切片：C-2A `d23b272`、C-2B `549f4f8`、C-1 `d9de382`、C-3/C-4 `ca73537`、C-2C `07dfbfb`、C-7 `a302814`、C-5 `55442ad`、C-6 `26eca18`；后续 C-5B Memory CRUD trace correlation 为 `7a1ca7e`，C-5C learning-session trace 为 `e849d51`，C-5D `saveAgentConversation()` lifecycle trace 为 `dee70d6`，C-5E conversation audit JSONL trace 为 `d6a94a1`，C-5F forked conversation trace 为 `426eb6e`。`426eb6e` 是本次记录的**代码提交**，不是本文档修改后的当前 HEAD。这不是“候选全部完成”的声明：各节仍定义边界；未实现的 FTS、物理 retention/删除、自动摘要调度、C-5 的其它 lifecycle producers 与其它 user actions（需设计），以及 C-6 controlled legacy 搬迁保持未实施。

已纳入代码提交的具体证据：

| 范围 | 当前代码 | 定向 acceptance test |
|---|---|---|
| C-1 | `src/main/local-data-index/index.ts:61-170, 174-333`；`src/main/local-data-index/schema-migration.ts:38-57`；`src/main/index.ts:259-294` | `tests/unit/local-data-index.unit.test.ts:56-396`；`tests/integration/teaching-analytics.integration.test.ts:277-355` |
| C-2A/B/C | `src/main/teaching-workspace.ts:781-807`；`src/main/teaching-agent-conversations.ts:944-967, 1042-1104`；`src/main/durable-jsonl.ts:45-205`；`src/main/agent-conversation-summary-projection.ts:46-179` | `tests/unit/teaching-agent-conversations.unit.test.ts:261-320`；`tests/unit/durable-jsonl.unit.test.ts:29-128`；`tests/unit/agent-conversation-summary-projection.unit.test.ts:69-302` |
| C-3/C-4 | `src/main/persistence/durable-file.ts:81-312` | `tests/unit/durable-file.unit.test.ts:99-246`；`tests/unit/teaching-durable-state.unit.test.ts:37-215` |
| C-5 | conversation slice：`src/main/teaching-workspace.ts:751, 852, 891`；C-5B Memory CRUD：`src/main/teaching-workspace.ts:1771-1793`、`src/main/teaching-memory.ts:20-98`、`src/main/teaching-memory-catalog.ts:277-295`；C-5C `e849d51` learning-session trace：`src/main/teaching-workspace.ts:1685-1724, 1903-1928` → `src/main/lesson-interaction-recorder.ts:95-121` → `src/main/learning-session-ledger.ts:373-390, 851-860, 1059-1091, 2409-2415`；C-5D `dee70d6`：`saveAgentConversation()` 将已有 canonical archive `persistedRecord.traceId` 只透传到紧随其后的 `agent_conversation_recorded` lifecycle event；C-5E `d6a94a1`：`src/main/agent-conversation-session-audit.ts` 仅在新 header/entry 写入时 conditionally 持久化 normalized trace，不改 audit ID/hash/parent/dedupe 或 version `1`；**C-5F `426eb6e`**：`src/main/teaching-workspace.ts` 仅在 main service 为 fork child 新建 trace，`src/main/agent-conversation-session-tree.ts` 将 normalized trace 挂到 child canonical，normal fork 复用该 persisted child trace 到 learning-work/lifecycle。 | conversation：`tests/integration/trace-propagation.integration.test.ts:16-127`；C-5B：`tests/integration/trace-propagation.integration.test.ts:92-134`、`tests/unit/trace-context.unit.test.ts:42-131`；C-5C：`tests/integration/trace-propagation.integration.test.ts:141-230`、`tests/unit/learning-session-ledger.unit.test.ts:385-503`、`tests/unit/teaching-workspace-evidence.unit.test.ts:130-193`、`tests/unit/logger.unit.test.ts:21-43`；C-5D writer normalization/secret non-leak/tolerant reader：`tests/unit/teaching-workspace-lifecycle-jsonl.unit.test.ts:56-95`；C-5E：`tests/unit/agent-conversation-session-audit.unit.test.ts`、`tests/integration/trace-propagation.integration.test.ts`；C-5F：`tests/unit/agent-conversation-session-tree.unit.test.ts`、`tests/unit/agent-conversation-legacy-nonmutating.unit.test.ts`、`tests/integration/trace-propagation.integration.test.ts` |
| C-6 | `src/main/teaching-memory-catalog.ts:85-153`；`src/main/teaching-memory-catalog/record-file.ts:204-220`；`src/main/persistence/contained-durable-directory.ts:175-228` | `tests/unit/teaching-memory-catalog.unit.test.ts:58-262`；`tests/unit/contained-durable-directory.unit.test.ts:38-183` |
| C-7 | `src/shared/agent-persisted-history.ts:65-131, 173-336` | `tests/unit/agent-persisted-history.unit.test.ts:42-277`；`tests/unit/agent-secret-redaction.unit.test.ts:32-219`；`tests/unit/agent-conversation-legacy-nonmutating.unit.test.ts:31-32` |

此前审计已重新运行 committed baseline 的 19 个 unit 文件（129 passed）、2 个 integration 文件（18 passed）、`pnpm run check:learning-work-reconcile` 与 `pnpm run check:security`；C-5B、C-5C 都在那次运行后加入，分别为 `7a1ca7e`、`e849d51`，因此不把它们虚报为上述命令的结果。C-5D 的单独验证为：`pnpm run test:unit -- tests/unit/teaching-workspace-lifecycle-jsonl.unit.test.ts`（105 files / 761 tests）、`pnpm exec vitest run --project integration tests/integration/trace-propagation.integration.test.ts`（1 file / 3 tests）、`pnpm run typecheck`、`pnpm run check:security` 和 `git diff --check -- docs/local-data-storage-improvement-roadmap.md docs/plans/local-data-storage-implementation-plan.md`。完整 baseline 命令记录在路线图第 3.0 节。

---

## 2. C-2A：会话目录日期分区（已实施的最小切片）

### 目标与最小切片

将**新建**会话放到会话根目录下的 `YYYY/MM` 子目录，例如：

```text
conversation/2026/07/chat-20260717-153000-topic.{json,md}
conversations/2026/07/chat-20260717-153000-topic.{json,md}
courses/<course>/conversation/2026/07/chat-...{json,md}
```

日期目录位于既有 `conversation` / `conversations` 根之后；不改变临时会话与课程会话的既有 scope 规则。最小切片只改变**新建路径选择与发现**，不搬迁任何历史会话，不引入删除/retention，不改变 JSON/Markdown 内容结构。

### 文件定位

| 落点 | 当前位置 | 实施职责 |
|---|---|---|
| 会话路径语法、primary path 与 scan roots | `src/shared/agent-conversation-catalog.ts:40-207` | 让 path descriptor 接受“会话根/`YYYY`/`MM`/文件”的严格新语法；保留所有 legacy 两段/课程路径；新增按根递归但深度受限的 scan helper。 |
| id 生成、列表、按 id 读取、重复检测 | `src/main/teaching-agent-conversations.ts:67-134, 308-401` | 新记录的 `relativePath` 使用创建时间选出的日期目录；读取、列表和 collision 检测同时搜索 legacy 与分区路径。 |
| canonical JSON/Markdown 写入、审计及写后校验 | `src/main/agent-conversation-archive.ts:53-153, 156-228` | 沿用 record 已绑定的 `relativePath`，不在 save 时偷偷搬迁旧文件；验证新的成对 JSON/Markdown 路径。 |
| workspace 创建的既有会话根 | `src/main/teaching-workspace/lifecycle.ts:48-94` | 不预建每月目录；由 archive writer 按需 `mkdir`。 |
| 回归测试 | `tests/unit/teaching-agent-conversations.unit.test.ts`、现有 `agent-conversation-*` checks | 覆盖新布局、legacy 混合布局、按 id 定位和重复 id。 |

### 迁移与兼容方案

1. 把路径规则做成显式 parser，不以宽松 glob 接受任意嵌套目录：仅允许会话根后恰好 `YYYY/MM/<canonical-id>.(json|md)`，并校验月份 `01..12`、JSON 与 Markdown basename/id 一致、路径仍在 workspace root 内。
2. 新会话仅在创建 record 时选择日期路径；已存在会话始终尊重存储的 `relativePath`。编辑、分支、重试与 repair 都不得将 legacy 文件移到新目录。
3. scan 顺序为“新布局 + legacy 布局”；以 canonical id 去重。若同一 id 在两个有效位置且内容不同，维持现有“ambiguous/拒绝”语义，绝不自动取较新者。
4. `listPersistedAgentConversationRecords`、course scan、temporary scan、Markdown-to-JSON 映射、审计/工件相对路径都必须使用同一 parser；不得只修列表而让 read/save 走不同路径规则。
5. 不设置自动迁移任务。后续若需要整理旧目录，另做用户可预览、可撤销、copy-verify 后显式确认的工具；它不属于 C-2A。

### 验收门禁

- 新建 root temporary、root teaching、默认课程和 named course 会话时，JSON/Markdown/audit/artifact 都在同一个 `YYYY/MM` 会话子树，且 `readAgentConversationRecord`、列表和 analytics 可读。
- 仅有 legacy 扁平目录、仅有新目录、两者混合三种 fixture 全部可列出；旧路径不会在 read/save 后消失或改变。
- 无效深层路径、跨 id 的 JSON/Markdown、重复 id 仍被拒绝；新的 scan 不得越过 workspace root。
- 定向执行：

```bash
pnpm exec vitest run --project unit tests/unit/teaching-agent-conversations.unit.test.ts
pnpm run check:agent-conversation-catalog
pnpm run check:agent-conversation-state
pnpm run check:agent-conversation-audit-metadata
pnpm run check:analytics
```

### 回滚策略

关闭“新建日期路径”开关/恢复旧 path selector 即可；升级期间已经创建的分区会话仍由兼容 scanner 读取。禁止把已创建的日期目录批量 move 回平铺目录；如必须移除功能，只移除代码路径，保留数据。

---

## 3. C-2B：JSONL 无损分段轮转（已实施的最小切片）

### 当前并行实现与目标

在本计划编写期间，`database` 工作树已有并行 owner 新增 `src/main/durable-jsonl.ts`，并正在把 learning-work、workspace lifecycle 和 token analytics 接到它：

- active 文件达到 **50 MiB** 或跨月时，被 fsync 后 rename 成同目录、严格命名的 `*.sealed-YYYY-MM-NNNNNN.jsonl`；
- 新 append 继续使用原 active basename；读取按 sealed segment 的月/序号，再读取 active；
- `learning-work.jsonl`、`.studiumx/sessions.jsonl` 的相关 writer/reader 已在并行 diff 中调整。

**该实现是 C-2B 的最小垂直切片，应在不推翻该并行改动的前提下完成。** 这里的 canonical JSONL ledger 定义为“所有严格识别的 sealed segments 加当前 active 文件的有序串联”。sealed segment 是原始 JSONL 的无损、字节级 rename 分段，仍是**事实来源**，不是可随意删除的 projection。其目的只是给增长中的 append-only source 提供受控文件边界。

C-2B 不实施任何破坏性 retention：不得删除、截断、重新序列化、gzip 压缩或按窗口清理 active/sealed JSONL。若后续需要摘要、统计或压缩，只能产生带 provenance 的独立 projection，且属于 C-2C/后续工作。

### 文件定位

| 落点 | 当前并行/基线位置 | 实施职责 |
|---|---|---|
| 共享 append、fsync、rotate、discover、read | `src/main/durable-jsonl.ts`（新增，当前未提交） | 保持严格 segment filename、进程内串行、同目录 rename、file/目录同步；不要另建相互竞争的 JSONL projector/rotation helper。 |
| learning-work append、dedupe、读取兼容 | `src/main/learning-work-ledger.ts:10-98`（当前并行修改中） | 使用 `appendDurableJsonlLine`，并导出“所有 active + sealed lines”的读取 seam；entryId 去重必须涵盖全部 segments。 |
| workspace lifecycle append/read | `src/main/teaching-workspace/lifecycle.ts:154-171`（当前并行修改中） | 用同一 helper 替代裸 `appendFile`；新增读取 all-segment lifecycle events 的受控 API。 |
| analytics ledger fallback | `src/main/teaching/services/analytics/token-evidence.ts`（当前并行修改中） | 使用 learning-work 的 all-segment reader，使旧月 usage 不因 rotate 从 analytics 消失。 |
| archive 触发 learning-work 写入 | `src/main/agent-conversation-archive.ts:77-92`（当前并行修改中） | 不改变 archive 中事实 JSON/Markdown/audit 的写入和成功语义。 |
| 测试 | `tests/unit/durable-jsonl.unit.test.ts`（新增，当前未提交）、`tests/unit/learning-work-ledger.unit.test.ts`、`tests/unit/teaching-token-evidence.unit.test.ts` | 扩展边界、失败恢复、跨 segment dedupe 和 legacy fixture。 |

### 迁移与兼容方案

1. **logical source 兼容：** legacy 安装只有 `learning-work.jsonl` / `sessions.jsonl` 时，它就是唯一 active segment，直接可读；第一次达到大小/跨月边界时才无损 rename 成 sealed sibling，下一次 append 创建新的 active basename。不得要求一次性导入、复制或重写旧文件。
2. segment 发现仅接受 `durableJsonlSealedSegmentFileName` 定义的严格 sibling 文件名；`.bak`、不完整 sequence、无效月份、任意手工嵌套文件都不能混入 canonical ledger。读取次序固定为 `(month, sequence)` 的 sealed segments 后 active 文件。
3. append、rotation 和 discover 的失败不能丢行或报告虚假成功：rotate 前先 fsync active，rename 后同步目录；新 active append 使用私有权限和 file sync。目录 fsync 只有明确表示该平台/文件系统不支持该操作的 `EOPNOTSUPP`、`ENOTSUP`、`ENOSYS`、`EINVAL` 或 `EISDIR` 才可降级为继续执行；`EIO`、`EACCES`、`EPERM`、关闭失败及其他任何错误都必须向调用方失败返回，不能伪造成功。`DurableJsonlOptions.syncDirectory` 是异常路径的可注入测试 seam，不是生产绕过开关。进程内并发必须经现有 `pendingOperations` 串行，跨进程策略继续依赖单实例锁；若未来改变此假设，另做锁设计。
4. 所有读取方必须从 all-segment seam 读取，至少包括 learning-work 的 dedupe、analytics fallback 和 lifecycle 的任何 replay/审计读取。禁止只修 writer 后仍只读取 active 文件。
5. C-2B 不将 sealed 文件移到 projection 目录，也不设置 `retentionDays`、大小阈值删除、月度删除或压缩。原始 JSONL 的内容、顺序和 line bytes（除文件名/路径的无损变化）必须保持可审计。

### 验收门禁

- append 到阈值、跨月 append、显式 rotate 三种场景均产出严格命名 sealed sibling；active basename 可在下一 append 后重建；将 sealed + active 按规定顺序串联后，记录序列完整且无丢失/重复。
- 只有旧 active 文件、只有 sealed 文件、两者混合、目录中有伪 segment 文件四种 fixture 都按规则读取；伪 segment 永不进入 source。
- `learning-work` 的 `entryId` 去重和 token analytics 在跨 segment 时仍取最新 conversation snapshot；workspace lifecycle 的 all-segment read 能保留旧月 event。
- rotate/append 文件系统失败时，原 active 或已 sealed source 仍可读；没有删除、truncate 或新的“压缩”写入。对 rotate 前后文件内容做 hash/逐行比较，证实只是无损分段。
- 在完成并行工作前，先合并/协调其 `durable-jsonl` API 与调用点；计划 owner 不得用新的 projector 实现覆盖该 diff。
- 定向执行：

```bash
pnpm exec vitest run --project unit tests/unit/durable-jsonl.unit.test.ts tests/unit/learning-work-ledger.unit.test.ts tests/unit/teaching-token-evidence.unit.test.ts
pnpm run check:learning-work-reconcile
pnpm run check:analytics
pnpm run check:security
```

### 回滚策略

旧版本只会读取 active basename，因此在需要回滚应用前，使用正式 C-2A 导出命令把严格命名的 sealed siblings（按 `(month, sequence)`）和 active 按逻辑读取顺序合并到 legacy active basename：

```bash
pnpm run rollback:learning-work-legacy -- <workspace-root>
```

运行命令前必须完全退出正在写入该 workspace 的新版应用；该手动工具不提供跨进程写锁，不能在并发 append 时安全覆盖 active。命令会拒绝包含非空非法 JSONL 行的 source，记录每个 source 和合并结果的 SHA-256，写入同目录私有临时文件并 file fsync、原子 `rename` 到 `.studiumx/learning-work.jsonl`、目录同步，再重新读取验证输出 checksum。它**绝不删除、改名或截断 sealed files**；成功后旧版本可直接读取 active basename。由于 sealed files 被有意保留，导出后的目录只能用于立即启动旧版（或先恢复导出前 active），不能再次交给 all-segment 新版 reader，否则它会看到 retained sealed source 加已合并 active copy。正常功能回滚只停止后续 rotate，所有新版本仍保留 all-segment reader。绝不能通过删 sealed segments 或把它们当 retention 目标来“回滚”。

---

## 4. C-1：SQLite 可重建只读索引（已实施的最小切片）

### 目标与最小切片

引入位于 `appDataRoot/studiumx-index.sqlite` 的查询投影。第一版只索引：

1. workspace registry 中可见 workspace 的基本元数据；
2. JSON 会话的 id、workspace id、scope、路径、created/updated、branch status、turn/message count 与 usage 摘要；
3. Memory 的 id、scope/workspace id、tags、created/updated/deleted 状态；
4. learning-work JSONL 的 entry id、workspace/conversation id、timestamp 与 usage/evidence 摘要。

第一版不存完整 Markdown、完整 turn 文本、密钥、原始 prompt 或 tool payload；FTS5 不进入最小切片。唯一交付一个 main-process 查询 seam，供 `learning-analytics` 做一个只读、可回退的查询。任何详情打开仍回到原 JSON/Markdown reader。

### 文件定位

| 落点 | 当前位置 | 实施职责 |
|---|---|---|
| appData root、runtime composition、analytics service | `src/main/index.ts:207-260` | 在 services 创建后注入 index service；启动采用“打开/迁移/后台重建”，不可阻塞 app 的可用性。 |
| app-data 迁移既有模式 | `src/main/app-data-migration-plan.ts`（由 `src/main/index.ts:210-213` 调用） | 不把 SQLite schema 伪装成 app-data 文件迁移；可复用诊断/启动时机，schema 由自身 migration table 管理。 |
| 会话枚举与读取 | `src/main/teaching-agent-conversations.ts:67-134, 131-168`、`src/main/agent-conversation-archive.ts:53-92` | 以现有 file reader 构建/增量更新会话投影；archive 成功后 best-effort enqueue，不能反向影响事实写入。 |
| Memory source | `src/main/teaching-memory-catalog.ts:44-148`、`src/main/teaching-memory-catalog/record-file.ts:34-77` | 把 catalog scan 的正常/损坏结果投影为 rows/issue，不改变其文件语义。 |
| learning-work source | `src/main/learning-work-ledger.ts:25-90`、`src/main/durable-jsonl.ts`（C-2B） | 从 canonical active + sealed JSONL source 构建索引；以 entry id 做幂等键。 |
| analytics adapter | `src/main/teaching/services/analytics/token-evidence.ts:135-270`、`src/main/index.ts:256-260` | 只新增可选 query adapter；索引不可用时保留现有扫描 adapter。 |
| 新模块（建议） | `src/main/local-data-index/index-service.ts`、`migrations.ts`、`schema.ts`、`source-scanner.ts`、`query-adapter.ts` | 封装数据库、migrations、索引队列和查询，不把 SQL 散落到 workspace/memory/archive 模块。 |
| 依赖/打包 | `package.json`、`pnpm-lock.yaml`、`electron.vite.config.ts` | 加入 `better-sqlite3` 与开发期类型；验证 Electron ABI rebuild、asar/production package 中原生模块可加载。 |
| 测试 | 新增 `tests/unit/local-data-index*.unit.test.ts`、`tests/integration/local-data-index.integration.test.ts` | 对 migration、重建、退化、查询 parity 测试。 |

### Schema、迁移与兼容方案

1. 建立 `schema_migration(id, checksum, app_version, time_applied)`；migration 在单个 SQLite transaction 中应用。migration 定义放 TypeScript 常量/受版本控制 SQL 字符串，checksum 为构建时稳定 hash；已应用 id 的 checksum 改变必须硬失败并隔离 DB，不得继续运行。
2. 初始表至少包括 `source_file`（path、mtime、size、sha256、scan state）、`conversation_index`、`memory_index`、`learning_work_index`、`index_issue`。所有业务 key 加唯一约束；“最近活跃会话”使用 `WHERE deleted_at IS NULL` 或等价 status 的部分索引。
3. 打开数据库设置 WAL、busy timeout、foreign keys；数据库目录/文件权限按私有 app data 处理。任何 open/migrate/rebuild 错误都只让 index service 进入 `unavailable`，主应用继续以文件方式运行。
4. 首次启动：创建空 schema，后台全量 scan；扫描中查询 adapter 标记 `partial/stale` 并回退文件扫描，不能把部分索引伪装成完整结果。后续启动只按 source fingerprint 增量更新；可提供受限的 developer/recovery command “drop and rebuild index”。
5. 原 JSON、JSONL、Markdown schema 和路径都不因 C-1 改动。SQLite 损坏、旧版 schema、native module 无法加载时，把 `studiumx-index.sqlite{,-wal,-shm}` 隔离到带时间戳目录或删除后重建，保留所有 source files。
6. 先做 query parity（索引结果与现有 scanner 结果比较）并仅用于 analytics 的非破坏性汇总；稳定后再扩展其他查询。FTS5、原文检索、把 SQLite 作为 source of truth、任何双写事务均明确不在本切片。

### 验收门禁

- 空 app data、含 legacy 会话/Memory/JSONL 的 app data、含一条损坏 source 的 app data 均可启动；损坏 source 只生成 issue，不阻止其它 source 入索引。
- 将 SQLite、WAL、SHM 删除后可从事实来源重建，得到相同 id/计数/排序语义；反过来删除某个 projection row 后，业务详情仍由 JSON/Markdown 读取成功。
- migration 重跑幂等；checksum mismatch、迁移中断、DB 锁/损坏时不碰 source，查询明确回退而非返回伪完整空集。
- 对固定 fixture，analytics 的 conversation count、usage 汇总和时间范围与当前 `token-evidence` 文件扫描结果一致；索引 lag 时走旧 adapter。
- 打包后的 Electron 运行环境实际加载 SQLite native binding；不能只在 Node test 环境通过。
- 定向执行：

```bash
pnpm exec vitest run --project unit tests/unit/local-data-index.unit.test.ts
pnpm exec vitest run --project integration tests/integration/local-data-index.integration.test.ts
pnpm run check:analytics
pnpm run check:app-data-migration
pnpm run build
```

### 回滚策略

移除 index service 的注入或将其 feature flag 设为 off，恢复现有 file scanners；隔离/删除 `studiumx-index.sqlite*` 仅会丢弃投影。不要为“恢复一致性”回写任何 JSON、JSONL 或 Markdown。

---

## 5. C-3：关键状态 `.bak`（已实施的最小切片）

### 目标与最小切片

对以下小型、可整体替换的关键 JSON 保留**最近一份已验证旧版本**：

```text
<userData>/studiumx-settings.json
<userData>/studiumx-workspaces.json
<workspaceRoot>/.studiumx/index.json
```

不对 Memory 目录做整体备份、不对每条 Memory record 自动复制 `.bak`，也不对 JSONL/会话 archive 做 `.bak`。最小切片实现 `target.bak` 的单份轮换、显式 recovery helper 与三类文件的接入。

### 文件定位

| 落点 | 当前位置 | 实施职责 |
|---|---|---|
| settings 保存与 `.invalid-<stamp>` 恢复 | `src/main/teaching-settings.ts:10-265` | 以 private mode 写入 canonical 和 `.bak`；canonical 无法解析/验证时才尝试有效 `.bak`，并记录恢复原因。 |
| workspace registry 保存/读取 | `src/main/teaching-workspace/activation-lifecycle.ts:249-272` | 为 `studiumx-workspaces.json` 接入备份及 schema-validated recovery；不能把任意 `.bak` 当 registry。 |
| workspace index 保存/legacy fallback | `src/main/teaching-workspace/lifecycle.ts:124-171` | 新 canonical `.studiumx/index.json` 使用备份；继续只读兼容 legacy `.teachos/index.json`。 |
| 新共享 helper（可先由 C-4 提供） | `src/main/persistence/durable-file.ts` | `replaceWithBackup`、`readValidatedWithBackup`，接受 parser/validator 而非裸 JSON。 |
| 测试 | `tests/unit/teaching-settings-schema.unit.test.ts`、`tests/unit/teaching-workspace-activation-lifecycle.unit.test.ts`、新增 persistence tests | 覆盖正常写、旧/坏 canonical、坏 backup、权限。 |

### 迁移与兼容方案

1. 首次写入前若 target 不存在，不创建空 `.bak`；已有 target 时先将其内容复制到私有临时 backup、fsync/校验后原子发布 `target.bak`，再发布新的 canonical。旧 `.bak` 只被新的“已验证旧 canonical”替换。
2. `.bak` 的 file mode 与原文件一致（settings/registry 至少 `0600`）；settings backup 中的密文仍由 `safeStorage` 管理，日志不输出其内容或路径以外的敏感信息。
3. 读取顺序：canonical parse + domain validation 成功即返回；canonical 不存在/损坏才 parse + validation `.bak`；backup 也失败时维持现有空/default/`.invalid-<stamp>` 语义并保留诊断。不得静默用 `.bak` 覆盖仍可读 canonical。
4. 不主动为历史文件生成 backup，不自动从 legacy `.teachos/index.json` 复制为 `.bak`。第一次后续 canonical 成功写入才建立 backup。

### 验收门禁

- 连续两次写入后 `.bak` 等于前一份**通过验证**的 canonical，新 canonical 等于第二次内容；不存在 target 的首次写无伪 backup。
- 分别破坏 canonical、backup、两者，验证三种恢复路径，且未损坏的文件不被改写。
- settings backup 仍以私有权限存在，包含密文时可通过原 settings loader 解密；registry/index 的 legacy fallback 未回归。
- 模拟 backup publish/new canonical publish 前后的失败，保证至少存在最后一个已验证副本，失败不会让 helper 报告虚假成功。
- 定向执行：

```bash
pnpm exec vitest run --project unit tests/unit/teaching-settings-schema.unit.test.ts tests/unit/teaching-workspace-activation-lifecycle.unit.test.ts tests/unit/durable-file.unit.test.ts
pnpm run check:settings-secret-storage
pnpm run check:security
```

### 回滚策略

停止使用 backup helper 后 canonical 文件仍是原格式、旧版仍可读。若线上 canonical 损坏，运维/用户通过明确的 recovery 命令复制经验证的 `.bak` 到 canonical，并保留损坏文件为 `.invalid-<stamp>`；绝不自动覆盖。

---

## 6. C-4：统一耐久原子写原语（已实施的最小切片）

### 目标与最小切片

把 `learning-session-ledger.ts` 已验证的 temp write → file fsync → rename → directory fsync（平台不支持时优雅降级）抽到一个窄共享原语。先替换关键小 JSON 的 `atomicWriteFile`，再替换 settings/Memory record writer；高频日志与 append-only JSONL 不强行改为逐条 directory fsync。

### 文件定位

| 落点 | 当前位置 | 实施职责 |
|---|---|---|
| 现有无 fsync 原子写 | `src/main/teaching-workspace/lifecycle.ts:154-171` | 保留 `atomicWriteFile` API 或改为 thin wrapper，调用新的关键状态模式。 |
| 已有耐久实现 | `src/main/learning-session-ledger.ts:1646-1674`（及相邻 fsync/目录同步代码） | 提取经过测试的语义，ledger 的锁、owner/recovery 逻辑仍留在 ledger 模块。 |
| settings 写入 | `src/main/teaching-settings.ts:260-265` | 采用 private durable replace，保留现有 `.invalid` 行为。 |
| Memory record 原子替换 | `src/main/teaching-memory-catalog/record-file.ts:56-77` | 改为共享原语但维持 legacy filename 清理、canonical naming 与 tombstone 语义。 |
| registry/index consumers | `src/main/teaching-workspace/activation-lifecycle.ts:270-272`、`src/main/teaching-workspace/lifecycle.ts:154-171` | 使用 `durable: true`/关键状态 wrapper。 |
| 新模块与测试 | `src/main/persistence/durable-file.ts`、`tests/unit/durable-file.unit.test.ts` | 注入 fs adapter 来模拟失败、rename、directory sync。 |

### 迁移与兼容方案

1. API 以明确 options 区分 `durable` 与 `bestEffort`，默认不悄悄让日志等高频路径付出 fsync 成本；关键状态默认 `durable: true`。所有临时文件维持私有 mode、随机名、同目录创建，保证 rename 不跨文件系统。
2. **C-4 决策（目录 fsync 错误策略）：**共享原语刻意采用 durable JSONL 已建立的窄 capability-error 策略，而不是要求复用 ledger 的“精确 errno 列表”。仅当目录 fsync 失败码为 `EOPNOTSUPP`、`ENOTSUP`、`ENOSYS`、`EINVAL` 或 `EISDIR` 时，才可视为平台/文件系统不具备该能力，降级并记录一次脱敏 warn。`EACCES`、`EPERM`、`EIO`、close 失败和所有未知错误都必须向调用方失败返回，绝不能报告耐久写入成功。这样替换此前宽泛的“按 ledger 的现有 allowlist”表述是安全的：settings、registry 和 index 都是关键状态，权限失败尤其不能被误报为已耐久落盘。
3. 先保留旧 `atomicWriteFile` 导出以避免大面积并行改动；每个 consumer 单独迁移并在测试中证明字节、权限、legacy cleanup 与错误语义未变。
4. C-3 的 `replaceWithBackup` 建在该原语之上，不能复制两套 fsync/rename 代码。

### 验收门禁

- 成功路径的临时文件被清理、目标字节正确、目标目录已同步（可由注入 adapter 断言调用顺序）。
- write/fsync/rename/dir-sync 的失败路径无临时文件泄漏；不支持 directory sync 仅在 allowlist 场景降级。
- lifecycle index、settings、registry、Memory record 的现有测试和 legacy-file cleanup 全部通过；learning-session ledger 的锁恢复与 durability tests 无回归。
- 定向执行：

```bash
pnpm exec vitest run --project unit tests/unit/durable-file.unit.test.ts tests/unit/teaching-memory-catalog.unit.test.ts tests/unit/teaching-workspace-activation-lifecycle.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-session-ledger.integration.test.ts tests/integration/learning-session-ledger-process.integration.test.ts
pnpm run check:learning-session-ledger
```

### 回滚策略

由于 API/文件格式保持不变，可逐 consumer 恢复到旧 `atomicWriteFile`（只在确认需要时）。不得回滚 ledger 自己的已存在 durability/locking 机制；任何残留 temp 文件由启动恢复清理，不删除 canonical 文件。

---

## 7. C-2C：旧会话摘要/压缩投影（已实施的显式投影切片）

### 目标与最小切片

为满足“旧会话可快速概览”创建确定性摘要投影，而不是压缩或改写会话事实。第一版只对显式选择的、已归档/用户确认的会话生成：

```text
<workspace>/.studiumx/conversation-projections/<conversation-id>.summary.json
```

该文件应有 `projectionVersion`、source JSON/Markdown relative paths、两者 exact-byte SHA-256、`timeCompacting`（仅 metadata）、结构化 counts、标题和经过脱敏/长度限制的固定模板摘要。第一版不接入自动 LLM 摘要，不从 UI 自动批量执行，不用摘要替换 reader 的 turn 数据。

**C-2C 已批准的收敛边界（实现必须逐条保持）：**

1. C-2C **不是 audit rotation/retention**。绝不删除、rotate、truncate、gzip、compress 或重写 canonical conversation JSON、Markdown、audit JSONL 或任何 ledger；audit 也不是 summary 的 source provenance。
2. writer 只接受调用方显式提供的 per-call canonical id 列表；不从 save/archive/startup 路径调用，不 backfill，不扫描后批量生成，也不做其它 bulk filesystem action。显式 command 本身代表用户确认。ID-only command 使用 main-process 的有界 canonical resolver：只检查固定 non-course bases 的 flat candidate，以及从 timestamp-bearing canonical id 推导的 UTC month（含相邻月边界）candidate；绝不接受 renderer path 或调用 collection scanner。无法由此受信规则定位的 legacy/course id 返回 not-found，而完整 canonical reader 仍保留既有 discovery/duplicate semantics，故 C-2C 不弱化 reader。
3. 只有已 archived、非 deleted、非 temporary 的 canonical conversation 可生成。`timeCompacting` 仅是 derived metadata，永远不是删除 raw turns、Markdown、audit 或 ledger 的 authority。
4. v1 recipe 严格且确定：从已验证 canonical JSON 仅导出**已脱敏且有界的 title**和 `{ total, user, assistant }` turn counts，使用固定 `conversation-summary-v1` 模板；不得持久化 turn body、tool args/results、source text、audit content、artifact payload 或任意 LLM output。所有 derived strings 均先 redaction 再 bound。
5. JSON 与 Markdown 必须通过 identity-stable contained regular-file bounded read 读取 exact bytes，并在 allocation、parse 与 hash 之前应用明确 size limit；严格验证 canonical id、relative path、同目录 sibling 和 C-2B flat/UTC `YYYY/MM` layout；projection 持有两份 exact-byte SHA-256。`.studiumx` 与 `.studiumx/conversation-projections` 必须是 root-contained non-symlink directories，writer 才可经 same-directory durable atomic 0600 replacement 发布。native writer 必须以 `openat`/`mkdirat`/`renameat` 相对已持有 descriptor 工作：candidate file `fsync` 后 rename，再 `fsync` output directory；**首次创建**上述任一目录时，还必须 `fsync` 其 containing parent directory entry。所有 directory `fsync` 只允许项目既有的 downgrade-only unsupported-error policy（`EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR`）降级为 warning；其它错误必须失败，且 rename 成功后不得删除最终文件。candidate 与最终 projection 保持 private `0600`。projection 原始文档必须逐字节等于 v1 canonical serialization（因此 duplicate JSON key、whitespace/order 或任意 noncanonical edit 均 invalid）；source drift 才为 stale。projection 缺失、损坏、version/path/hash 不合法、被篡改或 source drift 时只返回 non-current，绝不阻碍 canonical reader；显式重新生成必须能够恢复。
6. C-2C 不改 SQLite schema/index；`replaceDurably(..., mode: 0o600)` 是唯一 derived write。它是可选、可 rebuild 的 **host-built POSIX** native capability；当前不承诺 cross-arch/cross-target artifact。Windows 在安全的 handle-relative implementation 存在前明确不可用，command 必须返回 `rejected: unsupported_platform`（native addon 缺失/无法加载则 `rejected: native_unavailable`），绝不降级到 pathname traversal；canonical conversation 行为不受影响。
7. 安全回归保留 source/static 的 descriptor-relative `openat`/`renameat` proof 与“绑定 output descriptor 后、创建 temp 前”父目录 symlink swap 测试。刻意**不**加入 rename-boundary production test hook：这会在敏感发布边界增加不必要的 production seam；descriptor-relative static proof 加上已有 deterministic pre-temp swap 已覆盖该设计不变量。

### 文件定位

| 落点 | 当前位置 | 实施职责 |
|---|---|---|
| 会话事实读取/相对路径验证 | `src/main/teaching-agent-conversations.ts:106-168, 308-430` | 只读加载 canonical record，验证 id/path 后交给 projector。 |
| archive 的 content/hash verification | `src/main/agent-conversation-archive.ts:53-228` | 复用读取/校验理念；不能把 summary 写入 archive success path。 |
| 类型 | `src/shared/teaching-types/agent.ts` | 新增独立 `AgentConversationSummaryProjection`，不把 compaction 字段塞进事实 record 的必填 schema。 |
| 新模块 | `src/main/agent-conversation-summary-projection.ts` | 构建、校验、读、rebuild；所有输出先经 secret redaction。 |
| C-1 index | `src/main/local-data-index/*` | 可索引 projection 状态与 source hash，但 index 丢失不能影响 summary/事实读取。 |
| 测试 | 新增 `tests/unit/agent-conversation-summary-projection.unit.test.ts`、扩展 conversation integration fixture | 覆盖 source drift、删除投影与敏感文本。 |

### 迁移与兼容方案

1. 不为历史会话批量生成摘要；只接受明确 command/maintenance job 的 id 列表，并逐条验证 record、branch status、source paths 与 source hashes。
2. source 有变动时，旧 projection 标为 `stale`，读取方必须回退完整会话或要求重新生成；不得显示旧摘要为当前事实。
3. 删除/隔离 summary 文件后可由事实会话完全重建；旧版本忽略 `.studiumx/conversation-projections/`。
4. “time compacting”只存在 projection metadata/SQLite row，不作为删除 raw turn、Markdown 或 audit 的许可。任何未来物理 archive/retention 方案必须另立 RFC。

### 验收门禁

- 生成 summary 前后原 JSON、Markdown、audit 的 hash 与 mtime 不变；删除 summary 后可从会话重建。
- source 修改、id/path 不匹配、摘要输出含 redaction pattern 时，summary 标为 stale/失败，原会话仍可读取。
- full conversation reader、replay、analytics 继续从完整事实 record 得到相同 turns/counts；summary 只能作为可选 overview。
- 定向执行：

```bash
pnpm run test:unit -- tests/unit/agent-conversation-summary-projection.unit.test.ts tests/unit/teaching-agent-conversations.unit.test.ts
pnpm run check:agent-conversation-state
pnpm run check:agent-conversation-audit-metadata
pnpm run check:security
pnpm run typecheck
pnpm run build
pnpm run dist:dir
```

`test:unit` 的 pre-hook 会先恢复 Node host 的 `better-sqlite3`，再 build native addon；不要用 direct `pnpm exec vitest` 绕过它。`dist`/`dist:dir` 同样先 host-build addon，随后遵循既有 `better-sqlite3` Electron rebuild workflow。打包仅允许当前 host platform 与 architecture，显式跨目标/跨架构请求会失败而不会复制 stale host artifact。

### 回滚策略

关闭 summary command/reader，删除 `.studiumx/conversation-projections/` 或隔离其中损坏文件即可。不得把任何 summary 反写到 conversation JSON/Markdown，也不得把“已 compacted”当作清理 raw 数据的条件。

---

## 8. C-5：跨存储 traceId 与可解析结构化日志（conversation、Memory、learning-session、conversation lifecycle、conversation audit JSONL 与 forked conversation 已有切片）

### 目标与最小切片

采用保持 grep 友好的 tagged text 格式，而不是立即切到 JSON 日志。traceId 是 main-process 生成、规范 UUID 的 opaque correlation metadata；不来自 renderer、不用于授权或 scope 判定，也不携带用户输入。每个已批准的写域只在其可信边界建立 trace，并把它写入其新产生的 canonical 事实记录和安全 tagged log；不回写历史 source。

C-5D 不扩大这一语义：workspace lifecycle 的 trace 只是 optional correlation metadata，**不是** lifecycle identity、dedupe、query 或 filter key。它不新建第二个 UUID，不新增 renderer/IPC 字段，也不新增 lifecycle logger tag。

### 当前实现状态（2026-07-18；代码提交 `426eb6e` 纳入 C-5F）

`426eb6e` 是本节记录的 C-5F **代码提交**，不是本文档修改后的当前 HEAD。

已实现并有代码/测试证据的范围：

1. **Conversation（55442ad）**：TeachingWorkspaceService.saveAgentConversation() 每次调用只在 main 进程内生成一个 randomUUID()；trace 写入新/更新 canonical conversation JSON，并传入同次 learning-work JSONL snapshot。相同 entryId 的重试只有 trace 相等（或双方都缺失 legacy trace）时可去重；不同 trace 在覆盖 canonical 文件前失败。
2. **Memory CRUD（7a1ca7e）**：createMemory、updateMemory、deleteMemory 各在 main 进程生成 UUID，只通过内部 Memory store mutation options 传递；record normalizer 只保留规范 UUID，logger 使用固定 memory-catalog safe tag。renderer IPC payload 没有 trace 字段。
3. **Learning-session（e849d51，C-5C）**：受信 preview Lesson interaction 在 main 的 TeachingWorkspaceService.previewInteractionEvent() 中才生成 randomUUID()，并按 **Teaching Workspace → LessonInteractionRecorder → LearningSessionLedger.appendWithReceipt() → canonical event file** 传递。renderer intent 不能提交 traceId。两个不同可信 preview event 获得不同 trace。
4. **C-5D conversation lifecycle（dee70d6）**：只在 saveAgentConversation() 将已有、main-generated canonical conversation archive 的 persistedRecord.traceId 透传至紧随其后的 agent_conversation_recorded workspace lifecycle JSONL event。不会新建 trace，也不会使 trace 参与 lifecycle identity/dedupe/query/filter。C-5F 已另行覆盖 fork；其它 lifecycle producers 仍在后续队列。
5. **C-5D writer/reader boundary**：appendWorkspaceLifecycleEvent() 先从输入 event 剥离 raw trace，再调用 normalizeTraceId，仅在结果为合法 UUID 时条件性写回；持久化 UUID 一律 lowercase。malformed 或 secret-like value 不写入 JSONL。reader 不收紧：legacy trace-free row 与历史 malformed-trace lifecycle row 均继续 tolerant read；不做迁移、扫描回写或历史修复。
6. **精确重试与 trace-aware idempotency（C-5C）**：trusted binding 的 recordedInteractions 以 eventId 缓存完整 intent、event 和 trace；同一 trusted eventId 的完全相同重试复用原 trace，而变更 intent 被拒绝。ledger duplicate 比较除 event 内容外还要求 trace 匹配：对已有 canonical traced event，same eventId 的 missing、malformed 或不同 trace 都不能静默去重；新 append 输入的 malformed trace 会先归一化为省略，所以 legacy trace-free event（包括归一化后 trace-free 的 exact retry）仍保持兼容。
7. **日志时机与内容（C-5C）**：LessonInteractionRecorder 的唯一 durable write 是 appendWithReceipt。只有它成功返回、且 receipt 不为 duplicate 时，Teaching Workspace 才以 fixed safe context [main] [learning-session-ledger] [trace=<uuid>] 调用 logger，固定文案为 **Learning Session event persisted.**；不记录 lesson 内容。C-5D 不新增 lifecycle logger tag 或日志行。
8. **C-5E conversation audit JSONL（d6a94a1）**：`AgentConversationSessionAuditHeader.traceId` 是 audit sidecar **首次初始化 archive-save trace**，仅在首次写 header 时写入，因而 write-once；后续 continuation 或 exact retry 不覆盖、不回填。legacy no-trace header 与历史 malformed header 继续原样保留，不修复。每个新 audit entry 的 `traceId` 是该 entry **首次 durable append**时的 main-generated archive-save trace：continuation 的新增 rows 使用本次新 trace，既有 rows 保持既有 trace（包括无 trace 或历史 malformed trace）。新写入只接受 normalized lowercase UUID；malformed/secret-like trace 不落盘。trace 不参与 audit ID、hash、parent 或 dedupe；audit version 仍为 `1`，reader/parser 继续 tolerant。此切片不解决既有 audit read+append concurrency。
9. **C-5F forked conversation（426eb6e）**：每次 fork child 的 trace 只在 main `TeachingWorkspaceService.forkAgentConversationBranch()` 生成新的 UUID，并仅经内部 helper 传入；child 不继承 parent/source trace，不从 IPC/renderer 获取，不复用 `replayId`，也不另造 lifecycle-only trace。returned persisted child record 的同一 trace 写入 child canonical record、normal fork 的 learning-work snapshot 与 managed workspace 的 `agent_conversation_recorded` lifecycle event。trace 只是 correlation metadata，不参与 child identity、replay/turn IDs、forkPoint、source digest、branch lineage/revision/dedupe、learning-work `entryId` 或 lifecycle ID。legacy source fork 继续跳过 shared learning-work ledger；source canonical JSON、Markdown、audit 与 shared ledger 不迁移、不回填、不重写，保持 bytes。global fork 保持既有边界，仍不写 workspace lifecycle。

仍未包含：**其它 lifecycle producers 与其它 user actions（需设计）**。这些不是把现有 trace helper 接到 callsite 即可完成的工作；必须另行设计 trusted identity、写入边界、精确 retry/idempotency、legacy compatibility 和安全日志语义。C-5 的 remaining queue 已移除 learning-session ledger、saveAgentConversation() lifecycle 子例、conversation audit JSONL 与 fork lifecycle trace；这不代表全量 trace 覆盖。

建议日志兼容格式：

```text
2026-07-18T...Z [info] [main] [learning-session-ledger] [trace=<uuid>] Learning Session event persisted.

```

### 文件定位

| 落点 | 已实施职责 | 证据 |
|---|---|---|
| conversation archive 与 C-5D lifecycle handoff | src/main/teaching-workspace.ts:751-903：main-only conversation trace 持久化后，将 persistedRecord.traceId 传给紧随其后的 agent_conversation_recorded event；不创建第二 UUID，不改 renderer/IPC。 | tests/integration/trace-propagation.integration.test.ts:77-127：按 conversation identity/path 关联 canonical conversation、learning-work ledger、agent-archive log、lifecycle event；验证同 trace 且并发不串线。 |
| workspace lifecycle JSONL writer/reader | src/main/teaching-workspace/lifecycle.ts:40-46, 158-172：trace 只是 optional metadata；writer strip raw trace → normalize → conditionally reinstate lowercase UUID；reader 对 historical trace-free/malformed row tolerant read。 | tests/unit/teaching-workspace-lifecycle-jsonl.unit.test.ts:56-95：uppercase 归一化、secret-like trace 不泄漏、legacy 和历史 malformed row 可读。 |
| trusted preview interaction 与 trace 生命周期（C-5C） | src/main/teaching-workspace.ts:1685-1724, 1903-1928：main-only UUID、trusted eventId cache、exact retry reuse；append 成功且非 duplicate 后写 fixed safe tagged log。 | tests/integration/trace-propagation.integration.test.ts:141-230；tests/unit/teaching-workspace-evidence.unit.test.ts:130-193。 |
| interaction recorder（C-5C） | src/main/lesson-interaction-recorder.ts:18-24, 95-121：只从 main mutation options 接 trace，封装进 appendWithReceipt 的 canonical event。 | 上述 integration test 验证 workspace → recorder → ledger；workspace evidence unit test 验证 serial retry。 |
| canonical learning-session ledger/type（C-5C） | src/shared/teaching-types/learning-session.ts:74-84；src/main/learning-session-ledger.ts:373-390, 851-860, 1059-1091, 2409-2415：optional canonical UUID field、legacy read、persisted malformed rejection 和 trace-aware duplicate comparison。 | tests/unit/learning-session-ledger.unit.test.ts:385-503。 |
| safe tagged logger（C-5C） | src/main/logger.ts:8-28, 55-100, 203-280：fixed tag vocabulary、UUID normalization、redaction/single-line/bound 和 legacy/tagged parser。 | tests/unit/logger.unit.test.ts:21-43；C-5C integration 断言 two non-duplicate events only have two fixed tagged lines。 |
| conversation audit JSONL（C-5E） | `src/main/agent-conversation-session-audit.ts`：header 仅在 sidecar 首次创建时 conditionally 写入 normalized trace；每轮 append 只给新 entry 写入本轮 normalized trace，不重写历史 header/rows。trace 不改变 audit ID/hash/parent/dedupe，version 保持 `1`，parser 保持 tolerant。 | `tests/unit/agent-conversation-session-audit.unit.test.ts` 覆盖 initial/retry/continuation、legacy/malformed 原字节不回填与 secret-like 拒绝；`tests/integration/trace-propagation.integration.test.ts` 按 conversation identity/path（非 JSONL 行序）关联 audit 与其它 sink。 |
| forked conversation（C-5F） | `src/main/teaching-workspace.ts` 在 main service 为每个 fork child 生成独立 UUID，并将 returned persisted `record.traceId` 透传给 managed workspace lifecycle；`src/main/agent-conversation-session-tree.ts` 仅接收/normalize 并挂载该 correlation metadata，不改变 fork identity 或 lineage。normal fork 通过既有 archive 写入 learning-work；legacy fork 仍跳过 shared ledger，global fork 仍不写 lifecycle。 | `tests/unit/agent-conversation-session-tree.unit.test.ts` 覆盖 UUID normalization、child 不继承 parent 与 lineage/replay 不变；`tests/unit/agent-conversation-legacy-nonmutating.unit.test.ts` 覆盖 legacy source artifacts/shared ledger 的 Buffer bytes 不变；integration 以 path/identity 关联 child canonical、ledger 和 lifecycle。 |

### 迁移与兼容方案

1. traceId 必须为 main 生成的 UUID/随机 opaque id；不得使用 workspace path、用户内容、provider request id 或 secret 派生。Learning-session renderer intent 不接受此字段；C-5D 也不新增 renderer/IPC 字段。
2. 新字段是 optional：legacy conversation、learning-work、Memory、learning-session event 与 workspace lifecycle event 缺 trace 时继续读取；不扫描、迁移或重写历史 JSON/JSONL/event 文件。
3. C-5D lifecycle writer 绝不把 raw trace 直接 spread 回 durable JSONL：先剥离，再只 conditionally reinstate normalized UUID；合法 UUID lowercase，malformed/secret-like 值省略。历史已持久化 malformed lifecycle trace 仍按 tolerant reader 返回，而不是因新 writer contract 改为拒绝或回写。
4. C-5D/C-5F trace 不改变 lifecycle identity、dedupe、query 或 filter 语义；C-5F 也不改变 fork child identity、replay/turn IDs、forkPoint、source digest、branch lineage/revision/dedupe 或 learning-work `entryId`。C-5E audit trace 同样不参与 audit ID/hash/parent/dedupe；仅其它 lifecycle producers 和其它 user actions 仍须单独设计。
5. new-write seam 只持久化规范 UUID。C-5E audit header/entry 只在 normalizeTraceId 返回 lowercase UUID 时条件性写入；历史 no-trace/malformed header 或 entry 继续 tolerant read 且永不迁移、修复、回填或重写。对于 C-5C persisted learning-session event，存在但 malformed 的 trace 是损坏而非“当作缺失的 legacy 字段”，必须 fail closed，且不改写原字节。
6. C-5F child trace 仅由 main service 新建，绝不从 IPC/renderer 传入、不继承 parent/source、也不复用 replayId 或新建 lifecycle-only trace。legacy source fork 不触发 source JSON/Markdown/audit/shared ledger 的迁移、回填或重写；global fork 保持不写 workspace lifecycle。
7. message、tag、error 和 metadata 进入日志前走 fixed safe vocabulary、UUID normalization、redactAgentSecretText、单行化和长度上限。日志保持 tagged text，JSON logging 仍是未来单独决策；C-5D/C-5F 不新增 lifecycle logger tag。

### 验收门禁

- C-5D integration 按 conversation identity/path 而非 append-only JSONL 顺序关联 canonical conversation、learning-work ledger、agent-archive log 与 agent_conversation_recorded lifecycle event；每一条链的 trace 相同，并发保存不串线。
- C-5D unit 验证 uppercase UUID 持久化为 lowercase，malformed/secret-like trace 不泄漏到 JSONL，legacy trace-free 与历史 malformed-trace lifecycle row 保持 tolerant read。
- C-5D 验证证据：

```bash
# 105 unit files / 761 tests
pnpm run test:unit -- tests/unit/teaching-workspace-lifecycle-jsonl.unit.test.ts

# 1 integration file / 3 tests
pnpm exec vitest run --project integration tests/integration/trace-propagation.integration.test.ts

pnpm run typecheck
pnpm run check:security
git diff --check -- docs/local-data-storage-improvement-roadmap.md docs/plans/local-data-storage-implementation-plan.md
```

- C-5E (`d6a94a1`，代码提交) 验证证据：

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

- C-5E acceptance：初次 archive-save 的 header 和 initial entries 共享该次 trace；改变当前 trace 的 exact retry 不新增/重写行；continuation 仅给新 rows 写入新 trace，header 与旧 rows 保持原值。测试以 ID/identity 映射，不依赖 JSONL 行序。
- C-5F (`426eb6e`，代码提交) 验证证据：

```bash
# 106 files / 766 tests passed
pnpm run test:unit -- tests/unit/agent-conversation-session-tree.unit.test.ts tests/unit/agent-conversation-legacy-nonmutating.unit.test.ts

# 1 file / 5 tests passed
pnpm exec vitest run --project integration tests/integration/trace-propagation.integration.test.ts

# passed
pnpm run typecheck

# 11 checks passed
pnpm run check:security

# passed
pnpm run check:agent-conversation-audit-metadata

# passed
git diff --check
```

- C-5F acceptance：normal managed fork 的 child canonical、learning-work snapshot 与按 child archive paths/identity 关联的 `agent_conversation_recorded` lifecycle event 共享 returned persisted child trace，且 child trace 与 parent 不同；legacy source artifacts/shared ledger 的 bytes 不变，global fork 不新增 lifecycle。关联断言不依赖 JSONL 行序。
- C-5C acceptance 保持：独立受信 preview event 生成不同 main-only UUID，并能在 canonical learning-session event 和 [main] [learning-session-ledger] tagged log 中对应；日志不含 lesson 内容。
- 同一 trusted eventId 的并发/串行 exact retry 只留下一个 durable event、复用同一 trace，并返回 duplicate；不额外写固定成功日志。改变 intent 不得静默去重；对已有 canonical traced event，missing/mismatched/malformed trace 的 replay 不得静默去重；新 append 输入归一化为 trace-free 后的 legacy exact retry 继续兼容。
- legacy trace-free learning-session event 继续可读/精确 retry；persisted malformed learning-session trace 加载时以 corrupt event 拒绝且不重写。

### 回滚策略

停止将 persistedRecord.traceId 传入新的 saveAgentConversation() lifecycle event，停止在其他新写域创建/传递 trace，并停止对应 C-5C tagged log；C-5E 回滚只停止对新 audit header/entry 写入 trace，绝不删除、回填、修复或重写既有 audit JSONL。C-5F 回滚只停止为新 fork child 创建/传递 trace，绝不修改 child/parent identity、replay/lineage、legacy source artifacts 或 shared ledger。旧 lifecycle/audit reader 与其它 reader 忽略 optional trace 的存在，不得删除日志、重写 JSONL，或为了移除 trace 修改既有 canonical event。已持久化 malformed lifecycle trace 继续 tolerant read；已持久化 malformed C-5C learning-session trace 仍按 corrupt data 处理而不是静默降级为 legacy。

---

## 9. C-6：Memory 按 scope 分区（已实施的最小切片）

### 目标与最小切片

将**新写入**的 Memory record 放在稳定、经过校验的 scope 目录内，例如：

```text
<userData>/memory/_global/memory-<encoded-id>.json
<userData>/memory/workspace-<encoded-workspace-id>/memory-<encoded-id>.json
```

目录名必须由内部 scope key 编码生成，不能直接拼接 workspace path/name。最小切片只让新 record 选择分区路径，读取同时支持 flat legacy 与分区布局；不自动搬迁/删除 legacy record。

### 文件定位

| 落点 | 当前位置 | 实施职责 |
|---|---|---|
| catalog access、全目录 scan、scope filter/recovery issues | `src/main/teaching-memory-catalog.ts:44-148, 192+` | 将 scan 改为可控遍历 flat + 一层 scope dir，保持 `inTeachingMemoryScope` 为最终授权判断。 |
| record filename/path/replace | `src/main/teaching-memory-catalog/record-file.ts:16-77` | 新增 `teachingMemoryScopeDirectory`、scoped path、legacy fallback；复用 C-4 durable write。 |
| Memory façade | `src/main/teaching-memory.ts:34-40` | 提供 record scope 给 catalog，避免由调用者传任意路径。 |
| 索引 | `src/main/local-data-index/*` | 把 scope directory 当来源定位信息，不以目录替代 record 内 access validation。 |
| 测试 | `tests/unit/teaching-memory-catalog.unit.test.ts`、新增 migration/duplicate fixture | 验证 access、legacy 与 scoped read。 |

### 迁移与兼容方案

1. 从已验证的 record scope 计算目录；缺失/全局 scope 用固定 `_global`。scope id 必须编码并限制字符集，写前仍做 root containment 检查。
2. `get(id)` 先按新计算路径读取，再 fallback flat legacy；`list` 枚举 flat 和已知 scope directories 后按 id 去重。若同 id 两处内容 hash 不同，报告 recovery issue 并拒绝歧义，而不是挑一个覆盖另一个。
3. 不在首次启动移动旧文件。可选的后续维护命令必须 copy → checksum verify → 显式确认后才删除 legacy；该删除步骤不在 C-6 最小切片。
4. C-1 index 仅可优化“候选文件在哪里”，权限/scope 判断仍由 catalog 对事实 record 执行。
5. C-6 的 scan、read 和 durable write 必须通过已绑定的目录 descriptor 进行：POSIX 使用 `openat`/`O_NOFOLLOW` 与 descriptor-relative rename；Windows 或 native capability 缺失时 catalog 必须 fail closed，不能退回 pathname preflight + `readFile`/replace。
6. 配置的 memory-root pathname 是仅由 main process 持有的可信 application-configuration boundary，绝不接受 renderer 路径。main wrapper 必须只对其**已存在的 parent** 做一次 `realpath` canonicalization，并把 physical absolute parent 与安全的 final root basename 交给 native；canonicalization 失败必须 fail closed，绝不 fallback 到 logical pathname。故允许该可信 parent 之上的 OS intermediate symlink（例如 macOS `/var -> /private/var`）在 capability binding 前被解析；但 final root、scope partition 和 record file 仍必须全程以 descriptor-relative `O_NOFOLLOW` 操作，保持 no-follow 与 pathname-swap resistance。首次 `mkdirat` final root 后仍须 `fsync` 已绑定 parent。

### 验收门禁

- 新 global/workspace Memory 均写到正确分区；跨 scope recall 不能因目录结构泄漏内容。
- flat legacy、分区新记录、混合目录和重复 id fixture 的 get/list/delete/tombstone 语义保持正确。
- 扫描不会跟随 symlink 或任意深层目录，且不会越过 `<userData>/memory`。
- 定向执行：

```bash
pnpm exec vitest run --project unit tests/unit/teaching-memory-catalog.unit.test.ts tests/unit/durable-file.unit.test.ts
pnpm run check:memory-capture
pnpm run check:security
```

### 回滚策略

恢复只写 flat layout 时，reader 仍保留对已写 scope directories 的兼容扫描；不批量 move/delete 分区文件。必要时丢弃 SQLite 的位置索引并从 Memory JSON 重建。

---

## 10. C-7：用户输入历史脱敏（已实施的最小切片）

### 目标与最小切片

把所有会落盘的用户输入/历史文本统一经过 `redactAgentSecretText`，并对密钥型输入采用“不写入 history”的策略。当前最直接的事实写入链是会话 turns 到 JSON/Markdown/audit/learning-work；最小切片在这条链上完成 redaction contract，随后才允许新增独立 history 文件。

### 文件定位

| 落点 | 当前位置 | 实施职责 |
|---|---|---|
| 现有 secret redactor | `src/shared/agent-secret-redaction.ts` | 保持单一 redaction 规则与测试 fixture；新增规则必须有 false-positive/false-negative 测试。 |
| turn 清洗与持久化前内容 | `src/shared/agent-conversation-turns.ts`、`src/main/teaching-agent-conversations.ts:26, 401+` | 让 persisted user turn/content/preview 通过统一 history sanitizer；不要只在 renderer 显示层脱敏。 |
| archive JSON/Markdown/audit/learning-work | `src/main/agent-conversation-archive.ts:74-92`、`src/main/learning-work-ledger/evidence-snapshot.ts`、`src/main/agent-conversation-session-audit.ts` | 确保派生产物不能绕过同一 sanitizer，尤其是摘要、错误、tool preview 与 audit metadata。 |
| 已有安全先例 | `src/main/ai/agent-run-persistence.ts:5, 152, 540+` | 复用其“落盘前 redaction”的模式，不复制不同正则。 |
| 测试/安全检查 | `tests/unit/agent-conversation-history.unit.test.ts`、`tests/unit/agent-conversation-runner.unit.test.ts`、新增 persistence fixture | 注入真实形态的 API key/token/Authorization 值。 |

### 迁移与兼容方案

1. 定义一个 typed `sanitizePersistedUserHistory` seam：返回 `redacted` 文本或 `omit` 决策；secret-only/credential-form input 不产生 history entry，混合文本保留安全上下文并替换 secret。
2. 在**写入前**调用，不依赖事后扫描，也不允许 caller 传 `alreadyRedacted` 绕过。JSON、Markdown、JSONL、日志和 SQLite index 都只能消费 sanitizer 后字段。
3. 不自动重写历史会话/ledger/Markdown，因为那会改变事实与审计证据。启动时可做仅报告的风险扫描（只记录路径、类别、hash，不记录命中 secret）；历史发现的处理需单独的安全事件/用户确认流程。
4. 新独立 `history.jsonl` 或等价功能在有该 seam、测试和 review 前不得添加；如果未来添加，默认私有权限、append 前 redaction、无 raw secret 回退。

### C-7 实施决策（2026-07-18）

- `src/shared/agent-persisted-history.ts` 是唯一 typed boundary。它没有 `alreadyRedacted` 或 caller bypass：mixed text 保留上下文并替换 credential；`redactAgentSecretText` 还会在任意 prose 中识别 JWT 与未知的 32+ 高熵 credential-like value。redactor 异常、非字符串结果和不确定的独立高风险 token 均 fail-closed。
- secret-only user turn 保留原 turn `id`、role、timestamp、排序和 `messageCount`，但 content 固定为 `[sensitive user input omitted]`。这保持 session/analytics 的结构性不变量，同时不留下可检索的原 credential。secret-only title 统一为 `Conversation`；title 必须先脱敏再截断/slugify，因此新 conversation id、路径及 workspace session event 不会留下 token 前缀。
- provider confirmation 可以在 save 前对**原始 transient turns**做校验，但该 raw digest 不得写入 canonical record、stage 或任何 durable metadata。持久化 recovery 只接受 `parentTurnProof`：它是 SHA-256 over canonical JSON of the **sanitized** prefix（turn order、id、role、content、timestamp、tool/process fields 以及除 proof 自身外的 parent-relevant metadata）。proof 的 preimage 不含 raw credential；legacy `parentTurnDigest`-only marker 永不结算，必须安全重试/显式处理。
- archive JSON/Markdown、audit JSONL/artifacts、learning-work ledger/evidence、history index、SQLite projection、child transcript、tool/process event 和 safe diagnostics 均只写安全 projection。SQLite/history rebuild 可读取 legacy raw archive 以重建派生文件，但绝不改写源 archive bytes，也不执行自动历史扫描、删除或 rewrite。
- Legacy branch policy：fork 可从内存中的 sanitized projection 创建新 child，但 source JSON、Markdown、per-conversation audit 与既有 shared ledger 均不改写；为保持 ledger bytes，legacy fork child 不会追加 shared learning-work ledger。legacy same-status repair 是 no-op；实际 status transition 明确失败并要求显式 migration。正常 C-7 branch 继续使用完整 archive/audit/ledger lifecycle。

### 验收门禁

- 使用 API key、Bearer token、典型 provider credential、JWT 和未知 32+ 高熵 mixed-prose token 的 fixture：所有新生成的 conversation JSON、Markdown、audit、learning-work projection、workspace session event、child/tool artifact、日志、SQLite row 均不含原始 secret。
- secret-only input 不生成可检索 history；普通输入仍保留可用会话语义和 analytics counts。
- redactor 异常/未知高风险模式采取 fail-closed（omit history + 安全诊断），不能把原文写盘。
- legacy fork/status/repair 的 source JSON、Markdown、audit 与 ledger 保持字节不变；仅报告扫描不会将原 secret 再写到日志或 issue 文件。
- 定向执行：

```bash
pnpm exec vitest run --project unit tests/unit/agent-conversation-history.unit.test.ts tests/unit/agent-conversation-runner.unit.test.ts tests/unit/agent-secret-redaction.unit.test.ts
pnpm run check:security
pnpm run check:provider-privacy
```

### 回滚策略

保留 sanitizer 的读取兼容；若新规则误伤，回滚规则或改为 `omit`，而不是恢复/重写已被安全脱敏的落盘文本。任何历史明文处理均走独立安全流程，不由普通功能回滚脚本处理。

---

## 11. 阶段交接清单（后续扩展适用）

每个切片合入前，owner 必须在 PR 描述中回答以下问题：

- [ ] 是否只新增/更新可再建 projection，或若写事实文件，是否保持其既有格式和 canonical 地位？
- [ ] 是否证明 legacy 布局仍可读，且新旧混合不会产生静默去重/覆盖？
- [ ] 是否把 source hash、byte range 或等价 provenance 写入投影并测试重建？
- [ ] 是否在 SQLite/投影/backup 失败时回退或明确失败，而没有修改事实来源？
- [ ] 是否运行本计划规定的定向门禁、`typecheck`、`build`、`git diff --check`？
- [ ] 是否只触及该切片宣告的写域，并已复查并行 agent 的 diff，避免撤销其改动？

满足以上清单后，按本计划的固定顺序推进下一项；任何想加入物理 retention、迁移 SQLite 为事实来源、自动搬迁 legacy 文件或删除 raw 会话/JSONL 的需求，均应停止在此计划外并先提交新的 ADR/RFC。
