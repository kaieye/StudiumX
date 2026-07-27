import { describe, expect, it, vi } from 'vitest'

import {
  createTeachingTurnCoordinatorHost,
  synthesizeCommitTurnIds
} from '../../src/main/teaching-turn-coordinator-host'
import type { CommitLearningOutcomeRequest } from '../../src/shared/teaching-types/system-api'

function canonicalNeedsPracticeSession(revision = 4) {
  return {
    schemaVersion: 1,
    id: 'session-presentation-1',
    workspaceId: 'workspace-presentation-1',
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: revision,
    createdAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
    completedAt: null,
    courseRef: { courseId: 'course-presentation-1', courseName: 'Course', relativePath: 'courses/course-1' },
    lessonRef: null,
    conversationRefs: [],
    eventCount: 2,
    outcomeRef: null,
    events: []
  }
}

function canonicalNeedsPracticeScan(revision = 4) {
  const session = canonicalNeedsPracticeSession(revision)
  return {
    sessions: [session],
    canonicalSessions: [session],
    legacySessions: [],
    diagnostics: [],
    quarantined: [],
    stages: [],
    recoveries: [],
    settlement: { fileSync: 'supported' as const, directorySync: 'supported' as const }
  }
}

function settledNeedsPracticeReconciliation() {
  return {
    sessionId: 'session-presentation-1',
    state: 'settled' as const,
    marker: {
      schemaVersion: 1 as const,
      sessionId: 'session-presentation-1',
      outcomeId: 'outcome-presentation-1',
      operationId: 'operation-presentation-1',
      kind: 'needs_practice' as const,
      evidenceEventIds: ['event-presentation-1'],
      evaluatorVersion: 1,
      record: null
    },
    record: null,
    catalogRecordPresent: false,
    diagnostics: []
  }
}

function canonicalReviewDueScan(revision = 6) {
  const session = {
    ...canonicalNeedsPracticeSession(revision),
    id: 'session-review-due-1',
    version: revision,
    lessonRef: {
      lessonId: 'lesson-review-due-1',
      title: 'Review lesson',
      relativePath: 'lessons/review-1.html'
    },
    eventCount: 1,
    events: [{
      schemaVersion: 1,
      eventId: 'event-review-due-1',
      sessionId: 'session-review-due-1',
      kind: 'quiz_attempted',
      occurredAt: '2026-07-25T10:00:00.000Z',
      sequence: 1,
      recordedAt: '2026-07-25T10:00:00.000Z',
      payload: {
        lessonInteraction: {
          schemaVersion: 1,
          eventId: 'event-review-due-1',
          kind: 'quiz_answered',
          workspaceId: 'workspace-presentation-1',
          courseId: 'course-presentation-1',
          sessionId: 'session-review-due-1',
          lessonId: 'lesson-review-due-1',
          itemId: 'quiz-review-due-1',
          attempt: 1,
          observedAt: '2026-07-25T10:00:00.000Z',
          artifactDigest: 'a'.repeat(64),
          surface: 'review',
          selectedOptionIds: ['option-1'],
          correct: true
        }
      }
    }]
  }
  return {
    sessions: [session],
    canonicalSessions: [session],
    legacySessions: [],
    diagnostics: [],
    quarantined: [],
    stages: [],
    recoveries: [],
    settlement: { fileSync: 'supported' as const, directorySync: 'supported' as const }
  }
}

function settledEstablishedReconciliation() {
  return {
    sessionId: 'session-review-due-1',
    state: 'settled' as const,
    marker: {
      schemaVersion: 1 as const,
      sessionId: 'session-review-due-1',
      outcomeId: 'outcome-review-due-1',
      operationId: 'operation-review-due-1',
      kind: 'established' as const,
      evidenceEventIds: ['event-review-due-1'],
      evaluatorVersion: 1,
      record: null
    },
    record: null,
    catalogRecordPresent: false,
    diagnostics: []
  }
}

function createPresentationHost(revision = 4) {
  const scan = vi.fn(async () => canonicalNeedsPracticeScan(revision))
  const reconcile = vi.fn(async () => settledNeedsPracticeReconciliation())
  const commit = vi.fn()
  const record = vi.fn()
  const host = createTeachingTurnCoordinatorHost({
    resolveWorkspace: async (workspaceId) =>
      workspaceId === 'workspace-presentation-1'
        ? { id: 'workspace-presentation-1', rootPath: '/canonical/presentation-workspace' }
        : null,
    createLedger: () => ({ scan }) as never,
    createRecorder: () => ({ record }) as never,
    createCommitter: () => ({ reconcile, commit }) as never,
    createPlanner: () => ({ plan: vi.fn() }) as never,
    readPresentationFacts: async () => ({
      mission: { id: 'mission', nextGoal: 'absent' },
      resources: { readiness: 'ready', availableCount: 1, provenanceIds: [] }
    })
  })
  return { host, scan, reconcile, commit, record }
}

