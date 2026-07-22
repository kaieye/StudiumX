export type StudyTimerMode = 'focus' | 'break'
export type StudyTimerState = 'idle' | 'running' | 'paused'

export type StudyTimerPlan = {
  id: string
  name: string
  focusMinutes: number
  breakMinutes: number
  simulationStartTime: string
  simulationEndTime: string
  /** STC-502: optional long break minutes (canonical TimerPlanV2). */
  longBreakMinutes?: number
  /** STC-502: optional long-break interval (focus cycles). */
  longBreakEvery?: number
  /** STC-502: rest transition policy (pomodoro product: automatic|ask). */
  breakPolicy?: 'automatic' | 'ask' | 'reminder_only' | 'none'
  /** STC-504: plan kind (default pomodoro when absent). */
  kind?: 'pomodoro' | 'continuous' | 'custom_rhythm'
  /** STC-504: clock mode (continuous default countup). */
  clockMode?: 'countdown' | 'countup'
  /**
   * STC-504: when kind=continuous + countup, true means focusMinutes is a target;
   * false/absent means open-ended countup (focusMinutes is display-only cache).
   */
  continuousTarget?: boolean
  /**
   * STC-702: ordered custom rhythm steps (kind + minutes). V1 dual-write cache only;
   * durable authority is TimerPlanV2.rhythmSequence. Not a freeform drag editor.
   */
  rhythmSequence?: Array<{
    kind: 'focus' | 'short_break' | 'long_break' | 'wrap_up'
    minutes: number
  }>
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

export type StudyTaskBuiltinCategoryId = 'study' | 'entertainment' | 'exercise' | 'other'
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
  /** Pass null to clear the rebuildable V1 primary schedule cache (STC-307 multi-block). */
  schedule?: StudyTaskScheduleInput | null
  /**
   * STC-304 / freeze #8: null clears estimate; undefined leaves unchanged.
   * Never invent from timer plan focus minutes.
   */
  estimateMinutes?: number | null
}

export type StudyTask = {
  id: string
  title: string
  done: boolean
  categoryId?: StudyTaskCategoryId
  schedule?: StudyTaskSchedule
  /** Optional sole-read cache of PlanningTask.estimateMinutes (null = unset). */
  estimateMinutes?: number | null
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
