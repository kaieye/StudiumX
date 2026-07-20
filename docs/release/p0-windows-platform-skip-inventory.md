# Windows P0 platform skip inventory

> **Status:** Normative inventory for `platformReleaseSkipBudget.win32` in `scripts/release-audit-contract.mjs`.
> **Scope:** Win/Mac product release targets. Linux CI keeps empty aggregate budgets.
> **Rule:** Unexplained skips and budget drift fail the audit. Capability-gated skips listed here may pass when exact counts match.

## Aggregate budgets (Windows)

| Command | Tests skipped | Files skipped | Evidence basis |
|---------|--------------:|--------------:|----------------|
| `pnpm run test:unit` | 69 | 3 | Clean audit at `8a02b7a` + contract unit tests |
| `pnpm run test:integration` | 1 | 0 | `trace-propagation` Memory capability gate |

## Unit (69)

| File | Approx. count | Mechanism | Capability class |
|------|--------------:|-----------|------------------|
| `teaching-memory-catalog.unit.test.ts` | 20 | `describe.runIf(process.platform !== 'win32')` | POSIX descriptor Memory catalog partitions |
| `workspace-contained-directory.unit.test.ts` | 11 | `describe.runIf(supportsNativePosix)` | Descriptor-bound directory foundation |
| `agent-conversation-summary-projection.unit.test.ts` | 10 | `describe.runIf(process.platform !== 'win32')` | Non-Windows projection path |
| `contained-durable-directory.unit.test.ts` | 8 | POSIX `runIf` + FIFO `skipIf` | Descriptor-relative / FIFO |
| `teaching-workspace-evidence.unit.test.ts` | 4 | `describe.runIf(process.platform !== 'win32')` | Evidence path platform isolation |
| `workspace-write-tool.unit.test.ts` | 3 | `skipIf(win32)` / FIFO / availability | POSIX writer semantics not on Windows profile |
| `workspace-contained-create-no-overwrite.unit.test.ts` | 3 | `runIf(darwin \|\| linux)` | Native macOS/Linux integration |
| `workspace-contained-restricted-overwrite.unit.test.ts` | 3 | `runIf(darwin \|\| linux)` + protocol gate | Native macOS/Linux integration |
| `local-data-index.unit.test.ts` | 2 | `it.runIf(process.platform !== 'win32')` | Memory scope / SQLite quarantine variants |
| `teaching-ipc-gateway.unit.test.ts` | 2 | POSIX `runIf` (Windows keeps fail-closed cases) | Memory diagnostics / preview navigation |
| `teaching-workspace-access.unit.test.ts` | 1 | `context.skip` FS capability | Case-distinct sibling roots |
| `teaching-memory-recall.unit.test.ts` | 1 | `describe.runIf(process.platform !== 'win32')` | Memory recall host isolation |
| `agent-approval-mode.unit.test.ts` | 1 | availability `runIf` inverse matrix | Durable write capability matrix |

The three **skipped test files** are whole-suite `runIf` false suites under the unit project on Windows (POSIX-only describes with no sibling Windows cases in those files).

## Integration (1)

| File | Mechanism | Reason |
|------|-----------|--------|
| `tests/integration/trace-propagation.integration.test.ts` | `it.skipIf(!descriptorRelativeMemoryAvailable)` | Concurrent Memory CRUD + redacted logs need descriptor-relative Memory |

## Explicit checker capability skips (not aggregate budgets)

Emitted by `scripts/fixtures/workspace-write-tool.ts` and classified via `knownPlatformSkip`:

- `[workspace write tool] symlink rejection explicitly skipped: EPERM` (Windows often cannot create symlinks without privilege)
- `[workspace write tool] FIFO rejection explicitly skipped: mkfifo is unavailable on this platform`
- Optional hardlink rejection skip when host cannot create hardlinks

These are fail-closed product behavior when the optional FS object **can** be created; the skip only records that the **creation** precondition is unavailable.

## Policy alignment

- Plan §2.2: platform-missing capabilities must be explicit, controlled, and evidenced on the target release environment.
- Plan §4: unexplained skips block P0; this inventory is the explanation for the exact Windows budgets above.
- Do not raise budgets to silence product failures. Update only when a new capability gate is intentionally added and documented here.
