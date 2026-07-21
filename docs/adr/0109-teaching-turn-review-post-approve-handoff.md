# ADR-0109：Teaching-turn review post-approve handoff 投影（consent-gated intents only）

- **状态：** 已实施（ADOPTION S-09 residual — pure post-approve handoff projection）
- **日期：** 2026-07-21
- **范围：** 纯函数将人批投影映射为**非可执行** handoff intents（路由/展示 DTO）；**不** durable store；**不** IPC；**不** auto-apply；**不**改 settlement
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)（纯候选）、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)（可选 finalize 钩子）、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)（人批投影）、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)（project/decide IPC）、[ADR-0097](0097-teaching-turn-review-settings-ui.md)（Settings 薄面板）、[ADR-0050](0050-lexical-memory-search-and-synthetic-memory.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/shared/teaching-turn-review-handoff.ts`
  - `src/shared/teaching-turn-review.ts`（re-export）
  - `tests/unit/teaching-turn-review-handoff.unit.test.ts`
  - `tests/unit/teaching-turn-review-approve.unit.test.ts`
  - `tests/unit/teaching-turn-review.unit.test.ts`
  - 本 ADR

## 背景

S-09 已交付：

| 切片 | 交付 |
| --- | --- |
| ADR-0077 | 纯候选 kinds：`memory_candidate` \| `skill_pack_hint` \| `lesson_gap`（+ fail-closed `other`） |
| ADR-0080 | 可选 finalize hook（fail-soft，不改 settlement） |
| ADR-0085 | 人批决策 + 只读投影；`approvedCandidateIds` **不是** apply plan |
| ADR-0087 | product IPC project/decide 闭集；无 auto-apply |
| ADR-0097 | Settings Review UI demo；无 main durable store |

仍缺一层：**人批之后**如何把 approved ids 描述成「下一步可打开哪条既有 consent 表面」的**纯** handoff DTO——仍不写文件、不装 skill、不改 learner-profile、不要求 durable review store。

本切片只补这一层 pure projection；真实动作仍由产品 UI 打开既有 consent 路径（各自 ADR）。

## 决定

### 1. 纯模块：`src/shared/teaching-turn-review-handoff.ts`

自 `teaching-turn-review.ts` re-export，保持单入口发现性（与 ADR-0085 同模式）。

| 符号 | 作用 |
| --- | --- |
| `TeachingTurnReviewHandoffTarget` | `'memory_consent' \| 'skill_pack_authoring' \| 'lesson_followup' \| 'none'` |
| `TeachingTurnReviewHandoffIntent` | `{ candidateId, kind, target, reason, requiresConsent: true }` |
| `TeachingTurnReviewHandoffProjection` | `{ turnId?, approvedCandidateIds, intents[], unmappedCandidateIds[] }` |
| `projectTeachingTurnReviewHandoff` | approval projection → handoff intents |
| `projectTeachingTurnReviewHandoffFromBundle` | bundle + decision → via ADR-0085 projector → handoff |
| `MAX_TEACHING_TURN_REVIEW_HANDOFF_REASON_LENGTH` | reason 长度 soft cap（200） |

### 2. 映射规则

| `candidate.kind` | `target` |
| --- | --- |
| `memory_candidate` | `memory_consent` |
| `skill_pack_hint` | `skill_pack_authoring` |
| `lesson_gap` | `lesson_followup` |
| 其它（含 `other` / 未知） | 放入 `unmappedCandidateIds`；**不**发 intent（fail-closed，永不暗示 execute） |

- **仅**处理 `approvedCandidateIds`；忽略 reject / defer / pending。
- 防御深度：id 须同时出现在 `approvedCandidateIds` **且** `candidates[].decision === 'approve'` 才映射 intent；否则进 `unmappedCandidateIds`。
- `requiresConsent: true` **恒真**（类型 + 运行时）。
- `reason` 为固定英文短句（展示 only）；长度 cap ~200；**不**携带用户自由文本密钥、file body、profile patch。
- Intent **从不**携带 `applyPlan` / `autoApply` / `skillFileContent` / `writePath` / `profilePatch` / `mutations` 等可执行字段。

### 3. 校验与不变量

- `projectTeachingTurnReviewHandoffFromBundle` 必须先走 `projectTeachingTurnReviewForHuman`（因而继承 `assertReviewNotAutoApplied`）。
- 空 approvals / 空 candidates：合法，空 `intents` + 空 `unmapped`。
- `approvedCandidateIds` 在 handoff 投影中按输入顺序去重保留。
- **Candidates + human decision + handoff intents only**：无自动 skill 文件、无静默 learner-profile rewrite、无 dream/memory phase。
- **Settlement sole-writer 不变**。
- **无 YOLO / always-approve**；handoff 不能绕过产品 consent 门。

### 4. IPC / durable store / UI residual（明确开放）

- **不** 本切片编辑：`teaching-ipc-gateway.ts`、preload、system-api、contract。
- **不** durable review store / last-bundle FS / main 持久化队列。
- **不** 调用 skill-pack-verifier / memory writers / profile patch / settlement。
- Settings UI 接线、gateway 暴露 handoff channel、以及 durable store 均 residual；未来接线应调用本纯 API，不得在 gateway 内发明 apply 语义。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-handoff.unit.test.ts `
  tests/unit/teaching-turn-review-approve.unit.test.ts `
  tests/unit/teaching-turn-review.unit.test.ts
```

覆盖：

- 三类 known kind → 对应 target + `requiresConsent: true`
- reject/defer 不产生 intent
- unknown kind → `unmappedCandidateIds`、无 intent
- 篡改 `approvedCandidateIds`（无 decision===approve）→ unmapped
- 空 bundle / 空 decisions
- fromBundle 仍 fail-closed 于 auto-apply 形 payload
- 序列化无 auto-apply 形字段

## 不包含 / non-claims

- **不** 自动 apply 任一候选。
- **不** 创建 skill 文件、改 learner-profile、启动 memory/dream。
- **不** durable review store / last-bundle FS。
- **不** Electron IPC / Settings 接线（handoff channel residual）。
- **不** 改 settlement / coordinator / toolsReplayed。
- **不** 改 ADOPTION.md 优先级表（本切片只交付代码 + ADR + 单元测试）。

## 后续 residual（非本切片）

1. 产品 UI / Settings 根据 handoff intents 打开既有 consent 表面（memory / skill-pack authoring / lesson follow-up）。
2. 可选 durable review store + IPC（须**新建 ADR**；默认不授权 auto-apply）。
3. 任何 auto-apply 均须**新建 ADR**，默认否决。
