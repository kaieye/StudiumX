import { link, lstat, mkdir, mkdtemp, open as openFile, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { createLearningOutcomeCommitter } from '../../src/main/learning-outcome-committer'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import type { LearningSessionLedger, LearningSessionLedgerOptions } from '../../src/main/learning-session-ledger'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import type { LearningOutcomeEvaluation } from '../../src/main/learning-outcome-evaluator'
import type { LegacyLearningSessionSnapshot } from '../../src/shared/teaching-types/learning-session'

const roots: string[] = []
const DIRECTORY_FSYNC_WARNING = '[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'

type InstrumentedDurableOperations = {
  operations: DurableFileOperations
  events: string[]
}

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

function instrumentedDurableOperations(options: {
  fail?: (event: string) => Error | undefined
} = {}): InstrumentedDurableOperations {
  const events: string[] = []
  const observe = (event: string): void => {
    events.push(event)
    const failure = options.fail?.(event)
    if (failure) throw failure
  }

  return {
    events,
    operations: {
      mkdir,
      readFile,
      open: async (path, flags, mode) => {
        observe(`open:${flags}:${path}`)
        const handle = await openFile(path, flags, mode)
        return {
          writeFile: async (content) => {
            observe(`write:${path}`)
            await handle.writeFile(content)
          },
          sync: async () => {
            observe(`sync:${path}`)
            // Windows cannot fsync directory handles. The production primitive
          // downgrades that native capability gap; retain injected faults above.
          if (process.platform === 'win32' && (await handle.stat()).isDirectory()) return
          await handle.sync()
          },
          // Always release the native descriptor before surfacing an injected
          // close failure, so tests do not leak handles.
          close: async () => {
            const event = `close:${path}`
            events.push(event)
            const failure = options.fail?.(event)
            await handle.close()
            if (failure) throw failure
          }
        }
      },
      rename: async (from, to) => {
        observe(`rename:${from}->${to}`)
        await rename(from, to)
      },
      rm: async (path, rmOptions) => {
        observe(`rm:${path}`)
        await rm(path, rmOptions)
      }
    }
  }
}

function sessionDirectory(workspaceRoot: string, sessionId: string): string {
  return join(workspaceRoot, 'learning-sessions', sessionId)
}

function recordPath(workspaceRoot: string, sessionId: string): string {
  return join(workspaceRoot, 'learning-records', `outcome-${sessionId}.md`)
}

function stagePath(workspaceRoot: string, sessionId: string, outcomeId: string, operationId: string): string {
  return join(
    workspaceRoot,
    'learning-records',
    '.learning-outcome-committer-stage',
    `learning-outcome-${sessionId}-${outcomeId}.${operationId}.md`
  )
}

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

async function openSession(
  workspaceRoot: string,
  sessionId = 'session-committer-unit',
  options: Pick<LearningSessionLedgerOptions, 'testingFaults'> = {}
) {
  const ledger = createLearningSessionLedger({ workspaceRoot, now: () => '2026-07-15T14:00:00.000Z', ...options })
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
  it('fails safely without inspecting or writing when injected through the load-only workspace ledger boundary', async () => {
    const workspaceRoot = await workspace()
    let loadCalls = 0
    const loadOnlyLedger = {
      load: async () => {
        loadCalls += 1
        return null
      }
    } as unknown as LearningSessionLedger
    const committer = createLearningOutcomeCommitter({ workspaceRoot, ledger: loadOnlyLedger })

    await expect(committer.commit({ sessionId: 'session-load-only-unit', operationId: 'load-only-1' })).resolves.toEqual({
      status: 'retryable_failure', reason: 'temporarily_unavailable'
    })
    await expect(committer.reconcile('session-load-only-unit')).resolves.toMatchObject({
      sessionId: 'session-load-only-unit', state: 'review_required', marker: null, record: null
    })
    expect(loadCalls).toBe(0)
    await expect(readdir(workspaceRoot)).resolves.toEqual([])
  })

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

  it('durably settles not_evidenced recordlessly while returning typed insufficient_evidence on replay', async () => {
    const workspaceRoot = await workspace()
    const ledger = await openSession(workspaceRoot, 'session-not-evidenced-unit')
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => 'outcome-not-evidenced-1',
      evaluate: async ({ session }) => decision(session.id, 'not_evidenced')
    })
    const request = { sessionId: 'session-not-evidenced-unit', operationId: 'not-evidenced-1' }
    const expected = { status: 'insufficient_evidence', reason: 'not_evidenced' }

    await expect(committer.commit(request)).resolves.toEqual(expected)
    const marker = JSON.parse(await readFile(
      join(workspaceRoot, 'learning-sessions', 'session-not-evidenced-unit', 'outcome-settlement.json'),
      'utf8'
    )) as Record<string, unknown>
    expect(marker).toMatchObject({
      sessionId: 'session-not-evidenced-unit',
      outcomeId: 'outcome-not-evidenced-1',
      operationId: 'not-evidenced-1',
      kind: 'not_evidenced',
      record: null
    })
    await expect(committer.commit(request)).resolves.toEqual(expected)
    await expect(committer.reconcile('session-not-evidenced-unit')).resolves.toMatchObject({
      state: 'settled',
      marker: { operationId: 'not-evidenced-1', kind: 'not_evidenced', record: null },
      record: null
    })
    await expect(readFile(join(workspaceRoot, 'learning-sessions', 'session-not-evidenced-unit', 'outcome.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(join(workspaceRoot, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load('session-not-evidenced-unit')).resolves.toMatchObject({ status: 'active', outcomeRef: null })
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

  it('uses a durable record as repair authority after publication before projections exist', async () => {
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
    await expect(readFile(recordPath(workspaceRoot, 'session-repair-unit'), 'utf8')).resolves.toContain('outcome-repair-1')
    await expect(readFile(join(sessionDirectory(workspaceRoot, 'session-repair-unit'), 'outcome.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(sessionDirectory(workspaceRoot, 'session-repair-unit'), 'outcome-settlement.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load('session-repair-unit')).resolves.toMatchObject({ status: 'active', outcomeRef: null })
    await expect(readdir(join(workspaceRoot, 'learning-records', '.learning-outcome-committer-stage'))).resolves.toEqual([])
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

  it('repairs an after-record-publish interruption after restart without reevaluation or false success', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-after-record-publish-restart-unit'
    const outcomeId = 'outcome-after-record-publish-restart-1'
    const operationId = 'after-record-publish-restart-operation-1'
    const evidenceEventId = 'evidence-after-record-publish-restart-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const manifestPath = join(directory, 'session.json')
    const outcomePath = join(directory, 'outcome.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    const manifestBeforeCrash = await readFile(manifestPath, 'utf8')
    const injectedPoints: string[] = []
    let evaluationCalls = 0
    const options = {
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }: { session: { id: string } }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    }
    const interrupted = createLearningOutcomeCommitter({
      ...options,
      testingFaults: {
        inject(point) {
          injectedPoints.push(point)
          if (point === 'after_record_publish') throw new Error('simulated crash after record publish')
        }
      }
    })

    await expect(interrupted.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(injectedPoints).toEqual(['after_stage_flush', 'after_record_publish'])
    expect(evaluationCalls).toBe(1)
    const recordBeforeRestart = await readFile(recordPath(workspaceRoot, sessionId), 'utf8')
    expect(recordBeforeRestart).toContain(`\"sessionId\":\"${sessionId}\"`)
    expect(recordBeforeRestart).toContain(`\"outcomeId\":\"${outcomeId}\"`)
    await expect(readFile(outcomePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestBeforeCrash)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })

    const recovered = createLearningOutcomeCommitter(options)
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'repaired',
      marker: {
        sessionId,
        outcomeId,
        operationId,
        kind: 'established',
        evidenceEventIds: [evidenceEventId],
        record: { relativePath: `learning-records/outcome-${sessionId}.md` }
      },
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toBe(recordBeforeRestart)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({
      status: 'completed',
      outcomeRef: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] }
    })

    const recordAfterRepair = await readFile(recordPath(workspaceRoot, sessionId), 'utf8')
    const outcomeAfterRepair = await readFile(outcomePath, 'utf8')
    const manifestAfterRepair = await readFile(manifestPath, 'utf8')
    const markerAfterRepair = await readFile(markerPath, 'utf8')
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({ state: 'settled' })
    await expect(recovered.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'already_committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toBe(recordAfterRepair)
    await expect(readFile(outcomePath, 'utf8')).resolves.toBe(outcomeAfterRepair)
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestAfterRepair)
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(markerAfterRepair)
    expect(evaluationCalls).toBe(1)
  })

  it('recovers safely after a post-stage-flush interruption without promoting incomplete projections', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-after-stage-flush-restart-unit'
    const outcomeId = 'outcome-after-stage-flush-restart-1'
    const operationId = 'after-stage-flush-restart-operation-1'
    const evidenceEventId = 'evidence-after-stage-flush-restart-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const manifestPath = join(directory, 'session.json')
    const outcomePath = join(directory, 'outcome.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    const stagedRecordPath = stagePath(workspaceRoot, sessionId, outcomeId, operationId)
    const manifestBeforeCrash = await readFile(manifestPath, 'utf8')
    const injectedPoints: string[] = []
    let evaluationCalls = 0
    let createIdCalls = 0
    const options = {
      workspaceRoot,
      ledger,
      createId: () => {
        createIdCalls += 1
        return outcomeId
      },
      evaluate: async ({ session }: { session: { id: string } }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    }
    const interrupted = createLearningOutcomeCommitter({
      ...options,
      testingFaults: {
        inject(point) {
          injectedPoints.push(point)
          if (point === 'after_stage_flush') throw new Error('simulated crash after stage flush')
        }
      }
    })

    await expect(interrupted.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(injectedPoints).toEqual(['after_stage_flush'])
    expect(evaluationCalls).toBe(1)
    expect(createIdCalls).toBe(1)
    const stagedRecordBeforeRestart = await readFile(stagedRecordPath)
    expect(stagedRecordBeforeRestart.toString('utf8')).toContain(`\"outcomeId\":\"${outcomeId}\"`)
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(outcomePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestBeforeCrash)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      ...options,
      durableFileOperations: recoveryDurable.operations
    })
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'pending', marker: null, record: null, catalogRecordPresent: false
    })
    expect(recoveryDurable.events).toEqual([])
    expect(evaluationCalls).toBe(1)
    expect(createIdCalls).toBe(1)
    await expect(readFile(stagedRecordPath)).resolves.toEqual(stagedRecordBeforeRestart)
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(outcomePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestBeforeCrash)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(recoveryDurable.events).toEqual([`open:wx:${stagedRecordPath}`])
    expect(evaluationCalls).toBe(2)
    expect(createIdCalls).toBe(2)
    await expect(readFile(stagedRecordPath)).resolves.toEqual(stagedRecordBeforeRestart)
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(outcomePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestBeforeCrash)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
  })

  it('deterministically repairs an after-outcome-publication crash after restart without reevaluation or outcome rewrite', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-after-outcome-publish-restart-unit'
    const outcomeId = 'outcome-after-outcome-publish-restart-1'
    const operationId = 'after-outcome-publish-restart-operation-1'
    const evidenceEventId = 'evidence-after-outcome-publish-restart-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const manifestPath = join(directory, 'session.json')
    const outcomePath = join(directory, 'outcome.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    const injectedPoints: string[] = []
    let evaluationCalls = 0
    const options = {
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }: { session: { id: string } }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    }
    const interrupted = createLearningOutcomeCommitter({
      ...options,
      testingFaults: {
        inject(point) {
          injectedPoints.push(point)
          if (point === 'after_outcome_publish') throw new Error('simulated crash after outcome publish')
        }
      }
    })

    await expect(interrupted.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(injectedPoints).toEqual(['after_stage_flush', 'after_record_publish', 'after_outcome_publish'])
    const recordBeforeRestart = await readFile(recordPath(workspaceRoot, sessionId), 'utf8')
    const outcomeBeforeRestart = await readFile(outcomePath, 'utf8')
    expect(recordBeforeRestart).toContain(`\"sessionId\":\"${sessionId}\"`)
    expect(recordBeforeRestart).toContain(`\"outcomeId\":\"${outcomeId}\"`)
    expect(JSON.parse(outcomeBeforeRestart)).toMatchObject({
      sessionId,
      outcomeId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
    const manifestBeforeRestart = await readFile(manifestPath, 'utf8')

    const recoveryDurable = instrumentedDurableOperations()
    const recoveryPublicationOrder: string[] = []
    let manifestAtMarkerPublication: string | null = null
    const recoveryOperations: DurableFileOperations = {
      ...recoveryDurable.operations,
      rename: async (from, to) => {
        if (to === markerPath) {
          manifestAtMarkerPublication = await readFile(manifestPath, 'utf8')
          expect(JSON.parse(manifestAtMarkerPublication)).toMatchObject({
            status: 'completed',
            outcomeRef: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] }
          })
          recoveryPublicationOrder.push('manifest-published')
          await recoveryDurable.operations.rename(from, to)
          recoveryPublicationOrder.push('settlement-marker-published')
          return
        }
        await recoveryDurable.operations.rename(from, to)
      }
    }
    const recovered = createLearningOutcomeCommitter({ ...options, durableFileOperations: recoveryOperations })
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'repaired',
      marker: {
        sessionId,
        outcomeId,
        operationId,
        kind: 'established',
        evidenceEventIds: [evidenceEventId],
        record: { relativePath: `learning-records/outcome-${sessionId}.md` }
      },
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events.some((event) => event.includes(outcomePath))).toBe(false)
    expect(recoveryDurable.events.some((event) => event.endsWith(`->${markerPath}`))).toBe(true)
    expect(recoveryPublicationOrder).toEqual(['manifest-published', 'settlement-marker-published'])
    await expect(readFile(outcomePath, 'utf8')).resolves.toBe(outcomeBeforeRestart)
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toBe(recordBeforeRestart)
    await expect(readFile(manifestPath, 'utf8')).resolves.not.toBe(manifestBeforeRestart)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({
      status: 'completed',
      outcomeRef: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] }
    })
    const recordAfterRepair = await readFile(recordPath(workspaceRoot, sessionId), 'utf8')
    const outcomeAfterRepair = await readFile(outcomePath, 'utf8')
    const manifestAfterRepair = await readFile(manifestPath, 'utf8')
    const markerAfterRepair = await readFile(markerPath, 'utf8')
    expect(manifestAtMarkerPublication).toBe(manifestAfterRepair)

    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({ state: 'settled' })
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toBe(recordAfterRepair)
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestAfterRepair)
    await expect(readFile(outcomePath, 'utf8')).resolves.toBe(outcomeAfterRepair)
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(markerAfterRepair)
    await expect(recovered.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'already_committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toBe(recordAfterRepair)
    await expect(readFile(outcomePath, 'utf8')).resolves.toBe(outcomeAfterRepair)
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestAfterRepair)
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(markerAfterRepair)
    expect(evaluationCalls).toBe(1)
  })

  it('requires review instead of record-first repair when a marker conflicts with the canonical record', async () => {
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

  it('requires review when a settlement marker differs from the immutable record only by evaluatorVersion', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-evaluator-version-conflict-unit'
    const outcomeId = 'outcome-evaluator-version-conflict-1'
    const operationId = 'evaluator-version-conflict-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, 'evidence-evaluator-version-conflict-1')
    const options = {
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }: { session: { id: string } }) => decision(session.id, 'established', ['evidence-evaluator-version-conflict-1'])
    }
    const interrupted = createLearningOutcomeCommitter({
      ...options,
      testingFaults: {
        inject(point) {
          if (point === 'after_record_publish') throw new Error('simulate record-only publication')
        }
      }
    })

    await expect(interrupted.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    const recordContent = await readFile(recordPath(workspaceRoot, sessionId), 'utf8')
    const metadataMatch = /^<!-- studiumx-learning-outcome (.+) -->\n/.exec(recordContent)
    expect(metadataMatch).not.toBeNull()
    const metadata = JSON.parse(metadataMatch![1]!) as Record<string, unknown>
    const authoritativeMarker = {
      schemaVersion: 1,
      sessionId,
      outcomeId: metadata.outcomeId,
      operationId: metadata.operationId,
      kind: metadata.outcomeKind,
      evidenceEventIds: metadata.evidenceEventIds,
      evaluatorVersion: metadata.evaluatorVersion,
      record: {
        recordId: metadata.recordId,
        relativePath: `learning-records/outcome-${sessionId}.md`,
        contentSha256: createHash('sha256').update(recordContent).digest('hex')
      }
    }
    const evaluatorVersionConflict = {
      ...authoritativeMarker,
      evaluatorVersion: Number(authoritativeMarker.evaluatorVersion) + 1
    }
    expect({ ...evaluatorVersionConflict, evaluatorVersion: authoritativeMarker.evaluatorVersion }).toEqual(authoritativeMarker)
    const markerPath = join(sessionDirectory(workspaceRoot, sessionId), 'outcome-settlement.json')
    await writeFile(markerPath, `${JSON.stringify(evaluatorVersionConflict)}\n`, 'utf8')
    const recovered = createLearningOutcomeCommitter(options)

    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required', diagnostics: ['conflicting_outcome']
    })
    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict', reason: 'review_required'
    })
    await expect(readFile(join(sessionDirectory(workspaceRoot, sessionId), 'outcome.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(`${JSON.stringify(evaluatorVersionConflict)}\n`)
  })

  it('fails closed before projections when matching-existing record recovery faults before directory sync', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-existing-record-sync-failure-unit'
    const outcomeId = 'outcome-existing-record-sync-failure-1'
    const operationId = 'existing-record-sync-failure-1'
    let injectRecoverySyncFailure = false
    let observedRecoveryFault = false
    const ledger = await openSession(workspaceRoot, sessionId, {
      testingFaults: {
        inject(point, context) {
          if (!injectRecoverySyncFailure || point !== 'after_stage_sync') return
          expect(context).toMatchObject({
            operation: 'repair', sessionId, path: `learning-records/outcome-${sessionId}.md`
          })
          observedRecoveryFault = true
          throw new Error('simulated EEXIST recovery parent-sync failure')
        }
      }
    })
    await appendEvidence(ledger, sessionId, 'evidence-existing-record-sync-failure-1')
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => decision(session.id, 'established', ['evidence-existing-record-sync-failure-1']),
      testingFaults: {
        async inject(point) {
          if (point !== 'after_stage_flush') return
          await link(
            stagePath(workspaceRoot, sessionId, outcomeId, operationId),
            recordPath(workspaceRoot, sessionId)
          )
          injectRecoverySyncFailure = true
        }
      }
    })

    await expect(committer.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(observedRecoveryFault).toBe(true)
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toContain(outcomeId)
    await expect(readFile(stagePath(workspaceRoot, sessionId, outcomeId, operationId), 'utf8')).resolves.toContain(outcomeId)
    await expect(readFile(join(sessionDirectory(workspaceRoot, sessionId), 'outcome.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(sessionDirectory(workspaceRoot, sessionId), 'outcome-settlement.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
  })

  it('serializes concurrent commits so the second request observes the settled outcome', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-concurrent-commit-unit'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, 'evidence-concurrent-commit-1')
    let evaluationCalls = 0
    let releaseFirstEvaluation!: () => void
    const firstEvaluationReleased = new Promise<void>((resolve) => { releaseFirstEvaluation = resolve })
    let signalFirstEvaluation!: () => void
    const firstEvaluationStarted = new Promise<void>((resolve) => { signalFirstEvaluation = resolve })
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => 'outcome-concurrent-commit-1',
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        if (evaluationCalls === 1) {
          signalFirstEvaluation()
          await firstEvaluationReleased
        }
        return decision(session.id, 'established', ['evidence-concurrent-commit-1'])
      }
    })

    const first = committer.commit({ sessionId, operationId: 'concurrent-commit-1' })
    await firstEvaluationStarted
    const second = committer.commit({ sessionId, operationId: 'concurrent-commit-2' })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(evaluationCalls).toBe(1)
    releaseFirstEvaluation()

    await expect(first).resolves.toMatchObject({ status: 'committed', outcome: { outcomeId: 'outcome-concurrent-commit-1' } })
    await expect(second).resolves.toMatchObject({ status: 'already_committed', outcome: { outcomeId: 'outcome-concurrent-commit-1' } })
    expect(evaluationCalls).toBe(1)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'completed', outcomeRef: { outcomeId: 'outcome-concurrent-commit-1' } })
    expect((await readdir(join(workspaceRoot, 'learning-records'))).filter((file) => file.endsWith('.md'))).toEqual([
      'outcome-session-concurrent-commit-unit.md'
    ])
  })

  it.each([
    ['parent directory open', (directory: string) => `open:r:${directory}`],
    ['parent directory fsync', (directory: string) => `sync:${directory}`],
    ['parent directory close', (directory: string) => `close:${directory}`]
  ])('fails closed after record link when %s fails, preserving the stage for recovery', async (_name, eventFor) => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-record-directory-failure-unit'
    const outcomeId = 'outcome-record-directory-failure-1'
    const operationId = 'record-directory-failure-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, 'evidence-record-directory-failure-1')
    const recordsDirectory = join(workspaceRoot, 'learning-records')
    const durable = instrumentedDurableOperations({
      fail: (event) => event === eventFor(recordsDirectory)
        ? errno('EIO', 'parent directory failure includes private detail')
        : undefined
    })
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      durableFileOperations: durable.operations,
      evaluate: async ({ session }) => decision(session.id, 'established', ['evidence-record-directory-failure-1'])
    })

    await expect(committer.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toContain(outcomeId)
    await expect(readFile(stagePath(workspaceRoot, sessionId, outcomeId, operationId), 'utf8')).resolves.toContain(outcomeId)
    await expect(readFile(join(sessionDirectory(workspaceRoot, sessionId), 'outcome.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(sessionDirectory(workspaceRoot, sessionId), 'outcome-settlement.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
    expect(durable.events).not.toContain(`open:wx:${join(sessionDirectory(workspaceRoot, sessionId), '.outcome.json')}`)
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'permits only the shared directory-fsync capability downgrade (%s) without leaking details',
    async (code) => {
      const workspaceRoot = await workspace()
      const sessionId = `session-downgrade-${code.toLowerCase()}-unit`
      const ledger = await openSession(workspaceRoot, sessionId)
      await appendEvidence(ledger, sessionId, `evidence-downgrade-${code.toLowerCase()}-1`)
      const directory = sessionDirectory(workspaceRoot, sessionId)
      const warnings: string[] = []
      let injected = false
      const durable = instrumentedDurableOperations({
        fail: (event) => {
          if (!injected && event === `sync:${directory}`) {
            injected = true
            return errno(code, `fsync ${directory} failed with sensitive-token-7YqP9`)
          }
          return undefined
        }
      })
      const committer = createLearningOutcomeCommitter({
        workspaceRoot,
        ledger,
        createId: () => `outcome-downgrade-${code.toLowerCase()}-1`,
        durableFileOperations: durable.operations,
        durableWarn: (message) => warnings.push(message),
        evaluate: async ({ session }) => decision(session.id, 'established', [`evidence-downgrade-${code.toLowerCase()}-1`])
      })

      await expect(committer.commit({ sessionId, operationId: `downgrade-${code.toLowerCase()}-1` })).resolves.toMatchObject({
        status: 'committed', recordSaved: true
      })
      expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
      expect(warnings[0]).not.toContain(workspaceRoot)
      expect(warnings[0]).not.toContain('sensitive-token-7YqP9')
      await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'completed' })
    }
  )

  it.each([
    ['EIO directory fsync', (directory: string) => `sync:${directory}`],
    ['directory close', (directory: string) => `close:${directory}`]
  ])('does not downgrade %s while publishing the outcome projection', async (_name, eventFor) => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-outcome-directory-fatal-unit'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, 'evidence-outcome-directory-fatal-1')
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const durable = instrumentedDurableOperations({
      fail: (event) => event === eventFor(directory)
        ? errno('EIO', 'directory close/fsync private failure')
        : undefined
    })
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => 'outcome-outcome-directory-fatal-1',
      durableFileOperations: durable.operations,
      evaluate: async ({ session }) => decision(session.id, 'established', ['evidence-outcome-directory-fatal-1'])
    })

    await expect(committer.commit({ sessionId, operationId: 'outcome-directory-fatal-1' })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    await expect(readFile(join(directory, 'outcome.json'), 'utf8')).resolves.toContain('outcome-outcome-directory-fatal-1')
    await expect(readFile(join(directory, 'outcome-settlement.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
  })

  it('blocks manifest and marker publication when durable outcome replacement fails', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-outcome-publish-failure-unit'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, 'evidence-outcome-publish-failure-1')
    const outcomePath = join(sessionDirectory(workspaceRoot, sessionId), 'outcome.json')
    const durable = instrumentedDurableOperations({
      fail: (event) => event.startsWith('rename:') && event.endsWith(`->${outcomePath}`)
        ? errno('EIO', 'outcome rename private failure')
        : undefined
    })
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => 'outcome-outcome-publish-failure-1',
      durableFileOperations: durable.operations,
      evaluate: async ({ session }) => decision(session.id, 'established', ['evidence-outcome-publish-failure-1'])
    })

    await expect(committer.commit({ sessionId, operationId: 'outcome-publish-failure-1' })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    await expect(readFile(recordPath(workspaceRoot, sessionId), 'utf8')).resolves.toContain('outcome-outcome-publish-failure-1')
    await expect(readFile(outcomePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(sessionDirectory(workspaceRoot, sessionId), 'outcome-settlement.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
  })

  it('does not report committed when settlement-marker publication fails after manifest completion', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-marker-publish-failure-unit'
    const outcomeId = 'outcome-marker-publish-failure-1'
    const operationId = 'marker-publish-failure-1'
    const evidenceEventId = 'evidence-marker-publish-failure-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const durable = instrumentedDurableOperations({
      fail: (event) => event.startsWith('rename:') && event.endsWith(`->${markerPath}`)
        ? errno('EIO', 'marker rename private failure')
        : undefined
    })
    const committer = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      durableFileOperations: durable.operations,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(committer.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(evaluationCalls).toBe(1)

    const recordBeforeRestart = await readFile(record, 'utf8')
    const outcomeBeforeRestart = await readFile(outcomePath, 'utf8')
    const manifestBeforeRestart = await readFile(manifestPath, 'utf8')
    const recordMetadataMatch = /^<!-- studiumx-learning-outcome (.+) -->\n/.exec(recordBeforeRestart)
    expect(recordMetadataMatch).not.toBeNull()
    const recordMetadata = JSON.parse(recordMetadataMatch![1]!) as Record<string, unknown>
    expect(recordMetadata).toMatchObject({
      sessionId,
      outcomeId,
      operationId,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId],
      evaluatorVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`
    })
    expect(JSON.parse(outcomeBeforeRestart)).toMatchObject({
      sessionId,
      outcomeId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(JSON.parse(manifestBeforeRestart)).toMatchObject({
      status: 'completed',
      outcomeRef: {
        outcomeId,
        kind: 'established',
        evidenceEventIds: [evidenceEventId]
      }
    })
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ledger.load(sessionId)).resolves.toMatchObject({
      status: 'completed',
      outcomeRef: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] }
    })

    const recoveryDurable = instrumentedDurableOperations()
    let recoveryCreateIdCalls = 0
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => {
        recoveryCreateIdCalls += 1
        return 'outcome-marker-publish-failure-recovery-should-not-exist'
      },
      durableFileOperations: recoveryDurable.operations,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'repaired',
      marker: {
        sessionId,
        outcomeId,
        operationId,
        kind: 'established',
        evidenceEventIds: [evidenceEventId],
        evaluatorVersion: recordMetadata.evaluatorVersion,
        record: {
          recordId: recordMetadata.recordId,
          relativePath: `learning-records/outcome-${sessionId}.md`,
          contentSha256: createHash('sha256').update(recordBeforeRestart).digest('hex')
        }
      },
      record: {
        recordId: recordMetadata.recordId,
        relativePath: `learning-records/outcome-${sessionId}.md`,
        contentSha256: createHash('sha256').update(recordBeforeRestart).digest('hex')
      }
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryCreateIdCalls).toBe(0)

    const repairedRecord = await readFile(record, 'utf8')
    const repairedOutcome = await readFile(outcomePath, 'utf8')
    const repairedManifest = await readFile(manifestPath, 'utf8')
    const repairedMarker = await readFile(markerPath, 'utf8')
    const marker = JSON.parse(repairedMarker) as Record<string, unknown>
    expect(marker).toEqual({
      schemaVersion: 1,
      sessionId,
      outcomeId: recordMetadata.outcomeId,
      operationId: recordMetadata.operationId,
      kind: recordMetadata.outcomeKind,
      evidenceEventIds: recordMetadata.evidenceEventIds,
      evaluatorVersion: recordMetadata.evaluatorVersion,
      record: {
        recordId: recordMetadata.recordId,
        relativePath: `learning-records/outcome-${sessionId}.md`,
        contentSha256: createHash('sha256').update(recordBeforeRestart).digest('hex')
      }
    })
    expect(repairedRecord).toBe(recordBeforeRestart)
    expect(repairedOutcome).toBe(outcomeBeforeRestart)
    expect(repairedManifest).toBe(manifestBeforeRestart)
    const recoveryProjectionEvents = recoveryDurable.events.filter((event) =>
      [record, outcomePath, manifestPath, markerPath].some((path) => event.includes(path))
    )
    expect(recoveryProjectionEvents).not.toEqual([])
    expect(recoveryProjectionEvents.every((event) => event.includes(markerPath))).toBe(true)
    expect(recoveryDurable.events.some((event) => event.startsWith('rename:') && event.includes(outcomePath))).toBe(false)
    expect(recoveryDurable.events.some((event) => event.startsWith('write:') && event.includes(outcomePath))).toBe(false)
    expect(recoveryDurable.events.some((event) => event.includes(manifestPath))).toBe(false)
    expect(recoveryDurable.events.some((event) => event.endsWith(`->${markerPath}`))).toBe(true)

    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'settled',
      marker: {
        sessionId,
        outcomeId,
        operationId,
        kind: 'established',
        evidenceEventIds: [evidenceEventId]
      }
    })
    await expect(readFile(record, 'utf8')).resolves.toBe(repairedRecord)
    await expect(readFile(outcomePath, 'utf8')).resolves.toBe(repairedOutcome)
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(repairedManifest)
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(repairedMarker)

    await expect(recovered.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'already_committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: {
        recordId: recordMetadata.recordId,
        relativePath: `learning-records/outcome-${sessionId}.md`,
        contentSha256: createHash('sha256').update(recordBeforeRestart).digest('hex')
      }
    })
    await expect(readFile(record, 'utf8')).resolves.toBe(repairedRecord)
    await expect(readFile(outcomePath, 'utf8')).resolves.toBe(repairedOutcome)
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(repairedManifest)
    await expect(readFile(markerPath, 'utf8')).resolves.toBe(repairedMarker)
    expect(evaluationCalls).toBe(1)
  })

  it('settles a post-marker interruption after restart without rewriting immutable projections', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-after-settlement-marker-restart-unit'
    const outcomeId = 'outcome-after-settlement-marker-restart-1'
    const operationId = 'after-settlement-marker-restart-operation-1'
    const evidenceEventId = 'evidence-after-settlement-marker-restart-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    const injectedPoints: string[] = []
    let initialEvaluationCalls = 0
    const interrupted = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        initialEvaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      },
      testingFaults: {
        inject(point) {
          injectedPoints.push(point)
          if (point === 'after_settlement_marker') throw new Error('simulated crash after settlement marker')
        }
      }
    })

    await expect(interrupted.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(initialEvaluationCalls).toBe(1)
    expect(injectedPoints).toEqual([
      'after_stage_flush',
      'after_record_publish',
      'after_outcome_publish',
      'after_settlement_marker'
    ])
    expect(injectedPoints).not.toContain('before_catalog_reconcile')

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    const recordContent = recordBeforeRestart.toString('utf8')
    const recordMetadataMatch = /^<!-- studiumx-learning-outcome (.+) -->\n/.exec(recordContent)
    expect(recordMetadataMatch).not.toBeNull()
    const recordMetadata = JSON.parse(recordMetadataMatch![1]!) as Record<string, unknown>
    const markerBeforeRestartValue = JSON.parse(markerBeforeRestart.toString('utf8')) as Record<string, unknown>
    const expectedRecord = {
      recordId: recordMetadata.recordId,
      relativePath: `learning-records/outcome-${sessionId}.md`,
      contentSha256: createHash('sha256').update(recordBeforeRestart).digest('hex')
    }
    expect(recordMetadata).toMatchObject({
      sessionId,
      outcomeId,
      operationId,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId],
      evaluatorVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`
    })
    expect(JSON.parse(outcomeBeforeRestart.toString('utf8'))).toMatchObject({
      sessionId,
      outcomeId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(JSON.parse(manifestBeforeRestart.toString('utf8'))).toMatchObject({
      status: 'completed',
      outcomeRef: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] }
    })
    expect(markerBeforeRestartValue).toMatchObject({
      sessionId: recordMetadata.sessionId,
      outcomeId: recordMetadata.outcomeId,
      operationId: recordMetadata.operationId,
      kind: recordMetadata.outcomeKind,
      evidenceEventIds: recordMetadata.evidenceEventIds,
      evaluatorVersion: recordMetadata.evaluatorVersion,
      record: expectedRecord
    })

    const recoveryDurable = instrumentedDurableOperations()
    let recoveryEvaluationCalls = 0
    let recoveryCreateIdCalls = 0
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        recoveryCreateIdCalls += 1
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        recoveryEvaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    const firstReconciliation = await recovered.reconcile(sessionId)
    expect(firstReconciliation).toMatchObject({
      state: 'settled',
      marker: markerBeforeRestartValue,
      record: expectedRecord
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    const secondReconciliation = await recovered.reconcile(sessionId)
    expect(secondReconciliation).toMatchObject({
      state: 'settled',
      marker: markerBeforeRestartValue,
      record: expectedRecord
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'already_committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: expectedRecord
    })
    expect(recoveryEvaluationCalls).toBe(0)
    expect(recoveryCreateIdCalls).toBe(0)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })

  it('settles a pre-catalog-reconcile interruption after restart without rewriting immutable projections', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-before-catalog-reconcile-restart-unit'
    const outcomeId = 'outcome-before-catalog-reconcile-restart-1'
    const operationId = 'before-catalog-reconcile-restart-operation-1'
    const evidenceEventId = 'evidence-before-catalog-reconcile-restart-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    const injectedPoints: string[] = []
    let initialEvaluationCalls = 0
    const interrupted = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        initialEvaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      },
      testingFaults: {
        inject(point) {
          injectedPoints.push(point)
          if (point === 'before_catalog_reconcile') throw new Error('simulated crash before catalog reconcile')
        }
      }
    })

    await expect(interrupted.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    expect(initialEvaluationCalls).toBe(1)
    expect(injectedPoints).toEqual([
      'after_stage_flush',
      'after_record_publish',
      'after_outcome_publish',
      'after_settlement_marker',
      'before_catalog_reconcile'
    ])

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    const recordContent = recordBeforeRestart.toString('utf8')
    const recordMetadataMatch = /^<!-- studiumx-learning-outcome (.+) -->\n/.exec(recordContent)
    expect(recordMetadataMatch).not.toBeNull()
    const recordMetadata = JSON.parse(recordMetadataMatch![1]!) as Record<string, unknown>
    const markerBeforeRestartValue = JSON.parse(markerBeforeRestart.toString('utf8')) as Record<string, unknown>
    const expectedRecord = {
      recordId: recordMetadata.recordId,
      relativePath: `learning-records/outcome-${sessionId}.md`,
      contentSha256: createHash('sha256').update(recordBeforeRestart).digest('hex')
    }
    expect(recordMetadata).toMatchObject({
      sessionId,
      outcomeId,
      operationId,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId],
      evaluatorVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`
    })
    expect(JSON.parse(outcomeBeforeRestart.toString('utf8'))).toMatchObject({
      sessionId,
      outcomeId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(JSON.parse(manifestBeforeRestart.toString('utf8'))).toMatchObject({
      status: 'completed',
      outcomeRef: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] }
    })
    expect(markerBeforeRestartValue).toMatchObject({
      sessionId: recordMetadata.sessionId,
      outcomeId: recordMetadata.outcomeId,
      operationId: recordMetadata.operationId,
      kind: recordMetadata.outcomeKind,
      evidenceEventIds: recordMetadata.evidenceEventIds,
      evaluatorVersion: recordMetadata.evaluatorVersion,
      record: expectedRecord
    })

    const recoveryDurable = instrumentedDurableOperations()
    let recoveryEvaluationCalls = 0
    let recoveryCreateIdCalls = 0
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        recoveryCreateIdCalls += 1
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        recoveryEvaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    const firstReconciliation = await recovered.reconcile(sessionId)
    expect(firstReconciliation).toMatchObject({
      state: 'settled',
      marker: markerBeforeRestartValue,
      record: expectedRecord
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    const secondReconciliation = await recovered.reconcile(sessionId)
    expect(secondReconciliation).toMatchObject({
      state: 'settled',
      marker: markerBeforeRestartValue,
      record: expectedRecord
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'already_committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: expectedRecord
    })
    expect(recoveryEvaluationCalls).toBe(0)
    expect(recoveryCreateIdCalls).toBe(0)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
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

  it('requires review without repairing projections when the learning-records parent is a symlink outside the workspace', async () => {
    const workspaceRoot = await workspace()
    const outsideRecordsDirectory = await mkdtemp(join(tmpdir(), 'studiumx-outcome-committer-outside-records-'))
    roots.push(outsideRecordsDirectory)
    const sessionId = 'session-records-parent-symlink-unit'
    const outcomeId = 'outcome-records-parent-symlink-1'
    const operationId = 'records-parent-symlink-operation-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, 'evidence-records-parent-symlink-1')
    const options = {
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }: { session: { id: string } }) => decision(session.id, 'established', ['evidence-records-parent-symlink-1'])
    }
    const interrupted = createLearningOutcomeCommitter({
      ...options,
      testingFaults: {
        inject(point) {
          if (point === 'after_record_publish') throw new Error('simulated crash after record publish')
        }
      }
    })

    await expect(interrupted.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'retryable_failure', reason: 'reconciliation_required'
    })
    const canonicalRecord = await readFile(recordPath(workspaceRoot, sessionId), 'utf8')
    const recordsDirectory = join(workspaceRoot, 'learning-records')
    const outsideRecordPath = join(outsideRecordsDirectory, `outcome-${sessionId}.md`)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const manifestPath = join(directory, 'session.json')
    const manifestBeforeReconcile = await readFile(manifestPath, 'utf8')
    const outcomePath = join(directory, 'outcome.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    await rm(recordsDirectory, { recursive: true, force: true })
    await writeFile(outsideRecordPath, canonicalRecord, 'utf8')
    try {
      await symlink(outsideRecordsDirectory, recordsDirectory, 'dir')
    } catch (error) {
      expect(error).toMatchObject({ code: 'EPERM' })
      return
    }
    const recovered = createLearningOutcomeCommitter(options)

    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({ state: 'review_required' })
    await expect(readFile(outsideRecordPath, 'utf8')).resolves.toBe(canonicalRecord)
    await expect(readdir(outsideRecordsDirectory)).resolves.toEqual([`outcome-${sessionId}.md`])
    await expect(readFile(outcomePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(manifestBeforeReconcile)
    await expect(ledger.load(sessionId)).resolves.toMatchObject({ status: 'active', outcomeRef: null })
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

    await expect(committer.reconcile('session-symlink-unit')).resolves.toMatchObject({
      state: 'review_required', record: null, diagnostics: ['missing_record']
    })
  })

  it('fails closed on restart when a malformed settlement marker conflicts with durable authority', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-settlement-marker-unit'
    const outcomeId = 'outcome-invalid-settlement-marker-1'
    const operationId = 'invalid-settlement-marker-operation-1'
    const evidenceEventId = 'evidence-invalid-settlement-marker-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath)
    ])
    const poisonedMarker = '{"schemaVersion": 1, malformed marker'
    await writeFile(markerPath, poisonedMarker, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual evidence: malformed settlement authority must fail closed.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })

  it('fails closed on restart when a well-formed settlement marker fails normalization', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-normalized-marker-unit'
    const outcomeId = 'outcome-invalid-normalized-marker-1'
    const operationId = 'invalid-normalized-marker-operation-1'
    const evidenceEventId = 'evidence-invalid-normalized-marker-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath)
    ])
    // Well-formed JSON that normalizeMarker must reject (schema version 2).
    const poisonedMarker = '{"schemaVersion":2}'
    await writeFile(markerPath, poisonedMarker, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual evidence: normalized-invalid settlement authority must fail closed.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })

  it('fails closed on restart when a well-formed settlement marker has null outcomeId', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-outcome-id-null-unit'
    const outcomeId = 'outcome-invalid-marker-outcome-id-null-1'
    const operationId = 'invalid-marker-outcome-id-null-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-outcome-id-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed/canonical, but set outcomeId null so normalizeMarker rejects via text(). Distinct from schemaVersion:2 residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const poisonedMarker = { ...validMarker, outcomeId: null }
    expect(poisonedMarker.outcomeId).toBeNull()
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"outcomeId":null')
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).toContain(`"operationId":"${operationId}"`)
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker is an array', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-array-unit'
    const outcomeId = 'outcome-invalid-marker-array-1'
    const operationId = 'invalid-marker-array-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-array-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Replace marker with a well-formed JSON array so normalizeMarker rejects non-object authority. Distinct from schemaVersion:2 and null-outcomeId residuals.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const poisonedMarker = [{ ...validMarker }]
    expect(Array.isArray(poisonedMarker)).toBe(true)
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText.startsWith('[')).toBe(true)
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).toContain(`"outcomeId":"${outcomeId}"`)
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has null operationId', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-operation-id-null-unit'
    const outcomeId = 'outcome-invalid-marker-operation-id-null-1'
    const operationId = 'invalid-marker-operation-id-null-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-operation-id-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed/canonical, but set operationId null so normalizeMarker rejects via text(). Distinct from schemaVersion:2 and null-outcomeId residuals.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(validMarker.record).not.toBeNull()
    const poisonedMarker = { ...validMarker, operationId: null }
    expect(poisonedMarker.operationId).toBeNull()
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"operationId":null')
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).toContain(`"outcomeId":"${outcomeId}"`)
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker record presence mismatches outcome kind', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-record-presence-mismatch-unit'
    const outcomeId = 'outcome-invalid-marker-record-presence-mismatch-1'
    const operationId = 'invalid-marker-record-presence-mismatch-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-record-presence-mismatch-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep writing outcome kind established, but set record null so normalizeMarker rejects record-presence vs kind mismatch. Distinct from identity-null and array marker residuals.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(validMarker.record).not.toBeNull()
    const poisonedMarker = { ...validMarker, record: null }
    expect(poisonedMarker.record).toBeNull()
    expect(poisonedMarker.kind).toBe('established')
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"record":null')
    expect(poisonedMarkerText).toContain('"kind":"established"')
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).not.toContain('"relativePath"')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has null sessionId', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-session-id-null-unit'
    const outcomeId = 'outcome-invalid-marker-session-id-null-1'
    const operationId = 'invalid-marker-session-id-null-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-session-id-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed/canonical, but set sessionId null so normalizeMarker rejects via text(). Distinct from null outcomeId/operationId residuals.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const poisonedMarker = { ...validMarker, sessionId: null }
    expect(poisonedMarker.sessionId).toBeNull()
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"sessionId":null')
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).toContain(`"outcomeId":"${outcomeId}"`)
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has empty evidence for a writing kind', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-empty-evidence-writing-unit'
    const outcomeId = 'outcome-invalid-marker-empty-evidence-writing-1'
    const operationId = 'invalid-marker-empty-evidence-writing-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-empty-evidence-writing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep writing kind established and non-null record, but clear evidenceEventIds so normalizeMarker rejects empty evidence for recorded outcomes. Distinct from record-presence mismatch residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(validMarker.record).not.toBeNull()
    const poisonedMarker = { ...validMarker, evidenceEventIds: [] }
    expect(poisonedMarker.evidenceEventIds).toEqual([])
    expect(poisonedMarker.kind).toBe('established')
    expect(poisonedMarker.record).not.toBeNull()
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"evidenceEventIds":[]')
    expect(poisonedMarkerText).toContain('"kind":"established"')
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).not.toContain(evidenceEventId)
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has null evaluatorVersion', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-evaluator-version-null-unit'
    const outcomeId = 'outcome-invalid-marker-evaluator-version-null-1'
    const operationId = 'invalid-marker-evaluator-version-null-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-evaluator-version-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed/canonical, but set evaluatorVersion null so number() rejects. Distinct from schemaVersion:2 residual and record evaluatorVersion null residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const poisonedMarker = { ...validMarker, evaluatorVersion: null }
    expect(poisonedMarker.evaluatorVersion).toBeNull()
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"evaluatorVersion":null')
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).toContain(`"outcomeId":"${outcomeId}"`)
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker record identity mismatches the session', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-record-identity-mismatch-unit'
    const outcomeId = 'outcome-invalid-marker-record-identity-mismatch-1'
    const operationId = 'invalid-marker-record-identity-mismatch-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-record-identity-mismatch-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep writing kind and non-null record object, but poison record.recordId so normalizeMarker rejects canonical Learning record identity. Distinct from record-presence null residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const validRecord = validMarker.record as Record<string, unknown>
    expect(validRecord).toMatchObject({
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      relativePath: `learning-records/outcome-${sessionId}.md`
    })
    const poisonedMarker = {
      ...validMarker,
      record: {
        ...validRecord,
        recordId: `learning-outcome-${sessionId}-poisoned-outcome`
      }
    }
    expect((poisonedMarker.record as Record<string, unknown>).recordId).toBe(`learning-outcome-${sessionId}-poisoned-outcome`)
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain(`"recordId":"learning-outcome-${sessionId}-poisoned-outcome"`)
    expect(poisonedMarkerText).not.toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).toContain('"kind":"established"')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has a non-canonical operationId', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-operation-id-noncanonical-unit'
    const outcomeId = 'outcome-invalid-marker-operation-id-noncanonical-1'
    const operationId = 'invalid-marker-operation-id-noncanonical-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-operation-id-noncanonical-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed, but set operationId to a non-canonical string so requireOperationId normalization rejects. Distinct from null operationId residual and record non-canonical operationId residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const previous = validMarker.operationId
    const poisonedMarker = { ...validMarker, operationId: '  non-canonical operation id  ' }
    expect(poisonedMarker.operationId).toBe('  non-canonical operation id  ')
    expect(poisonedMarker.operationId).not.toBe(previous)
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"operationId":"  non-canonical operation id  "')
    expect(poisonedMarkerText).not.toContain(`"operationId":"${operationId}"`)
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker record contentSha256 is invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-record-sha-invalid-unit'
    const outcomeId = 'outcome-invalid-marker-record-sha-invalid-1'
    const operationId = 'invalid-marker-record-sha-invalid-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-record-sha-invalid-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker.record object present with valid recordId/path shape, but poison contentSha256 so normalizeRecordRef rejects. Distinct from record identity mismatch residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const validRecord = validMarker.record as Record<string, unknown>
    expect(typeof validRecord.contentSha256).toBe('string')
    expect(validRecord.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    const previousSha = validRecord.contentSha256
    const poisonedMarker = {
      ...validMarker,
      record: {
        ...validRecord,
        contentSha256: 'not-a-valid-sha256-digest!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
      }
    }
    expect((poisonedMarker.record as Record<string, unknown>).contentSha256).not.toBe(previousSha)
    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"contentSha256":"not-a-valid-sha256-digest!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"')
    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    expect(poisonedMarkerText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker record relativePath mismatches the session', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-record-path-mismatch-unit'
    const outcomeId = 'outcome-invalid-marker-record-path-mismatch-1'
    const operationId = 'invalid-marker-record-path-mismatch-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-record-path-mismatch-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker.record object present with valid recordId/sha, but poison relativePath so identity check rejects. Distinct from recordId identity mismatch residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const validRecord = validMarker.record as Record<string, unknown>
    expect(typeof validRecord.relativePath).toBe('string')
    expect(validRecord.relativePath).toBe(`learning-records/outcome-${sessionId}.md`)
    const previousPath = validRecord.relativePath
    const poisonedPath = 'learning-records/outcome-other-session-path-mismatch.md'
    const poisonedMarker = {
      ...validMarker,
      record: {
        ...validRecord,
        relativePath: poisonedPath
      }
    }
    expect((poisonedMarker.record as Record<string, unknown>).relativePath).toBe(poisonedPath)
    expect((poisonedMarker.record as Record<string, unknown>).relativePath).not.toBe(previousPath)

    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain(`"relativePath":"${poisonedPath}"`)
    expect(poisonedMarkerText).not.toContain(`"relativePath":"learning-records/outcome-${sessionId}.md"`)
    expect(poisonedMarkerText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)

    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has non-array evidenceEventIds', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-evidence-nonarray-unit'
    const outcomeId = 'outcome-invalid-marker-evidence-nonarray-1'
    const operationId = 'invalid-marker-evidence-nonarray-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-evidence-nonarray-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed, but set evidenceEventIds to a non-array so stringArray throws. Distinct from empty evidence residual and null evidence item residual on records.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(Array.isArray(validMarker.evidenceEventIds)).toBe(true)
    const previousEvidence = validMarker.evidenceEventIds
    const poisonedMarker = { ...validMarker, evidenceEventIds: { not: 'an-array' } }
    expect(poisonedMarker.evidenceEventIds).toEqual({ not: 'an-array' })
    expect(poisonedMarker.evidenceEventIds).not.toEqual(previousEvidence)

    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"evidenceEventIds":{"not":"an-array"}')
    expect(poisonedMarkerText).not.toContain(`"evidenceEventIds":["${evidenceEventId}"]`)

    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has null kind', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-kind-null-unit'
    const outcomeId = 'outcome-invalid-marker-kind-null-1'
    const operationId = 'invalid-marker-kind-null-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-kind-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed, but set kind null so outcomeKind rejects. Distinct from record-presence mismatch residual (which keeps a writing kind).
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const previousKind = validMarker.kind
    const poisonedMarker = { ...validMarker, kind: null }
    expect(poisonedMarker.kind).toBeNull()
    expect(poisonedMarker.kind).not.toBe(previousKind)

    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"kind":null')
    expect(poisonedMarkerText).not.toContain('"kind":"established"')

    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker record is an array', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-record-array-unit'
    const outcomeId = 'outcome-invalid-marker-record-array-1'
    const operationId = 'invalid-marker-record-array-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-record-array-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep writing kind established, but set record to a JSON array so normalizeRecordRef rejects non-object record refs. Distinct from record:null presence mismatch residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(validMarker.record && typeof validMarker.record === 'object' && !Array.isArray(validMarker.record)).toBe(true)
    const previousRecord = validMarker.record
    const poisonedMarker = { ...validMarker, record: [{ not: 'a-record-ref' }] }
    expect(Array.isArray(poisonedMarker.record)).toBe(true)
    expect(poisonedMarker.record).not.toEqual(previousRecord)

    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"record":[{"not":"a-record-ref"}]')
    expect(poisonedMarkerText).not.toContain('"contentSha256"')

    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has a non-string evidenceEventIds item', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-evidence-item-nonstring-unit'
    const outcomeId = 'outcome-invalid-marker-evidence-item-nonstring-1'
    const operationId = 'invalid-marker-evidence-item-nonstring-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-evidence-item-nonstring-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep evidenceEventIds as an array, but poison one item to a non-string so stringArray throws on item type. Distinct from non-array evidence residual and empty evidence residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(Array.isArray(validMarker.evidenceEventIds)).toBe(true)
    const previousEvidence = validMarker.evidenceEventIds
    const poisonedMarker = { ...validMarker, evidenceEventIds: [evidenceEventId, 42] }
    expect(poisonedMarker.evidenceEventIds).toEqual([evidenceEventId, 42])
    expect(poisonedMarker.evidenceEventIds).not.toEqual(previousEvidence)

    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain(`"evidenceEventIds":["${evidenceEventId}",42]`)

    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when a well-formed settlement marker has an unknown kind', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-marker-kind-unknown-unit'
    const outcomeId = 'outcome-invalid-marker-kind-unknown-1'
    const operationId = 'invalid-marker-kind-unknown-operation-1'
    const evidenceEventId = 'evidence-invalid-marker-kind-unknown-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, validMarkerText] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath, 'utf8')
    ])
    // Keep marker otherwise well-formed, but set kind to an unknown non-null string so outcomeKind rejects. Distinct from null kind residual and record-presence mismatch residual.
    const validMarker = JSON.parse(validMarkerText) as Record<string, unknown>
    expect(validMarker).toMatchObject({
      schemaVersion: 1,
      sessionId,
      outcomeId,
      operationId,
      kind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const previousKind = validMarker.kind
    const poisonedMarker = { ...validMarker, kind: 'not_a_known_outcome_kind' }
    expect(poisonedMarker.kind).toBe('not_a_known_outcome_kind')
    expect(poisonedMarker.kind).not.toBe(previousKind)

    const poisonedMarkerText = `${JSON.stringify(poisonedMarker)}\n`
    expect(poisonedMarkerText).not.toBe(validMarkerText)
    expect(poisonedMarkerText).toContain('"kind":"not_a_known_outcome_kind"')
    expect(poisonedMarkerText).not.toContain('"kind":"established"')

    expect(poisonedMarkerText).toContain('"schemaVersion":1')
    await writeFile(markerPath, poisonedMarkerText, 'utf8')
    const markerBeforeRestart = await readFile(markerPath)
    expect(markerBeforeRestart.toString('utf8')).toBe(poisonedMarkerText)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual: normalizeMarker reject fails closed without repair/rewrite.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })
  it('fails closed on restart when outcome.json conflicts with durable record authority', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-conflicting-outcome-projection-unit'
    const outcomeId = 'outcome-conflicting-outcome-projection-1'
    const operationId = 'conflicting-outcome-projection-operation-1'
    const evidenceEventId = 'evidence-conflicting-outcome-projection-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Poison only outcome.json: still valid-looking JSON, but not the encoded
    // projection for the immutable record (wrong outcomeId / kind / evidence).
    const poisonedOutcome = `${JSON.stringify({
      schemaVersion: 1,
      outcomeId: 'outcome-poisoned-projection-1',
      kind: 'needs_practice',
      evidenceEventIds: ['evidence-poisoned-projection-1']
    })}\n`
    expect(poisonedOutcome).not.toEqual(outcomeBeforeRestart.toString('utf8'))
    await writeFile(outcomePath, poisonedOutcome, 'utf8')
    const poisonedOutcomeBytes = await readFile(outcomePath)
    expect(poisonedOutcomeBytes.toString('utf8')).toBe(poisonedOutcome)
    expect(poisonedOutcomeBytes.equals(outcomeBeforeRestart)).toBe(false)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(poisonedOutcomeBytes)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual evidence: mismatched outcome projection vs record authority must fail closed.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['conflicting_outcome'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })

  it('fails closed on restart when completed session outcomeRef conflicts with durable record authority', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-conflicting-manifest-outcome-ref-unit'
    const outcomeId = 'outcome-conflicting-manifest-outcome-ref-1'
    const operationId = 'conflicting-manifest-outcome-ref-operation-1'
    const evidenceEventId = 'evidence-conflicting-manifest-outcome-ref-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    const settledManifest = JSON.parse(manifestBeforeRestart.toString('utf8')) as {
      status: string
      outcomeRef: {
        outcomeId: string
        kind: LearningOutcomeEvaluation['kind']
        relativePath: string
        evidenceEventIds: string[]
        contentSha256: string
      }
    }
    expect(settledManifest).toMatchObject({
      status: 'completed',
      outcomeRef: {
        outcomeId,
        kind: 'established',
        relativePath: `learning-sessions/${sessionId}/outcome.json`,
        evidenceEventIds: [evidenceEventId],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    })
    // Poison only the completed manifest outcomeRef identity. Its path and
    // evidence remain valid so reconciliation reaches conflicting_outcome.
    const poisonedManifest = {
      ...settledManifest,
      outcomeRef: {
        ...settledManifest.outcomeRef,
        outcomeId: 'outcome-poisoned-manifest-ref-1'
      }
    }
    const poisonedManifestText = `${JSON.stringify(poisonedManifest)}\n`
    expect(poisonedManifestText).not.toBe(manifestBeforeRestart.toString('utf8'))
    await writeFile(manifestPath, poisonedManifestText, 'utf8')
    const poisonedManifestBytes = await readFile(manifestPath)
    expect(poisonedManifestBytes.toString('utf8')).toBe(poisonedManifestText)
    expect(poisonedManifestBytes.equals(manifestBeforeRestart)).toBe(false)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectDurableBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(poisonedManifestBytes)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
    }

    // Directed residual evidence: a completed manifest must match record authority.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['conflicting_outcome'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectDurableBytesUnchanged()
  })

  it('fails closed on restart when outcome.json is a non-file symlink', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-outcome-symlink-unit'
    const outcomeId = 'outcome-invalid-outcome-symlink-1'
    const operationId = 'invalid-outcome-symlink-operation-1'
    const evidenceEventId = 'evidence-invalid-outcome-symlink-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Poison only outcome.json into a non-regular-file (symlink). Record,
    // completed manifest, and settlement marker remain matching authority.
    const outsideOutcome = join(workspaceRoot, 'outside-poisoned-outcome.json')
    await writeFile(outsideOutcome, `${JSON.stringify({
      schemaVersion: 1,
      outcomeId: 'outcome-outside-poison-1',
      kind: 'needs_practice',
      evidenceEventIds: ['evidence-outside-poison-1']
    })}\n`, 'utf8')
    await rm(outcomePath)
    try {
      await symlink(outsideOutcome, outcomePath, 'file')
    } catch (error) {
      expect(error).toMatchObject({ code: 'EPERM' })
      return
    }
    await expect(lstat(outcomePath)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) })
    expect((await lstat(outcomePath)).isSymbolicLink()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      expect((await lstat(outcomePath)).isSymbolicLink()).toBe(true)
    }

    // Directed residual: invalid non-file outcome projection fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required'
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the settlement marker is a non-file symlink', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-settlement-marker-symlink-unit'
    const outcomeId = 'outcome-invalid-settlement-marker-symlink-1'
    const operationId = 'invalid-settlement-marker-symlink-operation-1'
    const evidenceEventId = 'evidence-invalid-settlement-marker-symlink-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath)
    ])
    // Poison only the settlement marker into a non-regular-file (symlink).
    // Record, outcome.json, and completed manifest remain matching authority.
    const outsideMarker = join(workspaceRoot, 'outside-poisoned-settlement-marker.json')
    await writeFile(outsideMarker, `${JSON.stringify({
      schemaVersion: 1,
      outcomeId: 'outcome-outside-marker-poison-1',
      kind: 'needs_practice',
      evidenceEventIds: ['evidence-outside-marker-poison-1']
    })}\n`, 'utf8')
    await rm(markerPath)
    try {
      await symlink(outsideMarker, markerPath, 'file')
    } catch (error) {
      expect(error).toMatchObject({ code: 'EPERM' })
      return
    }
    await expect(lstat(markerPath)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) })
    expect((await lstat(markerPath)).isSymbolicLink()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      expect((await lstat(markerPath)).isSymbolicLink()).toBe(true)
    }

    // Directed residual: invalid non-file settlement marker fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when session.json is a non-file symlink', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-manifest-symlink-unit'
    const outcomeId = 'outcome-invalid-manifest-symlink-1'
    const operationId = 'invalid-manifest-symlink-operation-1'
    const evidenceEventId = 'evidence-invalid-manifest-symlink-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(markerPath)
    ])
    // Poison only session.json into a non-regular-file (symlink). Record,
    // outcome.json, and settlement marker remain matching authority.
    const outsideManifest = join(workspaceRoot, 'outside-poisoned-session.json')
    await writeFile(outsideManifest, `${JSON.stringify({
      schemaVersion: 1,
      status: 'completed',
      outcomeRef: {
        outcomeId: 'outcome-outside-manifest-poison-1',
        kind: 'needs_practice',
        relativePath: 'learning-sessions/outside/outcome.json',
        evidenceEventIds: ['evidence-outside-manifest-poison-1'],
        contentSha256: '0'.repeat(64)
      }
    })}\n`, 'utf8')
    await rm(manifestPath)
    try {
      await symlink(outsideManifest, manifestPath, 'file')
    } catch (error) {
      expect(error).toMatchObject({ code: 'EPERM' })
      return
    }
    await expect(lstat(manifestPath)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) })
    expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true)
    }

    // Directed residual: invalid non-file session manifest fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required'
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when outcome.json is a directory', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-outcome-directory-unit'
    const outcomeId = 'outcome-invalid-outcome-directory-1'
    const operationId = 'invalid-outcome-directory-operation-1'
    const evidenceEventId = 'evidence-invalid-outcome-directory-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Poison only outcome.json into a directory (not a symlink). Record,
    // completed manifest, and settlement marker remain matching authority.
    await rm(outcomePath)
    await mkdir(outcomePath)
    await writeFile(join(outcomePath, 'junk-inside-directory.json'), `${JSON.stringify({
      schemaVersion: 1,
      outcomeId: 'outcome-directory-junk-1',
      kind: 'needs_practice',
      evidenceEventIds: ['evidence-directory-junk-1']
    })}\n`, 'utf8')
    await expect(lstat(outcomePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    expect((await lstat(outcomePath)).isDirectory()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      expect((await lstat(outcomePath)).isDirectory()).toBe(true)
    }

    // Directed residual: invalid directory outcome projection fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required'
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the settlement marker is a directory', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-settlement-marker-directory-unit'
    const outcomeId = 'outcome-invalid-settlement-marker-directory-1'
    const operationId = 'invalid-settlement-marker-directory-operation-1'
    const evidenceEventId = 'evidence-invalid-settlement-marker-directory-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, manifestBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(manifestPath)
    ])
    // Poison only the settlement marker into a directory (not a symlink). Record,
    // outcome.json, and completed manifest remain matching authority.
    await rm(markerPath)
    await mkdir(markerPath)
    await writeFile(join(markerPath, 'junk-inside-directory.json'), `${JSON.stringify({
      schemaVersion: 1,
      outcomeId: 'outcome-settlement-marker-directory-junk-1',
      kind: 'needs_practice',
      evidenceEventIds: ['evidence-settlement-marker-directory-junk-1']
    })}\n`, 'utf8')
    await expect(lstat(markerPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    expect((await lstat(markerPath)).isDirectory()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      expect((await lstat(markerPath)).isDirectory()).toBe(true)
    }

    // Directed residual: invalid directory settlement marker fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      marker: null,
      diagnostics: expect.arrayContaining(['invalid_settlement_marker'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when session.json is a directory', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-manifest-directory-unit'
    const outcomeId = 'outcome-invalid-manifest-directory-1'
    const operationId = 'invalid-manifest-directory-operation-1'
    const evidenceEventId = 'evidence-invalid-manifest-directory-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [recordBeforeRestart, outcomeBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record),
      readFile(outcomePath),
      readFile(markerPath)
    ])
    // Poison only session.json into a directory (not a symlink). Record,
    // outcome.json, and settlement marker remain matching authority.
    await rm(manifestPath)
    await mkdir(manifestPath)
    await writeFile(join(manifestPath, 'junk-inside-directory.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'completed',
      outcomeRef: {
        outcomeId: 'outcome-manifest-directory-junk-1',
        kind: 'needs_practice',
        relativePath: 'learning-sessions/outside/outcome.json',
        evidenceEventIds: ['evidence-manifest-directory-junk-1'],
        contentSha256: '0'.repeat(64)
      }
    })}\n`, 'utf8')
    await expect(lstat(manifestPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    expect((await lstat(manifestPath)).isDirectory()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(record)).resolves.toEqual(recordBeforeRestart)
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      expect((await lstat(manifestPath)).isDirectory()).toBe(true)
    }

    // Directed residual: invalid directory session manifest fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required'
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record is a directory', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-directory-unit'
    const outcomeId = 'outcome-invalid-record-directory-1'
    const operationId = 'invalid-record-directory-operation-1'
    const evidenceEventId = 'evidence-invalid-record-directory-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Poison only the canonical learning record into a directory (not a symlink).
    // Outcome, completed manifest, and settlement marker remain matching authority.
    await rm(record)
    await mkdir(record)
    await writeFile(join(record, 'junk-inside-directory.md'), '# invalid record directory\n', 'utf8')
    await expect(lstat(record)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    expect((await lstat(record)).isDirectory()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      expect((await lstat(record)).isDirectory()).toBe(true)
    }

    // Directed residual: invalid directory canonical record fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record is a non-file symlink', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-symlink-unit'
    const outcomeId = 'outcome-invalid-record-symlink-1'
    const operationId = 'invalid-record-symlink-operation-1'
    const evidenceEventId = 'evidence-invalid-record-symlink-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Poison only the canonical learning record into a non-regular-file (symlink).
    // Outcome, completed manifest, and settlement marker remain matching authority.
    const outsideRecord = join(workspaceRoot, 'outside-poisoned-record.md')
    await writeFile(outsideRecord, '# outside poisoned record\n\njunk content\n', 'utf8')
    await rm(record)
    try {
      await symlink(outsideRecord, record, 'file')
    } catch (error) {
      expect(error).toMatchObject({ code: 'EPERM' })
      return
    }
    await expect(lstat(record)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) })
    expect((await lstat(record)).isSymbolicLink()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      expect((await lstat(record)).isSymbolicLink()).toBe(true)
    }

    // Directed residual: invalid non-file canonical record fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record content is invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-content-unit'
    const outcomeId = 'outcome-invalid-record-content-1'
    const operationId = 'invalid-record-content-operation-1'
    const evidenceEventId = 'evidence-invalid-record-content-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Poison only the canonical learning-record regular-file content so parse/validation fails.
    // Outcome, completed manifest, and settlement marker remain matching authority.
    const poisonedRecordText = '# poisoned invalid learning record\nnot-metadata\n'
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: invalid canonical record content fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record metadata is well-formed but invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-metadata-unit'
    const outcomeId = 'outcome-invalid-record-metadata-1'
    const operationId = 'invalid-record-metadata-operation-1'
    const evidenceEventId = 'evidence-invalid-record-metadata-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep the canonical record a regular file with otherwise-valid content,
    // but make its metadata fail readCanonicalRecord schema validation.
    const poisonedRecordText = validRecordText.replace('"schemaVersion":1', '"schemaVersion":2')
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('<!-- studiumx-learning-outcome {"schemaVersion":2,')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed invalid canonical record metadata fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record metadata identity is well-formed but invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-metadata-identity-unit'
    const outcomeId = 'outcome-invalid-record-metadata-identity-1'
    const operationId = 'invalid-record-metadata-identity-operation-1'
    const evidenceEventId = 'evidence-invalid-record-metadata-identity-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion and structure well-formed, but break the canonical recordId identity
    // so readCanonicalRecord rejects the metadata without treating it as recoverable authority.
    const expectedRecordId = `learning-outcome-${sessionId}-${outcomeId}`
    const poisonedRecordId = `learning-outcome-${sessionId}-poisoned-record-id`
    expect(validRecordText).toContain(`"recordId":"${expectedRecordId}"`)
    const poisonedRecordText = validRecordText.replace(
      `"recordId":"${expectedRecordId}"`,
      `"recordId":"${poisonedRecordId}"`
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(`"recordId":"${poisonedRecordId}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed invalid record identity metadata fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment is well-formed but invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-unit'
    const outcomeId = 'outcome-invalid-record-assessment-1'
    const operationId = 'invalid-record-assessment-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion and recordId well-formed/canonical, but break assessment contentSha256
    // so isVerifiedAssessment / readCanonicalRecord reject without treating it as recoverable authority.
    const validAssessmentSha = 'a'.repeat(64)
    const poisonedAssessmentSha = 'b'.repeat(16)
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    const poisonedRecordText = validRecordText.replace(
      `"contentSha256":"${validAssessmentSha}"`,
      `"contentSha256":"${poisonedAssessmentSha}"`
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(`"contentSha256":"${poisonedAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed invalid assessment metadata fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment path is well-formed but invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-path-unit'
    const outcomeId = 'outcome-invalid-record-assessment-path-1'
    const operationId = 'invalid-record-assessment-path-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-path-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, and assessment contentSha256 well-formed, but clear
    // assessment.relativePath so isVerifiedAssessment / readCanonicalRecord reject.
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    const validAssessmentSha = 'a'.repeat(64)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    const poisonedRecordText = validRecordText.replace(
      `"relativePath":"${validAssessmentPath}"`,
      '"relativePath":""'
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"relativePath":""')
    expect(poisonedRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed invalid assessment path fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record body prefix is well-formed but invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-body-prefix-unit'
    const outcomeId = 'outcome-invalid-record-body-prefix-1'
    const operationId = 'invalid-record-body-prefix-operation-1'
    const evidenceEventId = 'evidence-invalid-record-body-prefix-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep metadata JSON fields well-formed/canonical, but break the required markdown body
    // prefix so readCanonicalRecord rejects the otherwise-parseable record authority.
    const validBodyPrefix = '# Learning outcome: established\n'
    const poisonedBodyPrefix = '# Learning outcome: poisoned-body\n'
    expect(validRecordText).toContain(validBodyPrefix)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validBodyPrefix, poisonedBodyPrefix)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedBodyPrefix)
    expect(poisonedRecordText).not.toContain(validBodyPrefix)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed invalid record body prefix fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evidenceEventIds are well-formed but empty', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-empty-evidence-unit'
    const outcomeId = 'outcome-invalid-record-empty-evidence-1'
    const operationId = 'invalid-record-empty-evidence-operation-1'
    const evidenceEventId = 'evidence-invalid-record-empty-evidence-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, assessment, and body prefix well-formed/canonical, but clear
    // evidenceEventIds so readCanonicalRecord rejects the otherwise-parseable record authority.
    const validEvidence = `"evidenceEventIds":["${evidenceEventId}"]`
    const poisonedEvidence = '"evidenceEventIds":[]'
    expect(validRecordText).toContain(validEvidence)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validEvidence, poisonedEvidence)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvidence)
    expect(poisonedRecordText).not.toContain(validEvidence)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed empty evidenceEventIds fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evaluatorVersion is well-formed but invalid', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evaluator-version-unit'
    const outcomeId = 'outcome-invalid-record-evaluator-version-1'
    const operationId = 'invalid-record-evaluator-version-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evaluator-version-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, evidenceEventIds, assessment, and body prefix well-formed/canonical,
    // but null evaluatorVersion so number()/readCanonicalRecord reject the otherwise-parseable authority.
    const validEvaluator = '"evaluatorVersion":1'
    const poisonedEvaluator = '"evaluatorVersion":null'
    expect(validRecordText).toContain(validEvaluator)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validEvaluator, poisonedEvaluator)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvaluator)
    expect(poisonedRecordText).not.toContain(validEvaluator)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed invalid evaluatorVersion fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record sessionId is well-formed but mismatched', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-session-mismatch-unit'
    const outcomeId = 'outcome-invalid-record-session-mismatch-1'
    const operationId = 'invalid-record-session-mismatch-operation-1'
    const evidenceEventId = 'evidence-invalid-record-session-mismatch-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment canonical for this session path, but mismatch metadata sessionId
    // so readCanonicalRecord rejects (recordedSessionId !== sessionId from path).
    const validSession = `"sessionId":"${sessionId}"`
    const poisonedSessionId = 'session-invalid-record-session-mismatch-poisoned'
    const poisonedSession = `"sessionId":"${poisonedSessionId}"`
    expect(validRecordText).toContain(validSession)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validSession, poisonedSession)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedSession)
    expect(poisonedRecordText).not.toContain(validSession)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed mismatched sessionId fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record operationId is well-formed but non-canonical', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-operation-case-unit'
    const outcomeId = 'outcome-invalid-record-operation-case-1'
    const operationId = 'invalid-record-operation-case-operation-1'
    const evidenceEventId = 'evidence-invalid-record-operation-case-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/sessionId canonical, but store a mixed-case operationId
    // so requireOperationId lowercases and readCanonicalRecord rejects non-canonical stored identity.
    const validOperation = `"operationId":"${operationId}"`
    const poisonedOperationId = operationId.toUpperCase()
    const poisonedOperation = `"operationId":"${poisonedOperationId}"`
    expect(validRecordText).toContain(validOperation)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    const poisonedRecordText = validRecordText.replace(validOperation, poisonedOperation)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedOperation)
    expect(poisonedRecordText).not.toContain(validOperation)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed non-canonical operationId fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evaluatorVersion is well-formed but zero', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evaluator-zero-unit'
    const outcomeId = 'outcome-invalid-record-evaluator-zero-1'
    const operationId = 'invalid-record-evaluator-zero-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evaluator-zero-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set evaluatorVersion to 0 so number() rejects
    // (requires integer >= 1) and readCanonicalRecord fails closed without repair.
    const validEvaluator = '"evaluatorVersion":1'
    const poisonedEvaluator = '"evaluatorVersion":0'
    expect(validRecordText).toContain(validEvaluator)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    const poisonedRecordText = validRecordText.replace(validEvaluator, poisonedEvaluator)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvaluator)
    expect(poisonedRecordText).not.toContain(validEvaluator)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed zero evaluatorVersion fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evaluatorVersion is well-formed but a string', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evaluator-string-unit'
    const outcomeId = 'outcome-invalid-record-evaluator-string-1'
    const operationId = 'invalid-record-evaluator-string-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evaluator-string-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set evaluatorVersion to a JSON string so number()
    // rejects (requires integer >= 1) and readCanonicalRecord fails closed without repair.
    const validEvaluator = '"evaluatorVersion":1'
    const poisonedEvaluator = '"evaluatorVersion":"1"'
    expect(validRecordText).toContain(validEvaluator)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    const poisonedRecordText = validRecordText.replace(validEvaluator, poisonedEvaluator)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvaluator)
    expect(poisonedRecordText).not.toContain(validEvaluator)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed string evaluatorVersion fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evaluatorVersion is well-formed but non-integer', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evaluator-float-unit'
    const outcomeId = 'outcome-invalid-record-evaluator-float-1'
    const operationId = 'invalid-record-evaluator-float-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evaluator-float-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set evaluatorVersion to a non-integer number so
    // number() rejects (requires integer >= 1) and readCanonicalRecord fails closed without repair.
    const validEvaluator = '"evaluatorVersion":1'
    const poisonedEvaluator = '"evaluatorVersion":1.5'
    expect(validRecordText).toContain(validEvaluator)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    // 1.5 still contains the substring ":1", so replace the full JSON number token including trailing delimiter.
    const evaluatorToken = /"evaluatorVersion":1(?=[,}\s])/
    expect(validRecordText.match(evaluatorToken)?.[0]).toBe(validEvaluator)
    const poisonedRecordText = validRecordText.replace(evaluatorToken, poisonedEvaluator)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvaluator)
    expect(poisonedRecordText.match(evaluatorToken)).toBeNull()
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed non-integer evaluatorVersion fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evaluatorVersion is well-formed but negative', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evaluator-negative-unit'
    const outcomeId = 'outcome-invalid-record-evaluator-negative-1'
    const operationId = 'invalid-record-evaluator-negative-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evaluator-negative-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set evaluatorVersion to a negative integer so
    // number() rejects (requires integer >= 1) and readCanonicalRecord fails closed without repair.
    const validEvaluator = '"evaluatorVersion":1'
    const poisonedEvaluator = '"evaluatorVersion":-1'
    expect(validRecordText).toContain(validEvaluator)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    // Replace the full JSON number token including trailing delimiter so schemaVersion:1 is untouched.
    const evaluatorToken = /"evaluatorVersion":1(?=[,}\s])/
    expect(validRecordText.match(evaluatorToken)?.[0]).toBe(validEvaluator)
    const poisonedRecordText = validRecordText.replace(evaluatorToken, poisonedEvaluator)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvaluator)
    expect(poisonedRecordText.match(evaluatorToken)).toBeNull()
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed negative evaluatorVersion fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record outcomeKind is well-formed but does not write a learning record', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-kind-not-evidenced-unit'
    const outcomeId = 'outcome-invalid-record-outcome-kind-not-evidenced-1'
    const operationId = 'invalid-record-outcome-kind-not-evidenced-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-kind-not-evidenced-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/sessionId/operationId canonical, but set outcomeKind to
    // not_evidenced so writesLearningRecord(kind) is false and readCanonicalRecord rejects the record file.
    const validKind = '"outcomeKind":"established"'
    const poisonedKind = '"outcomeKind":"not_evidenced"'
    expect(validRecordText).toContain(validKind)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(validRecordText).toContain(`"operationId":"${operationId}"`)
    // Body prefix also embeds the kind after the metadata block; poison both metadata and body heading.
    const validBodyHeading = '# Learning outcome: established\n'
    const poisonedBodyHeading = '# Learning outcome: not_evidenced\n'
    expect(validRecordText).toContain(validBodyHeading)
    let poisonedRecordText = validRecordText.replace(validKind, poisonedKind)
    poisonedRecordText = poisonedRecordText.replace(validBodyHeading, poisonedBodyHeading)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedKind)
    expect(poisonedRecordText).not.toContain(validKind)
    expect(poisonedRecordText).toContain(poisonedBodyHeading)
    expect(poisonedRecordText).not.toContain(validBodyHeading)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(poisonedRecordText).toContain(`"operationId":"${operationId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed non-writing outcomeKind on a record file fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record outcomeKind is well-formed but does not write a learning record with needs_practice', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-kind-needs-practice-unit'
    const outcomeId = 'outcome-invalid-record-outcome-kind-needs-practice-1'
    const operationId = 'invalid-record-outcome-kind-needs-practice-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-kind-needs-practice-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/sessionId/operationId canonical, but set outcomeKind to
    // needs_practice so writesLearningRecord(kind) is false and readCanonicalRecord rejects the record file.
    const validKind = '"outcomeKind":"established"'
    const poisonedKind = '"outcomeKind":"needs_practice"'
    expect(validRecordText).toContain(validKind)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(validRecordText).toContain(`"operationId":"${operationId}"`)
    // Body prefix also embeds the kind after the metadata block; poison both metadata and body heading.
    const validBodyHeading = '# Learning outcome: established\n'
    const poisonedBodyHeading = '# Learning outcome: needs_practice\n'
    expect(validRecordText).toContain(validBodyHeading)
    let poisonedRecordText = validRecordText.replace(validKind, poisonedKind)
    poisonedRecordText = poisonedRecordText.replace(validBodyHeading, poisonedBodyHeading)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedKind)
    expect(poisonedRecordText).not.toContain(validKind)
    expect(poisonedRecordText).toContain(poisonedBodyHeading)
    expect(poisonedRecordText).not.toContain(validBodyHeading)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(poisonedRecordText).toContain(`"operationId":"${operationId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed needs_practice outcomeKind on a record file fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record outcomeKind is well-formed but is unknown to the outcomeKind enum', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-kind-unknown-unit'
    const outcomeId = 'outcome-invalid-record-outcome-kind-unknown-1'
    const operationId = 'invalid-record-outcome-kind-unknown-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-kind-unknown-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/sessionId/operationId canonical, but set outcomeKind to
    // unknown_kind so outcomeKind() returns null and readCanonicalRecord rejects the record file.
    const validKind = '"outcomeKind":"established"'
    const poisonedKind = '"outcomeKind":"unknown_kind"'
    expect(validRecordText).toContain(validKind)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(validRecordText).toContain(`"operationId":"${operationId}"`)
    // Body prefix also embeds the kind after the metadata block; poison both metadata and body heading.
    const validBodyHeading = '# Learning outcome: established\n'
    const poisonedBodyHeading = '# Learning outcome: unknown_kind\n'
    expect(validRecordText).toContain(validBodyHeading)
    let poisonedRecordText = validRecordText.replace(validKind, poisonedKind)
    poisonedRecordText = poisonedRecordText.replace(validBodyHeading, poisonedBodyHeading)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedKind)
    expect(poisonedRecordText).not.toContain(validKind)
    expect(poisonedRecordText).toContain(poisonedBodyHeading)
    expect(poisonedRecordText).not.toContain(validBodyHeading)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(poisonedRecordText).toContain(`"operationId":"${operationId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: unknown outcomeKind enum value on a record file fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record outcomeId is well-formed but empty', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-empty-outcome-id-unit'
    const outcomeId = 'outcome-invalid-record-empty-outcome-id-1'
    const operationId = 'invalid-record-empty-outcome-id-operation-1'
    const evidenceEventId = 'evidence-invalid-record-empty-outcome-id-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/sessionId/operationId/kind canonical, but clear outcomeId
    // so text() returns null and readCanonicalRecord rejects the otherwise-parseable record authority.
    const validOutcomeId = `"outcomeId":"${outcomeId}"`
    const poisonedOutcomeId = '"outcomeId":""'
    expect(validRecordText).toContain(validOutcomeId)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(validRecordText).toContain(`"operationId":"${operationId}"`)
    const poisonedRecordText = validRecordText.replace(validOutcomeId, poisonedOutcomeId)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedOutcomeId)
    expect(poisonedRecordText).not.toContain(validOutcomeId)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(poisonedRecordText).toContain(`"operationId":"${operationId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed empty outcomeId fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment contentSha256 is well-formed length but non-hex', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-nonhex-unit'
    const outcomeId = 'outcome-invalid-record-assessment-nonhex-1'
    const operationId = 'invalid-record-assessment-nonhex-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-nonhex-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, assessment relativePath, and body prefix well-formed/canonical,
    // but set assessment contentSha256 to a 64-char non-hex token so isVerifiedAssessment rejects
    // (regex requires lowercase hex [a-f0-9]{64}; length alone is not enough).
    const validAssessmentSha = 'a'.repeat(64)
    const poisonedAssessmentSha = 'g'.repeat(64)
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(
      `"contentSha256":"${validAssessmentSha}"`,
      `"contentSha256":"${poisonedAssessmentSha}"`
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(`"contentSha256":"${poisonedAssessmentSha}"`)
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed 64-char non-hex assessment contentSha256 fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment is well-formed but null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-null-unit'
    const outcomeId = 'outcome-invalid-record-assessment-null-1'
    const operationId = 'invalid-record-assessment-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, sessionId, body prefix well-formed/canonical, but set
    // assessment to null so isVerifiedAssessment rejects (requires object with path + hex sha).
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    // Replace the full assessment object token with null while leaving other fields intact.
    const assessmentObject = `"assessment":{"relativePath":"${validAssessmentPath}","contentSha256":"${validAssessmentSha}"}`
    const poisonedAssessment = '"assessment":null'
    expect(validRecordText).toContain(assessmentObject)
    const poisonedRecordText = validRecordText.replace(assessmentObject, poisonedAssessment)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedAssessment)
    expect(poisonedRecordText).not.toContain(assessmentObject)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed null assessment fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment contentSha256 is well-formed length but uppercase hex', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-upper-unit'
    const outcomeId = 'outcome-invalid-record-assessment-upper-1'
    const operationId = 'invalid-record-assessment-upper-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-upper-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, assessment relativePath length/shape, and body prefix canonical,
    // but set assessment contentSha256 to 64-char uppercase hex so isVerifiedAssessment rejects
    // (regex requires lowercase [a-f0-9]{64}; A-F is not accepted).
    const validAssessmentSha = 'a'.repeat(64)
    const poisonedAssessmentSha = 'A'.repeat(64)
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(
      `"contentSha256":"${validAssessmentSha}"`,
      `"contentSha256":"${poisonedAssessmentSha}"`
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(`"contentSha256":"${poisonedAssessmentSha}"`)
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed 64-char uppercase assessment contentSha256 fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evidenceEventIds are well-formed but not an array', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evidence-nonarray-unit'
    const outcomeId = 'outcome-invalid-record-evidence-nonarray-1'
    const operationId = 'invalid-record-evidence-nonarray-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evidence-nonarray-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, assessment, and body prefix well-formed/canonical, but set
    // evidenceEventIds to a non-array value so stringArray throws and readCanonicalRecord fails closed.
    const validEvidence = `"evidenceEventIds":["${evidenceEventId}"]`
    const poisonedEvidence = '"evidenceEventIds":null'
    expect(validRecordText).toContain(validEvidence)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validEvidence, poisonedEvidence)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvidence)
    expect(poisonedRecordText).not.toContain(validEvidence)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed non-array evidenceEventIds fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evidenceEventIds are well-formed but contain a blank item', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evidence-blank-item-unit'
    const outcomeId = 'outcome-invalid-record-evidence-blank-item-1'
    const operationId = 'invalid-record-evidence-blank-item-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evidence-blank-item-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, assessment, and body prefix well-formed/canonical, but set
    // evidenceEventIds to contain a blank item so stringArray throws and readCanonicalRecord fails closed.
    const validEvidence = `"evidenceEventIds":["${evidenceEventId}"]`
    const poisonedEvidence = '"evidenceEventIds":[""]'
    expect(validRecordText).toContain(validEvidence)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validEvidence, poisonedEvidence)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvidence)
    expect(poisonedRecordText).not.toContain(validEvidence)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: well-formed blank evidenceEventIds item / stringArray throws.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record recordId is empty', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-empty-record-id-unit'
    const outcomeId = 'outcome-invalid-record-empty-record-id-1'
    const operationId = 'invalid-record-empty-record-id-operation-1'
    const evidenceEventId = 'evidence-invalid-record-empty-record-id-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, evidence, kind, assessment, and body prefix well-formed/canonical, but set
    // recordId to an empty string so text(value.recordId) is null and readCanonicalRecord fails closed.
    const validRecordId = `"recordId":"learning-outcome-${sessionId}-${outcomeId}"`
    const poisonedRecordId = '"recordId":""'
    expect(validRecordText).toContain(validRecordId)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"evidenceEventIds":["${evidenceEventId}"]`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validRecordId, poisonedRecordId)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedRecordId)
    expect(poisonedRecordText).not.toContain(validRecordId)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"evidenceEventIds":["${evidenceEventId}"]`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: empty recordId makes text(value.recordId) null / readCanonicalRecord fails closed.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record operationId is empty', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-empty-operation-id-unit'
    const outcomeId = 'outcome-invalid-record-empty-operation-id-1'
    const operationId = 'invalid-record-empty-operation-id-operation-1'
    const evidenceEventId = 'evidence-invalid-record-empty-operation-id-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, assessment, and body prefix well-formed/canonical, but set
    // operationId to an empty string so text(value.operationId) is null and readCanonicalRecord fails closed.
    const validOperationId = `"operationId":"${operationId}"`
    const poisonedOperationId = '"operationId":""'
    expect(validRecordText).toContain(validOperationId)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validOperationId, poisonedOperationId)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedOperationId)
    expect(poisonedRecordText).not.toContain(validOperationId)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: empty operationId makes text(value.operationId) null / readCanonicalRecord fails closed.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment is an array', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-array-unit'
    const outcomeId = 'outcome-invalid-record-assessment-array-1'
    const operationId = 'invalid-record-assessment-array-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-array-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, sessionId, body prefix well-formed/canonical, but set
    // assessment to an array so isVerifiedAssessment rejects (Array.isArray) and readCanonicalRecord fails closed.
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const assessmentObject = `"assessment":{"relativePath":"${validAssessmentPath}","contentSha256":"${validAssessmentSha}"}`
    const poisonedAssessment = '"assessment":[]'
    expect(validRecordText).toContain(assessmentObject)
    const poisonedRecordText = validRecordText.replace(assessmentObject, poisonedAssessment)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedAssessment)
    expect(poisonedRecordText).not.toContain(assessmentObject)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: array assessment makes isVerifiedAssessment reject / readCanonicalRecord fails closed.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-missing-unit'
    const outcomeId = 'outcome-invalid-record-assessment-missing-1'
    const operationId = 'invalid-record-assessment-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but remove the assessment key entirely so
    // isVerifiedAssessment rejects (undefined) and readCanonicalRecord fails closed.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toHaveProperty('assessment')
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established'
    })
    delete metadata.assessment
    expect(metadata).not.toHaveProperty('assessment')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"assessment"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing assessment key makes isVerifiedAssessment reject / readCanonicalRecord fails closed.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evidenceEventIds contain a non-string item', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evidence-nonstring-item-unit'
    const outcomeId = 'outcome-invalid-record-evidence-nonstring-item-1'
    const operationId = 'invalid-record-evidence-nonstring-item-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evidence-nonstring-item-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, assessment, and body prefix well-formed/canonical, but set
    // evidenceEventIds to contain a non-string item so stringArray throws and readCanonicalRecord fails closed.
    const validEvidence = `"evidenceEventIds":["${evidenceEventId}"]`
    const poisonedEvidence = '"evidenceEventIds":[1]'
    expect(validRecordText).toContain(validEvidence)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validEvidence, poisonedEvidence)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvidence)
    expect(poisonedRecordText).not.toContain(validEvidence)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: non-string evidenceEventIds item / stringArray throws on non-string item.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evidenceEventIds contain a whitespace-only item', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evidence-whitespace-item-unit'
    const outcomeId = 'outcome-invalid-record-evidence-whitespace-item-1'
    const operationId = 'invalid-record-evidence-whitespace-item-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evidence-whitespace-item-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, assessment, and body prefix well-formed/canonical, but set
    // evidenceEventIds to contain a whitespace-only item so stringArray throws and readCanonicalRecord fails closed.
    const validEvidence = `"evidenceEventIds":["${evidenceEventId}"]`
    const poisonedEvidence = '"evidenceEventIds":[" "]'
    expect(validRecordText).toContain(validEvidence)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validEvidence, poisonedEvidence)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvidence)
    expect(poisonedRecordText).not.toContain(validEvidence)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: whitespace-only evidenceEventIds item / stringArray throws on !item.trim().
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record outcomeId is whitespace-only', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-whitespace-outcome-id-unit'
    const outcomeId = 'outcome-invalid-record-whitespace-outcome-id-1'
    const operationId = 'invalid-record-whitespace-outcome-id-operation-1'
    const evidenceEventId = 'evidence-invalid-record-whitespace-outcome-id-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/sessionId/operationId/kind canonical, but set outcomeId to whitespace
    // so text() trims to null and readCanonicalRecord rejects the otherwise-parseable record authority.
    const validOutcomeId = `"outcomeId":"${outcomeId}"`
    const poisonedOutcomeId = '"outcomeId":" "'
    expect(validRecordText).toContain(validOutcomeId)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(validRecordText).toContain(`"operationId":"${operationId}"`)
    const poisonedRecordText = validRecordText.replace(validOutcomeId, poisonedOutcomeId)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedOutcomeId)
    expect(poisonedRecordText).not.toContain(validOutcomeId)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(poisonedRecordText).toContain(`"operationId":"${operationId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: whitespace-only outcomeId / text() trims to null and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment is a boolean', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-boolean-unit'
    const outcomeId = 'outcome-invalid-record-assessment-boolean-1'
    const operationId = 'invalid-record-assessment-boolean-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-boolean-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, sessionId, body prefix well-formed/canonical, but set
    // assessment to a boolean so isVerifiedAssessment rejects (requires an object with path + hex sha).
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    // Replace the full assessment object token with false while leaving other fields intact.
    const assessmentObject = `"assessment":{"relativePath":"${validAssessmentPath}","contentSha256":"${validAssessmentSha}"}`
    const poisonedAssessment = '"assessment":false'
    expect(validRecordText).toContain(assessmentObject)
    const poisonedRecordText = validRecordText.replace(assessmentObject, poisonedAssessment)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedAssessment)
    expect(poisonedRecordText).not.toContain(assessmentObject)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: boolean assessment / isVerifiedAssessment rejects non-object and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record operationId is whitespace-only', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-whitespace-operation-id-unit'
    const outcomeId = 'outcome-invalid-record-whitespace-operation-id-1'
    const operationId = 'invalid-record-whitespace-operation-id-operation-1'
    const evidenceEventId = 'evidence-invalid-record-whitespace-operation-id-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/sessionId/outcomeId/kind canonical, but set operationId to whitespace
    // so text() trims to null and readCanonicalRecord rejects the otherwise-parseable record authority.
    const validOperationId = `"operationId":"${operationId}"`
    const poisonedOperationId = '"operationId":" "'
    expect(validRecordText).toContain(validOperationId)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(validRecordText).toContain(`"outcomeId":"${outcomeId}"`)
    const poisonedRecordText = validRecordText.replace(validOperationId, poisonedOperationId)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedOperationId)
    expect(poisonedRecordText).not.toContain(validOperationId)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(poisonedRecordText).toContain(`"outcomeId":"${outcomeId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: whitespace-only operationId / text() trims to null and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment is a number', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-number-assessment-unit'
    const outcomeId = 'outcome-invalid-record-number-assessment-1'
    const operationId = 'invalid-record-number-assessment-operation-1'
    const evidenceEventId = 'evidence-invalid-record-number-assessment-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, sessionId, body prefix well-formed/canonical, but set
    // assessment to a number so isVerifiedAssessment rejects (requires an object with path + hex sha).
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    // Replace the full assessment object token with a number while leaving other fields intact.
    const assessmentObject = `"assessment":{"relativePath":"${validAssessmentPath}","contentSha256":"${validAssessmentSha}"}`
    const poisonedAssessment = '"assessment":1'
    expect(validRecordText).toContain(assessmentObject)
    const poisonedRecordText = validRecordText.replace(assessmentObject, poisonedAssessment)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedAssessment)
    expect(poisonedRecordText).not.toContain(assessmentObject)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: number assessment / isVerifiedAssessment rejects non-object and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record recordId is whitespace-only', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-whitespace-record-id-unit'
    const outcomeId = 'outcome-invalid-record-whitespace-record-id-1'
    const operationId = 'invalid-record-whitespace-record-id-operation-1'
    const evidenceEventId = 'evidence-invalid-record-whitespace-record-id-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/body/assessment/sessionId/outcomeId/operationId/kind canonical, but set recordId to whitespace
    // so text() trims to null and readCanonicalRecord rejects the otherwise-parseable record authority.
    const validRecordId = `"recordId":"learning-outcome-${sessionId}-${outcomeId}"`
    const poisonedRecordId = '"recordId":" "'
    expect(validRecordText).toContain(validRecordId)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(validRecordText).toContain(`"outcomeId":"${outcomeId}"`)
    expect(validRecordText).toContain(`"operationId":"${operationId}"`)
    const poisonedRecordText = validRecordText.replace(validRecordId, poisonedRecordId)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedRecordId)
    expect(poisonedRecordText).not.toContain(validRecordId)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"sessionId":"${sessionId}"`)
    expect(poisonedRecordText).toContain(`"outcomeId":"${outcomeId}"`)
    expect(poisonedRecordText).toContain(`"operationId":"${operationId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: whitespace-only recordId / text() trims to null and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment is a string', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-string-assessment-unit'
    const outcomeId = 'outcome-invalid-record-string-assessment-1'
    const operationId = 'invalid-record-string-assessment-operation-1'
    const evidenceEventId = 'evidence-invalid-record-string-assessment-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, kind, sessionId, body prefix well-formed/canonical, but set
    // assessment to a string so isVerifiedAssessment rejects (requires an object with path + hex sha).
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    // Replace the full assessment object token with a string while leaving other fields intact.
    const assessmentObject = `"assessment":{"relativePath":"${validAssessmentPath}","contentSha256":"${validAssessmentSha}"}`
    const poisonedAssessment = '"assessment":"not-an-assessment-object"'
    expect(validRecordText).toContain(assessmentObject)
    const poisonedRecordText = validRecordText.replace(assessmentObject, poisonedAssessment)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedAssessment)
    expect(poisonedRecordText).not.toContain(assessmentObject)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: string assessment / isVerifiedAssessment rejects non-object and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record sessionId is whitespace-only', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-whitespace-session-id-unit'
    const outcomeId = 'outcome-invalid-record-whitespace-session-id-1'
    const operationId = 'invalid-record-whitespace-session-id-operation-1'
    const evidenceEventId = 'evidence-invalid-record-whitespace-session-id-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep path/recordId/body/assessment/outcomeId/operationId/kind canonical, but set sessionId to whitespace
    // so text() trims to null and recordedSessionId !== sessionId fails closed without repair.
    const validSessionId = `"sessionId":"${sessionId}"`
    const poisonedSessionId = '"sessionId":" "'
    expect(validRecordText).toContain(validSessionId)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    expect(validRecordText).toContain(`"outcomeId":"${outcomeId}"`)
    expect(validRecordText).toContain(`"operationId":"${operationId}"`)
    const poisonedRecordText = validRecordText.replace(validSessionId, poisonedSessionId)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedSessionId)
    expect(poisonedRecordText).not.toContain(validSessionId)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(`"outcomeId":"${outcomeId}"`)
    expect(poisonedRecordText).toContain(`"operationId":"${operationId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: whitespace-only sessionId / text() trims to null and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment relativePath is whitespace-only', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-path-whitespace-unit'
    const outcomeId = 'outcome-invalid-record-assessment-path-whitespace-1'
    const operationId = 'invalid-record-assessment-path-whitespace-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-path-whitespace-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion, recordId, and assessment contentSha256 well-formed, but set
    // assessment.relativePath to whitespace so text() trims to null and isVerifiedAssessment rejects.
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    const validAssessmentSha = 'a'.repeat(64)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    const poisonedRecordText = validRecordText.replace(
      `"relativePath":"${validAssessmentPath}"`,
      '"relativePath":" "'
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"relativePath":" "')
    expect(poisonedRecordText).not.toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: whitespace-only assessment relativePath / text() null / fail closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment contentSha256 key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-missing-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-missing-1'
    const operationId = 'invalid-record-assessment-sha-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/path well-formed, but drop assessment.contentSha256 so
    // isVerifiedAssessment rejects via missing hex digest while leaving relativePath intact.
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    const assessmentObject = `"assessment":{"relativePath":"${validAssessmentPath}","contentSha256":"${validAssessmentSha}"}`
    const poisonedAssessment = `"assessment":{"relativePath":"${validAssessmentPath}"}`
    expect(validRecordText).toContain(assessmentObject)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(assessmentObject, poisonedAssessment)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedAssessment)
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing assessment contentSha256 key / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record evidenceEventIds contain a null item', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evidence-null-item-unit'
    const outcomeId = 'outcome-invalid-record-evidence-null-item-1'
    const operationId = 'invalid-record-evidence-null-item-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evidence-null-item-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/kind/body/assessment canonical, but set evidenceEventIds to contain
    // a null item so stringArray throws and readCanonicalRecord fails closed.
    const validEvidence = `"evidenceEventIds":["${evidenceEventId}"]`
    const poisonedEvidence = '"evidenceEventIds":[null]'
    expect(validRecordText).toContain(validEvidence)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(validEvidence, poisonedEvidence)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedEvidence)
    expect(poisonedRecordText).not.toContain(validEvidence)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null evidenceEventIds item / stringArray throws on non-string and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment relativePath key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-path-key-missing-unit'
    const outcomeId = 'outcome-invalid-record-assessment-path-key-missing-1'
    const operationId = 'invalid-record-assessment-path-key-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-path-key-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/contentSha256 well-formed, but drop assessment.relativePath so
    // isVerifiedAssessment rejects via missing path while leaving contentSha256 intact.
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    const assessmentObject = `"assessment":{"relativePath":"${validAssessmentPath}","contentSha256":"${validAssessmentSha}"}`
    const poisonedAssessment = `"assessment":{"contentSha256":"${validAssessmentSha}"}`
    expect(validRecordText).toContain(assessmentObject)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(assessmentObject, poisonedAssessment)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(poisonedAssessment)
    expect(poisonedRecordText).not.toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing assessment relativePath key / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment contentSha256 is empty', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-empty-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-empty-1'
    const operationId = 'invalid-record-assessment-sha-empty-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-empty-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/relativePath well-formed, but set assessment.contentSha256 to empty
    // so isVerifiedAssessment rejects via hex-length regex while leaving relativePath intact.
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(
      `"contentSha256":"${validAssessmentSha}"`,
      '"contentSha256":""'
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"contentSha256":""')
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: empty assessment contentSha256 / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record schemaVersion key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-missing-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-missing-1'
    const operationId = 'invalid-record-schema-version-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep recordId/kind/body/assessment canonical, but drop schemaVersion so the strict equality
    // against LEARNING_OUTCOME_COMMITTER_SCHEMA_VERSION fails closed without repair.
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace('"schemaVersion":1,', '')
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"schemaVersion"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing schemaVersion key / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record assessment is an empty object', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-empty-object-unit'
    const outcomeId = 'outcome-invalid-record-assessment-empty-object-1'
    const operationId = 'invalid-record-assessment-empty-object-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-empty-object-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep metadata and the body heading/prefix canonical, but replace assessment with an empty
    // object so text() cannot supply relativePath/contentSha256 to isVerifiedAssessment.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    const canonicalBody = validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      assessment: {
        relativePath: 'courses/foundations/lesson-1-assessment.html',
        contentSha256: 'a'.repeat(64)
      }
    })
    metadata.assessment = {}
    expect(metadata.assessment).toEqual({})
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      canonicalBody
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"assessment":{}')
    expect(poisonedRecordText.endsWith(canonicalBody)).toBe(true)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: empty-object assessment / isVerifiedAssessment fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record outcomeId key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-id-missing-unit'
    const outcomeId = 'outcome-invalid-record-outcome-id-missing-1'
    const operationId = 'invalid-record-outcome-id-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-id-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/assessment/body canonical, but remove outcomeId so text() returns
    // null while recordId intentionally continues to embed the original outcome id.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeId,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    delete metadata.outcomeId
    expect(metadata).not.toHaveProperty('outcomeId')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"outcomeId"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing outcomeId key / text() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })

  it('fails closed on restart when the canonical learning record operationId key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-operation-id-missing-unit'
    const outcomeId = 'outcome-invalid-record-operation-id-missing-1'
    const operationId = 'invalid-record-operation-id-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-operation-id-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/assessment/body/outcomeId canonical, but remove operationId so text()
    // returns null and readCanonicalRecord fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      operationId,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    delete metadata.operationId
    expect(metadata).not.toHaveProperty('operationId')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"operationId"')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing operationId key / text() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record sessionId key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-session-id-missing-unit'
    const outcomeId = 'outcome-invalid-record-session-id-missing-1'
    const operationId = 'invalid-record-session-id-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-session-id-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/assessment/body/outcomeId/operationId canonical, but remove sessionId so
    // text() returns null and readCanonicalRecord fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      sessionId,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    delete metadata.sessionId
    expect(metadata).not.toHaveProperty('sessionId')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"sessionId"')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain('"operationId"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing sessionId key / text() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record evidenceEventIds key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evidence-ids-missing-unit'
    const outcomeId = 'outcome-invalid-record-evidence-ids-missing-1'
    const operationId = 'invalid-record-evidence-ids-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evidence-ids-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but remove evidenceEventIds so recovery fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      evidenceEventIds: [evidenceEventId],
      outcomeKind: 'established'
    })
    expect(metadata).toHaveProperty('assessment')
    delete metadata.evidenceEventIds
    expect(metadata).not.toHaveProperty('evidenceEventIds')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"evidenceEventIds"')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).not.toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing evidenceEventIds key / stringArray throws fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record evaluatorVersion key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-evaluator-version-missing-unit'
    const outcomeId = 'outcome-invalid-record-evaluator-version-missing-1'
    const operationId = 'invalid-record-evaluator-version-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-evaluator-version-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but remove evaluatorVersion so recovery fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      evaluatorVersion: 1,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    delete metadata.evaluatorVersion
    expect(metadata).not.toHaveProperty('evaluatorVersion')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"evaluatorVersion"')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing evaluatorVersion key / number() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record outcomeKind key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-kind-missing-unit'
    const outcomeId = 'outcome-invalid-record-outcome-kind-missing-1'
    const operationId = 'invalid-record-outcome-kind-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-kind-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but remove outcomeKind so recovery fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    delete metadata.outcomeKind
    expect(metadata).not.toHaveProperty('outcomeKind')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"outcomeKind"')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).not.toContain('"outcomeKind"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing outcomeKind key / outcomeKind() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record recordId key is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-record-id-missing-unit'
    const outcomeId = 'outcome-invalid-record-record-id-missing-1'
    const operationId = 'invalid-record-record-id-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-record-id-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but remove/replace recordId so recovery fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    delete metadata.recordId
    expect(metadata).not.toHaveProperty('recordId')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).not.toContain('"recordId"')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing recordId key / text() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record schemaVersion is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-null-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-null-1'
    const operationId = 'invalid-record-schema-version-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set schemaVersion to null so strict equality fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    expect(metadata.schemaVersion).toBe(1)
    metadata.schemaVersion = null
    expect(metadata.schemaVersion).toBeNull()
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"schemaVersion":null')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null schemaVersion / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record schemaVersion is a string', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-string-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-string-1'
    const operationId = 'invalid-record-schema-version-string-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-string-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set schemaVersion to string "1" so strict equality fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    expect(metadata.schemaVersion).toBe(1)
    metadata.schemaVersion = '1'
    expect(metadata.schemaVersion).toBe('1')
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"schemaVersion":"1"')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: string schemaVersion / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment contentSha256 is whitespace-only', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-whitespace-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-whitespace-1'
    const operationId = 'invalid-record-assessment-sha-whitespace-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-whitespace-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/relativePath well-formed, but set assessment.contentSha256 to whitespace-only
    // so text() returns null / isVerifiedAssessment rejects while leaving relativePath intact.
    const validAssessmentSha = 'a'.repeat(64)
    const validAssessmentPath = 'courses/foundations/lesson-1-assessment.html'
    expect(validRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(validRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(validRecordText).toContain('"schemaVersion":1')
    expect(validRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(validRecordText).toContain('"outcomeKind":"established"')
    const poisonedRecordText = validRecordText.replace(
      `"contentSha256":"${validAssessmentSha}"`,
      '"contentSha256":"   "'
    )
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"contentSha256":"   "')
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: whitespace-only assessment contentSha256 / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record schemaVersion is a boolean', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-boolean-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-boolean-1'
    const operationId = 'invalid-record-schema-version-boolean-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-boolean-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set schemaVersion to boolean true so strict equality fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    expect(metadata.schemaVersion).toBe(1)
    metadata.schemaVersion = true
    expect(metadata.schemaVersion).toBe(true)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"schemaVersion":true')
    expect(poisonedRecordText).not.toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: boolean schemaVersion / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment contentSha256 is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-null-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-null-1'
    const operationId = 'invalid-record-assessment-sha-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/relativePath well-formed, but set assessment.contentSha256 to null
    // so text() returns null / isVerifiedAssessment rejects while leaving relativePath intact.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    const assessment = metadata.assessment as Record<string, unknown>
    expect(typeof assessment).toBe('object')
    expect(assessment).not.toBeNull()
    expect(Array.isArray(assessment)).toBe(false)
    const validAssessmentSha = assessment.contentSha256
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(typeof validAssessmentPath).toBe('string')
    expect(validAssessmentSha).toMatch(/^[a-f0-9]{64}$/)
    assessment.contentSha256 = null
    expect(assessment.contentSha256).toBeNull()
    expect(assessment.relativePath).toBe(validAssessmentPath)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"contentSha256":null')
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null assessment contentSha256 / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record schemaVersion is a non-integer number', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-float-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-float-1'
    const operationId = 'invalid-record-schema-version-float-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-float-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set schemaVersion to 1.5 so strict equality fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    expect(metadata.schemaVersion).toBe(1)
    metadata.schemaVersion = 1.5
    expect(metadata.schemaVersion).toBe(1.5)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"schemaVersion":1.5')
    expect(poisonedRecordText).not.toContain('"schemaVersion":1,')
    expect(poisonedRecordText).not.toContain('"schemaVersion":1}')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: non-integer numeric schemaVersion / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment relativePath is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-path-null-unit'
    const outcomeId = 'outcome-invalid-record-assessment-path-null-1'
    const operationId = 'invalid-record-assessment-path-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-path-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/contentSha256 well-formed, but set assessment.relativePath to null
    // so text() returns null / isVerifiedAssessment rejects while leaving contentSha256 intact.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    const assessment = metadata.assessment as Record<string, unknown>
    expect(typeof assessment).toBe('object')
    expect(assessment).not.toBeNull()
    expect(Array.isArray(assessment)).toBe(false)
    const validAssessmentSha = assessment.contentSha256
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(typeof validAssessmentPath).toBe('string')
    expect(validAssessmentSha).toMatch(/^[a-f0-9]{64}$/)
    assessment.relativePath = null
    expect(assessment.relativePath).toBeNull()
    expect(assessment.contentSha256).toBe(validAssessmentSha)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"relativePath":null')
    expect(poisonedRecordText).not.toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null assessment relativePath / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment contentSha256 is a number', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-number-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-number-1'
    const operationId = 'invalid-record-assessment-sha-number-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-number-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/relativePath well-formed, but set assessment.contentSha256 to a number
    // so text() returns null / isVerifiedAssessment rejects while leaving relativePath intact.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const assessment = metadata.assessment as Record<string, unknown>
    const validAssessmentSha = assessment.contentSha256
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(typeof validAssessmentPath).toBe('string')
    assessment.contentSha256 = 1
    expect(assessment.contentSha256).toBe(1)
    expect(assessment.relativePath).toBe(validAssessmentPath)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"contentSha256":1')
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: number assessment contentSha256 / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment relativePath is a boolean', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-path-boolean-unit'
    const outcomeId = 'outcome-invalid-record-assessment-path-boolean-1'
    const operationId = 'invalid-record-assessment-path-boolean-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-path-boolean-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/contentSha256 well-formed, but set assessment.relativePath to boolean true
    // so text() returns null / isVerifiedAssessment rejects while leaving contentSha256 intact.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const assessment = metadata.assessment as Record<string, unknown>
    const validAssessmentSha = assessment.contentSha256
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(typeof validAssessmentPath).toBe('string')
    assessment.relativePath = true
    expect(assessment.relativePath).toBe(true)
    expect(assessment.contentSha256).toBe(validAssessmentSha)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"relativePath":true')
    expect(poisonedRecordText).not.toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: boolean assessment relativePath / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment contentSha256 is a boolean', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-boolean-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-boolean-1'
    const operationId = 'invalid-record-assessment-sha-boolean-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-boolean-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/relativePath well-formed, but set assessment.contentSha256 to boolean true
    // so text() returns null / isVerifiedAssessment rejects while leaving relativePath intact.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const assessment = metadata.assessment as Record<string, unknown>
    const validAssessmentSha = assessment.contentSha256
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(typeof validAssessmentPath).toBe('string')
    assessment.contentSha256 = true
    expect(assessment.contentSha256).toBe(true)
    expect(assessment.relativePath).toBe(validAssessmentPath)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"contentSha256":true')
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)

    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: boolean assessment contentSha256 / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment relativePath is a number', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-path-number-unit'
    const outcomeId = 'outcome-invalid-record-assessment-path-number-1'
    const operationId = 'invalid-record-assessment-path-number-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-path-number-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/contentSha256 well-formed, but set assessment.relativePath to a number
    // so text() returns null / isVerifiedAssessment rejects while leaving contentSha256 intact.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const assessment = metadata.assessment as Record<string, unknown>
    const validAssessmentSha = assessment.contentSha256
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(typeof validAssessmentPath).toBe('string')
    assessment.relativePath = 1
    expect(assessment.relativePath).toBe(1)
    expect(assessment.contentSha256).toBe(validAssessmentSha)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"relativePath":1')
    expect(poisonedRecordText).not.toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain(`"contentSha256":"${validAssessmentSha}"`)

    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: number assessment relativePath / isVerifiedAssessment rejects and fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment contentSha256 is short lowercase hex', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-short-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-short-1'
    const operationId = 'invalid-record-assessment-sha-short-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-short-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/relativePath well-formed, but set assessment.contentSha256 to 63-char lowercase hex
    // so /^[a-f0-9]{64}$/ rejects by length (distinct from empty/whitespace/non-hex/uppercase residuals).
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const assessment = metadata.assessment as Record<string, unknown>
    const validAssessmentSha = assessment.contentSha256 as string
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(validAssessmentSha).toMatch(/^[a-f0-9]{64}$/)
    expect(typeof validAssessmentPath).toBe('string')
    const shortSha = 'a'.repeat(63)
    expect(shortSha).toHaveLength(63)
    expect(shortSha).toMatch(/^[a-f0-9]{63}$/)
    assessment.contentSha256 = shortSha
    expect(assessment.contentSha256).toBe(shortSha)
    expect(assessment.relativePath).toBe(validAssessmentPath)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(`"contentSha256":"${shortSha}"`)
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: 63-char lowercase-hex assessment contentSha256 / length regex fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record schemaVersion is an array', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-array-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-array-1'
    const operationId = 'invalid-record-schema-version-array-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-array-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set schemaVersion to [] so strict equality fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    expect(metadata.schemaVersion).toBe(1)
    metadata.schemaVersion = []
    expect(Array.isArray(metadata.schemaVersion)).toBe(true)
    expect(metadata.schemaVersion).toEqual([])
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"schemaVersion":[]')
    expect(poisonedRecordText).not.toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: array schemaVersion / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record assessment contentSha256 is long lowercase hex', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-assessment-sha-long-unit'
    const outcomeId = 'outcome-invalid-record-assessment-sha-long-1'
    const operationId = 'invalid-record-assessment-sha-long-operation-1'
    const evidenceEventId = 'evidence-invalid-record-assessment-sha-long-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep schemaVersion/recordId/relativePath well-formed, but set assessment.contentSha256 to 65-char lowercase hex
    // so /^[a-f0-9]{64}$/ rejects by length (distinct from short/empty/whitespace/non-hex/uppercase residuals).
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    const assessment = metadata.assessment as Record<string, unknown>
    const validAssessmentSha = assessment.contentSha256 as string
    const validAssessmentPath = assessment.relativePath
    expect(typeof validAssessmentSha).toBe('string')
    expect(validAssessmentSha).toMatch(/^[a-f0-9]{64}$/)
    expect(typeof validAssessmentPath).toBe('string')
    const longSha = 'a'.repeat(65)
    expect(longSha).toHaveLength(65)
    expect(longSha).toMatch(/^[a-f0-9]{65}$/)
    assessment.contentSha256 = longSha
    expect(assessment.contentSha256).toBe(longSha)
    expect(assessment.relativePath).toBe(validAssessmentPath)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain(`"contentSha256":"${longSha}"`)
    expect(poisonedRecordText).not.toContain(`"contentSha256":"${validAssessmentSha}"`)
    expect(poisonedRecordText).toContain(`"relativePath":"${validAssessmentPath}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: 65-char lowercase-hex assessment contentSha256 / length regex fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record schemaVersion is an object', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-object-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-object-1'
    const operationId = 'invalid-record-schema-version-object-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-object-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set schemaVersion to {} so strict equality fails closed without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('assessment')
    expect(metadata.schemaVersion).toBe(1)
    metadata.schemaVersion = {}
    expect(metadata.schemaVersion).toEqual({})
    expect(typeof metadata.schemaVersion).toBe('object')
    expect(Array.isArray(metadata.schemaVersion)).toBe(false)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"schemaVersion":{}')
    expect(poisonedRecordText).not.toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: object schemaVersion / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record metadata is preceded by leading garbage', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-metadata-leading-garbage-unit'
    const outcomeId = 'outcome-invalid-record-metadata-leading-garbage-1'
    const operationId = 'invalid-record-metadata-leading-garbage-operation-1'
    const evidenceEventId = 'evidence-invalid-record-metadata-leading-garbage-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep the metadata JSON and body otherwise intact, but prepend leading garbage so
    // readCanonicalRecord rejects via start !== 0 (prefix must begin at byte 0).
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    expect(validRecordText.startsWith(metadataPrefix)).toBe(true)
    const poisonedRecordText = `leading-garbage\n${validRecordText}`
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText.startsWith(metadataPrefix)).toBe(false)
    expect(poisonedRecordText).toContain(metadataPrefix)
    expect(poisonedRecordText.indexOf(metadataPrefix)).toBeGreaterThan(0)
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: metadata not at offset 0 / start !== 0 fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record metadata suffix is missing', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-metadata-suffix-missing-unit'
    const outcomeId = 'outcome-invalid-record-metadata-suffix-missing-1'
    const operationId = 'invalid-record-metadata-suffix-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-metadata-suffix-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep prefix at offset 0 and leave JSON/body otherwise present, but remove the metadata suffix
    // so end < 0 and readCanonicalRecord rejects without parsing or repairing.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    expect(validRecordText.startsWith(metadataPrefix)).toBe(true)
    expect(validRecordText).toContain(metadataSuffix)
    const suffixIndex = validRecordText.indexOf(metadataSuffix)
    expect(suffixIndex).toBeGreaterThan(0)
    const poisonedRecordText = validRecordText.slice(0, suffixIndex) + validRecordText.slice(suffixIndex + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText.startsWith(metadataPrefix)).toBe(true)
    expect(poisonedRecordText).not.toContain(metadataSuffix)
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing metadata suffix / end < 0 fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record metadata JSON is malformed', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-metadata-json-malformed-unit'
    const outcomeId = 'outcome-invalid-record-metadata-json-malformed-1'
    const operationId = 'invalid-record-metadata-json-malformed-operation-1'
    const evidenceEventId = 'evidence-invalid-record-metadata-json-malformed-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep prefix at offset 0 and suffix present, but replace metadata JSON with truncated/malformed JSON
    // so JSON.parse throws and readCanonicalRecord catch returns invalid without repair.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const body = validRecordText.slice(metadataEnd + metadataSuffix.length)
    const malformedJson = '{"schemaVersion":1,"recordId":'
    expect(() => JSON.parse(malformedJson)).toThrow()
    const poisonedRecordText = `${metadataPrefix}${malformedJson}${metadataSuffix}${body}`
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText.startsWith(metadataPrefix)).toBe(true)
    expect(poisonedRecordText).toContain(metadataSuffix)
    expect(poisonedRecordText).toContain(malformedJson)
    expect(poisonedRecordText).not.toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText.endsWith(body)).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: malformed metadata JSON / JSON.parse throw fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record lacks newline after metadata suffix', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-metadata-suffix-no-newline-unit'
    const outcomeId = 'outcome-invalid-record-metadata-suffix-no-newline-1'
    const operationId = 'invalid-record-metadata-suffix-no-newline-operation-1'
    const evidenceEventId = 'evidence-invalid-record-metadata-suffix-no-newline-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep metadata JSON fields and heading text well-formed, but remove the required newline between
    // metadata suffix and body heading so content.startsWith(...SUFFIX\n# Learning outcome...) fails.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const afterSuffix = validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(afterSuffix.startsWith('\n# Learning outcome: established\n')).toBe(true)
    const poisonedAfterSuffix = afterSuffix.replace(/^\n/, '')
    expect(poisonedAfterSuffix.startsWith('# Learning outcome: established\n')).toBe(true)
    expect(poisonedAfterSuffix.startsWith('\n')).toBe(false)
    const poisonedRecordText =
      validRecordText.slice(0, metadataEnd + metadataSuffix.length) + poisonedAfterSuffix
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText.startsWith(metadataPrefix)).toBe(true)
    expect(poisonedRecordText).toContain(`${metadataSuffix}# Learning outcome: established\n`)
    expect(poisonedRecordText).not.toContain(`${metadataSuffix}\n# Learning outcome: established\n`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing newline after metadata suffix / body prefix startsWith fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record outcomeId is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-id-null-unit'
    const outcomeId = 'outcome-invalid-record-outcome-id-null-1'
    const operationId = 'invalid-record-outcome-id-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-id-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set outcomeId to null so text() returns null / fail closed.
    // Distinct from missing outcomeId key and empty/whitespace outcomeId residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('outcomeId')
    expect(metadata.outcomeId).toBe(outcomeId)
    metadata.outcomeId = null
    expect(metadata.outcomeId).toBeNull()
    // Keep recordId intentionally mismatched relative to null outcomeId so identity cannot recover.
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"outcomeId":null')
    expect(poisonedRecordText).not.toContain(`"outcomeId":"${outcomeId}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null outcomeId / text() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record schemaVersion is false', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-schema-version-false-unit'
    const outcomeId = 'outcome-invalid-record-schema-version-false-1'
    const operationId = 'invalid-record-schema-version-false-operation-1'
    const evidenceEventId = 'evidence-invalid-record-schema-version-false-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set schemaVersion to boolean false so strict equality fails closed.
    // Distinct from schemaVersion true (S73), null (S70), string (S71), float (S75), array (S82), object (S84).
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata.schemaVersion).toBe(1)
    metadata.schemaVersion = false
    expect(metadata.schemaVersion).toBe(false)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"schemaVersion":false')
    expect(poisonedRecordText).not.toContain('"schemaVersion":1')
    expect(poisonedRecordText).not.toContain('"schemaVersion":true')
    expect(poisonedRecordText).toContain('"outcomeId"')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"assessment"')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: boolean false schemaVersion / strict version check fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record operationId is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-operation-id-null-unit'
    const outcomeId = 'outcome-invalid-record-operation-id-null-1'
    const operationId = 'invalid-record-operation-id-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-operation-id-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set operationId to null so text() returns null / fail closed.
    // Distinct from missing-key and empty/whitespace operationId residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('operationId')
    expect(metadata.operationId).not.toBeNull()
    const previous = metadata.operationId
    metadata.operationId = null
    expect(metadata.operationId).toBeNull()
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"operationId":null')
    expect(poisonedRecordText).not.toContain(`"operationId":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null operationId / text() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record sessionId is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-session-id-null-unit'
    const outcomeId = 'outcome-invalid-record-session-id-null-1'
    const operationId = 'invalid-record-session-id-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-session-id-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set sessionId to null so text() returns null / fail closed.
    // Distinct from missing-key and empty/whitespace sessionId residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      recordId: `learning-outcome-${sessionId}-${outcomeId}`,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('sessionId')
    expect(metadata.sessionId).not.toBeNull()
    const previous = metadata.sessionId
    metadata.sessionId = null
    expect(metadata.sessionId).toBeNull()
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"sessionId":null')
    expect(poisonedRecordText).not.toContain(`"sessionId":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(`"recordId":"learning-outcome-${sessionId}-${outcomeId}"`)
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null sessionId / text() null fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record recordId is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-record-id-null-unit'
    const outcomeId = 'outcome-invalid-record-record-id-null-1'
    const operationId = 'invalid-record-record-id-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-record-id-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set recordId to null so text() returns null / fail closed.\n    // Distinct from missing-key and empty/whitespace recordId residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('recordId')
    expect(metadata.recordId).not.toBeNull()
    const previous = metadata.recordId
    expect(typeof previous).toBe('string')
    metadata.recordId = null
    expect(metadata.recordId).toEqual(null)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"recordId":null')
    expect(poisonedRecordText).not.toContain(`"recordId":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: poisoned recordId fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record outcomeId is a number', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-id-number-unit'
    const outcomeId = 'outcome-invalid-record-outcome-id-number-1'
    const operationId = 'invalid-record-outcome-id-number-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-id-number-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set outcomeId to number so text() returns null / fail closed.\n    // Distinct from missing-key, empty/whitespace, and null outcomeId residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('outcomeId')
    expect(typeof metadata.outcomeId).toBe('string')
    const previous = metadata.outcomeId
    expect(previous).not.toBeNull()
    metadata.outcomeId = 42
    expect(metadata.outcomeId).toEqual(42)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"outcomeId":42')
    expect(poisonedRecordText).not.toContain(`"outcomeId":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: poisoned outcomeId fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record operationId is a number', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-operation-id-number-unit'
    const outcomeId = 'outcome-invalid-record-operation-id-number-1'
    const operationId = 'invalid-record-operation-id-number-operation-1'
    const evidenceEventId = 'evidence-invalid-record-operation-id-number-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set operationId to number so text() returns null / fail closed.\n    // Distinct from missing-key, empty/whitespace, null, and non-canonical string operationId residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('operationId')
    expect(typeof metadata.operationId).toBe('string')
    const previous = metadata.operationId
    expect(previous).not.toBeNull()
    metadata.operationId = 7
    expect(metadata.operationId).toEqual(7)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"operationId":7')
    expect(poisonedRecordText).not.toContain(`"operationId":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: poisoned operationId fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record sessionId is a boolean', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-session-id-boolean-unit'
    const outcomeId = 'outcome-invalid-record-session-id-boolean-1'
    const operationId = 'invalid-record-session-id-boolean-operation-1'
    const evidenceEventId = 'evidence-invalid-record-session-id-boolean-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set sessionId to boolean so text() returns null / fail closed.\n    // Distinct from missing-key, empty/whitespace, null, and mismatched string sessionId residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('sessionId')
    expect(typeof metadata.sessionId).toBe('string')
    const previous = metadata.sessionId
    expect(previous).not.toBeNull()
    metadata.sessionId = true
    expect(metadata.sessionId).toEqual(true)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"sessionId":true')
    expect(poisonedRecordText).not.toContain(`"sessionId":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain('"outcomeKind":"established"')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: poisoned sessionId fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record outcomeKind is null', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-kind-null-unit'
    const outcomeId = 'outcome-invalid-record-outcome-kind-null-1'
    const operationId = 'invalid-record-outcome-kind-null-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-kind-null-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set outcomeKind to null so outcomeKind() returns null / fail closed.
    // Distinct from missing-key, unknown-string, and non-writing outcomeKind residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(metadata).toHaveProperty('outcomeKind')
    expect(metadata.outcomeKind).not.toBeNull()
    const previous = metadata.outcomeKind
    metadata.outcomeKind = null
    expect(metadata.outcomeKind).toBeNull()
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"outcomeKind":null')
    expect(poisonedRecordText).not.toContain(`"outcomeKind":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: null outcomeKind fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record body is missing after metadata', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-body-missing-unit'
    const outcomeId = 'outcome-invalid-record-body-missing-1'
    const operationId = 'invalid-record-body-missing-operation-1'
    const evidenceEventId = 'evidence-invalid-record-body-missing-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep metadata JSON well-formed/canonical and terminated, but drop the entire markdown body so
    // startsWith(...SUFFIX\n# Learning outcome: ${kind}\n) fails after successful parse.
    // Distinct from wrong body prefix, missing newline after suffix, and non-metadata content residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadataOnly = validRecordText.slice(0, metadataEnd + metadataSuffix.length)
    expect(metadataOnly.startsWith(metadataPrefix)).toBe(true)
    expect(metadataOnly.endsWith(metadataSuffix)).toBe(true)
    expect(metadataOnly).toContain('"schemaVersion":1')
    expect(metadataOnly).toContain('"outcomeKind":"established"')
    expect(metadataOnly).toContain(evidenceEventId)
    expect(metadataOnly).not.toContain('# Learning outcome:')
    const poisonedRecordText = metadataOnly
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(validRecordText.startsWith(poisonedRecordText)).toBe(true)
    expect(validRecordText.length).toBeGreaterThan(poisonedRecordText.length)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: missing body after metadata fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record is an empty file', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-empty-file-unit'
    const outcomeId = 'outcome-invalid-record-empty-file-1'
    const operationId = 'invalid-record-empty-file-operation-1'
    const evidenceEventId = 'evidence-invalid-record-empty-file-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Replace the settled regular-file record with a zero-byte file so prefix/suffix scan fails
    // (start !== 0 / end < 0) without any metadata JSON to parse.
    // Distinct from non-metadata garbage content, missing-body-after-metadata, and leading-garbage residuals.
    expect(validRecordText.length).toBeGreaterThan(0)
    const poisonedRecordText = ''
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toBe('')
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    expect(poisonedRecordBytes.byteLength).toBe(0)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: empty-file record fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
  })
  it('fails closed on restart when the canonical learning record outcomeKind is a number', async () => {
    const workspaceRoot = await workspace()
    const sessionId = 'session-invalid-record-outcome-kind-number-unit'
    const outcomeId = 'outcome-invalid-record-outcome-kind-number-1'
    const operationId = 'invalid-record-outcome-kind-number-operation-1'
    const evidenceEventId = 'evidence-invalid-record-outcome-kind-number-1'
    const ledger = await openSession(workspaceRoot, sessionId)
    await appendEvidence(ledger, sessionId, evidenceEventId)
    const directory = sessionDirectory(workspaceRoot, sessionId)
    const record = recordPath(workspaceRoot, sessionId)
    const outcomePath = join(directory, 'outcome.json')
    const manifestPath = join(directory, 'session.json')
    const markerPath = join(directory, 'outcome-settlement.json')
    let evaluationCalls = 0
    const initial = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      createId: () => outcomeId,
      evaluate: async ({ session }) => {
        evaluationCalls += 1
        return decision(session.id, 'established', [evidenceEventId])
      }
    })

    await expect(initial.commit({ sessionId, operationId })).resolves.toMatchObject({
      status: 'committed',
      outcome: { outcomeId, kind: 'established', evidenceEventIds: [evidenceEventId] },
      recordSaved: true,
      record: { relativePath: `learning-records/outcome-${sessionId}.md` }
    })
    expect(evaluationCalls).toBe(1)

    const [validRecordText, outcomeBeforeRestart, manifestBeforeRestart, markerBeforeRestart] = await Promise.all([
      readFile(record, 'utf8'),
      readFile(outcomePath),
      readFile(manifestPath),
      readFile(markerPath)
    ])
    // Keep other metadata/body canonical, but set outcomeKind to number so outcomeKind() returns null / fail closed.
    // Distinct from missing-key, null, unknown-string, and non-writing outcomeKind residuals.
    const metadataPrefix = '<!-- studiumx-learning-outcome '
    const metadataSuffix = ' -->'
    const metadataStart = validRecordText.indexOf(metadataPrefix)
    const metadataEnd = validRecordText.indexOf(metadataSuffix, metadataStart)
    expect(metadataStart).toBe(0)
    expect(metadataEnd).toBeGreaterThan(metadataStart)
    const metadata = JSON.parse(validRecordText.slice(metadataStart + metadataPrefix.length, metadataEnd)) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      outcomeKind: 'established',
      evidenceEventIds: [evidenceEventId]
    })
    expect(typeof metadata.outcomeKind).toBe('string')
    const previous = metadata.outcomeKind
    metadata.outcomeKind = 3
    expect(metadata.outcomeKind).toBe(3)
    const poisonedRecordText =
      `${metadataPrefix}${JSON.stringify(metadata)}${metadataSuffix}` +
      validRecordText.slice(metadataEnd + metadataSuffix.length)
    expect(poisonedRecordText).not.toBe(validRecordText)
    expect(poisonedRecordText).toContain('"outcomeKind":3')
    expect(poisonedRecordText).not.toContain(`"outcomeKind":"${previous}"`)
    expect(poisonedRecordText).toContain('"schemaVersion":1')
    expect(poisonedRecordText).toContain(evidenceEventId)
    expect(poisonedRecordText.endsWith(validRecordText.slice(metadataEnd + metadataSuffix.length))).toBe(true)
    await writeFile(record, poisonedRecordText, 'utf8')
    const poisonedRecordBytes = await readFile(record)
    expect(poisonedRecordBytes.toString('utf8')).toBe(poisonedRecordText)
    await expect(lstat(record)).resolves.toMatchObject({ isFile: expect.any(Function) })
    expect((await lstat(record)).isFile()).toBe(true)

    const recoveryDurable = instrumentedDurableOperations()
    const recovered = createLearningOutcomeCommitter({
      workspaceRoot,
      ledger,
      durableFileOperations: recoveryDurable.operations,
      createId: () => {
        throw new Error('recovery createId must not be called')
      },
      evaluate: async () => {
        evaluationCalls += 1
        throw new Error('recovery evaluator must not be called')
      }
    })
    const expectAuthorityBytesUnchanged = async () => {
      await expect(readFile(outcomePath)).resolves.toEqual(outcomeBeforeRestart)
      await expect(readFile(manifestPath)).resolves.toEqual(manifestBeforeRestart)
      await expect(readFile(markerPath)).resolves.toEqual(markerBeforeRestart)
      await expect(readFile(record)).resolves.toEqual(poisonedRecordBytes)
      expect((await lstat(record)).isFile()).toBe(true)
    }

    // Directed residual: number outcomeKind fails closed without repair.
    await expect(recovered.reconcile(sessionId)).resolves.toMatchObject({
      state: 'review_required',
      diagnostics: expect.arrayContaining(['missing_record'])
    })
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()

    await expect(recovered.commit({ sessionId, operationId })).resolves.toEqual({
      status: 'conflict',
      reason: 'review_required'
    })
    expect(evaluationCalls).toBe(1)
    expect(recoveryDurable.events).toEqual([])
    await expectAuthorityBytesUnchanged()
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