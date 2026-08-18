# ADR-0165：教学能力触发按钮展示面延期（暂未找到合适展示方式）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** **已实施（展示面回退）**（2026-07-30）
- **日期：** 2026-07-30
- **范围：** 将 `SkillCapabilityPicker` 的显式「教学意图与能力设置」触发按钮从两个 composer 工具栏中注释下线；移除输入框上方常驻的「教学内核已启用」chip。picker 逻辑（panel / preset / 只读 plan preview / slash 合并 / IPC）全部保留。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0163](0163-teaching-capability-selection-and-plan-preview.md)（本 ADR 限定其 Renderer UX 展示面）、[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0164](0164-unified-teaching-chain-and-skill-admission.md)
- **证据：** 展示面回退落点：`src/renderer/src/skills/SkillCapabilityPicker.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles/overview.css`；测试 `tests/unit/skill-capability-picker.unit.test.tsx`。
- **限定：** 本 ADR 仅回退展示面，不改变 capability 选择语义、planner 纯度、IPC 合同、settlement sole-writer、effect lattice 或三态审批。

## 1. 背景

ADR-0163 在两个 composer（overview 教学对话框与 agent conversation composer）的工具栏中，于模型选择器左侧放置了一个显式「教学意图与能力设置」触发按钮（`skillCapabilities.toggle`），并在输入框上方常驻显示「教学内核已启用」chip。

实际上线评估后发现：

- 触发按钮当前的展示位置（模型选择器左侧）与教学 composer 的 intent-first 心智不协调：它在视觉上与模型 / 推理选择混为一排，容易被理解为「模型能力开关」而非「教学意图与能力编排入口」，且与 host-owned admission / preset 治理叙事冲突——ADR-0164 已限定 raw 多选仅是输入 ceiling，不是「自由拼装教学策略」的产品承诺。
- 「教学内核已启用」chip 信息量为零且不可操作：教学内核由应用注入、始终 fail-closed 启用、永远不是学习者可选 slot（ADR-0151 §2.1）。常驻 chip 只增加输入框上方噪音，不传达任何可动作状态。

**目前尚未找到合适的展示方式**，因此先行将两者从产品面下线，picker 逻辑保留，待未来找到更合适的展示面后重新挂载。

## 2. 决定

1. **触发按钮下线（注释保留）：** 在 `src/renderer/src/App.tsx` 两个 composer 的工具栏中，将 `{skillCapabilities.toggle}` 注释为 `{/* {skillCapabilities.toggle} */}`，并标注本 ADR 编号。`useSkillCapabilityPicker` 仍照常产出 `toggle` / `panel` / `chips` / `selectedSkillIds` / `clear`，逻辑不删除，便于未来重新挂载。
2. **教学内核 chip 移除：** 在 `src/renderer/src/skills/SkillCapabilityPicker.tsx` 的 `chips` 中删除 `options.isTeachingMode` 分支的 `is-kernel` chip，并将 chips 容器的渲染条件由 `options.isTeachingMode || selectedSkillIds.length > 0` 收紧为 `selectedSkillIds.length > 0`，避免渲染空容器。已选能力 chip 在有选择时仍照常显示。
3. **capability 选择入口现状：** 触发按钮下线后，产品面进入显式 picker 的入口暂时关闭；`leading /skill-id` slash 入口（ADR-0163 §1）仍保留并按 host eligibility projection 过滤。picker 行为（preset、高级能力过滤、只读 plan preview、focus restore）由 `tests/unit/skill-capability-picker.unit.test.tsx` 经 harness 直接渲染 `picker.toggle` 继续覆盖，不因产品面下线而失测。

## 3. 不变量（未改变）

- 教学内核 `teach` 仍 exactly-one、host-injected、fail-closed、不可选（ADR-0151 / ADR-0164）。
- `previewSkillOrchestration` 仍只读、不写 ledger / outcome、不创建 Evidence、不推进 stage cursor；`TeachingTurnCoordinator` / host 仍是 settlement sole-writer；`expectedRevision` 与 `toolsReplayed:false` 不变。
- capability 选择不授予工具权限，不绕过 effect lattice 或三态审批；personal/custom 文件不自动进入正式教学链路。
- slash 与 chips 合并、normalize、dedupe 与 host eligibility 过滤语义不变；8 项仅是 IPC 输入 ceiling。

## 4. CSS / 残留

`.skill-capability-chip.is-kernel` 与 `.skill-capability-toggle` 相关样式（`src/renderer/src/styles/overview.css` / `theme.css`）予以保留，待未来展示面确定后复用；不视为死代码删除项。`triggerRef` 在 `closePanel` 中的 focus-restore 调用在按钮下线后自然降级为 no-op（`triggerRef.current` 恒为 `null`），不产生错误。

## 5. 验证入口

```bash
pnpm typecheck
pnpm run check:teaching-composer-a11y
pnpm exec vitest run --project unit tests/unit/skill-capability-picker.unit.test.tsx
```

## 6. 一句话

**显式教学能力触发按钮因尚未找到合适展示方式而注释下线、教学内核常驻提示因零信息量而移除；但 picker 逻辑、planner 纯度、IPC 合同、settlement 权威与工具审批均未改变，slash 入口仍可用。**
