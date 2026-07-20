# P2-3 Advanced Technical Inspector — RESULT

## Summary
Added a **diagnostic-mode tech inspector**: pure, read-only assembler that views pre-normalized typed events, effects/tool outcomes, projection-report summaries, run lifecycle, and capability counts. Default mode is `learner_hidden` (empty sections, status `hidden`). Diagnostic mode assembles redacted sections with a secret-free `sha256:` fingerprint. No filesystem writes, no auto-repair, no UI/IPC wiring.

## Files
| Path | Role |
|------|------|
| `src/shared/teaching-types/tech-inspector.ts` | Shared contracts (`schemaVersion=1`, modes, section ids, finding/view/report models) |
| `src/main/tech-inspector.ts` | `inspectTeachingTech(input)` pure assembler + redaction + fingerprint |
| `src/shared/teaching-types.ts` | Barrel re-export |
| `tests/unit/tech-inspector.unit.test.ts` | Unit coverage (hidden default, diagnostic sections, redaction, fingerprint, immutability) |
| `scripts/check-tech-inspector.mjs` | Static + unit gate |
| `package.json` | `check:tech-inspector` script |

## How to verify
```bash
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/tech-inspector.unit.test.ts
node scripts/check-tech-inspector.mjs
# or
pnpm run check:tech-inspector
```

## Notes
- Input accepts optional pre-normalized views only (no freeform secret payloads).
- Strings pass through `redactAgentSecretText`.
- Future IPC / renderer diagnostic toggle can call `inspectTeachingTech`; wiring intentionally out of scope.
