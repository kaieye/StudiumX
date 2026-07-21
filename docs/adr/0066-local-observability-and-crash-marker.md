# ADR-0066：本地可观测性（turn/tool 相关 + crash marker + 导出 fail-closed 脱敏）

- **状态：** 已实施（ADOPTION B-11）
- **日期：** 2026-07-21
- **范围：** 进程内 turn/tool 相关 ID、appData crash marker、导出字符串 fail-closed 脱敏；**无**默认远程 telemetry
- **相关：** [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md)、[ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0028](0028-teaching-audit-correlation-safe-metadata.md)、[ADR-0034](0034-redacted-support-bundle.md)、[ADOPTION B-11](0121-improvements-adoption-closeout.md)
- **证据路径：** `src/main/observability/*`、`src/main/index.ts`（hook install）、`scripts/lib/doctor-snapshot.mjs`（CLI facts）、`src/main/teaching-doctor.ts`、`src/shared/teaching-types/teaching-doctor.ts`、`tests/unit/local-observability.unit.test.ts`、`tests/unit/teaching-doctor.unit.test.ts`

## 背景

本地诊断需要把一次 turn 与 tool span 关联起来，并在异常退出后于下次启动通过 TeachingDoctor 可见。产品地板禁止默认 phone-home / OTEL / Statsig / Mixpanel 式外发；support 导出已有 ADR-0034 脱敏边界。B-11 补齐**纯本地**原语，而不是远程观测栈。

## 决定

1. **`createTurnContext({ runId, streamId })`**（`turn-context.ts`）  
   - 进程内分配 `turn_<12 hex>` 与递增 `tool_<suffix>_<seq>`。  
   - 无网络、无磁盘；runId/streamId 经 opaque 消毒，路径不得成为 correlation 标签。

2. **Crash marker**（`crash-marker.ts`）  
   - 路径：`<appDataRoot>/observability/crash-marker.json`（路径可注入以便测试）。  
   - 内容：`schemaVersion`、`writtenAt`、封闭 `reasonCode`、可选 `runId`。  
   - **禁止** secrets、绝对用户路径、任意扩展字段（parse fail-closed）。  
   - 提供 `write` / `read` / `clear` / `isPresent` 与 `installLocalCrashMarkerHooks`（best-effort）。  
   - **接线：** `src/main/index.ts` 在 `userDataPath` 就绪后安装 process hook，并在 `before-quit` best-effort 卸载；状态见 `bootstrap-residual.ts`（`main-process-hook-wired`）。

3. **导出脱敏**（`redact.ts`）  
   - `redactPath` / `redactSecrets` / `redactExportString` 失败时偏向过度脱敏。  
   - 独立于 support-bundle 内联实现，供 doctor/export/observability 复用；**不**重写 support-bundle 巨石。

4. **TeachingDoctor 薄接线**  
   - 新 checkId：`local_process_crash_marker`。  
   - 纯函数消费 `processCrashMarker` facts（I/O 在 collector）；present → `warning` + manual_review，不 auto-repair、不上传。  
   - 纯映射：`toProcessCrashMarkerFacts` / `collectProcessCrashMarkerFacts`（`process-crash-marker-facts.ts`）。  
   - CLI collector：`scripts/lib/doctor-snapshot.mjs` 读取 `userData/observability/crash-marker.json` 写入 `snapshot.processCrashMarker`（只读，不 clear）。  
   - **残差：** 产品 IPC/UI 尚未自动 assemble TeachingDoctorFacts 并展示；support-bundle 仍接已生成的 doctor report，不直接扫 marker。

## 已实施范围与验证入口

```powershell
pnpm exec vitest run --project unit tests/unit/local-observability.unit.test.ts
pnpm exec vitest run --project unit tests/unit/teaching-doctor.unit.test.ts
node scripts/check-teaching-doctor.mjs
```

## 不变量

- 无默认远程 telemetry / crash auto-upload。  
- crash marker 与 correlation id 不含 secrets 与可避免的绝对用户路径。  
- Doctor 保持只读；clear marker 是独立 effect。  
- 未知 / 畸形 marker → 视为 absent 或 `unknown`，不抛出敏感原文。

## 不包含 / non-claims

- **不**引入 OTEL、Statsig、Mixpanel 或默认 phone-home。  
- **不**自动上传 crash report 或 support bundle。  
- **不**引入 product IPC doctor UI（IPC 自动 facts 组装仍为可选后续）。  
- main bootstrap process hooks **已接线**（B-11 residual 闭合）。  
- **不**用 SQLite FTS / 向量库做可观测搜索面。  
- **不**扩大 support-bundle 实现面以消解既有 TS 债务。
