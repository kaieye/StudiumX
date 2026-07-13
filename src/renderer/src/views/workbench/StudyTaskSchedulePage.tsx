import { ArrowLeft, CalendarDays, Check, Clock3, PencilLine, Plus, Trash2, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  StudyTask,
  StudyTaskSchedule,
  StudyTaskScheduleColorId,
  StudyTaskScheduleInput,
  StudyTaskUpdateInput
} from '../../study-space/types'

type StudyTaskSchedulePageProps = {
  tasks: StudyTask[]
  openTasks: number
  completedTasks: number
  onAddScheduledTask: (title: string, schedule: StudyTaskScheduleInput) => boolean
  onUpdateTask: (taskId: string, update: StudyTaskUpdateInput) => boolean
  onToggleTask: (taskId: string) => void
  onRemoveTask: (taskId: string) => void
  onBack: () => void
}

type ScheduledStudyTask = StudyTask & { schedule: StudyTaskSchedule }

type ScheduledTaskLayout = {
  task: ScheduledStudyTask
  lane: number
  lanes: number
}

type TaskEditorState =
  | { mode: 'add'; title: string; schedule: StudyTaskScheduleInput }
  | { mode: 'edit'; taskId: string; title: string; done: boolean; schedule: StudyTaskScheduleInput }

type DraftTaskState = {
  title: string
  schedule: StudyTaskScheduleInput
}

type HoverState = {
  dayIndex: number
  minutes: number
}

type SelectionState = {
  dayIndex: number
  anchorMinutes: number
  currentMinutes: number
  pointerId: number
}

type InlineTitleState = {
  taskId: string
  title: string
}

type TaskContextMenuState = {
  taskId: string
  x: number
  y: number
}

type PendingTaskDragState = {
  task: ScheduledStudyTask
  element: HTMLDivElement
  pointerId: number
  clientX: number
  clientY: number
  grabOffsetX: number
  grabOffsetY: number
  grabOffsetMinutes: number
}

type TaskDragState = {
  taskId: string
  title: string
  done: boolean
  pointerId: number
  originSchedule: StudyTaskSchedule
  previewSchedule: StudyTaskScheduleInput
  durationMinutes: number
  grabOffsetX: number
  grabOffsetY: number
  grabOffsetMinutes: number
  clientX: number
  clientY: number
  width: number
  height: number
}

type NumberVarStyle<Name extends string> = CSSProperties & Record<Name, number>
type RangeVarStyle = CSSProperties & Record<'--range-start-ratio' | '--range-duration-ratio', number>
type HoverVarStyle = CSSProperties & Record<'--hover-ratio', number>
type EventVarStyle = CSSProperties & Record<
  '--event-start-ratio' | '--event-duration-ratio' | '--event-left' | '--event-width' | '--event-color' | '--event-ink',
  string | number
>
type ColorSwatchVarStyle = CSSProperties & Record<'--schedule-swatch-color' | '--schedule-swatch-ink', string>
type TaskColorVarStyle = CSSProperties & Record<'--event-color' | '--event-ink', string>

const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const hourMarks = [0, 4, 8, 12, 16, 20, 24]
const morandiTaskColors: Array<{
  id: StudyTaskScheduleColorId
  name: string
  color: string
  ink: string
}> = [
  { id: 'sage', name: '鼠尾草', color: '#829d91', ink: '#ffffff' },
  { id: 'mist', name: '雾蓝', color: '#8197aa', ink: '#ffffff' },
  { id: 'clay', name: '暖陶土', color: '#ab8b80', ink: '#ffffff' },
  { id: 'mauve', name: '灰紫', color: '#9c8aa5', ink: '#ffffff' },
  { id: 'sand', name: '麦砂', color: '#b3a184', ink: '#ffffff' },
  { id: 'slate', name: '岩灰', color: '#7d8a91', ink: '#ffffff' },
  { id: 'rose', name: '柔玫', color: '#ad8f98', ink: '#ffffff' }
]
const minutesPerDay = 24 * 60
const selectionStepMinutes = 15

const startTimeOptions = createTimeOptions(0, 23 * 60 + 45)
const endTimeOptions = createTimeOptions(selectionStepMinutes, minutesPerDay)

function createTimeOptions(startMinutes: number, endMinutes: number): number[] {
  const options: number[] = []
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += selectionStepMinutes) {
    options.push(minutes)
  }
  return options
}

function defaultColorIdForWeekday(weekday: number): StudyTaskScheduleColorId {
  const colorIndex = Math.abs(Math.floor(weekday)) % morandiTaskColors.length
  return morandiTaskColors[colorIndex]?.id ?? 'sage'
}

