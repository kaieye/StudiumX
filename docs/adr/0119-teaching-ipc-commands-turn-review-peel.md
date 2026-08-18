# ADR-0119：teaching-ipc-commands turn-review IPC parser peel

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-03 residual by-touch peel）
- **日期：** 2026-07-21
- **范围：** 将 `teaching-ipc-commands.ts` 内 **teaching-turn-review** 相关 IPC fail-closed 解析簇（project / decide / handoff / last-bundle get+save 及私有 bundle/decision/projection light helpers）抽到旁路模块；**不**改 parser 语义、source allowlist、caps、settlement 或 auto-apply
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)、[ADR-0110](0110-teaching-turn-review-handoff-ipc.md)、[ADR-0114](0114-teaching-turn-review-last-bundle-ipc.md)、[ADR-0100](0100-agent-loop-fallback-peel.md)、[ADR-0103](0103-agent-loop-budget-reason-peel.md)、[ADR-0106](0106-agent-loop-schema-guard-peel.md)、[ADOPTION S-03](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/teaching-ipc-commands-turn-review.ts`（新）
  - `src/main/teaching-ipc-commands.ts`（删除本地副本 + 兼容 re-export）
  - 既有 unit：`tests/unit/teaching-turn-review-ipc.unit.test.ts`、`teaching-turn-review-handoff-ipc.unit.test.ts`、`teaching-turn-review-last-bundle-ipc.unit.test.ts`、`teaching-ipc-commands.unit.test.ts`
  - `docs/adr/0119-teaching-ipc-commands-turn-review-peel.md`（本文件）

## 背景

ADR-0075 将模块尺寸政策与巨石 **按触达 peel** 纪律正式化。Rounds 14–17 在非 allowlisted 高告警模块 `teaching-ipc-commands.ts` 上持续叠加 turn-review / last-bundle parser（ADR-0087 / 0110 / 0114），使该文件逼近 ~1648 行（软/高阈 800/1000）。

该簇与 agent-conversation / workspace / agent-chat 解析无策略耦合，属于 **完整 by-touch cluster**：

1. 公共 parse*：`parseProjectTeachingTurnReviewPayload`、`parseDecideTeachingTurnReviewPayload`、`parseProjectTeachingTurnReviewHandoffPayload`、`parseGetTeachingTurnReviewLastBundlePayload`、`parseSaveTeachingTurnReviewLastBundlePayload`；
2. 私有 light helpers：bundle / candidate / human decision / candidate decision / approval projection light / optional id array；
3. 仅 review 使用的 IPC caps 与 kind/action allowlist 常量。

本切片**只** peel 该 turn-review 簇；agent-conversation 与 workspace parser 簇、三巨石 **不**在本轮移动。

## 决定

### 1. 新模块边界

| 模块 | 职责 |
| --- | --- |
| `teaching-ipc-commands-turn-review.ts` | turn-review 全簇 fail-closed IPC parsers + 仅 review 使用的 caps/allowlist |
| `teaching-ipc-commands.ts` | 其余 IPC parsers + 共享 primitives（`requireRecord` / `requireString` 等）；**re-export** 五个公共 parse* 以保持 gateway/tests 导入面 |

共享 primitives 留在 shell（prefer A）：新模块 `import { requireRecord, requireString } from './teaching-ipc-commands'`，避免大段 helper 复制。re-export 置于 shell **底部**（primitives 之后），避免循环初始化。

### 2. 行为与公共面

- 函数体与 peel 前逐字等价：exact-key、fail-closed 文案、candidate/decision caps（≤8）、kind/action allowlist、`requiresHumanApproval === true`、source `settings_demo|manual|unknown`、禁止 autoApply/applyPlan 等不变。
- 既有测试与 gateway 可继续从 `teaching-ipc-commands` 导入五个公共 parse*（兼容 re-export）；亦可直达新模块路径。
- **不**改 settlement sole-writer、`toolsReplayed`、auto-apply、IPC allowlist 产品语义；parser 仅形状门禁。

### 3. 不变量

- fail-closed 消息字符串与 caps 与 peel 前一致。
- 无循环依赖死锁：shell 先完成 primitives，再 re-export 加载 turn-review 模块。
- 不触达 teaching-workspace / learning-session-ledger / teaching-turn-coordinator。
- 不 peel agent-conversation / workspace parser 簇（sibling residual）。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-ipc.unit.test.ts `
  tests/unit/teaching-turn-review-handoff-ipc.unit.test.ts `
  tests/unit/teaching-turn-review-last-bundle-ipc.unit.test.ts `
  tests/unit/teaching-ipc-commands.unit.test.ts
```

可选：`node scripts/check-module-size.mjs`（warning-only；`teaching-ipc-commands.ts` 行数应实质下降）。

## 明确不包含 / non-claims

1. **不** peel agent-conversation / workspace / agent-chat parser 簇（本切片 sibling residual）。
2. **不** peel teaching-workspace / ledger / coordinator 三巨石（仍为 S-03 residual by-touch）。
3. **不** 改 turn-review product 语义（ADR-0087 / 0110 / 0114 仍为准）：无 auto-apply、无 settlement 写入、source allowlist 不变。
4. **不** 把 `check:module-size` 升为 Blocking CI。
5. **不** 引入 shell / YOLO / MCP marketplace / 远程 telemetry。
6. **不** 改 ADOPTION.md 正文（本切片仅 ADR + 代码 peel）。

## 与 ADOPTION S-03 的关系

- ADR-0075 政策 + 既有 pure/pure-ish peel（overlay-parse、agent-loop fallback / budget-reason / schema-guard）已落地；本 ADR 是 **teaching-ipc-commands turn-review parser cluster** residual peel。
- 建议 residual 措辞：S-03 政策与 by-touch pure peel 已落地；`teaching-ipc-commands` 仍可能含 agent-conversation / workspace 等 parser 簇（仅按触达再 peel）；**巨石**仍仅按触达 peel，禁止三线并行大搬家。
