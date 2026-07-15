import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningOutcomeCommitter } from '../../src/main/learning-outcome-committer'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { createLessonInteractionRecorder } from '../../src/main/lesson-interaction-recorder'
import { publishLessonArtifacts } from '../../src/main/teaching-lesson-artifacts'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'
import type { LearningOutcomeCommitResult } from '../../src/shared/teaching-types/learning-outcome'

const roots: string[] = []

const generator: TeachingSettingsV1['generator'] = {
  providerId: 'test-provider', model: 'test-model', endpointFormat: 'chat_completions',
  temperature: 0.2, maxOutputTokens: 4096, lessonDurationMinutes: 25,
  includeRetrievalPractice: true, generateReference: false, structuredOutput: true,
  streaming: false, reasoningEffort: 'off', requestTimeoutMs: 30_000
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-outcome-committer-integration-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningOutcomeCommitter durable integration', () => {
  it('publishes exactly one evaluator-approved record after correction with a serialization-safe result contract', async () => {
    const workspaceRoot = await workspace()
    const publication = await publishLessonArtifacts({
      workspace: { name: 'Foundations', rootPath: workspaceRoot },
      plan: {
        title: 'Trusted assessment', objective: 'Use canonical sidecar facts.', durationMinutes: 25,
        sections: [{ heading: 'Evidence', body: 'Normal previews are not assessment authority.' }],
        keyPoints: ['Bind the sidecar digest'],
        quiz: [{ type: 'single', question: 'Which artifact is authoritative?', choices: ['Normal preview', 'Assessment sidecar'], answer: 1, explanation: 'Only the static sidecar is evaluated.' }],
        flashcards: [], callouts: [], referenceNotes: '', learningRecordNote: ''
      },
      sequence: 1, title: 'Trusted assessment', objective: 'Use canonical sidecar facts.', prompt: 'Teach trusted assessment.',
      createdAt: '2026-07-15T15:00:00.000Z', durationMinutes: 25,
      mission: { title: 'Foundations', excerpt: 'Trust static evidence.' }, generator, includeReference: false
    })
    const ledger = createLearningSessionLedger({ workspaceRoot, now: () => '2026-07-15T15:00:00.000Z', createId: () => 'session-outcome-commit' })
    await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: { courseId: publication.lesson.courseId, courseName: publication.lesson.courseName, relativePath: publication.lesson.courseRelativePath },
      lessonRef: { lessonId: publication.lesson.id, title: publication.lesson.title, relativePath: publication.lesson.relativePath, assessment: publication.assessment }
    })
    const recorder = createLessonInteractionRecorder({ ledger })
    const record = (eventId: string, attempt: number, selectedOptionIds: string[]) => recorder.record({
      schemaVersion: 1, eventId, kind: 'quiz_answered', workspaceId: 'workspace-1', courseId: publication.lesson.courseId,
      sessionId: 'session-outcome-commit', lessonId: publication.lesson.id, itemId: 'quiz-1', attempt,
      observedAt: `2026-07-15T15:00:0${attempt}.000Z`, artifactDigest: publication.assessment.contentSha256,
      surface: 'lesson_preview', selectedOptionIds, correct: false
    })
    await record('evidence-wrong-1', 1, ['a'])
    const committer = createLearningOutcomeCommitter({ workspaceRoot, ledger, createId: () => 'outcome-commit-1' })

    const practice = await committer.commit({ sessionId: 'session-outcome-commit', operationId: 'outcome-wrong-1' })
    const learnerSafePractice: LearningOutcomeCommitResult = practice
    expect(learnerSafePractice).toMatchObject({ status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false })
    expect(practice).toMatchObject({ record: null })
    expect(JSON.parse(JSON.stringify(practice))).toEqual(practice)
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })

    await record('evidence-correct-2', 2, ['b'])
    const correctionEvidence = ['evidence-correct-2', 'evidence-wrong-1']
    const correction = await committer.commit({ sessionId: 'session-outcome-commit', operationId: 'outcome-correct-2' })
    const learnerSafeCorrection: LearningOutcomeCommitResult = correction
    expect(learnerSafeCorrection).toMatchObject({ status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true })
    expect(correction).toMatchObject({
      status: 'committed',
      outcome: { kind: 'misconception_corrected', evidenceEventIds: correctionEvidence },
      record: { relativePath: 'learning-records/outcome-session-outcome-commit.md' }
    })
    expect(JSON.parse(JSON.stringify(correction))).toEqual(correction)
    expect(correction.record).not.toBeNull()

    const recordPath = join(workspaceRoot, ...correction.record!.relativePath.split('/'))
    const recordContent = await readFile(recordPath, 'utf8')
    const metadataMatch = recordContent.match(/^<!-- studiumx-learning-outcome (\{.+\}) -->$/m)
    expect(metadataMatch?.[1]).toBeDefined()
    const metadata = JSON.parse(metadataMatch![1]) as Record<string, unknown>
    expect(metadata).toMatchObject({
      sessionId: 'session-outcome-commit',
      operationId: 'outcome-correct-2',
      outcomeKind: 'misconception_corrected',
      evidenceEventIds: correctionEvidence,
      lessonId: publication.lesson.id,
      assessment: {
        relativePath: publication.assessment.relativePath,
        contentSha256: publication.assessment.contentSha256
      }
    })
    await expect(ledger.load('session-outcome-commit')).resolves.toMatchObject({
      id: 'session-outcome-commit',
      status: 'completed',
      outcomeRef: { kind: 'misconception_corrected', evidenceEventIds: correctionEvidence }
    })

    const replay = await committer.commit({ sessionId: 'session-outcome-commit', operationId: 'outcome-correct-2' })
    expect(replay).toMatchObject({
      status: 'already_committed', recordSaved: true,
      outcome: { kind: 'misconception_corrected', evidenceEventIds: correctionEvidence },
      record: { relativePath: correction.record!.relativePath }
    })
    expect(JSON.parse(JSON.stringify(replay))).toEqual(replay)
    expect((await readdir(join(workspaceRoot, 'learning-records'))).filter((file) => file.endsWith('.md'))).toEqual([
      'outcome-session-outcome-commit.md'
    ])
  })
})
