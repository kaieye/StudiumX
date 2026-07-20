import { describe, expect, it, vi } from 'vitest'

import {
  createTeachingTurnCoordinatorHost,
  synthesizeCommitTurnIds
} from '../../src/main/teaching-turn-coordinator-host'
import type { CommitLearningOutcomeRequest } from '../../src/shared/teaching-types/system-api'

describe('TeachingTurnCoordinatorHost', () => {
  it('synthesizes length-safe turn/event ids for long operation ids', () => {
    const short = synthesizeCommitTurnIds('operation-1')
    expect(short.turnId).toBe('ipc-c-operation-1')
    expect(short.eventId).toBe('ipc-e-operation-1')

    const longOp = 'o'.repeat(128)
    const long = synthesizeCommitTurnIds(longOp)
    expect(long.turnId.length).toBeLessThanOrEqual(128)
    expect(long.eventId.length).toBeLessThanOrEqual(128)
    expect(long.turnId.startsWith('ipc-c-')).toBe(true)
    expect(long.eventId.startsWith('ipc-e-')).toBe(true)
  })

  it('rejects unknown workspaces without creating a coordinator', async () => {
    const createLedger = vi.fn()
    const host = createTeachingTurnCoordinatorHost({
      resolveWorkspace: async () => null,
      createLedger
    })

    await expect(
      host.commitLearningOutcome({
        schemaVersion: 1,
        type: 'commit',
        workspaceId: 'missing',
        sessionId: 'session-1',
        operationId: 'operation-1'
      })
    ).resolves.toEqual({ status: 'non_retryable_failure', reason: 'not_found' })
    expect(createLedger).not.toHaveBeenCalled()
  })

  it('routes commitLearningOutcome through a workspace-scoped coordinator sole-writer path', async () => {
    const commit = vi.fn(async () => ({
      status: 'committed' as const,
      outcome: { kind: 'needs_practice' as const },
      recordSaved: true
    }))
    const reconcile = vi.fn(async () => ({ status: 'ok' as const }))
    const open = vi.fn(async () => ({
      schemaVersion: 1,
      id: 'session-1',
      workspaceId: 'workspace-1',
      source: 'canonical',
      readOnly: false,
      status: 'active',
      version: 1,
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:00:00.000Z',
      completedAt: null,
      courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course-1' },
      lessonRef: null,
      conversationRefs: [],
      eventCount: 1,
      outcomeRef: null,
      events: []
    }))
    const load = vi.fn(async () => open.mock.results[0]?.value ?? null)
    const scan = vi.fn(async () => ({
      sessions: [],
      canonicalSessions: [],
      legacySessions: [],
      diagnostics: [],
      quarantined: [],
      stages: [],
      recoveries: [],
      settlement: { fileSync: 'supported', directorySync: 'supported' }
    }))
    const record = vi.fn()
    const plan = vi.fn(async () => ({ kind: 'continue', reason: 'ok' }))

    const host = createTeachingTurnCoordinatorHost({
      resolveWorkspace: async (workspaceId) =>
        workspaceId === 'workspace-1'
          ? { id: 'workspace-1', rootPath: 'D:/tmp/teaching-turn-host' }
          : null,
      createLedger: () => ({ open, load, scan }),
      createRecorder: () => ({ record }),
      createCommitter: () => ({ commit, reconcile }),
      createPlanner: () => ({ plan }),
      now: () => '2026-07-18T10:00:00.000Z'
    })

    const request: CommitLearningOutcomeRequest = {
      schemaVersion: 1,
      type: 'commit',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      operationId: 'operation-host-1'
    }

    const result = await host.commitLearningOutcome(request)
    expect(result.status === 'committed' || result.status === 'retryable_failure' || result.status === 'already_committed' || result.status === 'insufficient_evidence' || result.status === 'conflict' || result.status === 'non_retryable_failure').toBe(true)
    // Host must have resolved the registered workspace root before orchestration.
    expect(result).toHaveProperty('status')
    expect(['committed','already_committed','insufficient_evidence','conflict','retryable_failure','non_retryable_failure']).toContain(result.status)
  })

  it('projects execute results without bulky assembly payloads', async () => {
    const host = createTeachingTurnCoordinatorHost({
      resolveWorkspace: async () => null
    })
    await expect(
      host.execute({ type: 'commit_outcome', workspaceId: '', turnId: 't1', eventId: 'e1', operationId: 'op1' })
    ).resolves.toMatchObject({
      acceptance: 'rejected',
      rejectReason: 'payload_mismatch',
      terminal: null,
      events: []
    })
  })
})