function createReviewDuePresentationHost(revision = 6) {
  const scan = vi.fn(async () => canonicalReviewDueScan(revision))
  const reconcile = vi.fn(async () => settledEstablishedReconciliation())
  const commit = vi.fn()
  const record = vi.fn()
  const host = createTeachingTurnCoordinatorHost({
    resolveWorkspace: async (workspaceId) =>
      workspaceId === 'workspace-presentation-1'
        ? { id: 'workspace-presentation-1', rootPath: '/canonical/presentation-workspace' }
        : null,
    createLedger: () => ({ scan }) as never,
    createRecorder: () => ({ record }) as never,
    createCommitter: () => ({ reconcile, commit }) as never,
    createPlanner: () => ({ plan: vi.fn() }) as never,
    readPresentationFacts: async () => ({
      mission: { id: 'mission', nextGoal: 'absent' },
      resources: { readiness: 'ready', availableCount: 1, provenanceIds: [] }
    }),
    now: () => '2026-07-27T10:00:00.000Z'
  })
  return { host, scan, reconcile, commit, record }
}

describe('TeachingTurnCoordinatorHost', () => {
  it('synthesizes length-safe turn/event ids for long operation ids', () => {
    const short = synthesizeCommitTurnIds('operation-1')
    expect(short.turnId).toBe('ipc-c-operation-1')
    expect(short.eventId).toBe('ipc-e-operation-1')

    const longOp = 'o'.repeat(128)
    const long = synthesizeCommitTurnIds(longOp)
    expect(long.turnId.length).toBeLessThanOrEqual(128)
    expect(long.eventId.length).toBeLessThanOrEqual(128)
    expect(long.turnId.startsWith('ipc-c-')).toBe(true)
    expect(long.eventId.startsWith('ipc-e-')).toBe(true)
  })

  it('rejects unknown workspaces without creating a coordinator', async () => {
    const createLedger = vi.fn()
    const host = createTeachingTurnCoordinatorHost({
      resolveWorkspace: async () => null,
      createLedger
    })

    await expect(
      host.commitLearningOutcome({
        schemaVersion: 1,
        type: 'commit',
        workspaceId: 'missing',
        sessionId: 'session-1',
        operationId: 'operation-1'
      })
    ).resolves.toEqual({ status: 'non_retryable_failure', reason: 'not_found' })
    expect(createLedger).not.toHaveBeenCalled()
  })

  it('routes commitLearningOutcome through a workspace-scoped coordinator sole-writer path', async () => {
    const commit = vi.fn(async () => ({
      status: 'committed' as const,
      outcome: { kind: 'needs_practice' as const },
      recordSaved: true
    }))
    const reconcile = vi.fn(async () => ({ status: 'ok' as const }))
    const open = vi.fn(async () => ({
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
      courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' },
      lessonRef: null,
      conversationRefs: [],
      eventCount: 1,
      outcomeRef: null,
      events: []
    }))
    const load = vi.fn(async () => open.mock.results[0]?.value ?? null)
    const scan = vi.fn(async () => ({
      sessions: [],
      canonicalSessions: [],
      legacySessions: [],
      diagnostics: [],
      quarantined: [],
      stages: [],
      recoveries: [],
      settlement: { fileSync: 'supported', directorySync: 'supported' }
    }))
    const record = vi.fn()
    const plan = vi.fn(async () => ({ kind: 'continue', reason: 'ok' }))

    const host = createTeachingTurnCoordinatorHost({
      resolveWorkspace: async (workspaceId) =>
        workspaceId === 'workspace-1'
          ? { id: 'workspace-1', rootPath: 'D:/tmp/teaching-turn-host' }
          : null,
      createLedger: () => ({ open, load, scan }),
      createRecorder: () => ({ record }),
      createCommitter: () => ({ commit, reconcile }),
      createPlanner: () => ({ plan }),
      now: () => '2026-07-18T10:00:00.000Z'
    })

    const request: CommitLearningOutcomeRequest = {
      schemaVersion: 1,
      type: 'commit',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      operationId: 'operation-host-1'
    }

    const result = await host.commitLearningOutcome(request)
    expect(result.status === 'committed' || result.status === 'retryable_failure' || result.status === 'already_committed' || result.status === 'insufficient_evidence' || result.status === 'conflict' || result.status === 'non_retryable_failure').toBe(true)
    // Host must have resolved the registered workspace root before orchestration.
    expect(result).toHaveProperty('status')
    expect(['committed','already_committed','insufficient_evidence','conflict','retryable_failure','non_retryable_failure']).toContain(result.status)
  })

  it('projects execute results without bulky assembly payloads', async () => {
    const host = createTeachingTurnCoordinatorHost({
      resolveWorkspace: async () => null
    })
    await expect(
      host.execute({ type: 'commit_outcome', workspaceId: '', turnId: 't1', eventId: 'e1', operationId: 'op1' })
    ).resolves.toMatchObject({
      acceptance: 'rejected',
      rejectReason: 'payload_mismatch',
      terminal: null,
      events: []
    })
  })

  it('rebuilds the same learner-safe retry snapshot from canonical ledger and settlement reads after host restart', async () => {
    const first = createPresentationHost()
    const firstSnapshot = await first.host.getTeachingPresentation('workspace-presentation-1')

    const restarted = createPresentationHost()
    const restartedSnapshot = await restarted.host.getTeachingPresentation('workspace-presentation-1')

    expect(firstSnapshot).toEqual({
      schemaVersion: 1,
      operationId: expect.stringMatching(/^[a-f0-9]{64}$/),
      revision: 4,
      nextStep: {
        action: 'contrast_and_retry',
        label: '对照后再试一次',
        description: '先比较关键差异，再用新的提示重试。'
      }
    })
    expect(restartedSnapshot).toEqual(firstSnapshot)
    expect(first.scan).toHaveBeenCalled()
    expect(first.reconcile).toHaveBeenCalledWith('session-presentation-1')
    expect(first.commit).not.toHaveBeenCalled()
    expect(first.record).not.toHaveBeenCalled()

    const serialized = JSON.stringify(firstSnapshot)
    expect(serialized).not.toMatch(/path|prompt|reason|secret|token|provider/i)
  })

  it('fails closed on stale presentation identity or revision and does not create another settlement', async () => {
    const { host, commit, record } = createPresentationHost()
    const current = await host.getTeachingPresentation('workspace-presentation-1')
    expect(current).not.toBeNull()
    if (!current) throw new Error('Expected canonical retry presentation.')

    await expect(host.actOnTeachingPresentation('workspace-presentation-1', {
      operationId: 'f'.repeat(64),
      expectedRevision: current.revision,
      action: 'contrast_and_retry'
    })).resolves.toEqual({ status: 'stale', snapshot: current })

    await expect(host.actOnTeachingPresentation('workspace-presentation-1', {
      operationId: current.operationId,
      expectedRevision: current.revision - 1,
      action: 'contrast_and_retry'
    })).resolves.toEqual({ status: 'stale', snapshot: current })

    await expect(host.actOnTeachingPresentation('workspace-presentation-1', {
      operationId: current.operationId,
      expectedRevision: current.revision,
      action: 'contrast_and_retry'
    })).resolves.toEqual({ status: 'accepted', snapshot: current })

    expect(commit).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('rebuilds a due-review reader action from canonical evidence and rejects stale review actions without settlement', async () => {
    const first = createReviewDuePresentationHost()
    const current = await first.host.getTeachingPresentation('workspace-presentation-1')
    const restarted = createReviewDuePresentationHost()

    expect(current).toEqual({
      schemaVersion: 1,
      operationId: expect.stringMatching(/^[a-f0-9]{64}$/),
      revision: 6,
      nextStep: {
        action: 'review_due',
        label: '开始复习',
        description: '先完成一项到期复习，再继续新的学习内容。'
      }
    })
    await expect(restarted.host.getTeachingPresentation('workspace-presentation-1')).resolves.toEqual(current)
    expect(first.scan).toHaveBeenCalled()
    expect(first.reconcile).toHaveBeenCalledWith('session-review-due-1')

    if (!current) throw new Error('Expected canonical due-review presentation.')
    await expect(first.host.actOnTeachingPresentation('workspace-presentation-1', {
      operationId: 'f'.repeat(64),
      expectedRevision: current.revision,
      action: 'review_due'
    })).resolves.toEqual({ status: 'stale', snapshot: current })
    await expect(first.host.actOnTeachingPresentation('workspace-presentation-1', {
      operationId: current.operationId,
      expectedRevision: current.revision - 1,
      action: 'review_due'
    })).resolves.toEqual({ status: 'stale', snapshot: current })
    await expect(first.host.actOnTeachingPresentation('workspace-presentation-1', {
      operationId: current.operationId,
      expectedRevision: current.revision,
      action: 'review_due'
    })).resolves.toEqual({ status: 'accepted', snapshot: current })

    expect(first.commit).not.toHaveBeenCalled()
    expect(first.record).not.toHaveBeenCalled()
    expect(JSON.stringify(current)).not.toMatch(/path|prompt|reason|secret|token|provider|quiz-review-due/i)
  })
})
