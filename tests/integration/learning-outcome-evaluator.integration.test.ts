import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { createLessonInteractionRecorder } from '../../src/main/lesson-interaction-recorder'
import { evaluateLearningSessionOutcome } from '../../src/main/learning-outcome-evaluator'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-outcome-evaluator-integration-'))
  roots.push(root)
  return root
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningOutcomeEvaluator durable integration', () => {
  it('evaluates a reloaded ledger snapshot and ignores the persisted renderer correctness claim', async () => {
    const workspaceRoot = await workspace()
    const relativePath = 'courses/foundations/lesson-1.html'
    const html = '<!doctype html><article class="quiz-card" data-type="single" data-answer="b"><button data-choice="a">A</button><button data-choice="b">B</button></article>'
    await mkdir(join(workspaceRoot, 'courses', 'foundations'), { recursive: true })
    await writeFile(join(workspaceRoot, ...relativePath.split('/')), html, 'utf8')
    const digest = sha256(html)
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-15T13:00:00.000Z',
      createId: () => 'session-outcome-integration'
    })
    await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
      lessonRef: { lessonId: 'lesson-1', title: 'Evidence', relativePath }
    })
    const recorder = createLessonInteractionRecorder({ ledger })
    await recorder.record({
      schemaVersion: 1,
      eventId: 'quiz-outcome-integration-1',
      kind: 'quiz_answered',
      workspaceId: 'workspace-1',
      courseId: 'course-1',
      sessionId: 'session-outcome-integration',
      lessonId: 'lesson-1',
      itemId: 'quiz-1',
      attempt: 1,
      observedAt: '2026-07-15T13:00:01.000Z',
      artifactDigest: digest,
      surface: 'lesson_preview',
      selectedOptionIds: ['a'],
      correct: true
    })
    const reloaded = await createLearningSessionLedger({ workspaceRoot }).load('session-outcome-integration')
    expect(reloaded).not.toBeNull()

    const result = await evaluateLearningSessionOutcome({ workspaceRoot, session: reloaded! })

    expect(result).toMatchObject({
      kind: 'needs_practice',
      mastery: false,
      evidenceEventIds: ['quiz-outcome-integration-1'],
      assessments: [{ disposition: 'verified_incorrect', reason: 'verified' }]
    })
  })
})
