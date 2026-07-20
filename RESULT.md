# P2-5 RESULT: Config Optimistic Concurrency

## Summary
Added write-side optimistic concurrency (CAS) for teaching config / settings so external editor races do not silently clobber. Pure core compares `expectedFingerprint` against the current secret-free resolved fingerprint, rejects secret-path patches, and re-resolves after applying the user/workspace overlay.

## Files
| Path | Role |
|------|------|
| `src/shared/teaching-types/config-optimistic-write.ts` | Shared types: `ConfigWriteRequest`, `ConfigWriteResult`, `ConfigOptimisticStore` |
| `src/main/config-optimistic-writer.ts` | Pure `compareAndProjectConfigWrite` + thin `writeConfigOptimistic` adapter |
| `src/shared/teaching-types.ts` | Barrel re-export |
| `tests/unit/config-optimistic-writer.unit.test.ts` | Happy path, mismatch, secret rejection, fingerprint change, adapter |
| `scripts/check-config-optimistic-concurrency.mjs` | Static + unit gate |
| `package.json` | `check:config-optimistic-concurrency` script |

## Behavior
1. **Match** → apply `next` as user/workspace overlay (shallow-merge when base layer present), re-resolve via `resolveTeachingConfig`, return new `sha256:…` fingerprint.
2. **Mismatch** → `{ ok: false, code: 'fingerprint_mismatch', currentFingerprint, message }` — no apply.
3. **Secret paths** in `next` (apiKey, proxy.url, webSearch.*ApiKey, …) → `{ ok: false, code: 'secret_path_rejected', message }` — no apply.
4. Invalid input / empty fingerprint → structured `invalid_*` codes.
5. Optional `ConfigOptimisticStore` adapter: `read → CAS → writeAtomic`.

## Verify
```bash
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/config-optimistic-writer.unit.test.ts
node scripts/check-config-optimistic-concurrency.mjs
# or
pnpm run check:config-optimistic-concurrency
```

## Out of scope (as specified)
File watcher daemon, full settings UI, alternate secret encryption.
