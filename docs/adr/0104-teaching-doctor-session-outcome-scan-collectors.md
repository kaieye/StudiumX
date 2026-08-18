# ADR-0104：TeachingDoctor session/outcome crash-window scan collectors（product gateway 注入）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（session + outcome crash-window scan-derived collectors + gateway inject；source-gap residual 由其它切片负责）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-11 residual** — product TeachingDoctor 路径注入真实 session/outcome crash-window facts collector（active workspace + `createLearningSessionLedger(...).scan()` 一次加载 + pure maps），使 `p0_session_event_manifest_crash_window` 与 `p0_outcome_publication_crash_window` 在有工作区时不再默认 skipped
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0084](0084-teaching-doctor-product-ipc.md)、[ADR-0093](0093-teaching-doctor-multi-collector-facts.md)、[ADR-0095](0095-teaching-doctor-settings-ui.md)、[ADR-0099](0099-teaching-doctor-config-facts-collector.md)、[ADR-0102](0102-teaching-doctor-catalog-drift-collector.md)
- **证据：** 
  - `src/main/observability/teaching-doctor-session-outcome-facts.ts`（`createTeachingDoctorSessionOutcomeScanFactsCollector` + pure mappers）
  - `src/main/observability/index.ts`（导出）
  - `src/main/teaching-ipc-gateway.ts`（doctor action `factsCollectors` 注入 session-outcome 与既有 config / catalog / source-gap）
  - `tests/unit/teaching-doctor-session-outcome-facts.unit.test.ts`
  - 本 ADR

## 背景

ADR-0084 落地 product IPC `teach:run-teaching-doctor`（payload 闭集；process crash marker store SoT）。ADR-0093 落地 pure multi-collector assemble 与 `deps.factsCollectors?`。ADR-0099 / ADR-0102 分别落地 config 与 catalog-drift collectors 的 gateway 注入。

纯检查 `checkSessionEventManifestCrashWindow` / `checkOutcomePublicationCrashWindow` 已存在于 `src/main/teaching-doctor.ts`，消费 `facts.sessionCrashWindow` / `facts.outcomeCrashWindow`。此前 product gateway **未**挂 session/outcome collector，故这两项在产品路径上恒为 `skipped`（除非测试手写 facts）。B-11 residual 需要真实、只读、scan-derived 的 crash-window 探测——**且不得**调用 `LearningOutcomeCommitter.reconcile`（会 mutate/repair）。

## 决策

### 1. Fail-soft session+outcome scan facts collector factory（一次 scan）

`createTeachingDoctorSessionOutcomeScanFactsCollector(source)`：

- `id: 'session-outcome-scan'`
- `source.loadScan()`：注入适配；产品路径由 gateway 实现为：
  1. `workspaceService.getState()` → `activeWorkspace`
  2. 无 `rootPath` / 无 active workspace → `null`
  3. 有 workspace → `createLearningSessionLedger({ workspaceRoot }).scan()`（公共 factory only；**不** peel ledger 巨石）
- **成功且 scan 非 null：** 一次 load 同时返回
  - `sessionCrashWindow: mapScanToSessionCrashWindowFacts(scan)`
  - `outcomeCrashWindow: mapScanToOutcomeCrashWindowFacts(scan)`
- **null/undefined scan（无 active workspace）：** 返回空 partial `{}`，使 pure checks 保持 **`skipped`**（「facts 未供给」语义）
- **loadScan throw：** fail-soft 返回 `{}` — doctor 呈 skipped，不崩溃、不泄漏错误串
- **永不** secrets / 绝对 home 路径 / free-form renderer facts / auto-repair

### 2. Pure mapping 规则（scan-derived；无 reconcile）

#### Session crash-window

