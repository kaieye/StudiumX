# ADR-0045：Write rewind journal（本轮工具写入撤销）

- **状态：** 已实施
- **日期：** 2026-07-21
- **范围：** `write_workspace_file` 首次触碰 pre-image 日志、main 恢复 API、与会话前缀检查点分离的 UI 文案
- **相关：** [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0044](0044-tool-contract-and-write-policy.md)、Slice D write rewind（已结项）

## 背景

教学 agent 经 `write_workspace_file` 写入工作区文本后，需要一条 **git-free**、按 **单次 agent run** 边界的撤销路径，以便 UI「撤销本轮写入」回滚本轮首次触碰的路径。该能力必须：

- 与 **conversation prefix checkpoint**（恢复对话轮次）在 API `kind` 与 UI 文案上严格区分；
- 不削弱既有 durable publish、Windows direct-path、no-clobber / restricted-overwrite、operation journal / idempotency；
- 不跟踪未声明的外部副作用（无 shell / MCP 副作用面）。

## 决策

### 1. Pre-image journal（run 作用域）

- 路径：`.studiumx/checkpoints/<sanitizedRunId>/write-journal.jsonl`（`sanitizeRunId` 仅保留安全字符并截断）。
- 捕获时机：`write_workspace_file` 在 **permission grant 与目标校验之后、durable publish 之前** 首次触碰相对路径时写入一条 entry。
- 幂等：同一 `runId` 下同一 `relativePath` 只记 **first-touch**；后续同路径写入复用首条 pre-image。
- Entry（v1）含：`runId`、`relativePath`、`capturedAt`、`existed`、`preImageUtf8`（存在则为 UTF-8 文本快照）、`writtenContentSha256`、`bytes`。
- Journal 失败 **不得** 阻断 durable publication。
- 大文件 pre-image 有上限；超出则跳过该路径的可恢复快照（restore 侧记 `missing_pre_image` / skip）。

### 2. Restore 语义

- `restoreWriteRewindJournal` 按 journal **逆序** 恢复：
  - 写入前已存在：写回 `preImageUtf8`；
  - 写入前不存在（create）：仅当当前内容 SHA-256 仍等于 `writtenContentSha256` 时删除；内容已变则 `content_changed_since_write` 跳过。
- 结果区分 `restored` / `deleted` / `skipped`；IPC 结果 `kind: 'tool_write_rewind'`（列表为 `tool_write_rewind_journal`）。
- **不是** LearningSession / conversation 轮次恢复；**不是** git checkout。

### 3. IPC / UI

| 通道 | 作用 |
| --- | --- |
| `teach:restore-agent-write-rewind` | 按 `workspaceId` + `runId` 撤销本轮工具写入 |
| `teach:list-agent-write-rewind-journal` | 只读列出 journal 元数据（无 pre-image 正文） |

- UI：`AgentArchivedHistoryPanel` 提供「**撤销本轮写入**」按钮；与「**创建检查点**」并列，文案与 tooltip 明确二者边界。
- `lastAgentRunId` 为可选 prop：有 runId 才可点撤销；宿主未挂载时 IPC 仍可用。

### 4. 不变量

- 保持 effect lattice、workspace containment、protected-path / lesson-html 拒绝、文本类型与字节上限。
- 不引入 shell、MCP、产品级 FTS，也不把 journal 当作 ledger 权威。
- run 与 LearningSession 仍分离（ADR-0021）；rewind 只作用于文件 pre-image。

## 已实施范围与验证入口

- `src/main/ai/tools/write-rewind-journal.ts`
- `src/main/ai/tools/workspace.ts`（capture 挂钩）
- `TeachingWorkspaceService.restoreAgentWriteRewind` / `listAgentWriteRewindJournal`
- shared types / IPC contract / commands / gateway / preload
- `AgentArchivedHistoryPanel` 撤销按钮与区分文案

```bash
pnpm exec vitest run --project unit tests/unit/write-rewind-journal.unit.test.ts
pnpm exec vitest run --project unit tests/unit/workspace-write-tool.unit.test.ts
```

## 不包含 / non-claims

- 不恢复会话前缀、消息轮次或 LearningSession 状态（那是 conversation checkpoint）。
- 不跟踪 `write_workspace_file` 以外的工具副作用，也不跟踪进程外/人工编辑。
- 不保证 crash/power-loss 下 journal 完整性；journal 是 best-effort 教学可撤销性，不是 C-4 durability 扩展。
- 不自动在所有主对话视图挂载归档面板；宿主传入 `lastAgentRunId` 的装配可后续增量完成。
- 不把 checkpoint 目录当作通用 VCS 或跨 run 合并历史。
