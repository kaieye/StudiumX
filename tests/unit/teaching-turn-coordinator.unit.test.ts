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
  const sessions = new Map<string, LearningSessionSnapshot>()
  sessions.set(snapshot.id, snapshot)
  /** Authority markers written by default commit mock so H3 reload/verify can pass. */
  const settlementBySession = new Map<string, NonNullable<OutcomeReconciliation['marker']>>()
  return {
    ledger: {
      open: (() => {
        const defaultOpen = vi.fn(
          async (input: { sessionId?: string; workspaceId?: string; courseRef?: { courseId: string } }) => {
            const opened = sessionSnapshot({
              id: input.sessionId ?? snapshot.id,
              workspaceId: input.workspaceId ?? snapshot.workspaceId,
              ...(input.courseRef
                ? {
                    courseRef: {
                      courseId: input.courseRef.courseId,
                      courseName: 'Course',
                      relativePath: 'courses/' + input.courseRef.courseId
                    }
                  }
                : {})
            })
            sessions.set(opened.id, opened)
            return opened
          }
        )
        if (!overrides.open) return defaultOpen
        // Register override open results so post-open authority load is not null by default.
        return vi.fn(async (...args: unknown[]) => {
          const opened = await overrides.open!(...args)
          if (opened && typeof opened === 'object' && 'id' in opened && typeof (opened as { id: unknown }).id === 'string') {
            sessions.set((opened as LearningSessionSnapshot).id, opened as LearningSessionSnapshot)
          }
          return opened
        })
      })(),
      load:
        overrides.load ??
        vi.fn(async (sessionId: string) => {
          return sessions.get(sessionId) ?? null
        }),
      scan: overrides.scan ?? vi.fn(async () => emptyScan(sessions.get(snapshot.id) ?? snapshot))
    },
    recorder: {
      record: overrides.record ?? vi.fn(async (evidence: { eventId: string; sessionId: string; workspaceId: string; kind: string }): Promise<EvidenceReceipt> => {
        const existing = sessions.get(evidence.sessionId)
        const sequence = (existing?.eventCount ?? 0) + 1
        if (existing) {
          sessions.set(evidence.sessionId, {
            ...existing,
            eventCount: sequence,
            events: [
              ...(existing.events ?? []),
              { eventId: evidence.eventId, sequence } as never
            ]
          })
        }
        return {
          eventId: evidence.eventId,
          sessionId: evidence.sessionId,
          sequence,
          duplicate: false,
          evidence: {
            schemaVersion: 1,
            eventId: evidence.eventId,
            kind: 'quiz_answered',
            workspaceId: evidence.workspaceId,
            courseId: 'course-1',
            sessionId: evidence.sessionId,
            lessonId: 'lesson-1',
            itemId: 'item-1',
            attempt: 1,
            observedAt: '2026-07-18T10:00:00.000Z',
            artifactDigest: 'a'.repeat(64),
            surface: 'lesson_preview',
            selectedOptionIds: ['a'],
            correct: false,
            sequence,
            recordedAt: '2026-07-18T10:00:00.000Z'
          } as EvidenceReceipt['evidence']
        }
      })
    },
    committer: {
      commit: overrides.commit ?? vi.fn(async (request: { sessionId: string }): Promise<OutcomeCommitResult> => {
        const marker = {
          schemaVersion: 1 as const,
          sessionId: request.sessionId,
          outcomeId: 'outcome-1',
          operationId: 'op-default',
          kind: 'needs_practice' as const,
          evidenceEventIds: ['evidence-1'],
          evaluatorVersion: 1,
          record: null
        }
        settlementBySession.set(request.sessionId, marker)
        return {
          status: 'committed',
          outcome: { kind: 'needs_practice' },
          recordSaved: false,
          catalogRecordPresent: false
        } as OutcomeCommitResult
      }),
      reconcile: overrides.reconcile ?? vi.fn(async (sessionId: string): Promise<OutcomeReconciliation> => ({
        sessionId,
        state: settlementBySession.has(sessionId) ? 'settled' : 'pending',
        marker: settlementBySession.get(sessionId) ?? null,
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
    const cases: Array<{ status: OutcomeCommitResult['status']; terminal: string | null }> = [
      { status: 'committed', terminal: 'completed' },
      { status: 'already_committed', terminal: 'completed' },
      { status: 'insufficient_evidence', terminal: 'failed' },
      { status: 'conflict', terminal: 'conflict' },
      { status: 'retryable_failure', terminal: null },
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
      const reconcile = vi.fn(async (sessionId: string): Promise<OutcomeReconciliation> => {
        if (item.status === 'committed' || item.status === 'already_committed') {
          return {
            sessionId,
            state: 'settled',
            marker: {
              schemaVersion: 1,
              sessionId,
              outcomeId: 'outcome-established',
              operationId: 'op-commit',
              kind: 'established',
              evidenceEventIds: ['evidence-1'],
              evaluatorVersion: 1,
              record: { recordId: 'rec-1', relativePath: 'learning-records/rec-1.md', contentSha256: 'a'.repeat(64) }
            },
            record: { recordId: 'rec-1', relativePath: 'learning-records/rec-1.md', contentSha256: 'a'.repeat(64) },
            catalogRecordPresent: true,
            diagnostics: []
          }
        }
        return {
          sessionId,
          state: 'pending',
          marker: null,
          record: null,
          catalogRecordPresent: false,
          diagnostics: []
        }
      })
      const coordinator = createTeachingTurnCoordinator(createPorts({ commit, reconcile }))
      const result = await coordinator.execute({
        type: 'commit_outcome',
        turnId: `turn-commit-${index}`,
        eventId: `event-commit-${index}`,
        operationId: `op-commit-${index}`,
        workspaceId: 'workspace-1',
        request: { sessionId: 'session-1', operationId: `op-commit-${index}` }
      })
      if (item.terminal === null) {
        expect(result.terminal).toBeNull()
        expect(result.events.some((e) => e.payload.type === 'turn_terminal')).toBe(false)
      } else {
        expect(result.terminal?.payload).toMatchObject({
          type: 'turn_terminal',
          outcome: item.terminal
        })
      }
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
        operationId: 'op-commit-lc'
      }
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

  it('tears down subscribe-before-bus listeners and keeps intermediate port failures non-terminal', async () => {
    const ports = createPorts({
      open: vi.fn(async () => {
        throw new Error('ledger boom')
      })
    })
    const coordinator = createTeachingTurnCoordinator(ports)
    const seen: string[] = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-pending' }, (event) => {
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
    expect(failed.terminal).toBeNull()
    // H3: command_accepted only after preflight + port identity verification succeed.
    expect(failed.events.some((e) => e.payload.type === 'command_accepted')).toBe(false)
    expect(failed.events.some((e) => e.payload.type === 'turn_terminal')).toBe(false)
    expect(failed.events.some((e) => e.payload.type === 'turn_progress' && (e.payload as { stage: string }).stage === 'port_failed')).toBe(true)
    // unsubscribed before bus attach => no live delivery
    expect(seen).toEqual([])
  })

  it('maps interrupt-like intermediate port throws to progress without sticky terminal', async () => {
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
    expect(interrupted.terminal).toBeNull()
    expect(interrupted.acceptance).toBe('accepted')
    expect(interrupted.events.some((e) => e.payload.type === 'turn_progress' && (e.payload as { stage: string }).stage === 'port_interrupted')).toBe(true)
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
        operationId: 'op-insuff'
      }
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

    // Fill idempotency capacity fail-closed (maxOperations=8 includes prior project op).
    // Keep one turnId so bus capacity is not exhausted while testing operation identity retention.
    for (let i = 0; i < 7; i += 1) {
      const r = await coordinator.execute({
        type: 'resume_session',
        turnId: 'turn-bound-cap',
        eventId: `ev-bound-${i}`,
        operationId: `op-bound-${i}`,
        workspaceId: 'workspace-1',
        sessionId: 'session-1'
      })
      expect(r.acceptance).toBe('accepted')
    }
    const overCap = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-bound-cap',
      eventId: 'ev-bound-over',
      operationId: 'op-bound-over',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(overCap.acceptance).toBe('rejected')
    expect(overCap.rejectReason).toBe('capacity_exceeded')

    // Earliest op identity retained (not silently evicted) => duplicate still works.
    const earlyReplay = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-bound-cap',
      eventId: 'ev-bound-0',
      operationId: 'op-bound-0',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(earlyReplay.acceptance).toBe('duplicate')
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

  it('positive pre-subscribe receives live events for workspace+turn scope', async () => {
    const coordinator = createTeachingTurnCoordinator(createPorts())
    const seen: string[] = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-presub' }, (event) => {
      seen.push(event.payload.type)
    })
    await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-presub',
      eventId: 'ev-presub',
      operationId: 'op-presub',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    unsub()
    expect(seen).toContain('command_accepted')
    expect(seen).toContain('session_opened')
    expect(seen).toContain('turn_progress')
  })

  it('isolates same turnId across workspaces and keeps independent buses', async () => {
    const coordinator = createTeachingTurnCoordinator(createPorts())
    const a = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-shared',
      eventId: 'ev-a',
      operationId: 'op-a',
      workspaceId: 'workspace-a',
      open: {
        sessionId: 'session-a',
        workspaceId: 'workspace-a',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    const b = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-shared',
      eventId: 'ev-b',
      operationId: 'op-b',
      workspaceId: 'workspace-b',
      open: {
        sessionId: 'session-b',
        workspaceId: 'workspace-b',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(a.acceptance).toBe('accepted')
    expect(b.acceptance).toBe('accepted')
    expect(a.terminal).toBeNull()
    expect(b.terminal).toBeNull()

    await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-shared',
      eventId: 'ev-cancel-a',
      operationId: 'op-cancel-a',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      reasonCode: 'user_cancel'
    })
    const stillOpenB = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-shared',
      eventId: 'ev-resume-b',
      operationId: 'op-resume-b',
      workspaceId: 'workspace-b',
      sessionId: 'session-b'
    })
    expect(stillOpenB.acceptance).toBe('accepted')
    expect(stillOpenB.terminal).toBeNull()

    const closedA = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-shared',
      eventId: 'ev-resume-a',
      operationId: 'op-resume-a',
      workspaceId: 'workspace-a',
      sessionId: 'session-a'
    })
    expect(closedA.acceptance).toBe('rejected')
    expect(closedA.rejectReason).toBe('already_terminal')
  })

  it('allows same-turn retry after retryable_failure without sticky terminal', async () => {
    let calls = 0
    let settled = false
    const commit = vi.fn(async (request: { sessionId: string }): Promise<OutcomeCommitResult> => {
      calls += 1
      if (calls === 1) {
        return { status: 'retryable_failure', reason: 'temporarily_unavailable' } as OutcomeCommitResult
      }
      settled = true
      return {
        status: 'committed',
        outcome: { kind: 'established' },
        recordSaved: true,
        catalogRecordPresent: true
      } as OutcomeCommitResult
    })
    const reconcile = vi.fn(async (sessionId: string): Promise<OutcomeReconciliation> => ({
      sessionId,
      state: settled ? 'settled' : 'pending',
      marker: settled
        ? {
            schemaVersion: 1,
            sessionId,
            outcomeId: 'outcome-retry',
            operationId: 'op-retry-2',
            kind: 'established',
            evidenceEventIds: ['evidence-1'],
            evaluatorVersion: 1,
            record: null
          }
        : null,
      record: null,
      catalogRecordPresent: settled,
      diagnostics: []
    }))
    const coordinator = createTeachingTurnCoordinator(createPorts({ commit, reconcile }))
    const first = await coordinator.execute({
      type: 'commit_outcome',
      turnId: 'turn-retry',
      eventId: 'ev-retry-1',
      operationId: 'op-retry-1',
      workspaceId: 'workspace-1',
      request: {
        sessionId: 'session-1',
        operationId: 'op-retry-1'
      }
    })
    expect(first.terminal).toBeNull()
    const second = await coordinator.execute({
      type: 'commit_outcome',
      turnId: 'turn-retry',
      eventId: 'ev-retry-2',
      operationId: 'op-retry-2',
      workspaceId: 'workspace-1',
      request: {
        sessionId: 'session-1',
        operationId: 'op-retry-2'
      }
    })
    expect(second.acceptance).toBe('accepted')
    expect(second.terminal?.payload).toMatchObject({ outcome: 'completed', reasonCode: 'committed' })
  })

  it('treats same operationId on different turns as independent (fingerprint includes turnId)', async () => {
    const ports = createPorts()
    const coordinator = createTeachingTurnCoordinator(ports)
    const baseOpen = {
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
    }
    const first = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-x',
      eventId: 'ev-shared-op',
      operationId: 'op-shared',
      workspaceId: 'workspace-1',
      open: baseOpen
    })
    const second = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-y',
      eventId: 'ev-shared-op-2',
      operationId: 'op-shared',
      workspaceId: 'workspace-1',
      open: baseOpen
    })
    expect(first.acceptance).toBe('accepted')
    expect(second.acceptance).toBe('accepted')
    expect(ports.ledger.open).toHaveBeenCalledTimes(2)
  })

  it('fail-closes when active bus capacity is exhausted without silent active eviction', async () => {
    const coordinator = createTeachingTurnCoordinator({
      ...createPorts(),
      maxOperations: 64,
      maxEventIds: 64,
      maxBuses: 4
    })
    for (let i = 0; i < 4; i += 1) {
      const r = await coordinator.execute({
        type: 'open_session',
        turnId: `turn-active-${i}`,
        eventId: `ev-active-${i}`,
        operationId: `op-active-${i}`,
        workspaceId: 'workspace-1',
        open: {
          sessionId: `session-active-${i}`,
          workspaceId: 'workspace-1',
          courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
        }
      })
      expect(r.acceptance).toBe('accepted')
      expect(r.terminal).toBeNull()
    }
    const blocked = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-active-blocked',
      eventId: 'ev-active-blocked',
      operationId: 'op-active-blocked',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-active-blocked',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(blocked.acceptance).toBe('rejected')
    expect(blocked.rejectReason).toBe('capacity_exceeded')

    // Existing active turn still works
    const still = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-active-0',
      eventId: 'ev-active-0-resume',
      operationId: 'op-active-0-resume',
      workspaceId: 'workspace-1',
      sessionId: 'session-active-0'
    })
    expect(still.acceptance).toBe('accepted')
  })

  it('reclaims closed buses under pressure while retaining closed terminal identity', async () => {
    const coordinator = createTeachingTurnCoordinator({
      ...createPorts(),
      maxOperations: 64,
      maxEventIds: 64,
      maxBuses: 4
    })
    for (let i = 0; i < 4; i += 1) {
      const canceled = await coordinator.execute({
        type: 'cancel_turn',
        turnId: `turn-closed-${i}`,
        eventId: `ev-closed-${i}`,
        operationId: `op-closed-${i}`,
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        reasonCode: 'user_cancel'
      })
      expect(canceled.terminal?.payload).toMatchObject({ outcome: 'canceled' })
    }
    // New active turn can be created after closed reclaim
    const opened = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-after-reclaim',
      eventId: 'ev-after-reclaim',
      operationId: 'op-after-reclaim',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(opened.acceptance).toBe('accepted')

    const stillClosed = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-closed-0',
      eventId: 'ev-still-closed',
      operationId: 'op-still-closed',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(stillClosed.acceptance).toBe('rejected')
    expect(stillClosed.rejectReason).toBe('already_terminal')
    expect(stillClosed.terminal?.payload).toMatchObject({ outcome: 'canceled' })
  })

  it('serializes concurrent commands for the same scoped turn/session', async () => {
    let active = 0
    let maxActive = 0
    const open = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      return sessionSnapshot({ id: 'session-serial' })
    })
    const coordinator = createTeachingTurnCoordinator(createPorts({ open }))
    await Promise.all([
      coordinator.execute({
        type: 'open_session',
        turnId: 'turn-serial-1',
        eventId: 'ev-s1',
        operationId: 'op-s1',
        workspaceId: 'workspace-1',
        open: {
          sessionId: 'session-serial',
          workspaceId: 'workspace-1',
          courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
        }
      }),
      coordinator.execute({
        type: 'open_session',
        turnId: 'turn-serial-2',
        eventId: 'ev-s2',
        operationId: 'op-s2',
        workspaceId: 'workspace-1',
        open: {
          sessionId: 'session-serial',
          workspaceId: 'workspace-1',
          courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
        }
      })
    ])
    expect(maxActive).toBe(1)
  })



  it('B3 cross-session capacity admission: only one of two racers may call port; loser zero events', async () => {
    let openCalls = 0
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let raceEntered = 0
    const open = vi.fn(async (input: { sessionId?: string }) => {
      openCalls += 1
      // Only gate the two racing sessions (fill ops use default path below if needed)
      if (input.sessionId === 'session-race-a' || input.sessionId === 'session-race-b') {
        const n = ++raceEntered
        if (n === 1) {
          await firstGate
        }
      }
      return sessionSnapshot({
        id: input.sessionId ?? `session-${openCalls}`,
        workspaceId: 'workspace-1'
      })
    })
    // Floor clamp is max(8, n); fill 7 committed ops then race two for the last slot.
    const coordinator = createTeachingTurnCoordinator({
      ...createPorts({ open }),
      maxOperations: 8,
      maxEventIds: 8,
      maxBuses: 16
    })
    for (let i = 0; i < 7; i += 1) {
      const filled = await coordinator.execute({
        type: 'resume_session',
        turnId: `turn-fill-${i}`,
        eventId: `ev-fill-${i}`,
        operationId: `op-fill-${i}`,
        workspaceId: 'workspace-1',
        sessionId: `session-fill-${i}`
      })
      expect(filled.acceptance).toBe('accepted')
    }

    const p1 = coordinator.execute({
      type: 'open_session',
      turnId: 'turn-race-a',
      eventId: 'ev-race-a',
      operationId: 'op-race-a',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-race-a',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    await new Promise((r) => setTimeout(r, 25))

    const p2 = coordinator.execute({
      type: 'open_session',
      turnId: 'turn-race-b',
      eventId: 'ev-race-b',
      operationId: 'op-race-b',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-race-b',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    await new Promise((r) => setTimeout(r, 25))
    releaseFirst?.()
    const results = await Promise.all([p1, p2])
    const accepted = results.filter((r) => r.acceptance === 'accepted')
    const rejected = results.filter((r) => r.acceptance === 'rejected')
    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.rejectReason).toBe('capacity_exceeded')
    expect(rejected[0]?.events).toEqual([])
    // Fill used resume (load), races use open — only one race open may run.
    expect(raceEntered).toBe(1)
    expect(openCalls).toBe(1)
  })

  it('same workspace+turn serializes even when session/pending keys differ', async () => {
    const order = []
    let releaseOpen
    const openGate = new Promise((resolve) => {
      releaseOpen = resolve
    })
    const open = vi.fn(async () => {
      order.push('open-enter')
      await openGate
      order.push('open-exit')
      return sessionSnapshot({ id: 'session-promoted' })
    })
    // open_session authority-reloads after open; resume also loads. Labels share 'load'.
    const load = vi.fn(async () => {
      order.push('load')
      return sessionSnapshot({ id: 'session-promoted' })
    })
    const coordinator = createTeachingTurnCoordinator(createPorts({ open, load }))

    const pOpen = coordinator.execute({
      type: 'open_session',
      turnId: 'turn-stable',
      eventId: 'ev-open-pending',
      operationId: 'op-open-pending',
      workspaceId: 'workspace-1',
      open: {
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    await new Promise((r) => setTimeout(r, 15))
    const pResume = coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-stable',
      eventId: 'ev-resume-real',
      operationId: 'op-resume-real',
      workspaceId: 'workspace-1',
      sessionId: 'session-promoted'
    })
    await new Promise((r) => setTimeout(r, 15))
    expect(order).toEqual(['open-enter'])
    releaseOpen()
    await Promise.all([pOpen, pResume])
    // open port + open authority load complete before resume's load (turn serialization).
    expect(order).toEqual(['open-enter', 'open-exit', 'load', 'load'])
  })

  it('rejects payload workspace/session mismatch and wrong port session identity fail-closed', async () => {
    const openWrong = vi.fn(async () => sessionSnapshot({ id: 'session-other', workspaceId: 'workspace-OTHER' }))
    const coordinatorMismatch = createTeachingTurnCoordinator(createPorts({ open: openWrong }))

    const payloadWs = await coordinatorMismatch.execute({
      type: 'open_session',
      turnId: 'turn-id-bind',
      eventId: 'ev-id-bind',
      operationId: 'op-id-bind',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-OTHER',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(payloadWs.acceptance).toBe('rejected')
    expect(payloadWs.rejectReason).toBe('payload_mismatch')
    expect(payloadWs.events).toEqual([])
    expect(openWrong).not.toHaveBeenCalled()

    const open = vi.fn(async () => sessionSnapshot({ id: 'session-WRONG', workspaceId: 'workspace-1' }))
    const coordinatorPort = createTeachingTurnCoordinator(createPorts({ open }))
    const portMismatch = await coordinatorPort.execute({
      type: 'open_session',
      turnId: 'turn-port-id',
      eventId: 'ev-port-id',
      operationId: 'op-port-id',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(portMismatch.acceptance).toBe('rejected')
    expect(portMismatch.rejectReason).toBe('payload_mismatch')
    expect(open).toHaveBeenCalledTimes(1)

    const evidenceMismatch = await createTeachingTurnCoordinator(createPorts()).execute({
      type: 'record_evidence',
      turnId: 'turn-ev-id',
      eventId: 'ev-ev-id',
      operationId: 'op-ev-id',
      workspaceId: 'workspace-1',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-x',
        kind: 'quiz_answered',
        workspaceId: 'workspace-OTHER',
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
    expect(evidenceMismatch.acceptance).toBe('rejected')
    expect(evidenceMismatch.rejectReason).toBe('payload_mismatch')
  })

  it('after closed bus reclaim, replayAfter and subscribe still expose sticky terminal', async () => {
    const coordinator = createTeachingTurnCoordinator({
      ...createPorts(),
      maxOperations: 64,
      maxEventIds: 64,
      maxBuses: 2
    })

    const canceled = await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-archive-0',
      eventId: 'ev-archive-0',
      operationId: 'op-archive-0',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    expect(canceled.terminal?.payload).toMatchObject({ outcome: 'canceled' })

    await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-archive-1',
      eventId: 'ev-archive-1',
      operationId: 'op-archive-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    const opened = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-archive-new',
      eventId: 'ev-archive-new',
      operationId: 'op-archive-new',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(opened.acceptance).toBe('accepted')

    const replay = coordinator.replayAfter({ workspaceId: 'workspace-1', turnId: 'turn-archive-0' }, 0)
    expect(replay).not.toBeNull()
    expect(replay?.available).toBe(true)
    expect(replay?.terminal?.payload).toMatchObject({ outcome: 'canceled' })
    expect(replay?.events.some((e) => e.payload.type === 'turn_terminal')).toBe(true)

    const seen = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-archive-0' }, (event) => {
      seen.push(event.payload.type)
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(seen).toContain('turn_terminal')
    unsub()

    const again = await coordinator.execute({
      type: 'resume_session',
      turnId: 'turn-archive-0',
      eventId: 'ev-archive-again',
      operationId: 'op-archive-again',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(again.acceptance).toBe('rejected')
    expect(again.rejectReason).toBe('already_terminal')
    expect(again.terminal?.payload).toMatchObject({ outcome: 'canceled' })
  })

  it('round5: concurrent same-op while reserved is operation_in_flight; after commit is duplicate', async () => {
    let releaseOpen: (() => void) | undefined
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    const open = vi.fn(async (input: { sessionId?: string; workspaceId?: string }) => {
      await openGate
      return sessionSnapshot({
        id: input.sessionId ?? 'session-1',
        workspaceId: input.workspaceId ?? 'workspace-1'
      })
    })
    const coordinator = createTeachingTurnCoordinator(createPorts({ open }))
    const command = {
      type: 'open_session' as const,
      turnId: 'turn-inflight',
      eventId: 'ev-inflight',
      operationId: 'op-inflight',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-inflight',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    }

    const firstPromise = coordinator.execute(command)
    await new Promise((r) => setTimeout(r, 20))
    const inFlight = await coordinator.execute(command)
    expect(inFlight.acceptance).toBe('rejected')
    expect(inFlight.rejectReason).toBe('operation_in_flight')
    expect(inFlight.events).toEqual([])
    // Second concurrent must not start another port call while first is reserved.
    expect(open).toHaveBeenCalledTimes(1)

    releaseOpen?.()
    const first = await firstPromise
    expect(first.acceptance).toBe('accepted')
    expect(first.events.some((e) => e.payload.type === 'command_accepted')).toBe(true)

    const after = await coordinator.execute(command)
    expect(after.acceptance).toBe('duplicate')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('round5: bound turn session fail-closed for a different session without mutator', async () => {
    const load = vi.fn(async (sessionId: string) =>
      sessionSnapshot({ id: sessionId, workspaceId: 'workspace-1' })
    )
    const record = vi.fn(async () => {
      throw new Error('record must not run for foreign session on bound turn')
    })
    const coordinator = createTeachingTurnCoordinator(createPorts({ load, record }))

    const opened = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-bound-session',
      eventId: 'ev-bound-open',
      operationId: 'op-bound-open',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-bound-a',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(opened.acceptance).toBe('accepted')

    const foreign = await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-bound-session',
      eventId: 'ev-bound-foreign',
      operationId: 'op-bound-foreign',
      workspaceId: 'workspace-1',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-foreign',
        kind: 'quiz_answered',
        workspaceId: 'workspace-1',
        courseId: 'course-1',
        sessionId: 'session-bound-b',
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
    expect(foreign.acceptance).toBe('rejected')
    expect(foreign.rejectReason).toBe('payload_mismatch')
    expect(foreign.events).toEqual([])
    expect(record).not.toHaveBeenCalled()
    // Bound-session check is before preflight load for the foreign session.
    expect(load.mock.calls.every((call) => call[0] !== 'session-bound-b')).toBe(true)
  })

  it('round5: recover/commit/record load+workspace validate before mutator; zero accepted on mismatch', async () => {
    const load = vi.fn(async (sessionId: string) =>
      sessionSnapshot({ id: sessionId, workspaceId: 'workspace-OTHER' })
    )
    const record = vi.fn(async () => {
      throw new Error('recorder mutator must not run')
    })
    const commit = vi.fn(async () => {
      throw new Error('committer mutator must not run')
    })
    const reconcile = vi.fn(async () => {
      throw new Error('reconcile mutator must not run')
    })
    const coordinator = createTeachingTurnCoordinator(
      createPorts({ load, record, commit, reconcile })
    )

    const evidence = await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-preflight-ev',
      eventId: 'ev-preflight-ev',
      operationId: 'op-preflight-ev',
      workspaceId: 'workspace-1',
      evidence: {
        schemaVersion: 1,
        eventId: 'evidence-preflight',
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
    expect(evidence.acceptance).toBe('rejected')
    expect(evidence.rejectReason).toBe('payload_mismatch')
    expect(evidence.events.some((e) => e.payload.type === 'command_accepted')).toBe(false)
    expect(load).toHaveBeenCalledWith('session-1')
    expect(record).not.toHaveBeenCalled()

    const committed = await coordinator.execute({
      type: 'commit_outcome',
      turnId: 'turn-preflight-commit',
      eventId: 'ev-preflight-commit',
      operationId: 'op-preflight-commit',
      workspaceId: 'workspace-1',
      request: { sessionId: 'session-1', operationId: 'op-preflight-commit' }
    })
    expect(committed.acceptance).toBe('rejected')
    expect(committed.rejectReason).toBe('payload_mismatch')
    expect(committed.events.some((e) => e.payload.type === 'command_accepted')).toBe(false)
    expect(commit).not.toHaveBeenCalled()

    const recovered = await coordinator.execute({
      type: 'recover_session',
      turnId: 'turn-preflight-recover',
      eventId: 'ev-preflight-recover',
      operationId: 'op-preflight-recover',
      workspaceId: 'workspace-1',
      sessionId: 'session-1'
    })
    expect(recovered.acceptance).toBe('rejected')
    expect(recovered.rejectReason).toBe('payload_mismatch')
    expect(recovered.events.some((e) => e.payload.type === 'command_accepted')).toBe(false)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('round5: commit request.operationId must bind command.operationId; port mismatch leaves no accepted', async () => {
    const commit = vi.fn(async () => ({
      status: 'committed' as const,
      outcome: { kind: 'needs_practice' as const },
      recordSaved: false,
      catalogRecordPresent: false
    }))
    const coordinator = createTeachingTurnCoordinator(createPorts({ commit }))

    const mismatched = await coordinator.execute({
      type: 'commit_outcome',
      turnId: 'turn-op-bind',
      eventId: 'ev-op-bind',
      operationId: 'op-command',
      workspaceId: 'workspace-1',
      request: { sessionId: 'session-1', operationId: 'op-OTHER' }
    })
    expect(mismatched.acceptance).toBe('rejected')
    expect(mismatched.rejectReason).toBe('payload_mismatch')
    expect(mismatched.events).toEqual([])
    expect(commit).not.toHaveBeenCalled()

    const openWrong = vi.fn(async () =>
      sessionSnapshot({ id: 'session-WRONG', workspaceId: 'workspace-1' })
    )
    const busSeen: string[] = []
    const coordinatorPort = createTeachingTurnCoordinator(createPorts({ open: openWrong }))
    const unsub = coordinatorPort.subscribe(
      { workspaceId: 'workspace-1', turnId: 'turn-no-fake-accepted' },
      (event) => {
        busSeen.push(event.payload.type)
      }
    )
    const portMismatch = await coordinatorPort.execute({
      type: 'open_session',
      turnId: 'turn-no-fake-accepted',
      eventId: 'ev-no-fake-accepted',
      operationId: 'op-no-fake-accepted',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    unsub()
    expect(portMismatch.acceptance).toBe('rejected')
    expect(portMismatch.rejectReason).toBe('payload_mismatch')
    expect(portMismatch.events.some((e) => e.payload.type === 'command_accepted')).toBe(false)
    expect(busSeen).not.toContain('command_accepted')
    expect(openWrong).toHaveBeenCalledTimes(1)

    // Stable reject memory: replay same command does not re-invoke the port.
    const again = await coordinatorPort.execute({
      type: 'open_session',
      turnId: 'turn-no-fake-accepted',
      eventId: 'ev-no-fake-accepted',
      operationId: 'op-no-fake-accepted',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(again.acceptance).toBe('duplicate')
    expect(again.rejectReason).toBe('payload_mismatch')
    expect(openWrong).toHaveBeenCalledTimes(1)
  })

  it('round5: execute(unknown) parses first; project_snapshot requires explicit real sessionId', async () => {
    const coordinator = createTeachingTurnCoordinator(createPorts())

    const garbage = await coordinator.execute('not-a-command')
    expect(garbage.acceptance).toBe('rejected')
    expect(garbage.rejectReason).toBe('payload_mismatch')
    expect(garbage.events).toEqual([])

    const unknownType = await coordinator.execute({
      type: 'invented_command',
      turnId: 'turn-unknown',
      eventId: 'ev-unknown',
      operationId: 'op-unknown',
      workspaceId: 'workspace-1'
    })
    expect(unknownType.acceptance).toBe('rejected')
    expect(unknownType.rejectReason).toBe('payload_mismatch')

    const noSession = await coordinator.execute({
      type: 'project_snapshot',
      turnId: 'turn-snap-nosession',
      eventId: 'ev-snap-nosession',
      operationId: 'op-snap-nosession',
      workspaceId: 'workspace-1',
      factInput: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] }
        // intentionally omit sessionId — must not fall back to course.id
      }
    })
    expect(noSession.acceptance).toBe('rejected')
    expect(noSession.rejectReason).toBe('payload_mismatch')
    expect(noSession.events).toEqual([])

    const withSession = await coordinator.execute({
      type: 'project_snapshot',
      turnId: 'turn-snap-session',
      eventId: 'ev-snap-session',
      operationId: 'op-snap-session',
      workspaceId: 'workspace-1',
      factInput: {
        mission: { id: 'mission-1', nextGoal: 'available' },
        course: { id: 'course-1' },
        resources: { readiness: 'ready', availableCount: 1, provenanceIds: ['r1'] },
        sessionId: 'session-1'
      }
    })
    expect(withSession.acceptance).toBe('accepted')
    expect(withSession.sessionId).toBe('session-1')
    expect(withSession.events.some((e) => e.payload.type === 'command_accepted')).toBe(true)
  })

  it('round5: closed archive replay/gap is isomorphic with live bus retained-terminal semantics', async () => {
    const coordinator = createTeachingTurnCoordinator({
      ...createPorts(),
      maxOperations: 32,
      maxEventIds: 32,
      maxBuses: 2
    })

    const canceled = await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-gap-iso',
      eventId: 'ev-gap-iso',
      operationId: 'op-gap-iso',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    expect(canceled.terminal?.payload).toMatchObject({ type: 'turn_terminal', outcome: 'canceled' })
    const liveReplay = coordinator.replayAfter({ workspaceId: 'workspace-1', turnId: 'turn-gap-iso' }, 0)
    expect(liveReplay).not.toBeNull()
    expect(liveReplay?.available).toBe(true)
    expect(liveReplay?.events.some((e) => e.payload.type === 'turn_terminal')).toBe(true)

    // Live bus still has prefix events => afterSequence=0 has no gap from sequence 1.
    // Force archive by filling bus capacity with another closed turn + a new active turn.
    await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-gap-fill',
      eventId: 'ev-gap-fill',
      operationId: 'op-gap-fill',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    const opened = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-gap-active',
      eventId: 'ev-gap-active',
      operationId: 'op-gap-active',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    expect(opened.acceptance).toBe('accepted')

    const archivedReplay = coordinator.replayAfter({ workspaceId: 'workspace-1', turnId: 'turn-gap-iso' }, 0)
    expect(archivedReplay).not.toBeNull()
    expect(archivedReplay?.available).toBe(true)
    expect(archivedReplay?.terminal?.payload).toMatchObject({ type: 'turn_terminal', outcome: 'canceled' })
    expect(archivedReplay?.events).toHaveLength(1)
    expect(archivedReplay?.events[0]?.payload.type).toBe('turn_terminal')

    const terminalSeq =
      typeof archivedReplay?.terminal?.sequence === 'number' ? archivedReplay!.terminal!.sequence! : 0
    // Isomorphic formula with TeachingTurnEventBus.replayAfter:
    // hasGap <=> requestedAfterSequence + 1 < retainedFromSequence
    // Archive retains only sticky terminal => retainedFromSequence = terminalSeq.
    expect(archivedReplay?.hasGap).toBe(0 + 1 < terminalSeq)
    expect(archivedReplay?.fromSequence).toBe(Math.max(1, terminalSeq))
    expect(archivedReplay?.nextSequence).toBe(terminalSeq + 1)
    expect(archivedReplay?.requestedAfterSequence).toBe(0)

    // After the terminal sequence, no events and no gap.
    const afterTerminal = coordinator.replayAfter(
      { workspaceId: 'workspace-1', turnId: 'turn-gap-iso' },
      terminalSeq
    )
    expect(afterTerminal?.hasGap).toBe(false)
    expect(afterTerminal?.events).toHaveLength(0)
    expect(afterTerminal?.terminal?.payload).toMatchObject({ outcome: 'canceled' })
  })


  it('round6: H3 mocked-port commit spoof never emits accepted/durable on bus subscribe/replay', async () => {
    const commit = vi.fn(async (): Promise<OutcomeCommitResult> => ({
      status: 'committed',
      outcome: { kind: 'established' },
      recordSaved: true,
      catalogRecordPresent: true
    } as OutcomeCommitResult))
    // Authority contradicts self-report (no marker / outcome).
    const reconcile = vi.fn(async (sessionId: string): Promise<OutcomeReconciliation> => ({
      sessionId,
      state: 'pending',
      marker: null,
      record: null,
      catalogRecordPresent: false,
      diagnostics: []
    }))
    const ports = createPorts({ commit, reconcile })
    const coordinator = createTeachingTurnCoordinator(ports)
    const busSeen: string[] = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-h3-spoof' }, (event) => {
      busSeen.push(event.payload.type)
    })

    const result = await coordinator.execute({
      type: 'commit_outcome',
      turnId: 'turn-h3-spoof',
      eventId: 'ev-h3-spoof',
      operationId: 'op-h3-spoof',
      workspaceId: 'workspace-1',
      request: { sessionId: 'session-1', operationId: 'op-h3-spoof' }
    })
    unsub()

    expect(result.acceptance).toBe('rejected')
    expect(result.rejectReason).toBe('payload_mismatch')
    expect(result.events.some((e) => e.payload.type === 'command_accepted')).toBe(false)
    expect(result.events.some((e) => e.payload.type === 'outcome_committed')).toBe(false)
    // Bus itself must not carry false accepted/durable events (not only result.events filter).
    expect(busSeen).not.toContain('command_accepted')
    expect(busSeen).not.toContain('outcome_committed')
    const replay = coordinator.replayAfter({ workspaceId: 'workspace-1', turnId: 'turn-h3-spoof' }, 0)
    expect(replay?.events.some((e) => e.payload.type === 'command_accepted')).toBeFalsy()
    expect(replay?.events.some((e) => e.payload.type === 'outcome_committed')).toBeFalsy()
  })

  it('round6: H3 open without client sessionId binds only ledger-proven workspace session', async () => {
    const open = vi.fn(async () =>
      sessionSnapshot({ id: 'foreign-session', workspaceId: 'workspace-1', courseRef: {
        courseId: 'course-OTHER',
        courseName: 'Other',
        relativePath: 'courses/other'
      } })
    )
    const load = vi.fn(async (sessionId: string) => {
      if (sessionId === 'foreign-session') {
        return sessionSnapshot({
          id: 'foreign-session',
          workspaceId: 'workspace-1',
          courseRef: { courseId: 'course-OTHER', courseName: 'Other', relativePath: 'courses/other' }
        })
      }
      return null
    })
    const coordinator = createTeachingTurnCoordinator(createPorts({ open, load }))
    const busSeen: string[] = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-h3-open' }, (e) => {
      busSeen.push(e.payload.type)
    })
    const result = await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-h3-open',
      eventId: 'ev-h3-open',
      operationId: 'op-h3-open',
      workspaceId: 'workspace-1',
      open: {
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })
    unsub()
    expect(result.acceptance).toBe('rejected')
    expect(result.rejectReason).toBe('payload_mismatch')
    expect(busSeen).not.toContain('command_accepted')
    expect(busSeen).not.toContain('session_opened')
  })

  it('round6: H3 malformed record receipt never emits accepted/durable on bus', async () => {
    const record = vi.fn(async () => ({
      eventId: 'spoofed-event',
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
    const coordinator = createTeachingTurnCoordinator(createPorts({ record }))
    const busSeen: string[] = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-h3-rec' }, (e) => {
      busSeen.push(e.payload.type)
    })
    const result = await coordinator.execute({
      type: 'record_evidence',
      turnId: 'turn-h3-rec',
      eventId: 'ev-h3-rec',
      operationId: 'op-h3-rec',
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
    unsub()
    expect(result.acceptance).toBe('rejected')
    expect(busSeen).not.toContain('command_accepted')
    expect(busSeen).not.toContain('evidence_recorded')
  })

  it('round6: cancel not_found is payload_mismatch without accepted terminal', async () => {
    const load = vi.fn(async () => null)
    const coordinator = createTeachingTurnCoordinator(createPorts({ load }))
    const busSeen: string[] = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-cancel-nf' }, (e) => {
      busSeen.push(e.payload.type)
    })
    const result = await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-cancel-nf',
      eventId: 'ev-cancel-nf',
      operationId: 'op-cancel-nf',
      workspaceId: 'workspace-1',
      sessionId: 'session-missing',
      reasonCode: 'user_cancel'
    })
    unsub()
    expect(result.acceptance).toBe('rejected')
    expect(result.rejectReason).toBe('payload_mismatch')
    expect(busSeen).not.toContain('command_accepted')
    expect(busSeen).not.toContain('turn_terminal')
  })

  it('round6: closed live late subscribe delivers terminal isomorphic with archive', async () => {
    const coordinator = createTeachingTurnCoordinator({
      ...createPorts(),
      maxOperations: 32,
      maxEventIds: 32,
      maxBuses: 2
    })
    await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-late-live',
      eventId: 'ev-late-live',
      operationId: 'op-late-live',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    // Fill capacity to force reclaim of closed live bus into archive path coverage.
    await coordinator.execute({
      type: 'cancel_turn',
      turnId: 'turn-late-fill',
      eventId: 'ev-late-fill',
      operationId: 'op-late-fill',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      reasonCode: 'user_cancel'
    })
    await coordinator.execute({
      type: 'open_session',
      turnId: 'turn-late-active',
      eventId: 'ev-late-active',
      operationId: 'op-late-active',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    })

    const lateSeen: string[] = []
    const unsub = coordinator.subscribe({ workspaceId: 'workspace-1', turnId: 'turn-late-live' }, (e) => {
      lateSeen.push(e.payload.type)
    })
    await new Promise((r) => setTimeout(r, 20))
    unsub()
    expect(lateSeen).toContain('turn_terminal')
  })

  it('round6: operation_in_flight is observable and settles to duplicate after commit', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const open = vi.fn(async (input: { sessionId?: string; workspaceId?: string }) => {
      await gate
      return sessionSnapshot({
        id: input.sessionId ?? 'session-1',
        workspaceId: input.workspaceId ?? 'workspace-1'
      })
    })
    const load = vi.fn(async (sessionId: string) =>
      sessionSnapshot({ id: sessionId, workspaceId: 'workspace-1' })
    )
    const coordinator = createTeachingTurnCoordinator(createPorts({ open, load }))
    const command = {
      type: 'open_session' as const,
      turnId: 'turn-inflight',
      eventId: 'ev-inflight',
      operationId: 'op-inflight',
      workspaceId: 'workspace-1',
      open: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' }
      }
    }
    const firstPromise = coordinator.execute(command)
    await new Promise((r) => setTimeout(r, 15))
    const inFlight = await coordinator.execute(command)
    expect(inFlight.acceptance).toBe('rejected')
    expect(inFlight.rejectReason).toBe('operation_in_flight')
    release?.()
    const first = await firstPromise
    expect(first.acceptance).toBe('accepted')
    const after = await coordinator.execute(command)
    expect(after.acceptance).toBe('duplicate')
  })
})
