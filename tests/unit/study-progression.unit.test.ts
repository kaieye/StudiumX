import { describe, expect, it } from 'vitest'
import {
  DAILY_XP_CAP,
  MAX_STUDY_LEVEL,
  MAX_STUDY_XP,
  awardDailyXp,
  calculateStudyLevelProgress,
  emptyDailyXpProgress,
  xpForFocusCompletion,
  xpRequiredForNextLevel,
  xpThresholdForLevel
} from '../../src/shared/study-progression'

describe('shared study progression', () => {
  it('uses the same capped increasing curve at representative boundaries', () => {
    expect(xpRequiredForNextLevel(1)).toBe(120)
    expect(xpThresholdForLevel(2)).toBe(120)
    expect(xpThresholdForLevel(10)).toBe(2_520)
    expect(xpThresholdForLevel(20)).toBe(9_120)
    expect(xpThresholdForLevel(50)).toBe(52_920)
    expect(xpThresholdForLevel(MAX_STUDY_LEVEL)).toBe(205_920)

    expect(calculateStudyLevelProgress(0)).toMatchObject({ level: 1, xpAtLevelStart: 0, xpAtNextLevel: 120, progress: 0 })
    expect(calculateStudyLevelProgress(120)).toMatchObject({ level: 2, xpAtLevelStart: 120, xpAtNextLevel: 280, progress: 0 })
    expect(calculateStudyLevelProgress(MAX_STUDY_XP)).toMatchObject({ level: 100, xpAtLevelStart: MAX_STUDY_XP, xpAtNextLevel: MAX_STUDY_XP, progress: 1 })
  })

  it('uses shared reward rules for a completed focus session', () => {
    expect(xpForFocusCompletion(0)).toBe(10)
    expect(xpForFocusCompletion(300)).toBe(10)
    expect(xpForFocusCompletion(1_500)).toBe(50)
    expect(xpForFocusCompletion(1_501)).toBe(50)
    expect(xpForFocusCompletion(1_515)).toBe(51)
  })

  it('truncates XP by source and global daily limits while retaining an idempotent event log', () => {
    const day = '2026-07-31'
    const first = awardDailyXp({
      totalXp: 0,
      daily: emptyDailyXpProgress(day),
      localDate: day,
      source: 'focus_completion',
      sourceEventId: 'focus-1',
      requestedXp: 250
    })
    expect(first.awardedXp).toBe(200)
    expect(first.daily.bySource.focus_completion).toBe(200)

    const second = awardDailyXp({
      totalXp: first.awardedXp,
      daily: first.daily,
      localDate: day,
      source: 'task_completion',
      sourceEventId: 'task-1',
      taskId: 'task-1',
      requestedXp: 80
    })
    expect(second.awardedXp).toBe(60)

    const third = awardDailyXp({
      totalXp: first.awardedXp + second.awardedXp,
      daily: second.daily,
      localDate: day,
      source: 'review_correct',
      sourceEventId: 'review-1',
      requestedXp: 80
    })
    expect(third.awardedXp).toBe(40)
    expect(third.daily.awardedXp).toBe(DAILY_XP_CAP)

    const replay = awardDailyXp({
      totalXp: DAILY_XP_CAP,
      daily: third.daily,
      localDate: day,
      source: 'focus_completion',
      sourceEventId: 'focus-1',
      requestedXp: 25
    })
    expect(replay).toMatchObject({ awardedXp: 0, alreadyAwarded: true })
  })

  it('allows a task only once per day, resets the ledger at date rollover, and freezes at Lv.100', () => {
    const day = '2026-07-31'
    const first = awardDailyXp({
      totalXp: 0,
      daily: emptyDailyXpProgress(day),
      localDate: day,
      source: 'task_completion',
      sourceEventId: 'task-finish-1',
      taskId: 'task-1',
      requestedXp: 20
    })
    const duplicateTask = awardDailyXp({
      totalXp: 20,
      daily: first.daily,
      localDate: day,
      source: 'task_completion',
      sourceEventId: 'task-finish-2',
      taskId: 'task-1',
      requestedXp: 20
    })
    expect(duplicateTask).toMatchObject({ awardedXp: 0, alreadyAwarded: true })

    const tomorrow = awardDailyXp({
      totalXp: 20,
      daily: first.daily,
      localDate: '2026-08-01',
      source: 'task_completion',
      sourceEventId: 'task-finish-3',
      taskId: 'task-1',
      requestedXp: 20
    })
    expect(tomorrow).toMatchObject({ awardedXp: 20 })
    expect(tomorrow.daily.localDate).toBe('2026-08-01')

    const maxed = awardDailyXp({
      totalXp: MAX_STUDY_XP,
      daily: emptyDailyXpProgress(day),
      localDate: day,
      source: 'focus_completion',
      sourceEventId: 'after-max',
      requestedXp: 20
    })
    expect(maxed).toMatchObject({ awardedXp: 0, maxLevelReached: true })
  })
})
