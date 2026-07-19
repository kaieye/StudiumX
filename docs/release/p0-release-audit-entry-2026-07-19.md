# P0 release audit entry (July 19, 2026)

Run from a clean checkout:

```powershell
pnpm run audit:release -- --output release/p0-release-audit.json
```

The machine-readable record captures exact `HEAD` SHA, status before/after, tool versions, command argv/exit/duration, SHA-256 hashes of stdout/stderr, and parsed skip reasons. Unknown skips or non-zero commands fail; skips are never green. Only explicit Windows POSIX/descriptor/FIFO capability skips are allow-listed.

The existing `docs/release/p0-clean-checkout-audit-2026-07-20.md` is historical evidence, not a reproducible final release result. Its final release SHA is intentionally not fixed until this entrypoint runs on the release commit; do not copy its intermediate SHAs as the final SHA.
