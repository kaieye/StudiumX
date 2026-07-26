import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { evaluateLearningSessionOutcome } from '../../src/main/learning-outcome-evaluator'
import { renderAssessmentJsonFromPlan } from '../../src/main/ai/lesson-renderer'
import { fillAnswerOptionId } from '../../src/shared/fill-answer'
import { lessonPlanSchema, sanitizePlan } from '../../src/shared/lesson-schema'
import type { CanonicalLearningSessionSnapshot, LearningSessionEvent } from '../../src/shared/teaching-types/learning-session'

const NOW = '2026-07-26T12:00:00.000Z'

function sha256(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')
}

function quizEvent(input: {
  eventId: string
  sequence: number
  itemId: string
  selectedOptionIds: string[]
  correct: boolean
  observedAt: string
  artifactDigest: string
}): LearningSessionEvent {
  return {
    schemaVersion: 1,
    eventId: input.eventId,
    sessionId: 'session-1',
    kind: 'quiz_attempted',
    occurredAt: input.observedAt,
    sequence: input.sequence,
    recordedAt: input.observedAt,
    payload: {
      lessonInteraction: {
        schemaVersion: 1,
        eventId: input.eventId,
        kind: 'quiz_answered',
        workspaceId: 'workspace-1',
        courseId: 'course-1',
        sessionId: 'session-1',
        lessonId: 'lesson-1',
        itemId: input.itemId,
        attempt: 1,
        observedAt: input.observedAt,
        artifactDigest: input.artifactDigest,
        surface: 'lesson_preview',
        selectedOptionIds: input.selectedOptionIds,
        correct: input.correct
      }
    }
  } as never
}

function snapshot(input: {
  assessmentRelativePath: string
  assessmentSha256: string
  events: LearningSessionEvent[]
}): CanonicalLearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-1',
    workspaceId: 'workspace-1',
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
    lessonRef: {
      lessonId: 'lesson-1',
      title: 'Fill settlement',
      relativePath: 'lessons/0001-fill.html',
      assessment: { relativePath: input.assessmentRelativePath, contentSha256: input.assessmentSha256 }
    },
    conversationRefs: [],
    eventCount: input.events.length,
    outcomeRef: null,
    events: input.events
  } as never
}

async function workspaceWithSidecar(sidecar: string): Promise<{ root: string; digest: string; relativePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'sx-fill-eval-'))
  const relativePath = 'lessons/0001-fill-assessment.json'
  await mkdir(join(root, 'lessons'), { recursive: true })
  await writeFile(join(root, ...relativePath.split('/')), sidecar, 'utf8')
  return { root, digest: sha256(sidecar), relativePath }
}

const FILL_PRIMARY = fillAnswerOptionId('事件循环')!
const FILL_ALTERNATE = fillAnswerOptionId('event loop')!

function sidecarV2(): string {
  return `${JSON.stringify({
    schemaVersion: 2,
    kind: 'studiumx-assessment',
    quizzes: [
      { itemId: 'quiz-1', type: 'fill', answerIds: [FILL_PRIMARY, FILL_ALTERNATE], choiceIds: null },
      { itemId: 'quiz-2', type: 'single', answerIds: ['b'], choiceIds: ['a', 'b'] }
    ]
  }, null, 2)}\n`
}

