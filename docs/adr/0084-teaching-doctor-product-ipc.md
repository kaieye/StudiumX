# ADR-0084：TeachingDoctor product IPC（process crash-marker facts assemble + run）

- **状态：** 已实施（product invoke + fail-closed parser + preload whitelist + pure assembler；**无**完整 Settings Doctor UI 面板）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-11 residual** — 产品 IPC 组装 process crash marker 事实并运行 pure TeachingDoctor，返回 export-safe report
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0043](0043-doctor-config-locator-and-fix-suggestion.md)、[ADR-0066](0066-local-observability-and-crash-marker.md)、[ADR-0082](0082-agent-chat-steer-followup-ipc.md)（IPC 形状先例）
- **证据路径：**
  - `src/main/observability/teaching-doctor-product-run.ts`（`runProductTeachingDoctor`）
  - `src/main/observability/process-crash-marker-facts.ts`（collector map）
  - `src/main/teaching-doctor.ts`（pure `runTeachingDoctor` / `exportTeachingDoctorReport`）
  - `src/shared/teaching-ipc-contract.ts`（`runTeachingDoctor: 'teach:run-teaching-doctor'`）
  - `src/shared/teaching-types/system-api.ts` / `teaching-doctor.ts`（API + `RunTeachingDoctorPayload`）
  - `src/main/teaching-ipc-commands.ts`（`parseRunTeachingDoctorPayload`）
  - `src/main/teaching-ipc-gateway.ts`（`crashMarkerStore` 注入 + command）
  - `src/main/index.ts`（composition root 传入 `crashMarkers`）
  - `src/preload/index.ts`（channel whitelist）
  - `tests/unit/teaching-doctor-product-run.unit.test.ts`

## 背景

ADR-0066 落地了 local crash marker store 与 main-process hooks，pure TeachingDoctor 已有 `local_process_crash_marker` check。B-11 residual 要求 **产品侧** 能 assemble `TeachingDoctorFacts.processCrashMarker` 并 run doctor，而不仅是 CLI snapshot / pure mapper。

## 决策

### 1. Invoke channel（闭集）

| TeachingSystemApi | Channel |
| --- | --- |
| `runTeachingDoctor` | `teach:run-teaching-doctor` |

Payload 精确形状：`undefined` / `{}` / `{ includeProcessCrashMarker?: boolean }`。解析 fail-closed：拒绝未知键、非 boolean include flag。**不**接受 renderer 自由 facts（避免伪造证据 / 路径泄漏面）。

### 2. Assembler 行为

`runProductTeachingDoctor(input, deps)`：

1. 起点 `input.facts ?? {}`（IPC 路径不传 facts；仅测试 / 未来 multi-collector 注入）。
2. 当 `includeProcessCrashMarker !== false` 且 `deps.crashMarkerStore` 存在：  
   `processCrashMarker = await collectProcessCrashMarkerFacts(store)`（**store 为 SoT**，覆盖 caller 同名字段）。
3. `report = runTeachingDoctor(facts, now())` → `exportTeachingDoctorReport(report)` 返回 renderer。
4. store read 失败 → `{ present: false }`；**不** throw secrets/paths。

### 3. Gateway 组合

- `TeachingIpcRegistration.crashMarkerStore?` 只要求 `read()`。
- `src/main/index.ts` 在 whenReady 创建的 `crashMarkers` 闭包传入 gateway。
- **不**在 doctor run 时 clear marker；clear 仍是独立 deliberate effect。

### 4. Preload

仅 whitelist `runTeachingDoctor`；**不**实现 Settings Doctor UI 面板。

## 不变量

- Doctor 只读；`autoRepairAllowed` 恒 false；`workspaceOpenPolicy: read_only_allowed`
- 无默认 remote telemetry / auto-upload / OTEL / Statsig / Mixpanel
- 无 shell / MCP marketplace / YOLO / always-approve
- 不触碰 settlement / coordinator / `toolsReplayed`
- 导出字符串 fail-closed 脱敏（既有 doctor export + local redact helpers）

## 不包含 / residual

- **Rich Settings Doctor UI 面板**仍可选 residual（IPC 已足够 residual closure of “product can assemble facts”）
- **Full multi-collector workspace facts**（session/outcome/config/source/catalog）仍 optional；本切片仅 process crash marker
- Support-bundle public re-export of `redactExportString` 仍 optional secondary
- **不** auto-clear crash marker on doctor run
- **不** auto-repair / upload

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-doctor-product-run.unit.test.ts `
  tests/unit/teaching-doctor.unit.test.ts `
  tests/unit/local-observability.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-11 residual：product TeachingDoctor IPC **已落地（ADR-0084）** — process crash-marker facts assemble + pure run + export-safe report；rich UI panel / full multi-collector workspace facts 仍 residual；support-bundle public redact switch 仍 optional secondary。
