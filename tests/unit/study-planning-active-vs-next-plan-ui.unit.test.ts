/**
 * Pure STC-503 active-vs-next plan UI model.
 */
import { describe, expect, it } from 'vitest'
import {
  buildActiveVsNextPlanUiModel,
  buildTimerPlanCatalogForActiveVsNext,
  formatTimerPlanDurationSummary,
  resolveActiveTimerSessionForPlanUi,
  resolveNextTimerPlanId
} from '../../src/renderer/src/study-space/planning-active-vs-next-plan-ui'
import {
  createClassicPomodoroPlan,
  startTimerSession,
  type TimerSessionRecord
} from '../../src/shared/study-planning'

function runningSession(plan = createClassicPomodoroPlan()): TimerSessionRecord {
  const started = startTimerSession({ id: 's1', nowMs: 0, plan, taskId: 't1' })
  if (!started.session) throw new Error('expected session')
  return started.session
}

describe('planning-active-vs-next-plan-ui (STC-503)', () => {
  it('builds catalog with builtins + user overrides', () => {
    const catalog = buildTimerPlanCatalogForActiveVsNext([
      {
        id: 'classic_25_5',
        name: '我的经典',
        focusMinutes: 30,
        breakMinutes: 8,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00'
      },
      {
        id: 'custom-a',
        name: '自定义',
        focusMinutes: 40,
        breakMinutes: 10,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        longBreakMinutes: 20,
        longBreakEvery: 3,
        breakPolicy: 'automatic'
      }
    ])
    const classic = catalog.find((p) => p.id === 'classic_25_5')
    expect(classic?.name).toBe('我的经典')
    expect(classic?.focusMinutes).toBe(30)
    expect(catalog.some((p) => p.id === 'custom-a')).toBe(true)
    expect(catalog.some((p) => p.id === 'deep_50_10')).toBe(true)
  })

  it('resolves next plan id with classic fallback', () => {
    const catalog = buildTimerPlanCatalogForActiveVsNext([])
    expect(resolveNextTimerPlanId(null, catalog)).toBe('classic_25_5')
    expect(resolveNextTimerPlanId('missing', catalog)).toBe('classic_25_5')
    expect(resolveNextTimerPlanId('deep_50_10', catalog)).toBe('deep_50_10')
  })

  it('prefers live activeSession over timerSessions cache', () => {
    const live = runningSession(createClassicPomodoroPlan({ id: 'live', focusMinutes: 25 }))
    const cached = runningSession(createClassicPomodoroPlan({ id: 'cached', focusMinutes: 50 }))
    const resolved = resolveActiveTimerSessionForPlanUi({
      activeSession: live,
      timerSessions: [cached]
    })
    expect(resolved?.id).toBe('s1')
    expect(resolved?.planSnapshot?.id).toBe('live')
  })

  it('falls back to active cached session when live is null', () => {
    const cached = runningSession(createClassicPomodoroPlan({ id: 'cached', focusMinutes: 50 }))
    const resolved = resolveActiveTimerSessionForPlanUi({
      activeSession: null,
      timerSessions: [{ ...cached, id: 'cached-sess' }]
    })
    expect(resolved?.id).toBe('cached-sess')
  })

  it('shows diverges when catalog plan edited vs frozen snapshot', () => {
    const plan = createClassicPomodoroPlan()
    const session = runningSession(plan)
    const model = buildActiveVsNextPlanUiModel({
      activeSession: session,
      nextPlanId: plan.id,
      userPlans: [
        {
          id: plan.id,
          name: plan.name,
          focusMinutes: 50,
          breakMinutes: 10,
          simulationStartTime: '09:00',
          simulationEndTime: '12:00',
          breakPolicy: 'automatic'
        }
      ]
    })
    expect(model.visible).toBe(true)
    expect(model.diverges).toBe(true)
    expect(model.active?.focusMinutes).toBe(25)
    expect(model.next?.focusMinutes).toBe(50)
    expect(model.copy.divergesHint).toMatch(/下一段/)
  })

  it('idle without session still shows next plan when catalog resolvable', () => {
    const model = buildActiveVsNextPlanUiModel({
      activeSession: null,
      timerSessions: [],
      nextPlanId: 'classic_25_5',
      userPlans: []
    })
    expect(model.visible).toBe(true)
    expect(model.hasActiveSession).toBe(false)
    expect(model.active).toBeNull()
    expect(model.next?.id).toBe('classic_25_5')
    expect(model.diverges).toBe(false)
  })

  it('formats duration summary for pomodoro plans', () => {
    const plan = createClassicPomodoroPlan()
    expect(formatTimerPlanDurationSummary(plan)).toMatch(/25\/5/)
    expect(formatTimerPlanDurationSummary(plan)).toMatch(/询问休息/)
  })
})