describe('fill settlement via assessment sidecar v2 (ADR-0155)', () => {
  it('settles a correct fill attempt (accepted alternate) into established', async () => {
    const { root, digest, relativePath } = await workspaceWithSidecar(sidecarV2())
    const result = await evaluateLearningSessionOutcome({
      workspaceRoot: root,
      session: snapshot({
        assessmentRelativePath: relativePath,
        assessmentSha256: digest,
        events: [
          quizEvent({ eventId: 'e1', sequence: 1, itemId: 'quiz-1', selectedOptionIds: [FILL_ALTERNATE], correct: true, observedAt: '2026-07-26T01:00:00.000Z', artifactDigest: digest }),
          quizEvent({ eventId: 'e2', sequence: 2, itemId: 'quiz-2', selectedOptionIds: ['b'], correct: true, observedAt: '2026-07-26T01:01:00.000Z', artifactDigest: digest })
        ]
      })
    })

    expect(result).toMatchObject({ kind: 'established', mastery: true })
    expect(result.assessments.every((assessment) => assessment.reason === 'verified')).toBe(true)
  })

  it('tracks a wrong-then-corrected fill as misconception_corrected', async () => {
    const { root, digest, relativePath } = await workspaceWithSidecar(sidecarV2())
    const wrong = fillAnswerOptionId('宏任务')!
    const result = await evaluateLearningSessionOutcome({
      workspaceRoot: root,
      session: snapshot({
        assessmentRelativePath: relativePath,
        assessmentSha256: digest,
        events: [
          quizEvent({ eventId: 'e1', sequence: 1, itemId: 'quiz-1', selectedOptionIds: [wrong], correct: false, observedAt: '2026-07-26T01:00:00.000Z', artifactDigest: digest }),
          quizEvent({ eventId: 'e2', sequence: 2, itemId: 'quiz-1', selectedOptionIds: [FILL_PRIMARY], correct: true, observedAt: '2026-07-26T01:05:00.000Z', artifactDigest: digest }),
          quizEvent({ eventId: 'e3', sequence: 3, itemId: 'quiz-2', selectedOptionIds: ['b'], correct: true, observedAt: '2026-07-26T01:06:00.000Z', artifactDigest: digest })
        ]
      })
    })

    expect(result.kind).toBe('misconception_corrected')
  })

  it('ignores legacy submit-token fill evidence as malformed (never verified)', async () => {
    const { root, digest, relativePath } = await workspaceWithSidecar(sidecarV2())
    const result = await evaluateLearningSessionOutcome({
      workspaceRoot: root,
      session: snapshot({
        assessmentRelativePath: relativePath,
        assessmentSha256: digest,
        events: [
          quizEvent({ eventId: 'e1', sequence: 1, itemId: 'quiz-1', selectedOptionIds: ['submit'], correct: false, observedAt: '2026-07-26T01:00:00.000Z', artifactDigest: digest })
        ]
      })
    })

    expect(result.kind).toBe('not_evidenced')
    expect(result.assessments[0]).toMatchObject({ disposition: 'ignored', reason: 'malformed_answer_or_choice' })
  })

  it('keeps v1 sidecar fill items conservatively unsupported', async () => {
    const sidecarV1 = `${JSON.stringify({
      schemaVersion: 1,
      kind: 'studiumx-assessment',
      quizzes: [{ itemId: 'quiz-1', type: 'fill', answerIds: null, choiceIds: null }]
    }, null, 2)}\n`
    const { root, digest, relativePath } = await workspaceWithSidecar(sidecarV1)
    const result = await evaluateLearningSessionOutcome({
      workspaceRoot: root,
      session: snapshot({
        assessmentRelativePath: relativePath,
        assessmentSha256: digest,
        events: [
          quizEvent({ eventId: 'e1', sequence: 1, itemId: 'quiz-1', selectedOptionIds: [FILL_PRIMARY], correct: true, observedAt: '2026-07-26T01:00:00.000Z', artifactDigest: digest })
        ]
      })
    })

    expect(result.assessments[0]).toMatchObject({ disposition: 'ignored', reason: 'unsupported_quiz_type' })
  })

  it('rejects v2 sidecars whose fill answer ids are not digest-bound', async () => {
    const bad = `${JSON.stringify({
      schemaVersion: 2,
      kind: 'studiumx-assessment',
      quizzes: [{ itemId: 'quiz-1', type: 'fill', answerIds: ['not-a-digest'], choiceIds: null }]
    }, null, 2)}\n`
    const { root, digest, relativePath } = await workspaceWithSidecar(bad)
    const result = await evaluateLearningSessionOutcome({
      workspaceRoot: root,
      session: snapshot({ assessmentRelativePath: relativePath, assessmentSha256: digest, events: [] })
    })

    expect(result.artifact.status).toBe('unparseable')
  })
})

describe('assessment sidecar v2 rendering (ADR-0155)', () => {
  it('digests primary + accepted answers into fill answerIds', () => {
    const plan = sanitizePlan(lessonPlanSchema.parse({
      title: 'Fill',
      objective: 'Answer the fill item',
      durationMinutes: 10,
      sections: [{ heading: 'One', body: 'Body' }],
      quiz: [{ type: 'fill', question: 'JS 的并发模型核心机制是?', answer: '事件循环', acceptedAnswers: ['Event Loop', '事件循环。'] }]
    }))

    const sidecar = JSON.parse(renderAssessmentJsonFromPlan({ plan })) as {
      schemaVersion: number
      quizzes: Array<{ itemId: string; type: string; answerIds: string[] | null }>
    }

    expect(sidecar.schemaVersion).toBe(2)
    expect(sidecar.quizzes[0]!.answerIds).toEqual([FILL_PRIMARY, FILL_ALTERNATE])
  })
})
