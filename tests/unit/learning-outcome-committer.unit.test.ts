import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningOutcomeCommitter } from '../../src/main/learning-outcome-committer'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import type { LearningOutcomeEvaluation } from '../../src/main/learning-outcome-evaluator'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-outcome-committer-unit-'))
  roots.push(root)
  return root
}

function decision(sessionId: string, kind: LearningOutcomeEvaluation['kind'], evidenceEventIds: string[] = []): LearningOutcomeEvaluation {
  return {
    schemaVersion: 1,
    sessionId,
    kind,
    mastery: kind === 'established',
    evidenceEventIds,
    artifact: kind === 'established'
      ? { relativePath: 'courses/foundations/lesson-1-assessment.html', sha256: 'a'.repeat(64), status: 'verified' }
      : { relativePath: null, sha256: null, status: 'missing_assessment' },
    assessments: []
  }
}

async function openSession(workspaceRoot: string, sessionId = 'session-committer-unit') {
  const ledger = createLearningSessionLedger({ workspaceRoot, now: () => '2026-07-15T14:00:00.000Z' })
  await ledger.open({
    sessionId,
    workspaceId: 'workspace-1',
    courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
    lessonRef: { lessonId: 'lesson-1', title: 'Evidence', relativePath: 'courses/foundations/lesson-1.html' }
  })
  return ledger
}

async function appendEvidence(ledger: ReturnType<typeof createLearningSessionLedger>, sessionId: string, eventId: string) {
  await ledger.append(sessionId, {
    schemaVersion: 1,
    eventId,
    sessionId,
    kind: 'quiz_attempted',
    occurredAt: '2026-07-15T14:00:01.000Z',
    payload: {}
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LearningOutcomeCommitter', () => {
  it('keeps evaluation read-only and settles needs_practice without publishing a Learning record', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot)
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      evaluate: async ({ session }) => decision(session.id, 'needs_practice')
    })

    await expect(committer.evaluate({ sessionId: 'session-committer-unit' })).resolves.toMatchObject({ kind: 'needs_practice' })
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(committer.commit({ sessionId: 'session-committer-unit', operationId: 'practice-1' })).resolves.toMatchObject({
      disposition: 'committed', outcome: { kind: 'needs_practice' }, record: null
    })
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects evaluator success without verified evidence before any Learning record is staged', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-ungated-unit')
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      evaluate: async ({ session }) => decision(session.id, 'established')
    })

    await expect(committer.commit({ sessionId: 'session-ungated-unit', operationId: 'ungated-operation-1' })).rejects.toThrow(
      'Learning record publication requires verified mastery evidence.'
    )
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('publishes one evidence-gated established record and makes the operation retry idempotent', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-established-unit')
    await appendEvidence(ledger, 'session-established-unit', 'evidence-established-1')
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => 'outcome-established-1',
      evaluate: async ({ session }) => decision(session.id, 'established', ['evidence-established-1'])
    })

    await expect(committer.commit({ sessionId: 'session-established-unit', operationId: 'outcome-operation-1' })).resolves.toMatchObject({
      disposition: 'committed',
      outcome: { outcomeId: 'outcome-established-1', kind: 'established', evidenceEventIds: ['evidence-established-1'] },
      record: { relativePath: 'learning-records/outcome-session-established-unit.md' }
    })
    await expect(committer.commit({ sessionId: 'session-established-unit', operationId: 'outcome-operation-1' })).resolves.toMatchObject({
      disposition: 'already_committed', outcome: { outcomeId: 'outcome-established-1' }
    })
    expect((await readdir(join(workspaceRoot, 'learning-records'))).filter((file) => file.endsWith('.md'))).toEqual([
      'outcome-session-established-unit.md'
    ])
  })

  it('read-repairs a record published before its outcome marker without creating a duplicate', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-repair-unit')
    await appendEvidence(ledger, 'session-repair-unit', 'evidence-repair-1')
    const options = {
      workspaceRoot,
      ledger,
      createId: () => 'outcome-repair-1',
      evaluate: async ({ session }: { session: { id: string } }) => decision(session.id, 'established', ['evidence-repair-1'])
    }
    const interrupted = createLearningOutcomeCommitter({
      ...options,
      testingFaults: {
        inject(point) {
          if (point === 'after_record_publish') throw new Error('simulated crash after record publish')
        }
      }
    })

    await expect(interrupted.commit({ sessionId: 'session-repair-unit', operationId: 'outcome-repair-operation-1' })).rejects.toThrow('simulated crash')
    const recovered = createLearningOutcomeCommitter(options)
    await expect(recovered.reconcile('session-repair-unit')).resolves.toMatchObject({
      state: 'repaired',
      marker: { operationId: 'outcome-repair-operation-1', kind: 'established' },
      record: { relativePath: 'learning-records/outcome-session-repair-unit.md' }
    })
    await expect(recovered.commit({ sessionId: 'session-repair-unit', operationId: 'outcome-repair-operation-1' })).resolves.toMatchObject({
      disposition: 'already_committed'
    })
    expect((await readdir(join(workspaceRoot, 'learning-records'))).filter((file) => file.endsWith('.md'))).toEqual([
      'outcome-session-repair-unit.md'
    ])
  })

  it('reports legacy_generated records as read-only diagnostics without upgrading their bytes', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-legacy-unit')
    const legacyPath = join(workspaceRoot, 'learning-records', 'legacy.md')
    const legacy = '# Historical note\n\nlegacy_generated\n'
    await mkdir(join(workspaceRoot, 'learning-records'), { recursive: true })
    await writeFile(legacyPath, legacy, 'utf8')
    const committer = createLearningOutcomeCommitter({ workspaceRoot, ledger })

    await expect(committer.reconcile('session-legacy-unit')).resolves.toMatchObject({
      state: 'pending', diagnostics: ['legacy_generated']
    })
    await expect(readFile(legacyPath, 'utf8')).resolves.toBe(legacy)
  })
})
