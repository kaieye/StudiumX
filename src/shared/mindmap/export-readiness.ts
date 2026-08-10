/**
 * Pure export-boundary readiness check for a mind-map snapshot.
 *
 * Export must never race an autosave or serialize a renderer snapshot that has
 * not been acknowledged by the durable repository.  The eventual main/IPC
 * export path can call this helper after forcing `flushMindMap`; this module
 * deliberately performs no I/O and owns no persistence state.
 *
 * The three revision values have intentionally different meanings:
 * - `snapshotRevision`: revision carried by the document about to be exported;
 * - `durableRevision`: latest revision confirmed by the repository after flush;
 * - `expectedRevision`: CAS revision the caller associates with this candidate
 *   for the next persistence boundary (and therefore expects to be durable).
 *
 * A snapshot is ready only when all three agree, no write is pending, and the
 * caller has no unacknowledged dirty state.  Any malformed input fails closed.
 */

export type MindMapExportSnapshotReadinessInput = {
  /** Revision carried by the candidate document being exported. */
  snapshotRevision: number
  /** Latest revision confirmed durable by the repository. */
  durableRevision: number
  /** CAS revision the caller expects this candidate to be based on. */
  expectedRevision: number
  /** True while a debounce, queued write, or in-flight flush remains. */
  pendingWrites: boolean
  /** True when the candidate contains edits not acknowledged by persistence. */
  dirty: boolean
}

export type MindMapExportSnapshotNotReadyReason =
  | 'invalid_snapshot_revision'
  | 'invalid_durable_revision'
  | 'invalid_expected_revision'
  | 'invalid_pending_writes'
  | 'invalid_dirty_state'
  | 'pending_writes'
  | 'dirty'
  | 'snapshot_revision_mismatch'
  | 'expected_revision_mismatch'

export type MindMapExportSnapshotReadiness =
  | {
      ready: true
      /** The durable revision that the export snapshot is known to represent. */
      revision: number
    }
  | {
      ready: false
      /** Stable, value-free reasons for refusing the export snapshot. */
      reasons: readonly MindMapExportSnapshotNotReadyReason[]
    }

/**
 * Decide whether a candidate mind-map snapshot is safe to serialize.
 *
 * This is deliberately fail-closed: missing, non-finite, fractional, negative,
 * or otherwise malformed state produces `ready: false` rather than guessing
 * that a flush completed or that revisions are current.
 */
export function assessMindMapExportSnapshotReadiness(
  input: MindMapExportSnapshotReadinessInput
): MindMapExportSnapshotReadiness {
  // Keep the runtime boundary defensive even though typed callers normally
  // provide the shape above. `null`/`undefined` must become a refusal, not a
  // property-access exception that could accidentally bypass the export gate.
  const value: Record<string, unknown> = isRecord(input) ? input : {}
  const reasons: MindMapExportSnapshotNotReadyReason[] = []

  const snapshotRevision = value.snapshotRevision
  const durableRevision = value.durableRevision
  const expectedRevision = value.expectedRevision
  const pendingWrites = value.pendingWrites
  const dirty = value.dirty

  const validSnapshotRevision = isRevision(snapshotRevision)
  const validDurableRevision = isRevision(durableRevision)
  const validExpectedRevision = isRevision(expectedRevision)

  if (!validSnapshotRevision) reasons.push('invalid_snapshot_revision')
  if (!validDurableRevision) reasons.push('invalid_durable_revision')
  if (!validExpectedRevision) reasons.push('invalid_expected_revision')
  if (typeof pendingWrites !== 'boolean') reasons.push('invalid_pending_writes')
  if (typeof dirty !== 'boolean') reasons.push('invalid_dirty_state')

  if (reasons.length > 0) {
    return { ready: false, reasons }
  }

  if (pendingWrites === true) reasons.push('pending_writes')
  if (dirty === true) reasons.push('dirty')
  if (snapshotRevision !== durableRevision) reasons.push('snapshot_revision_mismatch')
  if (expectedRevision !== durableRevision) reasons.push('expected_revision_mismatch')

  if (reasons.length > 0) {
    return { ready: false, reasons }
  }

  // The validation above establishes these runtime values despite the public
  // input type being intentionally narrow for normal callers. Keep the cast at
  // this boundary so malformed IPC/JS callers still fail closed before it.
  return { ready: true, revision: durableRevision as number }
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
