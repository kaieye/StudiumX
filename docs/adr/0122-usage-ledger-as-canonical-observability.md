# ADR-0122：Usage Ledger 作为可观测性的细粒度 canonical 账本

- **状态：** 设计权威已采纳；**DB-P0-3 最小实现已落地**（JSONL writer + optional SQLite projection）；非「仅 design、未实现」
- **日期：** 2026-07-21
- **范围：** Token / tool / turn usage 细粒度 observability ledger 的权威边界、布局、保留、脱敏与 projection 关系
- **相关：** [ADR-0001](0001-rebuildable-sqlite-projection.md)、[ADR-0002](0002-utc-partitioned-segmented-jsonl-and-summary-projections.md)、[ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md)、[ADR-0007](0007-persisted-user-history-redaction.md)、[ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0028](0028-teaching-audit-correlation-safe-metadata.md)、[ADR-0034](0034-redacted-support-bundle.md)、[ADR-0040](0040-teaching-session-protocol-facade.md)、[ADR-0041](0041-tool-annotations-and-result-budget.md)、[ADR-0124](0124-database-layered-authority-and-pr-gates.md)（DB-P0-3 / DB-P1-1 状态）

## 背景

教学诊断、成本感知与失败分类需要比现有 conversation-level token analytics（`token-evidence` / learning analytics）更细的 **model / tool / turn** 级观测数据。ZCode 的 `model_usage` / `tool_usage` / `turn_usage` 字段粒度可借鉴，但 StudiumX 必须遵守：

1. **文件真相源**（ADR-0001 / ADR-0002）：SQLite 只能是可重建 projection。
2. **教学过程真相** 仍由 LearningSession ledger 持有（ADR-0008）；usage 不得成为 outcome / evidence / settlement authority。
3. **无 secret / prompt 正文** 进入 usage 行或 projection（ADR-0005 / 0007 / 0028）。
4. **DB-P0-3** 已锁定最小字段集与「projection 损坏不影响 turn 成功路径」的实现约束；本 ADR 升级为完整 usage ledger 设计权威，而不是重新发明另一套 schema。

## 决定

采纳 **Usage Ledger as canonical observability**：

| 层 | 角色 | 权威？ |
| --- | --- | --- |
| Append-only JSONL usage ledger | observability 事实来源（文件真相） | **是（仅 observability）** |
| Optional SQLite usage projection | 可丢弃 analytics index | **否** |
| LearningSession ledger / Evidence / Outcome | 教学过程与结算 | **否（正交；互不替代）** |
| Diagnostic app logs（logger mtime purge） | 诊断文本 | **否** |

Usage ledger 是 **observability canonical**，不是 teaching canonical。它解释「某次 model/tool/turn 花了多少 token、多久、成功与否」；它**不**解释「学习者是否学会、outcome 是什么、Evidence 是否充分」。

### 1. Canonical：append-only JSONL（复用 ADR-0002 模式）

1. **Logical source：** 单一 logical usage stream per placement（app-data 主路径 + 可选 workspace 旁路），实现为 active JSONL + 严格识别的 sealed segments。
2. **UTC 分区与分段：** 复用 `durable-jsonl` 的 UTC `YYYY-MM` sealed segment 命名与默认 **50 MiB** rotation（ADR-0002 / `DEFAULT_DURABLE_JSONL_MAX_BYTES`）。不另起一套 segment 协议。
3. **建议布局（实现切片可微调路径常量，但不得改变语义）：**
   - App-data（默认主路径）：`<userData>/usage/usage.jsonl` 与同目录 sealed siblings
   - Workspace（可选 best-effort 旁路）：`<workspace>/.studiumx/usage.jsonl`
4. **Append-only：** 成功写入只允许 append / seal-rename；禁止 rewrite、compact、in-place edit 或把 projection 回写进 JSONL。
5. **写入语义：** 生产 hot path 必须 **best-effort**——ledger I/O 失败不得使 agent turn / teaching turn 主成功路径失败（与 DB-P0-3 验收一致）。测试可暴露 strict writer 以便注入失败。
6. **幂等 / entryId：** 每行具备稳定 `entryId`（UUID 或 caller 提供的 opaque id）。同一 `entryId` 的重复 append **允许**在物理上出现（best-effort 无跨进程排重），但 projection rebuild 与 analytics 聚合必须以 `entryId` **去重**，不得双计 token。

### 2. 行模型（V1 wire 最小封闭集）

V1 只允许下列字段（名称稳定，便于 JSONL + SQLite 对齐）：

