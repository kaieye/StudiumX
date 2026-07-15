import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { parse, type DefaultTreeAdapterTypes } from 'parse5'

import { readContainedRegularFileBounded } from './path-access'
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
  | 'missing_assessment'
  | 'digest_mismatch'
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
  const assessment = lesson.assessment
  if (!assessment) return base({ relativePath: null, sha256: null, status: 'missing_assessment' })

  let relativePath: string
  try {
    relativePath = requireSafeTeachingRelativePath(assessment.relativePath, 'Assessment artifact path')
  } catch {
    return base({ relativePath: assessment.relativePath, sha256: null, status: 'unsafe_path' })
  }
  if (!isCanonicalAssessmentHtmlPath(relativePath)) {
    return base({ relativePath, sha256: null, status: 'not_html' })
  }
  if (!isSha256(assessment.contentSha256)) {
    return base({ relativePath, sha256: null, status: 'unparseable' })
  }

  let content: Buffer
  try {
    const boundedRead = await readContainedRegularFileBounded(
      input.workspaceRoot,
      join(input.workspaceRoot, ...relativePath.split('/')),
      MAX_CANONICAL_ARTIFACT_BYTES
    )
    if (boundedRead.status === 'over_limit') {
      return base({ relativePath, sha256: null, status: 'unparseable' })
    }
    content = boundedRead.content
  } catch {
    return base({ relativePath, sha256: null, status: 'unreadable' })
  }

  const sha256 = createHash('sha256').update(content).digest('hex')
  if (sha256 !== assessment.contentSha256) return base({ relativePath, sha256, status: 'digest_mismatch' })
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
  const verifiedByItem = new Map<string, VerifiedAttempt[]>()
  for (const assessment of [...assessments].sort(compareAssessments)) {
    if (assessment.disposition === 'ignored') continue
    const verified: VerifiedAttempt = { ...assessment, disposition: assessment.disposition }
    const attempts = verifiedByItem.get(verified.itemId) ?? []
    attempts.push(verified)
    verifiedByItem.set(verified.itemId, attempts)
  }

  const latest: VerifiedAttempt[] = []
  const correctionOrigins: VerifiedAttempt[] = []
  for (const attempts of verifiedByItem.values()) {
    const latestAttempt = attempts.at(-1)!
    latest.push(latestAttempt)
    if (latestAttempt.disposition !== 'verified_correct') continue
    const firstIncorrect = attempts.find((attempt) => attempt.disposition === 'verified_incorrect')
    if (firstIncorrect) correctionOrigins.push(firstIncorrect)
  }

  const trusted = latest.sort(compareAssessments)
  const correctionProvenance = [...new Map(
    [...correctionOrigins, ...trusted].map((assessment) => [assessment.eventId, assessment])
  ).values()].sort(compareAssessments)
  const hasIncorrect = trusted.some((assessment) => assessment.disposition === 'verified_incorrect')
  const hasCorrectedMisconception = correctionOrigins.length > 0
  const mastery = artifact.status === 'verified' && trusted.length > 0 && !hasIncorrect
  return {
    schemaVersion: LEARNING_OUTCOME_EVALUATION_SCHEMA_VERSION,
    sessionId,
    kind: mastery
      ? hasCorrectedMisconception ? 'misconception_corrected' : 'established'
      : hasIncorrect ? 'needs_practice' : 'not_evidenced',
    mastery,
    evidenceEventIds: (hasCorrectedMisconception ? correctionProvenance : trusted).map((assessment) => assessment.eventId),
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

function isCanonicalAssessmentHtmlPath(relativePath: string): boolean {
  return (relativePath.startsWith('courses/') || relativePath.startsWith('lessons/')) && relativePath.endsWith('-assessment.html')
}

function isSha256(value: string): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

const MAX_CANONICAL_ARTIFACT_BYTES = 512 * 1024
const MAX_CANONICAL_ARTIFACT_ELEMENTS = 4_096
const MAX_CANONICAL_ARTIFACT_DEPTH = 512

function parseCanonicalQuizzes(html: string): CanonicalQuiz[] | null {
  try {
    if (Buffer.byteLength(html, 'utf8') > MAX_CANONICAL_ARTIFACT_BYTES) return null

    const parseErrors: true[] = []
    const document = parse(html, {
      sourceCodeLocationInfo: true,
      onParseError: () => {
        if (parseErrors.length === 0) parseErrors.push(true)
      }
    })
    if (parseErrors.length > 0) return null
    // Canonical assessments must be standards-mode so their DOM grammar is stable.
    if (document.mode !== 'no-quirks') return null
    if (!documentOrderElements(document)) return null

    return parseStaticAssessmentDocument(document)
  } catch {
    return null
  }
}

/**
 * Positive grammar for the publisher-owned assessment sidecar. The evaluator
 * does not accept a general "safe HTML" subset: every element, attribute, and
 * card layout must be one that renderAssessmentHtmlFromPlan emits.
 */
function parseStaticAssessmentDocument(document: DefaultTreeAdapterTypes.Document): CanonicalQuiz[] | null {
  const documentNodes = document.childNodes.filter((node) => !isWhitespaceTextNode(node))
  if (documentNodes.length !== 2 || !isHtmlDoctype(documentNodes[0]) || !isHtmlElement(documentNodes[1])) return null

  const html = documentNodes[1]
  if (!hasCompleteSourceLocation(html) || html.tagName !== 'html' || !hasExactAttributes(html, { lang: 'zh-CN' })) return null
  const htmlChildren = exactElementChildren(html)
  if (!htmlChildren || htmlChildren.length !== 2 || htmlChildren[0]!.tagName !== 'head' || htmlChildren[1]!.tagName !== 'body') return null

  const [head, body] = htmlChildren
  if (!head || !body || !hasCompleteSourceLocation(head) || !hasCompleteSourceLocation(body)) return null
  if (!hasExactAttributes(head, {}) || !hasExactAttributes(body, {})) return null

  const headChildren = exactElementChildren(head)
  if (!headChildren || headChildren.length !== 2 || headChildren[0]!.tagName !== 'title' || headChildren[1]!.tagName !== 'meta') return null
  if (!isTextLeaf(headChildren[0]!, {})) return null
  if (!isVoidElement(headChildren[1]!, 'meta', { name: 'studiumx-artifact-kind', content: 'assessment-sidecar' })) return null

  const bodyChildren = exactElementChildren(body)
  if (!bodyChildren || bodyChildren.length !== 1 || bodyChildren[0]!.tagName !== 'section') return null
  const section = bodyChildren[0]
  if (!section || !hasCompleteSourceLocation(section) || !hasExactAttributes(section, { class: 'practice' })) return null

  const sectionChildren = exactElementChildren(section)
  if (!sectionChildren || sectionChildren.length < 1 || sectionChildren[0]!.tagName !== 'h1') return null
  if (!isTextLeaf(sectionChildren[0]!, {})) return null

  const cards = sectionChildren.slice(1)
  if (cards.length > 5 || cards.some((card) => card.tagName !== 'article')) return null
  const quizzes: CanonicalQuiz[] = []
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    if (!card) return null
    const itemId = `quiz-${index + 1}`
    if (!isStaticAssessmentCard(card, itemId)) return null
    quizzes.push(parseQuizCard(itemId, card))
  }
  return quizzes
}

