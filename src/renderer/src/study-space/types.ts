export type StudyTimerMode = 'focus' | 'break'
export type StudyTimerState = 'idle' | 'running' | 'paused'
export type StudyRoomId = 'silent' | 'sprint' | 'deep' | 'exam'
export type StudyModeId = 'free' | 'sync' | 'deepwork' | 'exam'
export type StudyPresenceStatus = 'connecting' | 'online' | 'offline'
export type StudyRoomEventKind = 'checkin' | 'focus_start' | 'task_done' | 'cheer'
export type StudyRoomCyclePhase = 'focus' | 'break'
export type StudySignalId = 'reading' | 'writing' | 'practice' | 'review' | 'exam'

export type StudyTaskSchedule = {
  weekday: number
  startMinutes: number
  endMinutes: number
}

export type StudyTaskScheduleInput = StudyTaskSchedule

export type StudyTaskUpdateInput = {
  title?: string
  done?: boolean
  schedule?: StudyTaskScheduleInput
}

export type StudyTask = {
  id: string
  title: string
  done: boolean
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
  ambientEnabled: boolean
  ambientVolume: number
  roomId: StudyRoomId
  seatIndex: number
  seatClaimedAt: number
  timerMode: StudyTimerMode
  timerState: StudyTimerState
  focusMinutes: number
  breakMinutes: number
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
