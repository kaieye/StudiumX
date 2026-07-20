# C-4P9 Session-audit durable append design gate

> **Status: open.** **P9-S2 is the only production scope.** P9-S3 through P9-S45 are tests-only historical evidence; they do not expand production scope or close C-4P9.

## Authority and scope

- The canonical backlog is [local-data-todo](../local-data-todo.md#p9session-audit-durable-append); implementation and evidence history are recorded in [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md).
- P9-S2 is limited to the fixed session-audit file:

  ```text
  <conversation>/.agent-sessions/<conversation-id>.jsonl
  ```

  It is an audit-specific, framed, legacy-compatible, non-rotating durable append boundary. It does not migrate other JSONL writers, archives, artifacts, checkpoints, ledgers, or workspace writers.
- `appendDurableJsonlLine()` is not an approved P9 implementation path: its default month/size rotation is incompatible with the fixed-file audit contract unless a later, separately approved design changes that contract.
- Existing audit schema/version, headers, entry IDs, `parentId`, ordering, raw historical bytes, tolerant legacy reads, and deletion/history/artifact assumptions remain authoritative. No backfill, normalization, rewrite, retention change, or automatic cleanup is authorized.
- Trace remains optional write-once correlation metadata under the existing normalization rules; it is not part of audit identity, hashing, parentage, or dedupe. P9 is not a C-5 trace, action-ID, receipt, or idempotency-model migration.

## Implemented production contract: P9-S2 only

P9-S2 uses a module-private queue keyed by normalized absolute audit path. For one path, the queue spans the same-descriptor exact-byte read, validation, dedupe/conflict decision, framed append, file `fsync`/`close`, then audit-directory and conversation-parent-directory durability confirmation. It does not impose unnecessary global serialization across different audit files.

The writer must re-read the queued file state before it decides what to append:

- Missing canonical rows are appended; exact already-present canonical rows are a no-op on retry. Existing bytes are not rewritten. Conflicting rows with the same header or entry identity, including divergent trace, fail closed.
- Legacy trace-free or malformed-trace rows remain readable under existing tolerant-read behavior and are not rewritten. A malformed/torn tail is never silently treated as an authorization to append or dedupe.
- The implemented framing preserves the existing bytes and isolates a non-LF existing tail before appending; it is not a general repair facility.
- `ENOENT` is the empty-audit case. Other read/path/type/I/O failures fail closed.
- Directory `open`/`sync` may degrade only for the established allowlist: `EINVAL`, `ENOSYS`, `ENOTSUP`, `EOPNOTSUPP`, and `EISDIR`. The warning must be generic and contain no paths, content, IDs, or trace data. `EACCES`, `EPERM`, `EIO`, unknown errors, and every close failure are fatal.

A pre-append failure must not confirm a new audit row or start ledger append. If file append completed but directory durability confirmation fails, save rejects without rollback: the row may exist, and retry must re-read, validate, and exact-dedupe before it can proceed. It must not use a stale snapshot, in-memory success flag, truncate, deletion, or overwrite to make retry appear clean.

## Archive ordering and authority (unchanged)

P9-S2 preserves the existing ordered publish boundary:

```text
canonical JSON → canonical Markdown → session audit → existing ledger queue → final archive verification
```

This is not a cross-file transaction and makes no shared atomicity or rollback promise.

- JSON failure blocks Markdown, audit, and ledger.
- Markdown failure may leave JSON, but blocks audit and ledger.
- Audit failure may leave JSON/Markdown, but blocks ledger and fails the save.
- Ledger failure may leave JSON/Markdown/audit, but still fails the save. Retry must not duplicate audit rows or claim an audit-only result is a successful archive save.
- Ledger queue ownership, identity verification, idempotency semantics, and final verification remain with the existing archive/ledger flow. P9-S2 must not introduce a second ledger identity, receipt, or transaction protocol, and must not reorder these stages.

## C-4P9 open gates and design risks

The following are active gates, not work implicitly authorized by P9-S2 or its tests.

1. **Generic JSONL migration, rotation, and repair.** Define a separately approved generic API and audit-specific compatibility contract before any migration. Any rotation/sealing/segment discovery must prove preservation of fixed-file audit, history, artifact-protection, verification, and deletion semantics. Repair needs explicit authority, trigger conditions, byte-preservation/loss policy, recovery behavior, and operator controls; S2 tail framing is not repair.
2. **Full capability and failure semantics.** Complete the capability profile and residual matrix for file and directory `mkdir`, path inspection, `open`, `stat`, `read`, partial/invalid transfers, `write`, `fsync`, and `close`, including unknown errors and all fatal-versus-degraded outcomes. Define stable, privacy-safe diagnostics and ensure no unsupported platform behavior is misreported as durable success.
3. **Cross-file transaction and archive/ledger authority.** Any promise beyond the ordered best-effort sequence needs an explicit crash/retry state machine and a decision on authority for JSON, Markdown, audit, and ledger. It must define partial-publish visibility, reconciliation, idempotency, final verification, and rollback prohibitions without silently changing the current archive order or ledger ownership.
4. **IPC/UI.** No repair, migration, rotation, conflict-resolution, or durability-status UI/IPC is approved. A future surface must specify permissions, stable/privacy-safe states and errors, user-visible consequences of partial publish, retry behavior, and compatibility with existing callers.
5. **Operations validation.** Before broader closure, define operational ownership and validation: observability without sensitive audit data, recovery/runbook behavior, upgrade and rollback handling, capacity/retention implications, concurrency and failure-injection coverage, and reproducible acceptance criteria. Targeted unit evidence is not operations validation or full-suite closure.
6. **Windows and power-loss claims where applicable.** P9-S2 must not generalize POSIX-oriented durability behavior into a Windows guarantee. Any Windows profile needs host-native capability analysis, explicit file/directory flush and error semantics, and adversarial CI. Any future power-loss durability claim requires an approved fault model plus platform-appropriate crash/recovery or power-loss validation; ordinary unit tests and `fsync` calls alone are insufficient evidence for that claim.

## Historical evidence

P9-S3 through P9-S45 are completed **tests-only** slices. Collectively they add targeted evidence for recovery, short-circuiting, capability symmetry, residual I/O failures, concurrency, conflict handling, and archive/ledger retry behavior. They made no production-scope expansion and do not close the generic JSONL, rotation, repair, full failure semantics, transaction, IPC/UI, operations, Windows, or power-loss gates above.

The chronological per-slice ledger, commit references, and historical targeted test counts are retained in [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md). Do not combine those historical counts with current test results or represent them as complete-suite, operations, or C-4P9 closure evidence.