function isStaticAssessmentCard(card: HtmlElement, itemId: string): boolean {
  if (!hasCompleteSourceLocation(card) || !hasExactAttributes(card, {
    class: 'quiz-card',
    'data-item-id': itemId,
    'data-type': isAssessmentQuizType,
    'data-answer': () => true
  })) return false

  const type = attributeValue(card, 'data-type')
  const children = exactElementChildren(card)
  if (!children || children.length !== 4) return false
  const [question, response, output, explanation] = children
  if (!question || !response || !output || !explanation) return false
  if (!isTextLeaf(question, {}) || question.tagName !== 'p') return false
  if (!isEmptyElement(output, 'output', { 'aria-live': 'polite' })) return false
  if (!isTextLeaf(explanation, { class: 'quiz-explanation' }) || explanation.tagName !== 'p') return false

  if (type === 'fill') return isStaticFillResponse(response)
  return isStaticChoiceResponse(response, type)
}

function isStaticChoiceResponse(response: HtmlElement, type: string | undefined): boolean {
  if (type !== 'single' && type !== 'multi' && type !== 'truefalse') return false
  if (!hasCompleteSourceLocation(response) || response.tagName !== 'div' || !hasExactAttributes(response, { class: 'quiz-choices' })) return false

  const choices = exactElementChildren(response)
  if (!choices || choices.length === 0 || choices.length > 6) return false
  if (type === 'truefalse' && choices.length !== 2) return false

  for (let index = 0; index < choices.length; index += 1) {
    const button = choices[index]
    if (!button || !isTextLeaf(button, {
      type: 'button',
      'data-choice': type === 'truefalse'
        ? (index === 0 ? 'true' : 'false')
        : letterForChoice(index)
    }) || button.tagName !== 'button') return false
  }
  return true
}

function isStaticFillResponse(response: HtmlElement): boolean {
  if (!hasCompleteSourceLocation(response) || response.tagName !== 'div' || !hasExactAttributes(response, { class: 'quiz-fill' })) return false
  const children = exactElementChildren(response)
  if (!children || children.length !== 2) return false
  const [input, button] = children
  return Boolean(
    input && button &&
    isVoidElement(input, 'input', {
      type: 'text',
      placeholder: '输入你的答案',
      'aria-label': '答案输入'
    }) &&
    isTextLeaf(button, { type: 'button', 'data-choice': 'submit' }) &&
    button.tagName === 'button' &&
    directText(button) === '提交'
  )
}

