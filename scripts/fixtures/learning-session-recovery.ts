import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'

const root = await mkdtemp(join(tmpdir(), 'studiumx-session-recovery-fixture-'))
const outside = await mkdtemp(join(tmpdir(), 'studiumx-session-recovery-outside-'))
try {
  const times = ['2026-07-15T12:00:00.000Z', '2026-07-15T12:00:01.000Z']
  const ledger = createLearningSessionLedger({
    workspaceRoot: root,
    now: () => times.shift() ?? '2026-07-15T12:00:02.000Z'
  })
  const openInput = {
    workspaceId: 'workspace-recovery',
    courseRef: { courseId: 'course-recovery', courseName: 'Recovery', relativePath: 'courses/recovery' }
  }
  await ledger.open({ ...openInput, sessionId: 'session-recovery' })
  await ledger.open({
    ...openInput,
    sessionId: 'session-recovery',
    conversationRefs: [{ conversationId: 'conversation-recovery', relativePath: 'conversation/conversation-recovery.json' }]
  })
  const manifestPath = join(root, 'learning-sessions', 'session-recovery', 'session.json')
  const oldManifest = await readFile(manifestPath, 'utf8')
  await ledger.append('session-recovery', {
    schemaVersion: 1,
    eventId: 'event-durable-before-manifest',
    sessionId: 'session-recovery',
    kind: 'lesson_opened',
    occurredAt: '2026-07-15T12:00:00.500Z',
    payload: {}
  })
  await writeFile(manifestPath, oldManifest, 'utf8')
  await writeFile(join(root, 'learning-sessions', 'session-recovery', '.manifest-stage-crash'), '{"partial":true}', 'utf8')

  const restarted = createLearningSessionLedger({ workspaceRoot: root })
  const repaired = await restarted.load('session-recovery')
  assert.equal(repaired?.eventCount, 1)
  assert.equal(repaired?.version, 3)
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).eventCount, 1)

  await ledger.open({ ...openInput, sessionId: 'session-corrupt' })
  await ledger.open({ ...openInput, sessionId: 'session-healthy' })
  const corruptPath = join(root, 'learning-sessions', 'session-corrupt', 'session.json')
  const corruptBytes = '{not-json\n'
  await writeFile(corruptPath, corruptBytes, 'utf8')
  await assert.rejects(
    restarted.load('session-corrupt'),
    (error: unknown) => hasCode(error, 'corrupt_session') && hasDiagnosticSession(error, 'session-corrupt')
  )
  assert.equal(await readFile(corruptPath, 'utf8'), corruptBytes)
  assert.equal((await restarted.load('session-healthy'))?.status, 'active')
  await assert.rejects(restarted.load('../escape'), (error: unknown) => hasCode(error, 'invalid_input'))

  const symlinkRoot = await mkdtemp(join(tmpdir(), 'studiumx-session-symlink-fixture-'))
  try {
    try {
      await symlink(outside, join(symlinkRoot, 'learning-sessions'), 'junction')
      const unsafeLedger = createLearningSessionLedger({ workspaceRoot: symlinkRoot })
      await assert.rejects(
        unsafeLedger.open({ ...openInput, sessionId: 'session-escape' }),
        (error: unknown) => hasCode(error, 'unsafe_storage')
      )
      await assert.rejects(access(join(outside, 'session-escape')), (error: unknown) => hasCode(error, 'ENOENT'))
    } catch (error) {
      if (!hasCode(error, 'EPERM')) throw error
    }
  } finally {
    await rm(symlinkRoot, { recursive: true, force: true })
  }
  console.log('Learning Session recovery check passed.')
} finally {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function hasDiagnosticSession(error: unknown, sessionId: string): boolean {
  if (!(error instanceof Error) || !('diagnostic' in error)) return false
  const diagnostic = error.diagnostic
  return typeof diagnostic === 'object' && diagnostic !== null && 'sessionId' in diagnostic && diagnostic.sessionId === sessionId
}
