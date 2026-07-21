import { describe, expect, it, vi } from 'vitest'

import {
  TEACHING_DOCTOR_SESSION_DIAGNOSTIC_CODE_HARD_CAP,
  createTeachingDoctorSessionOutcomeScanFactsCollector,
  mapScanToOutcomeCrashWindowFacts,
  mapScanToSessionCrashWindowFacts,
  runProductTeachingDoctor,
  type LearningSessionScanResultLike,
  type TeachingDoctorSessionScanSource
} from '../../src/main/observability'

function scan(partial: Partial<LearningSessionScanResultLike> = {}): LearningSessionScanResultLike {
  return {
    stages: partial.stages ?? [],
    quarantined: partial.quarantined ?? [],
    recoveries: partial.recoveries ?? [],
    diagnostics: partial.diagnostics ?? [],
    canonicalSessions: partial.canonicalSessions,
    sessions: partial.sessions
  }
}

describe('mapScanToSessionCrashWindowFacts', () => {
  it('counts pending/unsafe stages, quarantines, recoveries, and event/manifest gaps', () => {
    const facts = mapScanToSessionCrashWindowFacts(
      scan({
        stages: [
          { kind: 'session', state: 'pending' },
          { kind: 'event', state: 'pending' },
          { kind: 'manifest', state: 'unsafe' },
          { kind: 'event', state: 'cleaned' },
          { kind: 'session', state: 'cleaned' }
        ],
        quarantined: [{ sessionId: 's1' }, { sessionId: 's2' }],
        recoveries: [{ relativePath: 'stage.tmp' }],
        diagnostics: [
          { code: 'unsafe_session_stage' },
          { code: 'unsafe_session_stage' },
          { code: 'event_sequence_conflict' },
          { code: '' },
          { code: '  ' },
          {}
        ]
      })
    )

    expect(facts.pendingStageCount).toBe(2)
    expect(facts.unsafeStageCount).toBe(1)
    expect(facts.quarantinedSessionCount).toBe(2)
    expect(facts.recoveryCount).toBe(1)
    expect(facts.eventManifestGapCount).toBe(2) // event pending + manifest unsafe
    expect(facts.diagnosticCodes).toEqual([
      'unsafe_session_stage',
      'event_sequence_conflict'
    ])
  })

  it('hard-caps unique diagnostic codes and drops path/secret-shaped codes', () => {
    const many = Array.from(
      { length: TEACHING_DOCTOR_SESSION_DIAGNOSTIC_CODE_HARD_CAP + 5 },
      (_, i) => ({ code: `code_${String(i).padStart(2, '0')}` })
    )
    const facts = mapScanToSessionCrashWindowFacts(
      scan({
        diagnostics: [
          ...many,
          { code: 'C:\\Users\\Alice\\secret' },
          { code: 'sk-live-secret-token' },
          { code: '/home/alice/ws' }
        ]
      })
    )
    expect(facts.diagnosticCodes).toHaveLength(TEACHING_DOCTOR_SESSION_DIAGNOSTIC_CODE_HARD_CAP)
    expect(facts.diagnosticCodes[0]).toBe('code_00')
    const blob = JSON.stringify(facts)
    expect(blob).not.toMatch(/Alice|Users|sk-live|\/home\//i)
  })
})

describe('mapScanToOutcomeCrashWindowFacts', () => {
  it('prefers canonicalSessions for settled / needsProjectionRepair counts', () => {
    const facts = mapScanToOutcomeCrashWindowFacts(
      scan({
        stages: [
          { kind: 'session', state: 'pending' },
          { kind: 'session', state: 'pending' },
          { kind: 'event', state: 'pending' }
        ],
        canonicalSessions: [
          { status: 'completed', outcomeRef: { outcomeId: 'o1' } },
          { status: 'completed', outcomeRef: null },
          { status: 'active', outcomeRef: null },
          { status: 'completed' }
        ],
        sessions: [
          // Should be ignored when canonicalSessions is present.
          { source: 'canonical', status: 'completed', outcomeRef: null }
        ],
        diagnostics: [
          { code: 'invalid_session_outcome' },
          { code: 'unknown_session_schema' },
          { code: 'canonical_identity_conflict' },
          { code: 'stale_session_stage' },
          { code: 'broken_outcome_marker' }
        ]
      })
    )

    expect(facts.settledCount).toBe(1)
    expect(facts.needsProjectionRepairCount).toBe(2) // completed without outcomeRef (null + absent)
    expect(facts.pendingSettlementCount).toBe(2) // session+pending stages only
    // known review codes (3) + code containing "outcome" (broken_outcome_marker)
    expect(facts.reviewRequiredCount).toBe(4)
  })

  it('falls back to non-legacy sessions when canonicalSessions is absent', () => {
    const facts = mapScanToOutcomeCrashWindowFacts(
      scan({
        sessions: [
          { source: 'canonical', status: 'completed', outcomeRef: { outcomeId: 'o1' } },
          { source: 'legacy_lesson', status: 'legacy_read_only', outcomeRef: null, readOnly: true },
          { source: 'canonical', status: 'completed', outcomeRef: null },
          { status: 'active', outcomeRef: null, readOnly: true } // readOnly filtered
        ]
      })
    )
    expect(facts.settledCount).toBe(1)
    expect(facts.needsProjectionRepairCount).toBe(1)
    expect(facts.pendingSettlementCount).toBe(0)
    expect(facts.reviewRequiredCount).toBe(0)
  })
})

describe('createTeachingDoctorSessionOutcomeScanFactsCollector', () => {
  it('maps successful scan into both sessionCrashWindow and outcomeCrashWindow (one load)', async () => {
    const loadScan = vi.fn(async () =>
      scan({
        stages: [{ kind: 'session', state: 'pending' }],
        diagnostics: [{ code: 'invalid_session_outcome' }],
        canonicalSessions: [{ status: 'completed', outcomeRef: null }]
      })
    )
    const source: TeachingDoctorSessionScanSource = { loadScan }
    const collector = createTeachingDoctorSessionOutcomeScanFactsCollector(source)
    expect(collector.id).toBe('session-outcome-scan')

    const partial = await collector.collect()
    expect(loadScan).toHaveBeenCalledTimes(1)
    expect(partial.sessionCrashWindow).toEqual({
      pendingStageCount: 1,
      unsafeStageCount: 0,
      quarantinedSessionCount: 0,
      recoveryCount: 0,
      diagnosticCodes: ['invalid_session_outcome'],
      eventManifestGapCount: 0
    })
    expect(partial.outcomeCrashWindow).toEqual({
      pendingSettlementCount: 1,
      needsProjectionRepairCount: 1,
      reviewRequiredCount: 1,
      settledCount: 0
    })
    expect(partial).not.toHaveProperty('config')
    expect(partial).not.toHaveProperty('catalogDrift')
  })

  it('returns empty partial when loadScan yields null (no active workspace → skipped checks)', async () => {
    const partial = await createTeachingDoctorSessionOutcomeScanFactsCollector({
      async loadScan() {
        return null
      }
    }).collect()
    expect(partial).toEqual({})
    expect(partial.sessionCrashWindow).toBeUndefined()
    expect(partial.outcomeCrashWindow).toBeUndefined()
  })

  it('returns empty partial when loadScan yields undefined', async () => {
    const partial = await createTeachingDoctorSessionOutcomeScanFactsCollector({
      async loadScan() {
        return undefined
      }
    }).collect()
    expect(partial).toEqual({})
  })

  it('fail-soft on loadScan throw: empty partial, never rethrows secrets/paths', async () => {
    const collector = createTeachingDoctorSessionOutcomeScanFactsCollector({
      async loadScan() {
        throw new Error(`ENOENT C:\\Users\\Alice\\workspace key=sk-live-secret-xyz`)
      }
    })
    const partial = await collector.collect()
    expect(partial).toEqual({})
    const blob = JSON.stringify(partial)
    expect(blob).not.toContain('Alice')
    expect(blob).not.toContain('sk-live')
    expect(blob).not.toMatch(/C:\\\\Users/i)
  })

  it('product-run with crash-window scan surfaces fail for session + outcome checks', async () => {
    const collector = createTeachingDoctorSessionOutcomeScanFactsCollector({
      async loadScan() {
        return scan({
          stages: [
            { kind: 'event', state: 'pending' },
            { kind: 'session', state: 'pending' }
          ],
          canonicalSessions: [{ status: 'completed', outcomeRef: null }],
          diagnostics: [{ code: 'invalid_session_outcome' }]
        })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const sessionCheck = report.checks.find(
      (c) => c.checkId === 'p0_session_event_manifest_crash_window'
    )
    const outcomeCheck = report.checks.find(
      (c) => c.checkId === 'p0_outcome_publication_crash_window'
    )
    expect(sessionCheck?.result).toBe('fail')
    expect(sessionCheck?.evidence.fields.pendingStageCount).toBe(2)
    expect(sessionCheck?.evidence.fields.eventManifestGapCount).toBe(1)
    expect(outcomeCheck?.result).toBe('fail')
    expect(outcomeCheck?.evidence.fields.pendingSettlementCount).toBe(1)
    expect(outcomeCheck?.evidence.fields.needsProjectionRepairCount).toBe(1)
    expect(sessionCheck?.repair.autoRepairAllowed).toBe(false)
    expect(outcomeCheck?.repair.autoRepairAllowed).toBe(false)
    expect(report.diagnostics.autoRepair).toBe('disabled')

    const blob = JSON.stringify(report)
    expect(blob).not.toMatch(/C:\\\\Users|\/home\//i)
  })

  it('product-run with null scan keeps session + outcome checks skipped', async () => {
    const collector = createTeachingDoctorSessionOutcomeScanFactsCollector({
      async loadScan() {
        return null
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    expect(
      report.checks.find((c) => c.checkId === 'p0_session_event_manifest_crash_window')?.result
    ).toBe('skipped')
    expect(
      report.checks.find((c) => c.checkId === 'p0_outcome_publication_crash_window')?.result
    ).toBe('skipped')
  })

  it('product-run with clean scan marks session + outcome checks ok', async () => {
    const collector = createTeachingDoctorSessionOutcomeScanFactsCollector({
      async loadScan() {
        return scan({
          stages: [{ kind: 'session', state: 'cleaned' }],
          canonicalSessions: [
            { status: 'completed', outcomeRef: { outcomeId: 'o1' } },
            { status: 'active', outcomeRef: null }
          ],
          diagnostics: []
        })
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    expect(
      report.checks.find((c) => c.checkId === 'p0_session_event_manifest_crash_window')?.result
    ).toBe('ok')
    const outcome = report.checks.find(
      (c) => c.checkId === 'p0_outcome_publication_crash_window'
    )
    expect(outcome?.result).toBe('ok')
    expect(outcome?.evidence.fields.settledCount).toBe(1)
    expect(outcome?.evidence.fields.needsProjectionRepairCount).toBe(0)
    expect(outcome?.evidence.fields.pendingSettlementCount).toBe(0)
  })
})
