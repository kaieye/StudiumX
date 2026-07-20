# P0 release handoff / review

> **Status:** Final handoff (non-draft).
> **Date:** 2026-07-20 (Asia/Shanghai)
> **Release proof commit:** `a797f07a65ed7a598bb96d1666e496fcf0275f67`
> **Audit manifest:** `D:\release-evidence\p0-clean-checkout-audit.json` (`passed: true`)
> **Manifest SHA-256:** `e1802af6d0b80a53a982fb3309adc2ea93773ec1bee5b9c02cbb5be56dcd75e4`

## Review conclusion

Against `docs/plans/sx-p0-remaining-work-execution-plan.md` §§2–5:

**P0 发布完成** for the Win/Mac product release target on this host.

All §2 blockers are closed with reproducible automation; §4 clean-checkout audit is green under the inventoried platform-skip policy; this handoff records review, residual risk, and the final integration hash.

## What closed

1. **Static / runtime gates (§2.1)** — learning-outcome committer, recovery, and read-repair checkers rewritten to current writer-lock / ordered publish / authority-first semantics; all exit 0 in the clean audit.
2. **Integration (§2.2)** — 64 passed; sole skip is capability-gated Memory descriptor work, inventoried and budgeted for win32.
3. **Electron Golden (§2.3)** — real longitudinal commit loop and crash/restart injection (`after_stage_flush`, `before_catalog_reconcile`) each `--repeat-each=3`, all green.
4. **Clean audit (§4)** — 24/24 commands exit 0; no unknown skips; evidence outside source worktree; detached tree cleaned.
5. **Release contract policy** — `scripts/release-audit-contract.mjs` fails on unexplained skips and budget drift; allows only exact win32 aggregate budgets and explicit capability markers. Normative inventory: [p0-windows-platform-skip-inventory.md](./p0-windows-platform-skip-inventory.md). Entry: [p0-release-audit-entry-2026-07-19.md](./p0-release-audit-entry-2026-07-19.md). Audit record: [p0-clean-checkout-audit-2026-07-20.md](./p0-clean-checkout-audit-2026-07-20.md).

## Residual risks

1. **POSIX-only coverage on Windows** — Memory catalog partitions, descriptor-bound publish native suites, and FIFO rejection still omit Windows runs by design (ADR-0004 dual profile). Mac should still run its native suites; Linux CI (`main-release-audit.yml` on ubuntu-24.04) must not inherit Windows budgets (contract keeps linux budgets empty).
2. **Windows symlink creation privilege** — workspace-write checker skips dangling-symlink rejection when `symlink()` returns EPERM. Product still rejects symlink targets when they exist; the skip is only the creation precondition.
3. **Directory fsync soft edge** — Windows durable rename may log that directory fsync is unsupported; known durability downgrade, not a failed gate.
4. **darwin budget unset** — Mac aggregate skip budget is intentionally empty until a clean Mac inventory is sealed; Mac release closure must either run zero aggregate skips or add an exact inventory the same way Windows did.
5. **Evidence locality** — machine-readable bundle lives under `D:\release-evidence\` (outside git). Retain or re-run `node scripts/release-audit.mjs --output …` to regenerate.

## Out of scope (not claimed)

- Full Linux P0 product ship claim from this Windows proof alone (Linux CI path remains separate).
- Complete C-4P6 / C-4P9 writer migration beyond ADR-stated partial scope.
- P1/P2 product features.

## Operator replay

```powershell
git checkout a797f07a65ed7a598bb96d1666e496fcf0275f67
# clean status required
node scripts/release-audit.mjs --output D:\release-evidence\p0-clean-checkout-audit.json
# expect: exit 0 and "passed": true
```

## Final statement

Domain modules (ADR-0008…0016) were already implemented. With inventoried Win/Mac platform skips, green clean-checkout audit, and real Electron longitudinal + crash/restart Golden at `--repeat-each=3`, the remaining release proof in `sx-p0-remaining-work-execution-plan.md` is closed.

**Final integration hash:** `a797f07a65ed7a598bb96d1666e496fcf0275f67`