function isAssessmentQuizType(value: string): boolean {
  return value === 'single' || value === 'multi' || value === 'truefalse' || value === 'fill'
}

function letterForChoice(index: number): string {
  return String.fromCharCode(97 + index)
}

type ExactAttributeValue = string | ((value: string) => boolean)

function hasExactAttributes(element: HtmlElement, expected: Record<string, ExactAttributeValue>): boolean {
  const entries = Object.entries(expected)
  if (element.attrs.length !== entries.length) return false
  return entries.every(([name, expectedValue]) => {
    const value = attributeValue(element, name)
    return value !== undefined && (typeof expectedValue === 'string' ? value === expectedValue : expectedValue(value))
  })
}

function exactElementChildren(parent: HtmlParentNode): HtmlElement[] | null {
  const elements: HtmlElement[] = []
  for (const child of parent.childNodes) {
    if (isHtmlElement(child)) {
      elements.push(child)
      continue
    }
    if (!isWhitespaceTextNode(child)) return null
  }
  return elements
}

function isTextLeaf(element: HtmlElement, expectedAttributes: Record<string, ExactAttributeValue>): boolean {
  return hasCompleteSourceLocation(element) && hasExactAttributes(element, expectedAttributes) &&
    element.childNodes.every((child) => isTextNode(child))
}

function isEmptyElement(element: HtmlElement, tagName: string, expectedAttributes: Record<string, ExactAttributeValue>): boolean {
  return hasCompleteSourceLocation(element) && element.tagName === tagName &&
    hasExactAttributes(element, expectedAttributes) && element.childNodes.length === 0
}

function isVoidElement(element: HtmlElement, tagName: string, expectedAttributes: Record<string, ExactAttributeValue>): boolean {
  const location = element.sourceCodeLocation
  return Boolean(location?.startTag) && !location?.endTag && element.tagName === tagName &&
    hasExactAttributes(element, expectedAttributes) && element.childNodes.length === 0
}

function directText(element: HtmlElement): string {
  return element.childNodes.map((child) => isTextNode(child) ? child.value : '').join('')
}

function isTextNode(node: DefaultTreeAdapterTypes.Node): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text'
}

function isWhitespaceTextNode(node: DefaultTreeAdapterTypes.Node): boolean {
  return isTextNode(node) && /^\s*$/.test(node.value)
}

function isHtmlDoctype(node: DefaultTreeAdapterTypes.Node): boolean {
  return node.nodeName === '#documentType' &&
    'name' in node && node.name === 'html' &&
    'publicId' in node && node.publicId === '' &&
    'systemId' in node && node.systemId === ''
}

function documentOrderElements(parent: HtmlParentNode): HtmlElement[] | null {
  const elements: HtmlElement[] = []
  const stack: PendingElement[] = []
  pushChildElements(stack, parent, 1)

  while (stack.length > 0) {
    const pending = stack.pop()
    if (!pending) return null
    if (pending.depth > MAX_CANONICAL_ARTIFACT_DEPTH || elements.length >= MAX_CANONICAL_ARTIFACT_ELEMENTS) return null

    const element = pending.element
    elements.push(element)
    pushChildElements(stack, element, pending.depth + 1)
  }

  return elements
}

function pushChildElements(stack: PendingElement[], parent: HtmlParentNode, depth: number): void {
  for (let index = parent.childNodes.length - 1; index >= 0; index -= 1) {
    const child = parent.childNodes[index]
    if (child && isHtmlElement(child)) stack.push({ element: child, depth })
  }
}

function parseQuizCard(itemId: string, card: HtmlElement): CanonicalQuiz {
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
  const elements = documentOrderDescendantElements(card)
  if (!elements) return null

  const ids: string[] = []
  for (const element of elements) {
    if (element.tagName !== 'button') continue
    const choice = attributeValue(element, 'data-choice')
    if (choice === undefined) continue
    if (!hasCompleteSourceLocation(element) || !isSafeOptionId(choice) || ids.includes(choice)) return null
    ids.push(choice)
  }
  return ids.length > 0 ? ids : null
}

function documentOrderDescendantElements(element: HtmlElement): HtmlElement[] | null {
  return documentOrderElements(element)
}

function isHtmlElement(node: DefaultTreeAdapterTypes.Node): node is HtmlElement {
  return 'tagName' in node
}

function attributeValue(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value
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

type HtmlElement = DefaultTreeAdapterTypes.Element
type HtmlParentNode = DefaultTreeAdapterTypes.Document | DefaultTreeAdapterTypes.DocumentFragment | HtmlElement | DefaultTreeAdapterTypes.Template
type PendingElement = { element: HtmlElement, depth: number }

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
