import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { readContainedRegularFile } from './path-access'
import {
  lessonInteractionLedgerKind,
  normalizeLessonInteraction,
  type LessonInteraction
} from '../shared/teaching-types/lesson-interaction'
import { requireSafeTeachingRelativePath } from '../shared/teaching-placement'
import type {
  LearningOutcomeKind,
  LearningSessionEvent,
  LearningSessionSnapshot
} from '../shared/teaching-types/learning-session'

export const LEARNING_OUTCOME_EVALUATION_SCHEMA_VERSION = 1 as const

export type LearningOutcomeArtifactStatus =
  | 'verified'
  | 'missing_lesson'
  | 'unsafe_path'
  | 'not_html'
  | 'unreadable'
  | 'unparseable'

export type LearningOutcomeEvidenceDisposition = 'verified_correct' | 'verified_incorrect' | 'ignored'

export type LearningOutcomeEvidenceReason =
  | 'verified'
  | 'artifact_digest_mismatch'
  | 'unsupported_evidence'
  | 'unknown_quiz'
  | 'unsupported_quiz_type'
  | 'malformed_answer_or_choice'
  | 'identity_mismatch'

export type LearningOutcomeEvidenceAssessment = {
  eventId: string
  sequence: number
  itemId: string
  disposition: LearningOutcomeEvidenceDisposition
  reason: LearningOutcomeEvidenceReason
}

export type LearningOutcomeEvaluation = {
  schemaVersion: typeof LEARNING_OUTCOME_EVALUATION_SCHEMA_VERSION
  sessionId: string
  kind: LearningOutcomeKind
  mastery: boolean
  evidenceEventIds: string[]
  artifact: {
    relativePath: string | null
    sha256: string | null
    status: LearningOutcomeArtifactStatus
  }
  assessments: LearningOutcomeEvidenceAssessment[]
}

export type EvaluateLearningSessionOutcomeInput = {
  workspaceRoot: string
  session: LearningSessionSnapshot
}

type CanonicalQuiz = {
  itemId: string
  type: 'single' | 'multi' | 'truefalse' | 'fill' | null
  answerIds: string[] | null
  choiceIds: string[] | null
}

type VerifiedAttempt = LearningOutcomeEvidenceAssessment & {
  disposition: 'verified_correct' | 'verified_incorrect'
}

type ParsedAttributes = {
  values: Record<string, string>
  malformed: boolean
}

const SAFE_OPTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Pure read-side P0 assessment. It has no ledger, IPC, catalog, or outcome-file
 * dependency: callers supply the durable snapshot and decide whether to settle it.
 */
export async function evaluateLearningSessionOutcome(
  input: EvaluateLearningSessionOutcomeInput
): Promise<LearningOutcomeEvaluation> {
  const base = (artifact: LearningOutcomeEvaluation['artifact'], assessments: LearningOutcomeEvidenceAssessment[] = []) =>
    finalize(input.session.id, artifact, assessments)

  const lesson = input.session.source === 'canonical' && !input.session.readOnly ? input.session.lessonRef : null
  if (!lesson) return base({ relativePath: null, sha256: null, status: 'missing_lesson' })

  let relativePath: string
  try {
    relativePath = requireSafeTeachingRelativePath(lesson.relativePath, 'Lesson path')
  } catch {
    return base({ relativePath: lesson.relativePath, sha256: null, status: 'unsafe_path' })
  }
  if (!isCanonicalLessonHtmlPath(relativePath)) {
    return base({ relativePath, sha256: null, status: 'not_html' })
  }

  let content: Buffer
  try {
    content = await readContainedRegularFile(input.workspaceRoot, join(input.workspaceRoot, ...relativePath.split('/')))
  } catch {
    return base({ relativePath, sha256: null, status: 'unreadable' })
  }

  const sha256 = createHash('sha256').update(content).digest('hex')
  const quizzes = parseCanonicalQuizzes(content.toString('utf8'))
  if (!quizzes) return base({ relativePath, sha256, status: 'unparseable' })

  const assessments = sortedEvents(input.session.events).flatMap((event) => {
    const interaction = interactionForEvent(input.session, event)
    if (!interaction) return []
    return [assessInteraction(event, interaction, input.session, sha256, quizzes)]
  })
  return finalize(input.session.id, { relativePath, sha256, status: 'verified' }, assessments)
}

function finalize(
  sessionId: string,
  artifact: LearningOutcomeEvaluation['artifact'],
  assessments: LearningOutcomeEvidenceAssessment[]
): LearningOutcomeEvaluation {
  const latestByItem = new Map<string, VerifiedAttempt>()
  for (const assessment of assessments) {
    if (assessment.disposition === 'ignored') continue
    const verified: VerifiedAttempt = { ...assessment, disposition: assessment.disposition }
    latestByItem.set(assessment.itemId, verified)
  }
  const trusted = [...latestByItem.values()].sort(compareAssessments)
  const hasIncorrect = trusted.some((assessment) => assessment.disposition === 'verified_incorrect')
  const mastery = artifact.status === 'verified' && trusted.length > 0 && !hasIncorrect
  return {
    schemaVersion: LEARNING_OUTCOME_EVALUATION_SCHEMA_VERSION,
    sessionId,
    kind: mastery ? 'established' : hasIncorrect ? 'needs_practice' : 'not_evidenced',
    mastery,
    evidenceEventIds: trusted.map((assessment) => assessment.eventId),
    artifact,
    assessments: [...assessments].sort(compareAssessments)
  }
}

function interactionForEvent(_session: LearningSessionSnapshot, event: LearningSessionEvent): LessonInteraction | null {
  try {
    return normalizeLessonInteraction(event.payload.lessonInteraction)
  } catch {
    return null
  }
}

