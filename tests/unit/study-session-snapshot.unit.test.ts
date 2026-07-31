import { beforeEach, describe, expect, it } from 'vitest'
import {
  STUDY_SPACE_SESSION_CLIENT_KEY,
  STUDY_SPACE_STORAGE_KEY,
  defaultStudySnapshot
} from '../../src/renderer/src/study-space/constants'
import {
  applyStudyInviteParams,
  normalizeStudySnapshot,
  normalizeStudySpaceCode,
  normalizeStudyTimerPlans,
  readStudySnapshot,
  syncStudyLocation
} from '../../src/renderer/src/study-space/session/session-snapshot'
import { TIMER_PLAN_SEED_DEFAULTS } from '../../src/shared/study-planning'

describe('durable Study Session snapshot', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })


  it('recovers from malformed stored JSON and overwrites it with a normalized snapshot', () => {
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, '{not valid JSON')
    window.sessionStorage.setItem(STUDY_SPACE_SESSION_CLIENT_KEY, 'studiumx-stable-tab')

    const snapshot = readStudySnapshot()
    const persisted = JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null')

    expect(snapshot.clientId).toBe('studiumx-stable-tab')
    expect(snapshot.spaceCode).toMatch(/^[A-Z0-9]{5}$/)
    expect(snapshot.tasks).toEqual(defaultStudySnapshot.tasks)
    expect(persisted).toEqual(snapshot)
  })

  it('lets canonical invite parameters override legacy aliases and persisted state', () => {
    window.history.replaceState(
      null,
      '',
      '/?studySpace=AB12C&space=ZZZZZ&studyRoom=deep&room=exam'
    )

    const invited = applyStudyInviteParams({
      ...defaultStudySnapshot,
      clientId: 'studiumx-invite-test',
      spaceCode: 'PERSISTED',
      roomId: 'silent',
      focusMinutes: 25,
      breakMinutes: 5,
      remainingSeconds: 1_500
    })

    expect(invited).toMatchObject({
      spaceCode: 'AB12C',
      roomId: 'deep',
      focusMinutes: 90,
      breakMinutes: 15,
      remainingSeconds: 5_400,
      timerMode: 'focus'
    })
  })

  it('reuses the session client identity instead of the persisted client identity', () => {
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify({
      ...defaultStudySnapshot,
      clientId: 'studiumx-old-client',
      nickname: '同学 IENT'
    }))
    window.sessionStorage.setItem(STUDY_SPACE_SESSION_CLIENT_KEY, 'studiumx-reused-ABCD')

    const first = readStudySnapshot()
    const second = readStudySnapshot()

    expect(first.clientId).toBe('studiumx-reused-ABCD')
    expect(first.nickname).toBe('同学 ABCD')
    expect(second.clientId).toBe(first.clientId)
    expect(JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null').clientId).toBe(first.clientId)
  })

  it('accepts only five-character room codes and replaces invalid values with a generated code', () => {
    expect(normalizeStudySpaceCode('AB12C')).toBe('AB12C')
    expect(normalizeStudySpaceCode('PUBLIC')).toMatch(/^[A-Z0-9]{5}$/)
    expect(normalizeStudySpaceCode('room-123')).toMatch(/^[A-Z0-9]{5}$/)
  })

  it('synchronizes a canonical invite URL while preserving unrelated query and hash state', () => {
    window.history.replaceState(null, '', '/study?space=old&room=deep&studyFreshSession=1&source=share#focus')

    syncStudyLocation('AB12C', 'exam')

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/study?source=share&studySpace=AB12C&studyRoom=exam#focus'
    )
  })
})

describe('normalizeStudySnapshot timer clamps (continuous / countup)', () => {
  it('allows remainingSeconds 0 for idle continuous countup', () => {
    const snap = normalizeStudySnapshot({
      ...defaultStudySnapshot,
      timerState: 'idle',
      remainingSeconds: 0,
      focusMinutes: 180,
      breakMinutes: 0,
      simulationStartTime: '09:00',
      simulationEndTime: '12:00',
      timerPlans: [
        {
          id: 'continuous_countup',
          name: '连续专注',
          focusMinutes: 180,
          breakMinutes: 0,
          simulationStartTime: '09:00',
          simulationEndTime: '12:00',
          kind: 'continuous',
          clockMode: 'countup'
        }
      ]
    })
    expect(snap.remainingSeconds).toBe(0)
    expect(snap.focusMinutes).toBe(180)
    expect(snap.breakMinutes).toBe(0)
  })

  it('does not clamp open continuous elapsed to classic focusMinutes ceiling', () => {
    const elapsed = 200 * 60
    const snap = normalizeStudySnapshot({
      ...defaultStudySnapshot,
      timerState: 'running',
      remainingSeconds: elapsed,
      focusMinutes: 180,
      breakMinutes: 0,
      timerPlans: [
        {
          id: 'continuous_countup',
          name: '连续专注',
          focusMinutes: 180,
          breakMinutes: 0,
          simulationStartTime: '09:00',
          simulationEndTime: '12:00',
          kind: 'continuous',
          clockMode: 'countup',
          continuousTarget: false
        }
      ]
    })
    // Bound by continuousFocusMinutesMax (240m), not focusMinutes (180m)
    expect(snap.remainingSeconds).toBe(elapsed)
    expect(snap.remainingSeconds).toBeLessThanOrEqual(
      TIMER_PLAN_SEED_DEFAULTS.continuousFocusMinutesMax * 60
    )
  })

  it('widens focusMinutes for continuous plan using TIMER_PLAN_SEED_DEFAULTS', () => {
    const plans = normalizeStudyTimerPlans([
      {
        id: 'c1',
        name: '连续',
        focusMinutes: 200,
        breakMinutes: 0,
        simulationStartTime: '09:00',
        simulationEndTime: '12:00',
        kind: 'continuous',
        clockMode: 'countup'
      }
    ])
    expect(plans[0]?.focusMinutes).toBe(200)
    expect(plans[0]?.breakMinutes).toBe(0)
  })

  it('keeps classic pomodoro remaining min of 1 when missing', () => {
    const snap = normalizeStudySnapshot({
      ...defaultStudySnapshot,
      timerState: 'idle',
      remainingSeconds: 0,
      focusMinutes: 25,
      breakMinutes: 5,
      timerPlans: []
    })
    // Classic path still rejects 0 remaining (min 1) and falls back to phase ceiling
    expect(snap.remainingSeconds).toBeGreaterThanOrEqual(1)
  })
})

