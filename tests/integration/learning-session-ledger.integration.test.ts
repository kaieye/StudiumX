import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'

const roots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-learning-session-integration-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningSessionLedger filesystem recovery', () => {
  it('repairs a stale manifest from the immutable event files after restart', async () => {
    const workspaceRoot = await createWorkspace()
    const times = ['2026-07-15T06:00:00.000Z', '2026-07-15T06:00:01.000Z']
    let injectedCrashWindow = false
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => times.shift() ?? '2026-07-15T06:00:02.000Z',
      createId: () => 'session-recovery',
      testingFaults: {
        inject: (point) => {
          if (injectedCrashWindow || point !== 'after_event_publish') return
          injectedCrashWindow = true
          throw new Error('simulated crash after immutable event publication')
        }
      }
    })
    const openInput = {
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Recovery', relativePath: 'courses/recovery' }
    }
    await ledger.open(openInput)
    await ledger.open({
      ...openInput,
      sessionId: 'session-recovery',
      conversationRefs: [{ conversationId: 'conversation-recovery', relativePath: 'conversation/conversation-recovery.json' }]
    })
    const manifestPath = join(workspaceRoot, 'learning-sessions', 'session-recovery', 'session.json')
    await expect(ledger.append('session-recovery', {
      schemaVersion: 1,
      eventId: 'event-before-crash',
      sessionId: 'session-recovery',
      kind: 'lesson_opened',
      occurredAt: '2026-07-15T06:00:00.500Z',
      payload: {}
    })).rejects.toThrow('simulated crash after immutable event publication')
    expect(injectedCrashWindow).toBe(true)

    const restarted = createLearningSessionLedger({ workspaceRoot })
    const recovered = await restarted.load('session-recovery')
    expect(recovered).toMatchObject({ version: 3, eventCount: 1 })
    expect(recovered?.events.map((event) => event.eventId)).toEqual(['event-before-crash'])
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toMatchObject({ version: 3, eventCount: 1 })
  })
  it('isolates one corrupt Session, preserves its bytes, and keeps other Sessions loadable', async () => {
    const workspaceRoot = await createWorkspace()
    const ids = ['session-corrupt', 'session-healthy']
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-15T07:00:00.000Z',
      createId: () => ids.shift()!
    })
    const input = {
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Recovery', relativePath: 'courses/recovery' }
    }
    await ledger.open(input)
    await ledger.open(input)
    const corruptPath = join(workspaceRoot, 'learning-sessions', 'session-corrupt', 'session.json')
    const corruptBytes = '{broken-json\n'
    await writeFile(corruptPath, corruptBytes, 'utf8')

    await expect(ledger.load('session-corrupt')).rejects.toMatchObject({
      code: 'corrupt_session',
      diagnostic: {
        code: 'invalid_session_manifest',
        sessionId: 'session-corrupt',
        relativePath: 'learning-sessions/session-corrupt/session.json'
      }
    })
    await expect(readFile(corruptPath, 'utf8')).resolves.toBe(corruptBytes)
    await expect(ledger.load('session-healthy')).resolves.toMatchObject({ id: 'session-healthy', status: 'active' })
  })

  it('serializes concurrent appends across ledger instances without losing or duplicating evidence', async () => {
    const workspaceRoot = await createWorkspace()
    const times = [
      '2026-07-15T08:00:00.000Z',
      '2026-07-15T08:00:01.000Z',
      '2026-07-15T08:00:02.000Z'
    ]
    const options = {
      workspaceRoot,
      now: () => times.shift() ?? '2026-07-15T08:00:03.000Z'
    }
    const firstLedger = createLearningSessionLedger({ ...options, createId: () => 'session-concurrent' })
    const secondLedger = createLearningSessionLedger(options)
    await firstLedger.open({
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Concurrency', relativePath: 'courses/concurrency' }
    })

    await Promise.all([
      firstLedger.append('session-concurrent', {
        schemaVersion: 1,
        eventId: 'event-a',
        sessionId: 'session-concurrent',
        kind: 'lesson_opened',
        occurredAt: '2026-07-15T08:00:00.100Z',
        payload: { source: 'first' }
      }),
      secondLedger.append('session-concurrent', {
        schemaVersion: 1,
        eventId: 'event-b',
        sessionId: 'session-concurrent',
        kind: 'retrieval_attempted',
        occurredAt: '2026-07-15T08:00:00.200Z',
        payload: { source: 'second' }
      })
    ])

    const recovered = await createLearningSessionLedger({ workspaceRoot }).load('session-concurrent')
    expect(recovered).toMatchObject({ version: 3, eventCount: 2 })
    expect(recovered?.events.map((event) => event.sequence)).toEqual([1, 2])
    expect(recovered?.events.map((event) => event.eventId).sort()).toEqual(['event-a', 'event-b'])
  })

  it('rejects a symlinked learning-sessions root without writing outside the Teaching workspace', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    const sessionsPath = join(workspaceRoot, 'learning-sessions')
    try {
      await symlink(outsideRoot, sessionsPath, 'junction')
    } catch (error) {
      if (isErrnoException(error, 'EPERM')) return
      throw error
    }
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      createId: () => 'session-escape'
    })

    await expect(ledger.open({
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Safety', relativePath: 'courses/safety' }
    })).rejects.toMatchObject({ code: 'unsafe_storage' })
    await expect(access(join(outsideRoot, 'session-escape'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
