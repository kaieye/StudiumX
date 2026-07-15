import type { LearningSessionEventKind } from './learning-session'

export const LESSON_INTERACTION_SCHEMA_VERSION = 1 as const

export type LessonInteractionKind =
  | 'lesson_opened'
  | 'lesson_completed'
  | 'retrieval_response_submitted'
  | 'quiz_answered'
  | 'flashcard_rated'
  | 'learner_response_recorded'
  | 'conversation_evidence_recorded'
  | 'legacy_review_projected'

export type LessonInteractionSurface = 'lesson_preview' | 'markdown_preview' | 'review' | 'conversation' | 'legacy_review'
export type LearnerResponseKind = 'short_answer' | 'free_text'
export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy'

export type LessonInteractionBase = {
  schemaVersion: typeof LESSON_INTERACTION_SCHEMA_VERSION
  eventId: string
  workspaceId: string
  courseId: string
  sessionId: string
  lessonId: string
  itemId: string
  attempt: number
  observedAt: string
  artifactDigest: string
}

export type LessonOpened = LessonInteractionBase & {
  kind: 'lesson_opened'
  surface: 'lesson_preview' | 'markdown_preview'
}

export type LessonCompleted = LessonInteractionBase & {
  kind: 'lesson_completed'
  surface: 'lesson_preview' | 'markdown_preview'
}

export type RetrievalResponseSubmitted = LessonInteractionBase & {
  kind: 'retrieval_response_submitted'
  surface: 'lesson_preview' | 'markdown_preview'
  responseDigest: string
  responseKind: LearnerResponseKind
}

export type QuizAnswered = LessonInteractionBase & {
  kind: 'quiz_answered'
  surface: 'lesson_preview' | 'markdown_preview' | 'review'
  selectedOptionIds: string[]
  correct: boolean
}

export type FlashcardRated = LessonInteractionBase & {
  kind: 'flashcard_rated'
  surface: 'lesson_preview' | 'markdown_preview' | 'review'
  rating: FlashcardRating
}

export type LearnerResponseRecorded = LessonInteractionBase & {
  kind: 'learner_response_recorded'
  surface: 'lesson_preview' | 'markdown_preview' | 'conversation'
  responseDigest: string
  responseKind: LearnerResponseKind
}

export type ConversationTurnProvenance = {
  conversationId: string
  turnId: string
  author: 'learner'
  turnCreatedAt: string
}

export type ConversationEvidenceRecorded = LessonInteractionBase & {
  kind: 'conversation_evidence_recorded'
  surface: 'conversation'
  responseDigest: string
  responseKind: LearnerResponseKind
  provenance: ConversationTurnProvenance
}

/** Read-only adapter output for legacy review progress. It deliberately exposes missing evidence. */
export type LegacyReviewProjected = LessonInteractionBase & {
  kind: 'legacy_review_projected'
  surface: 'legacy_review'
  correct: boolean
  missing: ['responseDigest']
  legacy: {
    source: 'review_progress'
    questionDigest: string
  }
}

export type LessonInteraction =
  | LessonOpened
  | LessonCompleted
  | RetrievalResponseSubmitted
  | QuizAnswered
  | FlashcardRated
  | LearnerResponseRecorded
  | ConversationEvidenceRecorded
  | LegacyReviewProjected

export type PersistedLessonInteraction = LessonInteraction & {
  sequence: number
  recordedAt: string
}

export type EvidenceReceipt = {
  eventId: string
  sessionId: string
  sequence: number
  duplicate: boolean
  evidence: PersistedLessonInteraction
}

export type PreviewLessonInteractionIntent =
  | { eventId: string; kind: 'lesson_opened'; itemId: string }
  | { eventId: string; kind: 'lesson_completed'; itemId: string }
  | { eventId: string; kind: 'quiz_answered'; itemId: string; selectedOptionIds: string[]; correct: boolean }
  | { eventId: string; kind: 'flashcard_rated'; itemId: string; rating: FlashcardRating }
  | { eventId: string; kind: 'retrieval_response_submitted'; itemId: string; responseDigest: string; responseKind?: LearnerResponseKind }
  | { eventId: string; kind: 'learner_response_recorded'; itemId: string; responseDigest: string; responseKind?: LearnerResponseKind }

export class LessonInteractionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LessonInteractionValidationError'
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DIGEST = /^[a-f0-9]{64}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RESPONSE_KINDS = new Set<LearnerResponseKind>(['short_answer', 'free_text'])
const FLASHCARD_RATINGS = new Set<FlashcardRating>(['again', 'hard', 'good', 'easy'])

