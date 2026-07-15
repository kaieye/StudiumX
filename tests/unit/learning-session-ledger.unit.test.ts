import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningSessionLedger, encodeCommittedLearningSessionOutcome, projectLegacyLessonToLearningSession } from '../../src/main/learning-session-ledger'

const roots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-learning-session-unit-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningSessionLedger', () => {
  it('opens a canonical teaching Session and loads it from durable workspace files', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-15T01:00:00.000Z',
      createId: () => 'session-ledger-basics'
    })

    const opened = await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: {
        courseId: 'course-1',
        courseName: 'Foundations',
        relativePath: 'courses/foundations'
      },
      lessonRef: {
        lessonId: '0001',
        title: 'Durable Sessions',
        relativePath: 'courses/foundations/lesson/0001-durable-sessions.html'
      }
    })

    expect(opened).toMatchObject({
      schemaVersion: 1,
      id: 'session-ledger-basics',
      source: 'canonical',
      readOnly: false,
      status: 'active',
      version: 1,
      eventCount: 0,
      createdAt: '2026-07-15T01:00:00.000Z',
      updatedAt: '2026-07-15T01:00:00.000Z',
      outcomeRef: null,
      events: []
    })

    const manifest = JSON.parse(await readFile(
      join(workspaceRoot, 'learning-sessions', 'session-ledger-basics', 'session.json'),
      'utf8'
    ))
    expect(manifest).toMatchObject({ id: 'session-ledger-basics', status: 'active', version: 1, eventCount: 0 })

    const restarted = createLearningSessionLedger({ workspaceRoot })
    await expect(restarted.load('session-ledger-basics')).resolves.toEqual(opened)
  })
  it('reopens an active Session to bind new conversations without changing its Lesson identity', async () => {
    const workspaceRoot = await createWorkspace()
    const times = ['2026-07-15T01:30:00.000Z', '2026-07-15T01:30:01.000Z']
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => times.shift() ?? '2026-07-15T01:30:02.000Z'
    })
    const identity = {
      sessionId: 'session-conversation-binding',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
      lessonRef: {
        lessonId: '0001',
        title: 'Durable Sessions',
        relativePath: 'courses/foundations/lesson/0001-durable-sessions.html'
      }
    }

    await ledger.open(identity)
    const bound = await ledger.open({
      ...identity,
      conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'conversation/conversation-1.json' }]
    })

    expect(bound).toMatchObject({
      status: 'active',
      version: 2,
      updatedAt: '2026-07-15T01:30:01.000Z',
      conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'conversation/conversation-1.json' }]
    })
    await expect(ledger.open({
      ...identity,
      conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'conversation/conversation-1.json' }]
    })).resolves.toEqual(bound)
    await expect(createLearningSessionLedger({ workspaceRoot }).load(identity.sessionId)).resolves.toEqual(bound)
    await expect(ledger.open({
      ...identity,
      conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'conversation/other.json' }]
    })).rejects.toMatchObject({ code: 'identity_conflict' })
  })

  it('appends a typed evidence envelope and recovers its ledger order after restart', async () => {
    const workspaceRoot = await createWorkspace()
    const times = [
      '2026-07-15T02:00:00.000Z',
      '2026-07-15T02:00:01.000Z'
    ]
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => times.shift() ?? '2026-07-15T02:00:02.000Z',
      createId: () => 'session-with-event'
    })
    await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
      lessonRef: { lessonId: '0001', title: 'Evidence', relativePath: 'courses/foundations/lesson/0001-evidence.html' }
    })

    const appended = await ledger.append('session-with-event', {
      schemaVersion: 1,
      eventId: 'event-opened-1',
      sessionId: 'session-with-event',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T02:00:00.500Z',
      turnId: 'turn-1',
      payload: { lessonId: '0001' }
    })

    expect(appended).toMatchObject({
      id: 'session-with-event',
      status: 'active',
      version: 2,
      eventCount: 1,
      updatedAt: '2026-07-15T02:00:01.000Z',
      events: [{
        eventId: 'event-opened-1',
        sessionId: 'session-with-event',
        kind: 'lesson_opened',
        sequence: 1,
        recordedAt: '2026-07-15T02:00:01.000Z'
      }]
    })

    const restarted = createLearningSessionLedger({ workspaceRoot })
    await expect(restarted.load('session-with-event')).resolves.toEqual(appended)
  })
  it('returns atomic append receipts for concurrent retries and rejects conflicting replay content', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-15T03:00:00.000Z',
      createId: () => 'session-idempotent'
    })
    await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' }
    })
    const event = {
      schemaVersion: 1 as const,
      eventId: 'attempt-1',
      sessionId: 'session-idempotent',
      kind: 'retrieval_attempted' as const,
      occurredAt: '2026-07-15T03:00:01.000Z',
      payload: { promptId: 'retrieval-1', correct: false }
    }

    const [first, replay] = await Promise.all([
      ledger.appendWithReceipt('session-idempotent', event),
      ledger.appendWithReceipt('session-idempotent', event)
    ])

    expect([first.disposition, replay.disposition].sort()).toEqual(['appended', 'matching_existing'])
    expect(first.snapshot.eventCount).toBe(1)
    expect(replay.snapshot).toEqual(first.snapshot)
    expect(replay.event).toEqual(first.event)
    expect(first.event).toMatchObject({
      eventId: 'attempt-1',
      sequence: 1,
      recordedAt: '2026-07-15T03:00:00.000Z'
    })
    await expect(ledger.append('session-idempotent', event)).resolves.toEqual(first.snapshot)
    await expect(ledger.appendWithReceipt('session-idempotent', {
      ...event,
      payload: { promptId: 'retrieval-1', correct: true }
    })).rejects.toMatchObject({ code: 'identity_conflict' })
    expect(await readdir(join(workspaceRoot, 'learning-sessions', 'session-idempotent', 'events'))).toHaveLength(1)
  })
  it('completes only by referencing a separately published outcome and never creates a Learning record', async () => {
    const workspaceRoot = await createWorkspace()
    const times = [
      '2026-07-15T04:00:00.000Z',
      '2026-07-15T04:00:01.000Z',
      '2026-07-15T04:00:02.000Z'
    ]
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => times.shift() ?? '2026-07-15T04:00:03.000Z',
      createId: () => 'session-complete'
    })
    await ledger.open({
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' }
    })
    const event = {
      schemaVersion: 1 as const,
      eventId: 'attempt-corrected-1',
      sessionId: 'session-complete',
      kind: 'retrieval_attempted' as const,
      occurredAt: '2026-07-15T04:00:00.500Z',
      payload: { correct: true }
    }
    await ledger.append('session-complete', event)
    const committedOutcome = encodeCommittedLearningSessionOutcome({
      sessionId: 'session-complete',
      outcomeId: 'outcome-1',
      kind: 'misconception_corrected',
      evidenceEventIds: ['attempt-corrected-1']
    })
    await writeFile(
      join(workspaceRoot, 'learning-sessions', 'session-complete', 'outcome.json'),
      committedOutcome.content,
      'utf8'
    )
    const outcomeRef = committedOutcome.ref

    const completed = await ledger.complete('session-complete', outcomeRef)

    expect(completed).toMatchObject({
      status: 'completed',
      version: 3,
      completedAt: '2026-07-15T04:00:02.000Z',
      updatedAt: '2026-07-15T04:00:02.000Z',
      outcomeRef
    })
    await expect(ledger.complete('session-complete', outcomeRef)).resolves.toEqual(completed)
    await expect(ledger.complete('session-complete', { ...outcomeRef, outcomeId: 'different-outcome' }))
      .rejects.toMatchObject({ code: 'invalid_transition' })
    await expect(ledger.append('session-complete', { ...event, eventId: 'too-late' }))
      .rejects.toMatchObject({ code: 'invalid_transition' })
    await expect(access(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('projects a legacy Lesson as a read-only Session without migrating or reinterpreting it', async () => {
    const workspaceRoot = await createWorkspace()
    const legacy = projectLegacyLessonToLearningSession({
      id: '0007',
      title: 'Legacy lesson',
      objective: 'Preserve old facts.',
      prompt: 'Teach legacy facts.',
      createdAt: '2026-06-01T00:00:00.000Z',
      durationMinutes: 20,
      courseId: 'course-legacy',
      courseName: 'Legacy Course',
      courseRelativePath: 'courses/legacy-course',
      courseAbsolutePath: join(workspaceRoot, 'courses', 'legacy-course'),
      sessionId: 'lesson-0007',
      sessionName: '0007 Legacy lesson',
      sessionRelativePath: 'courses/legacy-course/lesson',
      sessionAbsolutePath: join(workspaceRoot, 'courses', 'legacy-course', 'lesson'),
      relativePath: 'courses/legacy-course/lesson/0007-legacy-lesson.html',
      absolutePath: join(workspaceRoot, 'courses', 'legacy-course', 'lesson', '0007-legacy-lesson.html')
    }, 'workspace-legacy')
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      resolveLegacySession: async (sessionId) => sessionId === legacy.id ? legacy : null
    })

    await expect(ledger.load('lesson-0007')).resolves.toEqual(legacy)
    expect(legacy).toMatchObject({
      source: 'legacy_lesson',
      readOnly: true,
      status: 'legacy_read_only',
      version: 0,
      eventCount: 0,
      outcomeRef: null
    })
    await expect(ledger.append('lesson-0007', {
      schemaVersion: 1,
      eventId: 'legacy-attempt',
      sessionId: 'lesson-0007',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T05:00:00.000Z',
      payload: {}
    })).rejects.toMatchObject({ code: 'read_only' })
    await expect(ledger.complete('lesson-0007', {
      outcomeId: 'legacy-outcome',
      kind: 'not_evidenced',
      relativePath: 'learning-sessions/lesson-0007/outcome.json',
      evidenceEventIds: []
    })).rejects.toMatchObject({ code: 'read_only' })
    await expect(access(join(workspaceRoot, 'learning-sessions'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('fails closed for unknown Sessions, path-like IDs, mismatched event targets, and missing outcome files', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })

    await expect(ledger.load('../outside')).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(ledger.append('unknown-session', {
      schemaVersion: 1,
      eventId: 'unknown-event',
      sessionId: 'unknown-session',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T09:00:00.000Z',
      payload: {}
    })).rejects.toMatchObject({ code: 'not_found' })

    const opened = await ledger.open({
      sessionId: 'session-negative',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Safety', relativePath: 'courses/safety' }
    })
    expect(opened.id).toBe('session-negative')
    await expect(ledger.append('session-negative', {
      schemaVersion: 1,
      eventId: 'mismatch-event',
      sessionId: 'another-session',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T09:00:01.000Z',
      payload: {}
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(ledger.append('session-negative', {
      schemaVersion: 1,
      eventId: 'caller-sequence',
      sessionId: 'session-negative',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T09:00:02.000Z',
      payload: {},
      sequence: 99
    } as never)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(ledger.append('session-negative', {
      schemaVersion: 1,
      eventId: 'non-json-payload',
      sessionId: 'session-negative',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T09:00:03.000Z',
      payload: { answer: undefined }
    })).rejects.toMatchObject({ code: 'invalid_input' })
    const circularPayload: Record<string, unknown> = {}
    circularPayload.self = circularPayload
    await expect(ledger.append('session-negative', {
      schemaVersion: 1,
      eventId: 'circular-payload',
      sessionId: 'session-negative',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T09:00:04.000Z',
      payload: circularPayload
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(ledger.complete('session-negative', {
      outcomeId: 'missing-outcome',
      kind: 'not_evidenced',
      relativePath: 'learning-sessions/session-negative/outcome.json',
      evidenceEventIds: []
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await writeFile(
      join(workspaceRoot, 'learning-sessions', 'session-negative', 'outcome.json'),
      '{"schemaVersion":1,"outcomeId":"unknown-evidence"}\n',
      'utf8'
    )
    await expect(ledger.complete('session-negative', {
      outcomeId: 'unknown-evidence',
      kind: 'established',
      relativePath: 'learning-sessions/session-negative/outcome.json',
      evidenceEventIds: ['event-not-in-ledger']
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(ledger.load('session-negative')).resolves.toMatchObject({ status: 'active', outcomeRef: null })
    await expect(ledger.open({
      sessionId: 'session-unsafe-ref',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Safety', relativePath: '../outside' }
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(access(join(workspaceRoot, 'outside'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.open({
      sessionId: 'session-oversized',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'x'.repeat(1024 * 1024), relativePath: 'courses/oversized' }
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(access(join(workspaceRoot, 'learning-sessions', 'session-oversized')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
