import { STUDY_PRESENCE_BROKER_URL, STUDY_TASK_LIMIT, studyModes, studyRooms } from '../constants'
import {
  nextStudyStreak,
  normalizeStudyRelayUrl,
  normalizeStudySeatIndex,
  normalizeStudySpaceCode,
  normalizeStudyTaskSchedule,
  todayKey
} from '../domain'
import type { StudySignalId, StudySnapshot, StudyTaskScheduleInput, StudyTimerMode } from '../types'

type StudyRoom = typeof studyRooms[number]
type StudyMode = typeof studyModes[number]

export type StudyHostAction = 'open_focus_theater' | 'lock_contract' | 'follow_room_cycle' | 'toggle_timer'

export function defaultStudyContractText(snapshot: StudySnapshot, activeModeName: string): string {
  return snapshot.tasks.find((task) => !task.done)?.title || activeModeName
}

export function tickStudyTimer(snapshot: StudySnapshot, today = todayKey()): StudySnapshot {
  const studyingFocus = snapshot.timerMode === 'focus'
  const streakDays = studyingFocus ? nextStudyStreak(snapshot.lastStudyDate, snapshot.streakDays) : snapshot.streakDays
  const lastStudyDate = studyingFocus ? today : snapshot.lastStudyDate
  const todayFocusSeconds = studyingFocus ? snapshot.todayFocusSeconds + 1 : snapshot.todayFocusSeconds
  const totalFocusSeconds = studyingFocus ? snapshot.totalFocusSeconds + 1 : snapshot.totalFocusSeconds

  if (snapshot.remainingSeconds > 1) {
    return {
      ...snapshot,
      remainingSeconds: snapshot.remainingSeconds - 1,
      todayFocusSeconds,
      totalFocusSeconds,
      streakDays,
      lastStudyDate
    }
  }

  if (snapshot.timerMode === 'focus') {
    return {
      ...snapshot,
      timerMode: 'break',
      timerState: 'idle',
      remainingSeconds: snapshot.breakMinutes * 60,
      contractLocked: false,
      todayFocusSeconds,
      todaySessions: snapshot.todaySessions + 1,
      totalFocusSeconds,
      totalSessions: snapshot.totalSessions + 1,
      streakDays,
      xp: snapshot.xp + Math.max(10, snapshot.focusMinutes * 2),
      lastStudyDate
    }
  }

  return {
    ...snapshot,
    timerMode: 'focus',
    timerState: 'idle',
    remainingSeconds: snapshot.focusMinutes * 60
  }
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

export function selectStudyRoomSnapshot(snapshot: StudySnapshot, room: StudyRoom): StudySnapshot {
  const roomChanged = room.id !== snapshot.roomId
  return {
    ...snapshot,
    roomId: room.id,
    seatIndex: normalizeStudySeatIndex(snapshot.seatIndex, room.id, snapshot.clientId),
    seatClaimedAt: roomChanged ? Date.now() : snapshot.seatClaimedAt,
    focusMinutes: snapshot.timerState === 'running' ? snapshot.focusMinutes : room.sessionMinutes,
    breakMinutes: snapshot.timerState === 'running' ? snapshot.breakMinutes : room.breakMinutes,
    remainingSeconds: snapshot.timerState === 'running' ? snapshot.remainingSeconds : room.sessionMinutes * 60,
    timerMode: snapshot.timerState === 'running' ? snapshot.timerMode : 'focus'
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
      tasks: [{ id, title: title.slice(0, 80), done: false }, ...snapshot.tasks].slice(0, STUDY_TASK_LIMIT)
    },
    added: true
  }
}

export function addScheduledStudyTask(
  snapshot: StudySnapshot,
  titleInput: string,
  id: string,
  scheduleInput: StudyTaskScheduleInput
): {
  snapshot: StudySnapshot
  added: boolean
} {
  const title = titleInput.trim()
  const schedule = normalizeStudyTaskSchedule(scheduleInput)
  if (!title || !schedule) return { snapshot, added: false }
  return {
    snapshot: {
      ...snapshot,
      tasks: [{ id, title: title.slice(0, 80), done: false, schedule }, ...snapshot.tasks].slice(0, STUDY_TASK_LIMIT)
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

export function removeDoneStudyTasks(snapshot: StudySnapshot): StudySnapshot {
  return { ...snapshot, tasks: snapshot.tasks.filter((task) => !task.done) }
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