| 字段 | 规则 |
| --- | --- |
| `pendingStageCount` | `stages` 中 `state === 'pending'` 计数 |
| `unsafeStageCount` | `stages` 中 `state === 'unsafe'` 计数 |
| `quarantinedSessionCount` | `quarantined.length` |
| `recoveryCount` | `recoveries.length` |
| `diagnosticCodes` | 唯一非空 diagnostic `code`，硬顶 **16**；丢弃 path/secret 形态 |
| `eventManifestGapCount` | `kind ∈ {event,manifest}` 且 `state ∈ {pending,unsafe}` 计数 |

#### Outcome crash-window（启发式；**不** deep-inspect settlement FS）

优先 `canonicalSessions`；否则 `sessions` 中非 legacy / 非 `readOnly` 行：

| 字段 | 规则 |
| --- | --- |
| `settledCount` | `outcomeRef != null` 的 session 计数 |
| `needsProjectionRepairCount` | `status === 'completed'` 且 `outcomeRef` 为 null/absent |
| `pendingSettlementCount` | stages 中 `kind === 'session'` 且 `state === 'pending'` |
| `reviewRequiredCount` | diagnostics code ∈ `{invalid_session_outcome, unknown_session_schema, canonical_identity_conflict}`，以及任意 code（不区分大小写）包含 `outcome` |

### 3. Gateway composition 注入（与 config / catalog 并列）

```ts
factsCollectors: [
  createTeachingDoctorConfigFactsCollector({ load: () => context.settingsService.load() }),
  createTeachingDoctorSessionOutcomeScanFactsCollector({
    loadScan: async () => {
      const state = await context.workspaceService.getState()
      const ws = state.activeWorkspace
      if (!ws?.rootPath) return null
      return createLearningSessionLedger({ workspaceRoot: ws.rootPath }).scan()
    }
  }),
  createTeachingDoctorCatalogDriftFactsCollector({ /* ... existing ... */ }),
  // source-gap collector may coexist (other residual / ADR)
]
```

- 薄适配：collector **不**直接依赖 ledger 内部；gateway 注入 `loadScan`
- 复用既有公共 `createLearningSessionLedger(...).scan()`（只读 scan 语义相对 product doctor；**永不**调用 `reconcile`）
- processCrashMarker store 覆盖行为不变（ADR-0084/0093 SoT）
- 公开 IPC payload 仍为 ADR-0084 闭集

### 4. 不变量（产品地板）

- Doctor 只读；`autoRepairAllowed` 恒 false
- **禁止** doctor 路径调用 `LearningOutcomeCommitter.reconcile` 或任何 outcome write/repair
- 无 auto-repair / clear crash marker / upload / OTEL / Statsig / Mixpanel
- 无 shell / MCP marketplace / YOLO / always-approve
- 不触碰 settlement sole-writer / coordinator / `toolsReplayed`
- 不 peel `learning-session-ledger.ts` / `teaching-workspace.ts` / `teaching-turn-coordinator.ts`

## 不包含 / residual

- source-gap 真实 collector（若未在其它切片落地）仍可能 residual — **不**在本 ADR 范围内强制实现
- auto-repair / clear marker / support-bundle upload 仍 **不做**
- per-session settlement FS deep inspect / mutate-based settlement 状态机 **不做**
- S-03 agent-loop peels / B-08 catalog policy 不在本切片

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-doctor-session-outcome-facts.unit.test.ts `
  tests/unit/teaching-doctor-catalog-facts.unit.test.ts `
  tests/unit/teaching-doctor-config-facts.unit.test.ts `
  tests/unit/teaching-doctor-product-run.unit.test.ts `
  tests/unit/teaching-doctor-facts-assemble.unit.test.ts `
  tests/unit/teaching-doctor.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-11 residual：session/outcome crash-window scan collectors **已落地（ADR-0104）** — gateway 注入 `createTeachingDoctorSessionOutcomeScanFactsCollector`（一次 `createLearningSessionLedger(...).scan()` + pure maps）；无 active workspace → skipped；**不** reconcile；IPC 仍闭集；auto-repair residual。
