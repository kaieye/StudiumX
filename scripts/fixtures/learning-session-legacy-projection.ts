import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLearningSessionLedger, projectLegacyLessonToLearningSession } from '../../src/main/learning-session-ledger'

const root = await mkdtemp(join(tmpdir(), 'studiumx-session-legacy-fixture-'))
try {
  const projection = projectLegacyLessonToLearningSession({
    id: '0012',
    title: 'Legacy projection',
    objective: 'Keep old Lesson facts readable.',
    prompt: 'Read the old Lesson.',
    createdAt: '2026-06-12T00:00:00.000Z',
    durationMinutes: 15,
    courseId: 'legacy-course',
    courseName: 'Legacy Course',
    courseRelativePath: 'courses/legacy-course',
    courseAbsolutePath: join(root, 'courses', 'legacy-course'),
    sessionId: 'lesson-0012',
    sessionName: '0012 Legacy projection',
    sessionRelativePath: 'courses/legacy-course/lesson',
    sessionAbsolutePath: join(root, 'courses', 'legacy-course', 'lesson'),
    relativePath: 'courses/legacy-course/lesson/0012-legacy-projection.html',
    absolutePath: join(root, 'courses', 'legacy-course', 'lesson', '0012-legacy-projection.html')
  }, 'workspace-legacy')
  const ledger = createLearningSessionLedger({
    workspaceRoot: root,
    resolveLegacySession: async (sessionId) => sessionId === projection.id ? projection : null
  })

  assert.deepEqual(await ledger.load('lesson-0012'), projection)
  assert.equal(projection.status, 'legacy_read_only')
  assert.equal(projection.outcomeRef, null)
  await assert.rejects(
    ledger.append('lesson-0012', {
      schemaVersion: 1,
      eventId: 'legacy-write',
      sessionId: 'lesson-0012',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T11:00:00.000Z',
      payload: {}
    }),
    (error: unknown) => hasCode(error, 'read_only')
  )
  await assert.rejects(access(join(root, 'learning-sessions')), (error: unknown) => hasCode(error, 'ENOENT'))
  console.log('Learning Session legacy projection check passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
