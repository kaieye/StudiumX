# ADR-0102：TeachingDoctor catalog drift facts collector（product gateway 注入）

- **状态：** 已实施（catalog drift collector + gateway inject；session/outcome residual）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-11 residual** — product TeachingDoctor 路径注入真实 catalog drift facts collector（active workspace + `planLessonIndexReconciliation` 适配），使 `catalog_drift` 在有工作区时不再默认 skipped
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0084](0084-teaching-doctor-product-ipc.md)、[ADR-0093](0093-teaching-doctor-multi-collector-facts.md)、[ADR-0095](0095-teaching-doctor-settings-ui.md)、[ADR-0099](0099-teaching-doctor-config-facts-collector.md)
- **证据路径：**
  - `src/main/observability/teaching-doctor-catalog-facts.ts`（`createTeachingDoctorCatalogDriftFactsCollector`）
  - `src/main/observability/index.ts`（导出）
  - `src/main/teaching-ipc-gateway.ts`（doctor action `factsCollectors` 注入 catalog 与既有 config）
  - `tests/unit/teaching-doctor-catalog-facts.unit.test.ts`
  - 本 ADR

## 背景

ADR-0084 落地 product IPC `teach:run-teaching-doctor`（payload 闭集；process crash marker store SoT）。ADR-0093 落地 pure multi-collector assemble 与 `deps.factsCollectors?`。ADR-0099 落地 config settings collector 的 gateway 注入。

纯检查 `checkCatalogDrift` 已存在于 `src/main/teaching-doctor.ts`，消费 `facts.catalogDrift`。此前 product gateway **未**挂 catalog collector，故 `catalog_drift` 在产品路径上恒为 `skipped`（除非测试手写 facts）。B-11 residual 需要真实、只读的 lesson-index 漂移探测。

## 决策

### 1. Fail-soft catalog drift facts collector factory

`createTeachingDoctorCatalogDriftFactsCollector(source)`：

- `id: 'catalog-drift'`
- `source.loadPlan()`：注入适配；产品路径由 gateway 实现为：
  1. `workspaceService.getState()` → `activeWorkspace`
  2. 无 active workspace → `null`
  3. 有 workspace → `planLessonIndexReconciliation({ rootPath, workspaceName, workspaceId, lessons })` → 只映射 `requiresPersist` / relative path 列表
- **成功且 plan 非 null：**
  - `catalogDrift: { requiresPersist, recoveredCount, removedCount, recoveredRelativePaths, removedRelativePaths }`
  - 路径样本 **relative-only**；硬顶默认 32；绝对路径 / home 根形态条目 **丢弃**（永不写入 `C:\Users\...` / `/home/...`）
  - count 以消毒后的列表长度为准
- **null/undefined plan（无 active workspace）：** 返回空 partial `{}`，使 pure `checkCatalogDrift` 保持 **`skipped`**（「facts 未供给」语义，而非伪零漂移）
- **loadPlan throw：** fail-soft 返回 `{}`（collector 内 catch；assembler 亦 catch）— doctor 呈 skipped，不崩溃、不泄漏错误串
- **永不** secrets / 绝对 home 路径 / free-form renderer facts

### 2. Gateway composition 注入（与 config 并列）

```ts
runProductTeachingDoctor(request, {
  crashMarkerStore: context.crashMarkerStore ?? null,
  factsCollectors: [
    createTeachingDoctorConfigFactsCollector({
      load: () => context.settingsService.load()
    }),
    createTeachingDoctorCatalogDriftFactsCollector({
      loadPlan: async () => {
        const state = await context.workspaceService.getState()
        const ws = state.activeWorkspace
        if (!ws) return null
        const plan = await planLessonIndexReconciliation({
          rootPath: ws.rootPath,
          workspaceName: ws.name,
          workspaceId: ws.id,
          lessons: ws.lessons
        })
        return {
          requiresPersist: plan.requiresPersist,
          recoveredRelativePaths: plan.recoveredRelativePaths,
          removedRelativePaths: plan.removedRelativePaths
        }
      }
    })
  ]
})
```

- 薄适配：collector **不**直接依赖 `teaching-workspace.ts` 巨石；gateway 注入 `loadPlan`
- 复用既有 pure planner `planLessonIndexReconciliation`（只读 plan；**不** persist / auto-repair）
- processCrashMarker store 覆盖行为不变（ADR-0084/0093 SoT）
- 公开 IPC payload 仍为 ADR-0084 闭集：renderer **不能**注入 free-form facts

### 3. 不变量（产品地板）

- Doctor 只读；`autoRepairAllowed` 恒 false
- 无 auto-repair / 无在 doctor run 时 persist 索引 / 无 clear crash marker
- 无 auto-upload / OTEL / Statsig / Mixpanel
- 无 shell / MCP marketplace / YOLO / always-approve
- 不触碰 settlement / coordinator / `toolsReplayed`
- 不 peel `teaching-workspace.ts` / ledger / turn-coordinator

## 不包含 / residual

- **session / outcome crash-window FS deep scan collectors** 仍 residual
- source-gap 真实 collector 仍 residual
- auto-repair / clear marker / support-bundle upload 仍 **不做**
- B-08 catalog policy inject / S-03 peel **不在本切片**

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-doctor-catalog-facts.unit.test.ts `
  tests/unit/teaching-doctor-config-facts.unit.test.ts `
  tests/unit/teaching-doctor-product-run.unit.test.ts `
  tests/unit/teaching-doctor-facts-assemble.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-11 residual：catalog drift facts collector **已落地（ADR-0102）** — gateway 注入 `createTeachingDoctorCatalogDriftFactsCollector`（active workspace + `planLessonIndexReconciliation`）；`catalog_drift` 产品路径可诊断；无 active workspace → skipped；IPC 仍闭集；session/outcome FS collectors / auto-repair residual。
