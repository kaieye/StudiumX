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

Any non-zero command, any skip, a dirty detached checkout, a dirty source checkout, or an in-repo output path fails the audit. Recognized Windows POSIX/descriptor/FIFO/platform capability skips are classified separately for routing to the supported Linux release environment, but they are **not** a green release result. Thus the historical Windows integration skip cannot be used as P0 closure evidence.

The existing `docs/release/p0-clean-checkout-audit-2026-07-19-draft.md` and `p0-release-handoff-2026-07-19-draft.md` are historical drafts, not a reproducible final release result. Do not copy their intermediate SHAs as the final SHA; final release evidence must be generated at the audited release commit.
