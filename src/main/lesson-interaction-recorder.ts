import { createHash } from 'node:crypto'

import type { LearningSessionLedger } from './learning-session-ledger'
import type { LearningSessionSnapshot } from '../shared/teaching-types/learning-session'
import type { RecordProgressPayload } from '../shared/teaching-types/review'
import {
  type EvidenceReceipt,
  type LessonInteraction,
  type PersistedLessonInteraction,
  LessonInteractionValidationError,
  lessonInteractionLedgerKind,
  normalizeLessonInteraction
} from '../shared/teaching-types/lesson-interaction'

export { LessonInteractionValidationError }
export type { EvidenceReceipt, LessonInteraction, PersistedLessonInteraction } from '../shared/teaching-types/lesson-interaction'

export interface LessonInteractionRecorder {
  record(event: LessonInteraction): Promise<EvidenceReceipt>
  list(sessionId: string): Promise<PersistedLessonInteraction[]>
}

export type LessonInteractionRecorderOptions = {
  ledger: Pick<LearningSessionLedger, 'appendWithReceipt' | 'load'>
}

export type LegacyReviewEvidenceBinding = {
  eventId: string
  itemId: string
  attempt: number
  observedAt: string
  artifactDigest: string
}

export type LegacyReviewEvidenceProjectionInput = {
  workspaceId: string
  courseId: string
  sessionId: string
  lessonId: string
  results: RecordProgressPayload['results']
  bindings: LegacyReviewEvidenceBinding[]
}

/**
 * The only durable write is LearningSessionLedger.appendWithReceipt. This recorder does
 * not evaluate mastery, write outcome files, or update legacy review progress.
 */
export function createLessonInteractionRecorder(options: LessonInteractionRecorderOptions): LessonInteractionRecorder {
  return new LedgerLessonInteractionRecorder(options.ledger)
}

export function projectLegacyReviewProgressToLessonInteractions(
  input: LegacyReviewEvidenceProjectionInput
): LessonInteraction[] {
  if (!Array.isArray(input.results) || input.results.length !== input.bindings.length) {
    throw new LessonInteractionValidationError('Legacy review projection requires one explicit provenance binding per result.')
  }

  return input.results.map((result, index) => {
    const binding = input.bindings[index]
    if (!binding || result.lessonId !== input.lessonId || typeof result.question !== 'string' || !result.question.trim()) {
      throw new LessonInteractionValidationError('Legacy review projection has incomplete or mismatched review evidence.')
    }
    return normalizeLessonInteraction({
      schemaVersion: 1,
      eventId: binding.eventId,
      kind: 'legacy_review_projected',
      workspaceId: input.workspaceId,
      courseId: input.courseId,
      sessionId: input.sessionId,
      lessonId: input.lessonId,
      itemId: binding.itemId,
      attempt: binding.attempt,
      observedAt: binding.observedAt,
      artifactDigest: binding.artifactDigest,
      surface: 'legacy_review',
      correct: result.correct,
      missing: ['responseDigest'],
      legacy: {
        source: 'review_progress',
        questionDigest: sha256(result.question)
      }
    })
  })
}

class LedgerLessonInteractionRecorder implements LessonInteractionRecorder {
  constructor(private readonly ledger: Pick<LearningSessionLedger, 'appendWithReceipt' | 'load'>) {}

  async record(event: LessonInteraction): Promise<EvidenceReceipt> {
    const evidence = normalizeLessonInteraction(event)
    const before = await this.ledger.load(evidence.sessionId)
    if (!before) throw new LessonInteractionValidationError(`Learning Session "${evidence.sessionId}" was not found.`)
    assertSessionIdentity(before, evidence)

    const receipt = await this.ledger.appendWithReceipt(evidence.sessionId, {
      schemaVersion: 1,
      eventId: evidence.eventId,
      sessionId: evidence.sessionId,
      kind: lessonInteractionLedgerKind(evidence),
      occurredAt: evidence.observedAt,
      ...(evidence.kind === 'conversation_evidence_recorded' ? { turnId: evidence.provenance.turnId } : {}),
      payload: { lessonInteraction: evidence }
    })
    const persistedEvidence = interactionFromLedgerEvent(receipt.event)
    if (!persistedEvidence) throw new LessonInteractionValidationError('Session ledger did not return the recorded lesson interaction.')
    return {
      eventId: evidence.eventId,
      sessionId: evidence.sessionId,
      sequence: receipt.event.sequence,
      duplicate: receipt.disposition === 'matching_existing',
      evidence: { ...persistedEvidence, sequence: receipt.event.sequence, recordedAt: receipt.event.recordedAt }
    }
  }

  async list(sessionId: string): Promise<PersistedLessonInteraction[]> {
    const snapshot = await this.ledger.load(sessionId)
    if (!snapshot) return []
    return snapshot.events.flatMap((event) => {
      const interaction = interactionFromLedgerEvent(event)
      return interaction ? [{ ...interaction, sequence: event.sequence, recordedAt: event.recordedAt }] : []
    })
  }
}

function assertSessionIdentity(session: LearningSessionSnapshot, evidence: LessonInteraction): void {
  if (session.readOnly) throw new LessonInteractionValidationError(`Learning Session "${evidence.sessionId}" is read-only.`)
  if (
    session.workspaceId !== evidence.workspaceId ||
    session.courseRef.courseId !== evidence.courseId ||
    session.lessonRef?.lessonId !== evidence.lessonId
  ) {
    throw new LessonInteractionValidationError('Lesson interaction identity does not match the bound Learning Session.')
  }
  if (
    evidence.kind === 'conversation_evidence_recorded' &&
    !session.conversationRefs.some((reference) => reference.conversationId === evidence.provenance.conversationId)
  ) {
    throw new LessonInteractionValidationError('Conversation evidence is not bound to the Learning Session.')
  }
}

function interactionFromLedgerEvent(event: { payload: Record<string, unknown> }): LessonInteraction | null {
  const value = event.payload.lessonInteraction
  try {
    return normalizeLessonInteraction(value)
  } catch {
    return null
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
