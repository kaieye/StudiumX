import { describe, expect, it } from 'vitest'
import {
  emptyLabelForTaskListView,
  isTaskListViewId,
  projectStudyTasksForView,
  resolveLocalDayBounds,
  studyTaskToPlanningTask,
  studyTasksToScheduleBlocks,
  TASK_LIST_VIEWS
} from '../../src/renderer/src/study-space/planning-task-timeline-adapter'
import type { StudyTask } from '../../src/renderer/src/study-space/types'

const weekAnchor = Date.UTC(2026, 6, 20) // Mon UTC

function task(partial: Partial<StudyTask> & Pick<StudyTask, 'id' | 'title'>): StudyTask {
  return {
    id: partial.id,
    title: partial.title,
    done: partial.done ?? false,
    ...(partial.categoryId ? { categoryId: partial.categoryId } : {}),
    ...(partial.schedule ? { schedule: partial.schedule } : {})
  }
}

describe('planning-task-timeline-adapter (STC-302 UI)', () => {
  it('exports the three primary task-list views', () => {
    expect(TASK_LIST_VIEWS.map((v) => v.id)).toEqual(['today', 'unfinished', 'all'])
    expect(isTaskListViewId('today')).toBe(true)
    expect(isTaskListViewId('unfinished')).toBe(true)
    expect(isTaskListViewId('all')).toBe(true)
    expect(isTaskListViewId('now')).toBe(false)
    expect(isTaskListViewId('inbox')).toBe(false)
    expect(isTaskListViewId('done')).toBe(false)
  })

  it('maps missing category to inbox PlanningTask', () => {
    expect(studyTaskToPlanningTask(task({ id: 'a', title: 'x' }))).toMatchObject({
      id: 'a',
      status: 'open',
      categoryId: null,
      inbox: true
    })
    expect(studyTaskToPlanningTask(task({ id: 'b', title: 'y', categoryId: 'study', done: true }))).toMatchObject({
      status: 'done',
      categoryId: 'study',
      inbox: false
    })
  })

  it('projects unfinished and all views, keeping inbox as an attribute', () => {
    const tasks = [
      task({ id: 'open-study', title: 'A', categoryId: 'study' }),
      task({ id: 'inbox-1', title: 'B' }),
      task({ id: 'done-1', title: 'C', categoryId: 'study', done: true })
    ]
    expect(projectStudyTasksForView({ view: 'unfinished', tasks, nowMs: weekAnchor }).map((t) => t.id)).toEqual([
      'open-study',
      'inbox-1'
    ])
    expect(projectStudyTasksForView({ view: 'all', tasks, nowMs: weekAnchor }).map((t) => t.id)).toEqual([
      'open-study',
      'inbox-1',
      'done-1'
    ])
  })

  it('today view includes scheduled-today tasks but excludes unscheduled tasks', () => {
    // Mon-first weekday 0 = Monday; weekAnchor is Monday UTC.
    const tasks = [
      task({
        id: 'mon',
        title: 'Mon block',
        categoryId: 'study',
        schedule: { weekday: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 }
      }),
      task({
        id: 'tue',
        title: 'Tue block',
        categoryId: 'study',
        schedule: { weekday: 1, startMinutes: 9 * 60, endMinutes: 10 * 60 }
      }),
      task({ id: 'unscheduled', title: 'No schedule', categoryId: 'study' })
    ]
    const nowMs = weekAnchor + 8 * 60 * 60_000
    const ids = projectStudyTasksForView({
      view: 'today',
      tasks,
      nowMs,
      weekAnchorMidnightMs: weekAnchor
    }).map((t) => t.id)
    expect(ids).toEqual(['mon'])
  })

  it('materializes Mon-first V1 schedule blocks', () => {
    const blocks = studyTasksToScheduleBlocks(
      [
        task({
          id: 't',
          title: 'x',
          schedule: { weekday: 0, startMinutes: 60, endMinutes: 120 }
        })
      ],
      weekAnchor
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.taskId).toBe('t')
    expect(blocks[0]?.endAtMs).toBeGreaterThan(blocks[0]!.startAtMs)
  })

  it('resolveLocalDayBounds is local midnight window', () => {
    const local = new Date(2026, 6, 21, 15, 0, 0, 0).getTime()
    const { dayStartMs, dayEndMs } = resolveLocalDayBounds(local)
    expect(dayEndMs - dayStartMs).toBe(24 * 60 * 60_000)
    const start = new Date(dayStartMs)
    expect(start.getHours()).toBe(0)
    expect(start.getDate()).toBe(21)
  })

  it('empty labels are non-empty for each view', () => {
    for (const v of TASK_LIST_VIEWS) {
      expect(emptyLabelForTaskListView(v.id).length).toBeGreaterThan(0)
    }
  })
})
