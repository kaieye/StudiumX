# ADR-0052：可选 Runtime Session Store（仅设计；未实施）

- **状态：** Proposed / **未实施**（DB-OPT-6 设计 gate only）
- **日期：** 2026-07-21
- **范围：** 高 churn 运行时会话中间态的 **可选 disposable SQLite 缓存** 形状、硬门槛与 non-claims
- **相关：** [ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0040](0040-teaching-session-protocol-facade.md)、[`database-authority-model.md`](../improvements/database-authority-model.md)、[`database-p2-boundaries.md`](../improvements/database-p2-boundaries.md)（**DB-P2-3**）、[`database-roadmap.md`](../improvements/database-roadmap.md)（DB-OPT-6）

## 背景

Agent turn / resume picker 在大 workspace 上可能对会话元数据产生高频读。现有 LocalDataIndex 已把 **列表 metadata** 做成优选读路径，但 **运行时 turn 中间态**（未 durable 的 staging、stream 进度、局部 tool 结果缓冲）仍在进程内存。ZCode 将 CLI 会话 store 放在 SQLite；若直接照搬，容易滑向「会话正文写权威迁库」——这正是 **DB-P2-3 won't-do** 所拒绝的。

本 ADR **只**授权讨论一个 **可选 runtime 缓存** 的形状与验收门槛；**不**授权 schema、writer、IPC 或产品面实现。

## 决定（设计层）

### 1. 允许讨论的形状

| 层 | 角色 | 是否写权威 |
| --- | --- | --- |
| Conversation JSON / Markdown 文件 | export / resume / 审计的 durable 真相 | **是** |
| LearningSession / Evidence / Memory 文件 | 教学真相 | **是** |
| 可选 `runtime-session` disposable SQLite | 高 churn 中间态 **缓存** | **否** |
| LocalDataIndex analytics projection | list/analytics 优选读 | **否**（与 runtime store 正交） |

可选 runtime store 可以缓存例如：

- 当前 run 的非敏感进度计数（iteration、toolCalls、durationMs）
- 已 durable 会话 id 的热路径索引指针（指向 **文件路径相对路径**，非正文）
- 进程重启后的「最近打开」hints（可丢）

### 2. 硬门槛（任一项违反则不得实现）

1. **Turn 成功路径的 durable 写仍是文件**（JSON / Markdown / ledger）。库写入失败 **不得** 使 turn 主成功路径失败（best-effort），也 **不得** 成为唯一持久化。
2. **删除 canonical 会话文件后**，runtime SQLite 中任何行 **不得** 被视为可恢复的会话正文或 teaching evidence。
3. **不得** 存 raw prompt、完整 tool arguments、API key、未脱敏绝对路径、token stream 全量 delta。
4. **不得** 用本 ADR 覆盖 DB-P2-3：本 ADR 讨论的是 **缓存**，不是「SQLite 为主、文件仅导出」。
5. 实现前须有：故障矩阵（进程杀、双写偏序、export 一致性）、验收闸 Gate 1–6 证据、独立 PR（不可与 analytics FTS / 写权威迁库同批混入）。
6. 默认关闭；开启需显式 settings / 实验 flag，且可一键删除库文件而不影响业务主路径。

### 3. 与 DB-P2-3 / LocalDataIndex 的边界

| 主题 | 本 ADR | DB-P2-3 |
| --- | --- | --- |
| 会话 **正文** 主写权威 | 仍文件 | 拒绝迁 SQLite |
| 列表 metadata projection | 已有 LocalDataIndex（ADR-0001） | 允许优选读 |
| Runtime 中间态缓存 | **可议**（本 ADR） | 不禁止缓存；禁止写权威 |

LocalDataIndex **不是** runtime session store：前者 rebuildable analytics；后者若实现应是 **独立文件**（例如 `runtime-session.sqlite`），避免 analytics 损坏与 runtime 锁耦合。

### 4. 双写 / 一致性（设计矩阵，非实现）

| 场景 | 期望 |
| --- | --- |
| 文件写成功、runtime 写失败 | turn 成功；下次从文件重建 hints |
| runtime 写成功、文件写失败 | turn **失败** 或按现有 durable 语义回滚；runtime 行可丢弃 |
| 删除库文件 | 产品主路径可用；仅丢 hints/缓存 |
| 删除会话文件 | resume **不得** 仅凭 runtime 行复活正文 |
| export / support-bundle | 默认不夹带 runtime 库正文；可报告「存在 / 可丢」 |

### 5. 非目标

- 不实现 schema / migration / IPC / UI
- 不把 workflow_run 树、Memory content、LearningSession ledger 迁入 runtime store
- 不在 analytics 同一库启用 FTS / 向量

### 6. 开启条件（实现另案）

满足全部条件后可开 **独立实现 ADR/PR**：

1. 可复现的性能证据（多 workspace 冷启动 / resume 列表路径测量）
2. 上述故障矩阵的自动化测试计划
3. Gate 1–6 与 DB-P2-3 审查签字
4. 明确 retention：库可随时 purge；无教学永久保留承诺

## 后果

- **正向**：产品与工程可讨论 runtime 性能而不误读为「会话 SoT 迁库」。
- **负向 / 约束**：在实现 PR 合并前，代码库 **不得** 出现 runtime session store 的生产 schema 或写路径。
- **文档**：`database-roadmap.md` DB-OPT-6 = 设计完成；实现状态仍为未授权。

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-21 | 初版：DB-OPT-6 设计 only；明确与 DB-P2-3 拆分 |
