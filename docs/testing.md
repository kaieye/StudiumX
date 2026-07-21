# Testing doctrine (StudiumX)

## Prefer behavior contracts

New automated checks should:

1. **Import real modules** and exercise them against temp workspaces / fixtures when possible.
2. Assert **stable public outcomes** (return codes, typed results, ledger receipts, redacted fields).
3. Keep Playwright / full Electron E2E for longitudinal teaching loops — not every PR gate.

## Source-regex checks

Pure `readFile` + string/regex assertions over production source are allowed **only** for:

- packaging metadata
- allowlisted security invariant strings that cannot be unit-imported cheaply

New checks that are regex-only without a runtime fixture should be treated as technical debt; Blocking CI prefers small hard gates (see ADR-0023 philosophy).

## Local pre-push subset

```bash
pnpm run check:prepush
```

Runs typecheck + security subset. It is intentionally smaller than release-audit.

## Related

- `pnpm run check:tool-contract`
- `pnpm run check:security`
- ADR-0017 release audit policy
- ADR-0045 context hygiene ladder + quality gates
