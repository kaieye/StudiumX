import { STUDY_PRESENCE_BROKER_URL, STUDY_TASK_LIMIT, studyModes, studyRooms } from '../constants'
import {
  nextStudyStreakForDate,
  normalizeStudyRelayUrl,
  normalizeStudySeatIndex,
  normalizeStudySpaceCode,
  normalizeStudyTaskSchedule,
  todayKey
} from '../domain'
import { normalizeStudyTaskCategoryId } from '../taskCategories'
import type { StudySignalId, StudySnapshot, StudyTaskScheduleInput, StudyTaskUpdateInput, StudyTimerMode } from '../types'

type StudyRoom = typeof studyRooms[number]
type StudyMode = typeof studyModes[number]

export type StudyHostAction = 'open_focus_theater' | 'lock_contract' | 'follow_room_cycle' | 'toggle_timer'

export function defaultStudyContractText(snapshot: StudySnapshot, activeModeName: string): string {
  return snapshot.tasks.find((task) => !task.done)?.title || activeModeName
}

export type StudyTimerProgressInput = {
  /** Newly observed whole active seconds since the previous sample. */
  activeSeconds: number
  /** Remaining active plan after this sample. */
  remainingSeconds: number
  completed: boolean
  localToday?: string
  /** Focus seconds keyed by captured local day; omitted for break timers. */
  focusSecondsByLocalDate?: Partial<Record<string, number>>
  /** Fact-aligned XP, useful for partial room-cycle sessions. */
  xpEarned?: number
}

/** Applies elapsed-time deltas; it never assumes an interval callback represents one second. */
export function advanceStudyTimerBySeconds(
  snapshot: StudySnapshot,
  input: StudyTimerProgressInput
): StudySnapshot {
  const localToday = input.localToday ?? todayKey()
  const activeSeconds = Math.max(0, Math.floor(input.activeSeconds))
  const todayFocusBase = snapshot.lastStudyDate === localToday ? snapshot.todayFocusSeconds : 0
  const todaySessionsBase = snapshot.lastStudyDate === localToday ? snapshot.todaySessions : 0

  let lastStudyDate = snapshot.lastStudyDate
  let streakDays = snapshot.streakDays
  let todayFocusSeconds = todayFocusBase
  let totalFocusSeconds = snapshot.totalFocusSeconds
  let focusDates: string[] = []

  if (snapshot.timerMode === 'focus' && activeSeconds > 0) {
    const byDate = input.focusSecondsByLocalDate && Object.keys(input.focusSecondsByLocalDate).length > 0
      ? input.focusSecondsByLocalDate
      : { [localToday]: activeSeconds }
    focusDates = Object.entries(byDate)
      .filter(([, seconds]) => (seconds ?? 0) > 0)
      .map(([date]) => date)
      .sort()
    for (const date of focusDates) {
      streakDays = nextStudyStreakForDate(lastStudyDate, streakDays, date)
      lastStudyDate = date
    }
    todayFocusSeconds += Math.max(0, Math.floor(byDate[localToday] ?? 0))
    totalFocusSeconds += activeSeconds
  }

  if (!input.completed) {
    return {
      ...snapshot,
      remainingSeconds: Math.max(1, Math.ceil(input.remainingSeconds)),
      todayFocusSeconds,
      todaySessions: todaySessionsBase,
      totalFocusSeconds,
      streakDays,
      lastStudyDate
    }
  }

  if (snapshot.timerMode === 'focus') {
    const completionDate = focusDates.at(-1) ?? localToday
    return {
      ...snapshot,
      timerMode: 'break',
      timerState: 'idle',
      remainingSeconds: snapshot.breakMinutes * 60,
      contractLocked: false,
      todayFocusSeconds,
      todaySessions: todaySessionsBase + (completionDate === localToday ? 1 : 0),
      totalFocusSeconds,
      totalSessions: snapshot.totalSessions + 1,
      streakDays,
      xp: snapshot.xp + (input.xpEarned ?? Math.max(10, snapshot.focusMinutes * 2)),
      lastStudyDate
    }
  }

  return {
    ...snapshot,
    timerMode: 'focus',
    timerState: 'idle',
    remainingSeconds: snapshot.focusMinutes * 60,
    todayFocusSeconds: todayFocusBase,
    todaySessions: todaySessionsBase
  }
}

/** Compatibility helper for deterministic one-second transition checks. */
export function tickStudyTimer(snapshot: StudySnapshot, today = todayKey()): StudySnapshot {
  return advanceStudyTimerBySeconds(snapshot, {
    activeSeconds: 1,
    remainingSeconds: Math.max(0, snapshot.remainingSeconds - 1),
    completed: snapshot.remainingSeconds <= 1,
    localToday: today,
    ...(snapshot.timerMode === 'focus' ? { focusSecondsByLocalDate: { [today]: 1 } } : {})
  })
}