export function normalizeLessonInteraction(value: unknown): LessonInteraction {
  const record = requireRecord(value, 'Lesson interaction')
  const kind = requireOneOf(record.kind, [
    'lesson_opened', 'lesson_completed', 'retrieval_response_submitted', 'quiz_answered', 'flashcard_rated',
    'learner_response_recorded', 'conversation_evidence_recorded', 'legacy_review_projected'
  ] as const, 'Lesson interaction kind')
  const base = normalizeBase(record, kind)

  switch (kind) {
    case 'lesson_opened':
      requireExactKeys(record, [...baseKeys, 'surface'], kind)
      return { ...base, kind, surface: requireOneOf(record.surface, ['lesson_preview', 'markdown_preview'] as const, 'Lesson opened surface') }
    case 'lesson_completed':
      requireExactKeys(record, [...baseKeys, 'surface'], kind)
      return { ...base, kind, surface: requireOneOf(record.surface, ['lesson_preview', 'markdown_preview'] as const, 'Lesson completed surface') }
    case 'quiz_answered':
      requireExactKeys(record, [...baseKeys, 'surface', 'selectedOptionIds', 'correct'], kind)
      return {
        ...base,
        kind,
        surface: requireOneOf(record.surface, ['lesson_preview', 'markdown_preview', 'review'] as const, 'Quiz surface'),
        selectedOptionIds: requireUniqueIds(record.selectedOptionIds, 'Quiz selected option IDs'),
        correct: requireBoolean(record.correct, 'Quiz correctness')
      }
    case 'flashcard_rated':
      requireExactKeys(record, [...baseKeys, 'surface', 'rating'], kind)
      return {
        ...base,
        kind,
        surface: requireOneOf(record.surface, ['lesson_preview', 'markdown_preview', 'review'] as const, 'Flashcard surface'),
        rating: requireOneOf(record.rating, [...FLASHCARD_RATINGS] as FlashcardRating[], 'Flashcard rating')
      }
    case 'retrieval_response_submitted':
      requireExactKeys(record, [...baseKeys, 'surface', 'responseDigest', 'responseKind'], kind)
      return {
        ...base,
        kind,
        surface: requireOneOf(record.surface, ['lesson_preview', 'markdown_preview'] as const, 'Retrieval response surface'),
        responseDigest: requireDigest(record.responseDigest, 'Learner response digest'),
        responseKind: requireResponseKind(record.responseKind)
      }
    case 'learner_response_recorded':
      requireExactKeys(record, [...baseKeys, 'surface', 'responseDigest', 'responseKind'], kind)
      return {
        ...base,
        kind,
        surface: requireOneOf(record.surface, ['lesson_preview', 'markdown_preview', 'conversation'] as const, 'Learner response surface'),
        responseDigest: requireDigest(record.responseDigest, 'Learner response digest'),
        responseKind: requireResponseKind(record.responseKind)
      }
    case 'conversation_evidence_recorded': {
      requireExactKeys(record, [...baseKeys, 'surface', 'responseDigest', 'responseKind', 'provenance'], kind)
      const provenance = requireRecord(record.provenance, 'Conversation provenance')
      requireExactKeys(provenance, ['conversationId', 'turnId', 'author', 'turnCreatedAt'], 'Conversation provenance')
      return {
        ...base,
        kind,
        surface: requireOneOf(record.surface, ['conversation'] as const, 'Conversation surface'),
        responseDigest: requireDigest(record.responseDigest, 'Conversation response digest'),
        responseKind: requireResponseKind(record.responseKind),
        provenance: {
          conversationId: requireId(provenance.conversationId, 'Conversation ID'),
          turnId: requireId(provenance.turnId, 'Conversation turn ID'),
          author: requireOneOf(provenance.author, ['learner'] as const, 'Conversation evidence author'),
          turnCreatedAt: requireIso(provenance.turnCreatedAt, 'Conversation turn time')
        }
      }
    }
    case 'legacy_review_projected': {
      requireExactKeys(record, [...baseKeys, 'surface', 'correct', 'missing', 'legacy'], kind)
      const legacy = requireRecord(record.legacy, 'Legacy review provenance')
      requireExactKeys(legacy, ['source', 'questionDigest'], 'Legacy review provenance')
      const missing = record.missing
      if (!Array.isArray(missing) || missing.length !== 1 || missing[0] !== 'responseDigest') {
        throw new LessonInteractionValidationError('Legacy review evidence must declare its missing responseDigest.')
      }
      return {
        ...base,
        kind,
        surface: requireOneOf(record.surface, ['legacy_review'] as const, 'Legacy review surface'),
        correct: requireBoolean(record.correct, 'Legacy review correctness'),
        missing: ['responseDigest'],
        legacy: {
          source: requireOneOf(legacy.source, ['review_progress'] as const, 'Legacy review source'),
          questionDigest: requireDigest(legacy.questionDigest, 'Legacy review question digest')
        }
      }
    }
  }
}

