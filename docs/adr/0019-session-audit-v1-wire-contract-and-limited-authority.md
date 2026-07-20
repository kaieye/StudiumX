# ADR-0019：Session-audit V1 wire contract 与有限 authority

- **状态：** 已实施（audit 专用 V1 wire / identity / exact-retry append；fixed-file C-4P9 scope 已按 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 结项；不授权 generic JSONL 或其它扩张）
- **范围：** per-conversation session audit JSONL 的 V1 header/entry contract、identity 与 ordering、exact-retry missing-row append、有限 authority 边界
- **证据提交：** `4b30220`、`d6a94a1`；后续 S3…S45 为 tests-only historical evidence（见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)）

## 决定

每个 conversation 在与 Markdown 同目录的 `.agent-sessions/<conversation-id>.jsonl` 维护一份 **append-only** session audit 证据文件。它随既有 conversation placement（含 legacy flat / UTC 目录），不是全局 audit 文件，也不是 learning-work ledger 的替代。

### V1 wire 与 identity

- 文件为 UTF-8 JSON Lines；新写入 row 由 `JSON.stringify()` 产生并以 `\n` 结束。
- Header：`type: "session"`、`version: 1`、稳定 conversation `id`、title、`createdAt`、`conversationRelativePath`，可选 `workspaceId` / `traceId`。
- Entry 基字段：`type`、`id`、`parentId`、`timestamp`，以及按类型附加的 turn/tool/metadata 字段；当前 entry 类型包括 `turn`、`tool_call`、`source`、`child_run`、`compaction`、`context_hygiene`、`context_estimate`、`tool_result_diagnostic`、`run_usage`。
- 新写入的 correlation 使用规范化后的 main-owned `traceId`；非法 trace 省略而非原样落盘。Identity 比较将 trace 状态与 canonical body 分开：同 ID 的 body/type/trace-state 冲突 fail closed，既有字节不改写。
- Reader 继续 **legacy-tolerant**：空行、非 JSON、非对象、malformed/unknown row 被保留浏览时可跳过，但**不获得** canonical identity，也不得触发 rewrite/backfill/normalize/repair。

### Exact-retry 与有限 authority

一次 archive save 以该次已 sanitize 的 conversation record 可生成的完整 canonical row 集合为输入。Append 在一个 descriptor 生命周期内精确读取既有 bytes，识别已有 canonical identity，**仅 append 缺失 row**；若旧尾部缺少换行，可先补一个换行再追加，但既有 payload bytes 不被重写。

Session audit 的 authority 是有限的：

- 它是 conversation session 的 append-only 审计证据，**不是** canonical JSON/Markdown archive 的替代；
- **不是** learning ledger / LearningSession / outcome / record 的事实来源；
- append 成功只说明该 audit row 集合按本 contract 处理，不单独证明 JSON/Markdown 可见性，也不覆盖 ledger snapshot identity。

本决定记录 audit 专用 V1 contract 与 S2 production append 边界。V1 fixed-file audit scope（per-conversation append-only、exact missing-row retry、进程内同路径 queue、有限 authority）已按 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md) 结项；超出该边界的扩张——strict durable profile、generic JSONL、rotation、repair、cross-process multi-writer、archive transaction、public IPC/UI——须新建 ADR 并提供匹配声明的 host-native/operations evidence，**当前不可分派**。

## 已实施范围与验证入口

- `4b30220` 引入 audit 专用 fixed-file durable append（framed、exact missing-row retry、同路径进程内队列、file sync 后尝试 directory sync）。
- `d6a94a1` 将 conversation audit events 接入 trace correlation 边界。
- S3…S45 扩展 recovery / short-circuit / directory capability residual 的 **tests-only** 证据，不扩大 production authority；细节见 [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md) 与 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md)。

主要代码与验证入口：

- `src/main/agent-conversation-session-audit.ts`
- `src/main/agent-conversation-archive.ts`（archive save 顺序中的 audit append 调用点）
- `pnpm exec vitest run --project unit tests/unit/agent-conversation-session-audit.unit.test.ts tests/unit/agent-conversation-archive-durable.unit.test.ts`

Directory `open`/`sync` 在部分 errno / Windows native 路径上的降级 warning 只表示 file sync 已完成而 directory durability 未获能力证明，**不得**解读为完整 parent-directory 或 power-loss durability。

## 不变量

- Audit 文件 append-only：不 rewrite、truncate、backfill、normalize 或 repair 既有 bytes。
- Exact retry 只补缺失 canonical row；同 identity 的 body/type/trace-state 冲突必须失败且保留原 bytes。
- Malformed/unknown row 可保留在文件中，但不获得 identity，也不能被“修复”成合法 row。
- 同路径 append 仅有本进程内串行；不同 audit 文件不互相阻塞；**无**跨进程 multi-writer 承诺。
- Archive save 中 JSON → Markdown → audit → ledger 的顺序是 ordered best-effort，**不是**跨文件 transaction。
- 持久化内容继续受 [ADR-0007](0007-persisted-user-history-redaction.md) 脱敏与 preview 边界约束；diagnostics 不得泄露 raw payload、绝对路径或 secret。

## 不包含

- 本 ADR **不**证明 cross-process exclusion、Windows native/power-loss、strict durable profile、完整 host capability matrix 或超出 fixed-file append 边界的 operations closure；这些仍属未批准扩张，见 [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md)。
- 本 ADR **不**授权 generic JSONL migration、`durable-jsonl` 分段自动套用、rotation、sealing、retention、compaction、deletion、quarantine、restore 或 repair。
- 本 ADR **不**把 audit 升级为 action identity、receipt、learning ledger authority、SQLite projection 输入，或 ADR-0003 `.bak` 机制的扩展目标。
- 本 ADR **不**引入 audit IPC/UI、operator repair command，或改变 JSON/Markdown/ledger 的 ownership 与 save order。

## 相关 ADR

- [ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)
- [ADR-0003](0003-critical-json-backups-and-verified-recovery.md)
- [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)
- [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md)
- [ADR-0007](0007-persisted-user-history-redaction.md)
- [ADR-0021](0021-c4-p6-p8-p9-closeout-scope-decisions.md)