export function updateStudyTimerPreset(
  snapshot: StudySnapshot,
  focusMinutes: number,
  breakMinutes: number
): StudySnapshot {
  return {
    ...snapshot,
    focusMinutes,
    breakMinutes,
    timerMode: 'focus',
    timerState: snapshot.timerState === 'running' ? snapshot.timerState : 'idle',
    remainingSeconds: snapshot.timerState === 'running' ? snapshot.remainingSeconds : focusMinutes * 60
  }
}

export function selectStudyModeSnapshot(snapshot: StudySnapshot, mode: StudyMode): StudySnapshot {
  const roomChanged = snapshot.timerState !== 'running' && mode.roomId !== snapshot.roomId
  return {
    ...snapshot,
    modeId: mode.id,
    roomId: snapshot.timerState === 'running' ? snapshot.roomId : mode.roomId,
    seatIndex: snapshot.timerState === 'running'
      ? snapshot.seatIndex
      : normalizeStudySeatIndex(snapshot.seatIndex, mode.roomId, snapshot.clientId),
    seatClaimedAt: roomChanged ? Date.now() : snapshot.seatClaimedAt,
    focusMinutes: snapshot.timerState === 'running' ? snapshot.focusMinutes : mode.focusMinutes,
    breakMinutes: snapshot.timerState === 'running' ? snapshot.breakMinutes : mode.breakMinutes,
    remainingSeconds: snapshot.timerState === 'running' ? snapshot.remainingSeconds : mode.focusMinutes * 60,
    timerMode: snapshot.timerState === 'running' ? snapshot.timerMode : 'focus',
    ambientEnabled: mode.id === 'exam' ? false : snapshot.ambientEnabled
  }
}

export function toggleStudyContract(snapshot: StudySnapshot, fallbackContract: string): StudySnapshot {
  return {
    ...snapshot,
    contractText: (snapshot.contractText.trim() || fallbackContract).slice(0, 120),
    contractLocked: !snapshot.contractLocked
  }
}

export function updateStudyContractText(snapshot: StudySnapshot, contractText: string): StudySnapshot {
  return { ...snapshot, contractText: contractText.slice(0, 120) }
}

export function saveStudyNickname(snapshot: StudySnapshot, nicknameInput: string): StudySnapshot {
  const nickname = nicknameInput.trim().slice(0, 18)
  return nickname ? { ...snapshot, nickname } : snapshot
}

export function joinStudySpace(snapshot: StudySnapshot, spaceInput: string, nowMs = Date.now()): StudySnapshot {
  const spaceCode = normalizeStudySpaceCode(spaceInput)
  return { ...snapshot, spaceCode, seatClaimedAt: spaceCode !== snapshot.spaceCode ? nowMs : snapshot.seatClaimedAt }
}

export function setStudySpaceCode(snapshot: StudySnapshot, spaceCode: string, nowMs = Date.now()): StudySnapshot {
  return { ...snapshot, spaceCode, seatClaimedAt: spaceCode !== snapshot.spaceCode ? nowMs : snapshot.seatClaimedAt }
}

export function saveStudyRelayUrl(snapshot: StudySnapshot, relayInput: string): {
  snapshot: StudySnapshot
  relayUrl: string
} {
  const relayUrl = normalizeStudyRelayUrl(relayInput)
  return { snapshot: { ...snapshot, presenceRelayUrl: relayUrl }, relayUrl }
}

export function resetStudyRelayUrl(snapshot: StudySnapshot): StudySnapshot {
  return { ...snapshot, presenceRelayUrl: STUDY_PRESENCE_BROKER_URL }
}

export function toggleStudyTimer(snapshot: StudySnapshot, fallbackContract: string): StudySnapshot {
  return {
    ...snapshot,
    timerState: snapshot.timerState === 'running' ? 'paused' : 'running',
    ...(snapshot.timerState === 'running'
      ? {}
      : {
          contractText: (snapshot.contractText.trim() || fallbackContract).slice(0, 120),
          contractLocked: snapshot.timerMode === 'focus' ? true : snapshot.contractLocked
        })
  }
}

export function followStudyRoomCycle(input: {
  snapshot: StudySnapshot
  room: StudyRoom
  phase: StudyTimerMode
  remainingSeconds: number
  fallbackContract: string
}): StudySnapshot {
  return {
    ...input.snapshot,
    focusMinutes: input.room.sessionMinutes,
    breakMinutes: input.room.breakMinutes,
    timerMode: input.phase,
    timerState: 'running',
    remainingSeconds: input.remainingSeconds,
    contractText: (input.snapshot.contractText.trim() || input.fallbackContract).slice(0, 120),
    contractLocked: input.phase === 'focus'
  }
}

export function chooseStudySeatSnapshot(snapshot: StudySnapshot, seatIndex: number, nowMs = Date.now()): StudySnapshot {
  const normalizedSeatIndex = normalizeStudySeatIndex(seatIndex, snapshot.roomId, snapshot.clientId)
  return {
    ...snapshot,
    seatIndex: normalizedSeatIndex,
    seatClaimedAt: normalizedSeatIndex !== snapshot.seatIndex ? nowMs : snapshot.seatClaimedAt
  }
}

