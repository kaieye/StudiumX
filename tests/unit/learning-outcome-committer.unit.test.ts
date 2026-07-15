import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningOutcomeCommitter } from '../../src/main/learning-outcome-committer'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import type { LearningOutcomeEvaluation } from '../../src/main/learning-outcome-evaluator'
import type { LegacyLearningSessionSnapshot } from '../../src/shared/teaching-types/learning-session'

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
  it('keeps evaluation read-only and settles needs_practice as a no-record committed result', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot)
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      evaluate: async ({ session }) => decision(session.id, 'needs_practice')
    })

    await expect(committer.evaluate({ sessionId: 'session-committer-unit' })).resolves.toMatchObject({ kind: 'needs_practice' })
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
    const result = await committer.commit({ sessionId: 'session-committer-unit', operationId: 'practice-1' })
    expect(result).toMatchObject({
      status: 'committed',
      outcome: { kind: 'needs_practice' },
      recordSaved: false,
      record: null
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns insufficient_evidence for not_evidenced without settling a record or completed Session', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-not-evidenced-unit')
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      evaluate: async ({ session }) => decision(session.id, 'not_evidenced')
    })

    await expect(committer.commit({ sessionId: 'session-not-evidenced-unit', operationId: 'not-evidenced-1' })).resolves.toEqual({
      status: 'insufficient_evidence',
      reason: 'not_evidenced'
    })
    await expect(readFile(join(workspaceRoot, 'learning-sessions', 'session-not-evidenced-unit', 'outcome-settlement.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load('session-not-evidenced-unit')).resolves.toMatchObject({ status: 'active' })
  })

  it('returns a non-retryable invalid_request instead of raw evaluator failure when record evidence is invalid', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-ungated-unit')
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      evaluate: async ({ session }) => decision(session.id, 'established')
    })

    await expect(committer.commit({ sessionId: 'session-ungated-unit', operationId: 'ungated-operation-1' })).resolves.toEqual({
      status: 'non_retryable_failure',
      reason: 'invalid_request'
    })
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
      status: 'committed',
      outcome: { outcomeId: 'outcome-established-1', kind: 'established', evidenceEventIds: ['evidence-established-1'] },
      recordSaved: true,
      record: { relativePath: 'learning-records/outcome-session-established-unit.md' }
    })
    await expect(committer.commit({ sessionId: 'session-established-unit', operationId: 'outcome-operation-1' })).resolves.toMatchObject({
      status: 'already_committed', outcome: { outcomeId: 'outcome-established-1' }, recordSaved: true
    })
    expect((await readdir(join(workspaceRoot, 'learning-records'))).filter((file) => file.endsWith('.md'))).toEqual([
      'outcome-session-established-unit.md'
    ])
  })

  it('returns reconciliation_required in the post-publish fault window, then read-repairs without a duplicate', async () => {
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

    await expect(interrupted.commit({ sessionId: 'session-repair-unit', operationId: 'outcome-repair-operation-1' })).resolves.toEqual({
      status: 'retryable_failure',
      reason: 'reconciliation_required'
    })
    const recovered = createLearningOutcomeCommitter(options)
    await expect(recovered.reconcile('session-repair-unit')).resolves.toMatchObject({
      state: 'repaired',
      marker: { operationId: 'outcome-repair-operation-1', kind: 'established' },
      record: { relativePath: 'learning-records/outcome-session-repair-unit.md' }
    })
    await expect(recovered.commit({ sessionId: 'session-repair-unit', operationId: 'outcome-repair-operation-1' })).resolves.toMatchObject({
      status: 'already_committed', recordSaved: true
    })
    expect((await readdir(join(workspaceRoot, 'learning-records'))).filter((file) => file.endsWith('.md'))).toEqual([
      'outcome-session-repair-unit.md'
    ])
  })

  it('returns conflict without completing or overwriting when the marker conflicts with a canonical record', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-conflict-unit')
    await appendEvidence(ledger, 'session-conflict-unit', 'evidence-conflict-1')
    const options = {
      workspaceRoot,
      ledger,
      createId: () => 'outcome-conflict-record-1',
      evaluate: async ({ session }: { session: { id: string } }) => decision(session.id, 'established', ['evidence-conflict-1'])
    }
    const interrupted = createLearningOutcomeCommitter({
      ...options,
      testingFaults: {
        inject(point) {
          if (point === 'after_record_publish') throw new Error('simulated crash after record publish')
        }
      }
    })

    await interrupted.commit({ sessionId: 'session-conflict-unit', operationId: 'outcome-conflict-operation-1' })
    const markerPath = join(workspaceRoot, 'learning-sessions', 'session-conflict-unit', 'outcome-settlement.json')
    const conflictingMarker = {
      schemaVersion: 1, sessionId: 'session-conflict-unit', outcomeId: 'different-outcome-1', operationId: 'different-operation-1',
      kind: 'established', evidenceEventIds: ['different-evidence-1'], evaluatorVersion: 1,
      record: {
        recordId: 'learning-outcome-session-conflict-unit-different-outcome-1',
        relativePath: 'learning-records/outcome-session-conflict-unit.md',
        contentSha256: 'b'.repeat(64)
      }
    }
    await writeFile(markerPath, `${JSON.stringify(conflictingMarker)}\n`, 'utf8')
    const recovered = createLearningOutcomeCommitter(options)
    const outcomePath = join(workspaceRoot, 'learning-sessions', 'session-conflict-unit', 'outcome.json')

    await expect(recovered.reconcile('session-conflict-unit')).resolves.toMatchObject({
      state: 'review_required', diagnostics: ['conflicting_outcome']
    })
    await expect(recovered.commit({ sessionId: 'session-conflict-unit', operationId: 'outcome-conflict-operation-1' })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    await expect(readFile(outcomePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load('session-conflict-unit')).resolves.toMatchObject({ status: 'active' })
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(`${JSON.stringify(conflictingMarker)}\n`)
  })

  it('returns stable non-retryable results for invalid Session, invalid request, and missing Session', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-input-unit')
    const committer = createLearningOutcomeCommitter({ workspaceRoot, ledger })

    await expect(committer.commit({ sessionId: '../unsafe', operationId: 'operation-1' })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'invalid_session'
    })
    await expect(committer.commit({ sessionId: 'session-input-unit', operationId: 'not valid' })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'invalid_request'
    })
    await expect(committer.commit({ sessionId: 'session-missing-unit', operationId: 'operation-1' })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'not_found'
    })

    const readOnlyLedger = createLearningSessionLedger({
      workspaceRoot,
      resolveLegacySession: async (sessionId): Promise<LegacyLearningSessionSnapshot | null> => sessionId === 'session-read-only-unit'
        ? {
            schemaVersion: 1, id: sessionId, workspaceId: null, source: 'legacy_lesson', readOnly: true, status: 'legacy_read_only',
            version: 0, createdAt: '2026-07-15T14:00:00.000Z', updatedAt: '2026-07-15T14:00:00.000Z', completedAt: null,
            courseRef: { courseId: 'legacy-course', courseName: 'Legacy', relativePath: 'courses/legacy' },
            lessonRef: { lessonId: 'legacy-lesson', title: 'Legacy', relativePath: 'courses/legacy/lesson.html' },
            conversationRefs: [], eventCount: 0, outcomeRef: null, events: []
          }
        : null
    })
    const readOnlyCommitter = createLearningOutcomeCommitter({ workspaceRoot, ledger: readOnlyLedger })
    await expect(readOnlyCommitter.commit({ sessionId: 'session-read-only-unit', operationId: 'operation-1' })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'read_only'
    })
  })

  it('returns temporarily_unavailable without exposing an evaluator error before any write begins', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-unavailable-unit')
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      evaluate: async () => { throw new Error('provider socket reset: private details') }
    })

    await expect(committer.commit({ sessionId: 'session-unavailable-unit', operationId: 'unavailable-1' })).resolves.toEqual({
      status: 'retryable_failure',
      reason: 'temporarily_unavailable'
    })
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a symlink at the canonical record path during reconciliation', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-symlink-unit')
    const recordsDirectory = join(workspaceRoot, 'learning-records')
    const targetPath = join(workspaceRoot, 'outside-canonical-record.md')
    const canonicalPath = join(recordsDirectory, 'outcome-session-symlink-unit.md')
    await mkdir(recordsDirectory, { recursive: true })
    await writeFile(targetPath, '<!-- studiumx-learning-outcome {} -->\n', 'utf8')
    try {
      await symlink(targetPath, canonicalPath, 'file')
    } catch (error) {
      expect(error).toMatchObject({ code: 'EPERM' })
      return
    }
    const committer = createLearningOutcomeCommitter({ workspaceRoot, ledger })

    await expect(committer.reconcile('session-symlink-unit')).resolves.toMatchObject({ state: 'pending', record: null })
  })

  it('reports legacy_generated records as read-only diagnostics without upgrading their bytes', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-legacy-unit')
    const legacyPath = join(workspaceRoot, 'learning-records', 'legacy.md')
    const legacy = '# Historical note\n\nlegacy_generated\n'
    await mkdir(join(workspaceRoot, 'learning-records'), { recursive: true })
    await writeFile(legacyPath, legacy, 'utf8')
    const committer = createLearningOutcomeCommitter({ workspaceRoot, ledger })

    await expect(committer.reconcile('session-legacy-unit')).resolves.toMatchObject({ state: 'pending', diagnostics: ['legacy_generated'] })
    await expect(readFile(legacyPath, 'utf8')).resolves.toBe(legacy)
  })
})