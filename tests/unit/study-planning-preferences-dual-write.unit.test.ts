/**
 * Dual-write tests for study planning preferences (STC-404 restore path).
 */
import { describe, expect, it, vi } from 'vitest'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import {
  buildSetPreferencesCommand,
  dualWriteSetClassificationPromptOptOut,
  dualWriteSetEmptyStartPolicy,
  dualWriteSetPreferences,
  dualWriteSetSimulationWindow
} from '../../src/renderer/src/study-space/planning-preferences-dual-write'

function mockApi(options?: {
  revision?: number
  onApply?: (payload: unknown) => void
  conflictOnce?: boolean
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let conflictRemaining = options?.conflictOnce ? 1 : 0
  let snapshot = {
    schemaVersion: 1 as const,
    revision,
    updatedAtMs: 0,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {
      emptyStartPolicy: 'ask_every_time' as const,
      classificationPromptOptOut: false
    },
    localAnalyticsHints: {}
  }
  return {
    readStudyPlanning: vi.fn(async () => ({
      ok: true as const,
      snapshot,
      path: '/ws/.studiumx/study-planning/snapshot.json',
      source: 'canonical' as const
    })),
    applyStudyPlanning: vi.fn(async (payload) => {
      options?.onApply?.(payload)
      if (conflictRemaining > 0) {
        conflictRemaining -= 1
        return {
          ok: false as const,
          revision,
          error: { code: 'revision_conflict' as const, message: 'stale' }
        }
      }
      revision += 1
      const command = (payload as { command?: { payload?: Record<string, unknown> } }).command
      const patch = command?.payload ?? {}
      snapshot = {
        ...snapshot,
        revision,
        preferences: {
          ...snapshot.preferences,
          ...(typeof patch.emptyStartPolicy === 'string'
            ? { emptyStartPolicy: patch.emptyStartPolicy as typeof snapshot.preferences.emptyStartPolicy }
            : {}),
          ...(typeof patch.classificationPromptOptOut === 'boolean'
            ? { classificationPromptOptOut: patch.classificationPromptOptOut }
            : {}),
          ...(typeof patch.simulationStartTime === 'string'
            ? { simulationStartTime: patch.simulationStartTime }
            : {}),
          ...(typeof patch.simulationEndTime === 'string'
            ? { simulationEndTime: patch.simulationEndTime }
            : {})
        }
      }
      return {
        ok: true as const,
        revision,
        snapshot,
        effects: []
      }
    })
  }
}

describe('buildSetPreferencesCommand (STC-404)', () => {
  it('builds set_preferences envelope with only provided fields', () => {
    const cmd = buildSetPreferencesCommand(
      { emptyStartPolicy: 'remember_quick_start' },
      'a1',
      42
    )
    expect(cmd).toMatchObject({
      actionId: 'a1',
      type: 'set_preferences',
      payload: { emptyStartPolicy: 'remember_quick_start' },
      clientIssuedAtMs: 42
    })
    expect(cmd.payload).not.toHaveProperty('classificationPromptOptOut')

    const opt = buildSetPreferencesCommand({ classificationPromptOptOut: false }, 'a2')
    expect(opt.type).toBe('set_preferences')
    expect(opt.payload).toEqual({ classificationPromptOptOut: false })
    expect(opt).not.toHaveProperty('clientIssuedAtMs')

    const both = buildSetPreferencesCommand(
      {
        emptyStartPolicy: 'remember_unattributed',
        classificationPromptOptOut: true,
        defaultTimerPlanId: 'classic_25_5'
      },
      'a3',
      9
    )
    expect(both.payload).toEqual({
      emptyStartPolicy: 'remember_unattributed',
      classificationPromptOptOut: true,
      defaultTimerPlanId: 'classic_25_5'
    })
  })
})

describe('dualWriteSetPreferences / emptyStart / classification opt-out', () => {
  it('skips without workspace or api', async () => {
    const r = await dualWriteSetEmptyStartPolicy(
      { workspaceRoot: null, api: null },
      'remember_quick_start'
    )
    expect(r.kind).toBe('canonical_skipped')

    const r2 = await dualWriteSetClassificationPromptOptOut(
      { workspaceRoot: '  ', api: mockApi() },
      false
    )
    expect(r2.kind).toBe('canonical_skipped')
  })

  it('rejects empty patch', async () => {
    const r = await dualWriteSetPreferences(
      { workspaceRoot: 'D:/ws', api: mockApi() },
      {}
    )
    expect(r.kind).toBe('canonical_failed')
    if (r.kind !== 'canonical_failed') return
    expect(r.result.error.code).toBe('invalid_command')
  })

  it('dualWriteSetEmptyStartPolicy sends set_preferences CAS', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const r = await dualWriteSetEmptyStartPolicy(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 1000 },
      'remember_quick_start'
    )
    expect(r.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(1)
    const payload = applied[0] as {
      expectedRevision: number
      command: {
        type: string
        actionId: string
        payload: { emptyStartPolicy: string }
      }
    }
    expect(payload.expectedRevision).toBe(1)
    expect(payload.command.type).toBe('set_preferences')
    expect(payload.command.payload.emptyStartPolicy).toBe('remember_quick_start')
    expect(payload.command.actionId).toContain('set_preferences')
  })

  it('restores classificationPromptOptOut to false (uncheck path)', async () => {
    const applied: unknown[] = []
    const api = mockApi({ onApply: (p) => applied.push(p) })
    const r = await dualWriteSetClassificationPromptOptOut(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 2000 },
      false
    )
    expect(r.kind).toBe('canonical_ok')
    const payload = applied[0] as {
      command: { type: string; payload: { classificationPromptOptOut: boolean } }
    }
    expect(payload.command.type).toBe('set_preferences')
    expect(payload.command.payload.classificationPromptOptOut).toBe(false)
  })

  it('retries once on revision_conflict', async () => {
    const applied: unknown[] = []
    const api = mockApi({ conflictOnce: true, onApply: (p) => applied.push(p) })
    const r = await dualWriteSetPreferences(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 3000 },
      { emptyStartPolicy: 'remember_unattributed', classificationPromptOptOut: true }
    )
    expect(r.kind).toBe('canonical_ok')
    expect(applied).toHaveLength(2)
    const second = applied[1] as {
      command: {
        actionId: string
        payload: {
          emptyStartPolicy: string
          classificationPromptOptOut: boolean
        }
      }
    }
    expect(second.command.actionId).toMatch(/:1$/)
    expect(second.command.payload).toMatchObject({
      emptyStartPolicy: 'remember_unattributed',
      classificationPromptOptOut: true
    })
  })
})

