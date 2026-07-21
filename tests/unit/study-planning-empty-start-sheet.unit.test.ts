import { describe, expect, it } from 'vitest'
import {
  buildDefaultQuickStartTitle,
  buildEmptyStartSheetModel,
  normalizeQuickStartTitle,
  resolvePickedTaskId
} from '../../src/shared/study-planning'

describe('empty-start sheet model (STC-401 cutover C)', () => {
  it('prefills temporary focus title with local HH:mm', () => {
    const now = new Date(2026, 6, 21, 9, 5, 0)
    expect(buildDefaultQuickStartTitle(now)).toBe('临时专注 · 09:05')
    expect(normalizeQuickStartTitle('  ', now)).toBe('临时专注 · 09:05')
    expect(normalizeQuickStartTitle('  论文冲刺  ', now)).toBe('论文冲刺')
  })

  it('with open tasks: recommends pick_task and lists pick/quick/unattributed/cancel', () => {
    const model = buildEmptyStartSheetModel({
      openTasks: [
        { id: 'a', title: '线性代数' },
        { id: 'b', title: '  ' }
      ],
      now: new Date(2026, 6, 21, 14, 30, 0)
    })
    expect(model.hasOpenTasks).toBe(true)
    expect(model.recommended).toBe('pick_task')
    expect(model.options).toEqual(['pick_task', 'quick_start', 'unattributed', 'cancel'])
    expect(model.openTasks[1]?.title).toBe('未命名任务')
    expect(model.defaultQuickStartTitle).toBe('临时专注 · 14:30')
  })

  it('without open tasks: recommends quick_start and omits pick option', () => {
    const model = buildEmptyStartSheetModel({ openTasks: [] })
    expect(model.hasOpenTasks).toBe(false)
    expect(model.recommended).toBe('quick_start')
    expect(model.options).toEqual(['quick_start', 'unattributed', 'cancel'])
  })

  it('never invents first open task when pick id missing or unknown', () => {
    expect(resolvePickedTaskId(['a', 'b'], null)).toBeNull()
    expect(resolvePickedTaskId(['a', 'b'], 'c')).toBeNull()
    expect(resolvePickedTaskId(['a', 'b'], 'b')).toBe('b')
  })
})
