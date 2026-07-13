import { describe, expect, it } from 'vitest'
import { nextStudyStreakForDate } from '@renderer/study-space/domain'
import { advanceStudyTimerBySeconds } from '@renderer/study-space/session/transitions'
import { defaultStudySnapshot } from '@renderer/study-space/constants'
import {
  advanceReliableTimer,
  createReliableTimer,
  pauseReliableTimer,
  resumeReliableTimer
} from '@renderer/views/workbench/analytics/domain/reliableTimer'
import {
  advanceActiveStudySession,
  createActiveStudySession,
  finalizeActiveStudySession
} from '@renderer/views/workbench/analytics/domain/sessionFacts'

describe('reliable study timer clock', () => {
  it('recovers elapsed time after a throttled background jump', () => {
    const started = createReliableTimer({ wallMs: 1_000, monotonicMs: 50, plannedActiveMs: 60_000 })
    const result = advanceReliableTimer(started, { wallMs: 11_000, monotonicMs: 1_050 })
    expect(result.activeDeltaMs).toBe(10_000)
    expect(result.timer.activeElapsedMs).toBe(10_000)
  })

  it('ignores wall-clock rollback and keeps monotonic progress', () => {
    const started = createReliableTimer({ wallMs: 10_000, monotonicMs: 100, plannedActiveMs: 60_000 })
    const first = advanceReliableTimer(started, { wallMs: 11_000, monotonicMs: 1_100 })
    const rollback = advanceReliableTimer(first.timer, { wallMs: 9_000, monotonicMs: 2_100 })
    expect(rollback.activeDeltaMs).toBe(1_000)
    expect(rollback.timer.effectiveWallMs).toBe(12_000)
  })

  it('does not complete from a large forward wall-clock adjustment when monotonic time is available', () => {
    const started = createReliableTimer({ wallMs: 1_000, monotonicMs: 0, plannedActiveMs: 5_000 })
    const result = advanceReliableTimer(started, { wallMs: 86_401_000, monotonicMs: 100 })
    expect(result.activeDeltaMs).toBe(100)
    expect(result.completed).toBe(false)
  })

  it('tracks pause duration without counting it as active time', () => {
    const started = createReliableTimer({ wallMs: 1_000, monotonicMs: 0, plannedActiveMs: 60_000 })
    const advanced = advanceReliableTimer(started, { wallMs: 6_000, monotonicMs: 5_000 })
    const paused = pauseReliableTimer(advanced.timer, { wallMs: 6_000, monotonicMs: 5_000 })
    const resumed = resumeReliableTimer(paused, { wallMs: 16_000, monotonicMs: 15_000 })
    expect(resumed.pausedElapsedMs).toBe(10_000)
    const afterResume = advanceReliableTimer(resumed, { wallMs: 17_000, monotonicMs: 16_000 })
    expect(afterResume.timer.activeElapsedMs).toBe(6_000)
  })
})


describe('study session elapsed-time projection', () => {
  it('applies a throttled multi-second delta and splits local-day counters without per-second replay', () => {
    const snapshot = {
      ...defaultStudySnapshot,
      clientId: 'learner-1',
      timerState: 'running' as const,
      remainingSeconds: 120,
      todayFocusSeconds: 25,
      totalFocusSeconds: 100,
      streakDays: 3,
      lastStudyDate: '2026-07-11'
    }
    const next = advanceStudyTimerBySeconds(snapshot, {
      activeSeconds: 90,
      remainingSeconds: 30,
      completed: false,
      localToday: '2026-07-13',
      focusSecondsByLocalDate: {
        '2026-07-12': 30,
        '2026-07-13': 60
      }
    })

    expect(next.remainingSeconds).toBe(30)
    expect(next.totalFocusSeconds).toBe(190)
    expect(next.todayFocusSeconds).toBe(60)
    expect(next.streakDays).toBe(5)
    expect(next.lastStudyDate).toBe('2026-07-13')
  })

  it('keeps cumulative whole-second local-day allocation aligned with the final fact', () => {
    const started = createActiveStudySession({
      id: 'fractional-midnight',
      clientId: 'learner-1',
      timerMode: 'focus',
      plannedSeconds: 60,
      sample: { wallMs: Date.parse('2026-07-13T15:59:59.500Z'), monotonicMs: 0 },
      timeZone: 'Asia/Shanghai',
      context: { modeId: 'free', roomId: 'silent', signalId: 'reading' }
    })
    const first = advanceActiveStudySession(started, {
      sample: { wallMs: Date.parse('2026-07-13T16:00:00.000Z'), monotonicMs: 500 },
      timeZone: 'Asia/Shanghai'
    })
    const second = advanceActiveStudySession(first.session, {
      sample: { wallMs: Date.parse('2026-07-13T16:00:00.500Z'), monotonicMs: 1000 },
      timeZone: 'Asia/Shanghai'
    })
    const fact = finalizeActiveStudySession(second.session, 'canceled')

    expect(first.activeDeltaSeconds).toBe(0)
    expect(second.activeDeltaSeconds).toBe(1)
    expect(second.activeSecondsByLocalDate).toEqual({ '2026-07-13': 1 })
    expect(fact.daySegments.map((segment) => [segment.localDate, segment.activeSeconds])).toEqual([
      ['2026-07-13', 1],
      ['2026-07-14', 0]
    ])
  })

  it('advances streaks by local calendar dates across DST-sized days', () => {
    expect(nextStudyStreakForDate('2026-03-07', 4, '2026-03-08')).toBe(5)
    expect(nextStudyStreakForDate('2026-03-08', 5, '2026-03-10')).toBe(1)
  })
})
