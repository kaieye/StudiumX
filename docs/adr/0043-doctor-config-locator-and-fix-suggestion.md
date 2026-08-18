# ADR-0043：TeachingDoctor 配置定位路径与结构化修复建议

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** TeachingDoctor 增加 `configPath` 与结构化 `TeachingDoctorFixSuggestion`（code/title/steps/configPath/docsRef）；v1 autoRepair 仍恒为 disabled。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0034](0034-redacted-support-bundle.md)
- **证据：** `src/shared/teaching-types/teaching-doctor.ts`、`src/main/teaching-doctor.ts`、`tests/unit/teaching-doctor.unit.test.ts`

## 决定

TeachingDoctor 在既有 recommendedAction/repair 之上增加：

1. **configPath**（逻辑/脱敏配置定位，如 `userData/studiumx-settings.json`）
2. **TeachingDoctorFixSuggestion**（code/title/steps/configPath/docsRef）

Config facts 可携带 `configPath` / `configKey`。失败与未配置 provider 时给出可操作步骤，并指向 diagnosing skill id（如 `diagnosing-provider`）。

**v1 autoRepair 仍恒为 disabled**；Doctor 失败不阻断 read-only workspace open。

## 已实施范围与验证入口

- `src/shared/teaching-types/teaching-doctor.ts`
- `src/main/teaching-doctor.ts`
- `tests/unit/teaching-doctor.unit.test.ts`

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-doctor.unit.test.ts
```

## 不变量

- 导出与 evidence 不得含 secrets、完整绝对家目录路径、raw learner answers。
- fixSuggestion 仅为手动修复建议，永不自动执行。

## 不包含

- 不授权 auto-repair worker。
- 不实现 diagnosing skill 包本体（Phase B）。
