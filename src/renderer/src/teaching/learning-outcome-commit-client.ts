import type { PreviewLessonInteractionIntent, PreviewLessonInteractionReceipt } from '../../../shared/teaching-types/lesson-interaction'
import type {
  CommitLearningOutcomeRequest,
  TeachingSystemApi
} from '../../../shared/teaching-types'
import type { LearningOutcomeCommitResult } from '../../../shared/teaching-types/learning-outcome'

/** Evidence-bearing preview intents that may justify a sole-writer outcome commit. */
export const COMMIT_ELIGIBLE_PREVIEW_INTENT_KINDS = [
  'quiz_answered',
  'flashcard_rated',
  'retrieval_response_submitted',
  'learner_response_recorded'
] as const satisfies ReadonlyArray<PreviewLessonInteractionIntent['kind']>

export type CommitEligiblePreviewIntentKind = (typeof COMMIT_ELIGIBLE_PREVIEW_INTENT_KINDS)[number]

export type LearningOutcomeCommitApi = Pick<
  TeachingSystemApi,
  'recordPreviewLessonInteraction' | 'commitLearningOutcome'
>

export type LearningOutcomeCommitEvidence = {
  workspaceId: string
  sessionId: string
  evidenceSequence: number
  eventId: string
  intentKind: PreviewLessonInteractionIntent['kind']
}

/**
 * Learner-safe renderer status. The renderer never invents mastery/save facts;
 * it only projects the sole-writer IPC result.
 */
export type LearningOutcomeCommitUiStatus =
  | { kind: 'idle' }
  | { kind: 'committing'; sessionId: string; operationId: string }
  | {
      kind: 'needs_practice'
      sessionId: string
      operationId: string
      recordSaved: false
      /** Always null — needs_practice must never present as mastered/saved. */
      announcement: null
    }
  | {
      kind: 'saved'
      sessionId: string
      operationId: string
      outcomeKind: 'established' | 'misconception_corrected'
      recordSaved: true
      announcement: { id: string; message: string } | null
    }
  | {
      kind: 'already_committed'
      sessionId: string
      operationId: string
      recordSaved: boolean
      outcomeKind: 'established' | 'misconception_corrected' | 'needs_practice'
      announcement: null
    }
  | {
      kind: 'retryable'
      sessionId: string
      operationId: string
      reason: 'reconciliation_required' | 'temporarily_unavailable' | 'api_reject'
      canRetry: true
      announcement: null
    }
  | {
      kind: 'blocked'
      sessionId: string
      operationId: string
      reason: 'conflict' | 'insufficient_evidence' | 'invalid_session' | 'invalid_request' | 'read_only' | 'not_found'
      announcement: null
    }

export type LearningOutcomeCommitClientOptions = {
  commitLearningOutcome: TeachingSystemApi['commitLearningOutcome']
  onStatusChange?: (status: LearningOutcomeCommitUiStatus) => void
  /** Test seam for deterministic operation IDs. */
  buildOperationId?: (sessionId: string, evidenceSequence: number) => string
}

export type LearningOutcomeCommitClient = {
  /** Invalidate in-flight results when the visible lesson/scope changes. */
  setLessonScope: (scopeKey: string | null) => void
  /** Route leave / unmount: drop status and ignore pending async results. */
  dispose: () => void
  getStatus: () => LearningOutcomeCommitUiStatus
  getEmittedAnnouncementIds: () => readonly string[]
  /**
   * After a successful evidence write, attempt a sole-writer commit with a
   * stable/retryable operationId derived from the evidence sequence.
   */
  commitAfterEvidence: (evidence: LearningOutcomeCommitEvidence) => Promise<LearningOutcomeCommitUiStatus>
  /** Retry the last retryable logical commit with the same operationId. */
  retry: () => Promise<LearningOutcomeCommitUiStatus>
}

const SAVED_ANNOUNCEMENT_MESSAGE = '本次学习进展已保存。你可以继续下一步。'

export function isCommitEligiblePreviewIntentKind(
  kind: PreviewLessonInteractionIntent['kind']
): kind is CommitEligiblePreviewIntentKind {
  return (COMMIT_ELIGIBLE_PREVIEW_INTENT_KINDS as readonly string[]).includes(kind)
}

/**
 * Stable per-session operation identity for one evidence revision. Retries of
 * the same revision reuse the same id; a later sequence (new evidence) uses a
 * new id so needs_practice can be followed by a correction commit.
 */
export function buildLearningOutcomeCommitOperationId(_sessionId: string, evidenceSequence: number): string {
  const sequence = Number.isInteger(evidenceSequence) && evidenceSequence > 0 ? evidenceSequence : 0
  // Keep well under the 128-char sole-writer operationId limit without embedding
  // the full session id (session identity is sent as its own request field).
  return `outcome-seq-${sequence}`
}

export function buildCommitLearningOutcomeRequest(input: {
  workspaceId: string
  sessionId: string
  operationId: string
}): CommitLearningOutcomeRequest {
  return {
    schemaVersion: 1,
    type: 'commit',
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    operationId: input.operationId
  }
}

