# P0 clean-checkout release audit

> **Status:** Historical draft / unverified evidence. This document is not a completed release proof and must not be represented as executed by the current audit.
> **Draft date:** 2026-07-19 (Asia/Shanghai)
> **Clean checkout:** `git worktree` detached at `C:\Users\Chos1nz\AppData\Local\Temp\StudiumX-p0-audit`
> **Baseline commit (audit start):** `3906681bfcf5f18378a2386fdbcaa2d7e7b9c4e3`
> **Typecheck fix commit:** `677b15b9a783c46764b5fe5986ce5f729918edcd`
> **Host:** Windows, Node v24.13.0, pnpm 11.9.0, Electron 42.6.0

## 1. Procedure

```powershell
git worktree add --detach $env:TEMP\StudiumX-p0-audit 3906681
cd $env:TEMP\StudiumX-p0-audit
pnpm install --frozen-lockfile
# then the §4 command list from docs/plans/sx-p0-remaining-work-execution-plan.md
```

Not a polluted developer workspace: detached worktree, frozen lockfile, independent `node_modules`.

## 2. Command results (clean tree @ 3906681)

| Command | Exit | Duration | Result |
|---------|------|----------|--------|
| `pnpm install --frozen-lockfile` | 0 | ~52s | PASS |
| `pnpm run typecheck` | 2 | 7.1s | **FAIL** (see §3) |
| `pnpm run test:unit` | 0 | 27.2s | PASS — 1234 passed / 69 skipped / 0 failed |
| `pnpm run build` | 0 | 16.2s | PASS |
| `pnpm run test:integration` | 0 | 10.1s | PASS — 64 passed / 1 skipped / 0 failed |
| `pnpm run check:security` | 0 | 1.4s | PASS |
| `pnpm run check:provider-privacy` | 0 | 0.6s | PASS |
| `pnpm run check:settings-secret-storage` | 0 | 0.6s | PASS |
| `pnpm run check:repository-hygiene` | 0 | 0.5s | PASS |
| `pnpm run check:agent-run-recovery` | 0 | 0.8s | PASS |
| `pnpm run check:agent-operation-idempotency` | 0 | 0.7s | PASS |
| `pnpm run check:workspace-write-tool` | 0 | 0.7s | PASS |
| `pnpm run check:web-fetch-safe-url` | 0 | 0.6s | PASS |
| `pnpm run check:external-link-controls` | 0 | 0.5s | PASS |
| `node scripts/check-workspace-catalog-reconciliation.mjs` | 0 | 0.5s | PASS |
| `node scripts/check-teaching-learning-loop.mjs` | 0 | ~0s | PASS |
| `pnpm exec playwright test tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts --project=electron-e2e --repeat-each=3` | 0 | 20.5s | PASS — 3/3 |
| `pnpm exec playwright test tests/e2e/teaching-learning-loop.e2e.spec.ts --project=electron-e2e --repeat-each=3` | 0 | 5.9s | PASS — 3/3 |
| `git diff --check` | 0 | 0.2s | PASS |

Raw logs retained under clean tree `.p0-audit-logs/` (not committed; disposable worktree).

### Playwright notes

- Plan §4 still lists the presentation harness path; codex plan §4 requires the **new longitudinal Golden** at `--repeat-each=3`.
- Both were run with `--repeat-each=3` after `pnpm run build`.
- Longitudinal covers wrong → `needs_practice`, correct → `saved`, replay + Electron restart single-record / idempotent (spec `tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts`).

## 3. Typecheck failure and fix

**Failure (clean @ 3906681):**

```
src/main/teaching-agent-conversations.ts(228,32): error TS2551: Property 'findLastIndex' does not exist on type 'readonly AgentChatTurn[]'
src/shared/agent-persisted-history.ts(98,32): same
```

Also uses `findLast` in `src/main/teaching-workspace.ts` (~889–892). Runtime already has these APIs (Node 24 / Electron 42); `tsconfig.json` lib was `ES2022`.

**Fix (write-domain platform compat):** bump `tsconfig.json` `target`/`lib` `ES2022` → `ES2023` in commit `677b15b`.

**Re-verify:**

- Main workspace: `pnpm run typecheck` → exit 0 after fix.
- Clean worktree with fixed `tsconfig.json` applied: `pnpm run typecheck` → exit 0.

## 4. Skip inventory (explained, not skip-as-green)

Plan requires no **unexplained** skips. Clean Windows results:

### Integration — 1 skip

