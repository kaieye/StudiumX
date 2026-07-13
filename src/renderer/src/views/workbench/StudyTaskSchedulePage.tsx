import { ArrowLeft, CalendarDays, Check, ChevronDown, Clock3, PencilLine, Plus, Trash2, X } from 'lucide-react'
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
  StudyTaskCategory,
  StudyTaskCategoryId,
  StudyTaskSchedule,
  StudyTaskScheduleInput,
  StudyTaskUpdateInput
} from '../../study-space/types'
import {
  addStudyTaskCategory,
  getReadableCategoryInk,
  listStudyTaskCategories,
  persistStudyTaskCategories,
  removeStudyTaskCategory,
  resolveStudyTaskCategory,
  updateStudyTaskCategory
} from '../../study-space/taskCategories'
import {
  MINUTES_PER_DAY,
  canUseScheduleTime,
  chooseAllowedMinute,
  clamp,
  clampScheduleDuration,
  createDefaultSchedule,
  createScheduleTaskProposal,
  createSelectionSchedule,
  currentWeekdayIndex,
  formatScheduleMinutes,
  getPointerGrabOffsetMinutes,
  getTimeParts,
  parseTimePart,
  patchSchedule,
  projectDayPointer,
  projectTaskDragSchedule,
  validateTimeFields,
  type SchedulePointerProjection
} from './study-task-schedule-interaction'
import { layoutDayTasks, type ScheduledStudyTask } from './study-task-schedule-layout'

type StudyTaskSchedulePageProps = {
  tasks: StudyTask[]
  openTasks: number
  completedTasks: number
  onAddScheduledTask: (title: string, schedule: StudyTaskScheduleInput, categoryId?: StudyTaskCategoryId | null) => boolean
  onUpdateTask: (taskId: string, update: StudyTaskUpdateInput) => boolean
  onToggleTask: (taskId: string) => void
  onRemoveTask: (taskId: string) => void
  onBack: () => void
}

type TaskEditorState =
  | { mode: 'add'; title: string; categoryId: StudyTaskCategoryId; schedule: StudyTaskScheduleInput }
  | { mode: 'edit'; taskId: string; title: string; done: boolean; categoryId: StudyTaskCategoryId; schedule: StudyTaskScheduleInput }

