import { describe, expect, it, vi } from 'vitest'
import {
  buildFinishTimerSessionCommand,
  buildPauseTimerSessionCommand,
  buildResumeTimerSessionCommand,
  buildStartTimerSessionCommand,
  createCanonicalTimerSessionId,
  dualWriteFinishTimerSession,
  dualWritePauseTimerSession,
  dualWriteResumeTimerSession,
  dualWriteStartTimerSession,
  resolveTimerAttribution
} from '../../src/renderer/src/study-space/planning-timer-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import type { StudyPlanningSnapshotV1 } from '../../src/shared/study-planning'
import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  createClassicPomodoroPlan
} from '../../src/shared/study-planning'

function emptySnapshot(revision = 1): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision,
    updatedAtMs: 1_000,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [createClassicPomodoroPlan()],
    timerSessions: [],
    preferences: {
      emptyStartPolicy: 'ask_every_time',
      classificationPromptOptOut: false,
      defaultTimerPlanId: 'classic_25_5'
    },
    localAnalyticsHints: {}
  }
}

function mockApi(options?: {
  revision?: number
  applyImpl?: StudyPlanningApi['applyStudyPlanning']
  onApply?: (payload: unknown) => void
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let snapshot = emptySnapshot(revision)
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: options?.applyImpl
      ? options.applyImpl
      : vi.fn(async (payload) => {
          options?.onApply?.(payload)
          revision += 1
          const command = (payload as { command: { type: string; payload: { id?: string; sessionId?: string } } }).command
          if (command.type === 'start_timer_session') {
            snapshot = {
              ...snapshot,
              revision,
              timerSessions: [
                {
                  id: command.payload.id as string,
                  taskId: null,
                  scheduleBlockId: null,
                  phase: 'focus',
                  clockMode: 'countdown',
                  state: 'running',
                  targetSeconds: 25 * 60,
                  startedAtMs: 1,
                  lastSampleWallMs: 1,
                  accumulatedActiveSeconds: 0,
                  accumulatedFocusSeconds: 0,
                  planSnapshot: createClassicPomodoroPlan(),
                  attributionReason: 'unattributed',
                  focusRoundInPlan: 1
                }
              ]
            }
          } else {
            snapshot = { ...snapshot, revision }
          }
          return {
            ok: true as const,
            revision,
            snapshot,
            effects: [{ type: 'timer_session_started' as const, sessionId: (command.payload.id ?? command.payload.sessionId) as string }],
            path: '/ws/.studiumx/study-planning/snapshot.json'
          }
        })
  }
}

describe('timer dual-write builders', () => {
  it('buildStartTimerSessionCommand freezes caller-owned id + optional target', () => {
    expect(
      buildStartTimerSessionCommand(
        {
          sessionId: 'ts-1',
          taskId: 'task-a',
          planId: 'classic_25_5',
          targetSeconds: 1500,
          attributionReason: 'explicit'
        },
        'act-1',
        42
      )
    ).toEqual({
      actionId: 'act-1',
      type: 'start_timer_session',
      payload: {
        id: 'ts-1',
        planId: 'classic_25_5',
        taskId: 'task-a',
        attributionReason: 'explicit',
        targetSeconds: 1500
      },
      clientIssuedAtMs: 42
    })
  })

  it('builds pause/resume/finish with sessionId', () => {
    expect(buildPauseTimerSessionCommand('ts-1', 'a').type).toBe('pause_timer_session')
    expect(buildResumeTimerSessionCommand('ts-1', 'a').payload).toEqual({ sessionId: 'ts-1' })
    expect(buildFinishTimerSessionCommand('ts-1', 'cancelled', 'a').payload).toEqual({
      sessionId: 'ts-1',
      reason: 'cancelled'
    })
  })

  it('createCanonicalTimerSessionId is unique-ish', () => {
    const a = createCanonicalTimerSessionId(1)
    const b = createCanonicalTimerSessionId(1)
    expect(a).toMatch(/^ts:1:/)
    expect(b).toMatch(/^ts:1:/)
    expect(a).not.toBe(b)
  })

  it('resolveTimerAttribution maps task vs unattributed', () => {
    expect(resolveTimerAttribution('t1')).toEqual({ taskId: 't1', attributionReason: 'explicit' })
    expect(resolveTimerAttribution(null)).toEqual({ taskId: null, attributionReason: 'unattributed' })
    expect(resolveTimerAttribution(undefined)).toEqual({ taskId: null, attributionReason: 'unattributed' })
  })
})

