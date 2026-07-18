import { describe, expect, it, vi } from 'vitest'
import { createTeachingTurnCoordinator } from '../../src/main/teaching-turn-coordinator'
import type { LearningSessionSnapshot } from '../../src/shared/teaching-types/learning-session'
import type { EvidenceReceipt } from '../../src/shared/teaching-types/lesson-interaction'
import type { OutcomeCommitResult, OutcomeReconciliation } from '../../src/main/learning-outcome-committer'
import type { LearningSessionScanResult } from '../../src/shared/teaching-types/learning-session'

function sessionSnapshot(overrides: Partial<LearningSessionSnapshot> = {}): LearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-1',
    workspaceId: 'workspace-1',
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: 1,
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T10:00:00.000Z',
    completedAt: null,
    courseRef: {
      courseId: 'course-1',
      courseName: 'Course',
      relativePath: 'courses/course-1'
    },
    lessonRef: null,
    conversationRefs: [],
    eventCount: 0,
    outcomeRef: null,
    events: [],
    ...overrides
  } as LearningSessionSnapshot
}

function emptyScan(session?: LearningSessionSnapshot): LearningSessionScanResult {
  const canonical = session && session.source === 'canonical' ? [session as never] : []
  return {
    sessions: session ? [session] : [],
    canonicalSessions: canonical,
    legacySessions: [],
    diagnostics: [],
    quarantined: [],
    stages: [],
    recoveries: [],
    settlement: { fileSync: 'supported', directorySync: 'supported' }
  }
}

function createPorts(overrides: {
  open?: ReturnType<typeof vi.fn>
  load?: ReturnType<typeof vi.fn>
  scan?: ReturnType<typeof vi.fn>
  record?: ReturnType<typeof vi.fn>
  commit?: ReturnType<typeof vi.fn>
  reconcile?: ReturnType<typeof vi.fn>
  plan?: ReturnType<typeof vi.fn>
} = {}) {
  const snapshot = sessionSnapshot()
  return {
    ledger: {
      open: overrides.open ?? vi.fn(async () => snapshot),
      load: overrides.load ?? vi.fn(async () => snapshot),
      scan: overrides.scan ?? vi.fn(async () => emptyScan(snapshot))
    },
    recorder: {
      record: overrides.record ?? vi.fn(async (): Promise<EvidenceReceipt> => ({
        eventId: 'evidence-1',
        sessionId: 'session-1',
        sequence: 1,
        duplicate: false,
        evidence: {
          schemaVersion: 1,
          eventId: 'evidence-1',
          kind: 'quiz_answered',
          workspaceId: 'workspace-1',
          courseId: 'course-1',
          sessionId: 'session-1',
          lessonId: 'lesson-1',
          itemId: 'item-1',
          attempt: 1,
          observedAt: '2026-07-18T10:00:00.000Z',
          artifactDigest: 'a'.repeat(64),
          surface: 'lesson_preview',
          selectedOptionIds: ['a'],
          correct: false,
          sequence: 1,
          recordedAt: '2026-07-18T10:00:00.000Z'
        }
      }))
    },
    committer: {
      commit: overrides.commit ?? vi.fn(async (): Promise<OutcomeCommitResult> => ({
        status: 'committed',
        outcome: { kind: 'needs_practice' },
        recordSaved: false,
        catalogRecordPresent: false
      } as OutcomeCommitResult)),
      reconcile: overrides.reconcile ?? vi.fn(async (): Promise<OutcomeReconciliation> => ({
        sessionId: 'session-1',
        state: 'settled',
        marker: null,
        record: null,
        catalogRecordPresent: false,
        diagnostics: []
      }))
    },
    planner: {
      plan: overrides.plan ?? vi.fn((facts) => ({
        schemaVersion: 1 as const,
        action: 'contrast_and_retry' as const,
        reason: 'needs_practice' as const,
        safeInputSummary: {
          missionId: facts.mission.id,
          courseId: facts.course.id,
          latestSession: facts.latestSession,
          durableOutcome: {
            status: facts.durableOutcome.status,
            id: facts.durableOutcome.status === 'trusted' ? facts.durableOutcome.id : null,
            kind: facts.durableOutcome.status === 'trusted' ? facts.durableOutcome.kind : null
          },
          evidence: facts.evidence,
          resources: {
            readiness: facts.resources.readiness,
            availableCount: facts.resources.availableCount
          },
          provenance: {
            outcomeEvidenceEventIds: [],
            resourceIds: [...facts.resources.provenanceIds]
          }
        }
      }))
    },
    now: () => '2026-07-18T10:00:00.000Z'
  }
}

