import { describe, expect, it } from 'vitest'
import type { ScheduleBlock } from '../../src/shared/study-planning'
import {
  SCHEDULE_CONFLICTS_LIST_CAP,
  buildScheduleConflictsDismissKey,
  formatScheduleBlockTimeLabel,
  projectScheduleConflictsBanner,
  selectFocusBlocksForConflictScan,
  shouldShowScheduleConflictsBanner
} from '../../src/renderer/src/study-space/planning-schedule-conflicts-ui'

function focusBlock(
  partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'startAtMs' | 'endAtMs'>
): ScheduleBlock {
  return {
    taskId: partial.taskId ?? 'task-a',
    kind: 'focus',
    locked: partial.locked ?? false,
    source: partial.source ?? 'manual',
    status: partial.status ?? 'planned',
    revision: partial.revision ?? 1,
    ...partial
  }
}

/** Local Mon 2026-07-20 09:00–10:00 (Asia/Shanghai friendly fixed wall times via Date ctor). */
function localMs(y: number, m: number, d: number, hh: number, mm: number): number {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
}

describe('planning-schedule-conflicts-ui (STC-707)', () => {
  it('selectFocusBlocksForConflictScan drops cancelled and non-focus', () => {
    const blocks = [
      focusBlock({ id: 'f1', startAtMs: 0, endAtMs: 100 }),
      focusBlock({ id: 'f2', startAtMs: 50, endAtMs: 150, status: 'cancelled' }),
      {
        id: 'br',
        taskId: null,
        kind: 'short_break' as const,
        startAtMs: 0,
        endAtMs: 50,
        locked: false,
        source: 'manual' as const,
        status: 'planned' as const,
        revision: 1
      }
    ]
    const selected = selectFocusBlocksForConflictScan(blocks)
    expect(selected.map((b) => b.id)).toEqual(['f1'])
  })

  it('projects empty conflicts as clear model', () => {
    const model = projectScheduleConflictsBanner({
      scheduleBlocks: [
        focusBlock({
          id: 'a',
          taskId: 't1',
          startAtMs: localMs(2026, 7, 20, 9, 0),
          endAtMs: localMs(2026, 7, 20, 10, 0)
        }),
        focusBlock({
          id: 'b',
          taskId: 't2',
          startAtMs: localMs(2026, 7, 20, 11, 0),
          endAtMs: localMs(2026, 7, 20, 12, 0)
        })
      ],
      tasks: [
        { id: 't1', title: '阅读' },
        { id: 't2', title: '写作' }
      ]
    })
    expect(model.kind).toBe('clear')
    expect(model.conflictCount).toBe(0)
    expect(model.dismissKey).toBe('clear')
    expect(shouldShowScheduleConflictsBanner({ model })).toBe(false)
  })

  it('projects overlapping focus blocks with titles and time labels', () => {
    const aStart = localMs(2026, 7, 20, 9, 0)
    const aEnd = localMs(2026, 7, 20, 10, 0)
    const bStart = localMs(2026, 7, 20, 9, 30)
    const bEnd = localMs(2026, 7, 20, 10, 30)
    const model = projectScheduleConflictsBanner({
      scheduleBlocks: [
        focusBlock({ id: 'block-a', taskId: 't1', startAtMs: aStart, endAtMs: aEnd }),
        focusBlock({
          id: 'block-b',
          taskId: 't2',
          startAtMs: bStart,
          endAtMs: bEnd,
          locked: true
        })
      ],
      tasks: [
        { id: 't1', title: '阅读' },
        { id: 't2', title: '写作' }
      ]
    })
    expect(model.kind).toBe('conflicts')
    expect(model.conflictCount).toBe(1)
    expect(model.pairs).toHaveLength(1)
    const pair = model.pairs[0]
    expect(pair.aTitle).toBe('阅读')
    expect(pair.bTitle).toBe('写作')
    expect(pair.bLocked).toBe(true)
    expect(pair.aTimeLabel).toMatch(/09:00/)
    expect(pair.aTimeLabel).toMatch(/10:00/)
    expect(pair.bTimeLabel).toMatch(/09:30/)
    expect(model.copy.title).toContain('1')
    expect(model.dismissKey).toBe(buildScheduleConflictsDismissKey([{ aId: 'block-a', bId: 'block-b' }]))
  })

  it('ignores cancelled focus even when intervals overlap', () => {
    const model = projectScheduleConflictsBanner({
      scheduleBlocks: [
        focusBlock({ id: 'a', taskId: 't1', startAtMs: 0, endAtMs: 100 }),
        focusBlock({
          id: 'b',
          taskId: 't2',
          startAtMs: 50,
          endAtMs: 150,
          status: 'cancelled'
        })
      ],
      tasks: [
        { id: 't1', title: 'A' },
        { id: 't2', title: 'B' }
      ]
    })
    expect(model.kind).toBe('clear')
  })

  it('caps listed pairs and reports truncatedCount', () => {
    const blocks: ScheduleBlock[] = []
    // Chain of 10 blocks each overlapping next → 9 pairwise conflicts among sorted order
    // Better: one base overlapping many → n-1 conflicts with base
    const base = focusBlock({
      id: 'base',
      taskId: 't0',
      startAtMs: 0,
      endAtMs: 1000
    })
    blocks.push(base)
    for (let i = 1; i <= 10; i += 1) {
      blocks.push(
        focusBlock({
          id: `x${i}`,
          taskId: `t${i}`,
          startAtMs: i * 10,
          endAtMs: i * 10 + 20
        })
      )
    }
    const model = projectScheduleConflictsBanner({
      scheduleBlocks: blocks,
      tasks: [{ id: 't0', title: 'Base' }],
      listCap: 3
    })
    expect(model.conflictCount).toBeGreaterThan(3)
    expect(model.pairs).toHaveLength(3)
    expect(model.truncatedCount).toBe(model.conflictCount - 3)
    expect(model.copy.moreLabel).toContain(String(model.truncatedCount))
  })

  it('shouldShow hides only when dismissedKey matches current dismissKey', () => {
    const model = projectScheduleConflictsBanner({
      scheduleBlocks: [
        focusBlock({ id: 'a', taskId: 't1', startAtMs: 0, endAtMs: 100 }),
        focusBlock({ id: 'b', taskId: 't2', startAtMs: 50, endAtMs: 150 })
      ],
      tasks: [
        { id: 't1', title: 'A' },
        { id: 't2', title: 'B' }
      ]
    })
    expect(shouldShowScheduleConflictsBanner({ model, dismissedKey: null })).toBe(true)
    expect(
      shouldShowScheduleConflictsBanner({ model, dismissedKey: model.dismissKey })
    ).toBe(false)
    expect(
      shouldShowScheduleConflictsBanner({ model, dismissedKey: 'stale-key' })
    ).toBe(true)
  })

  it('formatScheduleBlockTimeLabel uses Mon-first weekday when reverse works', () => {
    // 2026-07-20 is Monday
    const label = formatScheduleBlockTimeLabel({
      startAtMs: localMs(2026, 7, 20, 9, 0),
      endAtMs: localMs(2026, 7, 20, 10, 30)
    })
    expect(label).toContain('周一')
    expect(label).toContain('09:00')
    expect(label).toContain('10:30')
  })

  it('default list cap constant is positive', () => {
    expect(SCHEDULE_CONFLICTS_LIST_CAP).toBeGreaterThan(0)
  })
})
