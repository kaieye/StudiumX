import { describe, expect, it, vi } from 'vitest'

import type { LearningOutcomeCommitResult } from '../../src/shared/teaching-types/learning-outcome'
import {
  buildCommitLearningOutcomeRequest,
  buildLearningOutcomeCommitOperationId,
  createLearningOutcomeCommitClient,
  isCommitEligiblePreviewIntentKind,
  learnerSafeCommitStatusLabel,
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
})