describe('dualWriteStartTimerSession', () => {
  it('skips without workspace', async () => {
    const result = await dualWriteStartTimerSession(
      { api: mockApi(), workspaceRoot: '  ' },
      { sessionId: 'ts-1', targetSeconds: 60 }
    )
    expect(result.kind).toBe('canonical_skipped')
    if (result.kind !== 'canonical_skipped') return
    expect(result.reason).toBe('missing_workspace')
  })

  it('skips without api', async () => {
    const result = await dualWriteStartTimerSession(
      { api: null, workspaceRoot: 'D:/ws' },
      { sessionId: 'ts-1' }
    )
    expect(result.kind).toBe('canonical_skipped')
    if (result.kind !== 'canonical_skipped') return
    expect(result.reason).toBe('api_unavailable')
  })

  it('applies start_timer_session with expectedRevision CAS', async () => {
    const seen: unknown[] = []
    const api = mockApi({
      onApply: (p) => seen.push(p)
    })
    const result = await dualWriteStartTimerSession(
      { api, workspaceRoot: 'D:/ws', nowMs: () => 99 },
      {
        sessionId: 'ts-owned',
        taskId: 'task-1',
        planId: 'classic_25_5',
        targetSeconds: 1200,
        attributionReason: 'explicit'
      }
    )
    expect(result.kind).toBe('canonical_ok')
    expect(seen[0]).toMatchObject({
      workspaceRoot: 'D:/ws',
      expectedRevision: 1,
      command: {
        type: 'start_timer_session',
        payload: {
          id: 'ts-owned',
          taskId: 'task-1',
          planId: 'classic_25_5',
          targetSeconds: 1200,
          attributionReason: 'explicit'
        }
      }
    })
  })

  it('retries once on revision_conflict with new actionId', async () => {
    let calls = 0
    let revision = 1
    const snapshot = emptySnapshot(1)
    const api: StudyPlanningApi = {
      readStudyPlanning: vi.fn(async () => ({
        ok: true as const,
        snapshot: { ...snapshot, revision },
        path: '/ws/.studiumx/study-planning/snapshot.json',
        source: 'canonical' as const
      })),
      applyStudyPlanning: vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          revision = 5
          return {
            ok: false as const,
            revision: 5,
            error: { code: 'revision_conflict', message: 'expected 1 actual 5' }
          }
        }
        revision = 6
        return {
          ok: true as const,
          revision: 6,
          snapshot: { ...snapshot, revision: 6 },
          effects: [{ type: 'timer_session_started' as const, sessionId: 'ts-x' }],
          path: '/ws/.studiumx/study-planning/snapshot.json'
        }
      })
    }
    const result = await dualWriteStartTimerSession(
      { api, workspaceRoot: '/ws', nowMs: () => 10 + calls },
      { sessionId: 'ts-x', targetSeconds: 60 }
    )
    expect(result.kind).toBe('canonical_ok')
    expect(calls).toBe(2)
    const secondPayload = (api.applyStudyPlanning as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
      expectedRevision: number
      command: { actionId: string }
    }
    expect(secondPayload.expectedRevision).toBe(5)
    expect(secondPayload.command.actionId).toMatch(/retry/)
  })

  it('surfaces invariant_violation (already running) without inventing second session', async () => {
    const api = mockApi({
      applyImpl: vi.fn(async () => ({
        ok: false as const,
        revision: 2,
        error: {
          code: 'invariant_violation',
          message: 'already have running TimerSession',
          details: { ids: ['other'] }
        }
      }))
    })
    const result = await dualWriteStartTimerSession(
      { api, workspaceRoot: '/ws' },
      { sessionId: 'ts-2' }
    )
    expect(result.kind).toBe('canonical_failed')
    if (result.kind !== 'canonical_failed') return
    expect(result.result.error.code).toBe('invariant_violation')
  })
})

describe('dualWrite pause/resume/finish', () => {
  it('pause requires sessionId', async () => {
    const result = await dualWritePauseTimerSession(
      { api: mockApi(), workspaceRoot: '/ws' },
      ''
    )
    expect(result.kind).toBe('canonical_failed')
  })

  it('pause applies pause_timer_session', async () => {
    const seen: unknown[] = []
    const api = mockApi({ onApply: (p) => seen.push(p) })
    const result = await dualWritePauseTimerSession(
      { api, workspaceRoot: '/ws', nowMs: () => 7 },
      'ts-1'
    )
    expect(result.kind).toBe('canonical_ok')
    expect(seen[0]).toMatchObject({
      command: {
        type: 'pause_timer_session',
        payload: { sessionId: 'ts-1' }
      }
    })
  })

  it('resume + finish round-trip command types', async () => {
    const types: string[] = []
    const api = mockApi({
      onApply: (p) => {
        types.push((p as { command: { type: string } }).command.type)
      }
    })
    await dualWriteResumeTimerSession({ api, workspaceRoot: '/ws', nowMs: () => 1 }, 'ts-1')
    await dualWriteFinishTimerSession({ api, workspaceRoot: '/ws', nowMs: () => 2 }, 'ts-1', 'cancelled')
    expect(types).toEqual(['resume_timer_session', 'finish_timer_session'])
  })
})
