# ADR-0080：Teaching-turn review finalize wire（可选 post-finalize 候选钩子）

- **状态：** 已实施（ADOPTION S-09 residual — finalize wire）
- **日期：** 2026-07-21
- **范围：** 在 `TeachingTurnOrchestrator` 可选接线 post-finalize review 候选发射；**仅人批**；**不**改 settlement sole-writer
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)（纯候选构建）、[ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/ai/teaching-turn-orchestrator.ts`
  - `src/shared/teaching-turn-review.ts`（ADR-0077）
  - `tests/unit/teaching-turn-orchestrator.unit.test.ts`
  - 本 ADR

## 背景

ADR-0077 落地了教学安全的纯函数 review 候选构建器与 `TeachingTurnReviewFinalizeHook` **类型**，但 orchestrator 故意未接线，默认零行为变更。

S-09 residual 需要一条**可注入**的 post-finalize 缝：finalize（settlement）成功之后，若产品注入 hook，则构建候选并回调；**绝不**自动 apply skill / 改 learner-profile / 反向改写 settlement。

Coordinator 仍是 outcome settlement sole-writer；本切片只碰 thin orchestrator 序列，不改 `teaching-turn-coordinator.ts`，不要求产品 UI。

## 决定

### 1. 可选 deps（默认零行为变更）

`TeachingTurnOrchestratorDeps` 新增：

| 字段 | 必需 | 作用 |
| --- | --- | --- |
| `onTeachingTurnReview?` | 否 | `TeachingTurnReviewFinalizeHook`：收到 `{ mode, bundle }`，仅投影/人批入口 |
| `buildTeachingTurnReviewInput?` | 否 | 将 `{ command, context, loopResult, mode }` 映射为 `BuildTeachingTurnReviewCandidatesInput` |

无 hook → 与 ADR-0047 行为一致：build → loop → finalize → return。

### 2. 序列（settlement 之后）

1. `context = buildTeachingTurnContext(...)`
2. `loopResult = runAgentLoop(...)`
3. `finalResult = await finalizeTeachingTurn(...)`  ← settlement 已完成
4. **若** `onTeachingTurnReview` 存在：
   - `mapped = await buildTeachingTurnReviewInput?.(args)`（可省略）
   - `reviewInput = { ...(mapped ?? {}), mode }` — **强制**使用 orchestrator 的 `TeachingTurnMode`（防止 mapper 把 synthetic 伪装成 visible）
   - `bundle = buildTeachingTurnReviewBundle({ reviewInput })`
   - `assertReviewNotAutoApplied(bundle)` — fail-closed 对禁止 payload / 假人批
   - `await onTeachingTurnReview({ mode, bundle })`
5. `return finalResult`

### 3. 错误策略（fail-soft，保 settlement）

- Settlement 已在步骤 3 完成；review 路径**不得**推翻或改写 `finalResult`。
- hook / mapper / assert 抛错：**吞掉**，仍返回 `finalResult`。
- 不引入日志副作用依赖（保持 thin seam；宿主可在 hook 内自行记录）。

### 4. 不变量

- **Candidates only**：无自动 skill 文件、无静默 learner-profile、无 dream/memory phase、无 autoDrain。
- **Settlement sole-writer 不变**：`finalizeTeachingTurn` 仍由注入方（通常 coordinator host）负责；orchestrator 不写 ledger / evidence outcome。
- **Synthetic → empty**：纯规则 + mode 强制覆盖，合成回合无 learner-facing review 噪声。
- **每个**候选 `requiresHumanApproval: true`（ADR-0077 构建 + assert）。
- 无 hook 时**零行为变更**。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/teaching-turn-orchestrator.unit.test.ts tests/unit/teaching-turn-review.unit.test.ts
```

覆盖：

- 无 hook：仅 finalize 一次，无 review
- visible + hook：收到 bundle，候选 `requiresHumanApproval === true`
- synthetic + hook：空 candidates
- hook / mapper 抛错：仍返回 finalize 结果

## 不包含 / non-claims

- **不** 改 `teaching-turn-coordinator.ts` / settlement sole-writer / `expectedRevision` / `toolsReplayed`。
- **不** 产品 UI / IPC approve 路径（仍 residual）。
- **不** 自动 apply 任一候选、不创建 skill、不改 learner-profile。
- **不** 启动 memory/dream phase 或自动 skill 创建。
- **不** 把 SQLite / agent run 当 teaching authority。
- **不** 强制 orchestrator 接入生产 coordinator（当前主要用于 unit / 可注入 seam）。

## 后续 residual（非本切片）

1. IPC / 只读 UI 投影 review candidates 供人类批准。
2. 批准后走既有 consent / skill-pack / lesson 正规路径（各自 ADR）。
3. 任何 auto-apply 均须**新建 ADR**，默认否决。
