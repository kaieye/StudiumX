# ADR-0095：TeachingDoctor Settings 只读 UI 面板

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（Settings thin Doctor UI；**无** auto-repair / upload / clear marker / free-form facts）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-11 residual** — Settings 导航与只读 Doctor 面板接入既有 product IPC
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0043](0043-doctor-config-locator-and-fix-suggestion.md)、[ADR-0066](0066-local-observability-and-crash-marker.md)、[ADR-0084](0084-teaching-doctor-product-ipc.md)、[ADR-0093](0093-teaching-doctor-multi-collector-facts.md)
- **证据：** 
  - `src/shared/teaching-types/settings.ts`（`SettingsSection` 含 `doctor`）
  - `src/renderer/src/workflows/settings.ts`（nav：`doctor` + Stethoscope）
  - `src/renderer/src/views/settings/sections/TeachingDoctorSettingsSection.tsx`
  - `src/renderer/src/views/settings/SettingsView.tsx`（mount）
  - `src/renderer/src/i18n/locales/zh-CN.json` / `en-US.json`
  - `tests/unit/teaching-doctor-settings-section.unit.test.tsx`

## 背景

ADR-0084 落地 `teach:run-teaching-doctor` product IPC 与 export-safe report；ADR-0093 落地 multi-collector pure facts assemble。B-11 residual 的 **Settings Doctor UI** 此前仍缺：学习者/支持者无法在设置页触发只读诊断并阅读结构化结果。本切片仅补 **renderer thin panel**，不改 main/preload/IPC 闭集。

> 编号说明：任务 brief 曾写 ADR-0094，但仓库已有 [ADR-0094](0094-study-task-timer-planning-design-gate.md)（study planning design gate）。本决定记为 **ADR-0095**。

## 决策

### 1. Settings section id

`SettingsSection` 追加 `'doctor'`，导航置于 `privacy` 与 `about` 之间；图标 `Stethoscope`（lucide-react）。

### 2. IPC-only 调用

`TeachingDoctorSettingsSection` 直接调用：

```ts
window.teachingSystem?.runTeachingDoctor({ includeProcessCrashMarker: true })
```

- 不经 parent callback / App props 透传
- 不注入 free-form facts
- payload 仅既有闭集（ADR-0084）；omit 亦可默认

### 3. 展示 export-safe report

展示：`overallStatus`、`generatedAt`、`checks[]`（`checkId` / `result` / `summary` / `recommendedAction`；可选 `fixSuggestion.title` + `steps` 仅作**手动指引**，无执行按钮）。

可选：复制 export-safe JSON（schemaVersion / generatedAt / overallStatus / workspaceOpenPolicy / mode / checks 摘要字段）。

### 4. 不变量（产品地板）

- Doctor 只读；无 auto-repair 按钮、无 side-effect repair API
- 不 upload / OTEL / phone-home
- 不 clear crash marker
- 不触碰 settlement / coordinator / `toolsReplayed`
- 无 shell / MCP marketplace / YOLO / always-approve

## 不包含 / residual

- **真实 workspace session / outcome / source / catalog FS collectors** 仍 residual（ADR-0093）
- Support-bundle 面板 / public redact re-export 仍 optional secondary
- **B-09 Review UI** 不在本切片
- **不**改 `src/main/**`、preload、IPC contract、system-api、pure doctor types

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/teaching-doctor-settings-section.unit.test.tsx
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-11 residual：Settings Doctor UI **已落地（ADR-0095）** — section id `doctor` + thin panel 调 `runTeachingDoctor`；只读展示 export-safe report；无 auto-repair/upload/clear；IPC 仍 ADR-0084 闭集；真实 workspace collectors / support-bundle residual 仍 optional。
