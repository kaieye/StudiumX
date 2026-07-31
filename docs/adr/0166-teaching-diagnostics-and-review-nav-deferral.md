# ADR-0166：教学诊断 / turn-review 设置导航延期下线（暂未找到合适展示方式）

- **状态：** **已实施（展示面回退）**（2026-07-31）
- **范围：** 将 Settings 左侧导航 `settingsNavItems` 中的「诊断（`doctor`）」与「复核（`review`）」两项注释下线，并移除随之失用的 `Stethoscope` / `FileCheck2` 图标 import。`SettingsView` 中 `section === 'doctor'` / `section === 'review'` 的渲染分支、`TeachingDoctorSettingsSection` / `TeachingTurnReviewSettingsSection` 组件逻辑，以及对应单测全部保留。
- **关联：** [ADR-0165](0165-teaching-capability-trigger-surface-deferral.md)（同类展示面延期先例）、[ADR-0163](0163-teaching-capability-selection-and-plan-preview.md)、[ADR-0164](0164-unified-teaching-chain-and-skill-admission.md)、[ADR-0095](0095-teaching-doctor-settings-ui.md)（doctor Settings UI / IPC 合同）
- **限定：** 本 ADR 仅回退 Settings 导航展示面，不改变 doctor 检查语义、turn-review 投影 / 决策语义、IPC 合同、settlement sole-writer、effect lattice 或三态审批。

## 1. 背景

`settingsNavItems`（`src/renderer/src/workflows/settings.ts`）此前将两项无条件常驻挂在 Settings 导航中，对所有用户可见：

- **诊断（`doctor`）→ `TeachingDoctorSettingsSection`：** 调用既有 `runTeachingDoctor` IPC，跑一组只读健康检查（工作区打开策略、进程崩溃标记等），逐项给出 `passed` / `warning` / `failed` 结果与修复建议，并可复制脱敏报告。功能真实，但属于**小众排障 / 支持工具**——正常学习流程用不到，仅在出问题时有价值。
- **复核（`review`）→ `TeachingTurnReviewSettingsSection`：** 该面唯一可展示的数据来自硬编码的 `createDemoTeachingTurnReviewBundle`（三个假候选项，代码注释即声明 `Client-side sample bundle only — never treated as durable product queue`）；三个按钮「演示投影 / 载入上次 / 保存上次」保存时 `source: 'settings_demo'`。它是为 ADR-0163 / ADR-0164 的 teaching-turn-review 投影逻辑准备的**开发 / QA 验证脚手架**，不是面向学习者的产品功能。

两者作为常驻导航项，既增加设置面噪音，又容易被误解为正式产品能力（尤其 `review` 的 demo 数据会让人以为是真实复核队列）。**目前尚未找到合适的产品展示方式**，因此比照 ADR-0165 先行从导航面下线，逻辑保留待未来重新挂载。

## 2. 决定

1. **导航项下线（注释保留）：** 在 `settingsNavItems` 中将 `{ id: 'doctor', icon: Stethoscope }` 与 `{ id: 'review', icon: FileCheck2 }` 注释，并标注本 ADR 编号。数组类型约束 `satisfies Array<{ id: SettingsSection; icon: LucideIcon }>` 不变。
2. **失用 import 移除：** `Stethoscope` / `FileCheck2` 下线后在 `settings.ts` 中不再被引用，从 `lucide-react` import 中移除，并留注释说明重新挂载时需连同这两个图标一并恢复，避免未使用 import 告警。
3. **渲染分支与组件保留：** `SettingsView` 中 `section === 'doctor'` / `section === 'review'` 的渲染分支不删除；`TeachingDoctorSettingsSection` / `TeachingTurnReviewSettingsSection` 组件与其 IPC 调用逻辑完整保留，便于未来重新挂载。`SettingsSection` 联合类型仍包含 `'doctor'` / `'review'` 两个成员。

## 3. 不变量（未改变）

- `runTeachingDoctor` IPC 合同、检查项语义、脱敏报告导出（ADR-0095）不变；doctor 仍只读、从不自动修复 / 上传 / 清除 marker。
- teaching-turn-review 的 `projectTeachingTurnReview` / `decideTeachingTurnReview` / last-bundle 缓存 IPC 与投影 / 决策语义（ADR-0163 / ADR-0164）不变；投影仍只读、不写 ledger / outcome、不创建 Evidence。
- `SettingsSection` 类型、`section` 状态机与 `onSectionChange` 路由不变；持久化了 `doctor` / `review` 的既有会话仍可渲染对应分区，仅导航入口暂时关闭。
- 组件单测 `tests/unit/teaching-doctor-settings-section.unit.test.tsx`、`tests/unit/teaching-turn-review-settings-section.unit.test.tsx` 直接渲染组件，不经导航，故不因导航下线而失测。

## 4. CSS / 残留

`SettingsView` 中两个渲染分支与组件所依赖的 `SettingsPanel` / `SettingsCard` / `SettingsRow` / `settings-status-badge` 等样式均为通用设置样式，无专属死代码需清理。i18n 中 `settingsSection.doctor.*` / `settingsSection.review.*` 及 `doctor.*` / `review.*` 文案予以保留，待未来重新挂载时复用。

## 5. 验证入口

```bash
pnpm typecheck
pnpm exec vitest run --project unit tests/unit/teaching-doctor-settings-section.unit.test.tsx tests/unit/teaching-turn-review-settings-section.unit.test.tsx
```

## 6. 一句话

**「诊断」为小众排障工具、「复核」为纯 demo 脚手架，二者因尚未找到合适产品展示方式而从 Settings 导航注释下线；section 渲染分支、组件逻辑、IPC 合同与单测均保留，待未来展示面确定后重新挂载。**
