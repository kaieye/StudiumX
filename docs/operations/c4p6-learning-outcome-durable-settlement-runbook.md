# C-4P6 Learning-outcome durable settlement runbook

> **Scope:** `P6-macOS-local-APFS-strict-candidate` only. This runbook is Phase-4 operational material; it does not claim a transaction, Windows strict support, reboot durability, or power-loss durability.

## Ownership and stop conditions

| Responsibility | Required owner action |
| --- | --- |
| Release owner | Runs the host-native verifier before a release that claims the candidate profile. Captures its one-line JSON profile record with the release evidence. |
| Operations owner | Accepts the incident/recovery steps below and records the escalation contact before any close-out review. |
| Support owner | Collects only stable status/stage/error category; never collect assessment content, record text, operation/outcome IDs, paths, hashes, or raw error messages. |

Stop automatic processing and retain all existing canonical files whenever the outcome is `reconciliation_required`, `review_required`, an identity conflict, a path/regular-file failure, an unknown I/O outcome, a lock/permission failure, or a corrupt residual. Do **not** retry with a new identity, overwrite an immutable record, delete canonical files, or claim success from final-file presence.

## Pre-release host-native evidence

On the release candidate machine, from the repository root with dependencies installed:

```sh
pnpm run build:contained-durable-replace
node scripts/verify-c4p6-host-native.mjs
```

The verifier refuses non-macOS, non-APFS, and non-internal volumes. It reports the OS release, architecture, Node, Electron, filesystem and storage classification, then runs the fresh-process crash/restart matrix under Electron's embedded Node runtime. Archive its JSON output and the command result with the release record.

The verifier covers an intentional process termination after stage flush and after immutable-record publish, then a fresh process reconcile/replay. It does **not** simulate reboot, device removal, filesystem corruption, or power loss. Those claims remain prohibited unless separately approved and evidenced.

## Installation, upgrade and downgrade

1. **Fresh install:** create/open the workspace using the normal main-process flow; do not seed settlement markers, ledgers, records, or stage files manually.
2. **Upgrade:** deploy the release normally. The current Phase-1/2 changes add no public IPC/schema/path migration; no migration action is required. Existing settlement state must be reconciled by the owned committer rather than rewritten.
3. **Downgrade:** do not use a downgrade as a recovery mechanism. If an older build cannot interpret observed state, stop and escalate; preserve the workspace and record the version boundary without copying content into diagnostics.

## Incident playbooks

### Crash or restart during settlement

1. Restart the application; do not delete `.learning-outcome-committer-stage` residuals.
2. Let the normal committer/reconcile path inspect the immutable record and marker authority.
3. If it returns `pending`, retain residuals and retry only the same user operation through the normal UI/main flow. If it returns `repaired`, verify only the stable state and continue. If it returns `review_required` or `reconciliation_required`, stop and escalate.
4. Never create a new operation/outcome ID to force a retry, and never promote a stage file manually.

### Disk full, permission denied, sharing/lock failure

1. Return/record a stable failure category; do not infer whether a post-publish write succeeded.
2. Restore capacity or access outside the application. Do not remove records, markers, ledger entries, or stage files to make space.
3. Retry only after the prerequisite is resolved and only with the original operation identity. Any unknown post-publish result stays in review/reconciliation.

### Corrupt residual, identity conflict, or catalog mismatch

1. Preserve the workspace in place and stop automatic settlement for the affected session.
2. Capture data-minimal incident facts: release version, profile class, stable state/result, and event time. Exclude user data and filesystem locators.
3. Escalate to the operations owner for authority-guided manual review. The catalog is observe-only; it must not be used to synthesize a record, outcome, marker, or repair.

### Concurrent retry

Use only the standard main-process path. If a concurrent call cannot prove the original identity or reports an unavailable writer/lock, stop rather than requeueing an altered request. No cross-process transaction or lock guarantee is asserted by this runbook.

## Close-out checklist

- [ ] Host-native verifier output is recorded for every profile claimed as supported.
- [ ] Operations, support and release owners have accepted this runbook and its escalation route.
- [ ] No schema/API/path migration was introduced; if that changes, an independent migration gate is approved first.
- [ ] Matrix evidence covers the claimed runtime-adjacent crash/restart behavior; any untested reboot/power-loss claim is removed.
- [ ] ADR-0004, ADR-0020, the P6 plan and `local-data-todo.md` are reviewed together before changing P6 status.