export function projectLearnerSafeCommitStatus(input: {
  sessionId: string
  operationId: string
  result: LearningOutcomeCommitResult
  emittedAnnouncementIds: readonly string[]
}): LearningOutcomeCommitUiStatus {
  const { sessionId, operationId, result, emittedAnnouncementIds } = input

  if (result.status === 'committed') {
    if (result.outcome.kind === 'needs_practice' || result.recordSaved === false) {
      return {
        kind: 'needs_practice',
        sessionId,
        operationId,
        recordSaved: false,
        announcement: null
      }
    }
    return projectSavedStatus({
      sessionId,
      operationId,
      outcomeKind: result.outcome.kind,
      emittedAnnouncementIds
    })
  }

  if (result.status === 'already_committed') {
    if (result.outcome.kind === 'needs_practice' || result.recordSaved === false) {
      return {
        kind: 'already_committed',
        sessionId,
        operationId,
        recordSaved: false,
        outcomeKind: 'needs_practice',
        announcement: null
      }
    }
    return {
      kind: 'already_committed',
      sessionId,
      operationId,
      recordSaved: true,
      outcomeKind: result.outcome.kind,
      announcement: null
    }
  }

  if (result.status === 'retryable_failure') {
    return {
      kind: 'retryable',
      sessionId,
      operationId,
      reason: result.reason,
      canRetry: true,
      announcement: null
    }
  }

  if (result.status === 'conflict') {
    return {
      kind: 'blocked',
      sessionId,
      operationId,
      reason: 'conflict',
      announcement: null
    }
  }

  if (result.status === 'insufficient_evidence') {
    return {
      kind: 'blocked',
      sessionId,
      operationId,
      reason: 'insufficient_evidence',
      announcement: null
    }
  }

  return {
    kind: 'blocked',
    sessionId,
    operationId,
    reason: result.reason,
    announcement: null
  }
}

function projectSavedStatus(input: {
  sessionId: string
  operationId: string
  outcomeKind: 'established' | 'misconception_corrected'
  emittedAnnouncementIds: readonly string[]
}): Extract<LearningOutcomeCommitUiStatus, { kind: 'saved' }> {
  const announcementId = `saved:${input.operationId}`
  const announcement = input.emittedAnnouncementIds.includes(announcementId)
    ? null
    : { id: announcementId, message: SAVED_ANNOUNCEMENT_MESSAGE }
  return {
    kind: 'saved',
    sessionId: input.sessionId,
    operationId: input.operationId,
    outcomeKind: input.outcomeKind,
    recordSaved: true,
    announcement
  }
}

export function createLearningOutcomeCommitClient(
  options: LearningOutcomeCommitClientOptions
): LearningOutcomeCommitClient {
  let generation = 0
  let lessonScopeKey: string | null = null
  let status: LearningOutcomeCommitUiStatus = { kind: 'idle' }
  const emittedAnnouncementIds = new Set<string>()
  let lastRetryable: {
    workspaceId: string
    sessionId: string
    operationId: string
    evidenceSequence: number
  } | null = null

  const publish = (next: LearningOutcomeCommitUiStatus, expectedGeneration: number): LearningOutcomeCommitUiStatus => {
    if (expectedGeneration !== generation) return status
    status = next
    if (next.kind === 'saved' && next.announcement) {
      emittedAnnouncementIds.add(next.announcement.id)
    }
    options.onStatusChange?.(status)
    return status
  }

  const buildOperationId = options.buildOperationId ?? buildLearningOutcomeCommitOperationId

  const runCommit = async (input: {
    workspaceId: string
    sessionId: string
    operationId: string
    evidenceSequence: number
    expectedGeneration: number
  }): Promise<LearningOutcomeCommitUiStatus> => {
    if (input.expectedGeneration !== generation) return status

    publish(
      { kind: 'committing', sessionId: input.sessionId, operationId: input.operationId },
      input.expectedGeneration
    )

    try {
      const result = await options.commitLearningOutcome(
        buildCommitLearningOutcomeRequest({
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          operationId: input.operationId
        })
      )
      if (input.expectedGeneration !== generation) return status

      const projected = projectLearnerSafeCommitStatus({
        sessionId: input.sessionId,
        operationId: input.operationId,
        result,
        emittedAnnouncementIds: [...emittedAnnouncementIds]
      })

      if (projected.kind === 'retryable') {
        lastRetryable = {
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          operationId: input.operationId,
          evidenceSequence: input.evidenceSequence
        }
      } else {
        // Keep retry only for retryable outcomes; successful/blocked settlement clears it.
        lastRetryable = null
      }

      return publish(projected, input.expectedGeneration)
    } catch {
      if (input.expectedGeneration !== generation) return status
      lastRetryable = {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        operationId: input.operationId,
        evidenceSequence: input.evidenceSequence
      }
      return publish(
        {
          kind: 'retryable',
          sessionId: input.sessionId,
          operationId: input.operationId,
          reason: 'api_reject',
          canRetry: true,
          announcement: null
        },
        input.expectedGeneration
      )
    }
  }

  return {
    setLessonScope(scopeKey) {
      if (scopeKey === lessonScopeKey) return
      lessonScopeKey = scopeKey
      generation += 1
      lastRetryable = null
      // Scope isolation: operationIds are sequence-scoped per session; do not
      // suppress a later lesson's first saved announcement because a previous
      // lesson already used the same sequence-derived operationId string.
      emittedAnnouncementIds.clear()
      status = { kind: 'idle' }
      options.onStatusChange?.(status)
    },
    dispose() {
      // Invalidate in-flight work without notifying React. Callers dispose on
      // unmount; publishing idle here would setState on an unmounted tree.
      generation += 1
      lessonScopeKey = null
      lastRetryable = null
      emittedAnnouncementIds.clear()
      status = { kind: 'idle' }
    },
    getStatus: () => status,
    getEmittedAnnouncementIds: () => [...emittedAnnouncementIds],
    async commitAfterEvidence(evidence) {
      if (!isCommitEligiblePreviewIntentKind(evidence.intentKind)) return status
      if (!evidence.workspaceId || !evidence.sessionId) return status
      if (!Number.isInteger(evidence.evidenceSequence) || evidence.evidenceSequence < 1) return status

      const expectedGeneration = generation
      const operationId = buildOperationId(evidence.sessionId, evidence.evidenceSequence)
      return runCommit({
        workspaceId: evidence.workspaceId,
        sessionId: evidence.sessionId,
        operationId,
        evidenceSequence: evidence.evidenceSequence,
        expectedGeneration
      })
    },
    async retry() {
      if (!lastRetryable) return status
      const expectedGeneration = generation
      return runCommit({
        ...lastRetryable,
        expectedGeneration
      })
    }
  }
}

