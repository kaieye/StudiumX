# ADR-0120：teaching-ipc-commands agent-conversation IPC parser peel

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-03 residual by-touch peel）
- **日期：** 2026-07-21
- **范围：** 将 `teaching-ipc-commands.ts` 内 **agent-conversation** 相关 IPC fail-closed 解析簇（save / rename / read / summaries / session-tree / branch open·fork·replay·status / checkpoint create·resolve / write-rewind restore·list / archived history query·rebuild 及会话簇私有 helpers）抽到旁路模块；**不**改 parser 语义、caps、revision CAS 字段、settlement 或 toolsReplayed
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0119](0119-teaching-ipc-commands-turn-review-peel.md)、[ADR-0100](0100-agent-loop-fallback-peel.md)、[ADR-0103](0103-agent-loop-budget-reason-peel.md)、[ADR-0106](0106-agent-loop-schema-guard-peel.md)、[ADOPTION S-03](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/teaching-ipc-commands-agent-conversation.ts`（新）
  - `src/main/teaching-ipc-commands.ts`（删除本地副本 + 兼容 re-export；共享 primitives 导出供旁路 import）
  - 既有 unit：`tests/unit/teaching-ipc-commands.unit.test.ts`、`teaching-ipc-gateway.unit.test.ts`；相关 agent-conversation unit 若存在
  - `docs/adr/0120-teaching-ipc-commands-agent-conversation-peel.md`（本文件）

## 背景

ADR-0075 将模块尺寸政策与巨石 **按触达 peel** 纪律正式化。ADR-0119 已将 turn-review IPC parse 簇旁路至 `teaching-ipc-commands-turn-review.ts`，shell 仍约 1069 行（非 allowlisted HIGH >1000）。

agent-conversation 簇与 workspace / agent-chat / doctor 解析无策略耦合，属于 **完整 by-touch cluster**：

1. 公共 parse*：`parseSaveAgentConversationPayload`、`parseRenameAgentConversationPayload`、`parseReadAgentConversationPayload`、`parseProjectAgentConversationSummariesPayload`、`parseReadAgentConversationSessionTreePayload`、`parseOpenAgentConversationBranchPayload`、`parseForkAgentConversationBranchPayload`、`parseReplayAgentConversationBranchPayload`、`parseUpdateAgentConversationBranchStatusPayload`、`parseCreateAgentConversationCheckpointPayload`、`parseResolveAgentConversationCheckpointPayload`、`parseRestoreAgentWriteRewindPayload`、`parseListAgentWriteRewindJournalPayload`、`parseQueryAgentArchivedHistoryPayload`、`parseRebuildAgentHistoryIndexPayload`；
2. 会话簇私有 helpers：`parseSavedAgentConversationTurns` / provenance 校验 / branch reference / storage·lookup scope / branch status 等；
3. 会话 caps（turns 上限、字节上限、SAFE_TURN_ID / SAFE_LINEAGE_ID）。

本切片**只** peel 该 agent-conversation（+ write-rewind journal + archived history）簇；agent-chat / doctor / workspace parser 簇与三巨石 **不**在本轮移动。

## 决定

### 1. 新模块边界

| 模块 | 职责 |
| --- | --- |
| `teaching-ipc-commands-agent-conversation.ts` | agent-conversation 全簇 fail-closed IPC parsers + 仅 conversation 使用的 caps/helpers |
| `teaching-ipc-commands.ts` | 其余 IPC parsers + 共享 primitives（`requireRecord` / `requireString` / `requireSafeId` / `optionalNonNegativeInteger` 等）；**re-export** 十五个公共 parse* 以保持 gateway/tests 导入面 |

共享 primitives 留在 shell（prefer A，与 ADR-0119 一致）：新模块 `import { requireRecord, requireString, … } from './teaching-ipc-commands'`，避免大段 helper 复制。re-export 置于 shell **底部**（primitives 之后），避免循环初始化。

### 2. 行为与公共面

- 函数体与 peel 前逐字等价：exact-key、fail-closed 文案、turns/bytes caps、`expectedRevision` / `expectedBranchRevision` CAS 字段、canonical conversation id、provenance kind 规则不变。
- 既有测试与 gateway 可继续从 `teaching-ipc-commands` 导入公共 parse*（兼容 re-export）；亦可直达新模块路径。
- **不**改 settlement sole-writer、`toolsReplayed`、auto-apply、IPC allowlist 产品语义；parser 仅形状门禁。

### 3. 不变量

- fail-closed 消息字符串与 caps 与 peel 前一致。
- 无循环依赖死锁：shell 先完成 primitives，再 re-export 加载 agent-conversation 模块。
- 不触达 teaching-workspace / learning-session-ledger / teaching-turn-coordinator。
- 不 peel agent-chat / doctor / workspace / turn-review parser 簇（sibling residual）。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-ipc-commands.unit.test.ts `
  tests/unit/teaching-ipc-gateway.unit.test.ts
```

可选 agent-conversation 相关 unit；可选 `node scripts/check-module-size.mjs`（warning-only；`teaching-ipc-commands.ts` 行数应实质下降，目标 ≤1000 soft 优先 ≤800）。

## 明确不包含 / non-claims

1. **不** peel agent-chat / doctor / workspace parser 簇（本切片 sibling residual）。
2. **不** peel teaching-workspace / ledger / coordinator 三巨石（仍为 S-03 residual by-touch）。
3. **不** 改 conversation / write-rewind / archived-history product 语义：无 auto-apply、无 settlement 写入、CAS 字段与 fail-closed 不变。
4. **不** 把 `check:module-size` 升为 Blocking CI。
5. **不** 引入 shell / YOLO / MCP marketplace / 远程 telemetry。
6. **不** 改 ADOPTION.md 正文（本切片仅 ADR + 代码 peel）。
7. **不** 改 turn-review 旁路模块（ADR-0119 已落地）。

## 与 ADOPTION S-03 的关系

- ADR-0075 政策 + 既有 pure/pure-ish peel（overlay-parse、agent-loop fallback / budget-reason / schema-guard）与 ADR-0119 turn-review peel 已落地；本 ADR 是 **teaching-ipc-commands agent-conversation parser cluster** residual peel。
- 建议 residual 措辞：S-03 政策与 by-touch pure peel 已落地；`teaching-ipc-commands` 仍可能含 agent-chat / doctor / workspace 等 parser 簇（仅按触达再 peel）；**巨石**仍仅按触达 peel，禁止三线并行大搬家。
