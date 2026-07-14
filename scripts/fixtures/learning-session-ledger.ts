import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'

const root = await mkdtemp(join(tmpdir(), 'studiumx-session-ledger-fixture-'))
try {
  const times = [
    '2026-07-15T10:00:00.000Z',
    '2026-07-15T10:00:01.000Z',
    '2026-07-15T10:00:02.000Z'
  ]
  const ledger = createLearningSessionLedger({
    workspaceRoot: root,
    now: () => times.shift() ?? '2026-07-15T10:00:03.000Z',
    createId: () => 'session-check'
  })
  const openInput = {
    workspaceId: 'workspace-check',
    courseRef: { courseId: 'course-check', courseName: 'Check Course', relativePath: 'courses/check-course' },
    lessonRef: { lessonId: '0001', title: 'Check Lesson', relativePath: 'courses/check-course/lesson/0001-check.html' }
  }
  const opened = await ledger.open(openInput)
  assert.equal(opened.status, 'active')
  assert.equal((await ledger.open(openInput)).version, 1)
  const bound = await ledger.open({
    ...openInput,
    conversationRefs: [{ conversationId: 'conversation-check', relativePath: 'conversation/conversation-check.json' }]
  })
  assert.equal(bound.version, 2)
  assert.equal(bound.conversationRefs[0]?.conversationId, 'conversation-check')

  const event = {
    schemaVersion: 1 as const,
    eventId: 'attempt-check-1',
    sessionId: 'session-check',
    kind: 'retrieval_attempted' as const,
    occurredAt: '2026-07-15T10:00:00.500Z',
    payload: { correct: false, promptId: 'prompt-1' }
  }
  const appended = await ledger.append('session-check', event)
  const replayed = await ledger.append('session-check', {
    ...event,
    payload: { promptId: 'prompt-1', correct: false }
  })
  assert.equal(appended.eventCount, 1)
  assert.deepEqual(replayed, appended)

  await writeFile(
    join(root, 'learning-sessions', 'session-check', 'outcome.json'),
    '{"schemaVersion":1,"outcomeId":"outcome-check"}\n',
    'utf8'
  )
  const completed = await ledger.complete('session-check', {
    outcomeId: 'outcome-check',
    kind: 'needs_practice',
    relativePath: 'learning-sessions/session-check/outcome.json',
    evidenceEventIds: ['attempt-check-1']
  })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.version, 4)
  assert.equal((await createLearningSessionLedger({ workspaceRoot: root }).load('session-check'))?.eventCount, 1)
  await assert.rejects(
    ledger.append('session-check', { ...event, eventId: 'late-event' }),
    (error: unknown) => hasCode(error, 'invalid_transition')
  )
  await assert.rejects(access(join(root, 'learning-records')), (error: unknown) => hasCode(error, 'ENOENT'))
  console.log('Learning Session ledger check passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
