# ADR-0107：Support-bundle 共用 observability/redact 切换

- **状态：** 已实施（ADOPTION B-11 residual — support-bundle common redact switch）
- **日期：** 2026-07-21
- **范围：** 将 `support-bundle.ts` 中与路径/密钥相关的**通用**脱敏逻辑切换到共享 `src/main/observability/redact.ts` 原语；**保留** bundle 本地 deep JSON / denied-field / stable-identifier 策略；**不**引入 auto-repair / auto-upload / 远程 telemetry
- **相关：** [ADR-0007](0007-persisted-user-history-redaction.md)、[ADR-0034](0034-redacted-support-bundle.md)、[ADR-0066](0066-local-observability-and-crash-marker.md)、[ADR-0084](0084-teaching-doctor-product-ipc.md)
- **证据路径：**
  - `src/main/support-bundle.ts`（import 共享 `REDACTED_ABSOLUTE_PATH` / `redactPath` / `redactExportString`；删除本地 `scrubAbsolutePaths` / `tryWorkspaceRelative` / `looksLikeAbsolutePath` 等重复实现；薄 wrapper + 本地 deep JSON 策略）
  - `src/main/observability/redact.ts`（既有共享原语；本切片**不**扩展 API）
  - `src/main/observability/bootstrap-residual.ts`（residual 注释：common redact residual 关闭）
  - `tests/unit/support-bundle.unit.test.ts` / `tests/unit/local-observability.unit.test.ts` / `tests/unit/agent-secret-redaction.unit.test.ts`
  - 本 ADR

## 背景

ADR-0034 定义 consent-gated、fail-closed 的 support bundle 预览/导出。ADR-0066 抽出本地可观测性与共享 `observability/redact`（`redactSecrets` / `redactPath` / `redactExportString`、`REDACTED_ABSOLUTE_PATH`），避免 observability 依赖 support-bundle 内部。

B-11 residual 期间 `support-bundle.ts` 仍保留一套**重复**的本地 path/secret scrub 助手（本地 `REDACTED_ABSOLUTE_PATH`、`scrubAbsolutePaths`、`tryWorkspaceRelative`、`looksLikeAbsolutePath`、本地 `redactPath`/`redactText`）。这与共享原语漂移风险并存，也使 bootstrap residual 注释继续把「support-bundle public redact re-export」标为可选 secondary。

本切片目标是 **common path/secret 脱敏单源化**，不是改 consent 门、section allowlist，也不是 auto-repair。

## 决定

### 1. 共享原语为 path/secret 真相源

`support-bundle.ts` 从 `./observability/redact` 导入：

| 符号 | 用途 |
| --- | --- |
| `REDACTED_ABSOLUTE_PATH` | 绝对路径 stub；标记串仍为 `'<redacted-absolute-path>'` |
| `redactPath`（as `sharedRedactPath`） | 路径字段与 free-text 中的绝对路径 scrub |
| `redactExportString` | 自由文本：secrets + paths 组合 |

本地仅保留 **薄 wrapper**：

- `redactPath(value, workspaceRoot)` → `sharedRedactPath(...)`
- `redactText(value, workspaceRoot?)` → `compact(redactExportString(...), MAX_STRING_LENGTH)`

`redactAgentSecretText` 仍由 `redactStringValue` 在 stable-id 旁路之外显式使用（与 `check:support-bundle` 静态门及既有 secret 边界一致）；共享 `redactSecrets` / `redactExportString` 内部亦走同一 agent-secret 原语。

### 2. Bundle 本地策略保留

以下**不得**迁入共享 `redact.ts`（本切片也不迁）：

- `deepRedactJson` 深度/数组截断
- `DENIED_FIELD_NAMES` / `isDeniedFieldName`（prompt / learnerAnswer / apiKey 等字段整值替换）
- `looksLikeStableIdentifier` + `redactStringValue` 的 stable-id 旁路（避免 checkId / snake_case code 被高熵检测误伤）
- section builders 与 consent/allowlist 装配

### 3. 删除的本地重复

完全删除且不再引用：

- 本地 `const REDACTED_ABSOLUTE_PATH = ...`（改 import）
- `scrubAbsolutePaths`
- `tryWorkspaceRelative`
- `looksLikeAbsolutePath`
- 本地完整 `redactPath` 实现体（改为薄 wrapper）
- 对 `normalizeWorkspaceRelativePath` 的 support-bundle 依赖（路径归一化由共享 `redact` 内部完成）

若共享行为与历史本地实现有细微差异（例如 free-text 中 workspace-root 前缀剥离细节），**优先共享实现**，保持 fail-closed：密钥与绝对路径仍不得外泄。

### 4. Bootstrap residual 文案

`LOCAL_CRASH_MARKER_BOOTSTRAP_RESIDUAL` **常量值不变**（`main-process-hook-wired+product-ipc`，单元断言依赖）。仅更新注释：common support-bundle path/secret 已切共享；不再把「support-bundle public redact re-export」列为 open residual。Support-bundle **internals** 仍不公开 re-export。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/support-bundle.unit.test.ts `
  tests/unit/agent-secret-redaction.unit.test.ts `
  tests/unit/local-observability.unit.test.ts

pnpm run check:support-bundle
```

## 明确不包含 / non-claims

1. **不** auto-repair / auto-clear crash marker / auto-upload support bundle。
2. **不** 远程 telemetry / OTEL / Statsig / Mixpanel / phone-home。
3. **不** 改 consent 门、section allowlist、schemaVersion、redactionPolicy 字段语义。
4. **不** 把 support-bundle 内部 deep JSON 策略提升为公共 API；**不** 让 support-bundle 依赖 doctor collectors。
5. **不** 引入 shell / YOLO / MCP marketplace / 任意代码执行。
6. **不** 改 ADOPTION.md 正文（本切片仅 ADR + 代码切换）。
7. **不** 扩展 `observability/redact` 公共面（本切片 prefer 既有 API）。

## 与 ADOPTION B-11 的关系

- ADR-0066 落地共享 redact + crash marker；ADR-0034 落地 support-bundle consent export。
- 本 ADR 关闭 B-11 residual 中 **support-bundle common redact 切换** 一项：通用 path/secret 单源化到 `observability/redact`，bundle 策略层保留。
