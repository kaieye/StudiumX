import { describe, expect, it } from 'vitest'
import type { StudyTaskSchedule } from '../../src/renderer/src/study-space/types'
import {
  MINUTES_PER_DAY,
  SCHEDULE_STEP_MINUTES,
  canUseScheduleTime,
  chooseAllowedMinute,
  createScheduleTaskProposal,
  createSelectionSchedule,
  getMinutesFromPointer,
  getPointerGrabOffsetMinutes,
  parseTimeParts,
  patchSchedule,
  projectDayPointer,
  projectTaskDragSchedule,
  projectTaskResizeSchedule,
  snapMinutesToStep,
  validateTimeFields
} from '../../src/renderer/src/views/workbench/study-task-schedule-interaction'
import { layoutDayTasks } from '../../src/renderer/src/views/workbench/study-task-schedule-layout'

const schedule = (startMinutes: number, endMinutes: number, weekday = 0): StudyTaskSchedule => ({
  weekday,
  startMinutes,
  endMinutes
})

describe('study task schedule interaction policy', () => {
  it.each([
    { minutes: -10, expected: -15 },
    { minutes: 7, expected: 0 },
    { minutes: 8, expected: 15 },
    { minutes: 22, expected: 15 },
    { minutes: 1_439, expected: 1_440 }
  ])('snaps $minutes minutes to $expected-minute schedule steps', ({ minutes, expected }) => {
    expect(snapMinutesToStep(minutes)).toBe(expected)
  })

  it.each([
    { clientY: 100, expected: 0 },
    { clientY: 200, expected: 720 },
    { clientY: 300, expected: MINUTES_PER_DAY },
    { clientY: 400, expected: MINUTES_PER_DAY }
  ])('projects pointer geometry at $clientY to $expected minutes', ({ clientY, expected }) => {
    expect(getMinutesFromPointer({ top: 100, height: 200 }, clientY)).toBe(expected)
  })

  it('rejects invalid days while projecting day pointer coordinates', () => {
    expect(projectDayPointer(-1, { top: 0, height: 100 }, 50)).toBeNull()
    expect(projectDayPointer(7, { top: 0, height: 100 }, 50)).toBeNull()
    expect(projectDayPointer(3, { top: 0, height: 100 }, 50)).toEqual({ weekday: 3, minutes: 720 })
  })

  it.each([
    {
      label: 'rounds a forward selection outward',
      weekday: 2,
      anchor: 601,
      current: 646,
      requireDrag: false,
      expected: schedule(600, 660, 2)
    },
    {
      label: 'supports reverse selection',
      weekday: 4,
      anchor: 646,
      current: 601,
      requireDrag: false,
      expected: schedule(600, 660, 4)
    },
    {
      label: 'clamps a late selection to the end of the day',
      weekday: 1,
      anchor: 1_438,
      current: 1_440,
      requireDrag: false,
      expected: schedule(1_425, 1_440, 1)
    }
  ])('creates a day selection that $label', ({ weekday, anchor, current, requireDrag, expected }) => {
    expect(createSelectionSchedule(weekday, anchor, current, requireDrag)).toEqual(expected)
  })

  it('does not turn a click-sized selection into a task proposal and rejects invalid days', () => {
    expect(createSelectionSchedule(0, 600, 607, true)).toBeNull()
    expect(createSelectionSchedule(9, 600, 660)).toBeNull()
  })

  it('preserves the pointer grab offset and clamps a task drag to day boundaries', () => {
    const origin = schedule(540, 600, 0)
    const offset = getPointerGrabOffsetMinutes({ top: 100, height: 60 }, 130, 60)

    expect(offset).toBe(30)
    expect(projectTaskDragSchedule(origin, { weekday: 5, minutes: 630 }, offset, 60)).toEqual(schedule(600, 660, 5))
    expect(projectTaskDragSchedule(origin, { weekday: 5, minutes: 3 }, offset, 60)).toEqual(schedule(0, 60, 5))
    expect(projectTaskDragSchedule(origin, { weekday: 5, minutes: 1_440 }, offset, 60)).toEqual(schedule(1_380, 1_440, 5))
  })

  it('keeps the prior schedule untouched when drag projection lands outside a day', () => {
    const origin = schedule(540, 600, 0)
    expect(projectTaskDragSchedule(origin, null, 30, 60)).toBeNull()
  })

  it.each([
    {
      label: 'start resize preserves a minimum duration',
      edge: 'start' as const,
      pointer: 890,
      expected: schedule(885, 900)
    },
    {
      label: 'end resize preserves a minimum duration',
      edge: 'end' as const,
      pointer: 605,
      expected: schedule(600, 615)
    },
    {
      label: 'end resize clamps to the end of a day',
      edge: 'end' as const,
      pointer: 1_700,
      expected: schedule(600, 1_440)
    }
  ])('$label', ({ edge, pointer, expected }) => {
    expect(projectTaskResizeSchedule(schedule(600, 900), pointer, edge)).toEqual(expected)
  })

  it('validates keyboard time fields and retains the legacy end-after-start message', () => {
    const endPolicy = { minMinutes: 1, maxMinutes: MINUTES_PER_DAY, isDisabled: (minutes: number) => minutes <= 600 }

    expect(parseTimeParts('24', '01', 0, MINUTES_PER_DAY)).toBeNull()
    expect(validateTimeFields('9', '30', { minMinutes: 0, maxMinutes: MINUTES_PER_DAY - 1 })).toEqual({
      valid: true,
      minutes: 570
    })
    expect(validateTimeFields('25', '00', endPolicy)).toEqual({
      valid: false,
      message: '请输入有效的小时和分钟'
    })
    expect(validateTimeFields('10', '00', endPolicy)).toEqual({
      valid: false,
      message: '结束时间必须晚于开始时间'
    })
    expect(canUseScheduleTime(24, 0, { minMinutes: 1, maxMinutes: MINUTES_PER_DAY })).toBe(true)
    expect(chooseAllowedMinute(10, 44, endPolicy)).toBe(44)
  })

  it('creates independent default task proposals and normalizes editor schedule patches', () => {
    const original = schedule(540, 600, 2)
    const proposal = createScheduleTaskProposal(original)

    proposal.schedule.startMinutes = 0
    expect(original.startMinutes).toBe(540)
    expect(proposal).toMatchObject({ title: '', categoryId: 'study', schedule: schedule(0, 600, 2) })
    expect(patchSchedule(schedule(1_400, 1_430), { startMinutes: 1_435 })).toEqual(schedule(1_435, 1_440))
    expect(SCHEDULE_STEP_MINUTES).toBe(15)
  })
})

describe('study task schedule overlap layout', () => {
  it('assigns lanes across transitive overlap clusters and resets after touching events', () => {
    const tasks = [
      { id: 'late', title: '晚间', done: false, schedule: schedule(780, 840) },
      { id: 'bridge', title: '桥接', done: false, schedule: schedule(570, 720) },
      { id: 'first', title: '开始', done: false, schedule: schedule(540, 600) },
      { id: 'middle', title: '中间', done: false, schedule: schedule(630, 660) },
      { id: 'touching', title: '相邻', done: false, schedule: schedule(720, 780) }
    ]

    expect(layoutDayTasks(tasks).map(({ task, lane, lanes }) => [task.id, lane, lanes])).toEqual([
      ['first', 0, 2],
      ['bridge', 1, 2],
      ['middle', 0, 2],
      ['touching', 0, 1],
      ['late', 0, 1]
    ])
  })
})