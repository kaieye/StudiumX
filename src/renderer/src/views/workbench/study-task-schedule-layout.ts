import type { StudyTask, StudyTaskSchedule } from '../../study-space/types'

export type ScheduledStudyTask = StudyTask & { schedule: StudyTaskSchedule }

export type ScheduledTaskLayout<TTask extends ScheduledStudyTask = ScheduledStudyTask> = {
  task: TTask
  lane: number
  lanes: number
}

export function layoutDayTasks<TTask extends ScheduledStudyTask>(tasks: TTask[]): ScheduledTaskLayout<TTask>[] {
  const sorted = [...tasks].sort((left, right) => {
    const startDelta = left.schedule.startMinutes - right.schedule.startMinutes
    return startDelta || left.schedule.endMinutes - right.schedule.endMinutes || left.title.localeCompare(right.title)
  })
  const layouts: ScheduledTaskLayout<TTask>[] = []
  let cluster: TTask[] = []
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

export function layoutOverlapCluster<TTask extends ScheduledStudyTask>(tasks: TTask[]): ScheduledTaskLayout<TTask>[] {
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