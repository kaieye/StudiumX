import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultStudySnapshot, STUDY_SPACE_STORAGE_KEY } from '../../src/renderer/src/study-space/constants'
import {
  STUDY_TASKS_CHANGED_EVENT,
  importTasks,
  inspectAssistantTurn,
  preparePrompt
} from '../../src/renderer/src/study-space/assistant-todo-capture'
import type { StudyTask } from '../../src/renderer/src/study-space/types'

function storeSnapshot(tasks: StudyTask[]): void {
  window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify({
    ...defaultStudySnapshot,
    clientId: 'studiumx-test-client',
    nickname: '同学 TEST',
    tasks
  }))
}

describe('AssistantTodoCapture', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('leaves non-task prompts unchanged', () => {
    const prompt = '  Explain the difference between a class and an object.  '

    expect(preparePrompt(prompt)).toBe(prompt)
  })

  it('keeps visible assistant content while exposing a valid fenced task payload', () => {
    const inspection = inspectAssistantTurn([
      '先按优先级完成下面三步：',
      '',
      '```todo',
      '{"tasks":["整理章节笔记","完成两道练习题","复盘错题原因"]}',
      '```'
    ].join('\n'))

    expect(inspection.visibleContent).toBe('先按优先级完成下面三步：')
    expect(inspection.tasks).toEqual(['整理章节笔记', '完成两道练习题', '复盘错题原因'])
  })

  it('never exposes malformed or partial Todo protocol output', () => {
    const malformed = inspectAssistantTurn('正常回复\n```todo\n{not valid json}\n```')
    const partial = inspectAssistantTurn('正常回复\n```todo\n{"tasks":["整理笔记"]')

    expect(malformed).toEqual({ visibleContent: '正常回复', tasks: [] })
    expect(partial).toEqual({ visibleContent: '正常回复', tasks: [] })
  })

  it('deduplicates assistant tasks and respects the eight-task cap', () => {
    const existing = Array.from({ length: 7 }, (_, index) => ({
      id: `existing-${index}`,
      title: `任务 ${index + 1}`,
      done: false,
      categoryId: 'study' as const
    }))
    storeSnapshot(existing)

    const result = importTasks(['  任务 1  ', '任务 8', '任务 9', '任务 8'])

    expect(result.added).toBe(1)
    expect(result.tasks).toHaveLength(8)
    expect(result.tasks[0]).toMatchObject({ title: '任务 8', done: false, categoryId: 'study' })
    expect(result.tasks.map((task) => task.title)).not.toContain('任务 9')
  })

  it('does not write or notify when an import is a duplicate/cap no-op', () => {
    storeSnapshot([{ id: 'existing', title: '整理笔记', done: false, categoryId: 'study' }])
    const onTasksChanged = vi.fn()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    window.addEventListener(STUDY_TASKS_CHANGED_EVENT, onTasksChanged)

    try {
      const result = importTasks(['整理笔记', '  整理笔记  '])

      expect(result.added).toBe(0)
      expect(setItem).not.toHaveBeenCalled()
      expect(onTasksChanged).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(STUDY_TASKS_CHANGED_EVENT, onTasksChanged)
    }
  })

  it('writes and notifies exactly once after a successful import', () => {
    storeSnapshot([])
    const onTasksChanged = vi.fn()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    window.addEventListener(STUDY_TASKS_CHANGED_EVENT, onTasksChanged)

    try {
      const result = importTasks(['整理笔记'])

      expect(result.added).toBe(1)
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(onTasksChanged).toHaveBeenCalledTimes(1)
      expect((onTasksChanged.mock.calls[0]?.[0] as CustomEvent<StudyTask[]>).detail).toContainEqual(
        expect.objectContaining({ title: '整理笔记' })
      )
    } finally {
      window.removeEventListener(STUDY_TASKS_CHANGED_EVENT, onTasksChanged)
    }
  })

  it('allocates a five-character random room when importing tasks before Study Session starts', () => {
    const result = importTasks(['整理笔记'])
    const persisted = JSON.parse(window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ?? 'null')

    expect(result.added).toBe(1)
    expect(persisted.spaceCode).toMatch(/^[A-Z0-9]{5}$/)
    expect(persisted.spaceCode).not.toBe('00000')
  })
})
