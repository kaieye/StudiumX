import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { createLessonInteractionRecorder } from '../../src/main/lesson-interaction-recorder'
import { evaluateLearningSessionOutcome } from '../../src/main/learning-outcome-evaluator'
import { publishLessonArtifacts } from '../../src/main/teaching-lesson-artifacts'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-outcome-evaluator-integration-'))
  roots.push(root)
  return root
}

const generator: TeachingSettingsV1['generator'] = {
  providerId: 'test-provider',
  model: 'test-model',
  endpointFormat: 'chat_completions',
  temperature: 0.2,
  maxOutputTokens: 4096,
  lessonDurationMinutes: 25,
  includeRetrievalPractice: true,
  generateReference: false,
  structuredOutput: true,
  streaming: false,
  reasoningEffort: 'off',
  requestTimeoutMs: 30_000
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningOutcomeEvaluator durable integration', () => {
  it('establishes mastery only from a reloaded trusted session binding and a publisher-produced assessment sidecar', async () => {
    const workspaceRoot = await workspace()
    const publication = await publishLessonArtifacts({
      workspace: { name: 'Foundations', rootPath: workspaceRoot },
      plan: {
        title: 'Trusted assessment',
        objective: 'Use canonical sidecar facts.',
        durationMinutes: 25,
        sections: [{ heading: 'Evidence', body: 'Normal previews are not assessment authority.' }],
        keyPoints: ['Bind the sidecar digest'],
        quiz: [{
          type: 'single',
          question: 'Which artifact is authoritative?',
          choices: ['Normal preview', 'Assessment sidecar'],
          answer: 1,
          explanation: 'Only the static sidecar is evaluated.'
        }],
        flashcards: [],
        callouts: [],
        referenceNotes: '',
        learningRecordNote: ''
      },
      sequence: 1,
      title: 'Trusted assessment',
      objective: 'Use canonical sidecar facts.',
      prompt: 'Teach trusted assessment.',
      createdAt: '2026-07-15T13:00:00.000Z',
      durationMinutes: 25,
      mission: { title: 'Foundations', excerpt: 'Trust static evidence.' },
      generator,
      includeReference: false
    })
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-15T13:00:00.000Z',
      createId: () => 'session-outcome-integration'
    })
    await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: {
        courseId: publication.lesson.courseId,
        courseName: publication.lesson.courseName,
        relativePath: publication.lesson.courseRelativePath
      },
      lessonRef: {
        lessonId: publication.lesson.id,
        title: publication.lesson.title,
        relativePath: publication.lesson.relativePath,
        assessment: publication.assessment
      }
    })
    const recorder = createLessonInteractionRecorder({ ledger })
    await recorder.record({
      schemaVersion: 1,
      eventId: 'quiz-outcome-integration-1',
      kind: 'quiz_answered',
      workspaceId: 'workspace-1',
      courseId: publication.lesson.courseId,
      sessionId: 'session-outcome-integration',
      lessonId: publication.lesson.id,
      itemId: 'quiz-1',
      attempt: 1,
      observedAt: '2026-07-15T13:00:01.000Z',
      artifactDigest: publication.assessment.contentSha256,
      surface: 'lesson_preview',
      selectedOptionIds: ['b'],
      correct: false
    })
    const reloaded = await createLearningSessionLedger({ workspaceRoot }).load('session-outcome-integration')
    expect(reloaded).not.toBeNull()

    const result = await evaluateLearningSessionOutcome({ workspaceRoot, session: reloaded! })

    expect(result).toMatchObject({
      kind: 'established',
      mastery: true,
      evidenceEventIds: ['quiz-outcome-integration-1'],
      artifact: { relativePath: publication.assessment.relativePath, status: 'verified', sha256: publication.assessment.contentSha256 },
      assessments: [{ disposition: 'verified_correct', reason: 'verified' }]
    })
  })

  it('classifies a durable wrong-then-correct attempt on one item as a corrected misconception with both evidence IDs', async () => {
    const workspaceRoot = await workspace()
    const publication = await publishLessonArtifacts({
      workspace: { name: 'Foundations', rootPath: workspaceRoot },
      plan: {
        title: 'Trusted assessment',
        objective: 'Use canonical sidecar facts.',
        durationMinutes: 25,
        sections: [{ heading: 'Evidence', body: 'Normal previews are not assessment authority.' }],
        keyPoints: ['Bind the sidecar digest'],
        quiz: [{
          type: 'single',
          question: 'Which artifact is authoritative?',
          choices: ['Normal preview', 'Assessment sidecar'],
          answer: 1,
          explanation: 'Only the static sidecar is evaluated.'
        }],
        flashcards: [],
        callouts: [],
        referenceNotes: '',
        learningRecordNote: ''
      },
      sequence: 1,
      title: 'Trusted assessment',
      objective: 'Use canonical sidecar facts.',
      prompt: 'Teach trusted assessment.',
      createdAt: '2026-07-15T13:00:00.000Z',
      durationMinutes: 25,
      mission: { title: 'Foundations', excerpt: 'Trust static evidence.' },
      generator,
      includeReference: false
    })
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-15T13:00:00.000Z',
      createId: () => 'session-outcome-correction-integration'
    })
    await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: {
        courseId: publication.lesson.courseId,
        courseName: publication.lesson.courseName,
        relativePath: publication.lesson.courseRelativePath
      },
      lessonRef: {
        lessonId: publication.lesson.id,
        title: publication.lesson.title,
        relativePath: publication.lesson.relativePath,
        assessment: publication.assessment
      }
    })
    const recorder = createLessonInteractionRecorder({ ledger })
    const record = (eventId: string, attempt: number, selectedOptionIds: string[]) => recorder.record({
      schemaVersion: 1,
      eventId,
      kind: 'quiz_answered',
      workspaceId: 'workspace-1',
      courseId: publication.lesson.courseId,
      sessionId: 'session-outcome-correction-integration',
      lessonId: publication.lesson.id,
      itemId: 'quiz-1',
      attempt,
      observedAt: `2026-07-15T13:00:0${attempt}.000Z`,
      artifactDigest: publication.assessment.contentSha256,
      surface: 'lesson_preview',
      selectedOptionIds,
      correct: false
    })
    await record('quiz-outcome-wrong-1', 1, ['a'])
    await record('quiz-outcome-correction-2', 2, ['b'])
    const reloaded = await createLearningSessionLedger({ workspaceRoot }).load('session-outcome-correction-integration')
    expect(reloaded).not.toBeNull()

    const result = await evaluateLearningSessionOutcome({ workspaceRoot, session: reloaded! })

    expect(result).toMatchObject({
      kind: 'misconception_corrected',
      mastery: true,
      evidenceEventIds: ['quiz-outcome-wrong-1', 'quiz-outcome-correction-2'],
      artifact: { relativePath: publication.assessment.relativePath, status: 'verified', sha256: publication.assessment.contentSha256 },
      assessments: [
        { eventId: 'quiz-outcome-wrong-1', disposition: 'verified_incorrect', reason: 'verified' },
        { eventId: 'quiz-outcome-correction-2', disposition: 'verified_correct', reason: 'verified' }
      ]
    })
  })
})