| 字段 | 说明 |
| --- | --- |
| `version` | 固定 `1` |
| `entryId` | opaque 唯一行 id |
| `kind` | `model_usage` \| `tool_usage` \| `turn_usage` |
| `timestamp` | ISO-8601 UTC 写出时刻 |
| `provider` / `model` | 短标签；非密钥、非 endpoint URL 密钥部分 |
| `status` | `started` \| `completed` \| `failed` \| `canceled` \| `unknown` |
| `startedAt` / `completedAt` | ISO-8601 |
| `durationMs` | 非负整数 |
| `inputTokens` / `outputTokens` / `reasoningTokens` / `cacheTokens` | 非负整数 token 计数 |
| `toolName` | 注册工具名短标签 |
| `readOnly` / `destructive` | 布尔；可自 effect annotations 派生（ADR-0041） |
| `approvalStatus` | `not_required` \| `pending` \| `allowed` \| `denied` \| `unknown` |
| `traceId` / `turnId` / `conversationId` | **opaque** correlation（ADR-0005 / 0028）；无 title、无 path、无 learner content |
| `ttftMs` | 可选；time-to-first-token 毫秒（非负整数；流式延迟观测） |
| `retryCount` | 可选；provider/tool 重试次数（非负整数） |
| `truncated` | 可选；布尔；结果是否被 budget 截断 |
| `errorType` | 可选；稳定错误类短标签：`provider_error` \| `timeout` \| `canceled` \| `tool_error` \| `rate_limit` \| `auth_error` \| `validation_error` \| `unknown`（**非** raw exception message / stack） |

**显式禁止写入 / 持久化：**

- raw prompt、message content、tool arguments、provider request/response body
- API key / secret / password / Authorization 头
- learner answer、reasoning 全文、完整绝对路径、transcript snippet
- token **stream** 全量 delta（DB-P1-3 反例；禁止「为回放方便落库」）

未知键、禁用键提示或 secret 形态字段必须在 build/parse 阶段拒绝；非法行在读取时丢弃并计数，不得污染 projection。

### 3. Optional SQLite projection

1. SQLite 表（例如 `model_usage_projection` / `tool_usage_projection` / `turn_usage_projection`，或统一 `usage_projection` + `kind` 列）**仅**为 rebuildable analytics index（ADR-0001）。
2. 列集对齐 V1 字段子集；**不**存 content / payload / secret。
3. 损坏、schema 不支持、source drift：隔离或重建；业务读取回退到 JSONL scan 或 graceful empty。
4. **禁止 FTS**；usage projection 不得变成可搜索语料。
5. Projection rebuild 失败、锁竞争或 query 错误 **不得** 反向影响 turn 成功路径。
6. 实现落点（LocalDataIndex 扩展 vs sibling module）留给 DB-P0-3 / 后续实现切片；本 ADR 只锁定「optional + disposable + rebuildable」不变量。

### 4. 与 LearningSession ledger 正交

| | Usage ledger (本 ADR) | LearningSession ledger (ADR-0008) |
| --- | --- | --- |
| 领域 | operational / cost / latency observability | 教学过程事实 |
| 是否影响 outcome | 否 | 是（经 Evidence / settlement 路径） |
| 身份 | `entryId` + opaque `conversationId`/`turnId`/`traceId` | 稳定 Session identity + event/operation |
| 删除/保留 | 诊断级（见 §5） | teaching canonical 永久保留（ADR-0002） |
| 可否互相替代 | **否** | **否** |

- Usage 行 **不得** 被 OutcomeEvaluator、Learning record cutover、settlement marker 或 Evidence 绑定读取为权威输入。
- LearningSession / Evidence 事件 **不得** 因缺 usage 行而失败。
- Agent run（ADR-0021）与 Teaching Session 身份保持分离；usage 仅通过 opaque id correlation。
- TeachingSessionProtocol 的 `usage` 方法（ADR-0040）可 **读取聚合** 供 UI，但不得把 protocol usage 结果升级为 settlement authority。

### 5. Retention 默认

**决定（关闭 DB-P1-1 开放问题）：**

1. Usage ledger **不是** ADR-0002 所称的 C-2 canonical teaching data，因此 **不** 继承「永久保留」。
2. **默认跟随 diagnostic logger 政策**（`settings.log.retentionDays` + mtime purge 语义类比），而非 teaching permanent retention。
3. **首期默认值：** 与 logger 默认 retention 对齐（实现以 settings 默认 `log.retentionDays` 为准；文档约定诊断级滚动窗口）。未配置时实现切片必须选用 **有限天数** 的 mtime-based purge，禁止「无限膨胀 + 无策略」。
4. Purge **只** 针对 usage JSONL active/sealed 文件（及可丢弃 SQLite projection）；**严禁** 触及 learning-work、LearningSession ledger、Evidence、outcome marker、Memory、conversation archive。
5. Purge 是 best-effort 运维；失败不得阻塞启动或 turn。
6. 若产品日后要求「usage 永久保留」或用户可控 retention UI，必须 **新 ADR**；本 ADR 不授权 retention 控制面 IPC/UI。
7. Support-bundle（ADR-0034）可包含 **聚合摘要** 或已脱敏的 usage 计数；默认不夹带完整 raw usage JSONL 全文，除非未来 consent section 明确授权且仍无 secret 字段。

