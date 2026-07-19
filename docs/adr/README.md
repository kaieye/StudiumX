# 本地数据 ADR 索引

本目录记录已在 `database` 分支实施、且有代码、测试和 Git 提交证据的本地数据架构决定。ADR（Architecture Decision Record，架构决策记录）说明系统为什么采用某项重要做法、已经落地到什么范围，以及它**没有**授权做什么。

## 先从这里读

- 想快速了解现状：阅读下方的“已实施决定”表。
- 想知道某项做法的原因、边界和测试入口：打开对应 ADR。
- 想知道接下来还准备做什么：阅读[本地数据待办](../local-data-todo.md)。它记录未完成范围及待批准的后续工作；其中不应被视为已实现功能，除非相应条目明确标明已实施的受限切片。
- 下一步工作必须遵循：待办页 → 对应 design gate 获得 scope / owner / API 批准 → 单独立项实施；design gate 本身不授权直接修改 writer。
- 想研究未完成工作的详细方案：从待办页进入 `docs/plans/` 中对应的 design gate。

## 按问题查阅

| 你关心的问题 | 建议先读 |
| --- | --- |
| SQLite 分析索引损坏后能否隔离、重建或回退读取 | ADR-0001 |
| canonical teaching data 的永久保留边界，以及 logical JSONL 如何分区、分段和生成会话摘要 | ADR-0002 |
| 关键 JSON 不可读时如何从 `.bak` 验证恢复 | ADR-0003 |
| 哪些 writer 已使用 durable publish，以及 learning-outcome S1、workspace descriptor S1 / internal create-no-overwrite S2、session-audit P9-S2 已实施到哪里 | ADR-0004、[本地数据待办](../local-data-todo.md) |
| 已覆盖持久化链如何关联 trace，同时保持日志安全 | ADR-0005 |
| Memory 数据如何按范围隔离，以及能否迁移旧数据 | ADR-0006 |
| 新持久化 conversation/history 如何先经脱敏 | ADR-0007 |
| 哪些本地数据能力仍未完成 | [本地数据待办](../local-data-todo.md) |

## 已实施决定

| ADR | 主题 | 已实施范围 |
| --- | --- | --- |
| [ADR-0001](0001-rebuildable-sqlite-projection.md) | C-1 可重建 SQLite projection 与 no-FTS 边界 | SQLite 仅作为可再建 analytics 投影并保留 canonical 文件回退；FTS、查询/搜索面与 query-facing corpus 均未获授权。 |
| [ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md) | C-2 canonical 永久保留、分区、分段与摘要 projection | canonical teaching data 永久保留；UTC 月分区、无损 sealed JSONL 分段和显式会话摘要 projection 已实施。physical retention / recovery 未获批准；相邻 agent-artifact 年龄/大小删除路径已移除。 |
| [ADR-0003](0003-critical-json-backups-and-verified-recovery.md) | C-3 关键 JSON 备份与恢复 | `.bak` 备份及 verified read recovery。 |
| [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) | C-4 durable publish | 共享 durable publish 原语及已迁移的部分 consumer；包含 C-4P6-S1 的严格有序 publish 与受控恢复基础、C-4P8-S1 workspace descriptor foundation、C-4P8-S2 internal descriptor-bound atomic `createNoOverwrite` foundation，以及 C-4P9-S2 固定 session-audit 文件的专用 durable append。C-4P6、C-4P8 与完整 C-4P9 均未关闭；P8-S2 未迁移 `write_workspace_file`、不支持 overwrite，且 Linux host-native 验证仍未关闭；P9-S2 不代表 generic JSONL migration、跨文件 transaction、ledger/save-order 改造或 IPC/UI。 |
| [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md) | C-5 trace correlation | main 生成的 trace correlation 与安全日志边界。 |
| [ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md) | C-6 Memory | scope 分区及 aggregate-only readonly migration preflight。 |
| [ADR-0007](0007-persisted-user-history-redaction.md) | C-7 历史数据脱敏 | 新持久化 conversation/history projection 的脱敏边界。 |

## C-4P8 S1/S2 证据与实际验证入口

ADR-0004 记录的 C-4P8 已实施范围是 **S1 与仅 internal 的 S2 foundation**，不是 P8 complete 或 workspace tool durable-write migration。

- **S1：**`80f2fd0`（`feat(data): add workspace descriptor foundation`）与 `e2ce36c`（`test(data): cover workspace descriptor foundation`）保留既有 descriptor-bound root / traversal / final-leaf inspection 证据。
- **S2：**`b46c8b2`（`feat(data): add workspace create no-overwrite`）与 `bdcd6cb`（`test(data): cover workspace create no-overwrite`）实现 internal descriptor-bound atomic `createNoOverwrite` foundation：same-parent-descriptor exclusive rename、existing final 的 internal `target_exists`、无 primitive 时 fail closed；没有 hardlink、`linkat`、pathname fallback 或 ordinary rename fallback。

本轮在当前 **macOS host-built addon** 实际执行的 S2 定向验证如下：三个 unit 文件共 **60 tests**，外加 workspace-tool、path-target、security、build、typecheck 和 diff 检查；这不是完整 suite 的声明。

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit tests/unit/contained-durable-directory.unit.test.ts tests/unit/workspace-contained-directory.unit.test.ts tests/unit/workspace-contained-create-no-overwrite.unit.test.ts
pnpm run check:workspace-write-tool
node scripts/check-workspace-path-target.mjs
pnpm run typecheck
pnpm run check:security
git diff --check
```

Linux `renameat2(..., RENAME_NOREPLACE)` 的 host-native 行为本轮没有真实验证；仓库没有 `.github` CI 目录。因此 Linux validation 仍是后续验收，不能声称跨平台完成。S3 restricted overwrite 和 S4 handler/API integration 均未实施、未批准；`write_workspace_file` 仍完全未接入，现有 handler 不变且不支持 overwrite。

## C-4P9-S2 证据与实际验证入口

ADR-0004 记录的 C-4P9 已实施范围**仅为 S2**：固定 `.agent-sessions/<conversation-id>.jsonl` 的 audit 专用 framed、legacy-compatible、fixed-file durable append。证据提交为 `4b30220`（`feat(data): add durable session audit append`）和 `5f47382`（`test(data): cover durable session audit append`）；已实际执行：

```sh
pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts
pnpm run typecheck
pnpm run check:security
git diff --check
```

这不是完整 suite，也不关闭 C-4P9；不应推断 generic JSONL migration、跨文件 transaction、ledger authority/save-order 改造、repair、rotation 或 IPC/UI 已交付。

## 维护约定

- 已实施且会长期影响架构的决定，新增一份编号递增的 ADR；不要为了记录小进度而新建 ADR。
- 已实施决定的范围、边界或验证入口变化时，更新对应 ADR；未完成范围、前置条件和实施顺序变化时，更新[本地数据待办](../local-data-todo.md)及其 design gate。不要把后者的内容提前记为 ADR 已实施事实，也不要把 ADR 的受限切片扩大为完整 closure。
- ADR 中的 Git 提交 hash 是验证线索。若合并主线时使用 rebase 或 squash 导致 hash 改变，应将其更新为主线中可追溯的提交或合并记录。
- ADR 记录的是已获采纳的决定；尚未批准的建议、设计门和实施顺序统一维护在[本地数据待办](../local-data-todo.md)。