describe('simulation window dual-write (sole-authority demotion)', () => {
  it('buildSetPreferencesCommand includes simulation labels', () => {
    const cmd = buildSetPreferencesCommand(
      { simulationStartTime: '09:00', simulationEndTime: '12:00' },
      'sim1'
    )
    expect(cmd.type).toBe('set_preferences')
    expect(cmd.payload).toEqual({
      simulationStartTime: '09:00',
      simulationEndTime: '12:00'
    })
  })

  it('dualWriteSetSimulationWindow writes preferences via CAS', async () => {
    const applied: unknown[] = []
    const api = mockApi({
      onApply: (payload) => applied.push(payload)
    })
    const result = await dualWriteSetSimulationWindow(
      { api, workspaceRoot: '/ws', nowMs: () => 1000 },
      { simulationStartTime: '08:30', simulationEndTime: '11:00' }
    )
    expect(result.kind).toBe('canonical_ok')
    expect(applied.length).toBe(1)
    const command = (applied[0] as { command: { type: string; payload: Record<string, unknown> } }).command
    expect(command.type).toBe('set_preferences')
    expect(command.payload).toMatchObject({
      simulationStartTime: '08:30',
      simulationEndTime: '11:00'
    })
  })

  it('dualWriteSetSimulationWindow fails closed on invalid window', async () => {
    const api = mockApi()
    const result = await dualWriteSetSimulationWindow(
      { api, workspaceRoot: '/ws', nowMs: () => 1000 },
      { simulationStartTime: '12:00', simulationEndTime: '09:00' }
    )
    expect(result.kind).toBe('canonical_failed')
    expect(api.applyStudyPlanning).not.toHaveBeenCalled()
  })
})
