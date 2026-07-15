import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import {
  createLearningSessionLedger,
  projectLearningSessionToTeachingSummary,
  projectLegacyLessonToLearningSession
} from '../../src/main/learning-session-ledger'
import type { LessonSummary } from '../../src/shared/teaching-types/workspace'

const roots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-learning-session-review-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningSessionLedger reviewer contracts', () => {
  it('discovers canonical Sessions without a catalog and isolates one corrupt object', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    await openSession(ledger, 'session-scan-good')
    await openSession(ledger, 'session-scan-bad')
    const badManifestPath = join(workspaceRoot, 'learning-sessions', 'session-scan-bad', 'session.json')
    const originalBytes = await readFile(badManifestPath)
    await writeFile(badManifestPath, '{"schemaVersion":999}\n', 'utf8')

    const scan = await ledger.scan()

    expect(scan.canonicalSessions.map((session) => session.id)).toEqual(['session-scan-good'])
    expect(scan.sessions.map((session) => session.id)).toEqual(['session-scan-good'])
    expect(scan.quarantined).toEqual([
      expect.objectContaining({
        sessionId: 'session-scan-bad',
        diagnostic: expect.objectContaining({ code: 'unknown_session_schema' })
      })
    ])
    expect(await readFile(badManifestPath, 'utf8')).toBe('{"schemaVersion":999}\n')
    expect(originalBytes.byteLength).toBeGreaterThan(0)
    expect(scan.settlement.fileSync).toBe('supported')
    expect(['supported', 'unsupported']).toContain(scan.settlement.directorySync)
  })

  it('prefers canonical identity over an explicit legacy Lesson projection conflict', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    const canonical = await openSession(ledger, 'lesson-0001')
    const lesson = legacyLesson({ sessionId: 'LESSON-0001' })

    const scan = await ledger.scan({ legacyLessons: [{ lesson, workspaceId: 'workspace-1' }] })

    expect(scan.canonicalSessions).toEqual([canonical])
    expect(scan.legacySessions).toEqual([])
    expect(scan.sessions).toEqual([canonical])
    expect(scan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'canonical_legacy_conflict',
      sessionId: 'lesson-0001'
    }))
  })

  it.each([
    'C:relative',
    'C:/absolute',
    '//server/share',
    '\\\\server\\share',
    'courses/name:stream',
    'courses/CON',
    'courses/com1.txt',
    'courses/trailing.',
    'courses/trailing ',
    'courses/control\u0001name',
    'courses/delete\u007fname',
    'courses/c1-control\u0085name',
    'courses/COM¹.txt',
    'courses/LPT³',
    'courses/question?mark',
    'courses/../escape'
  ])('rejects Windows-unsafe relative refs cross-platform: %s', async (relativePath) => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })

    await expect(ledger.open({
      sessionId: `session-ref-${Math.random().toString(16).slice(2)}`,
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Unsafe', relativePath }
    })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('normalizes Session case aliases and compares Windows path aliases without duplicate bindings', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    const first = await ledger.open({
      sessionId: 'Session-Case-Alias',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Case', relativePath: 'Courses/Case' },
      conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'Conversation/Thread.JSON' }]
    })
    const second = await ledger.open({
      sessionId: 'session-case-alias',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Case', relativePath: 'courses/case' },
      conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'conversation/thread.json' }]
    })

    expect(first.id).toBe('session-case-alias')
    expect(second.id).toBe('session-case-alias')
    expect(second.version).toBe(1)
    expect(second.conversationRefs).toHaveLength(1)
  })

  it('fails closed on invalid time order and never completes before creation time', async () => {
    const workspaceRoot = await createWorkspace()
    const times = ['2026-07-15T10:00:00.000Z', '2026-07-15T09:00:00.000Z']
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => times.shift() ?? '2026-07-15T09:00:00.000Z'
    })
    await openSession(ledger, 'session-time-order')
    const committed = await commitOutcome(workspaceRoot, 'session-time-order')

    const completed = await ledger.complete('session-time-order', committed.ref)
    expect(completed.completedAt).toBe('2026-07-15T10:00:00.000Z')
    expect(completed.updatedAt).toBe('2026-07-15T10:00:00.000Z')

    const manifestPath = join(workspaceRoot, 'learning-sessions', 'session-time-order', 'session.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.completedAt = '2026-07-15T08:00:00.000Z'
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await expect(createLearningSessionLedger({ workspaceRoot }).load('session-time-order')).rejects.toMatchObject({
      code: 'corrupt_session',
      diagnostic: { code: 'invalid_session_manifest' }
    })
  })



  it('keeps remote-host and owner-initialization writer locks conservatively busy', async () => {
    const remoteWorkspace = await createWorkspace()
    const remoteLock = join(remoteWorkspace, '.learning-session-ledger-writer.lock')
    await mkdir(remoteLock)
    await writeFile(join(remoteLock, 'owner.json'), JSON.stringify({
      schemaVersion: 1,
      token: 'remote-owner-token',
      pid: 999_999,
      hostname: `${hostname()}-remote`,
      operation: 'scan',
      sessionId: null,
      acquiredAt: '2020-01-01T00:00:00.000Z'
    }), 'utf8')

    await expect(createLearningSessionLedger({
      workspaceRoot: remoteWorkspace,
      writerLockWaitMs: 0,
      writerLockStaleMs: 0
    }).scan()).rejects.toMatchObject({
      code: 'writer_busy',
      writerOwner: { token: 'remote-owner-token', operation: 'scan' }
    })

    const initializingWorkspace = await createWorkspace()
    await mkdir(join(initializingWorkspace, '.learning-session-ledger-writer.lock'))
    await expect(createLearningSessionLedger({
      workspaceRoot: initializingWorkspace,
      writerLockWaitMs: 0,
      writerLockStaleMs: 0
    }).scan()).rejects.toMatchObject({ code: 'writer_busy', writerOwner: null })
  })

  it.each(['EPERM', 'EBADF'] as const)(
    'retries an unstable writer-lock observation after a simulated Windows %s deletion race',
    async (errorCode) => {
      const workspaceRoot = await createWorkspace()
      const lockPath = join(workspaceRoot, '.learning-session-ledger-writer.lock')
      await mkdir(lockPath)
      let injected = false
      const ledger = createLearningSessionLedger({
        workspaceRoot,
        writerLockWaitMs: 2_000,
        testingFaults: {
          inject: async (point) => {
            if (injected || point !== 'after_writer_lock_lstat') return
            injected = true
            await rm(lockPath, { recursive: true, force: true })
            throw Object.assign(new Error(`simulated ${errorCode} during lock release`), { code: errorCode })
          }
        }
      })

      await expect(ledger.scan()).resolves.toMatchObject({ canonicalSessions: [] })
      expect(injected).toBe(true)
    }
  )

  it('fails closed when a stable writer-lock entry is a junction', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    await symlink(outsideRoot, join(workspaceRoot, '.learning-session-ledger-writer.lock'), 'junction')

    await expect(createLearningSessionLedger({ workspaceRoot, writerLockWaitMs: 100 }).scan())
      .rejects.toMatchObject({ code: 'unsafe_storage' })
  })

  it('retries an identity-changing lock race and then fails closed on the stable junction replacement', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    const lockPath = join(workspaceRoot, '.learning-session-ledger-writer.lock')
    await mkdir(lockPath)
    let replaced = false
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      writerLockWaitMs: 1_000,
      testingFaults: {
        inject: async (point) => {
          if (replaced || point !== 'after_writer_lock_lstat') return
          replaced = true
          await rm(lockPath, { recursive: true, force: true })
          await symlink(outsideRoot, lockPath, 'junction')
        }
      }
    })

    await expect(ledger.scan()).rejects.toMatchObject({ code: 'unsafe_storage' })
    expect(replaced).toBe(true)
  })

  it('reports and bounded-cleans stale safe stage files without treating them as canonical facts', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    await openSession(ledger, 'session-stale-stage')
    const stagePath = join(workspaceRoot, 'learning-sessions', 'session-stale-stage', '.manifest-stage-review')
    await writeFile(stagePath, '{"partial":true}\n', 'utf8')
    await utimes(stagePath, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))

    const scan = await ledger.scan()

    expect(scan.stages).toContainEqual(expect.objectContaining({
      relativePath: 'learning-sessions/session-stale-stage/.manifest-stage-review',
      kind: 'manifest',
      state: 'cleaned'
    }))
    expect(scan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'stale_session_stage',
      sessionId: 'session-stale-stage'
    }))
    await expect(access(stagePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves over-limit Session stage trees with a typed unsafe diagnostic', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    await openSession(ledger, 'session-stage-root')
    const stagePath = join(
      workspaceRoot,
      'learning-sessions',
      '.session-stage-session-bounded-stage-00000000-0000-4000-8000-000000000000'
    )
    await mkdir(stagePath)
    await Promise.all(Array.from({ length: 64 }, (_, index) =>
      writeFile(join(stagePath, `entry-${index}.json`), '{}\n', 'utf8')
    ))
    await utimes(stagePath, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))

    const scan = await ledger.scan()

    expect(scan.stages).toContainEqual(expect.objectContaining({
      relativePath: expect.stringContaining('.session-stage-session-bounded-stage-'),
      kind: 'session',
      state: 'unsafe'
    }))
    expect(scan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unsafe_session_stage',
      sessionId: 'session-bounded-stage'
    }))
    await expect(access(stagePath)).resolves.toBeUndefined()
  })

  it('preserves a stale Session stage containing a nested junction', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    await openSession(ledger, 'session-stage-junction-root')
    const stagePath = join(
      workspaceRoot,
      'learning-sessions',
      '.session-stage-session-nested-junction-00000000-0000-4000-8000-000000000000'
    )
    await mkdir(stagePath)
    await writeFile(join(outsideRoot, 'sentinel.txt'), 'preserve', 'utf8')
    await symlink(outsideRoot, join(stagePath, 'nested'), 'junction')
    await utimes(stagePath, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))

    const scan = await ledger.scan()

    expect(scan.stages).toContainEqual(expect.objectContaining({
      relativePath: expect.stringContaining('.session-stage-session-nested-junction-'),
      kind: 'session',
      state: 'unsafe'
    }))
    expect(await readFile(join(outsideRoot, 'sentinel.txt'), 'utf8')).toBe('preserve')
    await expect(access(stagePath)).resolves.toBeUndefined()
  })

  it('round-trips an immutable assessment binding and rejects every later addition, replacement, or deletion', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    const identity = {
      sessionId: 'session-assessment-binding',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Review', relativePath: 'courses/review' },
      lessonRef: {
        lessonId: 'lesson-1',
        title: 'Assessment binding',
        relativePath: 'courses/review/lesson/0001-assessment-binding.html',
        assessment: {
          relativePath: 'courses/review/lesson/0001-assessment-binding-assessment.html',
          contentSha256: 'a'.repeat(64)
        }
      }
    }

    const opened = await ledger.open(identity)
    const reloaded = await createLearningSessionLedger({ workspaceRoot }).load(identity.sessionId)
    expect(opened.lessonRef).toEqual(identity.lessonRef)
    expect(reloaded?.lessonRef).toEqual(identity.lessonRef)
    await expect(ledger.open(identity)).resolves.toMatchObject({ lessonRef: identity.lessonRef })
    await expect(ledger.open({ ...identity, lessonRef: { ...identity.lessonRef, assessment: undefined } })).rejects.toMatchObject({ code: 'identity_conflict' })
    await expect(ledger.open({ ...identity, lessonRef: { ...identity.lessonRef, assessment: { ...identity.lessonRef.assessment, contentSha256: 'b'.repeat(64) } } })).rejects.toMatchObject({ code: 'identity_conflict' })

    const legacyMissing = await ledger.open({
      sessionId: 'session-legacy-missing-assessment',
      workspaceId: 'workspace-1',
      courseRef: identity.courseRef,
      lessonRef: { lessonId: 'lesson-2', title: 'Legacy', relativePath: 'courses/review/lesson/0002-legacy.html' }
    })
    expect(legacyMissing.lessonRef).not.toHaveProperty('assessment')
    await expect(ledger.open({
      sessionId: legacyMissing.id,
      workspaceId: 'workspace-1',
      courseRef: identity.courseRef,
      lessonRef: { ...legacyMissing.lessonRef!, assessment: identity.lessonRef.assessment }
    })).rejects.toMatchObject({ code: 'identity_conflict' })
  })

  it('rejects unsafe lesson and conversation refs with the same Windows-portable rules', async () => {
    const workspaceRoot = await createWorkspace()
    const ledger = createLearningSessionLedger({ workspaceRoot })
    const identity = {
      sessionId: 'session-ref-all-fields',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Safe', relativePath: 'courses/safe' }
    }

    await expect(ledger.open({
      ...identity,
      lessonRef: { lessonId: 'lesson-1', title: 'Unsafe', relativePath: 'courses/safe/CON' }
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(ledger.open({
      ...identity,
      conversationRefs: [{ conversationId: 'conversation-1', relativePath: 'conversation/thread.json:stream' }]
    })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('fails closed when an append parent is swapped to a junction after stage sync', async () => {
    const workspaceRoot = await createWorkspace()
    const outsideRoot = await createWorkspace()
    const eventsPath = join(workspaceRoot, 'learning-sessions', 'session-parent-swap', 'events')
    const originalEventsPath = `${eventsPath}-original`
    let swapped = false
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      testingFaults: {
        inject: async (point, context) => {
          if (swapped || point !== 'after_stage_sync' || !context.path?.includes('/events/.event-stage-')) return
          swapped = true
          await rename(eventsPath, originalEventsPath)
          await symlink(outsideRoot, eventsPath, 'junction')
        }
      }
    })
    await openSession(ledger, 'session-parent-swap')

    await expect(ledger.append('session-parent-swap', {
      schemaVersion: 1,
      eventId: 'event-parent-swap',
      sessionId: 'session-parent-swap',
      kind: 'retrieval_attempted',
      occurredAt: '2026-07-15T14:00:00.000Z',
      payload: { protected: true }
    })).rejects.toMatchObject({ code: expect.stringMatching(/unsafe_storage|corrupt_session/) })
    expect(swapped).toBe(true)
    expect(await access(outsideRoot).then(() => true)).toBe(true)
    expect(await import('node:fs/promises').then(({ readdir }) => readdir(outsideRoot))).toEqual([])
  })

  it('projects canonical and legacy Sessions through an explicit discriminated summary contract', async () => {
    const workspaceRoot = await createWorkspace()
    const canonical = await openSession(createLearningSessionLedger({ workspaceRoot }), 'session-summary')
    const legacy = projectLegacyLessonToLearningSession(legacyLesson({ sessionId: 'lesson-0002' }), 'workspace-1')

    expect(projectLearningSessionToTeachingSummary(canonical)).toMatchObject({
      kind: 'canonical_learning_session',
      source: 'canonical',
      id: 'session-summary',
      lessonRef: null
    })
    expect(projectLearningSessionToTeachingSummary(legacy)).toMatchObject({
      kind: 'legacy_lesson_projection',
      source: 'legacy_lesson',
      id: 'lesson-0002'
    })
    expect(projectLearningSessionToTeachingSummary(canonical)).not.toHaveProperty('lesson')
  })
})

async function openSession(ledger: ReturnType<typeof createLearningSessionLedger>, sessionId: string) {
  return ledger.open({
    sessionId,
    workspaceId: 'workspace-1',
    courseRef: { courseId: 'course-1', courseName: 'Review', relativePath: 'courses/review' }
  })
}

async function commitOutcome(workspaceRoot: string, sessionId: string) {
  const { encodeCommittedLearningSessionOutcome } = await import('../../src/main/learning-session-ledger')
  const committed = encodeCommittedLearningSessionOutcome({
    sessionId,
    outcomeId: 'outcome-time',
    kind: 'not_evidenced',
    evidenceEventIds: []
  })
  await writeFile(join(workspaceRoot, ...committed.ref.relativePath.split('/')), committed.content, 'utf8')
  return committed
}

function legacyLesson(overrides: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id: '0001',
    title: 'Legacy Lesson',
    objective: 'Preserve old facts',
    prompt: 'legacy',
    createdAt: '2026-07-14T00:00:00.000Z',
    durationMinutes: 10,
    courseId: 'course-1',
    courseName: 'Review',
    courseRelativePath: 'courses/review',
    courseAbsolutePath: 'C:/workspace/courses/review',
    sessionId: 'lesson-0001',
    sessionName: 'Legacy Session',
    sessionRelativePath: 'courses/review/lesson',
    sessionAbsolutePath: 'C:/workspace/courses/review/lesson',
    relativePath: 'courses/review/lesson/0001-legacy.html',
    absolutePath: 'C:/workspace/courses/review/lesson/0001-legacy.html',
    ...overrides
  }
}