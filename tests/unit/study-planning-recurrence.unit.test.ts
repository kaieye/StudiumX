import { describe, expect, it } from 'vitest'
import {
  expandRecurrenceToScheduleBlocks,
  mergeExpandedScheduleBlocks,
  validateRecurrenceRule,
  validateRecurrenceRules,
  type RecurrenceRule,
  type ScheduleBlock
} from '../../src/shared/study-planning'

/** Monday 2026-07-20 UTC midnight — weekday 1. */
const MON = Date.UTC(2026, 6, 20, 0, 0, 0, 0)
const DAY = 24 * 60 * 60_000
const MIN = 60_000

function dailyFocus(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: 'rule-daily',
    taskId: 'task-read',
    kind: 'focus',
    frequency: 'daily',
    dtStartMs: MON,
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    ...overrides
  }
}

function weeklyMwF(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: 'rule-weekly',
    taskId: 'task-lab',
    kind: 'focus',
    frequency: 'weekly',
    byWeekday: [1, 3, 5], // Mon, Wed, Fri
    dtStartMs: MON,
    startMinutes: 14 * 60,
    endMinutes: 15 * 60 + 30,
    ...overrides
  }
}

describe('STC-703 recurrence validate', () => {
  it('accepts a well-formed daily focus rule bound to one task', () => {
    const r = validateRecurrenceRule(dailyFocus())
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
  })

  it('rejects weekly without byWeekday and focus without taskId', () => {
    const weekly = validateRecurrenceRule({
      ...weeklyMwF(),
      byWeekday: []
    })
    expect(weekly.ok).toBe(false)
    expect(weekly.issues.some((i) => i.code === 'rule_weekly_days_required')).toBe(true)

    const noTask = validateRecurrenceRule({
      ...dailyFocus(),
      taskId: null
    })
    expect(noTask.ok).toBe(false)
    expect(noTask.issues.some((i) => i.code === 'rule_focus_task_required')).toBe(true)
  })

  it('allows break templates with null taskId', () => {
    const r = validateRecurrenceRule({
      id: 'break-daily',
      taskId: null,
      kind: 'short_break',
      frequency: 'daily',
      dtStartMs: MON,
      startMinutes: 10 * 60,
      endMinutes: 10 * 60 + 10
    })
    expect(r.ok).toBe(true)
  })

  it('detects duplicate rule ids', () => {
    const r = validateRecurrenceRules([dailyFocus(), dailyFocus({ id: 'rule-daily' })])
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'rule_id_duplicate')).toBe(true)
  })
})