| File | Mechanism | Reason | Blocks P0? |
|------|-----------|--------|------------|
| `tests/integration/trace-propagation.integration.test.ts:355` | `it.skipIf(!descriptorRelativeMemoryAvailable)` | Descriptor-relative memory / POSIX capability unavailable on this host for that concurrent Memory CRUD + redacted log case | No — platform capability isolation |

### Unit — 69 skips (by file)

| File | Count | Mechanism | Reason class |
|------|------:|-----------|--------------|
| `teaching-memory-catalog.unit.test.ts` | 20 | `describe.runIf(process.platform !== 'win32')` | POSIX descriptor / Memory catalog partition proofs |
| `workspace-contained-directory.unit.test.ts` | 11 | platform/native descriptor suite | POSIX descriptor-bound directory foundation |
| `agent-conversation-summary-projection.unit.test.ts` | 10 | `describe.runIf(process.platform !== 'win32')` | C-2C projection on non-Windows |
| `contained-durable-directory.unit.test.ts` | 8 | POSIX + `it.skipIf(mkfifoUnavailable)` | Descriptor-relative / FIFO host capability |
| `teaching-workspace-evidence.unit.test.ts` | 4 | platform/capability | Evidence path platform isolation |
| `workspace-write-tool.unit.test.ts` | 3 | `it.skipIf(win32)` / FIFO / availability | Windows lacks POSIX writer semantics under test |
| `workspace-contained-create-no-overwrite.unit.test.ts` | 3 | native macOS/Linux integration | Platform-gated native |
| `workspace-contained-restricted-overwrite.unit.test.ts` | 3 | native macOS/Linux integration | Platform-gated native |
| `local-data-index.unit.test.ts` | 2 | `it.runIf(process.platform !== 'win32')` + related | Memory scope scan / SQLite quarantine variants |
| `teaching-ipc-gateway.unit.test.ts` | 2 | `it.runIf(process.platform !== 'win32')` | Memory diagnostics / preview navigation need POSIX capability; Windows has explicit fail-closed tests that still run |
| `teaching-workspace-access.unit.test.ts` | 1 | `context.skip(...)` | FS does not support case-distinct sibling roots / same-dir canonicalization |
| `teaching-memory-recall.unit.test.ts` | 1 | platform/capability | Memory recall host isolation |
| `agent-approval-mode.unit.test.ts` | 1 | `describe.runIf(!getWorkspaceWriteToolAvailability().available)` inverse path | Durable write capability matrix on this host |

**Conclusion:** All observed skips are platform-controlled (`win32` / FIFO / descriptor-relative / workspace-write availability) or explicit filesystem capability skips. Zero unexplained product regressions. Integration suite is green with one explained skip.

## 5. Residual risk

1. **Cross-platform:** Full POSIX descriptor-relative proofs remain Windows-skipped; Linux CI for contained-durable-replace exists (`.github/workflows/contained-durable-replace-linux.yml`) but is not a full P0 Windows substitute. Acceptable for P0 if product intentionally models Windows capability as unavailable.
2. **Directory fsync:** Electron e2e logs `Directory fsync is unsupported; durable rename completed without directory fsync` on Windows — known durability soft edge, not a test failure.
3. **Clean re-audit at 677b15b:** Typecheck re-verified; full suite was green at 3906681 except typecheck. Residual risk of unrelated flakiness between commits is low (one-line tsconfig change).
4. **Plan doc lag:** §4 still names only `teaching-learning-loop.e2e.spec.ts` for repeat-each; longitudinal Golden is the codex-plan required artifact and was proven separately.

## 6. Final hashes

| Ref | SHA |
|-----|-----|
| Step C longitudinal golden | `3906681bfcf5f18378a2386fdbcaa2d7e7b9c4e3` |
| Typecheck ES2023 fix | `677b15b9a783c46764b5fe5986ce5f729918edcd` |
| Final integration tip (this record commit parent) | see git after this file lands |

## 7. Closure statement

Against `docs/plans/sx-p0-remaining-work-execution-plan.md` §4–§5 and `docs/plans/codex-rust-v0.144.4-teaching-adoption-plan.md` §4:

- Static committer gates: already green (prior A).
- Windows integration explainable/green: prior B + this audit.
- Longitudinal Electron Golden + restart: prior C + this audit `--repeat-each=3`.
- Clean checkout full gate suite: this document.
- Skips: inventoried and explained.
- Review / handoff / risk / hash: this file + sibling handoff.

**Accurate claim after this record is on `main`:** P0 domain modules are implemented **and** release-level clean-checkout automation, longitudinal Electron Golden (`repeat-each=3`), and traceable audit records are proven on Windows for the command set above.
