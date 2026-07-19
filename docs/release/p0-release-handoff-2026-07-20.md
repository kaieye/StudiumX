# P0 release handoff / review

**Date:** 2026-07-20  
**Reviewer role:** release closure orchestrator  
**Tip before this handoff commit:** `677b15b` (typecheck) on `main`

## Scope reviewed

- Steps A–C already on `main` (`99954d4`, `0bb7f86`, `3906681`).
- Step D clean worktree audit executed; only hard fail was typecheck `findLastIndex` / ES2022.
- Minimal fix: `tsconfig.json` → ES2023 (`677b15b`), re-typecheck green in main + clean tree.
- Step E: this handoff + `docs/release/p0-clean-checkout-audit-2026-07-20.md`.

## Write-domain compliance

| Change | Domain | Notes |
|--------|--------|-------|
| ES2023 tsconfig | platform/types | No deep session/outcome rewrite |
| Longitudinal e2e (prior) | tests | Golden path |
| Integration Windows explainability (prior) | tests | No skip-as-green |

Forbidden areas (MCP, multi-agent runtime, DB/cloud, deep module rewrites) untouched in this closure.

## Handoff to maintainers

1. Prefer re-running the §4 list in a fresh worktree after pulling tip.
2. On non-Windows, expect previously skipped POSIX suites to execute; treat new failures as product/platform bugs, not as license to skip.
3. Keep longitudinal e2e in the release checklist even if plan §4 text still cites the presentation harness only.
4. Do not claim Linux P0 parity from this Windows-only clean audit alone if product requires POSIX proofs on release hosts.

## Review checklist

- [x] Clean checkout not the dirty developer tree
- [x] Frozen lockfile install
- [x] Typecheck green after fix
- [x] Unit/integration green with explained skips
- [x] Build green
- [x] Security/privacy/hygiene + teaching checks green
- [x] Longitudinal Golden `--repeat-each=3`
- [x] Presentation harness `--repeat-each=3`
- [x] Skip inventory documented
- [x] Risks recorded
- [x] Final SHAs recorded
