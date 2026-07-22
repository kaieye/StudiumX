/**
 * STC-703 series edit UI pure presenters.
 * Date-grouped preview, window presets, delete list, until/count parse.
 * No auto-expand; no task clone; locked overlaps stay fail-closed in preview.
 */
import { describe, expect, it } from 'vitest'
import type { ScheduleBlock } from '../../src/shared/study-planning'
import {
  buildRecurrenceRuleFromForm,
  defaultWeekExpandWindow,
  type RecurrenceRuleFormDraft
} from '../../src/renderer/src/study-space/planning-recurrence-expand'
import {
  buildRecurrenceSeriesEditSheetCopy,
  buildRecurrenceSeriesPreviewModel,
  expandWindowForPreset,
  formatLockedOverlapSummary,
  formatUntilDateInputValue,
  groupRecurrencePreviewBlocks,
  nextRulesAfterDelete,
  parseOptionalPositiveCount,
  parseOptionalUntilDateInput
} from '../../src/renderer/src/study-space/planning-recurrence-series-ui'
import type { RecurrenceRule } from '../../src/shared/study-planning'

/** Monday 2026-07-20 UTC midnight — weekday 1. */
const MON = Date.UTC(2026, 6, 20, 0, 0, 0, 0)
const DAY = 24 * 60 * 60_000
const MIN = 60_000

function focusBlock(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'taskId' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    kind: 'focus',
    locked: false,
    source: 'manual',
    status: 'planned',
    revision: 1,
    ...partial
  }
}

function dailyDraft(overrides: Partial<RecurrenceRuleFormDraft> = {}): RecurrenceRuleFormDraft {
  return {
    taskId: 'task-read',
    frequency: 'daily',
    byWeekday: [],
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    dtStartMs: MON,
    expandAsLocked: true,
    ...overrides
  }
}

function weeklyDraft(overrides: Partial<RecurrenceRuleFormDraft> = {}): RecurrenceRuleFormDraft {
  return {
    taskId: 'task-read',
    frequency: 'weekly',
    byWeekday: [1, 3, 5],
    startMinutes: 14 * 60,
    endMinutes: 15 * 60,
    dtStartMs: MON,
    expandAsLocked: true,
    ...overrides
  }
}

describe('expandWindowForPreset', () => {
  it('week matches defaultWeekExpandWindow', () => {
    expect(expandWindowForPreset(MON, 'week')).toEqual(defaultWeekExpandWindow(MON))
  })

  it('two_weeks and four_weeks extend exclusive end', () => {
    expect(expandWindowForPreset(MON, 'two_weeks')).toEqual({
      windowStartMs: MON,
      windowEndMs: MON + 14 * DAY
    })
    expect(expandWindowForPreset(MON, 'four_weeks')).toEqual({
      windowStartMs: MON,
      windowEndMs: MON + 28 * DAY
    })
  })
})

describe('groupRecurrencePreviewBlocks', () => {
  it('groups by local day and sorts rows by start', () => {
    const blocks = [
      focusBlock({
        id: 'b-late',
        taskId: 'task-read',
        startAtMs: MON + 14 * 60 * MIN,
        endAtMs: MON + 15 * 60 * MIN
      }),
      focusBlock({
        id: 'b-early',
        taskId: 'task-read',
        startAtMs: MON + 9 * 60 * MIN,
        endAtMs: MON + 10 * 60 * MIN
      }),
      focusBlock({
        id: 'b-tue',
        taskId: 'task-read',
        startAtMs: MON + DAY + 9 * 60 * MIN,
        endAtMs: MON + DAY + 10 * 60 * MIN
      })
    ]
    const groups = groupRecurrencePreviewBlocks(blocks)
    expect(groups).toHaveLength(2)
    expect(groups[0]!.rows.map((r) => r.blockId)).toEqual(['b-early', 'b-late'])
    expect(groups[1]!.rows).toHaveLength(1)
    expect(groups[0]!.rows[0]!.badgeLabel).toBe('新增')
    expect(groups[0]!.rows[0]!.status).toBe('new')
    expect(groups[0]!.rows[0]!.timeLabel).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/)
  })
})

