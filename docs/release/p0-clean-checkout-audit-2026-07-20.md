# P0 clean-checkout release audit

> **Status:** Executed release proof (non-draft).
> **Date:** 2026-07-20 (Asia/Shanghai)
> **Audited commit:** `a797f07a65ed7a598bb96d1666e496fcf0275f67`
> **Host:** Windows, Node v24.13.0, pnpm 11.9.0, git 2.55.0.windows.3
> **Evidence:** `D:\release-evidence\p0-clean-checkout-audit.json`
> **Manifest SHA-256:** `e1802af6d0b80a53a982fb3309adc2ea93773ec1bee5b9c02cbb5be56dcd75e4`
> **`outputInsideSourceWorktree`:** false
> **`passed`:** true

## 1. Procedure

```powershell
# Source worktree clean at a797f07
node scripts/release-audit.mjs --output D:\release-evidence\p0-clean-checkout-audit.json
```

The auditor created a detached clean worktree, ran the full `releaseAuditCommands` set there, wrote stdout/stderr digests outside the source tree, then removed the worktree. Source status before and after remained empty.

## 2. Command results

| # | Command | Exit | Duration | Notes |
|---|---------|-----:|---------:|-------|
| 0 | `pnpm install --frozen-lockfile` | 0 | 3.6s | |
| 1 | `pnpm run typecheck` | 0 | 6.9s | |
| 2 | `pnpm run test:unit` | 0 | 31.4s | 1247 passed / **69 skipped** / 3 files skipped — budgeted win32 |
| 3 | `pnpm run test:integration` | 0 | 12.4s | 64 passed / **1 skipped** — budgeted win32 |
| 4 | `pnpm run build` | 0 | 25.7s | |
| 5 | `pnpm run check:security` | 0 | 1.6s | symlink EPERM + FIFO capability skips classified |
| 6 | `pnpm run check:provider-privacy` | 0 | 0.6s | |
| 7 | `pnpm run check:repository-hygiene` | 0 | 0.5s | |
| 8 | `pnpm run check:settings-secret-storage` | 0 | 0.6s | |
| 9 | `pnpm run check:agent-run-recovery` | 0 | 0.8s | |
| 10 | `pnpm run check:agent-operation-idempotency` | 0 | 0.8s | |
| 11 | `pnpm run check:workspace-write-tool` | 0 | 0.8s | same capability skips as security |
| 12 | `pnpm run check:web-fetch-safe-url` | 0 | 0.6s | |
| 13 | `pnpm run check:external-link-controls` | 0 | 0.6s | |
| 14 | `node scripts/check-learning-outcome-committer.mjs` | 0 | 1.6s | |
| 15 | `node scripts/check-learning-outcome-recovery.mjs` | 0 | 1.5s | |
| 16 | `node scripts/check-learning-record-read-repair.mjs` | 0 | 1.5s | |
| 17 | `node scripts/check-workspace-catalog-reconciliation.mjs` | 0 | 0.5s | |
| 18 | `pnpm run check:teaching-learning-loop` | 0 | 0.6s | |
| 19 | crash-recovery e2e `--repeat-each=3` | 0 | 62.7s | **6/6** passed |
| 20 | longitudinal e2e `--repeat-each=3` | 0 | 22.2s | **3/3** passed |
| 21 | presentation a11y e2e `--repeat-each=3` | 0 | 6.6s | **3/3** passed |
| 22 | `git diff --check` | 0 | 0.2s | |
| 23 | `git status --porcelain=v1` | 0 | 0.2s | clean detached tree |

Total command time ≈ 187s. Artifacts under `D:\release-evidence\p0-clean-checkout-audit-artifacts\`.

## 3. Skip classification (not skip-as-green fraud)

Contract change in `a797f07`: unexplained skips still fail; inventoried platform/capability skips pass only when:

1. the line matches `knownPlatformSkip`, or
2. aggregate vitest counts match exact `platformReleaseSkipBudget.win32` (unit 69/3, integration 1).

Linux budgets remain empty. Full inventory: [p0-windows-platform-skip-inventory.md](./p0-windows-platform-skip-inventory.md).

Observed classified skips:

| Source | Skip | Class |
|--------|------|-------|
| unit | 69 tests / 3 files | win32 budget |
| integration | 1 test (`descriptorRelativeMemoryAvailable`) | win32 budget |
| security / workspace-write-tool | symlink EPERM; FIFO mkfifo unavailable | `knownPlatformSkip` |

Zero unknown skips. Zero non-zero exits.

## 4. Plan §2–§4 closure map

| Plan item | Evidence |
|-----------|----------|
| §2.1 writer-lock / ordered publish / authority-first gates | committer / recovery / read-repair checkers exit 0 |
| §2.2 full integration | 64 passed, 1 capability skip budgeted |
| §2.3 real longitudinal + crash/restart e2e | both suites green at `--repeat-each=3` |
| §4 clean-checkout full audit | this document + machine-readable manifest `passed: true` |

## 5. Final hash

| Ref | SHA |
|-----|-----|
| **P0 release proof commit** | `a797f07a65ed7a598bb96d1666e496fcf0275f67` |
| Manifest SHA-256 | `e1802af6d0b80a53a982fb3309adc2ea93773ec1bee5b9c02cbb5be56dcd75e4` |

Historical drafts under `*-2026-07-19-draft.md` are not this proof.
## 6. Tip re-audit

After landing the non-draft docs at `7aa205fa2337d8290038274046f4f97118b635db` (documentation only; no product/gate code change relative to `a797f07`), the same auditor was re-run:

```powershell
node scripts/release-audit.mjs --output D:\release-evidence\p0-clean-checkout-audit-tip.json
```

- `passed`: true
- `commitSha`: `7aa205fa2337d8290038274046f4f97118b635db`
- Manifest SHA-256: `864cb291ab37b44bab07322ed9ee4ba37b10d00549adc1b33b9929b4ef00afd6`
- unknown skips: none

Release **code/policy** hash remains `a797f07`; tip docs hash is also clean-audit green.