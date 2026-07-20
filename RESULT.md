# RESULT — P2-8 Redacted Support Bundle

## Summary
Implemented a user-previewable, consent-gated support bundle export that is redacted by default (no raw prompts, no API keys/secrets, no absolute home paths, no learner answers).

## Files
- `src/shared/teaching-types/support-bundle.ts` — shared contracts (`schemaVersion=1`, section IDs, preview/consent/export, `RedactionPolicy`)
- `src/main/support-bundle.ts` — `previewSupportBundle` / `exportSupportBundle` with redaction + consent gates
- `tests/unit/support-bundle.unit.test.ts` — unit coverage
- `scripts/check-support-bundle.mjs` — static + unit gate
- `src/shared/teaching-types.ts` — barrel re-export
- `package.json` — `check:support-bundle` script

## Behavior
- **Preview** assembles optional sections: doctor, inspector, config fingerprint, capability, audit correlation, environment.
- **Redaction** reuses `exportTeachingDoctorReport`, `redactAgentSecretText`, and audit export helpers; absolute paths rewrite to workspace-relative or `<redacted-absolute-path>`.
- **Export** requires `consent.accepted === true` and only includes sections present in both preview and `consent.sectionsAllowed`.
- Failure codes: `consent_required`, `section_not_previewed`.
- Doctor `fail` remains exportable.

## Verify
```bash
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/support-bundle.unit.test.ts
node scripts/check-support-bundle.mjs
# or
pnpm run check:support-bundle
```

## Out of scope (intentionally)
- Automatic upload
- Emailing support
- Full conversation transcripts
