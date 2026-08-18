# ADR-0002：UTC 分区、无损 JSONL 分段、显式摘要 projection 与 canonical 永久保留边界

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** canonical local teaching data 无限期保留；UTC 月分区、无损 JSONL 分段与显式摘要 projection；物理 retention/recovery 不获批准。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0015](0015-canonical-teaching-event-protocol.md)
- **证据：** `src/shared/event-density-policy.ts`、`tests/unit/durable-jsonl.unit.test.ts`、`tests/unit/learning-work-ledger.unit.test.ts`、`tests/unit/agent-conversation-summary-projection.unit.test.ts`；提交 `d23b272`、`549f4f8`、`07dfbfb`、`3e9cdb1`

## 决定

1. canonical local teaching data 无限期保留。canonical JSON、Markdown、JSONL、immutable record 和 Memory 文件仍是事实来源；projection、分区、sealing、summary、`.bak` 与 receipt 不替代或授权删除事实来源。
2. **此前已实施的 C-2A / C-2B / C-2C 保持不变：**
   - 新会话按 UTC `YYYY/MM` 目录组织，读取端同时兼容 legacy flat 布局。
   - `learning-work.jsonl` 等 logical JSONL source 由当前 active 文件和严格识别的 sealed segments 顺序读取；跨 UTC 月或达到 50 MiB 时，只允许 fsync 后无损地将 active rename 为 sealed segment。
   - 会话摘要是带来源信息的显式 projection，不是 canonical 会话内容的替代品。
3. physical retention 和 recovery 不获批准；本 ADR 不提供或授权任何 canonical 数据的物理生命周期操作。
4. 相邻 operational conformance 已在 `3e9cdb1` 落地：移除了 renderer/main 的 agent-artifact 按年龄/大小删除 IPC 及其物理实现。该变更收敛了既存的相邻删除路径，**不是** physical retention 或 recovery 的实现。
5. logger 的 mtime purge 与相关 settings 保持不变：diagnostic logs 不是本 ADR 所称的 C-2 canonical teaching data，故不属于此决定的范围。

## 已落地范围与证据

### 此前已实施的 C-2A / C-2B / C-2C

- `d23b272` 实现 conversation storage 的 UTC 月分区，并保留 legacy flat 布局读取兼容；验证入口包括 `tests/unit/teaching-agent-conversations.unit.test.ts`。
- `549f4f8` 实现 durable segmented JSONL ledger、50 MiB / UTC 月 rotation 与 sealed segment 读取；验证入口包括 `tests/unit/durable-jsonl.unit.test.ts`、`tests/unit/learning-work-ledger.unit.test.ts` 和 `tests/unit/agent-conversation-archive-ledger-segments.unit.test.ts`。
- `07dfbfb` 实现显式 conversation summary projection；验证入口为 `tests/unit/agent-conversation-summary-projection.unit.test.ts`。

上列是 C-2A / C-2B / C-2C 的代码与测试证据；它们不曾也不因此获得 physical deletion、compaction 或 recovery 授权。已删除的 artifact lifecycle / protection 测试不再作为本 ADR 的验证入口。

### 本次 C-2 closure 的相邻 conformance

- `3e9cdb1` 删除了 renderer/main 的 `cleanupAgentArtifacts` / `teach:cleanup-agent-artifacts` 年龄/大小删除通道及其 physical implementation。`tests/unit/teaching-ipc-gateway.unit.test.ts` 覆盖该通道不再发布的边界。
- 此 closure 记录永久保留政策与上述相邻删除路径的收敛；它没有新增 retention writer、恢复流程或用户功能；前述测试只验证删除通道不再发布。

## 明确不包含

C-2 不批准下列能力，且不得将任何已实施的分区、sealing 或 summary projection 解释为其授权：

- 基于年龄或容量的删除、自动 cleanup，或任何 scheduler；
- canonical 数据的 compaction、截断、压缩、重写，或以 projection 替代 canonical source；
- quarantine、hold、restore、purge 或其他 physical recovery / lifecycle 状态；
- retention setting、IPC、preview、UI 或其他用户控制面；
- 对 canonical teaching data 的 physical retention / recovery 实现或其完成声明。

显式由用户选择的删除，以及事务、staging 或 lock 的清理，分别受其自身的授权和正确性边界约束，均不属于 C-2。

## 教学 event 密度（DB-P1-3 沉淀）

Marvis 式全量 stream/event 落库会导致体积与锁竞争。StudiumX **分离**：

1. **Canonical teaching events**（影响 outcome / evidence 的写权威仍在文件 ledger）
2. **Operational debug**（仅 diagnostic logs；允许 mtime purge；**禁止**写入 learning-work / LearningSession events）

### 硬规则

| 规则 | 细节 |
| --- | --- |
| Token stream | **不得**为回放方便写入 durable ledger |
| LearningSessionLedger | 关闭 kinds（`lesson_opened` / `lesson_completed` / `retrieval_attempted` / `quiz_attempted` / `flashcard_reviewed` / `learner_response_recorded` 等）；debug kinds 在 append 拒绝 |
| learning-work.jsonl | 仅 `conversation_snapshot`；无 turn 正文 / 全量 tool dump / stream delta / raw prompt |
| TeachingEventEnvelope（ADR-0015） | 运行时 bus 分 must-durable / must-ephemeral；ephemeral **不是**第二文件 ledger |

### 预算（实现镜像）

| Ledger | 预算示例 |
| --- | --- |
| LearningSession 事件文件 | max file 1 MiB；payload JSON 512 KiB；depth 64；软上限 500 events/session |
| learning-work 行 | evidence/category 40；text field ≤500；active 旋转 50 MiB（本 ADR 分段）；硬上限 256 KiB/row |

权威模块：`src/shared/event-density-policy.ts`（`assertLearningWorkCanonicalEntry` 等）。接缝：`LearningWorkLedger`、`LearningSessionLedger`。

验证：

```bash
pnpm exec vitest run --project unit tests/unit/event-density-policy.unit.test.ts tests/unit/learning-work-ledger.unit.test.ts
```

### 非目标

- 不自动静默 purge canonical events
- 不以 event 建 FTS 语料
- ledger 不进 secret / raw prompt

## 重新开启条件

只有新的、单独批准的产品与架构决定，明确授予一个具体且有限的 canonical physical lifecycle 或 recovery scope 时，才可重新开启 C-2。该决定必须至少定义 artifact class、授权主体与显式用户同意、删除/恢复语义、durability 与 failure/recovery 边界、审计要求，以及所需 API / IPC / UI 范围；在该批准和独立实施完成前，永久保留仍是有效政策。
