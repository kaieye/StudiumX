import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { ErrorCodes, parse, type DefaultTreeAdapterTypes, type ParserError } from 'parse5'

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
  const parseErrors: ParserError[] = []
  let document: DefaultTreeAdapterTypes.Document
  try {
    document = parse(html, {
      sourceCodeLocationInfo: true,
      onParseError: (error) => parseErrors.push(error)
    })
  } catch {
    return null
  }
  // Canonical lessons must be standards-mode so their selector semantics stay stable.
  if (document.mode !== 'no-quirks') return null
  if (!isStaticCanonicalLessonArtifact(document)) return null

  const cards = documentOrderElements(document).filter(isQuizCard)
  if (cards.some((card) => !hasCompleteSourceLocation(card) || isNestedQuizCard(card))) return null
  return cards.map((card, index) => parseQuizCard(`quiz-${index + 1}`, card, parseErrors))
}

const ACTIVE_CANONICAL_ELEMENT_NAMES = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'fencedframe',
  'object',
  'embed',
  'applet',
  'portal',
  'base',
  'template',
  'animate',
  'animatemotion',
  'animatetransform',
  'set'
])

function isStaticCanonicalLessonArtifact(document: DefaultTreeAdapterTypes.Document): boolean {
  return artifactElements(document).every((element) => !hasActiveCanonicalContent(element))
}

function artifactElements(parent: HtmlParentNode): HtmlElement[] {
  const elements: HtmlElement[] = []
  for (const child of parent.childNodes) {
    if (!isHtmlElement(child)) continue
    elements.push(child)
    elements.push(...artifactElements(child))
    if (isTemplateElement(child)) elements.push(...artifactElements(child.content))
  }
  return elements
}

function hasActiveCanonicalContent(element: HtmlElement): boolean {
  const tagName = element.tagName.toLowerCase()
  if (ACTIVE_CANONICAL_ELEMENT_NAMES.has(tagName) || tagName.includes('-')) return true
  if (tagName === 'meta' && attributeValue(element, 'http-equiv') !== undefined) return true
  return element.attrs.some((attribute) => isActiveCanonicalAttribute(attribute.name, attribute.value))
}

function isTemplateElement(element: HtmlElement): element is DefaultTreeAdapterTypes.Template {
  return element.tagName === 'template' && 'content' in element
}

function isActiveCanonicalAttribute(name: string, value: string): boolean {
  const normalizedName = name.toLowerCase()
  return normalizedName.startsWith('on') ||
    normalizedName === 'is' ||
    (isPotentialUrlAttribute(normalizedName) && isJavaScriptUrl(value))
}

function isPotentialUrlAttribute(name: string): boolean {
  return name === 'href' ||
    name === 'src' ||
    name === 'action' ||
    name === 'formaction' ||
    name === 'data' ||
    name === 'background' ||
    name === 'cite' ||
    name === 'codebase' ||
    name === 'manifest' ||
    name === 'poster' ||
    name === 'profile' ||
    name === 'usemap' ||
    name === 'longdesc' ||
    name === 'archive' ||
    name === 'classid'
}

function isJavaScriptUrl(value: string): boolean {
  let normalized = ''
  for (const character of value) {
    if (character.charCodeAt(0) <= 32) continue
    normalized += character
  }
  return normalized.toLowerCase().startsWith('javascript:')
}

function parseQuizCard(itemId: string, card: HtmlElement, parseErrors: readonly ParserError[]): CanonicalQuiz {
  if (hasRelevantParseError(card, parseErrors)) {
    return malformedQuiz(itemId)
  }

  const type = attributeValue(card, 'data-type')
  const choiceIds = parseChoiceIds(card)
  if (type === 'fill') return { itemId, type: 'fill', answerIds: null, choiceIds }
  if (type !== 'single' && type !== 'multi' && type !== 'truefalse') return malformedQuiz(itemId)

  const answerIds = parseAnswerIds(attributeValue(card, 'data-answer'))
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
  ) return malformedQuiz(itemId)
  return { itemId, type, answerIds, choiceIds }
}