function withDefaultScheduleColor(schedule: StudyTaskScheduleInput): StudyTaskScheduleInput {
  return { ...schedule, colorId: schedule.colorId ?? defaultColorIdForWeekday(schedule.weekday) }
}

function getScheduleColor(schedule: StudyTaskSchedule): (typeof morandiTaskColors)[number] {
  const fallbackColorId = defaultColorIdForWeekday(schedule.weekday)
  return morandiTaskColors.find((color) => color.id === (schedule.colorId ?? fallbackColorId)) ?? morandiTaskColors[0]!
}

function currentWeekdayIndex(): number {
  return (new Date().getDay() + 6) % 7
}

function createDefaultSchedule(): StudyTaskScheduleInput {
  const weekday = currentWeekdayIndex()
  return { weekday, startMinutes: 9 * 60, endMinutes: 10 * 60, colorId: defaultColorIdForWeekday(weekday) }
}

function hasSchedule(task: StudyTask): task is ScheduledStudyTask {
  return Boolean(task.schedule)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatMinutes(minutes: number): string {
  if (minutes >= minutesPerDay) return '24:00'
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatHour(hour: number): string {
  return `${hour}:00`
}

function getMinutesFromPointer(element: HTMLElement, clientY: number): number {
  const rect = element.getBoundingClientRect()
  const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0
  return clamp(Math.round(ratio * minutesPerDay), 0, minutesPerDay)
}

function snapMinutesToStep(minutes: number): number {
  return Math.round(minutes / selectionStepMinutes) * selectionStepMinutes
}

function getScheduleColumnFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const pointElement = document.elementFromPoint(clientX, clientY)
  return pointElement instanceof Element ? pointElement.closest<HTMLElement>('.study-schedule-day-column') : null
}

function getColumnDayIndex(column: HTMLElement): number | null {
  const dayIndex = Number(column.dataset.dayIndex)
  return Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex < weekDays.length ? dayIndex : null
}

function createTaskDragSchedule(
  originSchedule: StudyTaskSchedule,
  clientX: number,
  clientY: number,
  grabOffsetMinutes: number,
  durationMinutes: number
): StudyTaskScheduleInput | null {
  const column = getScheduleColumnFromPoint(clientX, clientY)
  if (!column) return null
  const dayIndex = getColumnDayIndex(column)
  if (dayIndex === null) return null
  const safeDuration = clamp(durationMinutes, selectionStepMinutes, minutesPerDay)
  const pointerMinutes = getMinutesFromPointer(column, clientY)
  const startMinutes = clamp(snapMinutesToStep(pointerMinutes - grabOffsetMinutes), 0, minutesPerDay - safeDuration)
  return {
    ...originSchedule,
    weekday: dayIndex,
    startMinutes,
    endMinutes: startMinutes + safeDuration,
    colorId: originSchedule.colorId ?? defaultColorIdForWeekday(dayIndex)
  }
}

function createSelectionSchedule(
  dayIndex: number,
  anchorMinutes: number,
  currentMinutes: number,
  requireDrag = false
): StudyTaskScheduleInput | null {
  if (requireDrag && Math.abs(currentMinutes - anchorMinutes) < 8) return null
  const lowerMinutes = Math.min(anchorMinutes, currentMinutes)
  const upperMinutes = Math.max(anchorMinutes, currentMinutes)
  const snappedStart = Math.floor(lowerMinutes / selectionStepMinutes) * selectionStepMinutes
  const snappedEnd = Math.ceil(upperMinutes / selectionStepMinutes) * selectionStepMinutes
  const startMinutes = clamp(snappedStart, 0, minutesPerDay - selectionStepMinutes)
  const endMinutes = clamp(Math.max(snappedEnd, startMinutes + selectionStepMinutes), startMinutes + selectionStepMinutes, minutesPerDay)
  return { weekday: dayIndex, startMinutes, endMinutes, colorId: defaultColorIdForWeekday(dayIndex) }
}

function createRangeStyle(startMinutes: number, endMinutes: number): RangeVarStyle {
  return {
    '--range-start-ratio': startMinutes / minutesPerDay,
    '--range-duration-ratio': (endMinutes - startMinutes) / minutesPerDay
  }
}

function layoutDayTasks(tasks: ScheduledStudyTask[]): ScheduledTaskLayout[] {
  const sorted = [...tasks].sort((left, right) => {
    const startDelta = left.schedule.startMinutes - right.schedule.startMinutes
    return startDelta || left.schedule.endMinutes - right.schedule.endMinutes || left.title.localeCompare(right.title)
  })
  const layouts: ScheduledTaskLayout[] = []
  let cluster: ScheduledStudyTask[] = []
  let clusterEnd = -1

  const flushCluster = (): void => {
    if (cluster.length === 0) return
    layouts.push(...layoutOverlapCluster(cluster))
    cluster = []
    clusterEnd = -1
  }

  for (const task of sorted) {
    if (cluster.length > 0 && task.schedule.startMinutes >= clusterEnd) flushCluster()
    cluster.push(task)
    clusterEnd = Math.max(clusterEnd, task.schedule.endMinutes)
  }
  flushCluster()
  return layouts
}

function layoutOverlapCluster(tasks: ScheduledStudyTask[]): ScheduledTaskLayout[] {
  const laneEnds: number[] = []
  const layouts = tasks.map((task) => {
    const lane = laneEnds.findIndex((endMinutes) => endMinutes <= task.schedule.startMinutes)
    const nextLane = lane === -1 ? laneEnds.length : lane
    laneEnds[nextLane] = task.schedule.endMinutes
    return { task, lane: nextLane, lanes: 1 }
  })
  const lanes = Math.max(1, laneEnds.length)
  return layouts.map((layout) => ({ ...layout, lanes }))
}

export function StudyTaskSchedulePage({
  tasks,
  openTasks,
  completedTasks,
  onAddScheduledTask,
  onUpdateTask,
  onToggleTask,
  onRemoveTask,
  onBack
}: StudyTaskSchedulePageProps) {
  const titleId = useId()
  const editorTitleId = useId()
  const [editor, setEditor] = useState<TaskEditorState | null>(null)
  const [editorError, setEditorError] = useState('')
  const [draftTask, setDraftTask] = useState<DraftTaskState | null>(null)
  const [draftError, setDraftError] = useState('')
  const [hover, setHover] = useState<HoverState | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [inlineTitle, setInlineTitle] = useState<InlineTitleState | null>(null)
  const [contextMenu, setContextMenu] = useState<TaskContextMenuState | null>(null)
  const [taskDrag, setTaskDrag] = useState<TaskDragState | null>(null)
  const pendingTaskDragRef = useRef<PendingTaskDragState | null>(null)
  const taskDragRef = useRef<TaskDragState | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const scheduledTasks = useMemo(() => tasks.filter(hasSchedule), [tasks])
  const layoutsByDay = useMemo(() => {
    return weekDays.map((_, dayIndex) => layoutDayTasks(scheduledTasks.filter((task) => task.schedule.weekday === dayIndex)))
  }, [scheduledTasks])
  const todayIndex = currentWeekdayIndex()
  const editorColorId = editor
    ? editor.schedule.colorId ?? defaultColorIdForWeekday(editor.schedule.weekday)
    : null
  const contextMenuTask = contextMenu ? scheduledTasks.find((task) => task.id === contextMenu.taskId) ?? null : null
  const draggedTaskColor = taskDrag ? getScheduleColor(taskDrag.previewSchedule) : null

  const clearLongPressTimer = (): void => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const setActiveTaskDrag = (nextDrag: TaskDragState | null): void => {
    taskDragRef.current = nextDrag
    setTaskDrag(nextDrag)
  }

  const updateActiveTaskDrag = (clientX: number, clientY: number): TaskDragState | null => {
    const current = taskDragRef.current
    if (!current) return null
    const previewSchedule = createTaskDragSchedule(
      current.originSchedule,
      clientX,
      clientY,
      current.grabOffsetMinutes,
      current.durationMinutes
    ) ?? current.previewSchedule
    const nextDrag = { ...current, clientX, clientY, previewSchedule }
    setActiveTaskDrag(nextDrag)
    return nextDrag
  }

  const beginTaskDragFromPending = (): void => {
    const pending = pendingTaskDragRef.current
    if (!pending) return
    longPressTimerRef.current = null
    const rect = pending.element.getBoundingClientRect()
    const durationMinutes = clamp(
      pending.task.schedule.endMinutes - pending.task.schedule.startMinutes,
      selectionStepMinutes,
      minutesPerDay
    )
    const previewSchedule = createTaskDragSchedule(
      pending.task.schedule,
      pending.clientX,
      pending.clientY,
      pending.grabOffsetMinutes,
      durationMinutes
    ) ?? withDefaultScheduleColor(pending.task.schedule)
    setEditor(null)
    setInlineTitle(null)
    setDraftTask(null)
    setDraftError('')
    setContextMenu(null)
    setHover(null)
    setSelection(null)
    setActiveTaskDrag({
      taskId: pending.task.id,
      title: pending.task.title,
      done: pending.task.done,
      pointerId: pending.pointerId,
      originSchedule: pending.task.schedule,
      previewSchedule,
      durationMinutes,
      grabOffsetX: pending.grabOffsetX,
      grabOffsetY: pending.grabOffsetY,
      grabOffsetMinutes: pending.grabOffsetMinutes,
      clientX: pending.clientX,
      clientY: pending.clientY,
      width: rect.width,
      height: rect.height
    })
  }

  useEffect(() => {
    if (!contextMenu) return undefined
    const closeMenu = (): void => setContextMenu(null)
    const closeMenuWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', closeMenuWithKeyboard)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', closeMenuWithKeyboard)
      window.removeEventListener('resize', closeMenu)
    }
  }, [contextMenu])

  useEffect(() => {
    return () => clearLongPressTimer()
  }, [])

  const openAddEditor = (schedule = createDefaultSchedule()): void => {
    setDraftTask(null)
    setInlineTitle(null)
    setEditorError('')
    setEditor({ mode: 'add', title: '', schedule: withDefaultScheduleColor(schedule) })
  }

  const openEditEditor = (task: ScheduledStudyTask): void => {
    setDraftTask(null)
    setInlineTitle(null)
    setEditorError('')
    setEditor({
      mode: 'edit',
      taskId: task.id,
      title: task.title,
      done: task.done,
      schedule: withDefaultScheduleColor(task.schedule)
    })
  }

  const closeEditor = (): void => {
    setEditor(null)
    setEditorError('')
  }

  const updateEditorSchedule = (patch: Partial<StudyTaskScheduleInput>): void => {
    setEditor((current) => {
      if (!current) return current
      const nextSchedule = { ...current.schedule, ...patch }
      if (nextSchedule.endMinutes <= nextSchedule.startMinutes) {
        nextSchedule.endMinutes = Math.min(minutesPerDay, nextSchedule.startMinutes + 60)
      }
      return { ...current, schedule: nextSchedule }
    })
  }

  const handleEditorSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!editor) return
    const title = editor.title.trim()
    if (!title) {
      setEditorError('先写下任务名称')
      return
    }
    if (editor.schedule.endMinutes <= editor.schedule.startMinutes) {
      setEditorError('结束时间需要晚于开始时间')
      return
    }
    const saved = editor.mode === 'add'
      ? onAddScheduledTask(title, editor.schedule)
      : onUpdateTask(editor.taskId, {
          title,
          done: editor.done,
          schedule: editor.schedule
        })
    if (saved) closeEditor()
  }

  const handleDraftSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!draftTask) return
    const title = draftTask.title.trim()
    if (!title) {
      setDraftError('先写下任务名称')
      return
    }
    if (onAddScheduledTask(title, draftTask.schedule)) {
      setDraftTask(null)
      setDraftError('')
    }
  }

  const beginInlineTitleEdit = (task: ScheduledStudyTask): void => {
    setEditor(null)
    setDraftTask(null)
    setInlineTitle({ taskId: task.id, title: task.title })
  }

  const commitInlineTitle = (taskId: string): void => {
    if (!inlineTitle || inlineTitle.taskId !== taskId) return
    const nextTitle = inlineTitle.title.trim()
    setInlineTitle(null)
    if (nextTitle) onUpdateTask(taskId, { title: nextTitle })
  }

  const handleTaskKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, task: ScheduledStudyTask): void => {
    if (inlineTitle?.taskId === task.id) return
    if (event.key === 'Enter') {
      event.preventDefault()
      openEditEditor(task)
      return
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      onToggleTask(task.id)
    }
  }

  const clearDayHover = (dayIndex: number): void => {
    setHover((current) => current?.dayIndex === dayIndex ? null : current)
  }

  const openTaskContextMenu = (event: ReactMouseEvent<HTMLDivElement>, task: ScheduledStudyTask): void => {
    event.preventDefault()
    event.stopPropagation()
    clearLongPressTimer()
    pendingTaskDragRef.current = null
    const menuWidth = 148
    const menuHeight = 92
    setContextMenu({
      taskId: task.id,
      x: clamp(event.clientX, 8, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: clamp(event.clientY, 8, Math.max(8, window.innerHeight - menuHeight - 8))
    })
  }

  const editTaskFromContextMenu = (task: ScheduledStudyTask): void => {
    setContextMenu(null)
    openEditEditor(task)
  }

  const removeTaskFromSchedule = (taskId: string): void => {
    clearLongPressTimer()
    pendingTaskDragRef.current = null
    if (taskDragRef.current?.taskId === taskId) setActiveTaskDrag(null)
    setContextMenu(null)
    setInlineTitle((current) => current?.taskId === taskId ? null : current)
    setEditor((current) => current?.mode === 'edit' && current.taskId === taskId ? null : current)
    onRemoveTask(taskId)
  }

  const handleTaskPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    task: ScheduledStudyTask,
    dayIndex: number
  ): void => {
    if (event.button !== 0 || inlineTitle?.taskId === task.id) {
      event.stopPropagation()
      return
    }
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button, input, select, textarea, form')) {
      event.stopPropagation()
      return
    }
    event.stopPropagation()
    setContextMenu(null)
    clearDayHover(dayIndex)
    clearLongPressTimer()
    const rect = event.currentTarget.getBoundingClientRect()
    pendingTaskDragRef.current = {
      task,
      element: event.currentTarget,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      grabOffsetX: event.clientX - rect.left,
      grabOffsetY: event.clientY - rect.top,
      grabOffsetMinutes: clamp(event.clientY - rect.top, 0, rect.height) / Math.max(1, rect.height)
        * (task.schedule.endMinutes - task.schedule.startMinutes)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    longPressTimerRef.current = window.setTimeout(beginTaskDragFromPending, 360)
  }

  const handleTaskPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
    task: ScheduledStudyTask,
    dayIndex: number
  ): void => {
    event.stopPropagation()
    const pending = pendingTaskDragRef.current
    if (pending?.task.id === task.id && pending.pointerId === event.pointerId) {
      pending.clientX = event.clientX
      pending.clientY = event.clientY
    }
    const activeDrag = taskDragRef.current
    if (activeDrag?.taskId === task.id && activeDrag.pointerId === event.pointerId) {
      event.preventDefault()
      updateActiveTaskDrag(event.clientX, event.clientY)
      return
    }
    clearDayHover(dayIndex)
  }

  const finishTaskPointerDrag = (event: ReactPointerEvent<HTMLDivElement>, taskId: string): void => {
    event.stopPropagation()
    clearLongPressTimer()
    pendingTaskDragRef.current = null
    const activeDrag = taskDragRef.current
    if (activeDrag?.taskId === taskId && activeDrag.pointerId === event.pointerId) {
      event.preventDefault()
      const finalDrag = updateActiveTaskDrag(event.clientX, event.clientY) ?? activeDrag
      onUpdateTask(taskId, { schedule: finalDrag.previewSchedule })
      setActiveTaskDrag(null)
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const cancelTaskPointerDrag = (event: ReactPointerEvent<HTMLDivElement>, taskId: string): void => {
    event.stopPropagation()
    clearLongPressTimer()
    pendingTaskDragRef.current = null
    if (taskDragRef.current?.taskId === taskId) setActiveTaskDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleColumnPointerMove = (dayIndex: number, event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.study-schedule-event, .study-schedule-draft-card') && selection?.pointerId !== event.pointerId) {
      clearDayHover(dayIndex)
      return
    }
    const minutes = getMinutesFromPointer(event.currentTarget, event.clientY)
    setHover({ dayIndex, minutes })
    setSelection((current) => {
      if (!current || current.dayIndex !== dayIndex || current.pointerId !== event.pointerId) return current
      return { ...current, currentMinutes: minutes }
    })
  }

  const handleColumnPointerDown = (dayIndex: number, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.study-schedule-event, .study-schedule-draft-card')) return
    const minutes = getMinutesFromPointer(event.currentTarget, event.clientY)
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setEditor(null)
    setInlineTitle(null)
    setDraftTask(null)
    setDraftError('')
    setHover({ dayIndex, minutes })
    setSelection({ dayIndex, anchorMinutes: minutes, currentMinutes: minutes, pointerId: event.pointerId })
  }

  const handleColumnPointerUp = (dayIndex: number, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!selection || selection.dayIndex !== dayIndex || selection.pointerId !== event.pointerId) return
    const minutes = getMinutesFromPointer(event.currentTarget, event.clientY)
    const schedule = createSelectionSchedule(dayIndex, selection.anchorMinutes, minutes, true)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setSelection(null)
    if (schedule) {
      setEditor(null)
      setInlineTitle(null)
      setDraftTask({ title: '', schedule })
      setDraftError('')
    }
  }

  const handleColumnPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setSelection(null)
  }

  const handleColumnPointerLeave = (dayIndex: number): void => {
    if (selection?.dayIndex === dayIndex) return
    setHover((current) => current?.dayIndex === dayIndex ? null : current)
  }

  return (
    <div className="study-schedule-page" aria-labelledby={titleId}>
      <header className="study-schedule-header">
        <button type="button" className="study-schedule-back" onClick={onBack} aria-label="返回自习室">
          <ArrowLeft size={18} />
        </button>
        <div className="study-schedule-title">
          <span><CalendarDays size={15} /> 任务详情</span>
          <h1 id={titleId}>一周任务表</h1>
        </div>
        <div className="study-schedule-stats" aria-label="任务统计">
          <div className="study-schedule-stat-card study-schedule-stat-card--pending">
            <button
              type="button"
              className="study-schedule-stat-add-button"
              onClick={() => openAddEditor()}
              aria-label="添加任务"
              title="添加任务"
            >
              <Plus size={16} />
            </button>
            <span><strong>{openTasks}</strong>待完成</span>
          </div>
          <div className="study-schedule-stat-card"><span><strong>{completedTasks}</strong>已完成</span></div>
          <div className="study-schedule-stat-card"><span><strong>{scheduledTasks.length}</strong>已排期</span></div>
        </div>
      </header>

      <div className="study-schedule-board" role="grid" aria-label="一周 0 点到 24 点任务表">
        <div className="study-schedule-corner" aria-hidden="true">
          <Clock3 size={14} />
        </div>
        {weekDays.map((day, index) => (
          <div key={day} className={`study-schedule-day-head${index === todayIndex ? ' is-today' : ''}`} role="columnheader">
            <span>{day}</span>
            <strong>{layoutsByDay[index]?.length ?? 0}</strong>
          </div>
        ))}
        <div className="study-schedule-time-rail" aria-hidden="true">
          {hourMarks.map((hour) => (
            <span
              key={hour}
              className="study-schedule-hour-label"
              style={{ '--hour-ratio': hour / 24 } as NumberVarStyle<'--hour-ratio'>}
            >
              {formatHour(hour)}
            </span>
          ))}
        </div>
        {weekDays.map((day, dayIndex) => {
          const selectionSchedule = selection?.dayIndex === dayIndex
            ? createSelectionSchedule(dayIndex, selection.anchorMinutes, selection.currentMinutes)
            : null
          return (
            <div
              key={day}
              className="study-schedule-day-column"
              data-day-index={dayIndex}
              role="gridcell"
              aria-label={day}
              onPointerMove={(event) => handleColumnPointerMove(dayIndex, event)}
              onPointerDown={(event) => handleColumnPointerDown(dayIndex, event)}
              onPointerUp={(event) => handleColumnPointerUp(dayIndex, event)}
              onPointerCancel={handleColumnPointerCancel}
              onPointerLeave={() => handleColumnPointerLeave(dayIndex)}
            >
              {hover?.dayIndex === dayIndex ? (
                <div
                  className={`study-schedule-hover-line${hover.minutes >= 23 * 60 + 30 ? ' is-late' : ''}`}
                  style={{ '--hover-ratio': hover.minutes / minutesPerDay } as HoverVarStyle}
                  aria-hidden="true"
                >
                  <span>{formatMinutes(hover.minutes)}</span>
                </div>
              ) : null}
              {selectionSchedule ? (
                <div
                  className="study-schedule-selection"
                  style={createRangeStyle(selectionSchedule.startMinutes, selectionSchedule.endMinutes)}
                  aria-hidden="true"
                >
                  <span>{formatMinutes(selectionSchedule.startMinutes)}-{formatMinutes(selectionSchedule.endMinutes)}</span>
                </div>
              ) : null}
              {draftTask?.schedule.weekday === dayIndex ? (
                <form
                  className="study-schedule-draft-card"
                  style={createRangeStyle(draftTask.schedule.startMinutes, draftTask.schedule.endMinutes)}
                  onSubmit={handleDraftSubmit}
                  onPointerEnter={() => clearDayHover(dayIndex)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerMove={(event) => {
                    event.stopPropagation()
                    clearDayHover(dayIndex)
                  }}
                >
                  <span>{formatMinutes(draftTask.schedule.startMinutes)}-{formatMinutes(draftTask.schedule.endMinutes)}</span>
                  <input
                    value={draftTask.title}
                    onChange={(event) => {
                      setDraftTask((current) => current ? { ...current, title: event.target.value } : current)
                      setDraftError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setDraftTask(null)
                    }}
                    placeholder="任务名称"
                    maxLength={80}
                    autoFocus
                  />
                  <div className="study-schedule-draft-actions">
                    <button type="submit" aria-label="保存任务">
                      <Check size={13} />
                    </button>
                    <button type="button" onClick={() => setDraftTask(null)} aria-label="取消">
                      <X size={13} />
                    </button>
                  </div>
                  {draftError ? <small role="status">{draftError}</small> : null}
                </form>
              ) : null}
              {taskDrag?.previewSchedule.weekday === dayIndex ? (
                <div
                  className="study-schedule-drag-preview"
                  style={createRangeStyle(taskDrag.previewSchedule.startMinutes, taskDrag.previewSchedule.endMinutes)}
                  aria-hidden="true"
                >
                  <span>{formatMinutes(taskDrag.previewSchedule.startMinutes)}-{formatMinutes(taskDrag.previewSchedule.endMinutes)}</span>
                </div>
              ) : null}
              {layoutsByDay[dayIndex]?.map(({ task, lane, lanes }) => {
                const color = getScheduleColor(task.schedule)
                const widthPercent = 100 / lanes
                const leftPercent = lane * widthPercent
                const editingTitle = inlineTitle?.taskId === task.id
                const draggingThisTask = taskDrag?.taskId === task.id
                return (
                  <div
                    key={task.id}
                    className={`study-schedule-event${task.done ? ' is-done' : ''}${editingTitle ? ' is-editing-title' : ''}${draggingThisTask ? ' is-drag-source' : ''}`}
                    role="button"
                    tabIndex={0}
                    onDoubleClick={() => openEditEditor(task)}
                    onContextMenu={(event) => openTaskContextMenu(event, task)}
                    onKeyDown={(event) => handleTaskKeyDown(event, task)}
                    onPointerEnter={() => clearDayHover(dayIndex)}
                    onPointerDown={(event) => handleTaskPointerDown(event, task, dayIndex)}
                    onPointerMove={(event) => handleTaskPointerMove(event, task, dayIndex)}
                    onPointerUp={(event) => finishTaskPointerDrag(event, task.id)}
                    onPointerCancel={(event) => cancelTaskPointerDrag(event, task.id)}
                    aria-label={`${day} ${formatMinutes(task.schedule.startMinutes)} 到 ${formatMinutes(task.schedule.endMinutes)}，${task.title}`}
                    style={{
                      '--event-start-ratio': task.schedule.startMinutes / minutesPerDay,
                      '--event-duration-ratio': (task.schedule.endMinutes - task.schedule.startMinutes) / minutesPerDay,
                      '--event-left': `calc(${leftPercent}% + 4px)`,
                      '--event-width': `calc(${widthPercent}% - 8px)`,
                      '--event-color': color.color,
                      '--event-ink': color.ink
                    } as EventVarStyle}
                  >
                    <span className="study-schedule-event-time">
                      {formatMinutes(task.schedule.startMinutes)}-{formatMinutes(task.schedule.endMinutes)}
                    </span>
                    {editingTitle ? (
                      <form
                        className="study-schedule-inline-title-form"
                        onSubmit={(event) => {
                          event.preventDefault()
                          commitInlineTitle(task.id)
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <input
                          value={inlineTitle.title}
                          onChange={(event) => {
                            setInlineTitle((current) => current?.taskId === task.id
                              ? { ...current, title: event.target.value }
                              : current)
                          }}
                          onBlur={() => commitInlineTitle(task.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setInlineTitle(null)
                            }
                          }}
                          maxLength={80}
                          autoFocus
                        />
                      </form>
                    ) : (
                      <strong
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          beginInlineTitleEdit(task)
                        }}
                      >
                        {task.title}
                      </strong>
                    )}
                    <div className="study-schedule-event-status">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onToggleTask(task.id)
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        aria-pressed={task.done}
                        aria-label={task.done ? '标记为待完成' : '标记为已完成'}
                      >
                        {task.done ? <Check size={11} /> : null}
                      </button>
                      <span>{task.done ? '已完成' : '待完成'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {taskDrag && draggedTaskColor ? (
        <div
          className="study-schedule-drag-float"
          style={{
            left: taskDrag.clientX - taskDrag.grabOffsetX,
            top: taskDrag.clientY - taskDrag.grabOffsetY - 8,
            width: taskDrag.width,
            minHeight: taskDrag.height,
            '--event-color': draggedTaskColor.color,
            '--event-ink': draggedTaskColor.ink
          } as TaskColorVarStyle}
          aria-hidden="true"
        >
          <span className="study-schedule-event-time">
            {formatMinutes(taskDrag.previewSchedule.startMinutes)}-{formatMinutes(taskDrag.previewSchedule.endMinutes)}
          </span>
          <strong>{taskDrag.title}</strong>
          <span>{taskDrag.done ? '已完成' : '待完成'}</span>
        </div>
      ) : null}

      {contextMenu && contextMenuTask ? (
        <div
          className="study-schedule-context-menu"
          role="menu"
          aria-label={`${contextMenuTask.title} 操作`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => editTaskFromContextMenu(contextMenuTask)}>
            <PencilLine size={14} />
            编辑
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => removeTaskFromSchedule(contextMenuTask.id)}
          >
            <Trash2 size={14} />
            移除
          </button>
        </div>
      ) : null}

      {editor ? (
        <div
          className="study-schedule-editor-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor()
          }}
        >
          <form
            className="study-schedule-editor-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={editorTitleId}
            onSubmit={handleEditorSubmit}
          >
            <div className="study-schedule-editor-head">
              <div>
                <span>{editor.mode === 'add' ? <Plus size={15} /> : <PencilLine size={15} />}{editor.mode === 'add' ? '添加任务' : '编辑任务'}</span>
                <h2 id={editorTitleId}>{weekDays[editor.schedule.weekday]} {formatMinutes(editor.schedule.startMinutes)}-{formatMinutes(editor.schedule.endMinutes)}</h2>
              </div>
              <button type="button" className="study-schedule-editor-close" onClick={closeEditor} aria-label="关闭">
                <X size={16} />
              </button>
            </div>

            <label>
              <span>任务</span>
              <input
                value={editor.title}
                onChange={(event) => {
                  setEditor((current) => current ? { ...current, title: event.target.value } : current)
                  setEditorError('')
                }}
                placeholder="例如：复盘线性代数错题"
                maxLength={80}
                autoFocus
              />
            </label>
            <div className="study-schedule-editor-grid">
              <label>
                <span>星期</span>
                <select
                  value={editor.schedule.weekday}
                  onChange={(event) => updateEditorSchedule({ weekday: Number(event.target.value) })}
                >
                  {weekDays.map((day, index) => (
                    <option key={day} value={index}>{day}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>开始</span>
                <select
                  value={editor.schedule.startMinutes}
                  onChange={(event) => {
                    const nextStart = Number(event.target.value)
                    updateEditorSchedule({
                      startMinutes: nextStart,
                      endMinutes: editor.schedule.endMinutes <= nextStart
                        ? Math.min(minutesPerDay, nextStart + 60)
                        : editor.schedule.endMinutes
                    })
                  }}
                >
                  {startTimeOptions.map((minutes) => (
                    <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>结束</span>
                <select
                  value={editor.schedule.endMinutes}
                  onChange={(event) => updateEditorSchedule({ endMinutes: Number(event.target.value) })}
                >
                  {endTimeOptions.map((minutes) => (
                    <option key={minutes} value={minutes} disabled={minutes <= editor.schedule.startMinutes}>
                      {formatMinutes(minutes)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="study-schedule-editor-colors">
              <span>配色</span>
              <div className="study-schedule-color-swatches" aria-label="卡片配色">
                {morandiTaskColors.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    className={`study-schedule-color-swatch${editorColorId === color.id ? ' is-selected' : ''}`}
                    style={{
                      '--schedule-swatch-color': color.color,
                      '--schedule-swatch-ink': color.ink
                    } as ColorSwatchVarStyle}
                    aria-pressed={editorColorId === color.id}
                    title={color.name}
                    onClick={() => updateEditorSchedule({ colorId: color.id })}
                  >
                    <span aria-hidden="true" />
                    <em>{color.name}</em>
                  </button>
                ))}
              </div>
            </div>
            {editor.mode === 'edit' ? (
              <label className="study-schedule-editor-check">
                <input
                  type="checkbox"
                  checked={editor.done}
                  onChange={(event) => {
                    setEditor((current) => current && current.mode === 'edit'
                      ? { ...current, done: event.target.checked }
                      : current)
                  }}
                />
                <span>已完成</span>
              </label>
            ) : null}
            <div className="study-schedule-editor-status" role="status" aria-live="polite">
              {editorError}
            </div>
            <div className="study-schedule-editor-actions">
              <button type="button" className="study-schedule-secondary-button" onClick={closeEditor}>取消</button>
              <button type="submit" className="study-schedule-primary-button">
                <Check size={15} />
                {editor.mode === 'add' ? '添加' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
