# ADR-0087：Teaching-turn review 人批投影 + 决策 product IPC（无 auto-apply）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（product invoke + fail-closed parser + pure mapper + preload whitelist；**无**完整 Settings Review UI 面板）
- **日期：** 2026-07-21
- **范围：** ADOPTION **S-09 residual** — 暴露闭集 product IPC：只读投影 + 人批决策提交；**仅**调用 ADR-0085 纯 API
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)（纯候选）、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)（finalize 钩子）、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)（纯决策 + 投影）、[ADR-0082](0082-agent-chat-steer-followup-ipc.md) / [ADR-0084](0084-teaching-doctor-product-ipc.md)（IPC 形状先例）、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-types/teaching-turn-review-ipc.ts`（payload / result）
  - `src/shared/teaching-types/system-api.ts` / `teaching-ipc-contract.ts`
  - `src/main/teaching-ipc-commands.ts`（fail-closed parsers）
  - `src/main/teaching-turn-review-ipc.ts`（pure mapper）
  - `src/main/teaching-ipc-gateway.ts`（两 channel 注册）
  - `src/preload/index.ts`（whitelist）
  - `tests/unit/teaching-turn-review-ipc.unit.test.ts`
  - 本 ADR

## 背景

ADR-0077 / 0080 / 0085 已交付：纯候选、可选 finalize 钩子、人批决策校验 + UI 安全投影。S-09 residual 仍缺 **产品 IPC 入口**，使 renderer 能投影 bundle 并提交人批决策，而 **不得** 在 gateway 内发明 auto-apply / skill 安装 / memory 写入语义。

## 决定

### 1. Invoke channels（闭集，两 channel）

| TeachingSystemApi | Channel | 行为 |
| --- | --- | --- |
| `projectTeachingTurnReview` | `teach:project-teaching-turn-review` | 投影 bundle（+ 可选 decision）→ UI-safe DTO |
| `decideTeachingTurnReview` | `teach:decide-teaching-turn-review` | 校验 decision + 投影（同一纯路径；决策提交语义更清晰） |

两 channel 共用 pure mapper：`runProjectTeachingTurnReviewIpc` / `runDecideTeachingTurnReviewIpc`，内部只调用 `projectTeachingTurnReviewForHuman`（含 `assertTeachingTurnReviewDecision` / `assertReviewNotAutoApplied`）。

### 2. Payload 形状（fail-closed）

**project：** `{ bundle, decision? }`  
**decide：** `{ bundle, decision }`（decision 必填）

`TeachingTurnReviewBundle` 允许键：`turnId?`、`candidates[]`、`generatedAt`。  
每个 candidate 允许键：`id`、`kind`、`title`、`summary`、`requiresHumanApproval`（**必须 true**）、`payload?`（诊断对象；投影省略 payload）。  
`TeachingTurnReviewHumanDecision` 允许键：`turnId?`、`decidedAt?`、`decisions[]`。  
每条 decision：`candidateId`、`action`（`approve`|`reject`|`defer`）、`note?`（≤500）。

解析规则（与 doctor / steer 同风格）：

- 各对象层 **拒绝未知键**
- candidates 数组 soft cap ≤ 8
- decisions 数量 ≤ candidates 或 ≤ 8
- 非法 action / 非 true `requiresHumanApproval` → parser throw
- pure assert 失败 → 结构化 `{ ok: false, reason }`（不 throw 进业务侧效果）

### 3. Result

```ts
type ProjectTeachingTurnReviewResult =
  | { ok: true; projection: TeachingTurnReviewApprovalProjection }
  | { ok: false; reason: string }
```

`DecideTeachingTurnReviewResult` 同构。`approvedCandidateIds` **仅为 id 列表**——**不是** apply plan。

### 4. Gateway / Preload

- Gateway：`parser → pure mapper → identityReply`；**无** Electron 副作用、**无** installSkill / createMemory / write files。
- Preload：两 method whitelist only。
- **不** 本切片交付完整 Settings Review UI 面板。

### 5. 不变量（产品地板）

- **无 auto-apply**：gateway 不执行候选；批准 id 须再走既有 consent / skill-pack / memory / lesson 路径。
- **无** settlement / coordinator / `toolsReplayed` 变更。
- **无** YOLO / always-approve / shell / MCP marketplace / 默认远程 telemetry。
- 投影永不含 `applyPlan` / `autoApply` / `skillFileContent` / `writePath` / `profilePatch` 等字段。

## 不包含 / non-claims

- **不** 自动 apply 任一候选。
- **不** 创建 skill 文件、改 learner-profile、启动 memory/dream。
- **不** 完整 Settings / Review UI 面板（renderer full UI residual）。
- **不** 改 settlement sole-writer / expectedRevision / toolsReplayed。
- **不** 重写 pure ADR-0085 逻辑（仅 import）。

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-ipc.unit.test.ts `
  tests/unit/teaching-turn-review-approve.unit.test.ts `
  tests/unit/teaching-turn-review.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- S-09 residual：teaching-turn review **人批投影 + 决策 product IPC 已落地（ADR-0087）** — 两闭集 channel（project / decide）→ pure ADR-0085；**无 auto-apply**；批准 ids 非 apply plan；完整 Settings Review UI 面板 / 批准后走 consent 产品路径接线仍 residual。
