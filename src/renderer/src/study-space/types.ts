export type StudyTimerMode = 'focus' | 'break'
export type StudyTimerState = 'idle' | 'running' | 'paused'

export type StudyTimerPlan = {
  id: string
  name: string
  focusMinutes: number
  breakMinutes: number
  simulationStartTime: string
  simulationEndTime: string
}

export type StudyTimerPlanInput = Omit<StudyTimerPlan, 'id'>
export type StudyRoomId = 'silent' | 'sprint' | 'deep' | 'exam'
export type StudyModeId = 'free' | 'sync' | 'deepwork' | 'exam'
export type StudyPresenceStatus = 'connecting' | 'online' | 'offline'
export type StudyRoomEventKind = 'checkin' | 'focus_start' | 'task_done' | 'cheer'
export type StudyRoomCyclePhase = 'focus' | 'break'
export type StudySignalId = 'reading' | 'writing' | 'practice' | 'review' | 'exam'
export type StudyTaskScheduleColorId =
  | 'sage'
  | 'mist'
  | 'clay'
  | 'mauve'
  | 'sand'
  | 'slate'
  | 'rose'
  | `#${string}`

export type StudyTaskBuiltinCategoryId = 'study' | 'entertainment' | 'exercise'
export type StudyTaskCategoryId = StudyTaskBuiltinCategoryId | `custom-${string}`

export type StudyTaskCategory = {
  id: StudyTaskCategoryId
  name: string
  color: `#${string}`
  builtin: boolean
}

export type StudyTaskCategoryInput = {
  name: string
  color: `#${string}`
}

export type StudyTaskSchedule = {
  weekday: number
  startMinutes: number
  endMinutes: number
  colorId?: StudyTaskScheduleColorId
}

export type StudyTaskScheduleInput = StudyTaskSchedule

export type StudyTaskUpdateInput = {
  title?: string
  done?: boolean
  categoryId?: StudyTaskCategoryId | null
  schedule?: StudyTaskScheduleInput
}

export type StudyTask = {
  id: string
  title: string
  done: boolean
  categoryId?: StudyTaskCategoryId
  schedule?: StudyTaskSchedule
}

export type StudyPresencePeer = {
  clientId: string
  roomId: StudyRoomId
  spaceCode: string
  nickname: string
  signalId: StudySignalId
  seatIndex: number
  seatClaimedAt: number
  status: StudyTimerState
  timerMode: StudyTimerMode
  focusMinutes: number
  todayFocusSeconds: number
  todaySessions: number
  streakDays: number
  updatedAt: number
}

export type StudyRoomEvent = {
  id: string
  clientId: string
  spaceCode: string
  roomId: StudyRoomId
  nickname: string
  kind: StudyRoomEventKind
  text: string
  createdAt: number
}

export type StudyRoomCycle = {
  phase: StudyRoomCyclePhase
  round: number
  elapsedSeconds: number
  remainingSeconds: number
  totalSeconds: number
  progress: number
  nextLabel: string
}

export type StudySnapshot = {
  clientId: string
  nickname: string
  spaceCode: string
  presenceRelayUrl: string
  signalId: StudySignalId
  modeId: StudyModeId
  contractText: string
  contractLocked: boolean
  roomId: StudyRoomId
  seatIndex: number
  seatClaimedAt: number
  timerMode: StudyTimerMode
  timerState: StudyTimerState
  focusMinutes: number
  breakMinutes: number
  simulationStartTime: string
  simulationEndTime: string
  timerPlans: StudyTimerPlan[]
  remainingSeconds: number
  todayFocusSeconds: number
  todaySessions: number
  totalFocusSeconds: number
  totalSessions: number
  streakDays: number
  xp: number
  lastStudyDate: string
  tasks: StudyTask[]
}