### 6. Redaction 与 renderer 展示粒度

1. **写入前硬门：** allowlisted keys only + forbidden-key 拒绝 + 标量类型校验（计数/时间/布尔/短标签/opaque id）。
2. **读取/导出：** 复用 `redactAgentSecretText` / teaching audit safe-metadata 精神；聚合面板只暴露 counts、duration、provider/model 标签、toolName 与状态分布。
3. **Renderer：** 仅聚合面板（by day / provider / tool / status）；**不** 暴露 raw JSONL 行、payload、snippet 或完整绝对路径。
4. **Doctor / Inspector：** 可报告文件存在性、segment 计数、invalid 行计数、fingerprint；不得把 usage 当 FTS 语料。

### 7. 与 DB-P0-3 的关系

| 切片 | 职责 |
| --- | --- |
| **DB-P0-3** | 最小实现：JSONL writer + 可选 SQLite projection + best-effort 写入钩子 + unit 验收（projection 损坏不挡 turn；无 secret） |
| **DB-P1-1（本 ADR）** | 设计权威：canonical 边界、UTC 分段、正交性、retention 默认、redaction、字段封闭集、non-claims |

**协作规则：**

1. 本 ADR **不** 与 DB-P0-3 争抢同一实现文件的所有权；P0-3 可在 `src/main/usage-ledger.ts`（或等价路径）落地最小 writer/projection。
2. P0-3 实现必须 **符合** 本 ADR 的 V1 字段封闭集与 no-secret 不变量；若偏离，以本 ADR 为设计权威并在实现 PR 中收敛。
3. P1-1 **不** 要求在本切片中接线 agent loop 或扩展 LocalDataIndex schema；那些属于 P0-3 / 后续实现。
4. 已有 conversation-level `token-evidence` / learning analytics **继续** 作为兼容读取路径；usage ledger 是更细粒度补充，不强制一次性切断旧路径。

## 不变量

1. 文件 JSONL 是 observability 真相；SQLite 可删可重建。
2. 无 FTS；无 secret / prompt / tool args / token stream 正文。
3. Usage ⟂ LearningSession / Evidence / Outcome（正交，不可互相替代）。
4. Hot-path 写入 best-effort；observability 故障不否决教学/agent 成功。
5. Retention 默认诊断级（跟随 logger 政策），不是 teaching permanent。
6. Correlation id 仅 opaque；不承载 title/content/path。
7. 禁止把 usage projection 当作可见性、授权、留存或脱敏裁决依据（同 ADR-0001 精神）。

## 明确不包含 / non-claims

- 不授权云同步 billing、远程 usage 上报或 ZCode 全量 error taxonomy 一次搬空。
- 不把 usage 升格为 teaching canonical 或 settlement authority。
- 不授权全量 AG-UI / token stream 落库。
- 不引入 SQLite FTS 或用户可见 usage 全文搜索。
- ~~不在本 ADR 中实现 writer / projection / UI（设计 gate only）~~ — **实现状态（2026-07-21）：** 最小 writer + optional SQLite projection 已由 DB-P0-3 落地（`src/main/usage-ledger.ts` + LocalDataIndex）；本 ADR 仍为设计权威，renderer 全量聚合 UI 仍非强制。
- 不授权基于 usage 的自动删课、自动删 Memory 或 agent-artifact lifecycle。
- 不改变 ADR-0002 对 teaching canonical 的永久保留边界。

## 验收（设计切片）

- [x] 本文件存在于 `docs/adr/0122-usage-ledger-as-canonical-observability.md`
- [x] `docs/adr/README.md` 索引已更新
- [x] 覆盖：JSONL canonical + UTC 分段、optional SQLite、正交 learning-session、retention 默认、redaction、与 DB-P0-3 关系
- [x] 单元测试锁定 ADR 必需章节与禁区声明（见 `tests/unit/usage-ledger-adr.unit.test.ts`）

## 实现入口状态

```text
DB-P0-3  → 最小 writer + projection + tests  ✅ Done（见 ADR-0124 §4）
（可选）→ analytics adapter 只读聚合       ✅ 可选投影路径已有
（可选）→ doctor 暴露 segment/invalid 计数 ✅ DB-OPT-4 Done
（信号）→ retention worker 与 settings 显式 usage 策略（须核对本 ADR §5；默认诊断级）
```
