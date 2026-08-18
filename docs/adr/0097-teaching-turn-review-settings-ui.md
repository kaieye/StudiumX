# ADR-0097：Teaching-turn review Settings thin UI（project-first，无 auto-apply）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（Settings section `review` + demo/project/decide UI；**无** main 持久化队列）
- **日期：** 2026-07-21
- **范围：** ADOPTION **S-09 residual** — renderer Settings 薄面板：客户端 demo bundle → `projectTeachingTurnReview` 只读投影；可选本地人批决策 → `decideTeachingTurnReview` 再投影；**永不** auto-apply
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-types/settings.ts`（`SettingsSection` 含 `review`）
  - `src/renderer/src/workflows/settings.ts`（nav）
  - `src/renderer/src/views/settings/sections/TeachingTurnReviewSettingsSection.tsx`
  - `src/renderer/src/views/settings/SettingsView.tsx`（mount only）
  - `src/renderer/src/i18n/locales/zh-CN.json` / `en-US.json`
  - `tests/unit/teaching-turn-review-settings-section.unit.test.tsx`
  - 本 ADR

## 背景

ADR-0077/0080/0085/0087 已交付纯候选、finalize 钩子、人批投影与 product IPC。S-09 residual 仍缺 **Settings 可见面板**，使学习者/维护者能看到投影与本地决策回路。

产品**尚未**有 durable review bundle 持久化 IPC：orchestrator 仅可选 emit；本切片 **不** 在 main 发明队列存储，UI 仍须在无持久化时有用。

## 决定

### 1. Settings section `review`

- `SettingsSection` union 增加 `'review'`（与 `privacy` / `doctor`（若存在）相邻，`about` 之前）
- nav icon：`FileCheck2`
- i18n：`settingsSection.review.*` + `review.*` 文案

### 2. 薄面板行为（project-first）

| 路径 | 行为 |
| --- | --- |
| 主路径 | **Demo project** 按钮：客户端构造 `TeachingTurnReviewBundle`（1–2 候选，`requiresHumanApproval: true`，无可执行 payload 字段）→ `window.teachingSystem.projectTeachingTurnReview({ bundle })` → 渲染投影候选 |
| 可选路径 | 每候选本地 `approve` / `reject` / `defer` + **Submit decisions** → `decideTeachingTurnReview({ bundle, decision })` → 再渲染投影；`approvedCandidateIds` 以 **display chips** 展示，并注明 **不是 apply plan** |
| 空态 | 说明 post-turn 候选须人批、永不 auto-apply；批准 id 后续才喂入既有 consent 路径（out of scope） |

### 3. 不变量（产品地板）

- **无 auto-apply**；无 skill 安装、memory 写入、profile patch
- 投影字段不渲染 `applyPlan` / skill body / write paths（IPC 投影已省略）
- **不** 新增 main gateway / orchestrator storage / preload / contract
- **不** 改 settlement sole-writer / `expectedRevision` / `toolsReplayed`
- **无** YOLO / shell / MCP marketplace / 默认远程 telemetry

### 4. 为何本切片不做 main 存储

Durable review queue 需要独立 product 决策与 IPC（bundle 权威、revision、与 finalize hook 对齐）。本切片只消费既有 project/decide IPC，用 **client-side demo bundle** 证明 UI + IPC 回路，避免半成品存储成为 teaching authority。

## 不包含 / non-claims

- **不** durable review store / last-bundle 持久化 IPC
- **不** post-approve consent / skill-pack install / memory create 产品路径
- **不** auto-apply 任一候选
- **不** 改 pure ADR-0077/0085 逻辑（仅 import 类型）
- **不** 改 main / preload / system-api / gateway
- **不** doctor Settings 实现（若并行落地，本切片只做 merge-safe 共存）

## 验证入口

```sh
CI=true pnpm exec vitest run --project unit tests/unit/teaching-turn-review-settings-section.unit.test.tsx
```
