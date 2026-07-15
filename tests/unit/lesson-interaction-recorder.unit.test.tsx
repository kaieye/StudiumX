import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import {
  LessonInteractionValidationError,
  createLessonInteractionRecorder,
  projectLegacyReviewProgressToLessonInteractions
} from '../../src/main/lesson-interaction-recorder'
import {
  createPreviewLessonInteraction,
  parsePreviewLessonInteractionMessage,
  type LessonInteractionRecordingContext,
  type PreviewLessonInteractionIntent
} from '../../src/shared/preview-markdown-bridge'
import type { LearnerResponseKind } from '../../src/shared/teaching-types/lesson-interaction'
import { MarkdownPreview } from '../../src/renderer/src/markdown-preview'

type Assert<Condition extends true> = Condition
type PreviewResponseIntent = Extract<
  PreviewLessonInteractionIntent,
  { kind: 'retrieval_response_submitted' | 'learner_response_recorded' }
>
type _previewResponseIntentsRequireResponseKind = Assert<
  PreviewResponseIntent extends { responseKind: LearnerResponseKind } ? true : false
>

const roots: string[] = []
const artifactDigest = 'a'.repeat(64)

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-lesson-evidence-unit-'))
  roots.push(root)
  return root
}

async function recorderFixture() {
  const workspaceRoot = await workspace()
  const ledger = createLearningSessionLedger({
    workspaceRoot,
    now: () => '2026-07-15T12:00:00.000Z',
    createId: () => 'session-evidence-unit'
  })
  await ledger.open({
    workspaceId: 'workspace-1',
    courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
    lessonRef: { lessonId: 'lesson-1', title: 'Evidence', relativePath: 'courses/foundations/lesson-1.html' }
  })
  return { ledger, recorder: createLessonInteractionRecorder({ ledger }) }
}

