import { describe, expect, it, vi } from 'vitest'
import {
  isReadonlyTimerPlanId,
  listTimerPlanCatalogRows,
  normalizeTimerPlanRename,
  renameTimerPlanInV1List,
  resolveDefaultTimerPlanId,
  resolveTimerPlanShellForCatalog
} from '../../src/renderer/src/study-space/planning-timer-plan-catalog-ui'
import type { StudyTimerPlan } from '../../src/renderer/src/study-space/types'
import {
  buildSetDefaultTimerPlanCommand,
  dualWriteRenameTimerPlan,
  dualWriteSetDefaultTimerPlan
} from '../../src/renderer/src/study-space/planning-timer-plan-dual-write'
import type { StudyPlanningApi } from '../../src/renderer/src/study-space/planning-client'
import { StudyPlanningStore } from '../../src/shared/study-planning'

const custom: StudyTimerPlan = {
  id: 'plan-user-1',
  name: 'My 30/8',
  focusMinutes: 30,
  breakMinutes: 8,
  simulationStartTime: '09:00',
  simulationEndTime: '12:00'
}

describe('timer plan catalog UI model (STC-501/502)', () => {
  it('lists system seeds as editable (non-deletable) with product names', () => {
    const rows = listTimerPlanCatalogRows({
      userPlans: [custom],
      defaultTimerPlanId: 'plan-user-1'
    })
    const classic = rows.find((r) => r.id === 'classic_25_5')
    const deep = rows.find((r) => r.id === 'deep_50_10')
    const cont = rows.find((r) => r.id === 'continuous_countup')
    const user = rows.find((r) => r.id === 'plan-user-1')
    expect(classic?.name).toBe('经典番茄')
    expect(deep?.name).toBe('深度专注')
    expect(cont?.name).toBe('考场模拟')
    expect(classic?.readonly).toBe(false)
    expect(classic?.canDelete).toBe(false)
    expect(classic?.canRename).toBe(true)
    expect(classic?.canCopy).toBe(true)
    expect(deep?.readonly).toBe(false)
    expect(cont?.readonly).toBe(false)
    expect(user?.readonly).toBe(false)
    expect(user?.canDelete).toBe(true)
    expect(user?.canRename).toBe(true)
    expect(user?.isDefault).toBe(true)
    expect(classic?.isDefault).toBe(false)
    expect(cont?.planKind).toBe('continuous')
    expect(classic?.planKind).toBe('pomodoro')
    expect(classic?.summary).toMatch(/25 \/ 5/)
  })

  it('marks classic as default when preference unset', () => {
    const rows = listTimerPlanCatalogRows({ userPlans: [custom], defaultTimerPlanId: null })
    expect(resolveDefaultTimerPlanId(null, rows)).toBe('classic_25_5')
    expect(rows.find((r) => r.id === 'classic_25_5')?.isDefault).toBe(true)
  })

  it('resolves builtin shells not present in user list', () => {
    const shell = resolveTimerPlanShellForCatalog('deep_50_10', [])
    expect(shell?.id).toBe('deep_50_10')
    expect(shell?.focusMinutes).toBe(50)
    expect(shell?.breakMinutes).toBe(10)
    expect(resolveTimerPlanShellForCatalog('missing', [])).toBeNull()
  })

  it('materializes builtin rename when seed is not yet in user list', () => {
    const renamed = renameTimerPlanInV1List([], 'classic_25_5', '我的番茄')
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.plans).toHaveLength(1)
    expect(renamed.plans[0]?.id).toBe('classic_25_5')
    expect(renamed.plans[0]?.name).toBe('我的番茄')
  })


  it('normalizes rename and renames V1 list including system seed ids when present', () => {
    expect(normalizeTimerPlanRename('  晨间  ').ok).toBe(true)
    expect(normalizeTimerPlanRename('   ').ok).toBe(false)
    // Delete protection only — rename of system seeds is allowed once materialized.
    expect(isReadonlyTimerPlanId('classic_25_5')).toBe(true)
    const withClassic = renameTimerPlanInV1List(
      [{ ...custom, id: 'classic_25_5', name: '经典番茄' }],
      'classic_25_5',
      '我的番茄'
    )
    expect(withClassic.ok).toBe(true)
    if (withClassic.ok) expect(withClassic.plans[0]?.name).toBe('我的番茄')
    const ok = renameTimerPlanInV1List([custom], 'plan-user-1', '  新名字 ')
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.plans[0]?.name).toBe('新名字')
  })
})

