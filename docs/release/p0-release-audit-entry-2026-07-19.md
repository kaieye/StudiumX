# P0 release audit entry (July 20, 2026)

Run the audit from a clean source checkout. Its default manifest and log directory are created under the OS temporary directory, outside both the source checkout and the detached checkout used for commands:

```powershell
node scripts/release-audit.mjs
```

For a retained evidence bundle, choose a path **outside the source checkout**:

```powershell
node scripts/release-audit.mjs --output D:\release-evidence\p0-clean-checkout-audit.json
```

`--output` paths inside the source checkout remain supported for local inspection, but their manifest/log files necessarily dirty that checkout. The record sets `outputInsideSourceWorktree: true` and such a run is never a clean-pass. CI writes its evidence under the GitHub runner temporary directory and uploads both the manifest and its sibling artifact directory.

The machine-readable record captures the exact `HEAD` SHA; source status before and after command execution; Node, pnpm, and Git versions; every required command argv, exit code, duration, stdout/stderr path and SHA-256; parsed skip reasons; detached-checkout cleanliness; cleanup outcome; and the manifest artifact SHA-256 (calculated over the manifest with `artifact.sha256` set to `null`). Commands continue after a failure so the evidence bundle exposes the complete gate set rather than only the first failing command.

Any non-zero command, any **unexplained** skip, a dirty detached checkout, a dirty source checkout, or an in-repo output path fails the audit.

Recognized platform/capability skips are classified and **do not alone fail** a Win/Mac release proof when they match either:

1. an explicit capability marker (`knownPlatformSkip`: POSIX/descriptor-relative/FIFO/workspace-write optional FS rejection messages, etc.), or
2. an exact per-platform aggregate vitest budget in `platformReleaseSkipBudget` (Windows unit: 69 tests / 3 files; Windows integration: 1 test). Budgets fail closed on drift and are empty on Linux so aggregate skips remain red in Linux CI unless individually marked.

Product regressions, bare `skip`/`TODO` markers, and budget mismatches remain red. The historical Windows integration skip and unit platform suites are therefore usable as P0 closure evidence **only** under this inventoried Win/Mac policy; they are not silent skip-as-green.

The existing `docs/release/p0-clean-checkout-audit-2026-07-19-draft.md` and `p0-release-handoff-2026-07-19-draft.md` are historical drafts, not a reproducible final release result. Do not copy their intermediate SHAs as the final SHA; final release evidence must be generated at the audited release commit.