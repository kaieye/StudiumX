# P0 release audit entry (July 19, 2026)

Run from a clean checkout. By default the manifest is written under the OS temporary directory, so audit artifacts do not dirty the checkout:

```powershell
node scripts/release-audit.mjs --command "node --version"
```

Use `--output` to choose an explicit path. Paths inside the audited repository are supported for inspection, but the write necessarily dirties that checkout after command execution; such runs record `outputInsideAuditedRepo: true` and cannot be a clean-pass. Prefer a path outside the repository for reproducible clean audits.

The machine-readable record captures exact `HEAD` SHA, status before/after command execution, tool versions, command argv/exit/duration, SHA-256 hashes of stdout/stderr, parsed skip reasons, and the manifest artifact path plus SHA-256 (computed over the manifest with `artifact.sha256` set to `null`). Unknown skips or non-zero commands fail; skips are never green. Only explicit Windows POSIX/descriptor/FIFO capability skips are allow-listed.

The existing `docs/release/p0-clean-checkout-audit-2026-07-19-draft.md` is historical evidence, not a reproducible final release result. Its final release SHA is intentionally not fixed until this entrypoint runs on the release commit; do not copy its intermediate SHAs as the final SHA.
