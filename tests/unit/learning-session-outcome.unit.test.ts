import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import {
  createLearningSessionLedger,
  encodeCommittedLearningSessionOutcome
} from '../../src/main/learning-session-ledger'
import type { LearningOutcomeRef } from '../../src/shared/teaching-types/learning-session'

const roots: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-learning-session-outcome-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningSessionLedger committed outcome barrier', () => {
  it('requires a ledger-owned committed envelope and revalidates it on every completed load', async () => {
    const { workspaceRoot, ledger, outcomePath, committed } = await createSessionWithOutcome('session-outcome-barrier')

    await expect(ledger.complete('session-outcome-barrier', committed.ref)).resolves.toMatchObject({
      status: 'completed',
      outcomeRef: committed.ref
    })
    await unlink(outcomePath)
    await expect(createLearningSessionLedger({ workspaceRoot }).load('session-outcome-barrier')).rejects.toMatchObject({
      code: 'corrupt_session',
      diagnostic: { code: 'invalid_session_outcome', sessionId: 'session-outcome-barrier' }
    })
  })

  it.each([
    ['empty envelope', '{}\n'],
    ['mismatched identity', JSON.stringify({
      schemaVersion: 1,
      sessionId: 'session-outcome-negative',
      outcomeId: 'other-outcome',
      kind: 'needs_practice',
      relativePath: 'learning-sessions/session-outcome-negative/outcome.json',
      evidenceEventIds: ['event-outcome-evidence']
    }, null, 2) + '\n'],
    ['unknown schema', JSON.stringify({
      schemaVersion: 999,
      sessionId: 'session-outcome-negative',
      outcomeId: 'outcome-barrier',
      kind: 'needs_practice',
      relativePath: 'learning-sessions/session-outcome-negative/outcome.json',
      evidenceEventIds: ['event-outcome-evidence']
    }, null, 2) + '\n']
  ])('rejects %s even when the caller supplies its exact byte digest', async (_label, content) => {
    const { ledger, outcomePath, committed } = await createSessionWithOutcome('session-outcome-negative')
    await writeFile(outcomePath, content, 'utf8')
    const ref: LearningOutcomeRef = { ...committed.ref, contentSha256: digest(content) }

    await expect(ledger.complete('session-outcome-negative', ref)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(ledger.load('session-outcome-negative')).resolves.toMatchObject({ status: 'active', outcomeRef: null })
  })

  it('rejects an oversized outcome before parsing it', async () => {
    const { ledger, outcomePath, committed } = await createSessionWithOutcome('session-outcome-oversized')
    const content = `${' '.repeat(256 * 1024)}{}`
    await writeFile(outcomePath, content, 'utf8')

    await expect(ledger.complete('session-outcome-oversized', {
      ...committed.ref,
      contentSha256: digest(content)
    })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('quarantines a completed Session when the committed bytes are replaced', async () => {
    const { workspaceRoot, ledger, outcomePath, committed } = await createSessionWithOutcome('session-outcome-replaced')
    await ledger.complete('session-outcome-replaced', committed.ref)
    await writeFile(outcomePath, `${committed.content}\n`, 'utf8')

    await expect(createLearningSessionLedger({ workspaceRoot }).load('session-outcome-replaced')).rejects.toMatchObject({
      code: 'corrupt_session',
      diagnostic: { code: 'invalid_session_outcome' }
    })
  })

  it('detects outcome growth after the opened-handle stat barrier', async () => {
    const workspaceRoot = await createWorkspace()
    let mutated = false
    const ledger = createLearningSessionLedger({
      workspaceRoot,
      now: () => '2026-07-15T13:00:00.000Z',
      testingFaults: {
        inject: async (point, context) => {
          if (mutated || point !== 'after_file_stat' || !context.path?.endsWith('/outcome.json')) return
          mutated = true
          await writeFile(join(workspaceRoot, ...context.path.split('/')), '{}\n', { flag: 'a' })
        }
      }
    })
    await ledger.open({
      sessionId: 'session-outcome-grow',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Outcome', relativePath: 'courses/outcome' }
    })
    const committed = encodeCommittedLearningSessionOutcome({
      sessionId: 'session-outcome-grow',
      outcomeId: 'outcome-grow',
      kind: 'not_evidenced',
      evidenceEventIds: []
    })
    const outcomePath = join(workspaceRoot, ...committed.ref.relativePath.split('/'))
    await writeFile(outcomePath, committed.content, 'utf8')

    await expect(ledger.complete('session-outcome-grow', committed.ref)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(mutated).toBe(true)
  })
  it('rejects a junction/reparse entry at the canonical outcome path', async () => {
    const { ledger, outcomePath, committed } = await createSessionWithOutcome('session-outcome-junction')
    const outside = await createWorkspace()
    await rm(outcomePath)
    await mkdir(outside, { recursive: true })
    await symlink(outside, outcomePath, 'junction')

    await expect(ledger.complete('session-outcome-junction', committed.ref)).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

async function createSessionWithOutcome(sessionId: string) {
  const workspaceRoot = await createWorkspace()
  const ledger = createLearningSessionLedger({
    workspaceRoot,
    now: () => '2026-07-15T13:00:00.000Z'
  })
  await ledger.open({
    sessionId,
    workspaceId: 'workspace-1',
    courseRef: { courseId: 'course-1', courseName: 'Outcome', relativePath: 'courses/outcome' }
  })
  await ledger.append(sessionId, {
    schemaVersion: 1,
    eventId: 'event-outcome-evidence',
    sessionId,
    kind: 'retrieval_attempted',
    occurredAt: '2026-07-15T13:00:00.000Z',
    payload: { correct: false }
  })
  const committed = encodeCommittedLearningSessionOutcome({
    sessionId,
    outcomeId: 'outcome-barrier',
    kind: 'needs_practice',
    evidenceEventIds: ['event-outcome-evidence']
  })
  const outcomePath = join(workspaceRoot, ...committed.ref.relativePath.split('/'))
  await mkdir(dirname(outcomePath), { recursive: true })
  await writeFile(outcomePath, committed.content, 'utf8')
  return { workspaceRoot, ledger, outcomePath, committed }
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