function malformedQuiz(itemId: string): CanonicalQuiz {
  return { itemId, type: null, answerIds: null, choiceIds: null }
}

function parseChoiceIds(card: HtmlElement): string[] | null {
  const ids: string[] = []
  for (const element of documentOrderDescendantElements(card)) {
    if (element.tagName !== 'button') continue
    const choice = attributeValue(element, 'data-choice')
    if (choice === undefined) continue
    if (!hasCompleteSourceLocation(element) || !isSafeOptionId(choice) || ids.includes(choice)) return null
    ids.push(choice)
  }
  return ids.length > 0 ? ids : null
}

function documentOrderElements(parent: HtmlParentNode): HtmlElement[] {
  const elements: HtmlElement[] = []
  for (const child of parent.childNodes) {
    if (!isHtmlElement(child)) continue
    elements.push(child)
    elements.push(...documentOrderElements(child))
  }
  return elements
}

function documentOrderDescendantElements(element: HtmlElement): HtmlElement[] {
  return documentOrderElements(element)
}

function isHtmlElement(node: DefaultTreeAdapterTypes.Node): node is HtmlElement {
  return 'tagName' in node
}

function isQuizCard(element: HtmlElement): boolean {
  return classTokens(attributeValue(element, 'class')).includes('quiz-card')
}

function isNestedQuizCard(card: HtmlElement): boolean {
  let parent = card.parentNode
  while (parent) {
    if (isHtmlElement(parent) && isQuizCard(parent)) return true
    parent = isHtmlElement(parent) ? parent.parentNode : null
  }
  return false
}

function attributeValue(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value
}

function classTokens(value: string | undefined): string[] {
  if (!value) return []
  const tokens: string[] = []
  let token = ''
  for (const character of value) {
    if (isHtmlWhitespace(character)) {
      if (token) tokens.push(token)
      token = ''
      continue
    }
    token += character
  }
  if (token) tokens.push(token)
  return tokens
}

function isHtmlWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f'
}

function isSafeOptionId(value: string): boolean {
  if (!value || !isAsciiAlphaNumeric(value.charCodeAt(0))) return false
  for (let index = 1; index < value.length; index += 1) {
    const character = value.charCodeAt(index)
    if (!isAsciiAlphaNumeric(character) && character !== 46 && character !== 45 && character !== 95) return false
  }
  return true
}

function isAsciiAlphaNumeric(character: number): boolean {
  return (
    (character >= 48 && character <= 57) ||
    (character >= 65 && character <= 90) ||
    (character >= 97 && character <= 122)
  )
}

function hasCompleteSourceLocation(element: HtmlElement): boolean {
  const location = element.sourceCodeLocation
  return Boolean(location?.startTag && location.endTag)
}

function hasRelevantParseError(card: HtmlElement, parseErrors: readonly ParserError[]): boolean {
  const location = card.sourceCodeLocation
  if (!location) return true
  return parseErrors.some((error) => (
    error.code !== ErrorCodes.missingDoctype &&
    error.startOffset >= location.startOffset &&
    error.startOffset < location.endOffset
  ))
}

type HtmlElement = DefaultTreeAdapterTypes.Element
type HtmlParentNode = DefaultTreeAdapterTypes.Document | DefaultTreeAdapterTypes.DocumentFragment | HtmlElement | DefaultTreeAdapterTypes.Template

function parseAnswerIds(value: string | undefined): string[] | null {
  if (!value) return null
  const ids = value.split(',')
  if (ids.length === 0 || ids.some((id) => !isSafeOptionId(id)) || new Set(ids).size !== ids.length) return null
  return ids
}

function isValidSelection(selected: string[], choices: string[], type: 'single' | 'multi' | 'truefalse'): boolean {
  if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length) return false
  if ((type === 'single' || type === 'truefalse') && selected.length !== 1) return false
  return selected.every((value) => isSafeOptionId(value) && choices.includes(value))
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}