function mockApi(options?: {
  revision?: number
  onApply?: (payload: unknown) => void
}): StudyPlanningApi {
  let revision = options?.revision ?? 1
  let snapshot = {
    schemaVersion: 1 as const,
    revision,
    updatedAtMs: 0,
    tasks: [],
    scheduleBlocks: [],
    timerPlans: [] as unknown[],
    timerSessions: [],
    preferences: { defaultTimerPlanId: 'classic_25_5' },
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
      revision += 1
      snapshot = { ...snapshot, revision }
      return {
        ok: true as const,
        revision,
        snapshot,
        effects: []
      }
    })
  }
}


  it('materializes builtin rename when seed is not yet in user list', () => {
    const renamed = renameTimerPlanInV1List([], 'classic_25_5', '我的番茄')
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.plans).toHaveLength(1)
    expect(renamed.plans[0]?.id).toBe('classic_25_5')
    expect(renamed.plans[0]?.name).toBe('我的番茄')
  })

describe('timer plan dual-write rename / set default', () => {
  it('builds set_preferences envelope for default plan', () => {
    const cmd = buildSetDefaultTimerPlanCommand('plan-user-1', 'a1', 1)
    expect(cmd).toMatchObject({
      type: 'set_preferences',
      payload: { defaultTimerPlanId: 'plan-user-1' }
    })
  })

  it('dualWriteSetDefaultTimerPlan sends set_preferences', async () => {
    const seen: unknown[] = []
    const api = mockApi({ onApply: (p) => seen.push(p) })
    const r = await dualWriteSetDefaultTimerPlan(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 1000 },
      'plan-user-1'
    )
    expect(r.kind).toBe('canonical_ok')
    expect(seen[0]).toMatchObject({
      expectedRevision: 1,
      command: {
        type: 'set_preferences',
        payload: { defaultTimerPlanId: 'plan-user-1' }
      }
    })
  })

  it('dualWriteRenameTimerPlan saves renamed shell', async () => {
    const seen: unknown[] = []
    const api = mockApi({ onApply: (p) => seen.push(p) })
    const r = await dualWriteRenameTimerPlan(
      { workspaceRoot: 'D:/ws', api, nowMs: () => 2000 },
      { planId: 'plan-user-1', name: 'Renamed', focusMinutes: 30, breakMinutes: 8 }
    )
    expect(r.kind).toBe('canonical_ok')
    expect(seen[0]).toMatchObject({
      command: {
        type: 'save_timer_plan',
        payload: {
          plan: {
            id: 'plan-user-1',
            name: 'Renamed',
            focusMinutes: 30,
            shortBreakMinutes: 8
          }
        }
      }
    })
  })
})

describe('store save allows system seed overrides', () => {
  it('save_timer_plan on classic_25_5 upserts override under same id', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const r = store.applyCommand(
      {
        actionId: 's1',
        type: 'save_timer_plan',
        payload: {
          plan: {
            id: 'classic_25_5',
            name: '经典番茄',
            kind: 'pomodoro',
            clockMode: 'countdown',
            focusMinutes: 30,
            shortBreakMinutes: 5,
            breakPolicy: 'ask',
            windowFillPolicy: 'adaptive_final_focus',
            minimumFinalFocusMinutes: 15,
            wrapUpMinutes: 5,
            notificationPolicy: {
              sound: true,
              systemNotification: true,
              focusEnd: true,
              breakEnd: true
            },
            revision: 2
          }
        }
      },
      1
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const saved = r.snapshot.timerPlans.find((p) => p.id === 'classic_25_5')
    expect(saved?.focusMinutes).toBe(30)
    expect(saved?.name).toBe('经典番茄')
  })

  it('set_preferences defaultTimerPlanId', () => {
    const store = new StudyPlanningStore({ nowMs: () => 1 })
    const r = store.applyCommand(
      {
        actionId: 'p1',
        type: 'set_preferences',
        payload: { defaultTimerPlanId: 'deep_50_10' }
      },
      1
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.preferences.defaultTimerPlanId).toBe('deep_50_10')
  })
})