const context: LessonInteractionRecordingContext = {
  workspaceId: 'workspace-1',
  courseId: 'course-1',
  sessionId: 'session-evidence-unit',
  lessonId: 'lesson-1',
  artifactDigest,
  observedAt: '2026-07-15T12:00:01.000Z'
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LessonInteractionRecorder contracts', () => {
  it('records a complete discriminated quiz evidence event through the session ledger without retaining the raw response', async () => {
    const { recorder } = await recorderFixture()
    const receipt = await recorder.record({
      schemaVersion: 1,
      eventId: 'quiz-answer-001',
      kind: 'quiz_answered',
      ...context,
      itemId: 'quiz-1',
      attempt: 1,
      observedAt: '2026-07-15T12:00:01.000Z',
      selectedOptionIds: ['option-b'],
      correct: true,
      surface: 'review'
    })

    expect(receipt).toMatchObject({ eventId: 'quiz-answer-001', duplicate: false, sequence: 1 })
    expect(receipt.evidence).toMatchObject({ kind: 'quiz_answered', selectedOptionIds: ['option-b'], correct: true })
    expect(JSON.stringify(receipt.evidence)).not.toContain('chain of thought')
    await expect(recorder.list('session-evidence-unit')).resolves.toEqual([receipt.evidence])
  })

  it('rejects untrusted preview values that attempt to supply paths, session identities, unknown fields, or chain-of-thought', () => {
    expect(parsePreviewLessonInteractionMessage({
      source: 'studiumx-lesson-evidence', type: 'studiumx:lesson-interaction',
      interaction: {
        eventId: 'preview-attack-001', kind: 'quiz_answered', itemId: 'quiz-1', selectedOptionIds: ['option-a'],
        sessionId: 'another-session'
      }
    })).toBeNull()
    expect(parsePreviewLessonInteractionMessage({
      source: 'studiumx-lesson-evidence', type: 'studiumx:lesson-interaction',
      interaction: {
        eventId: 'preview-attack-002', kind: 'retrieval_response_submitted', itemId: 'prompt-1',
        response: 'my private chain of thought', path: 'C:/workspace/secret.txt'
      }
    })).toBeNull()
    expect(() => createPreviewLessonInteraction(context, {
      eventId: 'preview-attack-003', kind: 'learner_response_recorded', itemId: 'prompt-1',
      response: 'private reasoning', chainOfThought: 'never persist this'
    } as never)).toThrow(LessonInteractionValidationError)
  })

  it('rejects preview response intents that omit the required response kind', () => {
    expect(parsePreviewLessonInteractionMessage({
      source: 'studiumx-lesson-evidence', type: 'studiumx:lesson-interaction',
      interaction: {
        eventId: 'preview-response-kind-001', kind: 'retrieval_response_submitted', itemId: 'prompt-1',
        responseDigest: 'b'.repeat(64)
      }
    })).toBeNull()
    expect(parsePreviewLessonInteractionMessage({
      source: 'studiumx-lesson-evidence', type: 'studiumx:lesson-interaction',
      interaction: {
        eventId: 'preview-response-kind-002', kind: 'learner_response_recorded', itemId: 'prompt-2',
        responseDigest: 'c'.repeat(64)
      }
    })).toBeNull()
  })

  it('rejects direct evidence whose workspace, course, or lesson identity does not match the bound Session', async () => {
    const { recorder } = await recorderFixture()
    await expect(recorder.record({
      schemaVersion: 1, eventId: 'cross-session-001', kind: 'lesson_opened',
      ...context, workspaceId: 'workspace-other', itemId: 'lesson-1', attempt: 1,
      observedAt: '2026-07-15T12:00:01.000Z', surface: 'lesson_preview'
    })).rejects.toThrow('does not match the bound Learning Session')
  })

  it('projects legacy review progress only when callers provide missing provenance explicitly', () => {
    expect(() => projectLegacyReviewProgressToLessonInteractions({
      workspaceId: 'workspace-1', courseId: 'course-1', sessionId: 'session-evidence-unit', lessonId: 'lesson-1',
      results: [{ lessonId: 'lesson-1', question: 'What is a limit?', correct: true }],
      bindings: []
    })).toThrow(LessonInteractionValidationError)

    const [projected] = projectLegacyReviewProgressToLessonInteractions({
      workspaceId: 'workspace-1', courseId: 'course-1', sessionId: 'session-evidence-unit', lessonId: 'lesson-1',
      results: [{ lessonId: 'lesson-1', question: 'What is a limit?', correct: true }],
      bindings: [{
        eventId: 'legacy-review-001', itemId: 'legacy-question-1', attempt: 1,
        observedAt: '2026-07-15T12:00:02.000Z', artifactDigest
      }]
    })

    expect(projected).toMatchObject({
      kind: 'legacy_review_projected',
      correct: true,
      missing: ['responseDigest'],
      legacy: { source: 'review_progress', questionDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }
    })
    expect(JSON.stringify(projected)).not.toContain('What is a limit?')
  })

  it('normalizes the iframe bridge and markdown-preview surface into the same trusted interaction shape', () => {
    const bridgeIntent = parsePreviewLessonInteractionMessage({
      source: 'studiumx-lesson-evidence', type: 'studiumx:lesson-interaction',
      interaction: {
        eventId: 'surface-quiz-001', kind: 'quiz_answered', itemId: 'quiz-1', selectedOptionIds: ['option-b'], correct: true
      }
    })
    expect(bridgeIntent).not.toBeNull()

    const received: unknown[] = []
    const view = render(<MarkdownPreview
      source={'[Answer](studiumx-evidence://quiz_answered/surface-quiz-001/quiz-1?option=option-b&correct=true)'}
      emptyTitle="Empty"
      emptyHint="Empty"
      onOpenExternal={() => {}}
      lessonInteraction={{ onIntent: (intent) => received.push(intent) }}
    />)
    fireEvent.click(view.getByRole('link', { name: 'Answer' }))

    expect(received).toEqual([bridgeIntent])
    expect(createPreviewLessonInteraction(context, bridgeIntent!)).toMatchObject({
      kind: 'quiz_answered', eventId: 'surface-quiz-001', sessionId: 'session-evidence-unit', itemId: 'quiz-1'
    })
  })
})
