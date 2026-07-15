import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { CanonicalLearningSessionSnapshot } from '../../src/shared/teaching-types/learning-session'
import { evaluateLearningSessionOutcome } from '../../src/main/learning-outcome-evaluator'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-outcome-evaluator-unit-'))
  roots.push(root)
  return root
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function snapshot(digest: string, selectedOptionIds = ['b']): CanonicalLearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-1',
    workspaceId: 'workspace-1',
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: 2,
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:01.000Z',
    completedAt: null,
    courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
    lessonRef: { lessonId: 'lesson-1', title: 'Evidence', relativePath: 'courses/foundations/lesson-1.html' },
    conversationRefs: [],
    eventCount: 1,
    outcomeRef: null,
    events: [{
      schemaVersion: 1,
      eventId: 'quiz-event-1',
      sessionId: 'session-1',
      kind: 'quiz_attempted',
      occurredAt: '2026-07-15T12:00:01.000Z',
      sequence: 1,
      recordedAt: '2026-07-15T12:00:02.000Z',
      payload: {
        lessonInteraction: {
          schemaVersion: 1,
          eventId: 'quiz-event-1',
          kind: 'quiz_answered',
          workspaceId: 'workspace-1',
          courseId: 'course-1',
          sessionId: 'session-1',
          lessonId: 'lesson-1',
          itemId: 'quiz-1',
          attempt: 1,
          observedAt: '2026-07-15T12:00:01.000Z',
          artifactDigest: digest,
          surface: 'lesson_preview',
          selectedOptionIds,
          correct: false
        }
      }
    }]
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningOutcomeEvaluator', () => {
  it('verifies a canonical correct selection from durable evidence and the artifact answer key', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html)) })

    expect(result).toMatchObject({
      kind: 'established',
      mastery: true,
      evidenceEventIds: ['quiz-event-1'],
      artifact: { status: 'verified', sha256: sha256(html) },
      assessments: [{ eventId: 'quiz-event-1', sequence: 1, disposition: 'verified_correct' }]
    })
  })

  it('fails closed for a no-doctype normal quiz artifact', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html)) })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      artifact: { status: 'unparseable', sha256: sha256(html) },
      assessments: []
    })
  })

  it('does not remap two no-doctype quirks-mode quiz cards when the first class is uppercase', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<article class="QUIZ-CARD" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article><article class="quiz-card" data-type="single" data-answer="a"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html), ['a']) })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      artifact: { status: 'unparseable', sha256: sha256(html) },
      assessments: []
    })
  })

  it('ignores malformed truefalse answer keys rather than treating matching forged selections as mastery', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="truefalse" data-answer="maybe"><button data-choice="maybe">Maybe</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html), ['maybe']) })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      assessments: [{ disposition: 'ignored', reason: 'malformed_answer_or_choice' }]
    })
  })

  it('recomputes wrong selections and ignores the renderer-provided correct claim', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')
    const session = snapshot(sha256(html), ['a'])
    ;((session.events[0]!.payload.lessonInteraction as { correct: boolean }).correct) = true

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session })

    expect(result).toMatchObject({
      kind: 'needs_practice',
      mastery: false,
      evidenceEventIds: ['quiz-event-1'],
      assessments: [{ disposition: 'verified_incorrect', reason: 'verified' }]
    })
  })

  it('does not accept otherwise-correct evidence whose digest differs from the canonical lesson bytes', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot('c'.repeat(64)) })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      artifact: { status: 'verified', sha256: sha256(html) },
      assessments: [{ disposition: 'ignored', reason: 'artifact_digest_mismatch' }]
    })
  })

  it('does not turn fill or retrieval-only durable facts into mastery', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="fill" data-answer="answer"><input type="text"><button data-choice="submit">Submit</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')
    const session = snapshot(sha256(html), ['submit'])
    const event = session.events[0]!
    event.kind = 'retrieval_attempted'
    event.payload.lessonInteraction = {
      schemaVersion: 1,
      eventId: event.eventId,
      kind: 'retrieval_response_submitted',
      workspaceId: 'workspace-1',
      courseId: 'course-1',
      sessionId: 'session-1',
      lessonId: 'lesson-1',
      itemId: 'quiz-1',
      attempt: 1,
      observedAt: event.occurredAt,
      artifactDigest: sha256(html),
      surface: 'lesson_preview',
      responseDigest: 'd'.repeat(64),
      responseKind: 'short_answer'
    }

    const retrievalResult = await evaluateLearningSessionOutcome({ workspaceRoot: root, session })

    expect(retrievalResult).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      assessments: [{ disposition: 'ignored', reason: 'unsupported_evidence' }]
    })

    const fillResult = await evaluateLearningSessionOutcome({
      workspaceRoot: root,
      session: snapshot(sha256(html), ['submit'])
    })
    expect(fillResult).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      assessments: [{ disposition: 'ignored', reason: 'unsupported_quiz_type' }]
    })
  })

  it('ignores unknown quiz item IDs even when their claimed result is correct', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')
    const session = snapshot(sha256(html))
    ;((session.events[0]!.payload.lessonInteraction as { itemId: string }).itemId) = 'quiz-unknown'

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      assessments: [{ disposition: 'ignored', reason: 'unknown_quiz' }]
    })
  })

  it('uses durable sequence rather than renderer timestamps when selecting the latest attempt per quiz', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')
    const first = snapshot(sha256(html)).events[0]!
    first.eventId = 'quiz-event-first'
    first.sequence = 1
    first.occurredAt = '2026-07-15T12:00:10.000Z'
    ;((first.payload.lessonInteraction as { eventId: string; observedAt: string }).eventId) = first.eventId
    ;((first.payload.lessonInteraction as { observedAt: string }).observedAt) = first.occurredAt
    const second = structuredClone(first)
    second.eventId = 'quiz-event-second'
    second.sequence = 2
    second.occurredAt = '2026-07-15T12:00:00.000Z'
    ;((second.payload.lessonInteraction as { eventId: string; observedAt: string; selectedOptionIds: string[] }).eventId) = second.eventId
    ;((second.payload.lessonInteraction as { observedAt: string; selectedOptionIds: string[] }).observedAt) = second.occurredAt
    ;((second.payload.lessonInteraction as { selectedOptionIds: string[] }).selectedOptionIds) = ['a']
    const session = snapshot(sha256(html))
    session.events = [second, first]
    session.eventCount = 2

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session })

    expect(result).toMatchObject({
      kind: 'needs_practice',
      mastery: false,
      evidenceEventIds: ['quiz-event-second'],
      assessments: [
        { eventId: 'quiz-event-first', sequence: 1, disposition: 'verified_correct' },
        { eventId: 'quiz-event-second', sequence: 2, disposition: 'verified_incorrect' }
      ]
    })
  })

  it('returns a deeply equal result for repeated evaluation of identical durable facts', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="multi" data-answer="a,c"><button data-choice="a">A</button><button data-choice="b">B</button><button data-choice="c">C</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')
    const session = snapshot(sha256(html), ['c', 'a'])

    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session })).resolves.toEqual(
      await evaluateLearningSessionOutcome({ workspaceRoot: root, session })
    )
  })

  it('fails closed for markdown, out-of-scope paths, and lesson files reached through a symlink or junction', async () => {
    const root = await workspace()
    const markdownSession = snapshot('a'.repeat(64))
    markdownSession.lessonRef = { ...markdownSession.lessonRef!, relativePath: 'lessons/lesson-1.md' }
    const unsafePathSession = snapshot('a'.repeat(64))
    unsafePathSession.lessonRef = { ...unsafePathSession.lessonRef!, relativePath: 'courses/../outside.html' }
    const outOfScopeSession = snapshot('a'.repeat(64))
    outOfScopeSession.lessonRef = { ...outOfScopeSession.lessonRef!, relativePath: 'learning-sessions/lesson-1.html' }

    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session: markdownSession })).resolves.toMatchObject({
      kind: 'not_evidenced', artifact: { status: 'not_html' }
    })
    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session: unsafePathSession })).resolves.toMatchObject({
      kind: 'not_evidenced', artifact: { status: 'unsafe_path' }
    })
    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session: outOfScopeSession })).resolves.toMatchObject({
      kind: 'not_evidenced', artifact: { status: 'not_html' }
    })

    const outside = await mkdtemp(join(tmpdir(), 'studiumx-outcome-evaluator-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'lesson-1.html'), '<article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>', 'utf8')
    await mkdir(join(root, 'courses'))
    try {
      await symlink(outside, join(root, 'courses', 'foundations'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') return
      throw error
    }

    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot('a'.repeat(64)) })).resolves.toMatchObject({
      kind: 'not_evidenced', artifact: { status: 'unreadable' }
    })
  })



  it('fails closed when a canonical HTML artifact has an unparseable quiz card', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="b">B</button>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html)) })).resolves.toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      artifact: { status: 'unparseable', sha256: sha256(html) }
    })
  })

  it('requires durable event IDs and all session bindings to agree with the persisted interaction', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')
    const session = snapshot(sha256(html))
    ;((session.events[0]!.payload.lessonInteraction as { eventId: string; courseId: string }).eventId) = 'different-event-id'
    ;((session.events[0]!.payload.lessonInteraction as { courseId: string }).courseId) = 'different-course'

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      assessments: [{ eventId: 'quiz-event-1', disposition: 'ignored', reason: 'identity_mismatch' }]
    })
  })


  it('ignores quiz cards whose answer key or option IDs require normalization to become valid', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer=" b "><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html)) })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      assessments: [{ disposition: 'ignored', reason: 'malformed_answer_or_choice' }]
    })
  })


  it('does not promote flashcard ratings or conversation response digests into mastery', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const flashcardSession = snapshot(sha256(html))
    const flashcardEvent = flashcardSession.events[0]!
    flashcardEvent.kind = 'flashcard_reviewed'
    flashcardEvent.payload.lessonInteraction = {
      schemaVersion: 1,
      eventId: flashcardEvent.eventId,
      kind: 'flashcard_rated',
      workspaceId: 'workspace-1',
      courseId: 'course-1',
      sessionId: 'session-1',
      lessonId: 'lesson-1',
      itemId: 'flashcard-1',
      attempt: 1,
      observedAt: flashcardEvent.occurredAt,
      artifactDigest: sha256(html),
      surface: 'lesson_preview',
      rating: 'good'
    }
    const conversationSession = snapshot(sha256(html))
    conversationSession.conversationRefs = [{ conversationId: 'conversation-1', relativePath: 'conversation/conversation-1.json' }]
    const conversationEvent = conversationSession.events[0]!
    conversationEvent.kind = 'learner_response_recorded'
    conversationEvent.payload.lessonInteraction = {
      schemaVersion: 1,
      eventId: conversationEvent.eventId,
      kind: 'conversation_evidence_recorded',
      workspaceId: 'workspace-1',
      courseId: 'course-1',
      sessionId: 'session-1',
      lessonId: 'lesson-1',
      itemId: 'conversation-prompt-1',
      attempt: 1,
      observedAt: conversationEvent.occurredAt,
      artifactDigest: sha256(html),
      surface: 'conversation',
      responseDigest: 'e'.repeat(64),
      responseKind: 'short_answer',
      provenance: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        author: 'learner',
        turnCreatedAt: conversationEvent.occurredAt
      }
    }

    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session: flashcardSession })).resolves.toMatchObject({
      kind: 'not_evidenced', mastery: false, assessments: [{ disposition: 'ignored', reason: 'unsupported_evidence' }]
    })
    await expect(evaluateLearningSessionOutcome({ workspaceRoot: root, session: conversationSession })).resolves.toMatchObject({
      kind: 'not_evidenced', mastery: false, assessments: [{ disposition: 'ignored', reason: 'unsupported_evidence' }]
    })
  })



  it('ignores duplicate canonical answer attributes instead of choosing one value', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="a" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html)) })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      evidenceEventIds: [],
      assessments: [{ disposition: 'ignored', reason: 'malformed_answer_or_choice' }]
    })
  })



  it('uses DOM quiz order instead of comment bait when assessing the first canonical quiz', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><!-- <article class="quiz-card" data-type="single" data-answer="a"><button data-choice="a">bait</button></article> --><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html), ['a']) })

    expect(result).toMatchObject({
      kind: 'needs_practice',
      mastery: false,
      evidenceEventIds: ['quiz-event-1'],
      assessments: [{ disposition: 'verified_incorrect', reason: 'verified' }]
    })
  })

  it('does not number script or style raw-text bait as canonical quiz cards', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = `<!doctype html><script>const bait = '<article class="quiz-card" data-type="single" data-answer="a"><button data-choice="a">bait</button></article>'</script><style>.bait::before { content: '<article class="quiz-card" data-type="single" data-answer="a">'; }</style><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>`
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html), ['a']) })

    expect(result).toMatchObject({
      kind: 'needs_practice',
      mastery: false,
      assessments: [{ itemId: 'quiz-1', disposition: 'verified_incorrect', reason: 'verified' }]
    })
  })

  it('does not let pseudo article text or a descendant attribute closing tag truncate a real quiz card', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><p data-bait="</article><article class=quiz-card data-type=single data-answer=a>">&lt;article class="quiz-card"&gt;</p><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html), ['a']) })

    expect(result).toMatchObject({
      kind: 'needs_practice',
      mastery: false,
      assessments: [{ itemId: 'quiz-1', disposition: 'verified_incorrect', reason: 'verified' }]
    })
  })

  it('uses decoded DOM attribute values for canonical answer and choice IDs', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="&#98;"><button data-choice="&#97;">A</button><button data-choice="&#98;">B</button></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html)) })

    expect(result).toMatchObject({
      kind: 'established',
      mastery: true,
      assessments: [{ itemId: 'quiz-1', disposition: 'verified_correct', reason: 'verified' }]
    })
  })

  it('fails closed for malformed nested quiz-card markup instead of deriving a mastery result', async () => {
    const root = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><article class="quiz-card" data-type="single" data-answer="a"><button data-choice="a">A</button></article></article>'
    await mkdir(join(root, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(root, ...relativePath.split('/')), html, 'utf8')

    const result = await evaluateLearningSessionOutcome({ workspaceRoot: root, session: snapshot(sha256(html), ['a']) })

    expect(result).toMatchObject({
      kind: 'not_evidenced',
      mastery: false,
      artifact: { status: 'unparseable' },
      evidenceEventIds: []
    })
  })

})
