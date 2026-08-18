# ADR-0105：TeachingDoctor source-gap facts collector（workspace summary projection + gateway 注入）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（source-gap workspace-summary projection collector + gateway inject）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-11 residual** — product TeachingDoctor 路径注入真实 source-gap facts collector（active workspace summary 投影：`resources.length` + `referenceCount` + `assetsReady`），使 `source_gap` 在有工作区时不再默认 skipped
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0013](0013-budgeted-provenance-aware-teaching-context.md)、[ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0084](0084-teaching-doctor-product-ipc.md)、[ADR-0093](0093-teaching-doctor-multi-collector-facts.md)、[ADR-0099](0099-teaching-doctor-config-facts-collector.md)、[ADR-0102](0102-teaching-doctor-catalog-drift-collector.md)、[ADR-0104](0104-teaching-doctor-session-outcome-scan-collectors.md)（sibling session/outcome；本切片不拥有）
- **证据：** 
  - `src/main/observability/teaching-doctor-source-gap-facts.ts`（`createTeachingDoctorSourceGapFactsCollector` / `mapWorkspaceSummaryToSourceGapFacts`）
  - `src/main/observability/index.ts`（导出）
  - `src/main/teaching-ipc-gateway.ts`（doctor action `factsCollectors` **append** source-gap；保留 config / catalog / 若已存在的 session-outcome）
  - `tests/unit/teaching-doctor-source-gap-facts.unit.test.ts`
  - 本 ADR

## 背景

ADR-0084 落地 product IPC `teach:run-teaching-doctor`（payload 闭集；process crash marker store SoT）。ADR-0093 落地 pure multi-collector assemble 与 `deps.factsCollectors?`。ADR-0099 / ADR-0102 分别注入 config 与 catalog-drift collectors。

纯检查 `checkSourceGap` 已存在于 `src/main/teaching-doctor.ts`，消费 `facts.sourceGap`：

```ts
TeachingDoctorSourceGapFacts = {
  status: 'ready' | 'degraded' | 'unavailable' | 'unknown' | 'not_configured'
  availableSourceCount: number
  exclusionCodes: readonly string[]
  gapCount: number
}
```

此前 product gateway **未**挂 source-gap collector，故 `source_gap` 在产品路径上恒为 `skipped`（除非测试手写 facts）。B-11 residual 需要轻量、只读的 workspace-summary 投影作为 product doctor facts——**不是**完整 `ResourceGrounder` / GroundingPack / mission-descriptor 深扫。

## 决策

### 1. Fail-soft source-gap facts collector factory

`createTeachingDoctorSourceGapFactsCollector(source)`：

- `id: 'source-gap'`
- `source.loadSummary()`：注入适配；产品路径由 gateway 实现为：
  1. `workspaceService.getState()` → `activeWorkspace`
  2. 无 active workspace → `null`
  3. 有 workspace → `{ resourcesCount, referenceCount, assetsReady }`（**仅**计数与布尔；**永不** `resourcesPath` / `referenceDir` / 绝对路径）
- **成功且 summary 非 null：** `{ sourceGap: mapWorkspaceSummaryToSourceGapFacts(summary) }`
- **null/undefined summary（无 active workspace）：** 返回空 partial `{}`，使 pure `checkSourceGap` 保持 **`skipped`**
- **loadSummary throw：** fail-soft 返回 `{}`（collector 内 catch）— doctor 呈 skipped，不崩溃、不泄漏错误串
- **永不** secrets / 绝对路径 / free-form renderer facts

### 2. Mapping ladder（workspace summary → sourceGap）

| 条件 | status | gapCount | exclusionCodes |
| --- | --- | --- | --- |
| `!assetsReady && resourcesCount===0 && referenceCount===0` | `not_configured` | 1 | `['assets_not_ready']` |
| `!assetsReady`（其余） | `degraded` | 1 | 含 `assets_not_ready` |
| `assetsReady && resourcesCount===0 && referenceCount===0` | `unavailable` | 1 | 含 `resource_absent` |
| `assetsReady && resourcesCount===0`（reference-only） | `degraded` | 1 | 含 `resource_gap` |
| 否则（至少 1 个 resource 且 assetsReady） | `ready` | 0 | `[]` |

- `availableSourceCount` = `max(0, resourcesCount) + max(0, referenceCount)`（数字 only；负/NaN → 0）
- `exclusionCodes`：稳定短码 only；硬顶 12；**永不**路径 / secrets
- **非声明：** 这是 workspace-summary 投影，**不是**完整 GroundingPack / mission resource-descriptor ground；不替代 planner `wait_for_resources` 的运行时 grounding

### 3. Gateway composition 注入（append；保留既有 collectors）

```ts
factsCollectors: [
  createTeachingDoctorConfigFactsCollector({ ... }),
  createTeachingDoctorCatalogDriftFactsCollector({ ... }),
  // sibling may inject session-outcome (ADR-0104) — preserve if present
  createTeachingDoctorSourceGapFactsCollector({
    loadSummary: async () => {
      const state = await context.workspaceService.getState()
      const ws = state.activeWorkspace
      if (!ws) return null
      return {
        resourcesCount: Array.isArray(ws.resources) ? ws.resources.length : 0,
        referenceCount: typeof ws.referenceCount === 'number' ? ws.referenceCount : 0,
        assetsReady: ws.assetsReady === true
      }
    }
  })
]
```

- 薄适配：collector **不**直接依赖 `teaching-workspace.ts` / `resource-grounder` 巨石
- processCrashMarker store 覆盖行为不变（ADR-0084/0093 SoT）
- 公开 IPC payload 仍为 ADR-0084 闭集：renderer **不能**注入 free-form facts

### 4. 不变量（产品地板）

- Doctor 只读；`autoRepairAllowed` 恒 false
- 无 auto-repair / 无 invent sources / 无在 doctor run 时改 resources
- 无 auto-upload / OTEL / Statsig / Mixpanel
- 无 shell / MCP marketplace / YOLO / always-approve
- 不触碰 settlement / coordinator / `toolsReplayed`
- 不 peel `teaching-workspace.ts` / resource-grounder / ledger / turn-coordinator

## 不包含 / residual

- **完整 ResourceGrounder / GroundingPack / mission-descriptor deep ground** 仍 residual（本切片接受 thin summary projection）
- session/outcome crash-window deep scan 由 sibling ADR-0104 拥有（本切片不改其模块）
- auto-repair / clear marker / support-bundle upload 仍 **不做**
- S-03 peel **不在本切片**

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-doctor-source-gap-facts.unit.test.ts `
  tests/unit/teaching-doctor-config-facts.unit.test.ts `
  tests/unit/teaching-doctor-catalog-facts.unit.test.ts `
  tests/unit/teaching-doctor-product-run.unit.test.ts `
  tests/unit/teaching-doctor.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-11 residual：source-gap facts collector **已落地（ADR-0105）** — gateway 注入 `createTeachingDoctorSourceGapFactsCollector`（active workspace summary 投影：resources/referenceCount/assetsReady）；`source_gap` 产品路径可诊断；无 active workspace → skipped；非完整 GroundingPack；IPC 仍闭集；auto-repair residual。
