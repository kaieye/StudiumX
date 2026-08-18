# ADR-0093：TeachingDoctor multi-collector pure facts assemble

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（纯 multi-collector assemble + product-run deps 注入；**无** Settings Doctor UI；**无** 完整 workspace FS collectors）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-11 residual** — 为 TeachingDoctor product run 落地纯 multi-collector facts 组装，使 main 可渐进挂接 collectors，**不**改变公开 IPC payload
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0043](0043-doctor-config-locator-and-fix-suggestion.md)、[ADR-0066](0066-local-observability-and-crash-marker.md)、[ADR-0084](0084-teaching-doctor-product-ipc.md)
- **证据：** 
  - `src/main/observability/teaching-doctor-facts-assemble.ts`（`assembleTeachingDoctorFacts` / `staticTeachingDoctorFactsCollector`）
  - `src/main/observability/teaching-doctor-product-run.ts`（`factsCollectors?` deps + assemble 后 store SoT）
  - `src/main/observability/index.ts`（导出）
  - `tests/unit/teaching-doctor-facts-assemble.unit.test.ts`
  - `tests/unit/teaching-doctor-product-run.unit.test.ts`

## 背景

ADR-0084 已落地 product IPC `teach:run-teaching-doctor`：payload 仅 `includeProcessCrashMarker?`，process crash marker 由 main store 作为 SoT 组装，pure doctor 返回 export-safe report。B-11 residual 仍提到 multi-collector workspace facts 与 Settings Doctor UI。本切片优先 **纯 multi-collector assemble**（低风险），便于 composition root 渐进注入 collectors，而不打开 renderer 自由 facts 面，也不在本轮改 gateway（B-02 拥有）。

## 决策

### 1. 纯 multi-collector assembler

`assembleTeachingDoctorFacts({ base?, collectors? })`：

1. 起点：`base ?? {}` 的浅拷贝。
2. 按顺序运行 collectors；成功时 **顶层 key 浅合并**（非 null/undefined 才覆盖）；**不** deep-merge 嵌套对象。
3. collector throw / reject → **skip** 该 collector（fail-soft）；**不**向外抛 secrets/paths。
4. **不**在 assembler 内调用 `runTeachingDoctor`（doctor 仍纯、只读）。

提供 `staticTeachingDoctorFactsCollector(id, partial)` 作为测试 / 未来 composition 的无 I/O 工厂。

### 2. Product-run 接线

`ProductTeachingDoctorDeps` 扩展：

```ts
factsCollectors?: readonly TeachingDoctorFactsCollector[]
```

`runProductTeachingDoctor` 顺序：

1. `facts = await assembleTeachingDoctorFacts({ base: input?.facts, collectors: deps.factsCollectors })`
2. 当 `includeProcessCrashMarker !== false` 且 store 存在：`processCrashMarker` **由 store 覆盖**（store 仍为 product SoT）
3. pure `runTeachingDoctor` + `exportTeachingDoctorReport`

Gateway **无需**本轮改动：collectors 仅经 deps 注入；公开 IPC payload 仍为 ADR-0084 闭集（renderer **不能**注入自由 facts）。composition root 可在后续把 collectors 传入 deps。

### 3. 不变量（继承产品地板）

- Doctor 只读；`autoRepairAllowed` 恒 false；`workspaceOpenPolicy: read_only_allowed`
- 无 auto-repair / auto-upload / OTEL / Statsig / Mixpanel
- 无 shell / MCP marketplace / YOLO / always-approve
- 不在 doctor run 时 clear crash marker
- 不触碰 settlement / coordinator / `toolsReplayed`

## 不包含 / residual

- **Settings Doctor UI 面板**仍 residual（本切片不实现）
- **真实 workspace session / outcome / source / catalog FS collectors** 仍 residual：待产品需要时以 pure/thin 工厂接入，禁止借机 peal ledger/settlement 巨石
- Support-bundle public re-export of redact helpers 仍 optional secondary
- **不**改 teaching-ipc-gateway / preload / contract / system-api（IPC 形状不变）
- **不** auto-clear marker / auto-repair / upload

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-doctor-facts-assemble.unit.test.ts `
  tests/unit/teaching-doctor-product-run.unit.test.ts `
  tests/unit/teaching-doctor.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-11 residual：multi-collector pure facts assemble **已落地（ADR-0093）** — `assembleTeachingDoctorFacts` + product-run `factsCollectors` deps；processCrashMarker store SoT 保留；IPC 仍闭集（ADR-0084）；Settings Doctor UI / 真实 workspace session·outcome collectors 仍 optional residual。
