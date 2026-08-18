# ADR-0085：Teaching-turn review 人批决策 + 只读投影（无 auto-apply）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-09 residual — pure human-approve decision model）
- **日期：** 2026-07-21
- **范围：** 纯函数人批决策校验 + UI 安全投影 DTO；**不**接线 IPC / 产品 UI；**不** auto-apply；**不**改 settlement
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)（纯候选）、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)（可选 finalize 钩子）、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-turn-review-approve.ts`
  - `src/shared/teaching-turn-review.ts`（re-export）
  - `tests/unit/teaching-turn-review-approve.unit.test.ts`
  - `tests/unit/teaching-turn-review.unit.test.ts`
  - 本 ADR

## 背景

ADR-0077 产出**仅候选**的 review bundle（`requiresHumanApproval: true` 恒真，禁止可执行 apply payload）。ADR-0080 在 orchestrator 上提供可选 post-finalize hook（fail-soft，不改 settlement）。

S-09 residual 仍缺一条**纯**人批决策模型：UI/IPC 未来投影时不得现场发明 apply 语义。本切片只提供 fail-closed 决策校验 + display-only 投影 + **非可执行**的 approved-id 列表；真实 skill 安装 / memory 创建 / lesson 跟进仍走既有 consent 门控产品路径（本模块外）。

并行约束：doctor IPC / gateway / preload / contract 由其他切片持有；本切片**不**编辑 IPC 文件。

## 决定

### 1. 纯模块：`src/shared/teaching-turn-review-approve.ts`

自 `teaching-turn-review.ts` re-export，保持单入口发现性。

| 符号 | 作用 |
| --- | --- |
| `TeachingTurnReviewDecisionAction` | `'approve' \| 'reject' \| 'defer'` |
| `TeachingTurnReviewCandidateDecision` | `{ candidateId, action, note? }` |
| `TeachingTurnReviewHumanDecision` | `{ turnId?, decidedAt?, decisions[] }` |
| `TeachingTurnReviewApprovalProjection` | UI 安全 DTO：`candidates[]` + 分区 id 列表 |
| `assertTeachingTurnReviewDecision` | 未知 id / 重复 id / 非法 action → throw；空 decisions 合法 |
| `projectTeachingTurnReviewForHuman` | bundle + 可选 decision → 投影 |
| `sanitizeDecisionNote` | 去掉 NUL/控制字符；长度 cap（500） |

### 2. 校验与投影不变量

- 投影与决策校验路径**始终**调用 `assertReviewNotAutoApplied(bundle)`（源 bundle 仍不得携带 auto-apply 形 payload / 假人批）。
- 未知 `candidateId`：**fail-closed** throw。
- 同一 id 重复决策：throw。
- 非法 action（含任何 `auto_apply` 类字符串）：throw。
- 空 `decisions` / 空 candidates bundle：合法。
- 投影中每个候选 `requiresHumanApproval: true`（类型 + 运行时）；**从不**写 `false`。
- 投影**不**复制 `payload` 进 DTO（避免把 diagnostic 键误当 execute 面）；**不**发明 `applyPlan` / `autoApply` / `skillFileContent` / `writePath` / `profilePatch` 等字段。
- `approvedCandidateIds` **仅为 id 列表**——**不是** apply plan。调用方若后续动作，**必须**走既有 consent / skill-pack / memory / lesson 正规路径（各自 ADR）；本模块不写文件、不改 learner-profile、不启动 memory/dream。

### 3. IPC / UI residual（明确开放）

- **不** 本切片编辑：`teaching-ipc-gateway.ts`、`teaching-ipc-commands.ts`、`teaching-ipc-contract.ts`、`preload/index.ts`、`main/index.ts`。
- 产品只读 UI 与 approve IPC 仍 residual；未来 IPC 应调用本纯函数，不得在 gateway 内发明 apply 语义。
- Orchestrator 接线（ADR-0080）保持可选；本切片不强制 mandatory wire。

### 4. 不变量（产品地板对齐）

- **Candidates + human decision only**：无自动 skill 文件、无静默 learner-profile rewrite、无 dream/memory phase。
- **Settlement sole-writer 不变**：不碰 coordinator / `expectedRevision` / `toolsReplayed`。
- **无 YOLO / always-approve 标签**；`requiresHumanApproval` 不可被决策清为 false。
- **无** FTS5 / 向量库 / 默认远程 telemetry。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/teaching-turn-review.unit.test.ts tests/unit/teaching-turn-review-approve.unit.test.ts tests/unit/teaching-turn-orchestrator.unit.test.ts
```

覆盖：

- 无 decision → 全部 `pending`
- approve / reject / defer 分区
- 未知 id fail-closed
- 空 candidates / 空 decisions 合法
- `assertReviewNotAutoApplied` 在投影管线中仍生效
- 投影无 auto-apply 形字段

## 不包含 / non-claims

- **不** 自动 apply 任一候选。
- **不** 创建 skill 文件、改 learner-profile、启动 memory/dream。
- **不** Electron IPC / 产品 UI 接线（仍 residual）。
- **不** 改 settlement / coordinator / toolsReplayed。
- **不** 改 ADOPTION.md 优先级表（本切片只交付代码 + ADR + 单元测试）。

## 后续 residual（非本切片）

1. IPC 只读投影 + 人批决策入口（调用本纯 API；与 B-11 / doctor IPC 协调文件所有权）。
2. 批准 id 后走既有 consent / skill-pack / lesson 路径（各自 ADR）。
3. 任何 auto-apply 均须**新建 ADR**，默认否决。