export function normalizePreviewLessonInteractionIntent(value: unknown): PreviewLessonInteractionIntent {
  const record = requireRecord(value, 'Preview lesson interaction')
  const kind = requireOneOf(record.kind, [
    'lesson_opened', 'lesson_completed', 'quiz_answered', 'flashcard_rated',
    'retrieval_response_submitted', 'learner_response_recorded'
  ] as const, 'Preview lesson interaction kind')
  const base = { eventId: requireId(record.eventId, 'Preview event ID'), itemId: requireId(record.itemId, 'Preview item ID') }
  switch (kind) {
    case 'lesson_opened':
    case 'lesson_completed':
      requireExactKeys(record, ['eventId', 'kind', 'itemId'], 'Preview lesson interaction')
      return { ...base, kind }
    case 'quiz_answered':
      requireExactKeys(record, ['eventId', 'kind', 'itemId', 'selectedOptionIds', 'correct'], 'Preview lesson interaction')
      return { ...base, kind, selectedOptionIds: requireUniqueIds(record.selectedOptionIds, 'Preview selected option IDs'), correct: requireBoolean(record.correct, 'Preview quiz correctness') }
    case 'flashcard_rated':
      requireExactKeys(record, ['eventId', 'kind', 'itemId', 'rating'], 'Preview lesson interaction')
      return { ...base, kind, rating: requireOneOf(record.rating, [...FLASHCARD_RATINGS] as FlashcardRating[], 'Preview flashcard rating') }
    case 'retrieval_response_submitted':
    case 'learner_response_recorded':
      requireExactKeys(record, ['eventId', 'kind', 'itemId', 'responseDigest', 'responseKind'], 'Preview lesson interaction')
      return { ...base, kind, responseDigest: requireDigest(record.responseDigest, 'Preview response digest'), responseKind: requireResponseKind(record.responseKind) }
  }
}

export function lessonInteractionLedgerKind(interaction: LessonInteraction): LearningSessionEventKind {
  switch (interaction.kind) {
    case 'lesson_opened': return 'lesson_opened'
    case 'lesson_completed': return 'lesson_completed'
    case 'retrieval_response_submitted': return 'retrieval_attempted'
    case 'quiz_answered':
    case 'legacy_review_projected': return 'quiz_attempted'
    case 'flashcard_rated': return 'flashcard_reviewed'
    case 'learner_response_recorded':
    case 'conversation_evidence_recorded': return 'learner_response_recorded'
  }
}

const baseKeys = ['schemaVersion', 'eventId', 'kind', 'workspaceId', 'courseId', 'sessionId', 'lessonId', 'itemId', 'attempt', 'observedAt', 'artifactDigest']

function normalizeBase(record: Record<string, unknown>, _kind: LessonInteractionKind): LessonInteractionBase {
  return {
    schemaVersion: requireSchemaVersion(record.schemaVersion),
    eventId: requireId(record.eventId, 'Evidence event ID'),
    workspaceId: requireId(record.workspaceId, 'Evidence workspace ID'),
    courseId: requireId(record.courseId, 'Evidence course ID'),
    sessionId: requireId(record.sessionId, 'Evidence session ID'),
    lessonId: requireId(record.lessonId, 'Evidence lesson ID'),
    itemId: requireId(record.itemId, 'Evidence item ID'),
    attempt: requireAttempt(record.attempt),
    observedAt: requireIso(record.observedAt, 'Evidence observed time'),
    artifactDigest: requireDigest(record.artifactDigest, 'Evidence artifact digest')
  }
}

function requireSchemaVersion(value: unknown): typeof LESSON_INTERACTION_SCHEMA_VERSION {
  if (value !== LESSON_INTERACTION_SCHEMA_VERSION) throw new LessonInteractionValidationError('Lesson interaction schemaVersion is unsupported.')
  return LESSON_INTERACTION_SCHEMA_VERSION
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LessonInteractionValidationError(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function requireExactKeys(record: Record<string, unknown>, allowed: string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) throw new LessonInteractionValidationError(`${label} contains unsupported fields: ${unexpected.join(', ')}.`)
  const missing = allowed.filter((key) => record[key] === undefined)
  if (missing.length > 0) throw new LessonInteractionValidationError(`${label} is missing required fields: ${missing.join(', ')}.`)
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || value === '.' || value === '..') {
    throw new LessonInteractionValidationError(`${label} must be a safe stable identifier.`)
  }
  return value
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new LessonInteractionValidationError(`${label} must be a lowercase SHA-256 digest.`)
  return value
}

function requireIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO.test(value) || new Date(value).toISOString() !== value) {
    throw new LessonInteractionValidationError(`${label} must be an ISO timestamp.`)
  }
  return value
}

function requireAttempt(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new LessonInteractionValidationError('Evidence attempt must be a positive integer.')
  return value as number
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new LessonInteractionValidationError(`${label} must be boolean.`)
  return value
}

function requireResponseKind(value: unknown): LearnerResponseKind {
  return requireOneOf(value, [...RESPONSE_KINDS] as LearnerResponseKind[], 'Learner response kind')
}

function requireUniqueIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new LessonInteractionValidationError(`${label} must be an array.`)
  const ids = value.map((item) => requireId(item, label))
  if (new Set(ids).size !== ids.length) throw new LessonInteractionValidationError(`${label} must be unique.`)
  return ids
}

function requireOneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new LessonInteractionValidationError(`${label} is unsupported.`)
  return value as T
}