describe('buildRecurrenceSeriesPreviewModel', () => {
  it('dry-runs weekly expand into date-grouped calendar list without task clone', () => {
    const model = buildRecurrenceSeriesPreviewModel({
      draft: weeklyDraft(),
      existingBlocks: [],
      window: expandWindowForPreset(MON, 'week')
    })
    expect(model.canConfirm).toBe(true)
    expect(model.rows).toHaveLength(3)
    expect(model.groups.length).toBeGreaterThanOrEqual(1)
    for (const row of model.rows) {
      expect(row.blockId.startsWith('recurrence:') || row.blockId.includes('@')).toBe(true)
    }
    // apply blocks keep existing taskId
    for (const b of model.preview.applyBlocks) {
      expect(b.taskId).toBe('task-read')
      expect(b.kind).toBe('focus')
    }
    expect(model.copy.noCloneNote).toContain('克隆')
    expect(model.copy.confirmLabel).toContain('3')
  })

  it('surfaces locked overlap fail-closed and does not auto-move locked blocks', () => {
    const existing = [
      focusBlock({
        id: 'other-locked',
        taskId: 'other',
        startAtMs: MON + 9 * 60 * MIN + 30 * MIN,
        endAtMs: MON + 10 * 60 * MIN + 30 * MIN,
        locked: true
      })
    ]
    const model = buildRecurrenceSeriesPreviewModel({
      draft: dailyDraft(),
      existingBlocks: existing,
      window: expandWindowForPreset(MON, 'week')
    })
    expect(model.lockedOverlapCount).toBeGreaterThanOrEqual(1)
    expect(model.preview.applyBlocks.every((b) => b.startAtMs !== MON + 9 * 60 * MIN)).toBe(true)
    // Locked peer never appears in apply list / is not rewritten
    expect(model.preview.applyBlocks.some((b) => b.id === 'other-locked')).toBe(false)
    const lockedSummary = formatLockedOverlapSummary(model.preview.result)
    expect(lockedSummary).toMatch(/锁定/)
    expect(model.copy.lockedNote).toMatch(/锁定/)
  })

  it('rejects empty taskId (no silent task invent) and keeps canConfirm false', () => {
    const model = buildRecurrenceSeriesPreviewModel({
      draft: dailyDraft({ taskId: '' }),
      existingBlocks: [],
      window: expandWindowForPreset(MON, 'week')
    })
    expect(model.canConfirm).toBe(false)
    expect(model.rows).toHaveLength(0)
    expect(model.warnings.length).toBeGreaterThan(0)
  })

  it('honors until/count in form draft for narrower materialization', () => {
    const model = buildRecurrenceSeriesPreviewModel({
      draft: dailyDraft({ count: 2 }),
      existingBlocks: [],
      window: expandWindowForPreset(MON, 'two_weeks')
    })
    // count=2 from dtStart → at most 2 new blocks in a longer window
    expect(model.preview.applyBlocks.length).toBeLessThanOrEqual(2)
    expect(model.preview.applyBlocks.length).toBeGreaterThan(0)
    const rule = buildRecurrenceRuleFromForm(dailyDraft({ count: 2, untilMs: MON + 3 * DAY }))
    expect(rule.count).toBe(2)
    expect(rule.untilMs).toBe(MON + 3 * DAY)
  })
})

describe('parseOptionalPositiveCount / until date', () => {
  it('parses positive count and rejects invalid', () => {
    expect(parseOptionalPositiveCount('3')).toBe(3)
    expect(parseOptionalPositiveCount('')).toBeNull()
    expect(parseOptionalPositiveCount('0')).toBeNull()
    expect(parseOptionalPositiveCount('-2')).toBeNull()
    expect(parseOptionalPositiveCount('x')).toBeNull()
  })

  it('parses YYYY-MM-DD after dtStart only', () => {
    const until = parseOptionalUntilDateInput('2026-07-25', MON)
    expect(until).not.toBeNull()
    expect(until!).toBeGreaterThan(MON)
    expect(parseOptionalUntilDateInput('', MON)).toBeNull()
    expect(parseOptionalUntilDateInput('2026-07-19', MON)).toBeNull()
    expect(parseOptionalUntilDateInput('not-a-date', MON)).toBeNull()
  })

  it('round-trips until input value', () => {
    const ms = new Date(2026, 6, 25).getTime()
    expect(formatUntilDateInputValue(ms)).toBe('2026-07-25')
    expect(formatUntilDateInputValue(null)).toBe('')
  })
})

describe('nextRulesAfterDelete', () => {
  it('removes by id without touching other rules or inventing tasks', () => {
    const rules: RecurrenceRule[] = [
      {
        id: 'recurrence:a',
        taskId: 'a',
        kind: 'focus',
        frequency: 'daily',
        dtStartMs: MON,
        startMinutes: 9 * 60,
        endMinutes: 10 * 60
      },
      {
        id: 'recurrence:b',
        taskId: 'b',
        kind: 'focus',
        frequency: 'weekly',
        byWeekday: [1],
        dtStartMs: MON,
        startMinutes: 14 * 60,
        endMinutes: 15 * 60
      }
    ]
    const next = nextRulesAfterDelete(rules, 'recurrence:a')
    expect(next).toHaveLength(1)
    expect(next[0]!.id).toBe('recurrence:b')
    expect(next[0]!.taskId).toBe('b')
    expect(nextRulesAfterDelete(rules, 'missing')).toHaveLength(2)
  })
})

describe('buildRecurrenceSeriesEditSheetCopy', () => {
  it('varies copy by hasRule and task title', () => {
    const withRule = buildRecurrenceSeriesEditSheetCopy({ taskTitle: '阅读', hasRule: true })
    expect(withRule.title).toContain('阅读')
    expect(withRule.description).toMatch(/删除规则/)
    expect(withRule.deleteConfirmBody).toMatch(/历史计时/)
    const noRule = buildRecurrenceSeriesEditSheetCopy({ hasRule: false })
    expect(noRule.description).toMatch(/不会自动展开/)
  })
})