/**
 * Production App path: record host-owned preview evidence, then sole-writer
 * commit only after a successful evidence write for an eligible intent.
 */
export async function recordPreviewLessonInteractionAndMaybeCommit(input: {
  api: LearningOutcomeCommitApi
  intent: PreviewLessonInteractionIntent
  workspaceId: string | null | undefined
  client: LearningOutcomeCommitClient
  isCurrent?: () => boolean
}): Promise<{
  receipt: PreviewLessonInteractionReceipt | null
  commitStatus: LearningOutcomeCommitUiStatus
}> {
  const isCurrent = input.isCurrent ?? (() => true)
  const receipt = await input.api.recordPreviewLessonInteraction(input.intent)
  if (!isCurrent()) {
    return { receipt, commitStatus: input.client.getStatus() }
  }
  if (!input.workspaceId || !isCommitEligiblePreviewIntentKind(input.intent.kind)) {
    return { receipt, commitStatus: input.client.getStatus() }
  }

  const commitStatus = await input.client.commitAfterEvidence({
    workspaceId: input.workspaceId,
    sessionId: receipt.sessionId,
    evidenceSequence: receipt.sequence,
    eventId: receipt.eventId,
    intentKind: input.intent.kind
  })
  return { receipt, commitStatus }
}

export function learnerSafeCommitStatusLabel(status: LearningOutcomeCommitUiStatus): string | null {
  switch (status.kind) {
    case 'committing':
      return '正在确认学习进展…'
    case 'needs_practice':
      return '还需要继续练习，不会记为掌握。'
    case 'saved':
      return status.announcement?.message ?? '本次学习进展已保存。'
    case 'already_committed':
      return status.recordSaved
        ? '该进展此前已保存，未重复公告。'
        : '该练习结果此前已确认，仍需继续练习。'
    case 'retryable':
      return status.reason === 'reconciliation_required'
        ? '保存需要恢复核对，可重试同一提交。'
        : '提交暂时不可用，可重试同一提交。'
    case 'blocked':
      if (status.reason === 'insufficient_evidence') return '证据尚不完整，暂未确认学习进展。'
      if (status.reason === 'conflict') return '学习进展存在冲突，需要人工核对。'
      return '无法确认学习进展。'
    default:
      return null
  }
}


export function learnerSafeCommitStatusSeverity(
  status: LearningOutcomeCommitUiStatus
): 'info' | 'warning' | null {
  switch (status.kind) {
    case 'retryable':
    case 'blocked':
      return 'warning'
    case 'committing':
    case 'needs_practice':
    case 'saved':
    case 'already_committed':
      return 'info'
    default:
      return null
  }
}

/**
 * Compare the record-start scope/workspace against live current refs so a
 * delayed evidence write cannot commit into a switched lesson or workspace.
 */
export function isPreviewCommitScopeCurrent(input: {
  scopeAtStart: string | null
  workspaceIdAtStart: string | null | undefined
  currentScopeKey: string | null
  currentWorkspaceId: string | null | undefined
}): boolean {
  return (
    (input.currentWorkspaceId ?? null) === (input.workspaceIdAtStart ?? null) &&
    input.currentScopeKey === input.scopeAtStart
  )
}
