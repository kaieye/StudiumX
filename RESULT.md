# P2-01 Learning Branch Projection — RESULT

## Summary

Read-only **Learning Branch Projection** that derives primary + alternate path views from durable session/planner facts without mutating canonical outcome history.

- Primary path reuses `planNextTeachingStep` so it always mirrors current planner decisions.
- Alternate branches are counterfactual projections only (`canonical: false`), e.g. needs_practice retry, not_evidenced clarification, resources not ready.
- Legacy/read-only sessions stay clarification-only (no remediation alternates).
- Optional `historySessions` summaries (id/status/outcomeKind only) become non-canonical `historical` nodes.
- Fingerprint is `sha256:<hex>` over schema/nodes/paths (excludes `generatedAt`); no I/O, no writers, no random state.

## Files

| Path | Role |
|------|------|
| `src/shared/teaching-types/learning-branch-projection.ts` | Shared types (`schemaVersion=1`, facts, nodes, projection) |
| `src/main/learning-branch-projection.ts` | Pure `projectLearningBranch` / factory / fingerprint |
| `tests/unit/learning-branch-projection.unit.test.ts` | Unit coverage |
| `scripts/check-learning-branch-projection.mjs` | Static + unit gate |
| `src/shared/teaching-types.ts` | Barrel re-export |
| `package.json` | `check:learning-branch-projection` script |

## Out of scope (intentionally not done)

- UI picker, IPC host wiring
- Changing planner actions
- Writing branch state to disk as truth

## Verify

```bash
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/learning-branch-projection.unit.test.ts
node scripts/check-learning-branch-projection.mjs
# or
pnpm run check:learning-branch-projection
```

## Test results

- Unit: 9 passed
- Gate: `learning branch projection gate ok`
