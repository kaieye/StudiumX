import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningOutcomeCommitter, type OutcomeReconciliation } from '../../src/main/learning-outcome-committer'
import { createLessonInteractionRecorder } from '../../src/main/lesson-interaction-recorder'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { createNextTeachingStepPlanner } from '../../src/main/next-teaching-step-planner'
import { publishLessonArtifacts } from '../../src/main/teaching-lesson-artifacts'
import type { NextTeachingStepFacts } from '../../src/shared/teaching-types/next-teaching-step'
import type { LearningSessionSnapshot } from '../../src/shared/teaching-types/learning-session'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'
import type { LearningOutcomeEvaluation } from '../../src/main/learning-outcome-evaluator'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-next-step-planner-integration-'))
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

describe('NextTeachingStepPlanner durable integration', () => {
  it('maps a durable needs-practice outcome to retry, then a correction to continuation, and degrades when resources are unavailable', async () => {
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
      createdAt: '2026-07-16T01:00:00.000Z',
      durationMinutes: 25,
      mission: { title: 'Foundations', excerpt: 'Trust static evidence.' },
      generator,
      includeReference: false
    })
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-16T01:00:00.000Z',
      createId: () => 'session-next-step-integration'
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
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => 'outcome-next-step-integration'
    })
    const record = (eventId: string, attempt: number, selectedOptionIds: string[]) => recorder.record({
      schemaVersion: 1,
      eventId,
      kind: 'quiz_answered',
      workspaceId: 'workspace-1',
      courseId: publication.lesson.courseId,
      sessionId: 'session-next-step-integration',
      lessonId: publication.lesson.id,
      itemId: 'quiz-1',
      attempt,
      observedAt: `2026-07-16T01:00:0${attempt}.000Z`,
      artifactDigest: publication.assessment.contentSha256,
      surface: 'lesson_preview',
      selectedOptionIds,
      correct: false
    })
    const planner = createNextTeachingStepPlanner()

    await record('evidence-wrong-1', 1, ['a'])
    await expect(committer.commit({ sessionId: 'session-next-step-integration', operationId: 'outcome-wrong-1' }))
      .resolves.toMatchObject({ status: 'committed', outcome: { kind: 'needs_practice' } })
    const practiceSession = await requireSession(ledger, 'session-next-step-integration')
    const practiceEvaluation = await committer.evaluate({ sessionId: 'session-next-step-integration' })
    const practiceSettlement = await committer.reconcile('session-next-step-integration')

    expect(practiceSettlement).toMatchObject({ state: 'settled', marker: { kind: 'needs_practice' } })
    expect(planner.plan(durableFacts(practiceSession, practiceEvaluation, practiceSettlement, 'ready'))).toMatchObject({
      action: 'contrast_and_retry',
      reason: 'needs_practice'
    })

    await record('evidence-correct-2', 2, ['b'])
    await expect(committer.commit({ sessionId: 'session-next-step-integration', operationId: 'outcome-correct-2' }))
      .resolves.toMatchObject({ status: 'committed', outcome: { kind: 'misconception_corrected' } })
    const correctedSession = await requireSession(ledger, 'session-next-step-integration')
    const correctedEvaluation = await committer.evaluate({ sessionId: 'session-next-step-integration' })
    const correctedSettlement = await committer.reconcile('session-next-step-integration')

    expect(correctedSettlement).toMatchObject({ state: 'settled', marker: { kind: 'misconception_corrected' } })
    expect(planner.plan(durableFacts(correctedSession, correctedEvaluation, correctedSettlement, 'ready'))).toMatchObject({
      action: 'continue_next_session',
      reason: 'misconception_corrected_with_next_goal'
    })
    expect(planner.plan(durableFacts(correctedSession, correctedEvaluation, correctedSettlement, 'not_ready'))).toMatchObject({
      action: 'wait_for_resources',
      reason: 'resources_not_ready'
    })
  })
})

async function requireSession(
  ledger: ReturnType<typeof createLearningSessionLedger>,
  sessionId: string
): Promise<LearningSessionSnapshot> {
  const session = await ledger.load(sessionId)
  if (!session) throw new Error(`Expected durable session ${sessionId}.`)
  return session
}

/** Adapter boundary: the planner sees only ledger identities and evaluator status, never event payloads. */
function durableFacts(
  session: LearningSessionSnapshot,
  evaluation: LearningOutcomeEvaluation,
  settlement: OutcomeReconciliation,
  readiness: NextTeachingStepFacts['resources']['readiness']
): NextTeachingStepFacts {
  return {
    mission: { id: 'mission-foundations', nextGoal: 'available' },
    course: { id: session.courseRef.courseId },
    latestSession: { id: session.id, source: session.source, readOnly: session.readOnly },
    durableOutcome: settlement.marker
      ? {
          status: 'trusted',
          id: settlement.marker.outcomeId,
          kind: settlement.marker.kind,
          evidenceEventIds: settlement.marker.evidenceEventIds
        }
      : { status: 'absent' },
    evidence: { status: evaluation.artifact.status === 'verified' ? 'verified' : 'not_evidenced' },
    resources: {
      readiness,
      availableCount: readiness === 'ready' ? 1 : 0,
      provenanceIds: readiness === 'ready' ? ['assessment-sidecar'] : []
    }
  }
}