export function deriveStudyHostAction(snapshot: StudySnapshot, followingRoomCycle: boolean): StudyHostAction {
  if (snapshot.timerState === 'running') return 'open_focus_theater'
  if (!snapshot.contractLocked && snapshot.timerMode === 'focus') return 'lock_contract'
  if (!followingRoomCycle) return 'follow_room_cycle'
  return 'toggle_timer'
}

export function resetStudyTimer(snapshot: StudySnapshot): StudySnapshot {
  return {
    ...snapshot,
    timerState: 'idle',
    contractLocked: false,
    remainingSeconds: (snapshot.timerMode === 'focus' ? snapshot.focusMinutes : snapshot.breakMinutes) * 60
  }
}

export function switchStudyTimerMode(snapshot: StudySnapshot, timerMode: StudyTimerMode): StudySnapshot {
  return {
    ...snapshot,
    timerMode,
    timerState: snapshot.timerState === 'running' ? 'paused' : snapshot.timerState,
    remainingSeconds: (timerMode === 'focus' ? snapshot.focusMinutes : snapshot.breakMinutes) * 60
  }
}

export function addStudyTask(snapshot: StudySnapshot, titleInput: string, id: string): {
  snapshot: StudySnapshot
  added: boolean
} {
  const title = titleInput.trim()
  if (!title) return { snapshot, added: false }
  return {
    snapshot: {
      ...snapshot,
      tasks: [{ id, title: title.slice(0, 80), done: false, categoryId: 'study' as const }, ...snapshot.tasks].slice(0, STUDY_TASK_LIMIT)
    },
    added: true
  }
}

export function addScheduledStudyTask(
  snapshot: StudySnapshot,
  titleInput: string,
  id: string,
  scheduleInput: StudyTaskScheduleInput,
  categoryIdInput?: string | null
): {
  snapshot: StudySnapshot
  added: boolean
} {
  const title = titleInput.trim()
  const schedule = normalizeStudyTaskSchedule(scheduleInput)
  const categoryId = normalizeStudyTaskCategoryId(categoryIdInput) ?? 'study'
  if (!title || !schedule) return { snapshot, added: false }
  return {
    snapshot: {
      ...snapshot,
      tasks: [{
        id,
        title: title.slice(0, 80),
        done: false,
        categoryId,
        schedule
      }, ...snapshot.tasks].slice(0, STUDY_TASK_LIMIT)
    },
    added: true
  }
}

export function toggleStudyTask(snapshot: StudySnapshot, taskId: string): StudySnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => task.id === taskId ? { ...task, done: !task.done } : task)
  }
}

export function updateStudyTask(
  snapshot: StudySnapshot,
  taskId: string,
  updateInput: StudyTaskUpdateInput
): {
  snapshot: StudySnapshot
  updated: boolean
} {
  let updated = false
  const tasks = snapshot.tasks.map((task) => {
    if (task.id !== taskId) return task
    let taskUpdated = false
    const nextTask = { ...task }
    if (typeof updateInput.title === 'string') {
      const title = updateInput.title.trim().slice(0, 80)
      if (title) {
        nextTask.title = title
        taskUpdated = true
      }
    }
    if (typeof updateInput.done === 'boolean') {
      nextTask.done = updateInput.done
      taskUpdated = true
    }
    if (updateInput.schedule) {
      const schedule = normalizeStudyTaskSchedule(updateInput.schedule)
      if (schedule) {
        nextTask.schedule = schedule
        taskUpdated = true
      }
    }
    if (updateInput.categoryId !== undefined) {
      const categoryId = normalizeStudyTaskCategoryId(updateInput.categoryId) ?? 'study'
      if (categoryId !== nextTask.categoryId) {
        nextTask.categoryId = categoryId
        taskUpdated = true
      }
    }
    updated = updated || taskUpdated
    return taskUpdated ? nextTask : task
  })
  return { snapshot: updated ? { ...snapshot, tasks } : snapshot, updated }
}

export function removeDoneStudyTasks(snapshot: StudySnapshot): StudySnapshot {
  return { ...snapshot, tasks: snapshot.tasks.filter((task) => !task.done) }
}

export function removeStudyTask(snapshot: StudySnapshot, taskId: string): StudySnapshot {
  return { ...snapshot, tasks: snapshot.tasks.filter((task) => task.id !== taskId) }
}

export function selectStudySignal(snapshot: StudySnapshot, signalId: StudySignalId): StudySnapshot {
  return { ...snapshot, signalId }
}

export function toggleStudyAmbient(snapshot: StudySnapshot): StudySnapshot {
  return { ...snapshot, ambientEnabled: !snapshot.ambientEnabled }
}

export function setStudyAmbientVolume(snapshot: StudySnapshot, ambientVolume: number): StudySnapshot {
  return { ...snapshot, ambientVolume }
}