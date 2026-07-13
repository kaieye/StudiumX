import { ArrowLeft, CalendarDays, Check, Clock3, Plus } from 'lucide-react'
import { useId, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { StudyTask, StudyTaskSchedule, StudyTaskScheduleInput } from '../../study-space/types'

type StudyTaskSchedulePageProps = {
  tasks: StudyTask[]
  openTasks: number
  completedTasks: number
  onAddScheduledTask: (title: string, schedule: StudyTaskScheduleInput) => boolean
  onToggleTask: (taskId: string) => void
  onBack: () => void
}

type ScheduledStudyTask = StudyTask & { schedule: StudyTaskSchedule }

type ScheduledTaskLayout = {
  task: ScheduledStudyTask
  lane: number
  lanes: number
}

type NumberVarStyle<Name extends string> = CSSProperties & Record<Name, number>

const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const hourMarks = Array.from({ length: 25 }, (_, hour) => hour)
const eventColors = ['#007aff', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#30b0c7', '#5856d6']

const startTimeOptions = createTimeOptions(0, 23 * 60 + 30)
const endTimeOptions = createTimeOptions(30, 24 * 60)

function createTimeOptions(startMinutes: number, endMinutes: number): number[] {
  const options: number[] = []
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 30) {
    options.push(minutes)
  }
  return options
}

function currentWeekdayIndex(): number {
  return (new Date().getDay() + 6) % 7
}

function hasSchedule(task: StudyTask): task is ScheduledStudyTask {
  return Boolean(task.schedule)
}

function formatMinutes(minutes: number): string {
  if (minutes >= 24 * 60) return '24:00'
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatHour(hour: number): string {
  return `${hour}:00`
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
  onToggleTask,
  onBack
}: StudyTaskSchedulePageProps) {
  const titleId = useId()
  const [title, setTitle] = useState('')
  const [weekday, setWeekday] = useState(() => currentWeekdayIndex())
  const [startMinutes, setStartMinutes] = useState(9 * 60)
  const [endMinutes, setEndMinutes] = useState(10 * 60)
  const [error, setError] = useState('')
  const scheduledTasks = useMemo(() => tasks.filter(hasSchedule), [tasks])
  const unscheduledCount = tasks.length - scheduledTasks.length
  const layoutsByDay = useMemo(() => {
    return weekDays.map((_, dayIndex) => layoutDayTasks(scheduledTasks.filter((task) => task.schedule.weekday === dayIndex)))
  }, [scheduledTasks])
  const todayIndex = currentWeekdayIndex()

  const handleStartChange = (minutes: number): void => {
    setStartMinutes(minutes)
    if (endMinutes <= minutes) setEndMinutes(Math.min(24 * 60, minutes + 60))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('先写下任务名称')
      return
    }
    if (endMinutes <= startMinutes) {
      setError('结束时间需要晚于开始时间')
      return
    }
    if (onAddScheduledTask(trimmedTitle, { weekday, startMinutes, endMinutes })) {
      setTitle('')
      setError('')
    }
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
          <span><strong>{openTasks}</strong>待完成</span>
          <span><strong>{completedTasks}</strong>已完成</span>
          <span><strong>{scheduledTasks.length}</strong>已排期</span>
        </div>
      </header>

      <form className="study-schedule-form" onSubmit={handleSubmit}>
        <label>
          <span>任务</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：复盘线性代数错题"
            maxLength={80}
          />
        </label>
        <label>
          <span>星期</span>
          <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
            {weekDays.map((day, index) => (
              <option key={day} value={index}>{day}</option>
            ))}
          </select>
        </label>
        <label>
          <span>开始</span>
          <select value={startMinutes} onChange={(event) => handleStartChange(Number(event.target.value))}>
            {startTimeOptions.map((minutes) => (
              <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>结束</span>
          <select value={endMinutes} onChange={(event) => setEndMinutes(Number(event.target.value))}>
            {endTimeOptions.map((minutes) => (
              <option key={minutes} value={minutes} disabled={minutes <= startMinutes}>
                {formatMinutes(minutes)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!title.trim()}>
          <Plus size={16} />
          添加
        </button>
        <div className="study-schedule-form-status" role="status" aria-live="polite">
          {error || (unscheduledCount > 0 ? `${unscheduledCount} 个任务尚未排期` : '')}
        </div>
      </form>

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
              style={{ '--hour-index': hour } as NumberVarStyle<'--hour-index'>}
            >
              {formatHour(hour)}
            </span>
          ))}
        </div>
        {weekDays.map((day, dayIndex) => (
          <div key={day} className="study-schedule-day-column" role="gridcell" aria-label={day}>
            {layoutsByDay[dayIndex]?.map(({ task, lane, lanes }) => {
              const color = eventColors[dayIndex % eventColors.length]
              const widthPercent = 100 / lanes
              const leftPercent = lane * widthPercent
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`study-schedule-event${task.done ? ' is-done' : ''}`}
                  onClick={() => onToggleTask(task.id)}
                  aria-pressed={task.done}
                  aria-label={`${day} ${formatMinutes(task.schedule.startMinutes)} 到 ${formatMinutes(task.schedule.endMinutes)}，${task.title}`}
                  style={{
                    '--event-start': task.schedule.startMinutes / 60,
                    '--event-duration': (task.schedule.endMinutes - task.schedule.startMinutes) / 60,
                    '--event-left': `calc(${leftPercent}% + 4px)`,
                    '--event-width': `calc(${widthPercent}% - 8px)`,
                    '--event-color': color
                  } as CSSProperties & Record<'--event-start' | '--event-duration' | '--event-left' | '--event-width' | '--event-color', string | number>}
                >
                  <span>{formatMinutes(task.schedule.startMinutes)}-{formatMinutes(task.schedule.endMinutes)}</span>
                  <strong>{task.title}</strong>
                  <small>{task.done ? <Check size={11} /> : null}{task.done ? '已完成' : '待完成'}</small>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
