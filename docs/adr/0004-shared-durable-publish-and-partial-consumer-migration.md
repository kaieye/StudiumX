# ADR-0004：共享 durable publish 原语，并只迁移已审查的部分 consumer

- **状态：** 已实施（部分 consumer migration；包含 C-4P6-S1 的受限基础）
- **范围：** C-4、C-4P0、C-4P1、C-4P2A、C-4P2B、C-4P3、C-4P4、C-4P5、C-4P6-S1、C-4P7
- **证据提交：** `ca73537`、`5c0dd96`、`34c48f4`、`b8eb3ab`、`70afe1d`、`99bf6fe`、`f8ad99c`、`278f141`、`7292bf4`、`e02a086`、`0d55fd8`

## 决定

以共享 durable-file capability 承担经过审查的关键文件 replace / publish 语义，并逐项迁移 consumer；每个 consumer 保留自身的 canonical authority、路径约束和错误语义。C-4 的完成含义是“共享原语及下列 consumer 已迁移”，**不是所有 writer 已迁移**，也不构成跨文件事务。

`C-4P6-S1` 已实施的范围仅为 **严格有序发布与受控恢复基础**。它不是完整的 C-4P6；不提供跨文件事务或共同原子性，也不构成完整 durable closure。

## 已迁移 consumer 与验证入口

| 切片 | 已迁移范围 | 主要验证入口 |
| --- | --- | --- |
| C-4P0 `5c0dd96` | canonical `.studiumx/progress.json` review publish | `tests/unit/teaching-workspace-review-durable.unit.test.ts` |
| C-4P1 `34c48f4` | conversation archive canonical JSON / Markdown publish | `tests/unit/agent-conversation-archive-durable.unit.test.ts` |
| C-4P2A `b8eb3ab` | workspace `MISSION.md` | `tests/unit/teaching-workspace-mission-durable.unit.test.ts` |
| C-4P2B `70afe1d` | workspace `assets/lesson.css` | `tests/unit/teaching-workspace-lesson-style-durable.unit.test.ts` |
| C-4P3 `99bf6fe` | cross-workspace change history `history.json` | `tests/unit/teaching-workspace-change-history-durable.unit.test.ts`、`tests/integration/teaching-workspace-change-audit.integration.test.ts` |
| C-4P4 `f8ad99c` | `.agent-sessions/session-open-state.v1.json` sidecar | `tests/unit/agent-conversation-session-tree-durable.unit.test.ts` |
| C-4P5 `278f141` | `TeachingWorkspaceDocuments` allowlisted workspace Markdown | `tests/unit/teaching-workspace-documents-durable.unit.test.ts`、`tests/integration/teaching-workspace-documents.integration.test.ts` |
| C-4P6-S1 `7292bf4`、`e02a086` | learning-outcome 的严格有序 publish、受控 reconcile 与失败关闭基础 | `tests/unit/learning-outcome-committer.unit.test.ts`、`tests/unit/teaching-workspace-outcome-commit.unit.test.ts`；相关提交覆盖 41 项单元检查和 14 项集成检查 |
| C-4P7 `0d55fd8` | private `MusicCookieStore` cookie state | `tests/unit/music-cookie-store-durable.unit.test.ts` |

共享原语和关键状态备份的验证也由 `tests/unit/durable-file.unit.test.ts` 覆盖。

## C-4P6-S1 已实施的受限语义

- 内置 `FileLearningSessionLedger` 在私有实现中复用既有 filesystem writer lock，锁覆盖完整 commit / reconcile 生命周期；公开 `LearningSessionLedger` API 没有扩展。注入的仅加载（load-only）ledger 在任何 canonical write 之前 fail closed：commit 返回可重试的 `temporarily_unavailable`，reconcile 返回 `review_required`。
- 有 record 的严格顺序为：stage → immutable record（不 replace link）→ `outcome.json` → manifest → settlement marker → catalog。无 record 分支仍是 marker-only，不虚构前述 record/projection 写入。
- 可变的 outcome / marker 通过共享 `replaceDurably` 发布，并沿用 directory-fsync capability 的五个允许降级 code：`EINVAL`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EISDIR`。降级 warning 为通用、非敏感信息；不在 allowlist 内的 I/O、open、sync 或 close 错误均为 fatal。
- immutable record 的 link 后 parent-directory 失败、匹配 `EEXIST` 路径以及 stage cleanup 错误均为 fatal；link 成功后不得再用 matching-bytes 抑制错误。canonical record 的 parent / leaf containment 与 symlink 安全检查 fail closed。
- reconcile 以 authority-first 进行：仅有效 immutable record 可以按 `outcome.json` → manifest → marker 的顺序修复缺失 projection，绝不覆盖冲突；不安全或不一致状态返回 `review_required`。authority-first reconcile 不进行 stage cleanup。

上述测试数量只说明该受限 S1 的相关覆盖；**不表示**设计矩阵中的全部 crash/failure 情形、后续 C-4P6 风险或任何未来切片已经消除。

## 明确不包含与后续门槛

- **C-4P6 仍未完整关闭，仍是待办。**S1 未提供跨文件事务或共同原子性、rollback、删除、通用 migration 或新的外部 API。完整 P6 close-out 仍需单独批准并验证 manifest publisher 的 capability-policy 对齐、穷尽的 crash / failure 设计矩阵及运行验证。
- **C-4P8** agent `write_workspace_file` durable publish 未实施；它不是 C-4P5 的 allowlisted document service。
- **C-4P9** session-audit durable append 未实施；C-4P1 没有改变 session audit 的 ordinary append。
- 高频日志不因本 ADR 自动改为逐条 fsync。

这些未完成范围、获批前置条件和 design gate 统一见[本地数据待办](../local-data-todo.md)。
