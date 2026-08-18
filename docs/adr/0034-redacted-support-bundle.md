# ADR-0034：脱敏 Support Bundle（预览 + 同意后导出）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 支持导出分 preview（脱敏可预览 sections）与 export（仅 `consent.accepted === true` 且 section ∈ preview ∩ 同意范围）两步；默认无 raw prompt / secret / 完整绝对路径。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0001](0001-rebuildable-sqlite-projection.md)
- **证据：** `src/shared/teaching-types/support-bundle.ts`、`src/main/support-bundle.ts`、`scripts/check-support-bundle.mjs`、`tests/unit/support-bundle.unit.test.ts`；提交 `35dde79`、merge `899aeb3`

## 决定

支持导出分两步：

1. `previewSupportBundle(input)` → 脱敏可预览 sections（doctor / inspector / config_fingerprint / capability / audit_correlation / environment）
2. `exportSupportBundle(preview, consent)` → 仅当 `consent.accepted === true` 且 section ∈ preview ∩ `consent.sectionsAllowed` 时导出；否则 `consent_required` / `section_not_previewed`

RedactionPolicy：无 raw prompts、无 API keys、无完整 home 绝对路径（改写为 workspace-relative 或 `<redacted-absolute-path>`）、无 learner answers。复用 `exportTeachingDoctorReport`、`redactAgentSecretText` 与 audit 安全导出模式。Doctor fail 仍可导出。

## 已实施范围与验证入口

- `src/shared/teaching-types/support-bundle.ts`
- `src/main/support-bundle.ts`
- `scripts/check-support-bundle.mjs`

```powershell
pnpm run check:support-bundle
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/support-bundle.unit.test.ts
```

## 不变量

- 无同意不得导出。
- 默认红acted；不得夹带 raw transcript / provider payload。
- 导出失败码对用户可解释且不泄露 secret。

## 与 backup / export 的关系（DB-P1-5 交叉）

Support bundle **不是**完整教学备份。完整备份路径分类与 export 默认（排除 disposable projection）见 [ADR-0001](0001-rebuildable-sqlite-projection.md)「Backup / export 与可丢弃投影」与 `src/shared/backup-export-policy.ts`。Bundle 默认仍禁止夹带完整 conversation/memory 正文与 secret keys。

## 不包含

- 不授权自动上传、邮件发送或完整 conversation transcript。
- 不替代 C-4P9 audit wire（ADR-0019）或 Doctor/Inspector 诊断权威（ADR-0027）。
- 不把 `studiumx-index.sqlite` 或其它 projection 当作可恢复权威。