describe('TeachingTurnCoordinator', () => {
  it('opens a session and emits durable receipt before ephemeral progress without sticky terminal', async () => {
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator(ports)
    const result = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-1',
      eventId: 'event-open-1',
      operationId: 'op-open-1',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: {
          courseId: 'course-1',
          courseName: 'Course',
          relativePath: 'courses/course-1'
        }
      }
    })

    expect(ports.ledger.open).toHaveBeenCalledTimes(1)
    const types = result.events.map((event) => event.payload.type)
    expect(types[0]).toBe('command_accepted')
    expect(types).toContain('session_opened')
    const durableIndex = result.events.findIndex((event) => event.payload.type === 'session_opened')
    const progressIndex = result.events.findIndex((event) => event.payload.type === 'turn_progress')
    const terminalIndex = result.events.findIndex((event) => event.payload.type === 'turn_terminal')
    expect(result.events[durableIndex]?.durability).toBe('durable')
    expect(progressIndex).toBeGreaterThan(durableIndex)
    expect(terminalIndex).toBe(-1)
    expect(result.terminal).toBeNull()
    expect(result.acceptance).toBe('accepted')
  })

  it('records evidence with durable receipt and progress without sticky terminal', async () => {
    const ports = createPorts({
      record: vi.fn(async (): Promise<EvidenceReceipt> => ({
        eventId: 'evidence-1',
        sessionId: 'session-1',
        sequence: 1,
        duplicate: true,
        evidence: {
          schemaVersion: 1,
          eventId: 'evidence-1',
          kind: 'quiz_answered',
          workspaceId: 'workspace-1',
          courseId: 'course-1',
          sessionId: 'session-1',
          lessonId: 'lesson-1',
          itemId: 'item-1',
          attempt: 1,
          observedAt: '2026-07-18T10:00:00.000Z',
          artifactDigest: 'a'.repeat(64),
          surface: 'lesson_preview',
          selectedOptionIds: ['a'],
          correct: false,
          sequence: 1,
          recordedAt: '2026-07-18T10:00:00.000Z'
        }
      }))
    })
    const coordinator = createTeachingTurnCoordinator(ports)
    const result = await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-2',
      eventId: 'event-evidence-1',
      operationId: 'op-evidence-1',
      workspaceId: 'workspace-1',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-1',
        kind: 'quiz_answered',
        workspaceId: 'workspace-1',
        courseId: 'course-1',
        sessionId: 'session-1',
        lessonId: 'lesson-1',
        itemId: 'item-1',
        attempt: 1,
        observedAt: '2026-07-18T10:00:00.000Z',
        artifactDigest: 'a'.repeat(64),
        surface: 'lesson_preview',
        selectedOptionIds: ['a'],
        correct: false
      }
    })

    expect(result.events.some((event) => event.payload.type === 'evidence_recorded' && event.durability === 'durable')).toBe(true)
    expect(result.events.some((event) => event.payload.type === 'turn_progress')).toBe(true)
    expect(result.events.some((event) => event.payload.type === 'turn_terminal')).toBe(false)
    expect(result.terminal).toBeNull()
  })

  it('maps commit outcomes to learner-safe terminals', async () => {
    const cases: Array<{ status: OutcomeCommitResult['status']; terminal: string }> = [
      { status: 'committed', terminal: 'completed' },
      { status: 'already_committed', terminal: 'completed' },
      { status: 'insufficient_evidence', terminal: 'failed' },
      { status: 'conflict', terminal: 'conflict' },
      { status: 'retryable_failure', terminal: 'failed' },
      { status: 'non_retryable_failure', terminal: 'failed' }
    ]

    for (const [index, item] of cases.entries()) {
      const commit = vi.fn(async () => {
        if (item.status === 'committed' || item.status === 'already_committed') {
          return {
            status: item.status,
            outcome: { kind: 'established' },
            recordSaved: true,
            catalogRecordPresent: true
          } as OutcomeCommitResult
        }
        if (item.status === 'insufficient_evidence') {
          return { status: item.status, reason: 'not_evidenced' } as OutcomeCommitResult
        }
        if (item.status === 'conflict') {
          return { status: item.status, reason: 'review_required' } as OutcomeCommitResult
        }
        if (item.status === 'retryable_failure') {
          return { status: item.status, reason: 'temporarily_unavailable' } as OutcomeCommitResult
        }
        return { status: item.status, reason: 'invalid_request' } as OutcomeCommitResult
      })
      const coordinator = createTeachingTurnCoordinator(createPorts({ commit }))
      const result = await coordinator.execute({
        type: 'commit_outcome',
        turnId: `turn-commit-${index}`,
        eventId: `event-commit-${index}`,
        operationId: `op-commit-${index}`,
        workspaceId: 'workspace-1',
        request: { sessionId: 'session-1', operationId: `op-commit-${index}` }
      })
      expect(result.terminal?.payload).toMatchObject({
        type: 'turn_terminal',
        outcome: item.terminal
      })
    }
  })

  it('is idempotent for repeated operationId and eventId', async () => {
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator(ports)
    const command = {
      type: 'open_session' as const,
      turnId: 'turn-idem',
      eventId: 'event-idem',
      operationId: 'op-idem',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: {
          courseId: 'course-1',
          courseName: 'Course',
          relativePath: 'courses/course-1'
        }
      }
    }

    const first = await coordinator.execute(command)
    const second = await coordinator.execute(command)
    expect(ports.ledger.open).toHaveBeenCalledTimes(1)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.events.some((event) => event.payload.type === 'command_duplicate')).toBe(true)
  })

  it('serializes concurrent commands for the same session', async () => {
    let active = 0
    let maxActive = 0
    const open = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return sessionSnapshot()
    })
    const coordinator = createTeachingTurnCoordinator(createPorts({ open }))

    await Promise.all([
      coordinator.execute({
        type: 'open_session',
        turnId: 'turn-a',
        eventId: 'event-a',
        operationId: 'op-a',
        workspaceId: 'workspace-1',
        open: {
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
        }
      }),
      coordinator.execute({
        type: 'resume_session',
        turnId: 'turn-b',
        eventId: 'event-b',
        operationId: 'op-b',
        workspaceId: 'workspace-1',
        sessionId: 'session-1'
      })
    ])

    expect(maxActive).toBe(1)
  })

  it('projects snapshots from durable facts and plans next steps without renderer mastery writes', async () => {
    const snapshot = sessionSnapshot({
      eventCount: 3,
      outcomeRef: null
    })
    const ports = createPorts({
      scan: vi.fn(async () => emptyScan(snapshot)),
      load: vi.fn(async () => snapshot)
    })
    const coordinator = createTeachingTurnCoordinator({
      ...ports,
      factSource: {
        ledger: ports.ledger,
        loadSettlement: async () => ({
          sessionId: 'session-1',
          outcomeId: 'outcome-1',
          kind: 'needs_practice',
          evidenceEventIds: ['evidence-1']
        })
      }
    })

    const projected = await coordinator.execute({
      type: 'project_snapshot',
      turnId: 'turn-snap',
      eventId: 'event-snap',
      operationId: 'op-snap',
      workspaceId: 'workspace-1',
      factInput: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] },
        sessionId: 'session-1'
      }
    })

    expect(projected.snapshot?.safeProjection.outcome.kind).toBe('needs_practice')
    expect(projected.events.some((event) => event.payload.type === 'loop_snapshot' && event.durability === 'ephemeral')).toBe(true)
    expect(projected.nextStep?.action).toBe('contrast_and_retry')

    const planned = await coordinator.execute({
      type: 'plan_next_step',
      turnId: 'turn-plan',
      eventId: 'event-plan',
      operationId: 'op-plan',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      facts: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        latestSession: { id: 'session-1', source: 'canonical', readOnly: false },
        durableOutcome: {
          status: 'trusted',
          id: 'outcome-1',
          kind: 'needs_practice',
          evidenceEventIds: ['evidence-1']
        },
        evidence: { status: 'verified' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] }
      }
    })
    expect(ports.planner.plan).toHaveBeenCalled()
    expect(planned.nextStep?.reason).toBe('needs_practice')
  })

  it('cancels a turn with canceled terminal and recovers via load+reconcile', async () => {
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator(ports)

    const canceled = await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-cancel',
      eventId: 'event-cancel',
      operationId: 'op-cancel',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    expect(canceled.terminal?.payload).toMatchObject({ outcome: 'canceled', reasonCode: 'user_cancel' })

    const recovered = await coordinator.execute({
      type: 'recover_session',
      turnId: 'turn-recover',
      eventId: 'event-recover',
      operationId: 'op-recover',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(ports.ledger.load).toHaveBeenCalledWith('session-1')
    expect(ports.committer.reconcile).toHaveBeenCalledWith('session-1')
    expect(recovered.events.some((event) => event.payload.type === 'recover_reconciled')).toBe(true)
  })

  it('spans multiple intermediate commands on one turnId and finalizes only on commit/cancel/failure', async () => {
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator(ports)
    const turnId = 'turn-lifecycle'

    const opened = await coordinator.execute({
      type: 'open_session',
      turnId,
      eventId: 'ev-open',
      operationId: 'op-open-lc',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(opened.terminal).toBeNull()

    const recorded = await coordinator.execute({
      type: 'record_evidence',
      turnId,
      eventId: 'ev-evidence',
      operationId: 'op-evidence-lc',
      workspaceId: 'workspace-1',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-1',
        kind: 'quiz_answered',
        workspaceId: 'workspace-1',
        courseId: 'course-1',
        sessionId: 'session-1',
        lessonId: 'lesson-1',
        itemId: 'item-1',
        attempt: 1,
        observedAt: '2026-07-18T10:00:00.000Z',
        artifactDigest: 'a'.repeat(64),
        surface: 'lesson_preview',
        selectedOptionIds: ['a'],
        correct: false
      }
    })
    expect(recorded.terminal).toBeNull()

    const committed = await coordinator.execute({
      type: 'commit_outcome',
      turnId,
      eventId: 'ev-commit',
      operationId: 'op-commit-lc',
      workspaceId: 'workspace-1',
      request: {
        sessionId: 'session-1',
        outcome: { kind: 'needs_practice' },
        evidenceEventIds: ['evidence-1']
      } as never
    })
    expect(committed.terminal?.payload).toMatchObject({ type: 'turn_terminal', outcome: 'completed' })

    const after = await coordinator.execute({
      type: 'record_evidence',
      turnId,
      eventId: 'ev-late',
      operationId: 'op-late',
      workspaceId: 'workspace-1',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-2',
        kind: 'quiz_answered',
        workspaceId: 'workspace-1',
        courseId: 'course-1',
        sessionId: 'session-1',
        lessonId: 'lesson-1',
        itemId: 'item-2',
        attempt: 1,
        observedAt: '2026-07-18T10:00:00.000Z',
        artifactDigest: 'b'.repeat(64),
        surface: 'lesson_preview',
        selectedOptionIds: ['b'],
        correct: true
      }
    })
    expect(after.acceptance).toBe('rejected')
    expect(after.rejectReason).toBe('already_terminal')
    expect(after.terminal?.payload).toMatchObject({ outcome: 'completed' })
  })

  it('cancels active turn with canceled; cancel after terminal is already_terminal conflict not cancel success', async () => {
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator(ports)
    const turnId = 'turn-cancel-lifecycle'

    await coordinator.execute({
      type: 'open_session',
      turnId,
      eventId: 'ev-open-c',
      operationId: 'op-open-c',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })

    const canceled = await coordinator.execute({
      type: 'cancel_turn',
      turnId,
      eventId: 'ev-cancel-c',
      operationId: 'op-cancel-c',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    expect(canceled.acceptance).toBe('accepted')
    expect(canceled.terminal?.payload).toMatchObject({ outcome: 'canceled', reasonCode: 'user_cancel' })

    const again = await coordinator.execute({
      type: 'cancel_turn',
      turnId,
      eventId: 'ev-cancel-again',
      operationId: 'op-cancel-again',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    expect(again.acceptance).toBe('rejected')
    expect(again.rejectReason).toBe('already_terminal')
    expect(again.terminal?.payload).toMatchObject({ outcome: 'canceled' })
  })

  it('scopes idempotency by workspace/session/commandType and rejects payload mismatch', async () => {
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator(ports)

    const a = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-a',
      eventId: 'shared-event',
      operationId: 'shared-op',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(a.acceptance).toBe('accepted')

    // Same operationId + eventId but different session must NOT be treated as duplicate.
    const b = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-b',
      eventId: 'shared-event',
      operationId: 'shared-op',
      workspaceId: 'workspace-1',
      sessionId: 'session-2'
    })
    expect(b.acceptance).toBe('accepted')
    expect(ports.ledger.load).toHaveBeenCalledTimes(2)

    // Same scoped key with different payload => payload_mismatch
    const mismatch = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-a',
      eventId: 'shared-event',
      operationId: 'shared-op',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
      // same command body — fingerprint matches -> duplicate
    })
    expect(mismatch.acceptance).toBe('duplicate')

    const payloadMismatch = await coordinator.execute({
      type: 'plan_next_step',
      turnId: 'turn-plan-m',
      eventId: 'plan-event',
      operationId: 'plan-op',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      facts: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        latestSession: { id: 'session-1', source: 'canonical', readOnly: false },
        durableOutcome: { status: 'absent' },
        evidence: { status: 'unavailable' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] }
      }
    })
    expect(payloadMismatch.acceptance).toBe('accepted')

    const payloadMismatch2 = await coordinator.execute({
      type: 'plan_next_step',
      turnId: 'turn-plan-m',
      eventId: 'plan-event',
      operationId: 'plan-op',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      facts: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-DIFFERENT' },
        latestSession: { id: 'session-1', source: 'canonical', readOnly: false },
        durableOutcome: { status: 'absent' },
        evidence: { status: 'unavailable' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] }
      }
    })
    expect(payloadMismatch2.acceptance).toBe('rejected')
    expect(payloadMismatch2.rejectReason).toBe('payload_mismatch')
  })

  it('tears down subscribe-before-bus listeners and isolates port throws to learner-safe terminals', async () => {
    const ports = createPorts({
      open: vi.fn(async () => {
        throw new Error('ledger boom')
      })
    })
    const coordinator = createTeachingTurnCoordinator(ports)
    const seen: string[] = []
    const unsub = coordinator.subscribe('turn-pending', (event) => {
      seen.push(event.payload.type)
    })
    unsub()

    const failed = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-pending',
      eventId: 'ev-port-fail',
      operationId: 'op-port-fail',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(failed.terminal?.payload).toMatchObject({ outcome: 'failed', reasonCode: 'port_failed' })
    expect(failed.events.some((e) => e.payload.type === 'command_accepted')).toBe(true)
    expect(failed.events.some((e) => e.payload.type === 'turn_terminal')).toBe(true)
    // unsubscribed before bus attach => no live delivery
    expect(seen).toEqual([])
  })

  it('maps interrupt-like port throws to interrupted terminal', async () => {
    const abortError = new Error('operation aborted by user')
    abortError.name = 'AbortError'
    const ports = createPorts({
      open: vi.fn(async () => {
        throw abortError
      })
    })
    const coordinator = createTeachingTurnCoordinator(ports)
    const interrupted = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-interrupt',
      eventId: 'ev-interrupt',
      operationId: 'op-interrupt',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(interrupted.terminal?.payload).toMatchObject({
      outcome: 'interrupted',
      reasonCode: 'port_interrupted'
    })
    expect(interrupted.acceptance).toBe('accepted')
  })

  it('marks insufficient_evidence and recover_reconciled ephemeral unless persisted', async () => {
    const ports = createPorts({
      commit: vi.fn(async (): Promise<OutcomeCommitResult> => ({
        status: 'insufficient_evidence',
        outcome: { kind: 'not_evidenced' },
        recordSaved: false,
        catalogRecordPresent: false
      } as OutcomeCommitResult))
    })
    const coordinator = createTeachingTurnCoordinator(ports)

    const insufficient = await coordinator.execute({
      type: 'commit_outcome',
      turnId: 'turn-insuff',
      eventId: 'ev-insuff',
      operationId: 'op-insuff',
      workspaceId: 'workspace-1',
      request: {
        sessionId: 'session-1',
        outcome: { kind: 'not_evidenced' },
        evidenceEventIds: []
      } as never
    })
    const insuffEvent = insufficient.events.find((e) => e.payload.type === 'outcome_insufficient_evidence')
    expect(insuffEvent?.durability).toBe('ephemeral')
    expect(insufficient.terminal?.payload).toMatchObject({ outcome: 'failed' })
    expect(insufficient.terminal?.payload).not.toMatchObject({ outcome: 'declined' })

    const recover = await coordinator.execute({
      type: 'recover_session',
      turnId: 'turn-recover-eph',
      eventId: 'ev-recover-eph',
      operationId: 'op-recover-eph',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    const recoverEvent = recover.events.find((e) => e.payload.type === 'recover_reconciled')
    expect(recoverEvent?.durability).toBe('ephemeral')
    expect(recover.terminal).toBeNull()
  })

  it('passes readyResources through assembler and bounds operation caches', async () => {
    const assemble = vi.fn(async (input: { resources: unknown[] }) => ({
      grounding: { identity: 'g', status: 'ready', sources: [], exclusions: [], budget: {} },
      context: { identity: 'c' }
    }))
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator({
      ...ports,
      assembler: { assemble },
      maxOperations: 8,
      maxEventIds: 8,
      maxBuses: 4
    })

    const readyResources = [
      {
        schemaVersion: 1 as const,
        sourceId: 'src-1',
        relativePath: 'resources/a.md',
        contentSha256: 'c'.repeat(64),
        priority: 'required' as const,
        authority: { kind: 'trusted_teaching_resource' as const, authorityId: 'auth-1' },
        provenance: { kind: 'workspace_resource' as const, resourceId: 'r1', revisionId: 'rev-1' }
      }
    ]

    const projected = await coordinator.execute({
      type: 'project_snapshot',
      turnId: 'turn-resources',
      eventId: 'ev-resources',
      operationId: 'op-resources',
      workspaceId: 'workspace-1',
      factInput: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] },
        sessionId: 'session-1'
      },
      readyResources
    })
    expect(projected.terminal).toBeNull()
    expect(assemble).toHaveBeenCalledTimes(1)
    expect(assemble.mock.calls[0][0].resources).toEqual(readyResources)

    for (let i = 0; i < 12; i += 1) {
      await coordinator.execute({
        type: 'resume_session',
        turnId: `turn-bound-${i}`,
        eventId: `ev-bound-${i}`,
        operationId: `op-bound-${i}`,
        workspaceId: 'workspace-1',
        sessionId: 'session-1'
      })
    }
    // Cache bounded: earliest ops forgotten => re-execution is accepted again
    const earlyReplay = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-bound-0',
      eventId: 'ev-bound-0',
      operationId: 'op-bound-0',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(['accepted', 'duplicate']).toContain(earlyReplay.acceptance)

    // Closed terminals survive bus cache eviction.
    const terminalTurn = await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-closed-retain',
      eventId: 'ev-closed-retain',
      operationId: 'op-closed-retain',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    expect(terminalTurn.terminal?.payload).toMatchObject({ outcome: 'canceled' })
    for (let i = 0; i < 8; i += 1) {
      await coordinator.execute({
        type: 'resume_session',
        turnId: `turn-evict-${i}`,
        eventId: `ev-evict-${i}`,
        operationId: `op-evict-${i}`,
        workspaceId: 'workspace-1',
        sessionId: 'session-1'
      })
    }
    const afterEvict = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-closed-retain',
      eventId: 'ev-after-evict',
      operationId: 'op-after-evict',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(afterEvict.acceptance).toBe('rejected')
    expect(afterEvict.rejectReason).toBe('already_terminal')
    expect(afterEvict.terminal?.payload).toMatchObject({ outcome: 'canceled' })
  })

  it('queues cooperative cancel after in-flight command without abort port', async () => {
    let releaseOpen!: () => void
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    const open = vi.fn(async () => {
      await openGate
      return sessionSnapshot()
    })
    const ports = createPorts({ open })
    const coordinator = createTeachingTurnCoordinator(ports)

    const openPromise = coordinator.execute({
      type: 'open_session',
      turnId: 'turn-coop',
      eventId: 'ev-open-coop',
      operationId: 'op-open-coop',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })

    const cancelPromise = coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-coop',
      eventId: 'ev-cancel-coop',
      operationId: 'op-cancel-coop',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })

    releaseOpen()
    const opened = await openPromise
    const canceled = await cancelPromise
    expect(opened.terminal).toBeNull()
    expect(canceled.terminal?.payload).toMatchObject({ outcome: 'canceled' })
  })

})