describe('STC-703 expandRecurrenceToScheduleBlocks', () => {
  it('expands daily rule deterministically for a 3-day window without cloning tasks', () => {
    const window = {
      windowStartMs: MON,
      windowEndMs: MON + 3 * DAY
    }
    const a = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window
    })
    const b = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window
    })
    expect(a.blocks).toHaveLength(3)
    expect(b.blocks).toEqual(a.blocks)
    expect(new Set(a.blocks.map((x) => x.taskId))).toEqual(new Set(['task-read']))
    expect(a.blocks.every((x) => x.id.startsWith('rule-daily@'))).toBe(true)
    expect(a.blocks[0].startAtMs).toBe(MON + 9 * 60 * MIN)
    expect(a.blocks[0].endAtMs).toBe(MON + 10 * 60 * MIN)
    expect(a.blocks[0].locked).toBe(true)
    expect(a.blocks[0].status).toBe('planned')
  })

  it('expands weekly Mon/Wed/Fri only', () => {
    // Mon..Sun window
    const result = expandRecurrenceToScheduleBlocks({
      rules: [weeklyMwF()],
      window: { windowStartMs: MON, windowEndMs: MON + 7 * DAY }
    })
    expect(result.blocks).toHaveLength(3)
    const days = result.blocks.map((b) => new Date(b.startAtMs).getUTCDay())
    expect(days).toEqual([1, 3, 5])
    expect(result.blocks.every((b) => b.taskId === 'task-lab')).toBe(true)
  })

  it('honours count and until bounds', () => {
    const withCount = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus({ count: 2 })],
      window: { windowStartMs: MON, windowEndMs: MON + 10 * DAY }
    })
    expect(withCount.blocks).toHaveLength(2)

    const until = MON + 2 * DAY
    const withUntil = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus({ untilMs: until })],
      window: { windowStartMs: MON, windowEndMs: MON + 10 * DAY }
    })
    // Occurrences starting before until: Mon + Tue only
    expect(withUntil.blocks).toHaveLength(2)
    expect(withUntil.blocks.every((b) => b.startAtMs < until)).toBe(true)
  })

  it('skips already-materialised occurrences idempotently', () => {
    const window = { windowStartMs: MON, windowEndMs: MON + 3 * DAY }
    const first = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window
    })
    expect(first.blocks).toHaveLength(3)

    const second = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window,
      existingBlocks: first.blocks
    })
    expect(second.blocks).toHaveLength(0)
    expect(second.skippedExisting).toBe(3)
  })

  it('fail-closed skips occurrences that would overlap locked existing blocks', () => {
    const locked: ScheduleBlock = {
      id: 'existing-locked',
      taskId: 'other',
      kind: 'focus',
      startAtMs: MON + 9 * 60 * MIN,
      endAtMs: MON + 10 * 60 * MIN,
      locked: true,
      source: 'manual',
      status: 'planned',
      revision: 1
    }
    const result = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window: { windowStartMs: MON, windowEndMs: MON + 3 * DAY },
      existingBlocks: [locked]
    })
    // Mon skipped; Tue + Wed emitted
    expect(result.blocks).toHaveLength(2)
    expect(result.skippedLockedOverlap).toBe(1)
    expect(result.warnings.some((w) => w.code === 'locked_overlap')).toBe(true)
    expect(result.blocks.every((b) => b.startAtMs !== locked.startAtMs)).toBe(true)
  })

  it('does not mutate existing blocks or invent timer sessions (plans vs actuals)', () => {
    const existing: ScheduleBlock[] = [
      {
        id: 'keep-me',
        taskId: 'task-read',
        kind: 'focus',
        startAtMs: MON - DAY + 9 * 60 * MIN,
        endAtMs: MON - DAY + 10 * 60 * MIN,
        locked: true,
        source: 'manual',
        status: 'completed',
        revision: 2
      }
    ]
    const snapshot = structuredClone(existing)
    const timerSessions = Object.freeze([
      {
        id: 'hist-session',
        taskId: 'task-read',
        accumulatedFocusSeconds: 1800
      }
    ])

    const result = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window: { windowStartMs: MON, windowEndMs: MON + 2 * DAY },
      existingBlocks: existing
    })

    expect(existing).toEqual(snapshot)
    expect(timerSessions[0].accumulatedFocusSeconds).toBe(1800)
    expect(result.blocks.every((b) => b.status === 'planned')).toBe(true)
    // Expansion only returns NEW plan drafts — never rewrites history.
    expect(result.blocks.every((b) => b.id !== 'keep-me')).toBe(true)
  })

  it('mergeExpandedScheduleBlocks preserves history and reports locked validation', () => {
    const history: ScheduleBlock = {
      id: 'hist',
      taskId: 'task-read',
      kind: 'focus',
      startAtMs: MON - DAY + 9 * 60 * MIN,
      endAtMs: MON - DAY + 10 * 60 * MIN,
      locked: true,
      source: 'manual',
      status: 'completed',
      revision: 3
    }
    const expanded = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window: { windowStartMs: MON, windowEndMs: MON + 1 * DAY }
    }).blocks
    const merged = mergeExpandedScheduleBlocks({
      existingBlocks: [history],
      expanded
    })
    expect(merged.blocks.some((b) => b.id === 'hist' && b.revision === 3)).toBe(true)
    expect(merged.blocks.some((b) => b.id === expanded[0]?.id)).toBe(true)
  })

  it('invalid window yields warning and empty blocks', () => {
    const r = expandRecurrenceToScheduleBlocks({
      rules: [dailyFocus()],
      window: { windowStartMs: MON + DAY, windowEndMs: MON }
    })
    expect(r.blocks).toHaveLength(0)
    expect(r.warnings.some((w) => w.code === 'window_invalid')).toBe(true)
  })
})