type DraftTaskState = {
  title: string
  categoryId: StudyTaskCategoryId
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

type CategoryContextMenuState = {
  categoryId: StudyTaskCategoryId
  categoryName: string
  x: number
  y: number
}

type CategorySwatchVarStyle = CSSProperties & Record<'--category-swatch-color' | '--category-swatch-ink', string>

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
  categoryId: StudyTaskCategoryId
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
type TaskColorVarStyle = CSSProperties & Record<'--event-color' | '--event-ink', string>

type TimePart = 'hour' | 'minute'

type TimeSelectProps = {
  value: number
  minMinutes: number
  maxMinutes: number
  onChange: (minutes: number) => void
  disabledOption?: (minutes: number) => boolean
  ariaLabel: string
}

const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const hourMarks = [0, 4, 8, 12, 16, 20, 24]
const minutePartOptions = Array.from({ length: 60 }, (_, minute) => minute)

const defaultCategoryDraftColor: `#${string}` = '#6f8fa8'
const maxCategoryNameLength = 16

function categoryBadgeStyle(category: StudyTaskCategory): CategorySwatchVarStyle {
  return {
    '--category-swatch-color': category.color,
    '--category-swatch-ink': getReadableCategoryInk(category.color)
  }
}

function resolveTaskCategory(
  categoryId: StudyTaskCategoryId | undefined | null,
  categories: StudyTaskCategory[]
): StudyTaskCategory {
  return resolveStudyTaskCategory(categoryId, categories)
    ?? resolveStudyTaskCategory('study', categories)!
}

function hasSchedule(task: StudyTask): task is ScheduledStudyTask {
  return Boolean(task.schedule)
}

function formatHour(hour: number): string {
  return `${hour}:00`
}

function createRangeStyle(startMinutes: number, endMinutes: number): RangeVarStyle {
  return {
    '--range-start-ratio': startMinutes / MINUTES_PER_DAY,
    '--range-duration-ratio': (endMinutes - startMinutes) / MINUTES_PER_DAY
  }
}

function TimeSelect({ value, minMinutes, maxMinutes, onChange, disabledOption, ariaLabel }: TimeSelectProps) {
  const valueParts = getTimeParts(value)
  const [openPart, setOpenPart] = useState<TimePart | null>(null)
  const [hourDraft, setHourDraft] = useState(() => String(valueParts.hour).padStart(2, '0'))
  const [minuteDraft, setMinuteDraft] = useState(() => String(valueParts.minute).padStart(2, '0'))
  const [invalid, setInvalid] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hourInputRef = useRef<HTMLInputElement | null>(null)
  const minuteInputRef = useRef<HTMLInputElement | null>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  const listboxBaseId = useId()
  const hourOptions = Array.from({ length: Math.floor(maxMinutes / 60) + 1 }, (_, hour) => hour)
  const parsedDraftHour = parseTimePart(hourDraft, 24)
  const parsedDraftMinute = parseTimePart(minuteDraft, 59)

  const setValidation = (message: string): void => {
    const hasError = message.length > 0
    setInvalid(hasError)
    hourInputRef.current?.setCustomValidity(message)
    minuteInputRef.current?.setCustomValidity(message)
  }

  const timePolicy = { minMinutes, maxMinutes, isDisabled: disabledOption }

  const isAllowedTime = (hour: number, minute: number): boolean => canUseScheduleTime(hour, minute, timePolicy)

  const applyTimeIfValid = (nextHourDraft: string, nextMinuteDraft: string): boolean => {
    const validation = validateTimeFields(nextHourDraft, nextMinuteDraft, timePolicy)
    if (!validation.valid) return false
    setValidation('')
    if (validation.minutes !== value) onChange(validation.minutes)
    return true
  }

  const commitDraft = (): boolean => {
    const validation = validateTimeFields(hourDraft, minuteDraft, timePolicy)
    if (!validation.valid) {
      setValidation(validation.message)
      return false
    }
    const nextParts = getTimeParts(validation.minutes)
    setHourDraft(String(nextParts.hour).padStart(2, '0'))
    setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
    setValidation('')
    if (validation.minutes !== value) onChange(validation.minutes)
    return true
  }

  const resetDraft = (): void => {
    const nextParts = getTimeParts(value)
    setHourDraft(String(nextParts.hour).padStart(2, '0'))
    setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
    setValidation('')
  }

  useEffect(() => {
    const nextParts = getTimeParts(value)
    setHourDraft(String(nextParts.hour).padStart(2, '0'))
    setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
    setInvalid(false)
    hourInputRef.current?.setCustomValidity('')
    minuteInputRef.current?.setCustomValidity('')
  }, [value])

  useEffect(() => {
    if (!openPart) return undefined
    const closeFromOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenPart(null)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpenPart(null)
      const nextParts = getTimeParts(value)
      setHourDraft(String(nextParts.hour).padStart(2, '0'))
      setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
      setInvalid(false)
      hourInputRef.current?.setCustomValidity('')
      minuteInputRef.current?.setCustomValidity('')
      const input = openPart === 'hour' ? hourInputRef.current : minuteInputRef.current
      input?.focus()
    }
    window.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeFromKeyboard)
    window.requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: 'nearest' }))
    return () => {
      window.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [openPart, value])

  const handlePartChange = (part: TimePart, rawValue: string): void => {
    const nextValue = rawValue.replace(/\D/g, '').slice(0, 2)
    const nextHourDraft = part === 'hour' ? nextValue : hourDraft
    const nextMinuteDraft = part === 'minute' ? nextValue : minuteDraft
    if (part === 'hour') setHourDraft(nextValue)
    else setMinuteDraft(nextValue)
    setValidation('')
    applyTimeIfValid(nextHourDraft, nextMinuteDraft)
    setOpenPart(part)
  }

  const handlePartKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, part: TimePart): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpenPart(part)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (commitDraft()) setOpenPart(null)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      resetDraft()
      setOpenPart(null)
    }
  }

  const selectHour = (hour: number): void => {
    const preferredMinute = parsedDraftMinute ?? valueParts.minute
    const minute = chooseAllowedMinute(hour, preferredMinute, timePolicy)
    if (minute === null) return
    const nextHourDraft = String(hour).padStart(2, '0')
    const nextMinuteDraft = String(minute).padStart(2, '0')
    setHourDraft(nextHourDraft)
    setMinuteDraft(nextMinuteDraft)
    setValidation('')
    applyTimeIfValid(nextHourDraft, nextMinuteDraft)
    setOpenPart(null)
    hourInputRef.current?.focus()
  }

  const selectMinute = (minute: number): void => {
    const hour = parsedDraftHour ?? valueParts.hour
    if (!isAllowedTime(hour, minute)) return
    const nextHourDraft = String(hour).padStart(2, '0')
    const nextMinuteDraft = String(minute).padStart(2, '0')
    setHourDraft(nextHourDraft)
    setMinuteDraft(nextMinuteDraft)
    setValidation('')
    applyTimeIfValid(nextHourDraft, nextMinuteDraft)
    setOpenPart(null)
    minuteInputRef.current?.focus()
  }

  const renderPart = (part: TimePart) => {
    const isHour = part === 'hour'
    const draft = isHour ? hourDraft : minuteDraft
    const inputRef = isHour ? hourInputRef : minuteInputRef
    const partLabel = isHour ? '小时' : '分钟'
    const listboxId = `${listboxBaseId}-${part}`
    const partOpen = openPart === part
    const options = isHour ? hourOptions : minutePartOptions
    const selectedValue = isHour ? parsedDraftHour : parsedDraftMinute
    const activeHour = parsedDraftHour ?? valueParts.hour

    return (
      <div className={`study-schedule-time-part is-${part}${partOpen ? ' is-open' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          className="study-schedule-time-input"
          value={draft}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={2}
          required
          role="combobox"
          aria-label={`${ariaLabel}${partLabel}`}
          aria-haspopup="listbox"
          aria-expanded={partOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-invalid={invalid}
          placeholder={isHour ? '时' : '分'}
          title={`可直接输入${partLabel}，或从菜单中选择`}
          onFocus={(event) => event.currentTarget.select()}
          onClick={() => setOpenPart(part)}
          onChange={(event) => handlePartChange(part, event.currentTarget.value)}
          onInvalid={() => setInvalid(true)}
          onKeyDown={(event) => handlePartKeyDown(event, part)}
          onBlur={(event) => {
            if (rootRef.current?.contains(event.relatedTarget as Node | null)) return
            commitDraft()
            setOpenPart(null)
          }}
        />
        <button
          type="button"
          className="study-schedule-time-toggle"
          aria-label={`${partOpen ? '收起' : '展开'}${ariaLabel}${partLabel}菜单`}
          aria-haspopup="listbox"
          aria-expanded={partOpen}
          aria-controls={listboxId}
          onClick={() => {
            const nextOpen = partOpen ? null : part
            setOpenPart(nextOpen)
            if (nextOpen) window.requestAnimationFrame(() => inputRef.current?.focus())
          }}
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {partOpen ? (
          <div
            id={listboxId}
            className={`study-schedule-time-part-menu is-${part}`}
            role="listbox"
            aria-label={`${ariaLabel}${partLabel}候选`}
          >
            <span>{partLabel}</span>
            <div>
              {options.map((option) => {
                const disabled = isHour
                  ? !minutePartOptions.some((minute) => isAllowedTime(option, minute))
                  : !isAllowedTime(activeHour, option)
                const selected = option === selectedValue
                return (
                  <button
                    key={option}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={disabled}
                    className={selected ? 'is-selected' : ''}
                    onClick={() => isHour ? selectHour(option) : selectMinute(option)}
                  >
                    {String(option).padStart(2, '0')}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`study-schedule-time-select${openPart ? ' is-open' : ''}${invalid ? ' is-invalid' : ''}`}>
      <div className="study-schedule-time-control">
        <Clock3 size={14} aria-hidden="true" />
        {renderPart('hour')}
        <span className="study-schedule-time-separator" aria-hidden="true">:</span>
        {renderPart('minute')}
      </div>
    </div>
  )
}

function getScheduleColumnFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const pointElement = document.elementFromPoint(clientX, clientY)
  return pointElement instanceof Element ? pointElement.closest<HTMLElement>('.study-schedule-day-column') : null
}

function getColumnDayIndex(column: HTMLElement): number | null {
  const dayIndex = Number(column.dataset.dayIndex)
  return Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex < weekDays.length ? dayIndex : null
}

function projectColumnPointer(column: HTMLElement, clientY: number): SchedulePointerProjection | null {
  const dayIndex = getColumnDayIndex(column)
  if (dayIndex === null) return null
  const rect = column.getBoundingClientRect()
  return projectDayPointer(dayIndex, { top: rect.top, height: rect.height }, clientY)
}

function projectViewportPointer(clientX: number, clientY: number): SchedulePointerProjection | null {
  const column = getScheduleColumnFromPoint(clientX, clientY)
  return column ? projectColumnPointer(column, clientY) : null
}

function projectDayColumnPointer(
  dayIndex: number,
  element: HTMLDivElement,
  clientY: number
): SchedulePointerProjection | null {
  const rect = element.getBoundingClientRect()
  return projectDayPointer(dayIndex, { top: rect.top, height: rect.height }, clientY)
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
  const [taskCategories, setTaskCategories] = useState<StudyTaskCategory[]>(() => listStudyTaskCategories())
  const [categoryContextMenu, setCategoryContextMenu] = useState<CategoryContextMenuState | null>(null)
  const [customCategoryName, setCustomCategoryName] = useState('')
  const [customCategoryColor, setCustomCategoryColor] = useState<`#${string}`>(defaultCategoryDraftColor)
  const [customCategoryError, setCustomCategoryError] = useState('')
  const pendingTaskDragRef = useRef<PendingTaskDragState | null>(null)
  const taskDragRef = useRef<TaskDragState | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const scheduledTasks = useMemo(() => tasks.filter(hasSchedule), [tasks])
  const layoutsByDay = useMemo(() => {
    return weekDays.map((_, dayIndex) => layoutDayTasks(scheduledTasks.filter((task) => task.schedule.weekday === dayIndex)))
  }, [scheduledTasks])
  const todayIndex = currentWeekdayIndex()
  const contextMenuTask = contextMenu ? scheduledTasks.find((task) => task.id === contextMenu.taskId) ?? null : null
  const draggedTaskCategory = taskDrag ? resolveTaskCategory(taskDrag.categoryId, taskCategories) : null

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
    const previewSchedule = projectTaskDragSchedule(
      current.originSchedule,
      projectViewportPointer(clientX, clientY),
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
    const durationMinutes = clampScheduleDuration(
      pending.task.schedule.endMinutes - pending.task.schedule.startMinutes
    )
    const previewSchedule = projectTaskDragSchedule(
      pending.task.schedule,
      projectViewportPointer(pending.clientX, pending.clientY),
      pending.grabOffsetMinutes,
      durationMinutes
    ) ?? pending.task.schedule
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
      categoryId: pending.task.categoryId ?? 'study',
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
    if (!categoryContextMenu) return undefined
    const closeMenu = (): void => setCategoryContextMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [categoryContextMenu])

  useEffect(() => {
    return () => clearLongPressTimer()
  }, [])

  const openAddEditor = (schedule = createDefaultSchedule()): void => {
    setDraftTask(null)
    setInlineTitle(null)
    setCategoryContextMenu(null)
    setEditorError('')
    setCustomCategoryError('')
    setEditor({ mode: 'add', ...createScheduleTaskProposal(schedule) })
  }

  const openEditEditor = (task: ScheduledStudyTask): void => {
    setDraftTask(null)
    setInlineTitle(null)
    setCategoryContextMenu(null)
    setEditorError('')
    setCustomCategoryError('')
    setEditor({
      mode: 'edit',
      taskId: task.id,
      title: task.title,
      done: task.done,
      categoryId: task.categoryId ?? 'study',
      schedule: task.schedule
    })
  }

  const closeEditor = (): void => {
    setEditor(null)
    setCategoryContextMenu(null)
    setEditorError('')
    setCustomCategoryError('')
  }

  const updateEditorSchedule = (patch: Partial<StudyTaskScheduleInput>): void => {
    setEditor((current) => {
      if (!current) return current
      return { ...current, schedule: patchSchedule(current.schedule, patch) }
    })
  }

  const updateEditorCategory = (categoryId: StudyTaskCategoryId): void => {
    setEditor((current) => current ? { ...current, categoryId } : current)
    setCustomCategoryError('')
  }

  const updateCategoryColor = (categoryId: StudyTaskCategoryId, color: `#${string}`): void => {
    const next = updateStudyTaskCategory(taskCategories, categoryId, { color })
    setTaskCategories(next)
    persistStudyTaskCategories(next)
  }

  const addCustomCategory = (): void => {
    const name = customCategoryName.trim()
    if (!name) {
      setCustomCategoryError('先写下类别名称')
      return
    }
    const result = addStudyTaskCategory(taskCategories, {
      name,
      color: customCategoryColor
    })
    if (!result.category) {
      setCustomCategoryError(taskCategories.filter((item) => !item.builtin).length >= 24
        ? '自定义类别已达上限'
        : '无法添加该类别')
      return
    }
    setTaskCategories(result.categories)
    persistStudyTaskCategories(result.categories)
    updateEditorCategory(result.category.id)
    setCustomCategoryName('')
    setCustomCategoryError('')
  }

  const openCategoryContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, category: StudyTaskCategory): void => {
    if (category.builtin) return
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 152
    const menuHeight = 48
    setCategoryContextMenu({
      categoryId: category.id,
      categoryName: category.name,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    })
  }

  const deleteCustomCategory = (categoryId: StudyTaskCategoryId): void => {
    const next = removeStudyTaskCategory(taskCategories, categoryId)
    setTaskCategories(next)
    persistStudyTaskCategories(next)
    tasks.forEach((task) => {
      if (task.categoryId === categoryId) onUpdateTask(task.id, { categoryId: 'study' })
    })
    if (editor?.categoryId === categoryId) updateEditorCategory('study')
    setCategoryContextMenu(null)
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
      ? onAddScheduledTask(title, editor.schedule, editor.categoryId)
      : onUpdateTask(editor.taskId, {
          title,
          done: editor.done,
          categoryId: editor.categoryId,
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
    if (onAddScheduledTask(title, draftTask.schedule, draftTask.categoryId)) {
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
      grabOffsetMinutes: getPointerGrabOffsetMinutes(
        { top: rect.top, height: rect.height },
        event.clientY,
        task.schedule.endMinutes - task.schedule.startMinutes
      )
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
    const pointer = projectDayColumnPointer(dayIndex, event.currentTarget, event.clientY)
    if (!pointer) return
    const { minutes } = pointer
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
    const pointer = projectDayColumnPointer(dayIndex, event.currentTarget, event.clientY)
    if (!pointer) return
    const { minutes } = pointer
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
    const pointer = projectDayColumnPointer(dayIndex, event.currentTarget, event.clientY)
    if (!pointer) return
    const schedule = createSelectionSchedule(dayIndex, selection.anchorMinutes, pointer.minutes, true)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setSelection(null)
    if (schedule) {
      setEditor(null)
      setInlineTitle(null)
      setDraftTask(createScheduleTaskProposal(schedule))
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
          <h1 id={titleId}><CalendarDays size={17} /> 任务详情</h1>
        </div>
        <div className="study-schedule-stats" aria-label="任务统计">
          <button
            type="button"
            className="study-schedule-stat-add-button"
            onClick={() => openAddEditor()}
            aria-label="添加任务"
            title="添加任务"
          >
            <Plus size={18} />
          </button>
          <div className="study-schedule-stat-card study-schedule-stat-card--pending">
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
                  style={{ '--hover-ratio': hover.minutes / MINUTES_PER_DAY } as HoverVarStyle}
                  aria-hidden="true"
                >
                  <span>{formatScheduleMinutes(hover.minutes)}</span>
                </div>
              ) : null}
              {selectionSchedule ? (
                <div
                  className="study-schedule-selection"
                  style={createRangeStyle(selectionSchedule.startMinutes, selectionSchedule.endMinutes)}
                  aria-hidden="true"
                >
                  <span>{formatScheduleMinutes(selectionSchedule.startMinutes)}-{formatScheduleMinutes(selectionSchedule.endMinutes)}</span>
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
                  <span>{formatScheduleMinutes(draftTask.schedule.startMinutes)}-{formatScheduleMinutes(draftTask.schedule.endMinutes)}</span>
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
                  <span>{formatScheduleMinutes(taskDrag.previewSchedule.startMinutes)}-{formatScheduleMinutes(taskDrag.previewSchedule.endMinutes)}</span>
                </div>
              ) : null}
              {layoutsByDay[dayIndex]?.map(({ task, lane, lanes }) => {
                const category = resolveTaskCategory(task.categoryId, taskCategories)
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
                    aria-label={`${day} ${formatScheduleMinutes(task.schedule.startMinutes)} 到 ${formatScheduleMinutes(task.schedule.endMinutes)}，${task.title}`}
                    style={{
                      '--event-start-ratio': task.schedule.startMinutes / MINUTES_PER_DAY,
                      '--event-duration-ratio': (task.schedule.endMinutes - task.schedule.startMinutes) / MINUTES_PER_DAY,
                      '--event-left': `calc(${leftPercent}% + 4px)`,
                      '--event-width': `calc(${widthPercent}% - 8px)`,
                      '--event-color': category.color,
                      '--event-ink': getReadableCategoryInk(category.color)
                    } as EventVarStyle}
                  >
                    <span className="study-schedule-event-time">
                      {formatScheduleMinutes(task.schedule.startMinutes)}-{formatScheduleMinutes(task.schedule.endMinutes)}
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
                    <small className="study-schedule-event-category" style={categoryBadgeStyle(category)}>
                      <span aria-hidden="true" />
                      {category.name}
                    </small>
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

      {taskDrag && draggedTaskCategory ? (
        <div
          className="study-schedule-drag-float"
          style={{
            left: taskDrag.clientX - taskDrag.grabOffsetX,
            top: taskDrag.clientY - taskDrag.grabOffsetY - 8,
            width: taskDrag.width,
            minHeight: taskDrag.height,
            '--event-color': draggedTaskCategory.color,
            '--event-ink': getReadableCategoryInk(draggedTaskCategory.color)
          } as TaskColorVarStyle}
          aria-hidden="true"
        >
          <span className="study-schedule-event-time">
            {formatScheduleMinutes(taskDrag.previewSchedule.startMinutes)}-{formatScheduleMinutes(taskDrag.previewSchedule.endMinutes)}
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


      {categoryContextMenu ? (
        <div
          className="study-schedule-context-menu study-schedule-category-context-menu"
          role="menu"
          aria-label={`${categoryContextMenu.categoryName} 类别操作`}
          style={{ left: categoryContextMenu.x, top: categoryContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => deleteCustomCategory(categoryContextMenu.categoryId)}
          >
            <Trash2 size={14} />
            删除类别
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
                <h2 id={editorTitleId}>{weekDays[editor.schedule.weekday]} {formatScheduleMinutes(editor.schedule.startMinutes)}-{formatScheduleMinutes(editor.schedule.endMinutes)}</h2>
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
              <div className="study-schedule-editor-field">
                <span>开始</span>
                <TimeSelect
                  value={editor.schedule.startMinutes}
                  minMinutes={0}
                  maxMinutes={MINUTES_PER_DAY - 1}
                  ariaLabel="开始时间"
                  onChange={(nextStart) => {
                    updateEditorSchedule({
                      startMinutes: nextStart,
                      endMinutes: editor.schedule.endMinutes <= nextStart
                        ? Math.min(MINUTES_PER_DAY, nextStart + 60)
                        : editor.schedule.endMinutes
                    })
                  }}
                />
              </div>
              <div className="study-schedule-editor-field">
                <span>结束</span>
                <TimeSelect
                  value={editor.schedule.endMinutes}
                  minMinutes={1}
                  maxMinutes={MINUTES_PER_DAY}
                  ariaLabel="结束时间"
                  disabledOption={(minutes) => minutes <= editor.schedule.startMinutes}
                  onChange={(endMinutes) => updateEditorSchedule({ endMinutes })}
                />
              </div>
            </div>
            <div className="study-schedule-editor-categories">
              <span>类别</span>
              <div className="study-schedule-category-swatches" aria-label="任务类别">
                {taskCategories.map((category) => (
                  <div
                    key={category.id}
                    className={`study-schedule-category-option${editor.categoryId === category.id ? ' is-selected' : ''}`}
                    style={categoryBadgeStyle(category)}
                  >
                    <button
                      type="button"
                      className="study-schedule-category-select"
                      aria-pressed={editor.categoryId === category.id}
                      title={category.builtin ? category.name : `${category.name} · 右键删除`}
                      onClick={() => updateEditorCategory(category.id)}
                      onContextMenu={(event) => openCategoryContextMenu(event, category)}
                    >
                      <em>{category.name}</em>
                    </button>
                    <label
                      className="study-schedule-category-color"
                      title={`修改${category.name}颜色`}
                    >
                      <input
                        type="color"
                        value={category.color}
                        aria-label={`修改${category.name}颜色`}
                        onChange={(event) => updateCategoryColor(
                          category.id,
                          event.target.value.toLowerCase() as `#${string}`
                        )}
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>
                ))}
              </div>
              <div className="study-schedule-custom-category">
                <input
                  type="text"
                  value={customCategoryName}
                  maxLength={maxCategoryNameLength}
                  placeholder="自定义类别名称"
                  aria-label="自定义类别名称"
                  onChange={(event) => {
                    setCustomCategoryName(event.target.value)
                    setCustomCategoryError('')
                  }}
                />
                <input
                  type="color"
                  value={customCategoryColor}
                  aria-label="自定义类别颜色"
                  onChange={(event) => setCustomCategoryColor(event.target.value.toLowerCase() as `#${string}`)}
                />
                <button type="button" onClick={addCustomCategory}>
                  <Plus size={14} />
                  添加类别
                </button>
              </div>
              {customCategoryError ? (
                <div className="study-schedule-category-error" role="status">{customCategoryError}</div>
              ) : null}
            </div>
            <div className="study-schedule-editor-status" role="status" aria-live="polite">
              {editorError}
            </div>
            <div className="study-schedule-editor-footer">
              {editor.mode === 'edit' ? (
                <div className="study-schedule-editor-completion">
                  <button
                    type="button"
                    className={editor.done ? 'is-complete' : ''}
                    aria-pressed={editor.done}
                    aria-label={editor.done ? '取消完成' : '标记为已完成'}
                    onClick={() => {
                      setEditor((current) => current && current.mode === 'edit'
                        ? { ...current, done: !current.done }
                        : current)
                    }}
                  >
                    <Check size={17} />
                  </button>
                  <span>已完成</span>
                </div>
              ) : <span aria-hidden="true" />}
              <div className="study-schedule-editor-actions">
                <button type="button" className="study-schedule-secondary-button" onClick={closeEditor}>取消</button>
                <button type="submit" className="study-schedule-primary-button">
                  <Check size={15} />
                  {editor.mode === 'add' ? '添加' : '保存'}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
