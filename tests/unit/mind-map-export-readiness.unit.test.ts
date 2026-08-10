import { describe, expect, it } from 'vitest'

import {
  assessMindMapExportSnapshotReadiness,
  type MindMapExportSnapshotReadinessInput
} from '../../src/shared/mindmap'

function readyInput(
  overrides: Partial<MindMapExportSnapshotReadinessInput> = {}
): MindMapExportSnapshotReadinessInput {
  return {
    snapshotRevision: 4,
    durableRevision: 4,
    expectedRevision: 4,
    pendingWrites: false,
    dirty: false,
    ...overrides
  }
}

describe('mind-map export snapshot readiness', () => {
  it('accepts a clean snapshot whose revisions agree after flush', () => {
    expect(assessMindMapExportSnapshotReadiness(readyInput())).toEqual({
      ready: true,
      revision: 4
    })
  })

  it('refuses queued or in-flight persistence even when revisions agree', () => {
    expect(
      assessMindMapExportSnapshotReadiness(readyInput({ pendingWrites: true }))
    ).toEqual({
      ready: false,
      reasons: ['pending_writes']
    })
  })

  it('refuses a dirty candidate even when no write is currently queued', () => {
    expect(assessMindMapExportSnapshotReadiness(readyInput({ dirty: true }))).toEqual({
      ready: false,
      reasons: ['dirty']
    })
  })

  it('refuses a candidate whose snapshot or expected revision is stale', () => {
    expect(
      assessMindMapExportSnapshotReadiness(
        readyInput({ snapshotRevision: 3, expectedRevision: 2 })
      )
    ).toEqual({
      ready: false,
      reasons: ['snapshot_revision_mismatch', 'expected_revision_mismatch']
    })
  })

  it('reports every independent blocking reason in deterministic order', () => {
    expect(
      assessMindMapExportSnapshotReadiness(
        readyInput({
          snapshotRevision: 3,
          durableRevision: 4,
          expectedRevision: 2,
          pendingWrites: true,
          dirty: true
        })
      )
    ).toEqual({
      ready: false,
      reasons: [
        'pending_writes',
        'dirty',
        'snapshot_revision_mismatch',
        'expected_revision_mismatch'
      ]
    })
  })

  it('fails closed for malformed or missing runtime state', () => {
    const malformed = {
      snapshotRevision: 1.5,
      durableRevision: -1,
      expectedRevision: Number.NaN,
      pendingWrites: 'no',
      dirty: undefined
    } as unknown as MindMapExportSnapshotReadinessInput

    expect(assessMindMapExportSnapshotReadiness(malformed)).toEqual({
      ready: false,
      reasons: [
        'invalid_snapshot_revision',
        'invalid_durable_revision',
        'invalid_expected_revision',
        'invalid_pending_writes',
        'invalid_dirty_state'
      ]
    })

    expect(
      assessMindMapExportSnapshotReadiness(undefined as unknown as MindMapExportSnapshotReadinessInput)
    ).toEqual({
      ready: false,
      reasons: [
        'invalid_snapshot_revision',
        'invalid_durable_revision',
        'invalid_expected_revision',
        'invalid_pending_writes',
        'invalid_dirty_state'
      ]
    })
  })

  it('does not mutate the caller state', () => {
    const input = readyInput({ pendingWrites: true })
    const before = { ...input }

    assessMindMapExportSnapshotReadiness(input)

    expect(input).toEqual(before)
  })
})