function assessInteraction(
  event: LearningSessionEvent,
  interaction: LessonInteraction,
  session: LearningSessionSnapshot,
  artifactDigest: string,
  quizzes: CanonicalQuiz[]
): LearningOutcomeEvidenceAssessment {
  const ignored = (reason: LearningOutcomeEvidenceReason): LearningOutcomeEvidenceAssessment => ({
    eventId: event.eventId,
    sequence: event.sequence,
    itemId: interaction.itemId,
    disposition: 'ignored',
    reason
  })
  if (
    event.eventId !== interaction.eventId ||
    event.sessionId !== session.id ||
    event.kind !== lessonInteractionLedgerKind(interaction) ||
    interaction.workspaceId !== session.workspaceId ||
    interaction.courseId !== session.courseRef.courseId ||
    interaction.sessionId !== session.id ||
    interaction.lessonId !== session.lessonRef?.lessonId
  ) return ignored('identity_mismatch')
  if (interaction.kind !== 'quiz_answered') return ignored('unsupported_evidence')
  if (interaction.artifactDigest !== artifactDigest) return ignored('artifact_digest_mismatch')

  const quiz = quizzes.find((candidate) => candidate.itemId === interaction.itemId)
  if (!quiz) return ignored('unknown_quiz')
  if (quiz.type === 'fill' || quiz.type === null) return ignored(quiz.type === 'fill' ? 'unsupported_quiz_type' : 'malformed_answer_or_choice')
  if (!quiz.answerIds || !quiz.choiceIds || !isValidSelection(interaction.selectedOptionIds, quiz.choiceIds, quiz.type)) {
    return ignored('malformed_answer_or_choice')
  }

  return {
    eventId: event.eventId,
    sequence: event.sequence,
    itemId: interaction.itemId,
    disposition: sameIds(interaction.selectedOptionIds, quiz.answerIds) ? 'verified_correct' : 'verified_incorrect',
    reason: 'verified'
  }
}

function sortedEvents(events: readonly LearningSessionEvent[]): LearningSessionEvent[] {
  return [...events].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId))
}

function compareAssessments(left: LearningOutcomeEvidenceAssessment, right: LearningOutcomeEvidenceAssessment): number {
  return left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)
}

function isCanonicalLessonHtmlPath(relativePath: string): boolean {
  return (relativePath.startsWith('courses/') || relativePath.startsWith('lessons/')) && relativePath.endsWith('.html')
}

function parseCanonicalQuizzes(html: string): CanonicalQuiz[] | null {
  const cards: CanonicalQuiz[] = []
  const openingTag = /<article\b([^>]*)>/gi
  let match: RegExpExecArray | null
  while ((match = openingTag.exec(html))) {
    const attributes = parseAttributes(match[1]!)
    if (!hasClass(attributes.values.class, 'quiz-card')) continue
    const end = html.toLowerCase().indexOf('</article', openingTag.lastIndex)
    if (end < 0) return null
    const itemId = `quiz-${cards.length + 1}`
    cards.push(parseQuizCard(itemId, attributes, html.slice(openingTag.lastIndex, end)))
  }
  return cards
}

function parseQuizCard(itemId: string, attributes: ParsedAttributes, content: string): CanonicalQuiz {
  if (attributes.malformed) return { itemId, type: null, answerIds: null, choiceIds: null }
  const type = attributes.values['data-type']
  const choiceIds = parseChoiceIds(content)
  if (type === 'fill') return { itemId, type: 'fill', answerIds: null, choiceIds }
  if (type !== 'single' && type !== 'multi' && type !== 'truefalse') return { itemId, type: null, answerIds: null, choiceIds }

  const answerIds = parseAnswerIds(attributes.values['data-answer'])
  if (
    !answerIds ||
    !choiceIds ||
    (type !== 'multi' && answerIds.length !== 1) ||
    answerIds.some((answer) => !choiceIds.includes(answer)) ||
    (type === 'truefalse' && (
      (answerIds[0] !== 'true' && answerIds[0] !== 'false') ||
      choiceIds.length !== 2 ||
      !choiceIds.includes('true') ||
      !choiceIds.includes('false')
    ))
  ) return { itemId, type: null, answerIds: null, choiceIds: null }
  return { itemId, type, answerIds, choiceIds }
}

function parseChoiceIds(content: string): string[] | null {
  const ids: string[] = []
  const button = /<button\b([^>]*)>/gi
  let match: RegExpExecArray | null
  while ((match = button.exec(content))) {
    const attributes = parseAttributes(match[1]!)
    if (attributes.malformed) return null
    const choice = attributes.values['data-choice']
    if (choice === undefined) continue
    if (!SAFE_OPTION_ID.test(choice) || ids.includes(choice)) return null
    ids.push(choice)
  }
  return ids.length > 0 ? ids : null
}

function parseAnswerIds(value: string | undefined): string[] | null {
  if (!value) return null
  const ids = value.split(',')
  if (ids.length === 0 || ids.some((id) => !SAFE_OPTION_ID.test(id)) || new Set(ids).size !== ids.length) return null
  return ids
}

function parseAttributes(source: string): ParsedAttributes {
  const values: Record<string, string> = {}
  let malformed = false
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const name = match[1]!.toLowerCase()
    if (Object.hasOwn(values, name)) {
      malformed = true
      continue
    }
    values[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return { values, malformed }
}

function hasClass(value: string | undefined, expected: string): boolean {
  return value?.split(/\s+/).includes(expected) ?? false
}

function isValidSelection(selected: string[], choices: string[], type: 'single' | 'multi' | 'truefalse'): boolean {
  if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length) return false
  if ((type === 'single' || type === 'truefalse') && selected.length !== 1) return false
  return selected.every((value) => SAFE_OPTION_ID.test(value) && choices.includes(value))
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}
