import { describe, expect, it, vi } from 'vitest'

import type { LearningOutcomeCommitResult } from '../../src/shared/teaching-types/learning-outcome'
import type { LearningOutcomeCommitUiStatus } from '../../src/renderer/src/teaching/learning-outcome-commit-client'
import {
  buildCommitLearningOutcomeRequest,
  buildLearningOutcomeCommitOperationId,
  createLearningOutcomeCommitClient,
  isCommitEligiblePreviewIntentKind,
  isPreviewCommitScopeCurrent,
  learnerSafeCommitStatusLabel,
  learnerSafeCommitStatusSeverity,
  projectLearnerSafeCommitStatus,
  recordPreviewLessonInteractionAndMaybeCommit
} from '../../src/renderer/src/teaching/learning-outcome-commit-client'

describe('learning-outcome-commit-client', () => {
  it('commits only after eligible evidence kinds, never lesson open alone', () => {
    expect(isCommitEligiblePreviewIntentKind('lesson_opened')).toBe(false)
    expect(isCommitEligiblePreviewIntentKind('lesson_completed')).toBe(false)
    expect(isCommitEligiblePreviewIntentKind('quiz_answered')).toBe(true)
    expect(isCommitEligiblePreviewIntentKind('flashcard_rated')).toBe(true)
  })

  it('reuses a stable operationId for the same evidence sequence and mints a new one for corrected evidence', () => {
    expect(buildLearningOutcomeCommitOperationId('session-a', 2)).toBe('outcome-seq-2')
    expect(buildLearningOutcomeCommitOperationId('session-a', 2)).toBe('outcome-seq-2')
    expect(buildLearningOutcomeCommitOperationId('session-a', 3)).toBe('outcome-seq-3')
    expect(buildCommitLearningOutcomeRequest({
      workspaceId: 'workspace-1',
      sessionId: 'session-a',
      operationId: 'outcome-seq-2'
    })).toEqual({
      schemaVersion: 1,
      type: 'commit',
      workspaceId: 'workspace-1',
      sessionId: 'session-a',
      operationId: 'outcome-seq-2'
    })
  })

  it('projects needs_practice without mastered/saved copy and announces recordSaved only once', () => {
    const practice = projectLearnerSafeCommitStatus({
      sessionId: 'session-1',
      operationId: 'outcome-seq-2',
      result: { status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false },
      emittedAnnouncementIds: []
    })
    expect(practice).toMatchObject({
      kind: 'needs_practice',
      recordSaved: false,
      announcement: null
    })
    expect(learnerSafeCommitStatusLabel(practice)).toMatch(/继续练习/)
    expect(learnerSafeCommitStatusLabel(practice)).not.toMatch(/已保存/)
    expect(learnerSafeCommitStatusLabel(practice)).not.toMatch(/^已掌握/)

    const firstSaved = projectLearnerSafeCommitStatus({
      sessionId: 'session-1',
      operationId: 'outcome-seq-3',
      result: {
        status: 'committed',
        outcome: { kind: 'misconception_corrected' },
        recordSaved: true
      },
      emittedAnnouncementIds: []
    })
    expect(firstSaved).toMatchObject({
      kind: 'saved',
      recordSaved: true,
      announcement: { id: 'saved:outcome-seq-3' }
    })

    const secondSaved = projectLearnerSafeCommitStatus({
      sessionId: 'session-1',
      operationId: 'outcome-seq-3',
      result: {
        status: 'committed',
        outcome: { kind: 'misconception_corrected' },
        recordSaved: true
      },
      emittedAnnouncementIds: ['saved:outcome-seq-3']
    })
    expect(secondSaved).toMatchObject({ kind: 'saved', announcement: null })

    const replay = projectLearnerSafeCommitStatus({
      sessionId: 'session-1',
      operationId: 'outcome-seq-3',
      result: {
        status: 'already_committed',
        outcome: { kind: 'misconception_corrected' },
        recordSaved: true
      },
      emittedAnnouncementIds: ['saved:outcome-seq-3']
    })
    expect(replay).toMatchObject({
      kind: 'already_committed',
      recordSaved: true,
      announcement: null
    })
  })

  it('wrong evidence → needs_practice/recordSaved false; corrected evidence → recordSaved true; same op replay has no second announcement', async () => {
    const results: LearningOutcomeCommitResult[] = [
      { status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false },
      { status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true },
      { status: 'already_committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true }
    ]
    const commitLearningOutcome = vi.fn(async () => results.shift()!)
    const statuses: string[] = []
    const client = createLearningOutcomeCommitClient({
      commitLearningOutcome,
      onStatusChange: (status) => statuses.push(status.kind)
    })

    const wrong = await client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      evidenceSequence: 2,
      eventId: 'evidence-wrong',
      intentKind: 'quiz_answered'
    })
    expect(wrong).toMatchObject({
      kind: 'needs_practice',
      recordSaved: false,
      announcement: null,
      operationId: 'outcome-seq-2'
    })
    expect(learnerSafeCommitStatusLabel(wrong)).toMatch(/继续练习/)
    expect(learnerSafeCommitStatusLabel(wrong)).not.toMatch(/^已掌握/)

    const corrected = await client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      evidenceSequence: 3,
      eventId: 'evidence-corrected',
      intentKind: 'quiz_answered'
    })
    expect(corrected).toMatchObject({
      kind: 'saved',
      recordSaved: true,
      outcomeKind: 'misconception_corrected',
      operationId: 'outcome-seq-3',
      announcement: { id: 'saved:outcome-seq-3' }
    })
    expect(client.getEmittedAnnouncementIds()).toEqual(['saved:outcome-seq-3'])

    const replay = await client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      evidenceSequence: 3,
      eventId: 'evidence-corrected',
      intentKind: 'quiz_answered'
    })
    expect(replay).toMatchObject({
      kind: 'already_committed',
      recordSaved: true,
      announcement: null,
      operationId: 'outcome-seq-3'
    })
    expect(client.getEmittedAnnouncementIds()).toEqual(['saved:outcome-seq-3'])
    expect(commitLearningOutcome).toHaveBeenCalledTimes(3)
    expect(commitLearningOutcome.mock.calls.map((call) => call[0].operationId)).toEqual([
      'outcome-seq-2',
      'outcome-seq-3',
      'outcome-seq-3'
    ])
    expect(statuses).toContain('needs_practice')
    expect(statuses).toContain('saved')
    expect(statuses).toContain('already_committed')
  })

  it('API reject is retryable with the same operationId and reconciliation_required stays honest', async () => {
    const commitLearningOutcome = vi
      .fn()
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValueOnce({
        status: 'retryable_failure',
        reason: 'reconciliation_required'
      } satisfies LearningOutcomeCommitResult)
      .mockResolvedValueOnce({
        status: 'committed',
        outcome: { kind: 'misconception_corrected' },
        recordSaved: true
      } satisfies LearningOutcomeCommitResult)

    const client = createLearningOutcomeCommitClient({ commitLearningOutcome })
    const rejected = await client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      evidenceSequence: 4,
      eventId: 'evidence-1',
      intentKind: 'quiz_answered'
    })
    expect(rejected).toMatchObject({
      kind: 'retryable',
      reason: 'api_reject',
      canRetry: true,
      operationId: 'outcome-seq-4',
      announcement: null
    })

    const reconciliation = await client.retry()
    expect(reconciliation).toMatchObject({
      kind: 'retryable',
      reason: 'reconciliation_required',
      operationId: 'outcome-seq-4',
      announcement: null
    })
    expect(learnerSafeCommitStatusLabel(reconciliation)).toMatch(/恢复核对|重试/)

    const recovered = await client.retry()
    expect(recovered).toMatchObject({
      kind: 'saved',
      recordSaved: true,
      operationId: 'outcome-seq-4'
    })
    expect(commitLearningOutcome.mock.calls.map((call) => call[0].operationId)).toEqual([
      'outcome-seq-4',
      'outcome-seq-4',
      'outcome-seq-4'
    ])
  })

  it('stale results from a previous lesson scope do not pollute the new lesson status', async () => {
    let resolveFirst: ((value: LearningOutcomeCommitResult) => void) | null = null
    const commitLearningOutcome = vi.fn()
    commitLearningOutcome.mockImplementationOnce(
      () =>
        new Promise<LearningOutcomeCommitResult>((resolve) => {
          resolveFirst = resolve
        })
    )
    commitLearningOutcome.mockResolvedValueOnce({
      status: 'committed',
      outcome: { kind: 'needs_practice' },
      recordSaved: false
    } satisfies LearningOutcomeCommitResult)

    const client = createLearningOutcomeCommitClient({ commitLearningOutcome })
    client.setLessonScope('lesson-a')

    const pending = client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-old',
      evidenceSequence: 2,
      eventId: 'evidence-old',
      intentKind: 'quiz_answered'
    })

    client.setLessonScope('lesson-b')
    expect(client.getStatus()).toEqual({ kind: 'idle' })

    resolveFirst?.({
      status: 'committed',
      outcome: { kind: 'misconception_corrected' },
      recordSaved: true
    })
    await pending
    expect(client.getStatus()).toEqual({ kind: 'idle' })
    expect(client.getEmittedAnnouncementIds()).toEqual([])

    const fresh = await client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-new',
      evidenceSequence: 1,
      eventId: 'evidence-new',
      intentKind: 'quiz_answered'
    })
    expect(fresh).toMatchObject({
      kind: 'needs_practice',
      sessionId: 'session-new',
      operationId: 'outcome-seq-1',
      recordSaved: false
    })
    expect(client.getEmittedAnnouncementIds()).toEqual([])
    expect(commitLearningOutcome).toHaveBeenCalledTimes(2)
  })

  it('production orchestration records evidence then commits only for eligible intents', async () => {
    const recordPreviewLessonInteraction = vi.fn(async () => ({
      eventId: 'evidence-1',
      sessionId: 'session-1',
      sequence: 2,
      duplicate: false
    }))
    const commitLearningOutcome = vi.fn(async () => ({
      status: 'committed' as const,
      outcome: { kind: 'needs_practice' as const },
      recordSaved: false as const
    }))
    const client = createLearningOutcomeCommitClient({ commitLearningOutcome })

    const opened = await recordPreviewLessonInteractionAndMaybeCommit({
      api: { recordPreviewLessonInteraction, commitLearningOutcome },
      intent: { eventId: 'open-1', kind: 'lesson_opened', itemId: 'lesson-1' },
      workspaceId: 'workspace-1',
      client
    })
    expect(opened.receipt?.eventId).toBe('evidence-1')
    expect(commitLearningOutcome).not.toHaveBeenCalled()
    expect(opened.commitStatus).toEqual({ kind: 'idle' })

    const quiz = await recordPreviewLessonInteractionAndMaybeCommit({
      api: { recordPreviewLessonInteraction, commitLearningOutcome },
      intent: {
        eventId: 'quiz-1',
        kind: 'quiz_answered',
        itemId: 'quiz-1',
        selectedOptionIds: ['a'],
        correct: false
      },
      workspaceId: 'workspace-1',
      client
    })
    expect(commitLearningOutcome).toHaveBeenCalledTimes(1)
    expect(commitLearningOutcome).toHaveBeenCalledWith({
      schemaVersion: 1,
      type: 'commit',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      operationId: 'outcome-seq-2'
    })
    expect(quiz.commitStatus).toMatchObject({ kind: 'needs_practice', recordSaved: false })
  })

  it('dispose makes in-flight commit results async-safe after unmount', async () => {
    let resolveCommit: ((value: LearningOutcomeCommitResult) => void) | null = null
    const commitLearningOutcome = vi.fn(
      () =>
        new Promise<LearningOutcomeCommitResult>((resolve) => {
          resolveCommit = resolve
        })
    )
    const client = createLearningOutcomeCommitClient({ commitLearningOutcome })
    const pending = client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      evidenceSequence: 1,
      eventId: 'evidence-1',
      intentKind: 'quiz_answered'
    })
    client.dispose()
    resolveCommit?.({
      status: 'committed',
      outcome: { kind: 'established' },
      recordSaved: true
    })
    await pending
    expect(client.getStatus()).toEqual({ kind: 'idle' })
  })

  it('dispose invalidates work without notifying React (no setState after unmount)', async () => {
    let resolveCommit: ((value: LearningOutcomeCommitResult) => void) | null = null
    const commitLearningOutcome = vi.fn(
      () =>
        new Promise<LearningOutcomeCommitResult>((resolve) => {
          resolveCommit = resolve
        })
    )
    const onStatusChange = vi.fn()
    const client = createLearningOutcomeCommitClient({ commitLearningOutcome, onStatusChange })
    const pending = client.commitAfterEvidence({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      evidenceSequence: 1,
      eventId: 'evidence-1',
      intentKind: 'quiz_answered'
    })
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'committing' }))
    onStatusChange.mockClear()
    client.dispose()
    expect(onStatusChange).not.toHaveBeenCalled()
    resolveCommit?.({
      status: 'committed',
      outcome: { kind: 'established' },
      recordSaved: true
    })
    await pending
    expect(client.getStatus()).toEqual({ kind: 'idle' })
    expect(onStatusChange).not.toHaveBeenCalled()
  })

  it('delayed record does not commit after scope leaves isCurrent (stale record window)', async () => {
    let resolveRecord: ((value: {
      eventId: string
      sessionId: string
      sequence: number
      duplicate: boolean
    }) => void) | null = null
    const recordPreviewLessonInteraction = vi.fn(
      () =>
        new Promise<{
          eventId: string
          sessionId: string
          sequence: number
          duplicate: boolean
        }>((resolve) => {
          resolveRecord = resolve
        })
    )
    const commitLearningOutcome = vi.fn(async () => ({
      status: 'committed' as const,
      outcome: { kind: 'misconception_corrected' as const },
      recordSaved: true as const
    }))
    const statuses: LearningOutcomeCommitUiStatus[] = []
    const client = createLearningOutcomeCommitClient({
      commitLearningOutcome,
      onStatusChange: (status) => statuses.push(status)
    })
    client.setLessonScope('lesson-a')

    let scopeCurrent = true
    const pending = recordPreviewLessonInteractionAndMaybeCommit({
      api: { recordPreviewLessonInteraction, commitLearningOutcome },
      intent: {
        eventId: 'quiz-stale-1',
        kind: 'quiz_answered',
        itemId: 'quiz-1',
        selectedOptionIds: ['a'],
        correct: false
      },
      workspaceId: 'workspace-1',
      client,
      isCurrent: () => scopeCurrent
    })

    // Switch lesson/workspace while evidence write is still in flight.
    scopeCurrent = false
    client.setLessonScope('lesson-b')
    expect(client.getStatus()).toEqual({ kind: 'idle' })

    resolveRecord?.({
      eventId: 'quiz-stale-1',
      sessionId: 'session-old',
      sequence: 2,
      duplicate: false
    })
    const result = await pending
    expect(commitLearningOutcome).toHaveBeenCalledTimes(0)
    expect(result.commitStatus).toEqual({ kind: 'idle' })
    expect(client.getStatus()).toEqual({ kind: 'idle' })
    expect(statuses.filter((status) => status.kind === 'saved' || status.kind === 'committing')).toEqual([])
  })

  it('isPreviewCommitScopeCurrent compares live scope against captured start tokens', () => {
    expect(
      isPreviewCommitScopeCurrent({
        scopeAtStart: 'ws:lesson-a',
        workspaceIdAtStart: 'ws',
        currentScopeKey: 'ws:lesson-a',
        currentWorkspaceId: 'ws'
      })
    ).toBe(true)
    expect(
      isPreviewCommitScopeCurrent({
        scopeAtStart: 'ws:lesson-a',
        workspaceIdAtStart: 'ws',
        currentScopeKey: 'ws:lesson-b',
        currentWorkspaceId: 'ws'
      })
    ).toBe(false)
    expect(
      isPreviewCommitScopeCurrent({
        scopeAtStart: 'ws:lesson-a',
        workspaceIdAtStart: 'ws',
        currentScopeKey: 'ws:lesson-a',
        currentWorkspaceId: 'other'
      })
    ).toBe(false)
  })

  it('maps severity without dead branches for status kinds', () => {
    expect(learnerSafeCommitStatusSeverity({ kind: 'idle' })).toBeNull()
    expect(
      learnerSafeCommitStatusSeverity({
        kind: 'retryable',
        sessionId: 's',
        operationId: 'o',
        reason: 'api_reject',
        canRetry: true,
        announcement: null
      })
    ).toBe('warning')
    expect(
      learnerSafeCommitStatusSeverity({
        kind: 'blocked',
        sessionId: 's',
        operationId: 'o',
        reason: 'conflict',
        announcement: null
      })
    ).toBe('warning')
    expect(
      learnerSafeCommitStatusSeverity({
        kind: 'needs_practice',
        sessionId: 's',
        operationId: 'o',
        recordSaved: false,
        announcement: null
      })
    ).toBe('info')
    expect(
      learnerSafeCommitStatusSeverity({
        kind: 'saved',
        sessionId: 's',
        operationId: 'o',
        outcomeKind: 'established',
        recordSaved: true,
        announcement: null
      })
    ).toBe('info')
    expect(
      learnerSafeCommitStatusSeverity({
        kind: 'committing',
        sessionId: 's',
        operationId: 'o'
      })
    ).toBe('info')
  })
})
