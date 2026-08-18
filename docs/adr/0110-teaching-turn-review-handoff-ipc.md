# ADR-0110：Teaching-turn review post-approve handoff product IPC（闭集投影 only）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-09 residual — handoff 投影 product IPC wire）
- **日期：** 2026-07-21
- **范围：** 闭集 product IPC：将人批投影或 bundle+decision 映射为 **非可执行** handoff intents；**不** durable store；**不** auto-apply；**不** Settings UI（UI 为 sibling residual [ADR-0111](0111-teaching-turn-review-settings-handoff-ui.md)）；**不**改 settlement
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)、[ADR-0097](0097-teaching-turn-review-settings-ui.md)、[ADR-0109](0109-teaching-turn-review-post-approve-handoff.md)（pure handoff）、[ADR-0111](0111-teaching-turn-review-settings-handoff-ui.md)（Settings 展示）、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-types/teaching-turn-review-ipc.ts`（handoff payload / result）
  - `src/shared/teaching-types/system-api.ts` / `src/shared/teaching-ipc-contract.ts`
  - `src/main/teaching-turn-review-ipc.ts`（`runProjectTeachingTurnReviewHandoffIpc`）
  - `src/main/teaching-ipc-commands.ts`（`parseProjectTeachingTurnReviewHandoffPayload`）
  - `src/main/teaching-ipc-gateway.ts`（channel 注册）
  - `src/preload/index.ts`（whitelist）
  - `src/shared/teaching-turn-review-handoff.ts`（pure；ADR-0109）
  - `tests/unit/teaching-turn-review-handoff-ipc.unit.test.ts`
  - `tests/unit/teaching-turn-review-ipc.unit.test.ts` / `teaching-turn-review-handoff.unit.test.ts`
  - 本 ADR

## 背景

S-09 已交付：

| 切片 | 交付 |
| --- | --- |
| ADR-0077 | 纯候选 kinds |
| ADR-0080 | 可选 finalize hook |
| ADR-0085 | 人批决策 + 只读投影 |
| ADR-0087 | project/decide product IPC |
| ADR-0097 | Settings Review 薄面板 |
| ADR-0109 | 纯 post-approve handoff intents |
| ADR-0111 | Settings 客户端 pure handoff 展示（sibling；不依赖本 IPC） |

仍缺一层：**产品 IPC 入口**，使 renderer / 其它 host 可通过闭集 channel 投影 handoff intents，而 **不得** 在 gateway 内发明 auto-apply / skill 安装 / memory 写入 / durable store。

本切片只补这一层 IPC wire；真实 consent 动作与 durable store 仍 residual。

## 决定

### 1. Invoke channel（闭集，一 channel）

| TeachingSystemApi | Channel | 行为 |
| --- | --- | --- |
| `projectTeachingTurnReviewHandoff` | `teach:project-teaching-turn-review-handoff` | 投影 handoff intents → `{ ok: true, handoff }` 或 `{ ok: false, reason }` |

Main pure mapper：`runProjectTeachingTurnReviewHandoffIpc`，内部只调用 ADR-0109：

- payload 含 `projection` → `projectTeachingTurnReviewHandoff(projection)`
- 否则 → `projectTeachingTurnReviewHandoffFromBundle(bundle, decision)`（继承 ADR-0085 / `assertReviewNotAutoApplied`）

Pure assert throws → 结构化 `{ ok: false, reason }`。**从不**写文件 / 装 skill / 改 memory / 改 settlement。

### 2. Payload 形状（fail-closed，恰好一种）

```ts
type ProjectTeachingTurnReviewHandoffPayload =
  | { projection: TeachingTurnReviewApprovalProjection }
  | { bundle: TeachingTurnReviewBundle; decision: TeachingTurnReviewHumanDecision }
```

解析规则：

- 允许键闭集：`projection` | `bundle` | `decision`
- **拒绝** 混合（projection + bundle/decision）
- **拒绝** 空 payload（二者皆无）
- **拒绝** 未知键（含 `autoApply` 等）
- Shape A：`projection` 须为 plain object，含 `candidates[]` + `approvedCandidateIds[]`（轻量结构校验；不重实现完整 approve projector）
- Shape B：`bundle` + **必填** `decision`；复用 ADR-0087 的 `parseTeachingTurnReviewBundle` / `parseTeachingTurnReviewHumanDecision`
- **不** 发明 auto-apply 字段

### 3. Result

```ts
type ProjectTeachingTurnReviewHandoffResult =
  | { ok: true; handoff: TeachingTurnReviewHandoffProjection }
  | { ok: false; reason: string }
```

`handoff` 为 ADR-0109 DTO：`intents[]`（`requiresConsent: true` 恒真）、`unmappedCandidateIds`、`approvedCandidateIds`。  
序列化路径 **不得** 携带 `applyPlan` / `autoApply` / `skillFileContent` / `profilePatch` / `writePath` 等可执行字段。

### 4. 不变量

- **Candidates + human decision + handoff intents only**：无自动 skill 文件、无静默 learner-profile rewrite、无 dream/memory phase。
- **Settlement sole-writer 不变**；本 channel 不触碰 coordinator / toolsReplayed。
- **无 YOLO / always-approve**；handoff 不能绕过产品 consent 门。
- Settings UI 不依赖本 IPC 亦可工作（ADR-0111 客户端 pure 路径）；本 IPC 为可选 host/product wire。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-handoff-ipc.unit.test.ts `
  tests/unit/teaching-turn-review-ipc.unit.test.ts `
  tests/unit/teaching-turn-review-handoff.unit.test.ts
```

覆盖：

- 三类 known kind approve → 对应 target + `requiresConsent: true`
- reject/defer only → 空 intents
- unknown kind → `unmappedCandidateIds`、无 intent
- parser 拒绝 mixed / empty / unknown keys
- 序列化无 auto-apply 形字段
- mapper error path → `{ ok: false, reason }`

## 不包含 / non-claims

- **不** 自动 apply 任一候选。
- **不** 创建 skill 文件、改 learner-profile、启动 memory/dream。
- **不** durable review store / last-bundle FS / main 持久化队列。
- **不** Settings UI / i18n 接线（见 ADR-0111；本切片不改 Settings）。
- **不** 改 tool-policy merge（见 ADR-0112）。
- **不** 改 settlement / coordinator / toolsReplayed。
- **不** 改 ADOPTION.md 优先级表。

## 后续 residual（非本切片）

1. 真实 consent 动作：打开既有 memory / skill-pack authoring / lesson follow-up 门（各自 consent 路径；须产品 UI 决策）。
2. 可选 durable review store + last-bundle FS（须**新建 ADR**；默认不授权 auto-apply）。
3. 任何 auto-apply 均须**新建 ADR**，默认否决。
