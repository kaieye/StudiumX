# ADR-0099：TeachingDoctor config facts collector（product gateway 注入）

- **状态：** 已实施（config collector + gateway inject；IPC payload 闭集不变）
- **日期：** 2026-07-21
- **范围：** ADOPTION **B-11 residual** — product TeachingDoctor 路径注入真实 config facts collector（`TeachingSettingsService.load` 适配），使 `config_availability` 不再默认 skipped
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0043](0043-doctor-config-locator-and-fix-suggestion.md)、[ADR-0084](0084-teaching-doctor-product-ipc.md)、[ADR-0093](0093-teaching-doctor-multi-collector-facts.md)、[ADR-0095](0095-teaching-doctor-settings-ui.md)
- **证据路径：**
  - `src/main/observability/teaching-doctor-config-facts.ts`（`createTeachingDoctorConfigFactsCollector`）
  - `src/main/observability/index.ts`（导出）
  - `src/main/teaching-ipc-gateway.ts`（doctor action `factsCollectors` 注入）
  - `tests/unit/teaching-doctor-config-facts.unit.test.ts`
  - 本 ADR

## 背景

ADR-0084 落地 product IPC `teach:run-teaching-doctor`（payload 闭集；process crash marker store SoT）。ADR-0093 落地 pure multi-collector assemble 与 `deps.factsCollectors?`。ADR-0095 落地 Settings 只读 Doctor UI。

此前 product gateway 仅注入 `crashMarkerStore`，**未**挂真实 collectors，故 `config_availability` 在产品路径上恒为 `skipped`。B-11 residual 需要至少一个有意义的真实 collector：settings/config 可用性探测。

## 决策

### 1. Fail-soft config facts collector factory

`createTeachingDoctorConfigFactsCollector(source, options?)`：

- `id: 'config-settings'`
- `source.load()`：注入适配（产品路径 = `context.settingsService.load()`）
- 成功且 load 返回 object：
  - `settingsAvailable` / `settingsReadable` / `settingsParseable` = true
  - `providerConfigured`：active/any provider 非空 `apiKey` **或** 非空 `models`，**或** `generator.model` 非空
  - `reason`：稳定短码（如 `provider_not_configured` / `settings_unparseable` / `settings_load_failed`）
  - `configPath`：仅逻辑标签默认 `userData/studiumx-settings.json`（**永不**绝对 home 路径）
- load throw：返回结构化不可用 facts（`settings_load_failed`），使 doctor 呈 fail/warning 而非 skipped
- **永不**把 raw `apiKey` 或其它 secrets 写入 facts / evidence

### 2. Gateway composition 注入

```ts
runProductTeachingDoctor(request, {
  crashMarkerStore: context.crashMarkerStore ?? null,
  factsCollectors: [
    createTeachingDoctorConfigFactsCollector({
      load: () => context.settingsService.load()
    })
  ]
})
```

- processCrashMarker store 覆盖行为不变（ADR-0084/0093 SoT）
- 公开 IPC payload 仍为 ADR-0084 闭集：renderer **不能**注入 free-form facts

### 3. 不变量（产品地板）

- Doctor 只读；`autoRepairAllowed` 恒 false
- 无 auto-repair / auto-upload / OTEL / Statsig / Mixpanel
- 无 shell / MCP marketplace / YOLO / always-approve
- 不在 doctor run 时 clear crash marker
- 不触碰 settlement / coordinator / `toolsReplayed`

## 不包含 / residual

- **session / outcome / source / catalog FS collectors** 仍 residual
- auto-repair / clear marker / support-bundle upload 仍 **不做**
- Settings UI 重写不在本切片（ADR-0095 已交付）
- 不 peel ledger / settlement 巨石

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-doctor-config-facts.unit.test.ts `
  tests/unit/teaching-doctor-product-run.unit.test.ts `
  tests/unit/teaching-doctor-facts-assemble.unit.test.ts
```

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- B-11 residual：config facts collector **已落地（ADR-0099）** — gateway 注入 `createTeachingDoctorConfigFactsCollector`；`config_availability` 产品路径可诊断；IPC 仍闭集；session/outcome/source/catalog FS collectors / auto-repair residual。
