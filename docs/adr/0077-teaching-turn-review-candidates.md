# ADR-0077：Teaching-safe post-turn review candidates（人批门控）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-09 light）
- **日期：** 2026-07-21
- **范围：** 纯函数候选构建器 + 人批不变量；**不**接线自动 apply、**不**改 settlement
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、learner-profile consent（`learner-profile-record-policy`）、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-turn-review.ts`
  - `tests/unit/teaching-turn-review.unit.test.ts`
  - 本 ADR

## 背景

Hermes 意图中的 post-turn review 容易滑向「自动 skill 创建 / 静默改 learner-profile / dream phase」。StudiumX 产品地板要求：

- 文件是教学真相源；canonical 不写在 agent run 旁路。
- 无人批不自动注入 / 不启动自动 memory phase。
- Settlement sole-writer 仍是 `TeachingTurnCoordinator` / host。
- 禁止自动 skill 创建与静默 learner-profile 改写。

S-09 需要一条**教学安全**的 post-turn review 缝：只产生**候选**，供人类批准；finalize 钩子可后续接线，但本切片默认**零行为变更**。

## 决定

### 1. 纯模块：`src/shared/teaching-turn-review.ts`

导出：

| 符号 | 作用 |
| --- | --- |
| `TeachingTurnReviewCandidateKind` | `'memory_candidate' \| 'skill_pack_hint' \| 'lesson_gap' \| 'other'` |
| `TeachingTurnReviewCandidate` | `{ id, kind, title, summary, requiresHumanApproval: true, payload? }` |
| `TeachingTurnReviewBundle` | `{ turnId?, candidates, generatedAt }` |
| `buildTeachingTurnReviewCandidates` | 启发式、确定性、保守的候选列表 |
| `buildTeachingTurnReviewBundle` | 可选 bundle 包装 |
| `assertReviewNotAutoApplied` | 纯断言：任何人批路径预检 / 测试用 |
| `TeachingTurnReviewFinalizeHook` | **类型 only** 的可选 finalize 钩子形状；本切片不接线 |

### 2. 候选构建规则（保守）

- `mode === 'synthetic'` → **始终空数组**（无 learner-facing review 噪声）。
- 已出现 learner-profile consent / 「记录到用户记忆」类模式时，**不**再发 `memory_candidate`（避免与既有 consent 捕获重复）。
- 至多 `MAX_TEACHING_TURN_REVIEW_CANDIDATES`（2）条软候选。
- 信号示例（非穷尽）：
  - 工具失败文本 / errorish tool 名 / 明确「缺口」措辞 → `lesson_gap`
  - 「可复用 / 固定流程 / skill pack / checklist」→ `skill_pack_hint`（**仅 hint**）
  - 用户显式「请记住…」且无 consent 标记 → `memory_candidate`（仍需人批）
- **每个**候选 `requiresHumanApproval: true`（类型与运行时双重固定）。
- `payload` 仅为 display/diagnostic（snippet、signal、tool 名采样）；**禁止** `skillFileContent` / `profilePatch` / `writePath` / `autoApply` 等可执行 apply 形状（`assertReviewNotAutoApplied` 拒绝）。

### 3. Finalize 集成 residual（明确）

- `TeachingTurnOrchestrator.finalizeTeachingTurn` 仍是注入的 settlement 入口；**本切片不修改** `teaching-turn-orchestrator.ts` 行为。
- 可选类型 `TeachingTurnReviewFinalizeHook` 仅文档化未来接线形状：接收 `bundle`，**不得**写 skill、改 profile、或绕过 coordinator。
- 产品 UI / IPC approve 路径 **不在**本切片。

### 4. 不变量

- **Candidates only**：无自动 skill 文件创建、无静默 learner-profile rewrite、无 dream/memory phase 启动。
- **不**改变 settlement sole-writer、`expectedRevision`、`toolsReplayed: false`。
- **不**与 ADR-0050 合成记忆 remember/forget 人批路径冲突；本模块不调用 memory store。
- **不**把 SQLite / agent run 当 teaching authority。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/teaching-turn-review.unit.test.ts
```

覆盖：

- synthetic → empty
- `requiresHumanApproval` 恒 true
- 无 auto skill / profile payload
- `assertReviewNotAutoApplied` 拒绝假人批与禁止 payload 键

## 不包含 / non-claims

- **不** 接线 orchestrator / coordinator / IPC / 产品 UI。
- **不** 自动 apply 任一候选。
- **不** 创建 skill 文件或 skill-pack verifier 流程。
- **不** 静默改 learner-profile 或启动 memory phase。
- **不** 改 LearningSession outcome / Evidence settlement。
- **不** 引入 FTS / 向量库 / 远程 telemetry。

## 后续 residual（非本切片）

1. 在 finalize **之后**、settlement **之外** 可选调用 `buildTeachingTurnReviewCandidates` 并投影到只读 UI。
2. 人类批准后再走既有 consent / skill-pack / lesson 正规路径（各自 ADR）。
3. 任何 auto-apply 均须**新建 ADR**，默认否决。
