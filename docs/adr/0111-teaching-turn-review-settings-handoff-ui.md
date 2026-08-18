# ADR-0111：Teaching-turn review Settings handoff intents UI（纯客户端展示 only）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（Settings Review 在成功 project/decide 后展示 pure handoff intents；**无** 真实 consent 导航 / **无** auto-apply / **无** durable store）
- **日期：** 2026-07-21
- **范围：** ADOPTION **S-09 residual** — renderer Settings 薄面板在人批投影之上，用客户端纯函数 `projectTeachingTurnReviewHandoff` 渲染 **非可执行** handoff intents（display chips/rows only）
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)、[ADR-0097](0097-teaching-turn-review-settings-ui.md)、[ADR-0109](0109-teaching-turn-review-post-approve-handoff.md)、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-turn-review-handoff.ts`（pure；ADR-0109）
  - `src/renderer/src/views/settings/sections/TeachingTurnReviewSettingsSection.tsx`
  - `src/renderer/src/i18n/locales/zh-CN.json` / `en-US.json`（`review.handoff*`）
  - `tests/unit/teaching-turn-review-settings-section.unit.test.tsx`
  - `tests/unit/teaching-turn-review-handoff.unit.test.ts`
  - 本 ADR

## 背景

S-09 已交付纯候选、finalize 钩子、人批投影、product IPC project/decide、Settings 薄面板（approved ids 芯片），以及 pure handoff projection（ADR-0109）。

仍缺一层：**Settings UI** 在成功 project/decide 后，把 handoff intents 以只读形式展示出来，使维护者能看到「批准后下一步应打开哪条既有 consent 表面」的路由提示——仍不打开真实 consent、不写文件、不装 skill、不改 learner-profile。

本切片只接线 **客户端 pure projection**（renderer import shared 纯模块），**不** 依赖并行 handoff IPC。

## 决定

### 1. 客户端 pure handoff（必需路径）

Settings section 在成功 `projectTeachingTurnReview` / `decideTeachingTurnReview` 且得到 `projection` 后：

```ts
try {
  setHandoff(projectTeachingTurnReviewHandoff(result.projection))
} catch {
  setHandoff(null) // fail-soft display; do not invent intents
}
```

- 清空 / re-demo 失败路径：`setHandoff(null)`
- **不** 要求 `window.teachingSystem.projectTeachingTurnReviewHandoff`；纯路径充分且为本 ADR 权威
- Demo bundle 扩展为三类 known kind（`lesson_gap` / `skill_pack_hint` / `memory_candidate`），均 `requiresHumanApproval: true`，无可执行 payload 字段

### 2. UI 块（approved ids 卡片之后）

当 `handoff && (intents.length > 0 || unmappedCandidateIds.length > 0)` 时渲染 SettingsCard：

| 元素 | 行为 |
| --- | --- |
| Heading / note | `review.handoffHeading` / `review.handoffNote` — 强调 **not an apply plan**、永不 auto-apply |
| Intent row | `data-testid=review-handoff-intent-${id}`：kind、target 标签、`requiresConsent` 徽章、reason、装饰性 “product path later” 文案 |
| Unmapped | `data-testid=review-handoff-unmapped` + id chips |
| Apply 按钮 | **禁止** — 无 Apply / 无真实 consent API 调用 / 无导航 |

装饰性 target 文案（如 “memory consent (product path later)”）**不可点击**到真实 memory/skill/profile 写路径。

### 3. 不变量（产品地板）

- **无 auto-apply**；无 skill 安装、memory 写入、profile patch
- **不** 打开真实 consent 表面 / 不导航入产品写路径
- **不** durable review store / main 队列
- **不** 改 gateway / preload / system-api / contract / settlement sole-writer
- Handoff 失败 fail-soft（`handoff=null`），**不** 发明 intents
- **无** YOLO / shell / MCP marketplace / 默认远程 telemetry

### 4. 为何纯客户端、不并行 handoff IPC

ADR-0109 已定义 pure DTO。Settings 只需读已有 approval projection；再走一层 IPC 会引入无必要的契约面与并行 job 耦合。未来若产品需要跨进程 handoff consumer，可 **新建 ADR** 在既有 pure API 之上暴露 channel，但不得在 gateway 内发明 apply 语义。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-settings-section.unit.test.tsx `
  tests/unit/teaching-turn-review-handoff.unit.test.ts
```

覆盖：

- decide approve 后渲染 mapped handoff intents（target / requiresConsent / reason）
- 无 Apply 控件
- unknown kind → unmapped 列表
- demo bundle 三类 kind 且 human-gated / payload-safe

## 不包含 / non-claims

- **不** 打开真实 memory consent / skill-pack authoring / lesson follow-up 产品写路径
- **不** auto-apply 任一候选
- **不** durable review store / last-bundle FS
- **不** 新增/依赖 handoff IPC channel（可选 residual）
- **不** 改 main / preload / system-api / gateway / settlement
- **不** 改 pure ADR-0109 映射规则（仅 UI 消费）
- **不** 改 ADOPTION.md 优先级表

## 后续 residual（非本切片）

1. 真实 consent 表面打开（memory / skill-pack authoring + verifier / lesson follow-up）— 须产品路径 + 可能新建 ADR
2. Durable review store（须**新建 ADR**；默认不授权 auto-apply）
3. 可选 handoff IPC consumer（在 pure API 之上；不得发明 apply）
4. 任何 auto-apply 均须**新建 ADR**，默认否决
